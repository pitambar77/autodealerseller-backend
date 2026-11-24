// Admin → Security (IT / Technical Administrator and the MD): sign-in attempts, locked accounts,
// active admin sessions and alerts about suspicious activity. Security rules are changed through
// PATCH /api/admin/config { security } (needs the same permission).
import { Router } from 'express';
import { AuditLog, LoginAttempt, Session, User } from '../models/index.js';
import { ah } from '../lib/http.js';
import { requirePermission } from '../middleware/auth.js';
import { getSecurity } from '../services/settings.js';

const r = Router();
r.use(requirePermission('system.security', 'staff.manage'));

r.get(
  '/',
  ah(async (_req, res) => {
    const since = new Date(Date.now() - 7 * 864e5);
    const day = new Date(Date.now() - 864e5);
    const [attempts, staff, sessions, sensitive] = await Promise.all([
      LoginAttempt.find({ at: { $gte: since } }).sort({ at: -1 }).limit(500).lean(),
      User.find({ role: 'admin' }, { name: 1, email: 1, status: 1, lockedUntil: 1, failedLogins: 1, twoFactor: 1, lastLoginAt: 1, lastLoginIp: 1, adminRole: 1 }).lean(),
      Session.find({ role: 'admin', revokedAt: { $exists: false } }).sort({ lastSeenAt: -1 }).lean(),
      AuditLog.find({ at: { $gte: day.toISOString() }, action: { $regex: '^(Requested|Approved|Deactivated|Changed admin role|Changed staff role|Reset 2-step|Removed|Downloaded backup)' } }).lean(),
    ]);
    const name = Object.fromEntries(staff.map((u) => [u._id, u.name]));

    // Alerts: what deserves a look.
    const alerts = [];
    const failsByIp = {};
    attempts.filter((a) => !a.ok && new Date(a.at) >= day).forEach((a) => (failsByIp[a.ip] = (failsByIp[a.ip] || 0) + 1));
    Object.entries(failsByIp).filter(([, n]) => n >= 5).forEach(([ip, n]) => alerts.push({ level: 'high', title: `${n} failed sign-ins from ${ip} in 24 hours`, body: 'Possible password guessing. Consider blocking this address at the firewall.' }));
    staff.filter((u) => u.lockedUntil && new Date(u.lockedUntil) > new Date()).forEach((u) => alerts.push({ level: 'high', title: `${u.name}'s account is locked`, body: `Until ${new Date(u.lockedUntil).toISOString()}. Unlock it in Team & roles if it was them.` }));
    attempts.filter((a) => a.flagged && a.reason === 'new_network' && new Date(a.at) >= since).forEach((a) => alerts.push({ level: 'medium', title: `New network sign-in: ${name[a.userId] || a.email}`, body: `From ${a.ip} on ${new Date(a.at).toISOString()}.`, at: a.at }));
    staff.filter((u) => u.status === 'active' && !u.twoFactor).forEach((u) => alerts.push({ level: 'medium', title: `${u.name} has no 2-step verification yet`, body: 'They will be asked to set it up at their next sign-in.' }));
    const perActor = {};
    sensitive.forEach((e) => (perActor[e.actor] = (perActor[e.actor] || 0) + 1));
    Object.entries(perActor).filter(([, n]) => n >= 10).forEach(([who, n]) => alerts.push({ level: 'medium', title: `${who}: ${n} sensitive actions in 24 hours`, body: 'Unusually many requests, approvals or account changes. Check the activity log.' }));

    res.json({
      settings: await getSecurity(),
      alerts,
      attempts: attempts.map((a) => ({ id: a._id, at: a.at, email: a.email, name: name[a.userId] || '', ip: a.ip, userAgent: a.userAgent, ok: a.ok, reason: a.reason, flagged: !!a.flagged })),
      sessions: sessions.map((s) => ({ id: s._id, userId: s.userId, name: name[s.userId] || s.userId, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt })),
      summary: {
        failed24h: attempts.filter((a) => !a.ok && new Date(a.at) >= day).length,
        signins24h: attempts.filter((a) => a.ok && new Date(a.at) >= day).length,
        locked: staff.filter((u) => u.lockedUntil && new Date(u.lockedUntil) > new Date()).length,
        without2fa: staff.filter((u) => u.status === 'active' && !u.twoFactor).length,
        activeSessions: sessions.length,
      },
    });
  }),
);

export default r;
