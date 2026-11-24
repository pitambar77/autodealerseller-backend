// The signed-in user's own profile and buyer tools (saved vehicles, saved searches, preferences).
import { Router } from 'express';
import { z } from 'zod';
import { User, Notification, Vehicle } from '../models/index.js';
import { ah, parse, badRequest, conflict, forbidden } from '../lib/http.js';
import bcrypt from 'bcryptjs';
import { activeSessions, endSessions } from '../services/sessions.js';
import { passwordProblem } from '../services/passwords.js';
import { phoneKey, uid } from '../lib/ids.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { checkOtp } from '../services/otp.js';
import { privateUser } from '../services/serialize.js';
import { removeLogo, saveLogo } from '../services/logos.js';

const r = Router();
r.use(requireAuth);

/** Profile fields a user may change themselves. */
const PROFILE = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    email: z.string().trim().email().or(z.literal('')).optional(),
    city: z.string().trim().max(60).optional(),
    business: z.string().trim().max(120).optional(),
    agency: z.string().trim().max(120).optional(),
    gstin: z.string().trim().max(20).optional(),
    notifications: z.record(z.boolean()).optional(),
    about: z.string().max(1000).optional(),
    hours: z.any().optional(),
    address: z.any().optional(),
    brands: z.array(z.string()).optional(),
    languages: z.array(z.string()).optional(),
    services: z.array(z.string()).optional(),
    website: z.string().max(200).optional(),
    timeline: z.string().optional(),
    needLoan: z.string().optional(),
    exchange: z.string().optional(),
    alerts: z.record(z.boolean()).optional(),
  })
  .strip();

// Only the account owner changes the account's profile, number or closes it (not dealership staff).
const ownerOnly = (req, _res, next) => (req.member ? next(forbidden('Only the account owner can change this.')) : next());

r.patch(
  '/',
  ownerOnly,
  ah(async (req, res) => {
    const patch = parse(PROFILE, req.body);
    Object.assign(req.user, patch);
    await req.user.save();
    res.json({ user: privateUser(req.user) });
  }),
);

/** Change my mobile number. The new number must be verified with a code first (/auth/otp/request). */
r.post(
  '/phone',
  ownerOnly,
  ah(async (req, res) => {
    const { phone, code } = parse(z.object({ phone: z.string().min(8), code: z.string().regex(/^\d{6}$/) }), req.body);
    await checkOtp(phone, code);
    if (await User.exists({ phoneKey: phoneKey(phone), _id: { $ne: req.user.id } })) throw conflict('That number already has an account.');
    Object.assign(req.user, { phone, phoneKey: phoneKey(phone) });
    await req.user.save();
    res.json({ user: privateUser(req.user) });
  }),
);

// ── Sessions (devices signed in to this account)
const mySessionsFilter = (req) => ({ userId: req.user.id, ...(req.member ? { memberId: req.member.id } : { memberId: { $exists: false } }) });

r.get(
  '/sessions',
  ah(async (req, res) => {
    const list = await activeSessions(mySessionsFilter(req));
    res.json({ sessions: list.map((x) => ({ id: x._id, ip: x.ip, userAgent: x.userAgent, createdAt: x.createdAt, lastSeenAt: x.lastSeenAt, current: x._id === req.sessionId })) });
  }),
);

/** Sign out other devices: their sessions end at once; this one stays. */
r.post(
  '/sessions/revoke',
  ah(async (req, res) => {
    const n = await endSessions(mySessionsFilter(req), { by: req.user.id, reason: 'signed_out_elsewhere', except: req.sessionId });
    await audit(req.user, { action: 'Signed out other devices', entityType: req.user.role === 'admin' ? 'staff' : 'user', entityId: req.member?.id || req.user.id, note: `${n} session(s) ended.` });
    res.json({ ok: true, ended: n });
  }),
);

r.delete(
  '/sessions/:id',
  ah(async (req, res) => {
    const n = await endSessions({ ...mySessionsFilter(req), _id: req.params.id }, { by: req.user.id, reason: 'signed_out_elsewhere' });
    res.json({ ok: true, ended: n });
  }),
);

/** Still here: keeps an admin session from timing out while they read a page (the website calls this when there's activity). */
r.post(
  '/ping',
  ah(async (_req, res) => res.json({ ok: true })),
);

/** Sign out (this device). */
r.post(
  '/signout',
  ah(async (req, res) => {
    if (req.sessionId) await endSessions({ _id: req.sessionId }, { by: req.user.id, reason: 'signed_out' });
    res.json({ ok: true });
  }),
);

/** Admin staff: change my password (current password required). Other sessions are signed out. */
r.post(
  '/password',
  ah(async (req, res) => {
    if (req.user.role !== 'admin') throw badRequest('Only admin accounts use a password.');
    const d = parse(z.object({ current: z.string().min(1), password: z.string().min(1) }), req.body);
    const me = await User.findById(req.user.id).select('+passwordHash');
    if (!(await bcrypt.compare(d.current, me.passwordHash || ''))) throw badRequest('Your current password is incorrect.', { fields: { current: 'wrong' } });
    const weak = passwordProblem(d.password, { email: me.email, name: me.name });
    if (weak) throw badRequest(weak, { fields: { password: weak } });
    if (await bcrypt.compare(d.password, me.passwordHash)) throw badRequest('Choose a password different from the current one.', { fields: { password: 'same' } });
    me.set({ passwordHash: await bcrypt.hash(d.password, 12), passwordChangedAt: new Date().toISOString() });
    await me.save();
    const n = await endSessions({ userId: me.id }, { by: me.id, reason: 'password_changed', except: req.sessionId });
    await audit(req.user, { action: 'Changed password', entityType: 'staff', entityId: me.id, note: n ? `${n} other session(s) signed out.` : undefined });
    res.json({ ok: true });
  }),
);

