// Maker-checker approvals for sensitive actions.
//
// One admin asks (the "maker"), another approves (the "checker"); nobody approves their own request.
// The action only runs on approval, and both steps go into the audit log.
//
//   refund      – give money back on a successful payment (full or part)
//   adjustment  – mark a pending/failed payment as paid or failed after checking the statement,
//                 or record an amount correction
//   deletion    – permanently delete a listing, or erase a user account's personal data
//   suspension  – suspend a seller, agent, dealer or buyer account (hides their listings)
import { Approval, Document, Enquiry, Note, Payment, User, Vehicle, Session } from '../models/index.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/http.js';
import { uid } from '../lib/ids.js';
import { APPROVAL_TYPES, allows } from '../shared/permissions.js';
import { audit } from './audit.js';
import { notify, notifyStaffWith } from './notify.js';
import { settlePayment } from './payments.js';
import { endSessions } from './sessions.js';
import { removeFile } from './storage.js';
import { clean } from './serialize.js';
import { tzs } from '../shared/format.js';

const who = (u) => ({ id: u.id, name: u.name, adminRole: u.adminRole || null });
const refundedSoFar = (p) => (p.refunds || []).reduce((n, r) => n + (Number(r.amount) || 0), 0);

/** Check a request and describe it. Throws if it can't be done. Returns { title, summary, entityType, entityId, payload }. */
async function prepare(type, d) {
  if (type === 'refund') {
    const p = await Payment.findById(d.paymentId).lean();
    if (!p) throw notFound('Payment not found.');
    if (p.status !== 'success') throw badRequest('Only successful payments can be refunded.');
    const left = (Number(p.total) || 0) - refundedSoFar(p);
    const amount = d.amount ? Math.round(Number(d.amount)) : left;
    if (!(amount > 0)) throw badRequest('Enter the amount to refund.');
    if (amount > left) throw badRequest(`At most ${tzs(left)} can still be refunded on this payment.`);
    return { title: `Refund ${tzs(amount)} on ${p._id}`, summary: `${amount === left && !refundedSoFar(p) ? 'Full' : 'Part'} refund of ${tzs(p.total)} payment for listing ${p.listingId || '—'}.`, entityType: 'payment', entityId: p._id, payload: { paymentId: p._id, amount } };
  }
  if (type === 'adjustment') {
    const p = await Payment.findById(d.paymentId).lean();
    if (!p) throw notFound('Payment not found.');
    if (d.kind === 'mark_paid' || d.kind === 'mark_failed') {
      if (!['pending', 'failed'].includes(p.status)) throw badRequest('Only pending or failed payments can be marked paid or failed.');
      if (d.kind === 'mark_failed' && p.status === 'failed') throw badRequest('This payment is already marked failed.');
      return { title: `${d.kind === 'mark_paid' ? 'Mark paid' : 'Mark failed'}: ${p._id}`, summary: `${tzs(p.total)} payment is ${p.status}. ${d.kind === 'mark_paid' ? 'Confirmed received on the statement' : 'Confirmed not received'}${d.statementRef ? ` (ref ${d.statementRef})` : ''}.`, entityType: 'payment', entityId: p._id, payload: { paymentId: p._id, kind: d.kind, statementRef: d.statementRef || '' } };
    }
    if (d.kind === 'correction') {
      const amount = Math.round(Number(d.amount));
      if (!amount) throw badRequest('Enter the correction amount (negative to reduce).');
      return { title: `Correct ${p._id} by ${amount > 0 ? '+' : ''}${tzs(amount)}`, summary: `Recorded total ${tzs(p.total)}; correction ${amount > 0 ? '+' : ''}${tzs(amount)}.`, entityType: 'payment', entityId: p._id, payload: { paymentId: p._id, kind: 'correction', amount, statementRef: d.statementRef || '' } };
    }
    throw badRequest('Choose the kind of adjustment.');
  }
  if (type === 'deletion') {
    if (d.entityType === 'vehicle') {
      const v = await Vehicle.findById(d.entityId).lean();
      if (!v) throw notFound('Listing not found.');
      return { title: `Delete listing ${v._id} permanently`, summary: `${v.year} ${v.make} ${v.model} (${v.regNumber || 'no reg.'}), status ${v.status}. Photos, notes and conversations are deleted; payment records are kept.`, entityType: 'vehicle', entityId: v._id, payload: { entityType: 'vehicle', entityId: v._id } };
    }
    if (d.entityType === 'user') {
      const u = await User.findById(d.entityId).lean();
      if (!u) throw notFound('Account not found.');
      if (u.role === 'admin') throw badRequest('Admin staff accounts are deactivated in Team & roles, not deleted.');
      return { title: `Erase account ${u.name}`, summary: `${u.role} ${u.business || u.agency || ''} ${u.phone}. Personal details and documents are erased and listings removed; payment records are kept.`, entityType: 'user', entityId: u._id, payload: { entityType: 'user', entityId: u._id } };
    }
    throw badRequest('Choose what to delete.');
  }
  if (type === 'suspension') {
    const u = await User.findById(d.userId).lean();
    if (!u) throw notFound('Account not found.');
    if (u.role === 'admin') throw badRequest('Admin staff accounts are deactivated in Team & roles.');
    if (u.status !== 'active') throw badRequest('This account is not active.');
    return { title: `Suspend ${u.business || u.agency || u.name}`, summary: `${u.role} account (${u.phone}). Their live listings are hidden until the account is reactivated.`, entityType: 'user', entityId: u._id, payload: { userId: u._id } };
  }
  throw badRequest('Unknown request type.');
}

