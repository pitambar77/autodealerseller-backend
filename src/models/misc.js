// Smaller collections. They mirror the frontend records one to one, so most use strict: false.
import mongoose from 'mongoose';
import { baseOptions } from './plugin.js';

const { Mixed } = mongoose.Schema.Types;
const flexible = (fields, indexes = []) => {
  const s = new mongoose.Schema({ _id: { type: String, required: true }, ...fields }, baseOptions({ strict: false }));
  indexes.forEach((i) => s.index(i));
  return s;
};
const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

export const Enquiry = model(
  'Enquiry',
  flexible(
    {
      type: String, vehicleId: String, sellerId: String, buyerId: String, buyerName: String, buyerPhone: String, buyerEmail: String, message: String, channel: String,
      status: { type: String, default: 'new' }, finance: Mixed, accessKeyHash: { type: String, select: false }, createdAt: String,
      // Conversation: [{ id, from: 'buyer' | 'seller', text, at }], when each side last read it, and when we last texted a guest buyer.
      messages: [Mixed], readAt: Mixed, lastMessageAt: String, lastGuestSmsAt: String,
    },
    [{ sellerId: 1 }, { buyerId: 1 }, { vehicleId: 1 }],
  ),
);

export const Payment = model(
  'Payment',
  flexible({ gatewayRef: String, userId: String, listingId: String, planId: String, amount: Number, gst: Number, total: Number, method: String, status: String, createdAt: String }, [{ userId: 1 }, { listingId: 1 }]),
);

export const Document = model(
  'Document',
  flexible(
    { userId: String, type: String, label: String, fileName: String, size: Number, maskedNumber: String, status: { type: String, default: 'pending' }, reviewNote: String, preview: String, file: String, uploadedAt: String, reviewedAt: String },
    [{ userId: 1, type: 1 }],
  ),
);

export const Note = model('Note', flexible({ listingId: String, text: String, at: String, author: String }, [{ listingId: 1 }]));

export const Referral = model(
  'Referral',
  flexible({ enquiryId: String, lenderId: String, lender: String, buyerId: String, dealerId: String, vehicleId: String, status: String, history: [Mixed], createdAt: String }, [{ lenderId: 1 }, { dealerId: 1 }, { buyerId: 1 }]),
);

export const Notification = model(
  'Notification',
  flexible({ at: String, audience: String, recipientId: String, kind: String, title: String, body: String, link: String, refId: String, groupKey: String, count: Number, readAt: String }, [{ audience: 1, recipientId: 1 }, { recipientId: 1, groupKey: 1 }]),
);

export const Handover = model('Handover', flexible({ vehicleId: String, agentId: String, buyerName: String, steps: [Mixed] }, [{ agentId: 1 }, { vehicleId: 1 }]));

// Audit trail. Entries are chained: each stores the hash of the one before (`prevHash`) and its own
// `hash`, so editing or deleting any entry breaks the chain and shows up in Admin → Activity log →
// "Check integrity". The model itself refuses updates and deletes (see below).
const AuditSchema = flexible(
  { seq: { type: Number }, at: String, actor: String, actorId: String, actorRole: String, adminRole: String, action: String, entityType: String, entityId: String, note: String, changes: Mixed, ip: String, prevHash: String, hash: String },
  [{ at: -1 }, { actorId: 1, at: -1 }],
);
AuditSchema.index({ seq: 1 }, { unique: true, sparse: true });
const auditReadOnly = function guard(next) {
  // Only the database seeder (demo data) may clear the log, and it says so explicitly.
  if (this.getOptions?.().allowAuditWipe) return next();
  return next(new Error('Audit log entries cannot be changed or deleted.'));
};
['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndReplace'].forEach((op) => AuditSchema.pre(op, auditReadOnly));
AuditSchema.pre('save', function guard(next) {
  return this.isNew ? next() : next(new Error('Audit log entries cannot be changed or deleted.'));
});
export const AuditLog = model('AuditLog', AuditSchema);

