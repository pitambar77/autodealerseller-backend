// Loads the demo marketplace (the same data the UI prototype used) into MongoDB.
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import mongoose from 'mongoose';
import { User, Vehicle, Enquiry, Payment, Document, Note, Referral, Notification, Handover, AuditLog, Setting, Otp, Invite, Category, AdminRole, Session, LoginAttempt, Approval, Reconciliation, Backup, TeamMember } from '../models/index.js';
import { ensureDefaultRoles } from './access.js';
import { entryHash } from './audit.js';
import { ensureCategories } from './categories.js';
import { buildSeed } from '../shared/seed.js';
import { withFinanceDemo } from '../shared/finance.js';
import { normId, phoneKey, sha256 } from '../lib/ids.js';

const toDoc = ({ id, ...rest }) => ({ _id: id, ...rest });

export const DEMO_ADMIN = { email: 'admin@autodealer.example', password: process.env.SEED_ADMIN_PASSWORD || 'AutoDealer#2026' };
export const DEMO_INVITE_CODE = 'AD-ADMIN-2026';

/**
 * @param {{ drop?: boolean }} opts  drop: delete existing data first (otherwise refuses to overwrite)
 * @returns summary with the demo sign-in details
 */
export async function seedDatabase({ drop = false } = {}) {
  if (!drop && (await User.estimatedDocumentCount()) > 0) {
    throw new Error('The database already has data. Run with --drop to replace it (this deletes everything).');
  }
  const models = [User, Vehicle, Enquiry, Payment, Document, Note, Referral, Notification, Handover, AuditLog, Setting, Otp, Invite, Category, AdminRole, Session, LoginAttempt, Approval, Reconciliation, Backup, TeamMember];
  // The audit log refuses deletes; only this demo reset may clear it.
  if (drop) await Promise.all(models.map((M) => M.deleteMany({}).setOptions({ allowAuditWipe: true })));
  await Promise.all(models.map((M) => M.syncIndexes().catch(() => M.createIndexes())));

  const s = withFinanceDemo(buildSeed());
  const totpSecret = process.env.SEED_ADMIN_TOTP_SECRET || authenticator.generateSecret();
  const passwordHash = await bcrypt.hash(DEMO_ADMIN.password, 12);

  const seen = new Set();
  const users = s.users
    .filter((u) => {
      const k = phoneKey(u.phone);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((u) => {
      const doc = { ...toDoc(u), phoneKey: phoneKey(u.phone), email: (u.email || '').toLowerCase() };
      if (u.role === 'admin') Object.assign(doc, { passwordHash, totpSecret, twoFactor: true, adminRole: u.adminRole || 'md', team: u.team || 'Management' });
      if (u.id === 'u_buyer1') doc.buyer = { saved: s.saved, savedSearches: s.savedSearches, prefs: s.buyerPrefs };
      return doc;
    });
  // One staff login per partner bank, for the bank lead desk (/bank-portal).
  s.config.loanProviders.forEach((l, i) => {
    const phone = `+255 700 000 01${i + 1}`;
    users.push({ _id: `u_bank_${l.id}`, role: 'bank', name: `${l.name.split(' ')[0]} lead desk`, phone, phoneKey: phoneKey(phone), email: `leads@${l.id}.example`, city: 'Dar es Salaam', status: 'active', docStatus: 'verified', lenderId: l.id, registeredAt: new Date().toISOString() });
  });

  await User.insertMany(users);
  await Vehicle.insertMany(s.vehicles.map((v) => ({ ...toDoc(v), regKey: normId(v.regNumber), vinKey: normId(v.vin) })));
  await Enquiry.insertMany(s.enquiries.map(toDoc));
  await Payment.insertMany(s.payments.map(toDoc));
  await Document.insertMany(s.documents.map(toDoc));
  await Note.insertMany(s.notes.map(toDoc));
  await Referral.insertMany(s.referrals.map(toDoc));
  await Notification.insertMany((s.notifications || []).map(toDoc));
  await Handover.insertMany(s.handovers.map(toDoc));
  // Demo history goes into the chained audit log, oldest first.
  let prev = '';
  const chained = [...s.audit]
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .map((a, i) => {
      const doc = { ...toDoc(a), seq: i + 1, actorId: a.actorId || 'system', prevHash: prev };
      doc.hash = entryHash(doc, prev);
      prev = doc.hash;
      return doc;
    });
  await AuditLog.insertMany(chained);
  await ensureDefaultRoles();
  await Setting.create({ _id: 'platform', value: s.config });
  await ensureCategories();
  // Demo team members: one in the dealership, one in an agency (each signs in with their own number).
  const now = new Date().toISOString();
  await TeamMember.insertMany([
    { _id: 'tm_demo_dealer', accountId: 'u_dealer1', name: 'Rashidi Ally', phone: '+255 713 400 101', phoneKey: phoneKey('+255 713 400 101'), title: 'Sales representative', permissions: ['listings.create', 'listings.edit', 'enquiries.respond'], status: 'active', invitedAt: now, joinedAt: now, invitedBy: 'Seed script' },
    { _id: 'tm_demo_agent', accountId: 'u_agent1', name: 'Neema Joseph', phone: '+255 713 400 102', phoneKey: phoneKey('+255 713 400 102'), title: 'Field agent', permissions: ['listings.create', 'listings.edit', 'enquiries.respond', 'handovers.manage'], status: 'active', invitedAt: now, joinedAt: now, invitedBy: 'Seed script' },
  ]);
  // A ready-made admin invitation for trying the invite flow (expires in 30 days).
  await Invite.create({ _id: 'inv_demo', codeHash: sha256(DEMO_INVITE_CODE), email: 'new.admin@autodealer.example', name: 'New Admin', adminRole: 'operations', team: 'Operations Manager', createdBy: 'Seed script', expiresAt: new Date(Date.now() + 30 * 864e5) });

  return {
    counts: { users: users.length, vehicles: s.vehicles.length, enquiries: s.enquiries.length, payments: s.payments.length, documents: s.documents.length },
    staff: users.filter((u) => u.role === 'admin').map((u) => ({ id: u._id, email: u.email, role: u.adminRole })),
    admin: { ...DEMO_ADMIN, totpSecret, otpauthUrl: authenticator.keyuri(DEMO_ADMIN.email, 'AutoDealer Admin', totpSecret) },
    invite: { code: DEMO_INVITE_CODE, email: 'new.admin@autodealer.example' },
    team: [{ id: 'tm_demo_dealer', account: 'u_dealer1', name: 'Rashidi Ally', phone: '+255 713 400 101' }, { id: 'tm_demo_agent', account: 'u_agent1', name: 'Neema Joseph', phone: '+255 713 400 102' }],
    phones: Object.fromEntries(['u_dealer1', 'u_seller1', 'u_agent1', 'u_buyer1', 'u_bank_lp1', 'u_bank_lp2'].map((id) => [id, users.find((u) => u._id === id)?.phone])),
  };
}

export const isConnected = () => mongoose.connection.readyState === 1;
