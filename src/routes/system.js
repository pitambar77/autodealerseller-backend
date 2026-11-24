// Bootstrap, health and demo helpers.
import { Router } from 'express';
import { ah, notFound } from '../lib/http.js';
import { buildBootstrap } from '../services/bootstrap.js';
import { requirePermission } from '../middleware/auth.js';
import { config } from '../config.js';
import { seedDatabase } from '../services/seedDb.js';
import { connectionCount } from '../services/realtime.js';
import { OFFER_EXPIRY_VERSION } from '../services/offers.js';

const r = Router();

/** Everything the signed-in visitor's pages need, in one request. */
r.get(
  '/bootstrap',
  ah(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ...(await buildBootstrap(req.user, { perms: req.perms, member: req.member, authError: req.authError })), demo: { login: config.allowDemoLogin, reset: config.allowDemoReset, mockPayments: config.payments.provider === 'mock' } });
  }),
);

r.get('/health', (_req, res) => res.json({ ok: true, at: new Date().toISOString(), liveConnections: connectionCount(), offerExpiry: OFFER_EXPIRY_VERSION }));

/** Development only (ALLOW_DEMO_RESET=true): put the demo data back. Admins only, or anyone when demo login is on. */
r.post(
  '/demo/reset',
  (req, res, next) => (config.allowDemoLogin ? next() : requirePermission('staff.manage')(req, res, next)),
  ah(async (_req, res) => {
    if (!config.allowDemoReset) throw notFound();
    const out = await seedDatabase({ drop: true });
    res.json({ ok: true, counts: out.counts });
  }),
);

export default r;
