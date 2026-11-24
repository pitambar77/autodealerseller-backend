import { Router } from 'express';
import { publish, toUser } from '../services/realtime.js';
import { z } from 'zod';
import { config } from '../config.js';
import { Vehicle, Document, Enquiry, Payment, Handover, User, ACTIVE_STATUSES } from '../models/index.js';
import { ah, parse, badRequest, conflict, forbidden, notFound } from '../lib/http.js';
import { normId, uniqueNumericId } from '../lib/ids.js';
import { requireRole, requireTeamPermission, adminCan, SELLER_ROLES } from '../middleware/auth.js';
import { ownerVehicle, publicUser, publicVehicle } from '../services/serialize.js';
import { lookupVehicle } from '../services/vehicleLookup.js';
import { Category } from '../models/index.js';
import { hiddenCategoryKeys } from '../services/categories.js';
import { SPEC_LABELS } from '../shared/categories.js';
import { listingChanged } from '../services/notify.js';
import { vehiclePathOf } from '../services/categories.js';
import { isOwnFile, keyFromUrl } from '../services/storage.js';

/** Tell buyers who saved a listing (and open pages) that it changed. Runs in the background. */
/** Remove a listing's offer, putting a discounted price back to the original. */
export function endOffer(v) {
  if (v.offer?.originalPrice) v.set('price', v.offer.originalPrice);
  v.set('offer', undefined);
  v.set('updatedAt', now());
}

const announce = (before, after) =>
  vehiclePathOf(after)
    .then((path) => listingChanged(before, after, path))
    .catch((e) => console.error('[notify] listing change:', e.message));

/** The category must exist and be visible (admins may use hidden ones). */
async function checkCategory(key, user) {
  if (!key) return;
  const c = await Category.findById(key).lean();
  if (!c || (!c.enabled && user.role !== 'admin')) throw badRequest('Choose one of the listed vehicle categories.', { fields: { category: 'unknown' } });
}
import { saveDataUrl, removeFile } from '../services/storage.js';
import { getConfig } from '../services/settings.js';
import { audit, diff } from '../services/audit.js';

const r = Router();
const now = () => new Date().toISOString();
const MAX_PHOTOS = 20;

// ───────────── helpers

/** Listings that already use this registration number or VIN (only active listings block). */
export async function findDuplicates({ regNumber, vin }, excludeId) {
  const regKey = normId(regNumber);
  const vinKey = normId(vin);
  if (!regKey && !vinKey) return [];
  const or = [...(regKey ? [{ regKey }] : []), ...(vinKey ? [{ vinKey }] : [])];
  const hits = await Vehicle.find({ _id: { $ne: excludeId || '' }, status: { $in: ACTIVE_STATUSES }, $or: or }).lean();
  return hits.map((v) => ({
    id: v._id,
    matchedOn: [regKey && v.regKey === regKey && 'registration number', vinKey && v.vinKey === vinKey && 'VIN / chassis number'].filter(Boolean),
    title: `${v.year} ${v.make} ${v.model}`,
    city: v.city,
    sellerRole: v.sellerRole,
  }));
}

