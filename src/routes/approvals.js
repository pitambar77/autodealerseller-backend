// Admin → Approvals: maker-checker requests for refunds, payment adjustments, permanent deletions
// and account suspensions (see services/approvals.js).
import { Router } from 'express';
import { z } from 'zod';
import { Approval } from '../models/index.js';
import { ah, parse } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import { cancelApproval, createApproval, decideApproval } from '../services/approvals.js';
import { clean } from '../services/serialize.js';
import { APPROVAL_TYPES, allows } from '../shared/permissions.js';

const r = Router();
r.use(requireRole('admin'));

/** Requests I made, requests I can decide, and (with full activity history) everything. */
r.get(
  '/',
  ah(async (req, res) => {
    const list = await Approval.find().sort({ requestedAt: -1 }).limit(500).lean();
    const canDecide = (a) => allows(req.perms, APPROVAL_TYPES[a.type]?.approve);
    const seeAll = allows(req.perms, 'audit.view');
    const visible = list.filter((a) => seeAll || a.requestedBy?.id === req.user.id || canDecide(a));
    res.json({
      approvals: visible.map((a) => ({ ...clean(a), mine: a.requestedBy?.id === req.user.id, canDecide: a.status === 'pending' && canDecide(a) && a.requestedBy?.id !== req.user.id })),
    });
  }),
);

const Create = z.object({
  type: z.enum(Object.keys(APPROVAL_TYPES)),
  reason: z.string().trim().max(1000),
  paymentId: z.string().optional(),
  amount: z.coerce.number().optional(),
  kind: z.enum(['mark_paid', 'mark_failed', 'correction']).optional(),
  statementRef: z.string().trim().max(80).optional(),
  entityType: z.enum(['vehicle', 'user']).optional(),
  entityId: z.string().optional(),
  userId: z.string().optional(),
});

r.post(
  '/',
  ah(async (req, res) => {
    const { type, reason, ...data } = parse(Create, req.body);
    const approval = await createApproval(req.user, req.perms, type, data, reason);
    res.status(201).json({ approval });
  }),
);

r.post(
  '/:id/approve',
  ah(async (req, res) => {
    const { note = '' } = parse(z.object({ note: z.string().max(500).optional() }), req.body || {});
    res.json({ approval: await decideApproval(req.user, req.perms, req.params.id, 'approved', note) });
  }),
);

r.post(
  '/:id/reject',
  ah(async (req, res) => {
    const { note = '' } = parse(z.object({ note: z.string().max(500).optional() }), req.body || {});
    res.json({ approval: await decideApproval(req.user, req.perms, req.params.id, 'rejected', note) });
  }),
);

r.post(
  '/:id/cancel',
  ah(async (req, res) => res.json({ approval: await cancelApproval(req.user, req.params.id) })),
);

export default r;
