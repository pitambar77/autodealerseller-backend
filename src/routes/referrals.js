// Partner bank leads (loan referrals). Banks move a lead along; the selling dealer is kept informed.
import { Router } from 'express';
import { z } from 'zod';
import { Referral, Notification } from '../models/index.js';
import { ah, parse, forbidden, notFound } from '../lib/http.js';
import { uid } from '../lib/ids.js';
import { requireAuth, adminCan } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { clean } from '../services/serialize.js';

const r = Router();
export const REFERRAL_STATUSES = ['referred', 'contacted', 'application', 'sanctioned', 'disbursed', 'rejected'];
const LABEL = {
  contacted: 'contacted the buyer',
  application: 'started the loan application',
  sanctioned: 'sanctioned the loan',
  disbursed: 'paid the loan amount to you',
  rejected: 'declined the loan',
  referred: 'reopened the lead',
};

r.post(
  '/:id/status',
  requireAuth,
  ah(async (req, res) => {
    const { status, note = '' } = parse(z.object({ status: z.enum(REFERRAL_STATUSES), note: z.string().max(500).optional() }), req.body);
    const ref = await Referral.findById(req.params.id);
    if (!ref) throw notFound('Lead not found.');
    const u = req.user;
    if (!((u.role === 'admin' && adminCan(req, 'referrals.view')) || (u.role === 'bank' && u.lenderId === ref.lenderId))) throw forbidden('Only the partner bank handling this lead can update it.');
    if (ref.status === status) return res.json({ referral: clean(ref.toObject()), notification: null });
    const at = new Date().toISOString();
    ref.set({
      status,
      commission: status === 'disbursed' ? ref.get('expectedCommission') || 0 : 0,
      history: [{ status, at, by: ref.lender, note: note.trim() }, ...(ref.history || [])],
    });
    await ref.save();
    let notification = null;
    if (ref.enquiryId && ref.dealerId) {
      notification = {
        _id: uid('nt'),
        at,
        audience: 'dealer',
        recipientId: ref.dealerId,
        recipientName: '',
        channels: ['Dashboard', 'SMS'],
        title: `${ref.lender} ${LABEL[status] || status}`,
        body: `Loan for ${ref.get('buyerName')} (${ref.id})${note.trim() ? ` — ${note.trim()}` : ''}.`,
        link: '/dealer/enquiries',
        refId: ref.enquiryId,
      };
      await Notification.create(notification);
      notification = clean(notification);
    }
    await audit(u, { action: `Lead ${status}`, entityType: 'referral', entityId: ref.id, note: note.trim() });
    res.json({ referral: clean(ref.toObject()), notification });
  }),
);

export default r;