/**
 * Request account closure: listings are hidden at once. Signing in again within 7 days cancels it
 * (see /auth/otp/verify). Run `npm run close-accounts` daily to close accounts after 7 days.
 */
r.post(
  '/close',
  ownerOnly,
  ah(async (req, res) => {
    if (req.user.role === 'admin') throw badRequest('Admin accounts are closed by another admin.');
    req.user.set('closureRequestedAt', new Date().toISOString());
    await req.user.save();
    await Vehicle.updateMany({ sellerId: req.user.id, status: 'live' }, { status: 'suspended', suspendedWithUser: true });
    await audit(req.user, { action: 'Requested account closure', entityType: 'user', entityId: req.user.id });
    res.json({ ok: true });
  }),
);

// ── Buyer tools
const buyerOf = (u) => {
  u.buyer = u.buyer || {};
  u.buyer.saved = u.buyer.saved || [];
  u.buyer.savedSearches = u.buyer.savedSearches || [];
  return u.buyer;
};

/** Save or un-save a vehicle. */
r.post(
  '/saved/:vehicleId/toggle',
  ah(async (req, res) => {
    const b = buyerOf(req.user);
    const id = req.params.vehicleId;
    b.saved = b.saved.includes(id) ? b.saved.filter((x) => x !== id) : [id, ...b.saved].slice(0, 500);
    req.user.markModified('buyer');
    await req.user.save();
    res.json({ saved: b.saved });
  }),
);

/** Merge vehicles saved as a guest into the account after signing in. */
r.post(
  '/saved/merge',
  ah(async (req, res) => {
    const { ids } = parse(z.object({ ids: z.array(z.string()).max(500) }), req.body);
    const b = buyerOf(req.user);
    b.saved = [...new Set([...b.saved, ...ids])].slice(0, 500);
    req.user.markModified('buyer');
    await req.user.save();
    res.json({ saved: b.saved });
  }),
);

r.post(
  '/saved-searches',
  ah(async (req, res) => {
    const { label, query } = parse(z.object({ label: z.string().min(1).max(200), query: z.record(z.any()) }), req.body);
    const b = buyerOf(req.user);
    if (b.savedSearches.length >= 50) throw badRequest('You can keep up to 50 saved searches.');
    const s = { id: uid('ss'), label, query, createdAt: new Date().toISOString() };
    b.savedSearches = [s, ...b.savedSearches];
    req.user.markModified('buyer');
    await req.user.save();
    res.status(201).json({ savedSearch: s, savedSearches: b.savedSearches });
  }),
);

r.delete(
  '/saved-searches/:id',
  ah(async (req, res) => {
    const b = buyerOf(req.user);
    b.savedSearches = b.savedSearches.filter((s) => s.id !== req.params.id);
    req.user.markModified('buyer');
    await req.user.save();
    res.json({ savedSearches: b.savedSearches });
  }),
);

r.patch(
  '/prefs',
  ah(async (req, res) => {
    const prefs = parse(z.record(z.any()), req.body);
    const b = buyerOf(req.user);
    b.prefs = { ...(b.prefs || {}), ...prefs };
    req.user.markModified('buyer');
    await req.user.save();
    res.json({ buyerPrefs: b.prefs });
  }),
);

/** Mark my notifications read (all, or the ids given). */
r.post(
  '/notifications/read',
  ah(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
    const recipientId = req.user.role === 'bank' ? req.user.lenderId : req.user.id;
    await Notification.updateMany({ recipientId, ...(ids ? { _id: { $in: ids } } : {}), readAt: { $exists: false } }, { readAt: new Date().toISOString() });
    res.json({ ok: true });
  }),
);

/** Business logo (dealers and agents; the account owner only, not team members). */
r.put(
  '/logo',
  ownerOnly,
  ah(async (req, res) => {
    if (!['dealer', 'agent'].includes(req.user.role)) throw forbidden('Logos are for dealer and agent accounts.');
    const u = await User.findById(req.user.id);
    const key = await saveLogo(req.body?.imageData, u.logo);
    await User.updateOne({ _id: u._id }, { $set: { logo: key } });
    await audit(req.user, { action: u.logo ? 'Replaced business logo' : 'Added business logo', entityType: 'user', entityId: u.id });
    res.json({ user: privateUser(await User.findById(u._id).lean()) });
  }),
);
r.delete(
  '/logo',
  ownerOnly,
  ah(async (req, res) => {
    const u = await User.findById(req.user.id).lean();
    await removeLogo(u.logo);
    await User.updateOne({ _id: u._id }, { $unset: { logo: 1 } });
    await audit(req.user, { action: 'Removed business logo', entityType: 'user', entityId: u._id });
    res.json({ user: privateUser(await User.findById(u._id).lean()) });
  }),
);

export default r;
