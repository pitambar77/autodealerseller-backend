// Server-side sessions: every sign-in creates one, and the token carries its id. Ending a session
// (sign out, "sign out other devices", the MD ending a staff session, idle timeout) takes effect on
// the next request, wherever the token is.
import { Session } from '../models/index.js';
import { uid } from '../lib/ids.js';
import { ctx } from '../lib/context.js';

export async function startSession(user, { memberId } = {}) {
  const c = ctx();
  const now = new Date();
  const s = await Session.create({ _id: uid('ses'), userId: user.id || user._id, memberId: memberId || undefined, role: memberId ? 'dealer_team' : user.role, ip: c.ip, userAgent: c.userAgent, createdAt: now, lastSeenAt: now });
  return s._id;
}

/** End sessions. `filter` e.g. { userId } or { _id }. Returns how many were ended. */
export async function endSessions(filter, { by = 'system', reason = 'signed_out', except } = {}) {
  const q = { ...filter, revokedAt: { $exists: false } };
  if (except) q._id = { $ne: except };
  const r = await Session.updateMany(q, { $set: { revokedAt: new Date(), revokedBy: by, endReason: reason } });
  return r.modifiedCount || 0;
}

export const activeSessions = (filter) => Session.find({ ...filter, revokedAt: { $exists: false } }).sort({ lastSeenAt: -1 }).lean();
