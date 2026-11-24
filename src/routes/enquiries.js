// Enquiries and the conversation between buyer and seller.
//
// A buyer (signed in or not) sends an enquiry about a live listing. The seller replies from their
// inbox and both sides keep chatting there. Guest buyers get a private link (with an access key)
// to their conversation, and an SMS/email when the seller replies.
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { Enquiry, Vehicle, User, Notification } from '../models/index.js';
import { ah, parse, badRequest, forbidden, notFound } from '../lib/http.js';
import { uid } from '../lib/ids.js';
import { requireAuth, adminCan, memberCan } from '../middleware/auth.js';
import { formLimiter, messageLimiter } from '../middleware/limits.js';
import { publicUser, publicVehicle } from '../services/serialize.js';
import { enquiryView, conversationKey, conversationKeyOk as keyOk } from '../services/enquiryView.js';
import { publish, toUser } from '../services/realtime.js';
import { notify, alertUser, webLink } from '../services/notify.js';
import { sendSmsAlert } from '../services/sms.js';
import { sendEmailAlert } from '../services/email.js';

const r = Router();
const nowIso = () => new Date().toISOString();
const vTitle = (v) => (v ? `${v.year} ${v.make} ${v.model}` : 'your vehicle');


/** Where each kind of seller reads enquiries. */
export const inboxPath = (role, id) => `${role === 'agent' ? '/agent/listings?tab=enquiries&c=' : role === 'dealer' ? '/dealer/enquiries?c=' : '/seller/enquiries?c='}${id}`;
const buyerPath = (e) => (e.buyerId ? `/buyer/messages?c=${e.id || e._id}` : `/messages/${e.id || e._id}?key=${conversationKey(e.id || e._id)}`);

/** Which side of the conversation the caller is on: 'seller' | 'buyer' | 'admin', or null. */
function sideOf(e, req, key) {
  const u = req.user;
  if (u && u.id === e.sellerId) return 'seller';
  if (u && e.buyerId && u.id === e.buyerId) return 'buyer';
  if (keyOk(e.id, key)) return 'buyer';
  if (u?.role === 'admin' && (adminCan(req, 'support.manage') || adminCan(req, 'listings.view'))) return 'admin';
  return null;
}

/** Send the latest conversation to everyone who has it open. */
function broadcast(e, event, extra = {}) {
  const view = enquiryView(e);
  publish([toUser(e.sellerId), toUser(e.buyerId), `enq:${e.id}`], event, { enquiry: view, ...extra });
  return view;
}

/** Contact a seller about a live listing. Guests can send enquiries too. */
r.post(
  '/',
  formLimiter,
  ah(async (req, res) => {
    const d = parse(
      z.object({
        vehicleId: z.string(),
        buyerName: z.string().trim().min(2, 'Enter your name').max(80),
        buyerPhone: z.string().trim().min(1).max(24),
        buyerEmail: z.string().trim().email().or(z.literal('')).optional(),
        message: z.string().trim().min(1, 'Write a message').max(2000),
        channel: z.enum(['form', 'chat', 'call', 'whatsapp']).optional(),
      }),
      req.body,
    );
    const v = await Vehicle.findById(d.vehicleId).lean();
    if (!v || v.status !== 'live') throw badRequest("This vehicle isn't available any more.");
    if (req.user && req.user.id === v.sellerId) throw badRequest("You can't send an enquiry about your own listing.");
    const at = nowIso();
    const id = uid('e');
    const e = await Enquiry.create({
      _id: id,
      ...d,
      buyerEmail: d.buyerEmail || '',
      channel: d.channel || 'form',
      sellerId: v.sellerId,
      buyerId: req.user?.role === 'buyer' ? req.user.id : null,
      status: 'new',
      createdAt: at,
      messages: [{ id: uid('m'), from: 'buyer', text: d.message, at }],
      readAt: { buyer: at },
      lastMessageAt: at,
      lastSellerSmsAt: at, // the enquiry alert below counts as the first SMS
    });
    const seller = await User.findById(v.sellerId).lean();
    const link = inboxPath(v.sellerRole || seller?.role, id);
    const view = broadcast(e, 'enquiry');
    await notify({ recipientId: v.sellerId, audience: 'seller', kind: 'enquiry', title: `New enquiry: ${vTitle(v)}`, body: `${d.buyerName}: ${d.message.slice(0, 140)}`, link, refId: id, groupKey: `enq:${id}` });
    alertUser(seller, {
      sms: `AutoDealer: ${d.buyerName} asked about your ${vTitle(v)}: "${d.message.slice(0, 90)}" Reply: ${webLink(link)}`,
      email: { subject: `New enquiry: ${vTitle(v)}`, heading: `${d.buyerName} is interested in your ${vTitle(v)}`, lines: [d.message, `Phone: ${d.buyerPhone}`], button: { label: 'Reply now', url: webLink(link) } },
    });
    // The access key lets a guest come back to this conversation. It is only returned here.
    res.status(201).json({ enquiry: view, accessKey: conversationKey(id), conversationPath: buyerPath(e) });
  }),
);

/** One conversation, with the listing and seller. For the seller, the buyer (signed in or with the key) and admins. */
r.get(
  '/:id',
  ah(async (req, res) => {
    const e = await Enquiry.findById(req.params.id);
    if (!e) throw notFound('Conversation not found.');
    const side = sideOf(e, req, req.query.key);
    if (!side) throw forbidden('This conversation is private.');
    const [v, seller] = await Promise.all([Vehicle.findById(e.vehicleId).lean(), User.findById(e.sellerId).lean()]);
    res.json({ enquiry: enquiryView(e), side, vehicle: v ? publicVehicle(v) : null, seller: seller ? publicUser(seller) : null });
  }),
);

