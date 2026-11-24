import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import { z } from 'zod';
import { config } from '../config.js';
import { User, Invite, Vehicle, LoginAttempt, TeamMember, AdminRole } from '../models/index.js';
import { ah, parse, badRequest, conflict, forbidden, unauthorized, notFound } from '../lib/http.js';
import { phoneKey, uid, sha256 } from '../lib/ids.js';
import { issueOtp, checkOtp } from '../services/otp.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { privateUser } from '../services/serialize.js';
import { audit } from '../services/audit.js';
import { otpLimiter, loginLimiter } from '../middleware/limits.js';
import { notifyAdmins, notifyStaffWith, webLink } from '../services/notify.js';
import { startSession } from '../services/sessions.js';
import { getSecurity } from '../services/settings.js';
import { ctx } from '../lib/context.js';
import { permissionsFor } from '../services/access.js';
import { passwordProblem } from '../services/passwords.js';
const ROLE_LABEL = { seller: 'private seller', agent: 'agent', dealer: 'dealer', buyer: 'buyer' };

const r = Router();
const phone = z.string().trim().min(8, 'Enter a valid mobile number').max(24);
const SELF_SERVICE_ROLES = ['dealer', 'seller', 'agent', 'buyer'];
/** Proof that a phone number was verified by OTP, used to finish registration. Valid 30 minutes. */
const regToken = (p) => jwt.sign({ phoneKey: phoneKey(p), phone: p, purpose: 'register' }, config.jwtSecret, { expiresIn: '30m' });

/** Start a server-side session and return { token, user } for the website. */
const session = async (user, { memberId } = {}) => {
  const sid = await startSession(user, { memberId });
  return { token: signToken(user, { sid, mid: memberId }), user: privateUser(user) };
};

/** Is this number registered? (Sign-in and registration screens use it to route the user.) */
r.post(
  '/phone-status',
  otpLimiter,
  ah(async (req, res) => {
    const { phone: p } = parse(z.object({ phone }), req.body);
    const u = await User.findOne({ phoneKey: phoneKey(p) });
    if (!u) {
      // A dealer's or agent's team member signs in with their own number (and works in the owner's account).
      const m = await TeamMember.findOne({ phoneKey: phoneKey(p), status: { $in: ['invited', 'active'] } }).lean();
      if (m) {
        const owner = await User.findById(m.accountId, { role: 1 }).lean();
        return res.json({ registered: true, role: owner?.role || 'dealer', status: 'active', team: true });
      }
    }
    res.json({ registered: !!u, role: u?.role || null, status: u?.status || null });
  }),
);

/** Send a 6-digit code by SMS. */
r.post(
  '/otp/request',
  otpLimiter,
  ah(async (req, res) => {
    const { phone: p } = parse(z.object({ phone }), req.body);
    const out = await issueOtp(p);
    res.json(out);
  }),
);

/**
 * Check the code. Registered number → signed in ({ token, user }).
 * New number → { registrationToken } to finish creating the account with /auth/register.
 */
r.post(
  '/otp/verify',
  loginLimiter,
  ah(async (req, res) => {
    const { phone: p, code } = parse(z.object({ phone, code: z.string().regex(/^\d{6}$/, 'Enter all 6 digits.') }), req.body);
    await checkOtp(p, code);
    const user = await User.findOne({ phoneKey: phoneKey(p) });
    if (!user) {
      // Dealer or agent staff: sign in to the owner's account as themselves.
      const m = await TeamMember.findOne({ phoneKey: phoneKey(p), status: { $in: ['invited', 'active'] } });
      if (m) {
        const owner = await User.findById(m.accountId);
        if (!owner || owner.status !== 'active') return res.status(403).json({ error: 'This team account is not active.', details: { reason: 'suspended' } });
        const first = m.status === 'invited';
        m.set({ status: 'active', lastActiveAt: new Date().toISOString(), ...(first ? { joinedAt: new Date().toISOString() } : {}) });
        await m.save();
        await audit(owner, { action: first ? 'Team member joined' : 'Team member signed in', entityType: 'team', entityId: m.id, note: m.name });
        const out = await session(owner, { memberId: m.id });
        return res.json({ verified: true, registered: true, ...out, member: { id: m.id, name: m.name, title: m.title || '' } });
      }
      return res.json({ verified: true, registered: false, registrationToken: regToken(p) });
    }
    if (user.status === 'suspended') return res.status(403).json({ error: 'This account is suspended.', details: { reason: 'suspended' } });
    if (user.role === 'admin') return res.status(403).json({ error: 'Admins sign in with email and password.', details: { reason: 'admin' } });
    // Signing in within 7 days of asking to close the account cancels the closure.
    if (user.get('closureRequestedAt')) {
      user.set('closureRequestedAt', undefined);
      await user.save();
      await Vehicle.updateMany({ sellerId: user.id, suspendedWithUser: true }, { status: 'live', suspendedWithUser: false });
      await audit(user, { action: 'Cancelled account closure', entityType: 'user', entityId: user.id });
    }
    return res.json({ verified: true, registered: true, ...(await session(user)) });
  }),
);

