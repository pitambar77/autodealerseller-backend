// Listing-fee payments. PAYMENT_PROVIDER=mock simulates the gateway: the checkout page picks the
// outcome (success / failed / cancelled / pending) so every path can be tested.
//
// To connect a real gateway (Selcom, Pesapal, M-Pesa, DPO, Flutterwave, Stripe, Razorpay…):
//   1. In startCheckout(), create the order with the gateway and return { status: 'pending', redirectUrl }.
//   2. Point the gateway's webhook at POST /api/payments/webhook and verify its signature in routes/payments.js.
//   3. The webhook calls settlePayment(txnId, 'success' | 'failed') — the same function the mock uses,
//      so publishing rules (pay before live) stay in one place.
import { config } from '../config.js';
import { Payment, User, Vehicle } from '../models/index.js';
import { ALL_PLANS, BOOST_PLAN } from '../shared/site.js';
import { getConfig } from './settings.js';
import { listingChanged, notifyAdmins } from './notify.js';
import { vehiclePathOf } from './categories.js';
import { uniqueNumericId, randomToken } from '../lib/ids.js';
import { badRequest } from '../lib/http.js';
import { audit } from './audit.js';

export const OUTCOMES = ['success', 'failed', 'cancelled', 'pending'];

// ── Listing packs (e.g. Dealer Pro Pack: 10 vehicle credits + 2 featured slots)
// Paying for a pack publishes the listing being paid for with the first credit; the other credits
// publish later listings with no payment ("Publish with a credit" at checkout).
export const CREDIT_METHOD = 'Pack credit';
const isActive = (p) => new Date(p.expiresAt) > new Date();
const leftOf = (p, kind) => (kind === 'feature' ? (p.featuredTotal || 0) - (p.featuredUsed || []).length : (p.total || 0) - (p.used || []).length);

/** What's left across a user's packs that haven't expired: { listings, featured, expiresAt, packs }. */
export function packSummary(user) {
  const packs = (user?.listingPacks || []).filter(isActive);
  const listings = packs.reduce((n, p) => n + Math.max(0, leftOf(p, 'listing')), 0);
  const featured = packs.reduce((n, p) => n + Math.max(0, leftOf(p, 'feature')), 0);
  const soonest = packs.filter((p) => leftOf(p, 'listing') > 0 || leftOf(p, 'feature') > 0).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))[0];
  return { listings, featured, expiresAt: soonest?.expiresAt || null, packs: packs.length };
}

/** Add a pack to the buyer's account after its payment succeeds; the paid-for listing uses the first credit. */
async function grantPack(txn, plan, listingId) {
  const now = new Date();
  const pack = {
    id: txn.id,
    planId: plan.id,
    name: plan.name,
    total: plan.vehicles,
    used: [listingId],
    featuredTotal: plan.featuredSlots || 0,
    featuredUsed: [],
    boughtAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (plan.creditDays || 180) * 864e5).toISOString(),
  };
  await User.updateOne({ _id: txn.userId }, { $push: { listingPacks: pack }, $inc: { packsVersion: 1 } }); // the version lets useCredit detect changes
  return pack;
}

/**
 * Publish a listing (kind 'listing') or feature a live one (kind 'feature') with a pack credit.
 * Records a zero-amount payment so it shows in payment history like any other.
 */
