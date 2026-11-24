// Partner lenders' own settings, managed from their lead desk (Partner desk → Eligibility criteria).
// A lender's staff can change only their own lender; admins with finance settings can change any.
import { Router } from 'express';
import { Category } from '../models/index.js';
import { ah, badRequest, forbidden, notFound } from '../lib/http.js';
import { requireAuth, adminCan } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { getConfig, updateConfig, publicConfig, adminConfig } from '../services/settings.js';
import { CONDITIONS } from '../shared/catalog.js';
import { cleanCriteria, describeCriteria, EMPTY_CRITERIA } from '../shared/lenderCriteria.js';
import { removeLogo, saveLogo } from '../services/logos.js';

const r = Router();
r.use(requireAuth);

/** The lender a request may manage, or a 403/404. */
async function lenderFor(req, { write }) {
  const cfg = await getConfig();
  const lender = (cfg.loanProviders || []).find((l) => l.id === req.params.id);
  if (!lender) throw notFound('Lender not found.');
  const u = req.user;
  const own = u.role === 'bank' && u.lenderId === lender.id;
  const admin = u.role === 'admin' && (adminCan(req, 'finance.settings') || (!write && adminCan(req, 'referrals.view')));
  if (!own && !admin) throw forbidden('Only this lender’s staff can change its criteria.');
  return { cfg, lender };
}

r.get(
  '/:id/criteria',
  ah(async (req, res) => {
    const { lender } = await lenderFor(req, { write: false });
    res.json({ criteria: { ...EMPTY_CRITERIA, ...(lender.criteria || {}) } });
  }),
);

r.put(
  '/:id/criteria',
  ah(async (req, res) => {
    const { cfg, lender } = await lenderFor(req, { write: true });
    const categories = (await Category.find({}, { _id: 1 }).lean()).map((c) => c._id);
    const { criteria, error } = cleanCriteria(req.body?.criteria ?? req.body, { categories, conditions: CONDITIONS, cities: (cfg.cities || []).map((c) => c.name) });
    if (error) throw badRequest(error);
    // Keep the details buyers see (funding %, longest loan) in step with the criteria.
    const next = {
      ...lender,
      criteria,
      ...(criteria.minDownPct != null ? { maxFundingPct: 100 - criteria.minDownPct } : {}),
      ...(criteria.maxTenureMonths != null ? { maxMonths: criteria.maxTenureMonths } : {}),
    };
    const value = await updateConfig({ loanProviders: cfg.loanProviders.map((l) => (l.id === lender.id ? next : l)) });
    await audit(req.user, { action: 'Updated lender criteria', entityType: 'config', entityId: lender.id, note: `${lender.name}: ${describeCriteria(criteria)}` });
    res.json({ criteria, config: req.user.role === 'admin' ? adminConfig(value) : publicConfig(value) });
  }),
);

/** The lender's logo, shown in the loan calculator, financing options and its lead desk. */
r.put(
  '/:id/logo',
  ah(async (req, res) => {
    const { cfg, lender } = await lenderFor(req, { write: true });
    const key = await saveLogo(req.body?.imageData, lender.logo);
    const value = await updateConfig({ loanProviders: cfg.loanProviders.map((l) => (l.id === lender.id ? { ...l, logo: key } : l)) });
    await audit(req.user, { action: lender.logo ? 'Replaced lender logo' : 'Added lender logo', entityType: 'config', entityId: lender.id, note: lender.name });
    res.json({ config: req.user.role === 'admin' ? adminConfig(value) : publicConfig(value) });
  }),
);
r.delete(
  '/:id/logo',
  ah(async (req, res) => {
    const { cfg, lender } = await lenderFor(req, { write: true });
    await removeLogo(lender.logo);
    const value = await updateConfig({ loanProviders: cfg.loanProviders.map((l) => (l.id === lender.id ? (({ logo: _l, ...rest }) => rest)(l) : l)) });
    await audit(req.user, { action: 'Removed lender logo', entityType: 'config', entityId: lender.id, note: lender.name });
    res.json({ config: req.user.role === 'admin' ? adminConfig(value) : publicConfig(value) });
  }),
);

export default r;