/** What each type does once approved. Returns a short result description. */
const EXECUTE = {
  async refund(a, approver) {
    const p = await Payment.findById(a.payload.paymentId);
    const left = (Number(p.total) || 0) - refundedSoFar(p.toObject());
    if (a.payload.amount > left) throw badRequest(`Only ${tzs(left)} can still be refunded.`);
    // With a live gateway, call its refund API here and keep its reference.
    const refund = { id: uid('rf'), amount: a.payload.amount, at: new Date().toISOString(), approvalId: a._id, requestedBy: a.requestedBy.name, approvedBy: approver.name, reason: a.reason, gatewayRef: `mock_refund_${uid('').slice(1, 9)}` };
    const refunds = [...(p.refunds || []), refund];
    const total = refunds.reduce((n, r) => n + r.amount, 0);
    p.set({ refunds, refundedAmount: total, refundStatus: total >= p.total ? 'full' : 'partial' });
    await p.save();
    return { text: `Refunded ${tzs(a.payload.amount)} (${refund.gatewayRef}).`, payment: clean(p.toObject()) };
  },
  async adjustment(a, approver) {
    const p = await Payment.findById(a.payload.paymentId);
    const entry = { id: uid('adj'), kind: a.payload.kind, at: new Date().toISOString(), approvalId: a._id, requestedBy: a.requestedBy.name, approvedBy: approver.name, reason: a.reason, statementRef: a.payload.statementRef || '' };
    if (a.payload.kind === 'correction') {
      entry.amount = a.payload.amount;
      p.set({ adjustments: [...(p.adjustments || []), entry], adjustedTotal: (Number(p.adjustedTotal ?? p.total) || 0) + a.payload.amount });
      await p.save();
      return { text: `Recorded a ${a.payload.amount > 0 ? '+' : ''}${tzs(a.payload.amount)} correction.`, payment: clean(p.toObject()) };
    }
    if (!['pending', 'failed'].includes(p.status)) throw badRequest(`The payment is now ${p.status}; nothing to adjust.`);
    p.set({ adjustments: [...(p.adjustments || []), entry] });
    if (p.status === 'failed') p.status = 'pending'; // settlePayment only settles pending payments
    await p.save();
    const { txn } = await settlePayment(p.id, a.payload.kind === 'mark_paid' ? 'success' : 'failed', approver);
    return { text: a.payload.kind === 'mark_paid' ? 'Marked paid; the listing was published.' : 'Marked failed.', payment: clean(txn) };
  },
  async deletion(a) {
    if (a.payload.entityType === 'vehicle') {
      const v = await Vehicle.findById(a.payload.entityId).lean();
      if (!v) return { text: 'Already deleted.' };
      (v.photos || []).forEach((ph) => typeof ph === 'string' && removeFile(ph));
      await Promise.all([Note.deleteMany({ listingId: v._id }), Enquiry.deleteMany({ vehicleId: v._id })]);
      await Vehicle.deleteOne({ _id: v._id });
      return { text: `Listing ${v._id} deleted. Payment records kept.` };
    }
    const u = await User.findById(a.payload.entityId);
    if (!u) return { text: 'Already deleted.' };
    const docs = await Document.find({ userId: u.id }).lean();
    docs.forEach((d) => d.file && removeFile(d.file));
    await Document.deleteMany({ userId: u.id });
    await Vehicle.updateMany({ sellerId: u.id, status: { $ne: 'sold' } }, { status: 'removed' });
    await endSessions({ userId: u.id }, { by: 'approval', reason: 'account_deleted' });
    const erased = `deleted_${u.id}`;
    u.set({ name: 'Deleted account', phone: '', phoneKey: erased, email: '', business: undefined, agency: undefined, address: undefined, status: 'closed', erasedAt: new Date().toISOString(), buyer: { saved: [], savedSearches: [], prefs: {} } });
    await u.save();
    return { text: 'Personal details and documents erased; listings removed; payments kept.' };
  },
  async suspension(a) {
    const u = await User.findById(a.payload.userId);
    if (!u || u.status !== 'active') return { text: 'The account is no longer active; nothing to do.' };
    await applyUserStatus(u, 'suspended');
    return { text: 'Account suspended and live listings hidden.' };
  },
};