/** Admin roles (Admin → Team & roles). `_id` is the role key stored on staff accounts. */
export const AdminRole = model('AdminRole', flexible({ name: String, description: String, permissions: [String], locked: Boolean, order: Number, createdAt: String, updatedAt: String, updatedBy: String }));

/** Signed-in sessions. Every token names its session, so a session can be ended (signed out) remotely. */
export const Session = model(
  'Session',
  flexible(
    { userId: { type: String, index: true }, memberId: String, role: String, ip: String, userAgent: String, createdAt: Date, lastSeenAt: Date, revokedAt: Date, revokedBy: String, endReason: String },
    [{ userId: 1, revokedAt: 1 }],
  ),
);

/** Admin sign-in attempts (successful and failed), for lockout and security monitoring. */
export const LoginAttempt = model('LoginAttempt', flexible({ at: Date, email: String, userId: String, ip: String, userAgent: String, ok: Boolean, reason: String, flagged: Boolean }, [{ at: -1 }, { email: 1, at: -1 }]));

/** Maker-checker requests for sensitive actions (refunds, adjustments, deletions, suspensions). */
export const Approval = model(
  'Approval',
  flexible({ type: String, status: { type: String, default: 'pending', index: true }, title: String, summary: String, reason: String, payload: Mixed, entityType: String, entityId: String, requestedBy: Mixed, requestedAt: String, decidedBy: Mixed, decidedAt: String, decisionNote: String, result: Mixed }, [{ requestedAt: -1 }]),
);

/** Payment reconciliation batches: which payments were matched against which statement, by whom. */
export const Reconciliation = model('Reconciliation', flexible({ at: String, by: String, byId: String, statementRef: String, note: String, paymentIds: [String], count: Number, total: Number }, [{ at: -1 }]));

/** Backups made by the scheduler or Admin → Backups. */
export const Backup = model('Backup', flexible({ at: String, file: String, size: Number, sha256: String, encrypted: Boolean, collections: Mixed, offsite: Mixed, status: String, error: String, by: String }, [{ at: -1 }]));

/** People a dealer added to their dealership account (each signs in with their own number). */
export const TeamMember = model(
  'TeamMember',
  flexible(
    { accountId: { type: String, index: true }, name: String, phone: String, phoneKey: { type: String, unique: true, sparse: true }, email: String, title: String, permissions: [String], status: { type: String, default: 'invited' }, invitedAt: String, invitedBy: String, joinedAt: String, lastActiveAt: String },
  ),
);

/** Platform configuration (Admin → Configuration). Single document with _id "platform". */
export const Setting = model('Setting', new mongoose.Schema({ _id: String, value: Mixed }, baseOptions()));

/** One-time sign-in codes. Only a hash of the code is stored. */
export const Otp = model(
  'Otp',
  new mongoose.Schema({ _id: String, phoneKey: { type: String, index: true }, codeHash: String, attempts: { type: Number, default: 0 }, expiresAt: Date, createdAt: Date }, baseOptions()),
);

/** Admin invitations (Admin → Users → Invite admin). */
export const Invite = model(
  'Invite',
  new mongoose.Schema(
    { _id: String, codeHash: { type: String, index: true }, email: String, name: String, team: String, adminRole: String, createdBy: String, createdById: String, expiresAt: Date, usedAt: Date, revokedAt: Date, totpSecret: { type: String, select: false } },
    baseOptions(),
  ),
);

/** Messages sent from the Support page. */
export const SupportTicket = model(
  'SupportTicket',
  flexible({ ref: { type: String, index: true }, userId: String, name: String, phone: String, email: String, topic: String, listingId: String, message: String, status: { type: String, default: 'open' }, createdAt: String }),
);

/** Vehicle categories (Admin → Categories). `_id` is the permanent key stored on listings. */
export const Category = model(
  'Category',
  flexible({ name: String, slug: { type: String, index: true }, aliases: [String], enabled: { type: Boolean, default: true }, order: { type: Number, default: 0 } }),
);