export async function useCredit({ user, vehicle, kind }) {
  const u = await User.findById(user.id).lean();
  const packs = (u.listingPacks || []).filter((p) => isActive(p) && leftOf(p, kind) > 0).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  const pack = packs[0];
  if (!pack) throw badRequest(kind === 'feature' ? 'You have no featured slots left. Pay for the boost instead.' : 'You have no listing credits left. Choose a plan and pay instead.');
  if (kind === 'feature' && vehicle.status !== 'live') throw badRequest('A listing can be featured once it is live.');
  const field = kind === 'feature' ? 'featuredUsed' : 'used';
  u.listingPacks = (u.listingPacks || []).map((p) => (p.id === pack.id ? { ...p, [field]: [...(p[field] || []), vehicle.id] } : p));
  // Only spend the credit if the packs haven't changed since we read them (two tabs publishing at once,
  // or a new pack bought meanwhile): every change to listingPacks bumps packsVersion.
  const version = u.packsVersion || 0;
  const unchanged = version ? { packsVersion: version } : { packsVersion: { $exists: false } };
  const done = await User.updateOne({ _id: user.id, ...unchanged }, { $set: { listingPacks: u.listingPacks, packsVersion: version + 1 } });
  if (!done.modifiedCount) throw badRequest('That credit was just used. Refresh the page and try again.');
  const txn = await Payment.create({
    _id: await uniqueNumericId(Payment, 'TXN', 270000, 999999),
    gatewayRef: `credit_${pack.id}`,
    userId: user.id,
    listingId: vehicle.id,
    planId: kind === 'feature' ? BOOST_PLAN.id : pack.planId,
    packId: pack.id,
    amount: 0,
    gst: 0,
    total: 0,
    method: CREDIT_METHOD,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  const result = await settlePayment(txn.id, 'success', user);
  return { ...result, user: u };
}

export async function startCheckout({ user, vehicle, planId, method, outcome }) {
  const plan = ALL_PLANS.find((p) => p.id === planId);
  if (!plan) throw badRequest('Choose a listing plan.');
  if (!(plan.roles || [plan.role]).includes(user.role)) throw badRequest('That plan is for a different account type.');
  if (plan.kind === 'boost' && vehicle.status !== 'live') throw badRequest('A listing can be featured once it is live.');
  if (plan.kind !== 'boost' && vehicle.status === 'live' && vehicle.paymentStatus === 'paid') throw badRequest('This listing is already paid and live.');
  if (config.payments.provider !== 'mock') {
    throw badRequest('Connect your payment gateway in services/payments.js (startCheckout).');
  }
  const result = OUTCOMES.includes(outcome) ? outcome : 'success';
  const vat = Math.round(plan.price * config.payments.vatRate);
  const txn = await Payment.create({
    _id: await uniqueNumericId(Payment, 'TXN', 270000, 999999),
    gatewayRef: `pay_mock_${randomToken(8)}`,
    userId: user.id,
    listingId: vehicle.id,
    planId,
    amount: plan.price,
    gst: vat,
    total: plan.price + vat,
    method,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  return settlePayment(txn.id, result, user);
}

/**
 * Apply a gateway result. Only `success` publishes a listing — failed, cancelled and pending never do.
 */
export async function settlePayment(txnId, outcome, actor = null) {
  const txn = await Payment.findById(txnId);
  if (!txn) throw badRequest('Payment not found.');
  const was = txn.status;
  txn.status = outcome;
  txn.set('settledAt', new Date().toISOString());
  await txn.save();
  // Every change of a payment's status is in the audit trail (who/what settled it, and when).
  await audit(actor, { action: `Payment ${outcome === 'success' ? 'succeeded' : outcome}`, entityType: 'payment', entityId: txn.id, note: `TSh ${Number(txn.total || 0).toLocaleString('en-GB')} · ${txn.method || '—'} · ${txn.gatewayRef || ''}`.trim(), changes: { status: [was, outcome] } });
  const v = await Vehicle.findById(txn.listingId);
  const before = v?.toObject();
  if (v) {
    const plan = ALL_PLANS.find((p) => p.id === txn.planId);
    if (outcome === 'success' && plan?.kind === 'boost') {
      // Feature an already-live listing; buying again extends the current boost.
      const days = Number((await getConfig()).featuredDays) || 7;
      const from = v.featured && v.featuredUntil && new Date(v.featuredUntil) > new Date() ? new Date(v.featuredUntil) : new Date();
      Object.assign(v, { featured: true, featuredUntil: new Date(from.getTime() + days * 864e5).toISOString(), updatedAt: new Date().toISOString() });
      await v.save();
      await audit(actor, { action: 'Featured listing', entityType: 'listing', entityId: v.id, note: `${txn.method === CREDIT_METHOD ? 'Featured slot from a pack' : 'Payment'} ${txn.id}: featured until ${v.featuredUntil.slice(0, 10)}.` });
    } else if (outcome === 'success') {
      const now = new Date();
      Object.assign(v, {
        paymentStatus: 'paid',
        planId: txn.planId,
        status: 'live',
        publishedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + (plan?.validityDays || 60) * 864e5).toISOString(),
        updatedAt: now.toISOString(),
      });
      if (plan?.featuredDays) Object.assign(v, { featured: true, featuredUntil: new Date(now.getTime() + plan.featuredDays * 864e5).toISOString() });
      await v.save();
      const credit = txn.method === CREDIT_METHOD;
      // Buying a pack: this listing uses the first credit, the rest wait on the account.
      if (!credit && plan?.vehicles > 1) await grantPack(txn, plan, v.id);
      notifyAdmins({ perm: 'listings.moderate', kind: 'listing', title: `New listing to verify: ${v.year} ${v.make} ${v.model}`, body: `${v.regNumber || ''} · ${plan?.name || 'Listing'}${credit ? ' (pack credit)' : ''}`, link: `/admin/listings/${v.id}`, refId: v.id }).catch((e) => console.error('[notify] new listing:', e.message));
      await audit(actor, { action: 'Published listing', entityType: 'listing', entityId: v.id, note: credit ? `Published with a ${plan?.name || 'pack'} credit (${txn.id}).` : `Payment ${txn.id} succeeded — auto-published, awaiting document verification.` });
    } else if (plan?.kind !== 'boost') {
      v.paymentStatus = outcome;
      if (v.status !== 'live') v.status = 'pending_payment';
      await v.save();
    }
  }
  if (v && outcome === 'success') {
    vehiclePathOf(v)
      .then((path) => listingChanged(before, v.toObject(), path))
      .catch((e) => console.error('[notify] listing change:', e.message));
  }
  return { txn, vehicle: v };
}

/** Switch off boosts that have run out (runs every few minutes from server.js). */
export async function expireFeatured() {
  const r = await Vehicle.updateMany({ featured: true, featuredUntil: { $lt: new Date().toISOString() } }, { $set: { featured: false } });
  return r.modifiedCount || 0;
}
