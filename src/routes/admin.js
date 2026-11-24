// Admin console: users, listing moderation, internal notes, platform configuration, admin invites, audit log.
import { Router } from 'express';
import { z } from 'zod';
import { User, Vehicle, Note, Invite, AuditLog } from '../models/index.js';
import { ah, parse, badRequest, notFound } from '../lib/http.js';
import { randomToken, sha256, uid } from '../lib/ids.js';
import { requireRole, requirePermission, adminCan } from '../middleware/auth.js';
import { TRUST_ICONS, MAX_TRUST_INDICATORS } from '../shared/site.js';
import { cleanHeading, headingText } from '../shared/heading.js';
import { audit, diff, verifyAuditChain } from '../services/audit.js';
import { applyUserStatus, createApproval } from '../services/approvals.js';
import { updateConfig, publicConfig, adminConfig } from '../services/settings.js';
import { clean, ownerVehicle, privateUser } from '../services/serialize.js';
import { config as env } from '../config.js';
import { getConfig } from '../services/settings.js';
import { listingChanged, notifyAccount } from '../services/notify.js';
import { vehiclePathOf } from '../services/categories.js';
import { sendSms, smsStatus } from '../services/sms.js';
import { sendEmail, emailHtml, emailStatus, verifyEmail } from '../services/email.js';
import { storageStatus, testStorage, saveDataUrl, removeFile } from '../services/storage.js';
import { realtimeStatus } from '../services/realtime.js';
import { removeLogo, saveLogo } from '../services/logos.js';

const r = Router();
r.use(requireRole('admin'));

// ── Users
/**
 * Reactivate an account (users.manage), or ask to suspend one: suspensions are sensitive, so they
 * become an approval request that another admin with "Approve suspensions" must approve.
 */
/** An admin replaces or removes a dealer's or agent's business logo (e.g. when asked to). */
r.put(
  '/users/:id/logo',
  requirePermission('users.manage'),
  ah(async (req, res) => {
    const u = await User.findById(req.params.id);
    if (!u || !['dealer', 'agent'].includes(u.role)) throw notFound('Dealer or agent not found.');
    const key = await saveLogo(req.body?.imageData, u.logo);
    await User.updateOne({ _id: u._id }, { $set: { logo: key } });
    await audit(req.user, { action: u.logo ? 'Replaced business logo' : 'Added business logo', entityType: 'user', entityId: u.id, note: u.business || u.agency || u.name });
    res.json({ user: privateUser(await User.findById(u._id).lean()) });
  }),
);
r.delete(
  '/users/:id/logo',
  requirePermission('users.manage'),
  ah(async (req, res) => {
    const u = await User.findById(req.params.id).lean();
    if (!u) throw notFound('User not found.');
    await removeLogo(u.logo);
    await User.updateOne({ _id: u._id }, { $unset: { logo: 1 } });
    await audit(req.user, { action: 'Removed business logo', entityType: 'user', entityId: u._id, note: u.business || u.agency || u.name });
    res.json({ user: privateUser(await User.findById(u._id).lean()) });
  }),
);

r.post(
  '/users/:id/status',
  requirePermission('users.manage', 'users.suspend'),
  ah(async (req, res) => {
    const { status, note = '' } = parse(z.object({ status: z.enum(['active', 'suspended']), note: z.string().max(500).optional() }), req.body);
    const u = await User.findById(req.params.id);
    if (!u) throw notFound('User not found.');
    if (u.role === 'admin') throw badRequest('Admin staff are managed in Team & roles.');
    if (status === 'suspended') {
      const approval = await createApproval(req.user, req.perms, 'suspension', { userId: u.id }, note);
      return res.status(202).json({ approval, message: 'Suspension requested. Another authorised admin must approve it before it takes effect.' });
    }
    if (!adminCan(req, 'users.manage')) throw badRequest("Your role can't reactivate accounts.");
    await applyUserStatus(u, status);
    await audit(req.user, { action: 'Reactivated user', entityType: 'user', entityId: u.id, note, changes: { status: ['suspended', 'active'] } });
    const vehicles = await Vehicle.find({ sellerId: u.id }).lean();
    res.json({ user: privateUser(u), vehicles: vehicles.map(ownerVehicle) });
  }),
);

