// Support page messages. Stored for the support team (GET /api/support for admins) and acknowledged by reference.
import { Router } from 'express';
import { z } from 'zod';
import { SupportTicket } from '../models/index.js';
import { ah, parse, notFound } from '../lib/http.js';
import { audit, diff } from '../services/audit.js';
import { uniqueNumericId } from '../lib/ids.js';
import { formLimiter } from '../middleware/limits.js';
import { requirePermission } from '../middleware/auth.js';
import { clean } from '../services/serialize.js';

const r = Router();

r.post(
  '/',
  formLimiter,
  ah(async (req, res) => {
    const d = parse(
      z.object({
        name: z.string().trim().min(2).max(80),
        phone: z.string().trim().min(6).max(24),
        email: z.string().trim().email(),
        topic: z.string().min(1).max(80),
        listingId: z.string().trim().max(12).optional(),
        message: z.string().trim().min(20).max(1000),
      }),
      req.body,
    );
    const ref = await uniqueNumericId(SupportTicket, 'SR-', 100000, 999999);
    await SupportTicket.create({ _id: ref, ref, ...d, userId: req.user?.id || null, status: 'open', createdAt: new Date().toISOString() });
    res.status(201).json({ ref });
  }),
);

r.get(
  '/',
  requirePermission('support.manage'),
  ah(async (_req, res) => res.json({ tickets: (await SupportTicket.find().sort({ createdAt: -1 }).limit(500).lean()).map(clean) })),
);

/** Operations: update a support request (status, assignee, internal note). */
r.patch(
  '/:id',
  requirePermission('support.manage'),
  ah(async (req, res) => {
    const d = parse(z.object({ status: z.enum(['open', 'in_progress', 'waiting', 'resolved']).optional(), note: z.string().trim().max(1000).optional(), assignTo: z.string().max(80).optional() }), req.body);
    const t = await SupportTicket.findById(req.params.id);
    if (!t) throw notFound('Request not found.');
    const before = { status: t.status, assignTo: t.get('assignTo') };
    if (d.status) t.status = d.status;
    if (d.assignTo !== undefined) t.set('assignTo', d.assignTo);
    if (d.note) t.set('notes', [...(t.get('notes') || []), { at: new Date().toISOString(), by: req.user.name, text: d.note }]);
    t.set('updatedAt', new Date().toISOString());
    await t.save();
    await audit(req.user, { action: 'Updated support request', entityType: 'support', entityId: t.get('ref') || t.id, note: d.note, changes: diff(before, { status: t.status, assignTo: t.get('assignTo') }, ['status', 'assignTo']) });
    res.json({ ticket: clean(t.toObject()) });
  }),
);

export default r;