/** Suspend or reactivate an account: suspending hides their live listings; reactivating restores only those. */
export async function applyUserStatus(u, status) {
  u.status = status;
  await u.save();
  if (status === 'suspended') {
    await Vehicle.updateMany({ sellerId: u.id, status: 'live' }, { status: 'suspended', suspendedWithUser: true });
    await endSessions({ userId: u.id }, { by: 'admin', reason: 'suspended' });
  } else await Vehicle.updateMany({ sellerId: u.id, suspendedWithUser: true }, { status: 'live', suspendedWithUser: false });
}

/** Ask for a sensitive action. `perms` = the requester's admin permissions. */
export async function createApproval(user, perms, type, data, reason) {
  const t = APPROVAL_TYPES[type];
  if (!t) throw badRequest('Unknown request type.');
  const needed = type === 'deletion' ? (data.entityType === 'user' ? 'users.delete' : 'listings.delete') : t.request[0];
  if (!allows(perms, needed)) throw forbidden("Your admin role can't request this.");
  if (!reason || reason.trim().length < 5) throw badRequest('Give a reason (at least 5 characters). The approver sees it.', { fields: { reason: 'required' } });
  const info = await prepare(type, data);
  if (await Approval.exists({ type, entityId: info.entityId, status: 'pending' })) throw conflict('There is already a pending request for this. Wait for it to be approved or rejected.');
  const a = await Approval.create({ _id: uid('apr'), type, status: 'pending', ...info, reason: reason.trim(), requestedBy: who(user), requestedAt: new Date().toISOString() });
  await audit(user, { action: `Requested ${t.label.toLowerCase()}`, entityType: info.entityType, entityId: info.entityId, note: `${info.title}. Reason: ${reason.trim()}`, changes: { approval: [null, a._id] } });
  notifyStaffWith(t.approve, { kind: 'approval', title: `Approval needed: ${info.title}`, body: `Requested by ${user.name}. ${reason.trim()}`, link: '/admin/approvals', refId: a._id, except: user.id, email: { subject: `Approval needed: ${info.title}`, heading: 'A request needs your approval', lines: [info.title, info.summary, `Requested by ${user.name}: ${reason.trim()}`] } }).catch(() => {});
  return clean(a.toObject());
}

/** Approve or reject. The approver needs the type's approve permission and can't be the requester. */
export async function decideApproval(user, perms, id, decision, note = '') {
  const a = await Approval.findById(id);
  if (!a) throw notFound('Request not found.');
  if (a.status !== 'pending') throw conflict(`This request was already ${a.status}.`);
  const t = APPROVAL_TYPES[a.type];
  if (a.requestedBy?.id === user.id) throw forbidden("You can't approve or reject your own request. Another authorised admin must decide.");
  if (!allows(perms, t.approve)) throw forbidden(`Your admin role can't decide on ${t.label.toLowerCase()} requests.`);
  if (decision === 'rejected' && note.trim().length < 3) throw badRequest('Say why you are rejecting it.', { fields: { note: 'required' } });
  a.set({ status: decision === 'approved' ? 'approving' : 'rejected', decidedBy: who(user), decidedAt: new Date().toISOString(), decisionNote: note.trim() });
  await a.save();
  if (decision === 'approved') {
    try {
      const result = await EXECUTE[a.type](a.toObject(), user);
      a.set({ status: 'approved', result: { text: result.text } });
      await a.save();
      await audit(user, { action: `Approved ${t.label.toLowerCase()}`, entityType: a.entityType, entityId: a.entityId, note: `${a.title}. ${result.text}${note ? ` Note: ${note}` : ''}`, changes: { approval: [a._id, 'approved'], requestedBy: [a.requestedBy.name, null] } });
    } catch (e) {
      a.set({ status: 'pending', decidedBy: undefined, decidedAt: undefined, result: { error: e.message } });
      await a.save();
      throw e;
    }
  } else {
    await audit(user, { action: `Rejected ${t.label.toLowerCase()} request`, entityType: a.entityType, entityId: a.entityId, note: `${a.title}. ${note}`, changes: { approval: [a._id, 'rejected'] } });
  }
  notify({ recipientId: a.requestedBy.id, audience: 'admin', kind: 'approval_result', title: `${decision === 'approved' ? 'Approved' : 'Rejected'}: ${a.title}`, body: decision === 'approved' ? `${user.name} approved it. ${a.result?.text || ''}` : `${user.name}: ${note}`, link: '/admin/approvals', refId: a._id }).catch(() => {});
  return clean(a.toObject());
}

/** The requester can withdraw a pending request. */
export async function cancelApproval(user, id) {
  const a = await Approval.findById(id);
  if (!a) throw notFound('Request not found.');
  if (a.requestedBy?.id !== user.id) throw forbidden('Only the person who asked can withdraw it.');
  if (a.status !== 'pending') throw conflict(`This request was already ${a.status}.`);
  a.set({ status: 'cancelled', decidedAt: new Date().toISOString(), decidedBy: who(user) });
  await a.save();
  await audit(user, { action: 'Withdrew request', entityType: a.entityType, entityId: a.entityId, note: a.title });
  return clean(a.toObject());
}

export const sessionsOf = (userId) => Session.find({ userId, revokedAt: { $exists: false } }).lean();
