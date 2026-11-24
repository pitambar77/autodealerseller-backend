// Admin → Team & roles (Managing Director, or anyone with "Manage admin staff and roles"):
// individual staff accounts, invitations, roles and permissions, deactivation, sessions, unlocks.
import { Router } from 'express';
import { z } from 'zod';
import { AdminRole, Invite, Session, User } from '../models/index.js';
import { ah, parse, badRequest, conflict, forbidden, notFound } from '../lib/http.js';
import { randomToken, sha256, uid } from '../lib/ids.js';
import { requirePermission } from '../middleware/auth.js';
import { audit, diff } from '../services/audit.js';
import { invalidateRoles, rolesByKey } from '../services/access.js';
import { activeSessions, endSessions } from '../services/sessions.js';
import { sendEmail, emailHtml } from '../services/email.js';
import { PERMISSION_KEYS } from '../shared/permissions.js';
import { config as env } from '../config.js';

const r = Router();
r.use(requirePermission('staff.manage'));

const staffView = (u, roles, sessions = []) => ({
  id: u._id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  adminRole: u.adminRole || '',
  roleName: roles[u.adminRole || '']?.name || 'No role',
  status: u.status,
  twoFactor: !!u.twoFactor,
  lastLoginAt: u.lastLoginAt || null,
  lastLoginIp: u.lastLoginIp || null,
  lockedUntil: u.lockedUntil && new Date(u.lockedUntil) > new Date() ? u.lockedUntil : null,
  registeredAt: u.registeredAt,
  sessions: sessions.filter((s) => s.userId === u._id).map((s) => ({ id: s._id, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt })),
});
const roleView = (role, staff) => ({ key: role._id, name: role.name, description: role.description || '', permissions: role.permissions || [], locked: !!role.locked, members: staff.filter((u) => u.adminRole === role._id && u.status === 'active').length });

async function everything() {
  const [staff, roles, sessions, invites] = await Promise.all([
    User.find({ role: 'admin' }).sort({ registeredAt: 1 }).lean(),
    AdminRole.find().sort({ order: 1, createdAt: 1 }).lean(),
    Session.find({ role: 'admin', revokedAt: { $exists: false } }).lean(),
    Invite.find({ usedAt: { $exists: false }, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } }).sort({ expiresAt: -1 }).lean(),
  ]);
  const byKey = Object.fromEntries(roles.map((x) => [x._id, x]));
  return {
    staff: staff.map((u) => staffView(u, byKey, sessions)),
    roles: roles.map((x) => roleView(x, staff)),
    invites: invites.map((i) => ({ id: i._id, email: i.email, name: i.name || '', adminRole: i.adminRole || '', roleName: byKey[i.adminRole]?.name || i.team || '', createdBy: i.createdBy, expiresAt: i.expiresAt })),
  };
}
const activeMds = async (exceptId) => {
  const roles = await rolesByKey();
  const full = Object.values(roles).filter((x) => x.permissions.includes('*') || x.permissions.includes('staff.manage')).map((x) => x.key);
  return User.countDocuments({ role: 'admin', status: 'active', adminRole: { $in: full }, _id: { $ne: exceptId } });
};

r.get(
  '/',
  ah(async (_req, res) => res.json(await everything())),
);

// ── Staff accounts
const loadStaff = async (id) => {
  const u = await User.findOne({ _id: id, role: 'admin' });
  if (!u) throw notFound('Staff member not found.');
  return u;
};

