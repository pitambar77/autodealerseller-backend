// Account teams for dealers and agents: the account owner adds managers, sales staff or field agents.
// Each person signs in with their own mobile number and works inside the owner's account with the
// permissions the owner gave them. Everything they do is recorded with their name (the owner sees it here).
import { Router } from 'express';
import { z } from 'zod';
import { AuditLog, Session, TeamMember, User } from '../models/index.js';
import { ah, parse, badRequest, conflict, forbidden, notFound } from '../lib/http.js';
import { phoneKey, uid } from '../lib/ids.js';
import { requireRole } from '../middleware/auth.js';
import { audit, diff } from '../services/audit.js';
import { endSessions } from '../services/sessions.js';
import { alertUser } from '../services/notify.js';
import { sendSms } from '../services/sms.js';
import { clean } from '../services/serialize.js';
import { TEAM_PERMISSION_KEYS, TEAM_ROLES, teamPermissionsFor } from '../shared/permissions.js';

/** Throws unless every permission is one this account type can hand out (agents have handovers, dealers don't). */
function checkPermissions(role, list) {
  const allowed = new Set(teamPermissionsFor(role).map((p) => p.key));
  const bad = (list || []).filter((p) => !allowed.has(p));
  if (bad.length) throw badRequest(`These can't be given on this account: ${bad.join(', ')}.`, { fields: { permissions: 'invalid' } });
}
import { config } from '../config.js';

const r = Router();
r.use(requireRole(...TEAM_ROLES));
// Only the owner manages the team.
r.use((req, _res, next) => (req.member ? next(forbidden('Only the account owner can manage the team.')) : next()));

const MAX_MEMBERS = 25;
const view = (m, sessions = []) => ({ ...clean(m), active: sessions.filter((s) => s.memberId === m._id).length });

async function everything(owner) {
  const [members, sessions, activity] = await Promise.all([
    TeamMember.find({ accountId: owner.id, status: { $ne: 'removed' } }).sort({ invitedAt: 1 }).lean(),
    Session.find({ userId: owner.id, memberId: { $exists: true }, revokedAt: { $exists: false } }).lean(),
    AuditLog.find({ $or: [{ accountId: owner.id }, { actorId: owner.id }] }).sort({ at: -1 }).limit(200).lean(),
  ]);
  return { members: members.map((m) => view(m, sessions)), activity: activity.map(clean) };
}

r.get(
  '/',
  ah(async (req, res) => res.json(await everything(req.user))),
);

const Input = z.object({
  name: z.string().trim().min(2, 'Enter their name').max(80),
  phone: z.string().trim().min(8, 'Enter their mobile number').max(24),
  email: z.string().trim().email('Enter a valid email').or(z.literal('')).optional(),
  title: z.string().trim().max(60).optional(),
  permissions: z.array(z.enum(TEAM_PERMISSION_KEYS)).min(1, 'Choose at least one thing they can do'),
});

r.post(
  '/',
  ah(async (req, res) => {
    const d = parse(Input, req.body);
    checkPermissions(req.user.role, d.permissions);
    const key = phoneKey(d.phone);
    if ((await TeamMember.countDocuments({ accountId: req.user.id, status: { $ne: 'removed' } })) >= MAX_MEMBERS) throw badRequest(`An account can have up to ${MAX_MEMBERS} team members.`);
    if (await User.exists({ phoneKey: key })) throw conflict('That number already has its own AutoDealer account. Team members need a number that is not registered yet.', { fields: { phone: 'taken' } });
    const existing = await TeamMember.findOne({ phoneKey: key });
    if (existing && existing.status !== 'removed') throw conflict(existing.accountId === req.user.id ? 'That person is already on your team.' : 'That number is already on another team.', { fields: { phone: 'taken' } });
    if (existing) await TeamMember.deleteOne({ _id: existing._id }); // re-adding someone removed earlier
    const m = await TeamMember.create({ _id: uid('tm'), accountId: req.user.id, name: d.name, phone: d.phone, phoneKey: key, email: (d.email || '').toLowerCase(), title: d.title || '', permissions: d.permissions, status: 'invited', invitedAt: new Date().toISOString(), invitedBy: req.user.name });
    const biz = req.user.business || req.user.agency || req.user.name;
    const msg = `${req.user.name} added you to ${biz} on AutoDealer. Sign in with this number at ${config.webUrl}/signin to work on ${req.user.role === 'agent' ? 'the agency' : 'the dealership'}'s listings.`;
    sendSms(d.phone, msg).catch(() => {});
    if (d.email) alertUser({ email: d.email, notifications: {} }, { email: { subject: `You've been added to ${biz} on AutoDealer`, heading: `Welcome to ${biz}`, lines: [msg], button: { label: 'Sign in', url: `${config.webUrl}/signin` } } }).catch(() => {});
    await audit(req.user, { action: 'Added team member', entityType: 'team', entityId: m._id, note: `${d.name} (${d.phone})`, changes: { permissions: [null, d.permissions] } });
    res.status(201).json(await everything(req.user));
  }),
);

const load = async (req) => {
  const m = await TeamMember.findOne({ _id: req.params.id, accountId: req.user.id, status: { $ne: 'removed' } });
  if (!m) throw notFound('Team member not found.');
  return m;
};

/** Change what someone can do, or their name/title. They get the new permissions on their next request. */
r.patch(
  '/:id',
  ah(async (req, res) => {
    const d = parse(Input.omit({ phone: true }).partial(), req.body);
    if (d.permissions) checkPermissions(req.user.role, d.permissions);
    const m = await load(req);
    const before = m.toObject();
    m.set(d);
    await m.save();
    await audit(req.user, { action: 'Changed team member', entityType: 'team', entityId: m._id, note: m.name, changes: diff(before, m.toObject(), ['name', 'title', 'email', 'permissions']) });
    res.json(await everything(req.user));
  }),
);

/** Pause (sessions end at once) or restore someone's access. */
r.post(
  '/:id/status',
  ah(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(['active', 'suspended']) }), req.body);
    const m = await load(req);
    const before = m.status;
    m.status = status === 'active' ? (m.joinedAt ? 'active' : 'invited') : 'suspended';
    await m.save();
    if (status === 'suspended') await endSessions({ userId: req.user.id, memberId: m._id }, { by: req.user.id, reason: 'access_paused' });
    await audit(req.user, { action: status === 'suspended' ? 'Paused team member access' : 'Restored team member access', entityType: 'team', entityId: m._id, note: m.name, changes: { status: [before, m.status] } });
    res.json(await everything(req.user));
  }),
);

/** Sign someone out everywhere. */
r.post(
  '/:id/sessions/end',
  ah(async (req, res) => {
    const m = await load(req);
    const n = await endSessions({ userId: req.user.id, memberId: m._id }, { by: req.user.id, reason: 'ended_by_owner' });
    await audit(req.user, { action: 'Signed out team member', entityType: 'team', entityId: m._id, note: `${m.name}: ${n} session(s).` });
    res.json(await everything(req.user));
  }),
);

/** Remove someone from the team (their listings and messages stay with the dealership). */
r.delete(
  '/:id',
  ah(async (req, res) => {
    const m = await load(req);
    m.set({ status: 'removed', removedAt: new Date().toISOString(), phoneKey: `removed_${m._id}` });
    await m.save();
    await endSessions({ userId: req.user.id, memberId: m._id }, { by: req.user.id, reason: 'removed' });
    await audit(req.user, { action: 'Removed team member', entityType: 'team', entityId: m._id, note: m.name });
    res.json(await everything(req.user));
  }),
);

export default r;
