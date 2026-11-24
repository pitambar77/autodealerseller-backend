// Admin → Configuration → Loan providers: add, edit, switch off or remove the banks and lenders
// that buyers can send finance enquiries to from the loan calculator.
//
// A provider's details (interest rate, fees, eligibility, documents, contact desk) are shown to buyers.
// Optionally, a "lead desk" mobile number creates a sign-in for the bank's staff: they sign in with
// that number on the normal sign-in page and land on the bank lead desk (/bank-portal).
import { Router } from 'express';
import { z } from 'zod';
import { User, Enquiry, Referral } from '../models/index.js';
import { ah, parse, badRequest, conflict, notFound } from '../lib/http.js';
import { phoneKey } from '../lib/ids.js';
import { requirePermission } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { getConfig, updateConfig, publicConfig, adminConfig } from '../services/settings.js';
import { isTzMobile, tzPhone } from '../shared/format.js';

const r = Router();
r.use(requirePermission('finance.settings'));

const text = (max) => z.string().trim().max(max);
const list = z.array(z.string().trim().min(1).max(200)).max(15);
const Fields = z.object({
  name: z.string().trim().min(2, 'Enter the lender name').max(80),
  short: text(30).optional(),
  tagline: text(200).optional(),
  rate: z.coerce.number({ message: 'Enter the interest rate' }).min(0).max(60),
  commissionPct: z.coerce.number().min(0).max(10),
  processingFee: text(100).optional(),
  maxFundingPct: z.coerce.number().min(10).max(100).optional(),
  maxMonths: z.coerce.number().int().min(6).max(180).optional(),
  decision: text(120).optional(),
  desk: z.object({ name: text(80).optional(), phone: text(30).optional(), email: z.string().trim().email('Enter a valid email').or(z.literal('')).optional() }).optional(),
  eligibility: list.optional(),
  documents: list.optional(),
  apiKey: text(300).optional(),
  enabled: z.boolean().optional(),
  /** Bank staff sign-in for the lead desk. Empty string removes it. */
  loginPhone: z.string().trim().max(24).optional(),
});

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'lender';
const deskUserId = (id) => `u_bank_${id}`;

/** Providers with their lead-desk sign-in number (kept on the bank's user account). */
async function view(cfg) {
  const users = await User.find({ role: 'bank' }, { _id: 1, phone: 1, lenderId: 1, status: 1 }).lean();
  const logos = Object.fromEntries(adminConfig(cfg).loanProviders.map((l) => [l.id, l.logo]));
  return (cfg.loanProviders || []).map((l) => ({ ...l, logo: logos[l.id], loginPhone: users.find((u) => u.lenderId === l.id && u.status !== 'closed')?.phone || '' }));
}
const reply = async (res, cfg, status = 200, extra = {}) => res.status(status).json({ providers: await view(cfg), config: adminConfig(cfg), ...extra });

/** Create, change or remove the bank staff sign-in for a provider. */
async function setLoginPhone(provider, raw) {
  const id = deskUserId(provider.id);
  if (raw === undefined) return;
  if (!raw) {
    await User.updateOne({ _id: id }, { status: 'closed' });
    return;
  }
  // Any country: "+255 712 345 678", "+91 98610 21001"… (a Tanzanian number may be typed without +255).
  const digits = raw.replace(/\D/g, '');
  const phone = isTzMobile(raw) ? tzPhone(raw) : raw.startsWith('+') && digits.length >= 8 && digits.length <= 15 ? raw.replace(/\s+/g, ' ') : null;
  if (!phone) throw badRequest('Enter the lead desk mobile number with its country code, e.g. +255 712 345 678 or +91 98610 21001.', { fields: { loginPhone: 'Enter a valid mobile number' } });
  const key = phoneKey(phone);
  const taken = await User.findOne({ phoneKey: key, _id: { $ne: id }, status: { $ne: 'closed' } }, { _id: 1, role: 1 }).lean();
  if (taken) throw conflict(`That number already belongs to another ${taken.role} account. Use a different number for the bank's lead desk.`, { fields: { loginPhone: 'Already used by another account' } });
  await User.updateOne(
    { _id: id },
    {
      $set: { role: 'bank', name: `${provider.short || provider.name.split(' ')[0]} lead desk`, phone, phoneKey: key, lenderId: provider.id, status: 'active', docStatus: 'verified' },
      $setOnInsert: { email: '', city: 'Dar es Salaam', registeredAt: new Date().toISOString() },
    },
    { upsert: true },
  );
}

r.get(
  '/',
  ah(async (_req, res) => reply(res, await getConfig())),
);

r.post(
  '/',
  ah(async (req, res) => {
    const d = parse(Fields, req.body);
    const cfg = await getConfig();
    const providers = cfg.loanProviders || [];
    let id = `lp_${slug(d.short || d.name)}`;
    for (let n = 2; providers.some((l) => l.id === id); n += 1) id = `lp_${slug(d.short || d.name)}_${n}`;
    const { loginPhone, ...fields } = d;
    const provider = { id, enabled: true, apiKey: '', ...fields };
    await setLoginPhone(provider, loginPhone);
    const value = await updateConfig({ loanProviders: [...providers, provider] });
    await audit(req.user, { action: 'Added loan provider', entityType: 'config', entityId: id, note: `${provider.name} at ${provider.rate}% p.a., ${provider.commissionPct}% commission.` });
    return reply(res, value, 201, { provider });
  }),
);

r.patch(
  '/:id',
  ah(async (req, res) => {
    const d = parse(Fields.partial(), req.body);
    const cfg = await getConfig();
    const current = (cfg.loanProviders || []).find((l) => l.id === req.params.id);
    if (!current) throw notFound('Loan provider not found.');
    const { loginPhone, ...fields } = d;
    const provider = { ...current, ...fields };
    await setLoginPhone(provider, loginPhone);
    if (fields.name || fields.short) await User.updateOne({ _id: deskUserId(provider.id), status: { $ne: 'closed' } }, { name: `${provider.short || provider.name.split(' ')[0]} lead desk` });
    const value = await updateConfig({ loanProviders: cfg.loanProviders.map((l) => (l.id === provider.id ? provider : l)) });
    const what = 'enabled' in fields && Object.keys(fields).length === 1 ? (fields.enabled ? 'Enabled loan provider' : 'Disabled loan provider') : 'Updated loan provider';
    await audit(req.user, { action: what, entityType: 'config', entityId: provider.id, note: provider.name });
    return reply(res, value, 200, { provider });
  }),
);

/** Remove a provider that never received an enquiry. Providers with enquiries can only be switched off. */
r.delete(
  '/:id',
  ah(async (req, res) => {
    const cfg = await getConfig();
    const current = (cfg.loanProviders || []).find((l) => l.id === req.params.id);
    if (!current) throw notFound('Loan provider not found.');
    const used = (await Referral.countDocuments({ lenderId: current.id })) + (await Enquiry.countDocuments({ 'finance.lenderId': current.id }));
    if (used) throw conflict(`${current.name} has ${used} finance enquir${used === 1 ? 'y' : 'ies'}, so it can't be removed. Switch it off instead: buyers won't see it, and its history stays.`);
    await User.updateOne({ _id: deskUserId(current.id) }, { status: 'closed' });
    const value = await updateConfig({ loanProviders: cfg.loanProviders.filter((l) => l.id !== current.id) });
    await audit(req.user, { action: 'Removed loan provider', entityType: 'config', entityId: current.id, note: current.name });
    return reply(res, value);
  }),
);

export default r;
