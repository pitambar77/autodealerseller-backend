// Who may do what in the admin console: roles (AdminRole collection) and their permissions.
import { AdminRole, User } from '../models/index.js';
import { DEFAULT_ADMIN_ROLES, PERMISSION_KEYS, allows } from '../shared/permissions.js';

let cache = null;
let cachedAt = 0;
const TTL = 30_000; // other API servers pick up role changes within 30 s

/** Create the built-in roles if they're missing, and give admins without a role the MD role. */
export async function ensureDefaultRoles() {
  const existing = new Set((await AdminRole.find({}, { _id: 1 }).lean()).map((r) => r._id));
  const missing = DEFAULT_ADMIN_ROLES.filter((r) => !existing.has(r.key));
  if (missing.length) {
    await AdminRole.insertMany(missing.map((r, i) => ({ _id: r.key, name: r.name, description: r.description, permissions: r.permissions, locked: !!r.locked, order: DEFAULT_ADMIN_ROLES.indexOf(r) ?? i, createdAt: new Date().toISOString() })));
  }
  // Accounts from before roles existed: the first admins become MDs (they could do everything before).
  await User.updateMany({ role: 'admin', adminRole: { $exists: false } }, { $set: { adminRole: 'md' } });
  invalidateRoles();
}

export function invalidateRoles() {
  cache = null;
}

export async function rolesByKey() {
  if (!cache || Date.now() - cachedAt > TTL) {
    const list = await AdminRole.find().sort({ order: 1, createdAt: 1 }).lean();
    cache = Object.fromEntries(list.map((r) => [r._id, { ...r, key: r._id }]));
    cachedAt = Date.now();
  }
  return cache;
}

/** The permission list of an admin account ([] for everyone else). */
export async function permissionsFor(user) {
  if (!user || user.role !== 'admin') return [];
  const roles = await rolesByKey();
  const role = roles[user.adminRole || ''];
  if (!role) return [];
  return role.permissions.includes('*') ? ['*'] : role.permissions.filter((p) => PERMISSION_KEYS.includes(p));
}

export const can = (perms, perm) => allows(perms, perm);
