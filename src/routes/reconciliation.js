// Admin → Payments → Reconciliation: match recorded payments with gateway and bank statements.
// Each batch records who reconciled which payments against which statement.
import { Router } from 'express';
import { z } from 'zod';
import { Payment, Reconciliation } from '../models/index.js';
import { ah, parse, badRequest } from '../lib/http.js';
import { uid } from '../lib/ids.js';
import { requirePermission } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { clean } from '../services/serialize.js';

const r = Router();

const day = (iso) => String(iso || '').slice(0, 10);
const net = (p) => (Number(p.adjustedTotal ?? p.total) || 0) - (Number(p.refundedAmount) || 0);

/** Day-by-day totals and the reconciliation batches. */
r.get(
  '/',
  requirePermission('payments.view', 'payments.reconcile'),
  ah(async (req, res) => {
    const from = String(req.query.from || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
    const to = String(req.query.to || new Date().toISOString().slice(0, 10));
    const payments = (await Payment.find({ createdAt: { $gte: from, $lte: `${to}T23:59:59.999Z` } }).sort({ createdAt: -1 }).lean()).map(clean);
    const days = {};
    payments.forEach((p) => {
      const d = (days[day(p.createdAt)] ||= { date: day(p.createdAt), count: 0, success: 0, gross: 0, refunds: 0, net: 0, pending: 0, failed: 0, reconciled: 0, unreconciled: 0 });
      d.count += 1;
      if (p.status === 'success') {
        d.success += 1;
        d.gross += Number(p.total) || 0;
        d.refunds += Number(p.refundedAmount) || 0;
        d.net += net(p);
        if (p.reconciledAt) d.reconciled += 1;
        else d.unreconciled += 1;
      } else if (p.status === 'pending') d.pending += 1;
      else if (p.status === 'failed') d.failed += 1;
    });
    const batches = (await Reconciliation.find().sort({ at: -1 }).limit(100).lean()).map(clean);
    res.json({ from, to, days: Object.values(days).sort((a, b) => b.date.localeCompare(a.date)), payments, batches });
  }),
);

/** Mark payments as matched against a statement. */
r.post(
  '/',
  requirePermission('payments.reconcile'),
  ah(async (req, res) => {
    const d = parse(z.object({ paymentIds: z.array(z.string()).min(1, 'Choose the payments to reconcile').max(1000), statementRef: z.string().trim().min(2, 'Enter the statement or settlement reference').max(80), note: z.string().trim().max(500).optional() }), req.body);
    const list = await Payment.find({ _id: { $in: d.paymentIds } }).lean();
    const bad = list.filter((p) => p.status !== 'success' || p.reconciledAt);
    if (bad.length) throw badRequest(`${bad.map((p) => p._id).join(', ')} ${bad.length === 1 ? 'is' : 'are'} not a successful unreconciled payment.`);
    if (list.length !== d.paymentIds.length) throw badRequest('Some payments were not found.');
    const at = new Date().toISOString();
    const batch = await Reconciliation.create({ _id: uid('rec'), at, by: req.user.name, byId: req.user.id, statementRef: d.statementRef, note: d.note || '', paymentIds: d.paymentIds, count: list.length, total: list.reduce((n, p) => n + net(p), 0) });
    await Payment.updateMany({ _id: { $in: d.paymentIds } }, { $set: { reconciledAt: at, reconciledBy: req.user.name, reconciliationId: batch._id, statementRef: d.statementRef } });
    await audit(req.user, { action: 'Reconciled payments', entityType: 'reconciliation', entityId: batch._id, note: `${list.length} payment(s), TSh ${batch.total.toLocaleString('en-GB')}, statement ${d.statementRef}.` });
    res.status(201).json({ batch: clean(batch.toObject()), payments: (await Payment.find({ _id: { $in: d.paymentIds } }).lean()).map(clean) });
  }),
);

export default r;