// ── Listing moderation
const MODERATION = {
  flag: [{ verification: 'flagged' }, 'Flagged listing'],
  suspend: [{ status: 'suspended' }, 'Suspended listing'],
  remove: [{ status: 'removed' }, 'Removed listing'],
  restore: [{ status: 'live' }, 'Restored listing'],
  verify: [{ verification: 'verified' }, 'Verified listing'],
  unverify: [{ verification: 'unverified' }, 'Cleared verification'],
  keepBlocked: [{}, 'Confirmed duplicate block'],
  releaseDuplicate: [{ status: 'pending_payment', duplicateOf: [] }, 'Released duplicate block'],
  feature: [{ featured: true }, 'Featured listing'],
  unfeature: [{ featured: false, featuredUntil: null }, 'Stopped featuring listing'],
};

const vName = (v) => `${v.year} ${v.make} ${v.model}`;
const why = (note) => (note ? ` Reason: ${note}` : '');
/** What the seller is told about each moderation action (nothing for internal ones). */
const SELLER_MESSAGE = {
  verify: (v) => ({ title: `Listing verified: ${vName(v)}`, body: 'Our team checked the vehicle details and documents. The listing now shows the "Verified" badge, which buyers trust more.' }),
  unverify: (v, n) => ({ title: `Verification removed: ${vName(v)}`, body: `The "Verified" badge was removed while we re-check the details.${why(n)}` }),
  flag: (v, n) => ({ title: `Listing needs attention: ${vName(v)}`, body: `Please check the vehicle details and documents.${why(n)}`, sms: true }),
  suspend: (v, n) => ({ title: `Listing suspended: ${vName(v)}`, body: `Buyers can't see it for now.${why(n)} Contact support if you have questions.`, sms: true }),
  remove: (v, n) => ({ title: `Listing removed: ${vName(v)}`, body: `It was taken off the marketplace.${why(n)}`, sms: true }),
  restore: (v) => ({ title: `Listing restored: ${vName(v)}`, body: v.status === 'live' ? 'It is live on the marketplace again.' : 'Pay the listing fee to put it live again.' }),
  releaseDuplicate: (v) => ({ title: `Duplicate block released: ${vName(v)}`, body: v.status === 'live' ? 'It is live on the marketplace.' : 'You can now pay the listing fee to publish it.' }),
  feature: (v) => ({ title: `Listing featured: ${vName(v)}`, body: `It shows the "Featured" badge and comes first in search${v.featuredUntil ? ` until ${v.featuredUntil.slice(0, 10)}` : ''}.` }),
};

r.post(
  '/vehicles/:id/moderate',
  requirePermission('listings.moderate'),
  ah(async (req, res) => {
    const { action, note = '' } = parse(z.object({ action: z.enum(Object.keys(MODERATION)), note: z.string().max(1000).optional() }), req.body);
    const v = await Vehicle.findById(req.params.id);
    if (!v) throw notFound('Listing not found.');
    const [patch, label] = MODERATION[action];
    // A restored listing only goes live if it was paid for; otherwise it waits for payment.
    const p = action === 'restore' && v.paymentStatus !== 'paid' ? { status: 'pending_payment' } : { ...patch };
    if (action === 'releaseDuplicate' && v.paymentStatus === 'paid') p.status = 'live';
    if (action === 'feature') {
      if (v.status !== 'live') throw badRequest('Only live listings can be featured.');
      p.featuredUntil = new Date(Date.now() + (Number((await getConfig()).featuredDays) || 7) * 864e5).toISOString();
    }
    const before = v.toObject();
    v.set({ ...p, updatedAt: new Date().toISOString() });
    await v.save();
    vehiclePathOf(v)
      .then((path) => listingChanged(before, v.toObject(), path))
      .catch((e) => console.error('[notify] listing change:', e.message));
    const entry = await audit(req.user, { action: label, entityType: 'listing', entityId: v.id, note, changes: diff(before, v.toObject(), ['status', 'verification', 'featured', 'featuredUntil']) });
    // Tell the seller what happened to their listing (bell, email; SMS when it was taken down).
    const msg = SELLER_MESSAGE[action]?.(v, note);
    if (msg) {
      const owner = await User.findById(v.sellerId, { role: 1 }).lean();
      notifyAccount(v.sellerId, {
        kind: `listing_${action}`,
        title: msg.title,
        body: msg.body,
        link: owner ? `/${owner.role}/listings` : '',
        refId: v.id,
        sms: msg.sms ? `AutoDealer: ${msg.title}. ${msg.body}` : undefined,
      }).catch((e) => console.error('[notify] moderation:', e.message));
    }
    res.json({ vehicle: ownerVehicle(v), audit: clean(entry.toObject()) });
  }),
);