/** Photos arrive as data URLs (new) or links to files we already stored (kept). */
async function storePhotos(list = []) {
  if (!Array.isArray(list)) throw badRequest('Photos must be a list.');
  if (list.length > MAX_PHOTOS) throw badRequest(`Add up to ${MAX_PHOTOS} photos.`);
  const out = [];
  for (const p of list) {
    if (typeof p !== 'string' || !p) continue;
    if (p.startsWith('data:')) out.push(await saveDataUrl(p, 'photos', ['image/jpeg', 'image/png', 'image/webp', 'image/gif']));
    else if (keyFromUrl(p)) out.push(keyFromUrl(p)); // a photo already stored (local or Cloudinary)
    else if (/^(https?:)?\//.test(p)) out.push(p); // external or site-relative image
  }
  return out;
}

const num = z.union([z.number(), z.string()]).transform((v) => (v === '' || v === null ? null : Number(String(v).replace(/,/g, '')))).nullable();
/** Fields a seller may set. Status, payment, verification and views are server-controlled. */
const ListingInput = z
  .object({
    category: z.string().trim().max(40).optional(),
    make: z.string().trim().max(60).optional(),
    model: z.string().trim().max(80).optional(),
    variant: z.string().trim().max(80).optional(),
    year: num.optional(),
    bodyType: z.string().max(40).optional(),
    color: z.string().max(40).optional(),
    colorHex: z.string().max(12).optional(),
    price: num.optional(),
    mileage: num.optional(),
    condition: z.string().max(40).optional(),
    fuel: z.string().max(20).optional(),
    transmission: z.string().max(20).optional(),
    owners: z.string().max(20).optional(),
    city: z.string().max(60).optional(),
    regNumber: z.string().max(20).optional(),
    vin: z.string().max(20).optional(),
    engineNo: z.string().max(30).optional(),
    insuranceUntil: z.string().nullable().optional(),
    ownerInfo: z.object({ name: z.string().max(80), phone: z.string().max(24), relation: z.string().max(40).optional() }).nullable().optional(),
    modifications: z.string().max(1000).optional(),
    specs: z.record(z.any()).optional(),
    description: z.string().max(4000).optional(),
    photos: z.array(z.string()).optional(),
  })
  .strip();

// Admin staff edit listings only with "Approve, reject and publish listings"; sellers edit their own.
const canEdit = (req, v) => (req.user.role === 'admin' ? adminCan(req, 'listings.moderate') : v.sellerId === req.user.id);

async function loadOwned(req) {
  const v = await Vehicle.findById(req.params.id);
  if (!v) throw notFound('Listing not found.');
  if (!canEdit(req, v)) throw forbidden(req.user.role === 'admin' ? "Your admin role can't edit listings." : 'This listing belongs to another seller.');
  return v;
}

/** Everything a listing needs before it can go to payment. Returns a list of problems. */
async function readinessProblems(v, user) {
  const p = [];
  const cat = await Category.findById(v.category || 'car').lean();
  const hours = cat?.usage === 'hours';
  const need = { make: 'brand', model: 'model', year: 'model year', price: 'price', mileage: hours ? 'hours used' : 'kilometres', fuel: 'fuel', transmission: 'transmission', condition: 'condition', city: 'location', description: 'description' };
  Object.entries(need).forEach(([k, label]) => (v[k] === undefined || v[k] === null || v[k] === '') && p.push(`Add the ${label}.`));
  // The category's own rules (Admin → Vehicle categories).
  if (!cat || (!cat.enabled && user.role !== 'admin')) p.push('Choose one of the listed vehicle categories.');
  if (cat) {
    if (cat.minPrice && Number(v.price) < cat.minPrice) p.push(`The price must be at least TSh ${Number(cat.minPrice).toLocaleString('en-US')}.`);
    if (cat.maxUsage && Number(v.mileage) > cat.maxUsage) p.push(`Check the ${hours ? 'hours' : 'kilometres'}: the most allowed is ${Number(cat.maxUsage).toLocaleString('en-US')}.`);
    (cat.specFields || []).filter((f) => f.required).forEach(({ key }) => {
      const val = v.specs?.[key];
      if (val === undefined || val === null || val === '') p.push(`Add the ${SPEC_LABELS[key] || key}.`);
    });
  }
  if (v.condition !== 'New' && !v.regNumber) p.push('Add the registration number.');
  if (!v.vin) p.push('Add the VIN / chassis number.');
  const cfg = await getConfig();
  const required = user.role === 'dealer' ? ['business_certificate'] : user.role === 'seller' ? ['personal_id'] : ['personal_id', ...(cfg.agentAuthorizationRequired ? ['owner_authorization'] : [])];
  const docs = await Document.find({ userId: v.sellerId, type: { $in: required }, status: { $ne: 'rejected' } }).lean();
  required.filter((t) => !docs.some((d) => d.type === t)).forEach((t) => p.push(`Upload your ${t.replace(/_/g, ' ')} document.`));
  if (user.role === 'agent' && !v.ownerInfo?.name) p.push("Add the registered owner's details.");
  return p;
}

// ───────────── public

/** Search live listings. Query: category, make, model, body, fuel, transmission, city, condition, minPrice, maxPrice, minYear, maxYear, maxKm, q, sort, page, limit */
r.get(
  '/',
  ah(async (req, res) => {
    const q = req.query;
    const f = { status: 'live', category: { $nin: await hiddenCategoryKeys() } };
    if (q.category) f.category = q.category === 'car' ? { $in: ['car', null], $nin: f.category.$nin } : { $eq: q.category, $nin: f.category.$nin };
    ['make', 'model', 'city', 'condition', 'transmission'].forEach((k) => q[k] && (f[k] = String(q[k]))); // plain text only, never an operator object
    if (q.body) f.bodyType = String(q.body);
    if (q.fuel) f.fuel = { $in: String(q.fuel).split(',') };
    if (q.minPrice || q.maxPrice) f.price = { ...(q.minPrice ? { $gte: Number(q.minPrice) } : {}), ...(q.maxPrice ? { $lte: Number(q.maxPrice) } : {}) };
    if (q.minYear || q.maxYear) f.year = { ...(q.minYear ? { $gte: Number(q.minYear) } : {}), ...(q.maxYear ? { $lte: Number(q.maxYear) } : {}) };
    if (q.maxKm) f.mileage = { $lte: Number(q.maxKm) };
    if (q.q) {
      const rx = new RegExp(String(q.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      f.$or = [{ make: rx }, { model: rx }, { variant: rx }, { city: rx }];
    }
    const sort = { 'price-asc': { price: 1 }, 'price-desc': { price: -1 }, 'year-desc': { year: -1 }, 'km-asc': { mileage: 1 } }[q.sort] || { featured: -1, publishedAt: -1 };
    const limit = Math.min(100, Number(q.limit) || 24);
    const page = Math.max(1, Number(q.page) || 1);
    const [items, total] = await Promise.all([Vehicle.find(f).sort(sort).skip((page - 1) * limit).limit(limit).lean(), Vehicle.countDocuments(f)]);
    res.json({ items: items.map(publicVehicle), total, page, limit });
  }),
);

/** Check a registration number / VIN against active listings (sell form and "check before listing"). */
/**
 * Vehicle details from the government registry for the listing form's first step.
 * Sellers review the result before it fills the form. See services/vehicleLookup.js.
 */
r.get(
  '/lookup',
  requireRole(...SELLER_ROLES, 'admin'),
  ah(async (req, res) => {
    const { reg = '', vin = '' } = req.query;
    if (!String(reg).trim() && !String(vin).trim()) throw badRequest('Enter a registration number or VIN to look up.');
    res.json(await lookupVehicle({ regNumber: String(reg).slice(0, 20), vin: String(vin).slice(0, 20) }));
  }),
);

r.post(
  '/duplicate-check',
  ah(async (req, res) => {
    const d = parse(z.object({ regNumber: z.string().max(20).optional(), vin: z.string().max(20).optional(), excludeId: z.string().optional() }), req.body);
    res.json({ duplicates: await findDuplicates(d, d.excludeId) });
  }),
);

r.get(
  '/:id',
  ah(async (req, res) => {
    const v = await Vehicle.findById(req.params.id).lean();
    if (!v) throw notFound('Listing not found.');
    const mine = req.user && ((req.user.role === 'admin' && adminCan(req, 'listings.view')) || req.user.id === v.sellerId);
    if (v.status !== 'live' && !mine) {
      // Sold / expired pages still say what the car was, so similar ones can be suggested.
      if (!['sold', 'expired'].includes(v.status)) throw notFound('Listing not found.');
    }
    // Listings in a hidden category are only visible to their seller and admins.
    if (!mine && (await hiddenCategoryKeys()).includes(v.category)) throw notFound('Listing not found.');
    const seller = await User.findById(v.sellerId).lean();
    return res.json({ vehicle: mine ? ownerVehicle(v) : publicVehicle(v), seller: seller && publicUser(seller) });
  }),
);

/** Count a page view (once per visitor session is enforced by the frontend). */
r.post(
  '/:id/view',
  ah(async (req, res) => {
    const v = await Vehicle.findOneAndUpdate({ _id: req.params.id, status: 'live' }, { $inc: { views: 1 } }, { new: true }).lean();
    // The seller's dashboard and the admin console update the count live.
    if (v) publish([toUser(v.sellerId), 'admins'], 'views', { id: v._id, views: v.views });
    res.json({ ok: true, views: v?.views ?? null });
  }),
);

// ───────────── sellers

/** Create a draft listing. Private sellers can have several (Admin → Configuration can set a limit). */
r.post(
  '/',
  requireRole(...SELLER_ROLES),
  requireTeamPermission('listings.create'),
  ah(async (req, res) => {
    const data = parse(ListingInput, req.body);
    const user = req.user;
    await checkCategory(data.category, user);
    if (user.role === 'seller') {
      const limit = Number((await getConfig()).sellerListingLimit) || 0;
      if (limit && (await Vehicle.countDocuments({ sellerId: user.id, status: { $in: ACTIVE_STATUSES } })) >= limit) {
        throw conflict(`Private seller accounts can have ${limit} active listing${limit === 1 ? '' : 's'} at a time. Mark one as sold or delete it first, or register as a dealer.`);
      }
    }
    const id = await uniqueNumericId(Vehicle, 'v', 2000, 99999);
    const photos = await storePhotos(data.photos);
    const v = await Vehicle.create({
      specs: {},
      ...data,
      photos,
      _id: id,
      category: data.category || 'car',
      regNumber: normId(data.regNumber),
      regKey: normId(data.regNumber),
      vin: (data.vin || '').toUpperCase(),
      vinKey: normId(data.vin),
      sellerId: user.id,
      sellerRole: user.role,
      status: 'draft',
      verification: 'unverified',
      paymentStatus: 'unpaid',
      featured: false,
      views: 0,
      createdAt: now(),
      publishedAt: null,
    });
    await audit(user, { action: 'Created draft listing', entityType: 'listing', entityId: id });
    res.status(201).json({ vehicle: ownerVehicle(v) });
  }),
);

r.patch(
  '/:id',
  requireRole(...SELLER_ROLES, 'admin'),
  requireTeamPermission('listings.edit'),
  ah(async (req, res) => {
    const v = await loadOwned(req);
    if (['removed', 'sold'].includes(v.status) && req.user.role !== 'admin') throw badRequest('This listing can no longer be edited.');
    const data = parse(ListingInput, req.body);
    const before = v.toObject();
    if (data.category && data.category !== v.category) await checkCategory(data.category, req.user);
    if (data.photos) {
      const old = v.photos || [];
      data.photos = await storePhotos(data.photos);
      old.filter((k) => isOwnFile(k) && !data.photos.includes(k)).forEach(removeFile);
    }
    if (data.regNumber !== undefined) {
      data.regNumber = normId(data.regNumber);
      data.regKey = data.regNumber;
    }
    if (data.vin !== undefined) {
      data.vin = data.vin.toUpperCase();
      data.vinKey = normId(data.vin);
    }
    // Changing the registration or VIN of a published listing must not slip past the duplicate rule.
    if (['live', 'pending_payment'].includes(v.status) && (data.regNumber !== undefined || data.vin !== undefined)) {
      const dups = await findDuplicates({ regNumber: data.regNumber ?? v.regNumber, vin: data.vin ?? v.vin }, v.id);
      if (dups.length) throw conflict('Another active listing already uses this registration number or VIN.', { duplicates: dups });
    }
    // A new asking price replaces a running discount (the discount was worked out from the old price).
    const priceChanged = data.price !== undefined && Number(data.price) !== Number(v.price);
    const endsDiscount = priceChanged && !!v.offer?.originalPrice;
    if (endsDiscount) v.set('offer', undefined);
    Object.assign(v, data, { updatedAt: now() });
    v.markModified('specs');
    await v.save();
    announce(before, v.toObject());
    await audit(req.user, {
      action: 'Edited listing',
      entityType: 'listing',
      entityId: v.id,
      note: endsDiscount ? 'The asking price was changed, so the running discount ended.' : undefined,
      changes: diff(before, v.toObject(), ['price', 'mileage', 'city', 'status', 'make', 'model', 'year', 'regNumber']),
    }).catch(() => {});
    res.json({ vehicle: ownerVehicle(v) });
  }),
);

// ───────────── discounts and special offers

const OfferInput = z
  .object({
    /** 'discount' lowers the price (shown with the old price struck through); 'special' is an extra (free service, insurance…). */
    kind: z.enum(['discount', 'special']),
    discountType: z.enum(['amount', 'percent']).optional(),
    value: z.coerce.number().optional(),
    label: z.string().trim().max(40).optional(),
    details: z.string().trim().max(200).optional(),
    endsAt: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.kind === 'discount' && !(d.value > 0)) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Enter the discount' });
    if (d.kind === 'discount' && d.discountType === 'percent' && d.value > 90) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Use at most 90%' });
    if (d.kind === 'special' && !(d.details || '').trim()) ctx.addIssue({ code: 'custom', path: ['details'], message: 'Describe the offer' });
  });

/** Start (or replace) a discount or special offer on one of my listings. */
r.post(
  '/:id/offer',
  requireRole(...SELLER_ROLES),
  requireTeamPermission('listings.edit'),
  ah(async (req, res) => {
    const v = await loadOwned(req);
    if (!['live', 'pending_payment', 'draft'].includes(v.status)) throw badRequest(`A ${v.status.replace(/_/g, ' ')} listing can't have an offer.`);
    const d = parse(OfferInput, req.body);
    let endsAt = null;
    if (d.endsAt) {
      const t = new Date(d.endsAt.length === 10 ? `${d.endsAt}T23:59:59+03:00` : d.endsAt); // a date means the end of that day, Tanzania time
      if (Number.isNaN(t.getTime()) || t <= new Date()) throw badRequest('The end date must be in the future.', { fields: { endsAt: 'past' } });
      if (t - Date.now() > 120 * 864e5) throw badRequest('Offers can run for up to 120 days.', { fields: { endsAt: 'too_far' } });
      endsAt = t.toISOString();
    }
    const before = v.toObject();
    const base = Number(v.offer?.originalPrice || v.price); // replacing an offer starts from the original price
    const offer = { kind: d.kind, label: d.label || '', details: d.details || '', startedAt: now(), endsAt };
    let price = base;
    if (d.kind === 'discount') {
      const cut = d.discountType === 'percent' ? Math.round((base * d.value) / 100) : Math.round(d.value);
      if (cut >= base) throw badRequest('The discount must be less than the price.', { fields: { value: 'too_big' } });
      price = base - cut;
      Object.assign(offer, { discountType: d.discountType || 'amount', value: d.value, originalPrice: base, discount: cut });
      const cat = await Category.findById(v.category || 'car').lean();
      if (cat?.minPrice && price < cat.minPrice) throw badRequest(`After the discount the price must still be at least TSh ${Number(cat.minPrice).toLocaleString('en-US')}.`);
    }
    v.set({ offer, price, updatedAt: now() });
    await v.save();
    announce(before, v.toObject()); // buyers who saved it hear about a price drop
    await audit(req.user, { action: d.kind === 'discount' ? 'Started a discount' : 'Started a special offer', entityType: 'listing', entityId: v.id, note: d.kind === 'discount' ? `${d.discountType === 'percent' ? `${d.value}%` : `TSh ${Math.round(d.value).toLocaleString('en-US')}`} off: TSh ${base.toLocaleString('en-US')} → TSh ${price.toLocaleString('en-US')}${endsAt ? ` until ${endsAt.slice(0, 10)}` : ''}` : offer.details, changes: { price: [before.price, price] } });
    res.json({ vehicle: ownerVehicle(v) });
  }),
);

/** End the offer: a discount goes back to the original price. */
r.delete(
  '/:id/offer',
  requireRole(...SELLER_ROLES),
  requireTeamPermission('listings.edit'),
  ah(async (req, res) => {
    const v = await loadOwned(req);
    if (!v.offer) return res.json({ vehicle: ownerVehicle(v) });
    const before = v.toObject();
    endOffer(v);
    await v.save();
    announce(before, v.toObject());
    await audit(req.user, { action: 'Ended offer', entityType: 'listing', entityId: v.id, changes: { price: [before.price, v.price] } });
    res.json({ vehicle: ownerVehicle(v) });
  }),
);

/**
 * Submit for publishing: checks required details and documents, blocks duplicates, then waits for payment.
 * A listing only goes live when its payment succeeds (see services/payments.js).
 */
r.post(
  '/:id/submit',
  requireRole(...SELLER_ROLES),
  requireTeamPermission('listings.create'),
  ah(async (req, res) => {
    const v = await loadOwned(req);
    if (!['draft', 'pending_payment', 'blocked_duplicate', 'live'].includes(v.status)) throw badRequest(`A ${v.status.replace(/_/g, ' ')} listing can't be submitted.`);
    const problems = await readinessProblems(v, req.user);
    if (problems.length) return res.status(422).json({ ok: false, error: 'This listing is missing some details.', problems, duplicates: [] });
    const duplicates = await findDuplicates(v, v.id);
    if (duplicates.length) {
      Object.assign(v, { status: 'blocked_duplicate', duplicateOf: duplicates.map((d) => d.id) });
      await v.save();
      await audit(null, { action: 'Blocked duplicate', entityType: 'listing', entityId: v.id, note: `Matches ${duplicates.map((d) => d.id).join(', ')} on ${duplicates[0].matchedOn.join(' & ')}.` });
      return res.json({ ok: false, duplicates, vehicle: ownerVehicle(v) });
    }
    if (v.status !== 'live') v.status = v.paymentStatus === 'paid' ? 'live' : 'pending_payment';
    v.duplicateOf = [];
    await v.save();
    return res.json({ ok: true, duplicates: [], vehicle: ownerVehicle(v) });
  }),
);

/** Seller status changes: mark sold, or take a draft back. */
r.post(
  '/:id/status',
  requireRole(...SELLER_ROLES, 'admin'),
  requireTeamPermission('listings.edit'),
  ah(async (req, res) => {
    const v = await loadOwned(req);
    const { status } = parse(z.object({ status: z.enum(['sold', 'draft', 'expired']) }), req.body);
    if (status === 'sold' && !['live', 'pending_payment', 'suspended'].includes(v.status)) throw badRequest('Only listed vehicles can be marked sold.');
    const before = v.toObject();
    v.status = status;
    v.updatedAt = now();
    await v.save();
    announce(before, v.toObject());
    await audit(req.user, { action: `Marked listing ${status}`, entityType: 'listing', entityId: v.id });
    res.json({ vehicle: ownerVehicle(v) });
  }),
);

r.delete(
  '/:id',
  requireRole(...SELLER_ROLES),
  requireTeamPermission('listings.edit'),
  ah(async (req, res) => {
    // Admin staff can't delete directly: Admin → Listings → "Request permanent deletion" (approval needed).
    const v = await loadOwned(req);
    if ((await Payment.exists({ listingId: v.id, status: 'success' })) && v.status === 'live') {
      throw badRequest('Paid live listings can be marked sold, not deleted.');
    }
    (v.photos || []).filter(isOwnFile).forEach(removeFile);
    const before = v.toObject();
    announce(before, { ...before, status: 'removed' });
    await Promise.all([Vehicle.deleteOne({ _id: v.id }), Handover.deleteMany({ vehicleId: v.id }), Enquiry.updateMany({ vehicleId: v.id }, { status: 'closed' })]);
    await audit(req.user, { action: 'Deleted listing', entityType: 'listing', entityId: v.id });
    res.json({ ok: true, id: v.id });
  }),
);

export default r;