/** Invite a new staff member: they set their own password and authenticator at /admin/invite. */
r.post(
  '/invites',
  ah(async (req, res) => {
    const d = parse(z.object({ email: z.string().trim().email('Enter their work email'), name: z.string().trim().max(80).optional(), adminRole: z.string().min(1, 'Choose a role') }), req.body);
    const email = d.email.toLowerCase();
    const roles = await rolesByKey();
    const role = roles[d.adminRole];
    if (!role) throw badRequest('Choose a role.');
    if (await User.exists({ role: 'admin', email })) throw conflict('That email already has an admin account.');
    await Invite.updateMany({ email, usedAt: { $exists: false }, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
    const code = `AD-${randomToken(6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;
    const inv = await Invite.create({ _id: uid('inv'), codeHash: sha256(code), email, name: d.name || '', adminRole: role.key, team: role.name, createdBy: req.user.name, createdById: req.user.id, expiresAt: new Date(Date.now() + 7 * 864e5) });
    const link = `${env.webUrl}/admin/invite`;
    const sent = await sendEmail({
      to: email,
      subject: 'Your AutoDealer admin invitation',
      text: `${req.user.name} invited you to the AutoDealer admin console as ${role.name}. Open ${link} and enter the code ${code} with this email address. The code expires in 7 days.`,
      html: emailHtml({ heading: 'You are invited to the AutoDealer admin console', lines: [`${req.user.name} invited you as ${role.name}.`, `Your invitation code: ${code}`, 'Use it with this email address. You will set your own password and 2-step verification. The code expires in 7 days.'], button: { label: 'Accept the invitation', url: link } }),
    }).catch(() => false);
    await audit(req.user, { action: 'Invited staff member', entityType: 'staff', entityId: email, note: `Role: ${role.name}`, changes: { invite: [null, inv._id] } });
    res.status(201).json({ code, email, link, emailed: !!sent, expiresInDays: 7, ...(await everything()) });
  }),
);

r.delete(
  '/invites/:id',
  ah(async (req, res) => {
    const inv = await Invite.findById(req.params.id);
    if (!inv || inv.usedAt) throw notFound('Invitation not found.');
    inv.revokedAt = new Date();
    await inv.save();
    await audit(req.user, { action: 'Cancelled staff invitation', entityType: 'staff', entityId: inv.email });
    res.json(await everything());
  }),
);

/** Change a staff member's role. */
r.patch(
  '/:id',
  ah(async (req, res) => {
    const d = parse(z.object({ adminRole: z.string().min(1) }), req.body);
    const u = await loadStaff(req.params.id);
    if (u.id === req.user.id) throw forbidden("You can't change your own role. Another Managing Director must do it.");
    const roles = await rolesByKey();
    if (!roles[d.adminRole]) throw badRequest('Choose a role.');
    const wasFull = roles[u.adminRole]?.permissions.some((p) => p === '*' || p === 'staff.manage');
    const isFull = roles[d.adminRole].permissions.some((p) => p === '*' || p === 'staff.manage');
    if (wasFull && !isFull && (await activeMds(u.id)) === 0) throw badRequest('Keep at least one active Managing Director.');
    const before = u.adminRole;
    u.adminRole = d.adminRole;
    u.set('team', roles[d.adminRole].name);
    await u.save();
    // New permissions apply from their next request; end their sessions so menus refresh too.
    await endSessions({ userId: u.id }, { by: req.user.id, reason: 'role_changed' });
    await audit(req.user, { action: 'Changed staff role', entityType: 'staff', entityId: u.id, note: `${u.name}: ${roles[before]?.name || '—'} → ${roles[d.adminRole].name}`, changes: { adminRole: [before || null, d.adminRole] } });
    res.json(await everything());
  }),
);

/** Deactivate (access revoked at once, all sessions ended) or reactivate a staff account. */
r.post(
  '/:id/status',
  ah(async (req, res) => {
    const { status, reason = '' } = parse(z.object({ status: z.enum(['active', 'suspended']), reason: z.string().max(300).optional() }), req.body);
    const u = await loadStaff(req.params.id);
    if (u.id === req.user.id) throw forbidden("You can't deactivate your own account.");
    const roles = await rolesByKey();
    if (status === 'suspended' && roles[u.adminRole]?.permissions.some((p) => p === '*' || p === 'staff.manage') && (await activeMds(u.id)) === 0) throw badRequest('Keep at least one active Managing Director.');
    const before = u.status;
    u.status = status;
    await u.save();
    let ended = 0;
    if (status === 'suspended') ended = await endSessions({ userId: u.id }, { by: req.user.id, reason: 'deactivated' });
    await audit(req.user, { action: status === 'suspended' ? 'Deactivated staff account' : 'Reactivated staff account', entityType: 'staff', entityId: u.id, note: `${u.name}${reason ? `: ${reason}` : ''}${ended ? ` (${ended} session(s) ended)` : ''}`, changes: { status: [before, status] } });
    res.json(await everything());
  }),
);

/** End all of a staff member's sessions (signed out everywhere at once). */
r.post(
  '/:id/sessions/end',
  ah(async (req, res) => {
    const u = await loadStaff(req.params.id);
    const sessionId = req.body?.sessionId;
    const ended = await endSessions({ userId: u.id, ...(sessionId ? { _id: sessionId } : {}) }, { by: req.user.id, reason: 'ended_by_admin', except: u.id === req.user.id ? req.sessionId : undefined });
    await audit(req.user, { action: 'Ended staff sessions', entityType: 'staff', entityId: u.id, note: `${u.name}: ${ended} session(s) ended.` });
    res.json({ ended, ...(await everything()) });
  }),
);

r.post(
  '/:id/unlock',
  ah(async (req, res) => {
    const u = await loadStaff(req.params.id);
    u.set({ lockedUntil: undefined, failedLogins: 0 });
    await u.save();
    await audit(req.user, { action: 'Unlocked staff account', entityType: 'staff', entityId: u.id, note: u.name });
    res.json(await everything());
  }),
);

/** Lost phone: clear 2-step verification. They set it up again at their next sign-in. */
r.post(
  '/:id/reset-2fa',
  ah(async (req, res) => {
    const u = await User.findOne({ _id: req.params.id, role: 'admin' }).select('+totpSecret');
    if (!u) throw notFound('Staff member not found.');
    if (u.id === req.user.id) throw forbidden("Another Managing Director must reset your own 2-step verification.");
    u.set({ twoFactor: false, totpSecret: undefined });
    await u.save();
    await endSessions({ userId: u.id }, { by: req.user.id, reason: '2fa_reset' });
    await audit(req.user, { action: 'Reset 2-step verification', entityType: 'staff', entityId: u.id, note: `${u.name} must set it up again at their next sign-in.` });
    res.json(await everything());
  }),
);

// ── Roles and permissions
const RoleInput = z.object({
  name: z.string().trim().min(3, 'Name the role').max(50),
  description: z.string().trim().max(300).optional(),
  permissions: z.array(z.enum(PERMISSION_KEYS)).min(1, 'Choose at least one permission'),
});
const roleKey = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'role';

r.post(
  '/roles',
  ah(async (req, res) => {
    const d = parse(RoleInput, req.body);
    const roles = await rolesByKey();
    if (Object.values(roles).some((x) => x.name.toLowerCase() === d.name.toLowerCase())) throw conflict('A role with that name already exists.');
    let key = roleKey(d.name);
    for (let n = 2; roles[key]; n += 1) key = `${roleKey(d.name)}_${n}`;
    await AdminRole.create({ _id: key, name: d.name, description: d.description || '', permissions: d.permissions, locked: false, order: Object.keys(roles).length, createdAt: new Date().toISOString(), updatedBy: req.user.name });
    invalidateRoles();
    await audit(req.user, { action: 'Created admin role', entityType: 'role', entityId: key, note: d.name, changes: { permissions: [null, d.permissions] } });
    res.status(201).json(await everything());
  }),
);

r.patch(
  '/roles/:key',
  ah(async (req, res) => {
    const d = parse(RoleInput.partial(), req.body);
    const role = await AdminRole.findById(req.params.key);
    if (!role) throw notFound('Role not found.');
    if (role.locked) throw badRequest('The Managing Director role always has full access and cannot be changed.');
    const before = role.toObject();
    role.set({ ...d, updatedAt: new Date().toISOString(), updatedBy: req.user.name });
    await role.save();
    invalidateRoles();
    // People in this role get the new permissions on their next request; end sessions so menus refresh.
    const holders = await User.find({ role: 'admin', adminRole: role._id }, { _id: 1 }).lean();
    await Promise.all(holders.map((h) => endSessions({ userId: h._id }, { by: req.user.id, reason: 'role_changed', except: h._id === req.user.id ? req.sessionId : undefined })));
    await audit(req.user, { action: 'Changed admin role', entityType: 'role', entityId: role._id, note: role.name, changes: diff(before, role.toObject(), ['name', 'description', 'permissions']) });
    res.json(await everything());
  }),
);

r.delete(
  '/roles/:key',
  ah(async (req, res) => {
    const role = await AdminRole.findById(req.params.key);
    if (!role) throw notFound('Role not found.');
    if (role.locked) throw badRequest("The Managing Director role can't be removed.");
    const n = await User.countDocuments({ role: 'admin', adminRole: role._id, status: 'active' });
    if (n) throw conflict(`${n} staff member${n === 1 ? ' has' : 's have'} this role. Give them another role first.`);
    await AdminRole.deleteOne({ _id: role._id });
    invalidateRoles();
    await audit(req.user, { action: 'Removed admin role', entityType: 'role', entityId: role._id, note: role.name });
    res.json(await everything());
  }),
);

export default r;
export { activeSessions };