const PROFILE_FIELDS = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name').max(80),
    email: z.string().trim().email('Enter a valid email').or(z.literal('')).optional(),
    city: z.string().trim().max(60).optional(),
  })
  .passthrough();

/** Create an account after the phone number is verified. Extra profile fields are kept as sent. */
r.post(
  '/register',
  ah(async (req, res) => {
    const { registrationToken, role, ...rest } = req.body || {};
    if (!SELF_SERVICE_ROLES.includes(role)) throw badRequest('Choose an account type.');
    let claim;
    try {
      claim = jwt.verify(registrationToken || '', config.jwtSecret);
    } catch {
      throw unauthorized('Verify your mobile number again to continue.');
    }
    if (claim.purpose !== 'register') throw unauthorized('Verify your mobile number again to continue.');
    const profile = parse(PROFILE_FIELDS, rest);
    if (await User.exists({ phoneKey: claim.phoneKey })) throw conflict('This number already has an account. Sign in instead.');
    // Never accept privileged fields from the client.
    ['id', '_id', 'status', 'docStatus', 'passwordHash', 'totpSecret', 'twoFactor', 'lenderId', 'buyer', 'registeredAt', 'phone', 'phoneKey'].forEach((k) => delete profile[k]);
    const user = await User.create({
      ...profile,
      _id: uid('u'),
      role,
      phone: claim.phone,
      phoneKey: claim.phoneKey,
      email: profile.email || '',
      city: profile.city || '',
      status: 'active',
      docStatus: 'not_submitted',
      registeredAt: new Date().toISOString(),
    });
    await audit(user, { action: 'Registered account', entityType: 'user', entityId: user.id, note: role });
    // Tell the admins (bell + email). Never holds up the sign-up.
    const who = user.business || user.agency || user.name;
    const label = ROLE_LABEL[role] || role;
    notifyAdmins({
      perm: 'users.view',
      kind: 'registration',
      title: `New ${label} registered: ${who}`,
      body: [user.name !== who && user.name, user.phone, user.city, role === 'buyer' ? '' : 'Documents to verify once uploaded.'].filter(Boolean).join(' · '),
      link: `/admin/users?q=${encodeURIComponent(user.phone)}`,
      refId: user.id,
      email: {
        subject: `New ${label} on AutoDealer: ${who}`,
        heading: `A new ${label} just registered`,
        lines: [`${who}${user.name !== who ? ` (${user.name})` : ''}`, `Mobile: ${user.phone}${user.email ? `\nEmail: ${user.email}` : ''}${user.city ? `\nCity: ${user.city}` : ''}`, role === 'buyer' ? '' : 'Their verification documents will appear in the documents queue once uploaded.'].filter(Boolean),
        button: { label: 'Open in admin', url: webLink(`/admin/users?q=${encodeURIComponent(user.phone)}`) },
      },
    }).catch((e) => console.error('[notify] registration:', e.message));
    res.status(201).json(await session(user));
  }),
);

/** Record an admin sign-in attempt (kept for Admin → Security). */
const recordAttempt = (email, user, ok, reason, flagged = false) => {
  const c = ctx();
  return LoginAttempt.create({ _id: uid('la'), at: new Date(), email, userId: user?.id, ip: c.ip, userAgent: c.userAgent, ok, reason, flagged }).catch(() => {});
};
const lockedMessage = (until) => `This account is locked after too many failed sign-in attempts. Try again after ${new Date(until).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Dar_es_Salaam' })} (Tanzania time), or ask the Managing Director to unlock it.`;
const setupToken = (user, secret) => jwt.sign({ sub: user.id, secret, purpose: 'totp-setup' }, config.jwtSecret, { expiresIn: '15m' });

/**
 * Admin console sign-in: email + password, then the authenticator code.
 * - Each staff member has their own account (no shared logins); 2-step verification is required.
 * - Too many wrong passwords or codes lock the account for a while (Admin → Security sets the limits).
 * - Staff without an authenticator yet are asked to set one up before they get in.
 */