/** Send a message in a conversation. */
r.post(
  '/:id/messages',
  messageLimiter,
  ah(async (req, res) => {
    const { text, key } = parse(z.object({ text: z.string().trim().min(1, 'Write a message').max(2000, 'Keep messages under 2,000 characters'), key: z.string().optional() }), req.body);
    const e = await Enquiry.findById(req.params.id);
    if (!e) throw notFound('Conversation not found.');
    const side = sideOf(e, req, key);
    if (!side || side === 'admin') throw forbidden('Only the buyer and the seller can write in this conversation.');
    if (side === 'seller' && !memberCan(req, 'enquiries.respond')) throw forbidden("The account owner hasn't given you access to enquiries.");
    if (['spam'].includes(e.status)) throw badRequest('This conversation is closed.');
    const at = nowIso();
    const message = { id: uid('m'), from: side, text, at };
    // Older enquiries (before chat) only have `message`: start their thread with it.
    const thread = e.messages?.length ? e.messages : [{ id: `${e.id}-0`, from: 'buyer', text: e.message, at: e.createdAt }];
    e.messages = [...thread, message];
    e.readAt = { ...(e.readAt || {}), [side]: at };
    e.lastMessageAt = at;
    if (side === 'seller' && e.status === 'new') e.status = 'contacted';
    e.markModified('messages');
    e.markModified('readAt');

    const v = await Vehicle.findById(e.vehicleId).lean();
    if (side === 'seller') {
      const seller = req.user;
      const name = seller.business || seller.agency || seller.name;
      if (e.buyerId) {
        await notify({ recipientId: e.buyerId, audience: 'buyer', kind: 'message', title: `${name} replied about the ${vTitle(v)}`, body: text.slice(0, 160), link: buyerPath(e), refId: e.id, groupKey: `enq:${e.id}` });
        const buyer = await User.findById(e.buyerId).lean();
        alertUser(buyer, { email: { subject: `Reply from ${name}`, heading: `${name} replied about the ${vTitle(v)}`, lines: [text], button: { label: 'Read and reply', url: webLink(buyerPath(e)) } } });
      } else {
        // Guests have no inbox: text them a link to the conversation (at most every few minutes).
        const quiet = !e.lastGuestSmsAt || Date.now() - new Date(e.lastGuestSmsAt).getTime() > config.sms.throttleMinutes * 60_000;
        if (quiet) {
          e.lastGuestSmsAt = at;
          sendSmsAlert(e.buyerPhone, `AutoDealer: ${name} replied about the ${vTitle(v)}: "${text.slice(0, 80)}" Read and reply: ${webLink(buyerPath(e))}`);
        }
        if (e.buyerEmail) sendEmailAlert(e.buyerEmail, { subject: `Reply from ${name}`, heading: `${name} replied about the ${vTitle(v)}`, lines: [text], button: { label: 'Read and reply', url: webLink(buyerPath(e)) } });
      }
    } else {
      const seller = await User.findById(e.sellerId).lean();
      const link = inboxPath(seller?.role, e.id);
      await notify({ recipientId: e.sellerId, audience: 'seller', kind: 'message', title: `${e.buyerName} about the ${vTitle(v)}`, body: text.slice(0, 160), link, refId: e.id, groupKey: `enq:${e.id}` });
      const quiet = !e.lastSellerSmsAt || Date.now() - new Date(e.lastSellerSmsAt).getTime() > config.sms.throttleMinutes * 60_000;
      if (quiet) {
        e.lastSellerSmsAt = at;
        alertUser(seller, { sms: `AutoDealer: new message from ${e.buyerName} about your ${vTitle(v)}: "${text.slice(0, 80)}" Reply: ${webLink(link)}` });
      }
    }
    await e.save();
    const view = broadcast(e, 'message', { message });
    res.status(201).json({ enquiry: view, message });
  }),
);

/** Mark a conversation read by the caller's side (shows "Seen" to the other side). */
r.post(
  '/:id/read',
  ah(async (req, res) => {
    const e = await Enquiry.findById(req.params.id);
    if (!e) throw notFound('Conversation not found.');
    const side = sideOf(e, req, req.body?.key);
    if (!side || side === 'admin') return res.json({ ok: true });
    const at = nowIso();
    e.readAt = { ...(e.readAt || {}), [side]: at };
    e.markModified('readAt');
    await e.save();
    const me = side === 'seller' ? e.sellerId : e.buyerId;
    if (me) await Notification.updateMany({ recipientId: me, refId: e.id, readAt: { $exists: false } }, { readAt: at });
    const view = broadcast(e, 'read', { side, at });
    res.json({ enquiry: view });
  }),
);

/** Seller (or admin) updates where a conversation stands. */
r.patch(
  '/:id',
  requireAuth,
  ah(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(['new', 'contacted', 'negotiating', 'closed', 'lost', 'spam']) }), req.body);
    const e = await Enquiry.findById(req.params.id);
    if (!e) throw notFound('Enquiry not found.');
    if (req.user.role === 'admin' ? !adminCan(req, 'support.manage') : e.sellerId !== req.user.id) throw forbidden();
    if (!memberCan(req, 'enquiries.respond')) throw forbidden("The account owner hasn't given you access to enquiries.");
    e.status = status;
    await e.save();
    res.json({ enquiry: enquiryView(e) });
  }),
);

export default r;
