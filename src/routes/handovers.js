// Agent handover checklist: one per listing an agent sells for an owner.
import { Router } from 'express';
import { z } from 'zod';
import { Handover, Vehicle } from '../models/index.js';
import { ah, parse, forbidden, notFound } from '../lib/http.js';
import { uid } from '../lib/ids.js';
import { requireRole, requireTeamPermission, adminCan } from '../middleware/auth.js';
import { clean } from '../services/serialize.js';
import { HANDOVER_STEPS } from '../shared/seed.js';

const r = Router();
r.use(requireRole('agent', 'admin'));
// An agent's team member needs the owner's "Handover tracking" permission.
r.use(requireTeamPermission('handovers.manage'));
r.use((req, _res, next) => (req.user.role === 'admin' && !adminCan(req, 'listings.view') ? next(forbidden("Your admin role can't see handovers.")) : next()));

const own = async (req, id) => {
  const h = await Handover.findById(id);
  if (!h) throw notFound('Handover not found.');
  if (req.user.role !== 'admin' && h.agentId !== req.user.id) throw forbidden();
  return h;
};

/** Get (or start) the handover checklist for one of my listings. */
r.post(
  '/ensure',
  ah(async (req, res) => {
    const { vehicleId } = parse(z.object({ vehicleId: z.string() }), req.body);
    const v = await Vehicle.findById(vehicleId).lean();
    if (!v) throw notFound('Listing not found.');
    if (req.user.role !== 'admin' && v.sellerId !== req.user.id) throw forbidden();
    let h = await Handover.findOne({ vehicleId }).lean();
    if (!h) {
      h = {
        _id: uid('h'),
        vehicleId,
        agentId: v.sellerId,
        buyerName: '',
        steps: HANDOVER_STEPS.map((s) => ({ ...s, status: 'pending', updatedAt: null, note: '' })),
      };
      await Handover.create(h);
    }
    res.json({ handover: clean(h) });
  }),
);

r.patch(
  '/:id',
  ah(async (req, res) => {
    const { buyerName } = parse(z.object({ buyerName: z.string().trim().max(80) }), req.body);
    const h = await own(req, req.params.id);
    h.buyerName = buyerName;
    await h.save();
    res.json({ handover: clean(h.toObject()) });
  }),
);

r.patch(
  '/:id/steps/:key',
  ah(async (req, res) => {
    const patch = parse(z.object({ status: z.enum(['pending', 'in_progress', 'completed', 'issue']).optional(), note: z.string().max(500).optional() }), req.body);
    const h = await own(req, req.params.id);
    const steps = h.steps.map((s) => (s.key === req.params.key ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s));
    if (!steps.some((s) => s.key === req.params.key)) throw notFound('No such step.');
    h.steps = steps;
    h.markModified('steps');
    await h.save();
    res.json({ handover: clean(h.toObject()) });
  }),
);

export default r;