r.post(
  '/admin/login',
  loginLimiter,
  ah(async (req, res) => {
    const d = parse(z.object({ email: z.string().trim().email(), password: z.string().min(1), totp: z.string().optional() }), req.body);
    const email = d.email.toLowerCase();
    const sec = await getSecurity();
    const admin = await User.findOne({ role: 'admin', email }).select('+passwordHash +totpSecret');
    if (admin?.lockedUntil && admin.lockedUntil > new Date()) {
      await recordAttempt(email, admin, false, 'locked');
      return res.status(423).json({ error: lockedMessage(admin.lockedUntil), details: { reason: 'locked', until: admin.lockedUntil } });
    }
    const fail = async (reason, message) => {
      let locked = false;
      if (admin) {
        const n = (admin.failedLogins || 0) + 1;
        admin.failedLogins = n;
        if (n >= sec.maxFailedLogins) {
          admin.lockedUntil = new Date(Date.now() + sec.lockMinutes * 60_000);
          admin.failedLogins = 0;
          locked = true;
        }
        await admin.save();
      }
      await recordAttempt(email, admin, false, reason, locked);
      if (locked) {
        await audit(admin, { action: 'Account locked', entityType: 'staff', entityId: admin.id, note: `${sec.maxFailedLogins} failed sign-in attempts in a row (${reason}).` });
        notifyStaffWith('staff.manage', { kind: 'security', title: `Admin account locked: ${admin.name}`, body: `${sec.maxFailedLogins} failed sign-in attempts in a row. Locked for ${sec.lockMinutes} minutes.`, link: '/admin/security', refId: admin.id }).catch(() => {});
        return res.status(423).json({ error: lockedMessage(admin.lockedUntil), details: { reason: 'locked', until: admin.lockedUntil } });
      }
      const left = admin ? sec.maxFailedLogins - admin.failedLogins : null;
      return res.status(401).json({ error: left && left <= 2 ? `${message} ${left} attempt${left === 1 ? '' : 's'} left before the account is locked.` : message });
    };
    if (!admin || !admin.passwordHash || !(await bcrypt.compare(d.password, admin.passwordHash))) return fail('password', "That email and password combination isn't recognised.");
    if (admin.status !== 'active') {
      await recordAttempt(email, admin, false, 'deactivated');
      throw forbidden('This admin account has been deactivated. Contact the Managing Director.');
    }
    if (admin.twoFactor && admin.totpSecret) {
      if (!d.totp) return res.json({ needsTotp: true });
      if (!authenticator.check(String(d.totp).replace(/\s/g, ''), admin.totpSecret)) return fail('totp', 'That authenticator code is incorrect.');
    } else if (sec.adminTwoFactorRequired) {
      // 2-step verification is required for staff: set it up now, before signing in.
      const secret = authenticator.generateSecret();
      await recordAttempt(email, admin, false, 'totp_setup_required');
      return res.json({ needsTotpSetup: true, setupToken: setupToken(admin, secret), secret, otpauthUrl: authenticator.keyuri(admin.email, 'AutoDealer Admin', secret) });
    }
    return res.json(await finishAdminLogin(admin, email));
  }),
);

/** Successful staff sign-in: reset counters, flag sign-ins from a new network, start the session. */
async function finishAdminLogin(admin, email) {
  const c = ctx();
  const knownIp = admin.lastLoginIp ? await LoginAttemptKnown(admin.id, c.ip) : true;
  admin.failedLogins = 0;
  admin.lockedUntil = undefined;
  admin.lastLoginAt = new Date().toISOString();
  admin.lastLoginIp = c.ip;
  await admin.save();
  const flagged = !knownIp;
  await recordAttempt(email, admin, true, flagged ? 'new_network' : 'ok', flagged);
  await audit(admin, { action: 'Signed in to admin console', entityType: 'staff', entityId: admin.id, note: flagged ? `New network: ${c.ip}` : undefined });
  if (flagged) notifyStaffWith('system.security', { kind: 'security', title: `Sign-in from a new network: ${admin.name}`, body: `IP ${c.ip}. If this wasn't them, end their sessions in Admin → Team.`, link: '/admin/security', refId: admin.id }).catch(() => {});
  const out = await session(admin);
  return { ...out, permissions: await permissionsFor(admin) };
}
const LoginAttemptKnown = async (userId, ip) => !!(await LoginAttempt.exists({ userId, ip, ok: true }));