r.post(
  '/vehicles/:id/notes',
  requirePermission('listings.moderate', 'listings.view'),
  ah(async (req, res) => {
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(2000) }), req.body);
    if (!(await Vehicle.exists({ _id: req.params.id }))) throw notFound('Listing not found.');
    const n = await Note.create({ _id: uid('n'), listingId: req.params.id, text, at: new Date().toISOString(), author: req.user.name });
    res.status(201).json({ note: clean(n.toObject()) });
  }),
);

// ── Platform configuration
// Which permission each setting needs.
const CONFIG_PERMS = {
  verificationPortalName: 'config.manage',
  verificationPortalUrl: 'config.manage',
  agentAuthorizationRequired: 'config.manage',
  listingValidityDays: 'config.manage',
  sellerListingLimit: 'config.manage',
  featuredDays: 'config.manage',
  defaultInterestRate: 'finance.settings',
  loanProviders: 'finance.settings',
  paymentGateway: 'system.integrations',
  otpProvider: 'system.integrations',
  email: 'system.integrations',
  security: 'system.security',
  trustIndicators: 'content.manage',
  heroHeading: 'content.manage',
  heroSellButton: 'content.manage',
};
const CONFIG_KEYS = Object.keys(CONFIG_PERMS);

const SELL_ACTIONS = ['smart', 'sell', 'register', 'link'];
/** Validates the home banner's "Sell your car" button settings. */
function cleanSellButton(b) {
  if (!b || typeof b !== 'object') throw badRequest('Send the button settings.');
  const enabled = b.enabled !== false;
  const label = String(b.label ?? '').trim().replace(/\s+/g, ' ');
  const action = SELL_ACTIONS.includes(b.action) ? b.action : 'smart';
  const link = String(b.link ?? '').trim();
  if (enabled && (label.length < 2 || label.length > 24)) throw badRequest('Button text: use 2–24 characters.', { fields: { label: 'length' } });
  if (action === 'link' && !/^\/(?!\/)[\w\-./?=&#%]*$/.test(link) && !/^https:\/\/[^\s]+$/.test(link)) throw badRequest('The button link must be a page on this site (starting with /) or an https:// address.', { fields: { link: 'invalid' } });
  return { enabled, label: label || 'Sell your car', action, link: action === 'link' ? link : '' };
}

/** Validates the home page trust indicators and returns a clean list (throws a 400 with a plain message). */
function cleanTrustIndicators(list) {
  if (!Array.isArray(list)) throw badRequest('Send the trust indicators as a list.');
  if (list.length > MAX_TRUST_INDICATORS) throw badRequest(`Up to ${MAX_TRUST_INDICATORS} trust indicators fit under the banner.`);
  return list.map((t, i) => {
    const text = String(t?.text ?? '').trim().replace(/\s+/g, ' ');
    if (text.length < 2 || text.length > 40) throw badRequest(`Indicator ${i + 1}: use 2–40 characters.`, { fields: { [`trust.${i}`]: 'length' } });
    const link = String(t?.link ?? '').trim();
    if (link && !/^\/(?!\/)[\w\-./?=&#%]*$/.test(link) && !/^https:\/\/[^\s]+$/.test(link)) throw badRequest(`Indicator ${i + 1}: the link must be a page on this site (starting with /) or an https:// address.`);
    return {
      id: /^ti_[\w-]{1,40}$/.test(t?.id || '') ? t.id : `ti_${Date.now().toString(36)}${i}`,
      text,
      icon: TRUST_ICONS.includes(t?.icon) ? t.icon : 'badge-check',
      link,
      enabled: t?.enabled !== false,
    };
  });
}
r.patch(
  '/config',
  requirePermission(...new Set(Object.values(CONFIG_PERMS))),
  ah(async (req, res) => {
    const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => CONFIG_KEYS.includes(k)));
    if (!Object.keys(patch).length) throw badRequest('Nothing to update.');
    const denied = Object.keys(patch).filter((k) => !adminCan(req, CONFIG_PERMS[k]));
    if (denied.length) throw badRequest(`Your admin role can't change: ${denied.join(', ')}.`);
    if (patch.security) {
      const sec = patch.security;
      const n = (k, lo, hi) => sec[k] === undefined || (Number.isInteger(Number(sec[k])) && Number(sec[k]) >= lo && Number(sec[k]) <= hi);
      if (!n('adminIdleMinutes', 5, 240) || !n('adminSessionHours', 1, 72) || !n('maxFailedLogins', 3, 20) || !n('lockMinutes', 5, 1440)) throw badRequest('Idle sign-out 5–240 minutes, session length 1–72 hours, 3–20 failed attempts, lock 5–1440 minutes.');
      const current = (await getConfig()).security;
      patch.security = { ...current, ...Object.fromEntries(Object.entries(sec).map(([k, v]) => [k, typeof v === 'boolean' ? v : Number(v)])) };
      if (!adminCan(req, 'staff.manage') && patch.security.adminTwoFactorRequired === false) throw badRequest('Only the Managing Director can turn off required 2-step verification.');
    }
    if (patch.trustIndicators !== undefined) patch.trustIndicators = cleanTrustIndicators(patch.trustIndicators);
    if (patch.heroHeading !== undefined) {
      const h = cleanHeading(patch.heroHeading, { required: true });
      if (h.error) throw badRequest(h.error, { fields: { heroHeading: h.error } });
      patch.heroHeading = h.segments;
    }
    if (patch.heroSellButton !== undefined) patch.heroSellButton = cleanSellButton(patch.heroSellButton);
    if (patch.verificationPortalUrl && !/^https:\/\//.test(patch.verificationPortalUrl)) throw badRequest('The portal address must start with https://');
    if (patch.listingValidityDays !== undefined && !(Number(patch.listingValidityDays) >= 7 && Number(patch.listingValidityDays) <= 365)) throw badRequest('Listing validity must be 7–365 days.');
    if (patch.sellerListingLimit !== undefined && !(Number.isInteger(Number(patch.sellerListingLimit)) && Number(patch.sellerListingLimit) >= 0 && Number(patch.sellerListingLimit) <= 500)) throw badRequest('The private seller limit must be 0 (no limit) to 500.');
    if (patch.featuredDays !== undefined && !(Number(patch.featuredDays) >= 1 && Number(patch.featuredDays) <= 90)) throw badRequest('Featured listings must last 1–90 days.');
    ['sellerListingLimit', 'featuredDays', 'listingValidityDays'].forEach((k) => patch[k] !== undefined && (patch[k] = Number(patch[k])));
    const before = await getConfig();
    const value = await updateConfig(patch);
    const entry = await audit(req.user, { action: 'Updated platform configuration', entityType: 'config', entityId: Object.keys(patch).join(', '), changes: diff(before, value, Object.keys(patch).filter((k) => !['loanProviders', 'trustIndicators', 'heroHeading', 'heroSellButton'].includes(k))), note: [patch.trustIndicators && `Trust indicators: ${patch.trustIndicators.map((t) => `${t.text}${t.enabled ? '' : ' (off)'}`).join(' · ') || 'none'}`, patch.heroHeading && `Banner heading: ${headingText(patch.heroHeading).replace(/\n/g, ' / ')}`, patch.heroSellButton && `Sell button: ${patch.heroSellButton.enabled ? `“${patch.heroSellButton.label}” → ${patch.heroSellButton.action === 'link' ? patch.heroSellButton.link : patch.heroSellButton.action}` : 'hidden'}`].filter(Boolean).join(' · ') || undefined });
    res.json({ config: adminConfig(value), audit: clean(entry.toObject()) });
  }),
);

// ── City photos for the dealer directory (replace the default photo of any city)
r.post(
  '/cities/:city/image',
  requirePermission('content.manage'),
  ah(async (req, res) => {
    const city = String(req.params.city || '').trim();
    if (!city || city.length > 60) throw badRequest('Choose a city.');
    const { imageData } = parse(z.object({ imageData: z.string().nullable() }), req.body);
    const current = await getConfig();
    const images = { ...(current.cityImages || {}) };
    const old = images[city];
    if (imageData) images[city] = await saveDataUrl(imageData, 'photos', ['image/jpeg', 'image/png', 'image/webp']);
    else delete images[city];
    if (old && old !== images[city] && !/^(https?:|\/)/.test(old)) removeFile(old);
    const value = await updateConfig({ cityImages: images });
    await audit(req.user, { action: imageData ? 'Updated city photo' : 'Reset city photo', entityType: 'config', entityId: city, note: imageData ? 'New photo uploaded.' : 'Back to the default photo.' });
    res.json({ config: adminConfig(value) });
  }),
);

// ── Connected services (set in the API's .env; see SETUP.md). Read-only status and test messages.
r.get(
  '/integrations',
  requirePermission('system.integrations'),
  ah(async (_req, res) => {
    res.json({
      storage: storageStatus(),
      sms: smsStatus(),
      email: emailStatus(),
      live: realtimeStatus(),
      payments: { provider: env.payments.provider },
      vehicleLookup: { provider: (process.env.VEHICLE_LOOKUP_PROVIDER || 'none').toLowerCase() },
    });
  }),
);

r.post(
  '/integrations/test',
  requirePermission('system.integrations'),
  ah(async (req, res) => {
    const { service, to = '' } = parse(z.object({ service: z.enum(['sms', 'email', 'storage']), to: z.string().trim().max(120).optional() }), req.body);
    try {
      if (service === 'sms') {
        if (!/^\+?\d[\d\s-]{7,}$/.test(to)) throw new Error('Enter a phone number in international format, e.g. +255712345678.');
        const real = await sendSms(to, 'AutoDealer test: SMS is set up correctly.');
        return res.json({ ok: true, message: real ? `Test SMS sent to ${to} with ${env.sms.provider}.` : 'SMS_PROVIDER is "console": the message was printed in the API log, not sent.' });
      }
      if (service === 'email') {
        if (!/^\S+@\S+\.\S+$/.test(to)) throw new Error('Enter an email address.');
        await verifyEmail();
        const real = await sendEmail({ to, subject: 'AutoDealer test email', text: 'Email is set up correctly.', html: emailHtml({ heading: 'Email is set up correctly', lines: ['This test was sent from Admin → Configuration.'] }) });
        return res.json({ ok: true, message: real ? `Test email sent to ${to}.` : 'EMAIL_PROVIDER is "console": the email was printed in the API log, not sent.' });
      }
      const t = await testStorage();
      return res.json({ ok: true, message: `Uploaded and deleted a test image (${storageStatus().driver}).`, url: t.url });
    } catch (e) {
      throw badRequest(e.message || 'The test failed.');
    }
  }),
);

// ── Activity log (audit trail). Staff with "Full activity history" see everyone; others see their own.
r.get(
  '/audit',
  ah(async (req, res) => {
    const q = {};
    const all = adminCan(req, 'audit.view');
    if (!all) q.actorId = req.user.id;
    else if (req.query.actorId) q.actorId = String(req.query.actorId);
    if (req.query.entityType) q.entityType = String(req.query.entityType);
    if (req.query.entityId) q.entityId = String(req.query.entityId);
    if (req.query.from || req.query.to) q.at = { ...(req.query.from ? { $gte: String(req.query.from) } : {}), ...(req.query.to ? { $lte: `${req.query.to}T23:59:59.999Z` } : {}) };
    const limit = Math.min(Number(req.query.limit) || 500, 5000);
    let list = (await AuditLog.find(q).sort({ at: -1 }).limit(limit).lean()).map(clean);
    if (req.query.q) {
      const needle = String(req.query.q).toLowerCase();
      list = list.filter((e) => `${e.actor} ${e.action} ${e.entityId} ${e.note} ${e.ip || ''}`.toLowerCase().includes(needle));
    }
    res.json({ audit: list, scope: all ? 'all' : 'own' });
  }),
);

/** Check that no audit entry was changed or removed since it was written. */
r.get(
  '/audit/verify',
  requirePermission('audit.view', 'system.security'),
  ah(async (req, res) => {
    const result = await verifyAuditChain();
    await audit(req.user, { action: 'Checked audit log integrity', entityType: 'audit', entityId: 'chain', note: result.ok ? `Intact: ${result.checked} entries.` : result.problem });
    res.json(result);
  }),
);

export default r;
