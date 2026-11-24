import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { Payment, User, Vehicle } from '../models/index.js';
import { ah, parse, badRequest, forbidden, notFound, unauthorized } from '../lib/http.js';
import { requireRole, requireAuth, requireTeamPermission, SELLER_ROLES } from '../middleware/auth.js';
import { startCheckout, settlePayment, useCredit, OUTCOMES } from '../services/payments.js';
import { clean, ownerVehicle, privateUser } from '../services/serialize.js';
import { BOOST_PLAN } from '../shared/site.js';

const r = Router();

/** Pay the listing fee. In mock mode `outcome` simulates the gateway result. */
r.post(
  '/checkout',
  requireRole(...SELLER_ROLES),
  requireTeamPermission('listings.publish'),
  ah(async (req, res) => {
    const d = parse(z.object({ listingId: z.string(), planId: z.string(), method: z.string().max(30), outcome: z.enum(OUTCOMES).optional() }), req.body);
    const v = await Vehicle.findById(d.listingId);
    if (!v) throw notFound('Listing not found.');
    if (v.sellerId !== req.user.id) throw forbidden('You can only pay for your own listings.');
    if (v.status === 'blocked_duplicate') throw badRequest('This listing is blocked as a duplicate. It cannot be paid for until an admin releases it.');
    if (d.planId !== BOOST_PLAN.id && !['pending_payment', 'draft', 'expired'].includes(v.status)) {
      throw badRequest(v.status === 'live' ? 'This listing is already paid and live.' : `A ${v.status.replace(/_/g, ' ')} listing can't be paid for.`);
    }
    const { txn, vehicle } = await startCheckout({ user: req.user, vehicle: v, planId: d.planId, method: d.method, outcome: d.outcome });
    res.status(201).json({ payment: clean(txn), vehicle: vehicle && ownerVehicle(vehicle), user: privateUser(await User.findById(req.user.id).lean()) });
  }),
);

/** Publish a listing, or feature a live one, with a credit from a pack the seller already paid for (no payment). */
r.post(
  '/use-credit',
  requireRole(...SELLER_ROLES),
  requireTeamPermission('listings.publish'),
  ah(async (req, res) => {
    const d = parse(z.object({ listingId: z.string(), kind: z.enum(['listing', 'feature']).default('listing') }), req.body);
    const v = await Vehicle.findById(d.listingId);
    if (!v) throw notFound('Listing not found.');
    if (v.sellerId !== req.user.id) throw forbidden('You can only publish your own listings.');
    if (v.status === 'blocked_duplicate') throw badRequest('This listing is blocked as a duplicate. It cannot be published until an admin releases it.');
    if (d.kind === 'listing' && !['pending_payment', 'draft', 'expired'].includes(v.status)) {
      throw badRequest(v.status === 'live' ? 'This listing is already live.' : `A ${v.status.replace(/_/g, ' ')} listing can't be published.`);
    }
    const { txn, vehicle, user } = await useCredit({ user: req.user, vehicle: v, kind: d.kind });
    res.status(201).json({ payment: clean(txn), vehicle: vehicle && ownerVehicle(vehicle), user: privateUser(user) });
  }),
);

/**
 * Settle a pending payment. Admins can always do this; in mock mode the payer can too
 * (the "Simulate bank confirmation" buttons on the payment result page).
 */
r.post(
  '/:id/resolve',
  requireAuth,
  ah(async (req, res) => {
    const { outcome } = parse(z.object({ outcome: z.enum(['success', 'failed']) }), req.body);
    const txn = await Payment.findById(req.params.id);
    if (!txn) throw notFound('Payment not found.');
    const mockPayer = config.payments.provider === 'mock' && txn.userId === req.user.id;
    // Admin staff confirm or fail a payment through a maker-checker request (Admin → Payments → Adjust).
    if (req.user.role === 'admin') throw forbidden('Marking a payment paid or failed needs approval: use "Request adjustment" on the payment.');
    if (!mockPayer) throw forbidden();
    if (txn.status !== 'pending') throw badRequest('Only pending payments can be confirmed.');
    const { txn: t, vehicle } = await settlePayment(txn.id, outcome, req.user);
    res.json({ payment: clean(t), vehicle: vehicle && ownerVehicle(vehicle) });
  }),
);

/**
 * Gateway webhook. Expects JSON { txnId, status: 'success' | 'failed' } and an
 * X-Signature header = HMAC-SHA256(rawBody, PAYMENT_WEBHOOK_SECRET). Adapt to your gateway's format.
 */
r.post(
  '/webhook',
  ah(async (req, res) => {
    if (!config.payments.webhookSecret) throw notFound();
    const expected = crypto.createHmac('sha256', config.payments.webhookSecret).update(req.rawBody || '').digest('hex');
    const got = String(req.headers['x-signature'] || '');
    if (expected.length !== got.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got))) throw unauthorized('Bad signature.');
    const { txnId, status } = req.body || {};
    if (!['success', 'failed'].includes(status)) throw badRequest('Unknown status.');
    await settlePayment(txnId, status, null);
    res.json({ ok: true });
  }),
);

export default r;
