// Audit trail: every important admin action, with who did it, when, from where and what changed.
//
// Tamper evidence: entries are numbered (`seq`) and chained by SHA-256: each entry's hash covers its
// content and the previous entry's hash. Changing or deleting any entry breaks every hash after it,
// which verifyAuditChain() reports. The model refuses updates and deletes (models/misc.js).
import crypto from 'node:crypto';
import { AuditLog } from '../models/index.js';
import { uid } from '../lib/ids.js';
import { ctx } from '../lib/context.js';

const FIELDS = ['seq', 'at', 'actor', 'actorId', 'actorRole', 'adminRole', 'action', 'entityType', 'entityId', 'note', 'changes', 'ip'];
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
};
export const entryHash = (e, prevHash) => crypto.createHash('sha256').update(`${prevHash || ''}|${canonical(Object.fromEntries(FIELDS.map((f) => [f, e[f]])))}`).digest('hex');

// One writer at a time in this process keeps the chain in order; the unique index on `seq` guards
// against two API servers writing at the same moment (the loser retries).
let queue = Promise.resolve();

async function append(entry) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const last = await AuditLog.findOne({ seq: { $exists: true } }, { seq: 1, hash: 1 }).sort({ seq: -1 }).lean();
    const doc = { ...entry, seq: (last?.seq || 0) + 1 };
    doc.prevHash = last?.hash || '';
    doc.hash = entryHash(doc, doc.prevHash);
    try {
      return await AuditLog.create({ _id: uid('a'), ...doc });
    } catch (e) {
      if (e?.code !== 11000) throw e; // another server took this number: try the next one
    }
  }
  throw new Error('Could not write to the audit log.');
}

/**
 * Record an action. `actor` is the signed-in user (or null for the system).
 * `entry`: { action, entityType, entityId, note, changes? } — `changes` like { status: ['live', 'suspended'] }.
 */
// { field: [before, after] } is stored as { field: { from, to } } (some databases reject nested arrays).
const normChanges = (changes) =>
  changes && typeof changes === 'object'
    ? Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, Array.isArray(v) && v.length === 2 ? { from: v[0] ?? null, to: v[1] ?? null } : v]))
    : changes;

export function audit(actor, entry) {
  const c = ctx();
  if (entry?.changes) entry = { ...entry, changes: normChanges(entry.changes) };
  if (entry && 'changes' in entry && !entry.changes) delete entry.changes;
  const member = c.member; // a dealership team member acting for the dealer
  const record = {
    at: new Date().toISOString(),
    actor: member ? `${member.name} (for ${actor?.business || actor?.name})` : actor?.name || 'System',
    actorId: member ? member.id : actor?.id || actor?._id || 'system',
    actorRole: member ? 'dealer_team' : actor?.role || 'system',
    ...(actor?.adminRole ? { adminRole: actor.adminRole } : {}),
    ...(member ? { accountId: actor?.id } : {}),
    ...(c.ip ? { ip: c.ip } : {}),
    ...entry,
  };
  const p = queue.then(() => append(record));
  queue = p.catch(() => {});
  return p;
}

/** What changed between two versions: { field: [before, after] } for the given fields. */
export function diff(before, after, fields) {
  const out = {};
  fields.forEach((f) => {
    const a = before?.[f];
    const b = after?.[f];
    if (JSON.stringify(a) !== JSON.stringify(b)) out[f] = [a ?? null, b ?? null];
  });
  return Object.keys(out).length ? out : undefined;
}

/** Walk the chain and report the first entry that doesn't match. */
export async function verifyAuditChain() {
  const cursor = AuditLog.find({ seq: { $exists: true } }).sort({ seq: 1 }).lean().cursor();
  let prev = '';
  let expectedSeq = null;
  let checked = 0;
  for await (const e of cursor) {
    if (expectedSeq !== null && e.seq !== expectedSeq) return { ok: false, checked, problem: `Entry number ${expectedSeq} is missing (deleted).`, at: e.at, seq: expectedSeq };
    if (e.prevHash !== prev || entryHash(e, prev) !== e.hash) return { ok: false, checked, problem: `Entry number ${e.seq} was changed after it was written.`, at: e.at, seq: e.seq, id: e._id };
    prev = e.hash;
    expectedSeq = e.seq + 1;
    checked += 1;
  }
  const legacy = await AuditLog.countDocuments({ seq: { $exists: false } });
  return { ok: true, checked, head: prev, legacy };
}