/** Finish setting up 2-step verification at sign-in (staff who didn't have it yet). */
r.post(
  '/admin/login/totp-setup',
  loginLimiter,
  ah(async (req, res) => {
    const d = parse(z.object({ setupToken: z.string(), totp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.') }), req.body);
    let t;
    try {
      t = jwt.verify(d.setupToken, config.jwtSecret);
    } catch {
      throw badRequest('This set-up has expired. Sign in again to start over.');
    }
    if (t.purpose !== 'totp-setup') throw badRequest('Sign in again to start over.');
    if (!authenticator.check(d.totp, t.secret)) throw badRequest('That code is incorrect. Enter the 6 digits shown in your authenticator app now.', { fields: { totp: 'wrong' } });
    const admin = await User.findById(t.sub).select('+passwordHash +totpSecret');
    if (!admin || admin.role !== 'admin' || admin.status !== 'active') throw forbidden();
    admin.totpSecret = t.secret;
    admin.twoFactor = true;
    await admin.save();
    await audit(admin, { action: 'Set up 2-step verification', entityType: 'staff', entityId: admin.id });
    res.json(await finishAdminLogin(admin, admin.email));
  }),
);

const inviteFind = async (code, email) => {
  const inv = await Invite.findOne({ codeHash: sha256(String(code).trim().toUpperCase()) }).select('+totpSecret');
  if (!inv || inv.usedAt || inv.expiresAt < new Date()) throw badRequest("That invitation code isn't valid or has expired. Ask the admin who invited you to resend it.", { fields: { code: 'invalid' } });
  if (inv.email.toLowerCase() !== String(email).trim().toLowerCase()) throw badRequest('Use the work email the invitation was sent to.', { fields: { email: 'mismatch' } });
  return inv;
};

/** Step 1 of accepting an admin invite: check code + email, and create the authenticator secret. */
r.post(
  '/admin/invite/check',
  loginLimiter,
  ah(async (req, res) => {
    const { code, email } = req.body || {};
    const inv = await inviteFind(code, email);
    if (!inv.totpSecret) {
      inv.totpSecret = authenticator.generateSecret();
      await inv.save();
    }
    const role = inv.adminRole ? await AdminRole.findById(inv.adminRole).lean() : null;
    res.json({ ok: true, team: role?.name || inv.team, name: inv.name || '', otpauthUrl: authenticator.keyuri(inv.email, 'AutoDealer Admin', inv.totpSecret), secret: inv.totpSecret });
  }),
);

/** Final step: create the admin account (password + authenticator code). */
r.post(
  '/admin/invite/accept',
  loginLimiter,
  ah(async (req, res) => {
    const d = parse(
      z.object({
        code: z.string(),
        email: z.string().email(),
        name: z.string().trim().min(3),
        team: z.string().optional(),
        phone,
        password: z.string().min(1),
        totp: z.string().regex(/^\d{6}$/),
      }),
      req.body,
    );
    const inv = await inviteFind(d.code, d.email);
    const weak = passwordProblem(d.password, { email: d.email, name: d.name });
    if (weak) throw badRequest(weak, { fields: { password: weak } });
    if (!authenticator.check(d.totp, inv.totpSecret)) throw badRequest('That code is incorrect. Enter the 6 digits shown in your authenticator app.', { fields: { otp: 'wrong' } });
    if (await User.exists({ phoneKey: phoneKey(d.phone) })) throw conflict('That mobile number already has an account.');
    const user = await User.create({
      _id: uid('u'),
      role: 'admin',
      name: d.name,
      phone: d.phone,
      phoneKey: phoneKey(d.phone),
      email: d.email.toLowerCase(),
      team: inv.team || d.team,
      adminRole: inv.adminRole || 'operations',
      docStatus: 'verified',
      passwordHash: await bcrypt.hash(d.password, 12),
      passwordChangedAt: new Date().toISOString(),
      totpSecret: inv.totpSecret,
      twoFactor: true,
    });
    inv.usedAt = new Date();
    await inv.save();
    await audit(user, { action: 'Activated admin account', entityType: 'staff', entityId: user.id, note: `Role: ${inv.team || inv.adminRole}. Invited by ${inv.createdBy}.` });
    res.status(201).json(await finishAdminLogin(user, user.email));
  }),
);

r.get(
  '/me',
  requireAuth,
  ah(async (req, res) => res.json({ user: privateUser(req.user) })),
);

/** Development only (ALLOW_DEMO_LOGIN=true): sign in as a seeded demo account without OTP. */
r.post(
  '/demo-login',
  ah(async (req, res) => {
    if (!config.allowDemoLogin) throw notFound();
    const user = await User.findById(req.body?.userId);
    if (!user) throw notFound('No such demo user.');
    // Demo: sign in as a dealership team member with { memberId }.
    const memberId = req.body?.memberId;
    if (memberId && !(await TeamMember.exists({ _id: memberId, accountId: user.id }))) throw notFound('No such team member.');
    res.json(await session(user, { memberId }));
  }),
);

export default r;
