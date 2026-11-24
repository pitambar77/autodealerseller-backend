// Loan calculator "Make an enquiry": one submission notifies the selling dealer and the chosen partner bank.
import { Router } from 'express';
import { z } from 'zod';
import { Category, Enquiry, Referral, Notification, Vehicle, User } from '../models/index.js';
import { checkEligibility } from '../shared/lenderCriteria.js';
import { ah, parse, badRequest, forbidden, notFound } from '../lib/http.js';
import { randomToken, sha256, uniqueNumericId } from '../lib/ids.js';
import { formLimiter } from '../middleware/limits.js';
import { buildFinanceRecords } from '../shared/finance.js';
import { getConfig } from '../services/settings.js';
import { sendSmsAlert } from '../services/sms.js';
import { audit } from '../services/audit.js';
import { adminCan } from '../middleware/auth.js';
import { clean, publicUser, publicVehicle } from '../services/serialize.js';
import { bankInfo } from '../shared/partnerBanks.js';

const r = Router();

r.post(
  '/',
  formLimiter,
  ah(async (req, res) => {
    const d = parse(
      z.object({
        vehicleId: z.string(),
        lenderId: z.string(),
        price: z.number().positive(),
        downPayment: z.number().min(0),
        ratePct: z.number().min(0.1).max(60),
        months: z.number().int().min(6).max(96),
        buyerName: z.string().trim().min(2).max(80),
        buyerPhone: z.string().trim().min(8).max(24),
        buyerEmail: z.string().trim().email().or(z.literal('')).optional(),
        city: z.string().min(1).max(60),
        employment: z.string().min(1).max(60),
        income: z.string().max(60).optional(),
        callTime: z.string().max(40).optional(),
        testDrive: z.boolean().optional(),
        exchange: z.boolean().optional(),
        message: z.string().max(500).optional(),
        consent: z.literal(true, { message: 'Consent is needed to share your details.' }),
      }),
      req.body,
    );
    const v = await Vehicle.findById(d.vehicleId).lean();
    if (!v || v.status !== 'live') throw badRequest("This vehicle isn't available any more.");
    if (d.downPayment >= v.price) throw badRequest('The down payment must be less than the price.');
    const config = await getConfig();
    const lender = config.loanProviders.find((l) => l.id === d.lenderId && l.enabled);
    if (!lender) throw badRequest("That bank isn't taking enquiries right now.");
    // Only send enquiries that meet the lender's own eligibility criteria (set in its lead desk).
    const cats = Object.fromEntries((await Category.find({}, { _id: 1, name: 1 }).lean()).map((c) => [c._id, c.name]));
    const misfit = checkEligibility(lender.criteria, { vehicle: v, price: v.price, downPayment: d.downPayment, months: d.months }, { category: (k) => cats[k] || k });
    if (misfit.length) throw badRequest(`${lender.name} can't take this enquiry: ${misfit.map((m) => m.text.charAt(0).toLowerCase() + m.text.slice(1)).join('; ')}. Choose another partner or change the loan.`, { reasons: misfit });
    const seller = await User.findById(v.sellerId).lean();
    // Price always comes from the listing, never from the browser.
    const state = { vehicles: [{ ...v, id: v._id }], users: seller ? [{ ...seller, id: seller._id }] : [], config };
    const n = (await uniqueNumericId(Enquiry, 'FE-', 1100, 99999)).slice(3);
    const id = `FE-${n}`;
    const at = new Date().toISOString();
    const { enquiry, referral, notifications } = buildFinanceRecords(state, { ...d, price: v.price, buyerId: req.user?.role === 'buyer' ? req.user.id : null }, { id, at });
    const accessKey = randomToken(18);
    await Enquiry.create({ ...enquiry, _id: id, accessKeyHash: sha256(accessKey) });
    await Referral.create({ ...referral, _id: referral.id });
    await Notification.insertMany(notifications.map((x) => ({ ...x, _id: x.id })));
    // Text the dealer (best effort — a failed SMS doesn't fail the enquiry).
    if (seller?.phone) sendSmsAlert(seller.phone, `AutoDealer: new finance enquiry ${id} for your ${v.make} ${v.model}. Open your dashboard to reply.`);
    await audit(req.user, { action: 'Finance enquiry sent', entityType: 'listing', entityId: v._id, note: `${id}: dealer and ${referral.lender} notified (lead ${referral.id}).` });
    res.status(201).json({ enquiry, referral, notifications, accessKey });
  }),
);

/** Confirmation / tracker page. Open to the customer (with the link key), the dealer, the bank and admins. */
r.get(
  '/:id',
  ah(async (req, res) => {
    const e = await Enquiry.findById(req.params.id).select('+accessKeyHash').lean();
    if (!e || e.type !== 'finance') throw notFound('Enquiry not found.');
    const u = req.user;
    const referral = await Referral.findById(e.finance?.referralId).lean();
    const allowed =
      (req.query.key && sha256(req.query.key) === e.accessKeyHash) ||
      (u && ((u.role === 'admin' && (adminCan(req, 'referrals.view') || adminCan(req, 'payments.view'))) || u.id === e.sellerId || (e.buyerId && u.id === e.buyerId) || (u.role === 'bank' && u.lenderId === referral?.lenderId)));
    if (!allowed) throw forbidden('Open this page from the link in your confirmation, or sign in.');
    const [vehicle, seller, notifications] = await Promise.all([Vehicle.findById(e.vehicleId).lean(), User.findById(e.sellerId).lean(), Notification.find({ refId: e._id }).lean()]);
    const config = await getConfig();
    res.json({
      enquiry: clean(e),
      referral: referral && clean(referral),
      notifications: notifications.map(clean),
      vehicle: vehicle && publicVehicle(vehicle),
      seller: seller && publicUser(seller),
      bank: bankInfo(config.loanProviders.find((l) => l.id === e.finance?.lenderId)),
    });
  }),
);

export default r;
