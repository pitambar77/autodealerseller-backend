import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { Session, TeamMember, User } from '../models/index.js';
import { forbidden, unauthorized } from '../lib/http.js';
import { setCtx } from '../lib/context.js';
import { permissionsFor, can } from '../services/access.js';
import { getSecurity } from '../services/settings.js';
import { allows } from '../shared/permissions.js';

/**
 * Sign a token for a session. `v` is the user's session version ("sign out other devices" bumps it),
 * `sid` the server-side session, `mid` a dealership team member acting for the dealer account.
 */
export const signToken = (user, { sid, mid } = {}) =>
  jwt.sign({ sub: user.id || user._id, role: user.role, v: user.get?.('tokenVersion') ?? user.tokenVersion ?? 0, ...(sid ? { sid } : {}), ...(mid ? { mid } : {}) }, config.jwtSecret, { expiresIn: user.role === 'admin' ? '12h' : config.jwtExpiresIn });

const SIGNED_OUT = {
  idle: 'You were signed out after a period of inactivity. Sign in again to continue.',
  expired: 'Your session has expired. Sign in again to continue.',
  ended: 'Your session was ended. Sign in again to continue.',
};

/**
 * Reads "Authorization: Bearer <token>" and loads req.user (and req.member for dealership staff,
 * req.perms for admin staff). Never fails: guests get req.user = null, and req.authError says why
 * a token was refused (so the website can explain it).
 */
export async function attachUser(req, _res, next) {
  req.user = null;
  req.member = null;
  req.perms = [];
  req.sessionId = null;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return next();
  try {
    const payload = jwt.verify(h.slice(7), config.jwtSecret);
    const user = await User.findById(payload.sub);
    if (!user || user.status !== 'active' || (payload.v ?? 0) !== (user.get('tokenVersion') ?? 0)) return next();
    const isAdmin = user.role === 'admin';
    if (!payload.sid) {
      // Tokens from before server-side sessions: sign in again.
      req.authError = SIGNED_OUT.expired;
      return next();
    }

    if (payload.sid) {
      const s = await Session.findById(payload.sid).lean();
      if (!s || s.revokedAt || s.userId !== user.id) {
        req.authError = SIGNED_OUT[s?.endReason === 'idle' ? 'idle' : 'ended'];
        return next();
      }
      const now = Date.now();
      if (isAdmin) {
        const sec = await getSecurity();
        if (now - new Date(s.lastSeenAt).getTime() > sec.adminIdleMinutes * 60_000) {
          await Session.updateOne({ _id: s._id }, { $set: { revokedAt: new Date(), revokedBy: 'system', endReason: 'idle' } });
          req.authError = SIGNED_OUT.idle;
          return next();
        }
        if (now - new Date(s.createdAt).getTime() > sec.adminSessionHours * 3600_000) {
          await Session.updateOne({ _id: s._id }, { $set: { revokedAt: new Date(), revokedBy: 'system', endReason: 'expired' } });
          req.authError = SIGNED_OUT.expired;
          return next();
        }
      }
      // Background polling (live events, bootstrap refresh) shouldn't count as activity for idle sign-out.
      const passive = req.headers['x-passive'] === '1' || req.path === '/events';
      if (!passive && now - new Date(s.lastSeenAt).getTime() > 30_000) Session.updateOne({ _id: s._id }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
      req.sessionId = s._id;
    }

    if (payload.mid) {
      const m = await TeamMember.findById(payload.mid).lean();
      if (!m || !['active', 'invited'].includes(m.status) || m.accountId !== user.id) {
        req.authError = SIGNED_OUT.ended;
        return next();
      }
      req.member = { ...m, id: m._id };
      setCtx({ member: req.member });
    }
    req.user = user;
    if (isAdmin) req.perms = await permissionsFor(user);
  } catch {
    /* expired or invalid token: treat as guest */
  }
  return next();
}

export const requireAuth = (req, _res, next) => (req.user ? next() : next(unauthorized(req.authError)));

/** Only these roles may continue. */
export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized(req.authError));
    if (!roles.includes(req.user.role)) return next(forbidden(`This needs a ${roles.join(' or ')} account.`));
    return next();
  };

/** Admin staff with at least one of these permissions (the MD has all of them). */
export const requirePermission =
  (...perms) =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized(req.authError));
    if (req.user.role !== 'admin') return next(forbidden('This needs an admin account.'));
    if (!perms.some((p) => can(req.perms, p))) return next(forbidden("Your admin role doesn't include this. Ask the Managing Director if you need access."));
    return next();
  };

/** Dealer and agent team members may only do what the owner allowed; the owner (and everyone else) may do everything. */
export const requireTeamPermission =
  (perm) =>
  (req, _res, next) => {
    if (req.member && !allows(req.member.permissions, perm)) return next(forbidden("The account owner hasn't given you access to this. Ask them if you need it."));
    return next();
  };

export const memberCan = (req, perm) => !req.member || allows(req.member.permissions, perm);
export const adminCan = (req, perm) => req.user?.role === 'admin' && can(req.perms, perm);

export const SELLER_ROLES = ['dealer', 'seller', 'agent'];
