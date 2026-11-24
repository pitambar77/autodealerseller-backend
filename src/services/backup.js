// Database backups and restore.
//
// A backup is one file holding every collection (and, with local file storage, the uploaded photos
// and documents): gzip-compressed JSON lines, optionally encrypted with AES-256-GCM
// (BACKUP_ENCRYPTION_KEY). Each backup's SHA-256 is recorded so a restore can check the file is intact.
// An off-site copy goes to Cloudinary (private) or another folder (BACKUP_OFFSITE).
//
// File layout (encrypted): "ADBK1" | salt(16) | iv(12) | tag(16) | ciphertext(gzip(json lines))
// Lines: {"type":"header",...} then {"c":"<collection>","d":<EJSON doc>} and {"f":"<path>","b64":"..."}
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import { BSON } from 'mongodb';
import { config } from '../config.js';
import { Backup } from '../models/index.js';
import { uid } from '../lib/ids.js';
import { cloudinaryClient, driver, root as uploadRoot } from './storage.js';
import { verifyAuditChain } from './audit.js';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const MAGIC = Buffer.from('ADBK1');
const { EJSON } = BSON;

export const backupDir = () => path.resolve(config.backup.dir);
const keyFor = (salt) => crypto.scryptSync(config.backup.encryptionKey, salt, 32);

function encrypt(buf) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFor(salt), iv);
  const body = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]);
}

function decrypt(buf) {
  if (!buf.subarray(0, 5).equals(MAGIC)) return buf; // not encrypted
  if (!config.backup.encryptionKey) throw new Error('This backup is encrypted. Set BACKUP_ENCRYPTION_KEY to the key used when it was made.');
  const salt = buf.subarray(5, 21);
  const iv = buf.subarray(21, 33);
  const tag = buf.subarray(33, 49);
  const d = crypto.createDecipheriv('aes-256-gcm', keyFor(salt), iv);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(buf.subarray(49)), d.final()]);
  } catch {
    throw new Error('Could not decrypt the backup: wrong BACKUP_ENCRYPTION_KEY, or the file was changed.');
  }
}

function listFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]));
}

async function sendOffsite(file, name) {
  const target = config.backup.offsite;
  if (!target) return { ok: false, skipped: true };
  if (target === 'cloudinary') {
    const r = await cloudinaryClient().uploader.upload(file, { resource_type: 'raw', type: 'authenticated', folder: `${config.storage.cloudinary.folder}/backups`, public_id: name, overwrite: false });
    return { ok: true, where: 'cloudinary', ref: r.public_id };
  }
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(file, path.join(target, name));
  return { ok: true, where: 'folder', ref: path.join(target, name) };
}

function prune() {
  const dir = backupDir();
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^autodealer-.*\.(adbak|jsonl\.gz)$/.test(f)).sort() : [];
  files.slice(0, Math.max(0, files.length - config.backup.keep)).forEach((f) => fs.rmSync(path.join(dir, f), { force: true }));
}

/** Make a backup now. `by` = who asked ('scheduler' or a staff name). */
export async function runBackup(by = 'scheduler') {
  const at = new Date();
  const db = mongoose.connection.db;
  const collections = (await db.listCollections().toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.') && n !== 'sessions' && n !== 'otps');
  const lines = [JSON.stringify({ type: 'header', format: 'autodealer-backup', version: 1, createdAt: at.toISOString(), collections })];
  const counts = {};
  for (const name of collections) {
    counts[name] = 0;
    for await (const doc of db.collection(name).find()) {
      lines.push(JSON.stringify({ c: name, d: EJSON.serialize(doc, { relaxed: false }) }));
      counts[name] += 1;
    }
  }
  let files = 0;
  if (config.backup.includeFiles && driver() !== 'cloudinary') {
    for (const rel of listFiles(uploadRoot)) {
      lines.push(JSON.stringify({ f: rel, b64: fs.readFileSync(path.join(uploadRoot, rel)).toString('base64') }));
      files += 1;
    }
  }
  const audit = await verifyAuditChain().catch(() => null);
  lines.push(JSON.stringify({ type: 'footer', counts, files, auditHead: audit?.head || null }));
  let buf = await gzip(Buffer.from(lines.join('\n')));
  const encrypted = !!config.backup.encryptionKey;
  if (encrypted) buf = encrypt(buf);
  const stamp = at.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = `autodealer-${stamp}.${encrypted ? 'adbak' : 'jsonl.gz'}`;
  fs.mkdirSync(backupDir(), { recursive: true });
  const file = path.join(backupDir(), name);
  fs.writeFileSync(file, buf, { mode: 0o600 });
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  let offsite;
  try {
    offsite = await sendOffsite(file, name);
  } catch (e) {
    offsite = { ok: false, error: e.message };
  }
  prune();
  const rec = await Backup.create({ _id: uid('bk'), at: at.toISOString(), file: name, size: buf.length, sha256, encrypted, collections: counts, files, offsite, status: offsite.error ? 'local_only' : 'ok', by, auditHead: audit?.head || null });
  return rec.toObject();
}

/** Check a backup file: readable, decryptable, matches its recorded checksum. Returns its header and counts. */
export async function inspectBackup(file) {
  const raw = fs.readFileSync(file);
  const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
  const known = await Backup.findOne({ file: path.basename(file) }).lean().catch(() => null);
  if (known && known.sha256 !== sha256) throw new Error('The file does not match the checksum recorded when it was made: it was changed or damaged.');
  const lines = (await gunzip(decrypt(raw))).toString('utf8').split('\n');
  const header = JSON.parse(lines[0]);
  if (header.format !== 'autodealer-backup') throw new Error('This is not an AutoDealer backup file.');
  const footer = JSON.parse(lines[lines.length - 1]);
  return { header, footer, lines, sha256 };
}

/**
 * Restore a backup into the connected database. Replaces each collection in the backup.
 * Run from the command line only (npm run restore): see BACKUP_AND_RECOVERY.md.
 */
export async function restoreBackup(file, { log = console.log } = {}) {
  const { header, footer, lines } = await inspectBackup(file);
  const db = mongoose.connection.db;
  const byCol = {};
  const files = [];
  lines.slice(1, -1).forEach((l) => {
    const x = JSON.parse(l);
    if (x.c) (byCol[x.c] ||= []).push(EJSON.deserialize(x.d));
    else if (x.f) files.push(x);
  });
  for (const name of header.collections) {
    const docs = byCol[name] || [];
    await db.collection(name).deleteMany({});
    for (let i = 0; i < docs.length; i += 500) await db.collection(name).insertMany(docs.slice(i, i + 500), { ordered: false });
    log(`  ${name}: ${docs.length}`);
  }
  files.forEach(({ f, b64 }) => {
    const target = path.join(uploadRoot, f);
    if (!target.startsWith(uploadRoot)) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(b64, 'base64'));
  });
  if (files.length) log(`  files: ${files.length}`);
  return { createdAt: header.createdAt, counts: footer.counts, files: files.length };
}

let timer = null;
/** Back up every BACKUP_EVERY_HOURS while the API runs (first one 10 minutes after start). */
export function startBackupSchedule() {
  const h = config.backup.everyHours;
  if (!h) return false;
  const run = () => runBackup('scheduler').catch((e) => Backup.create({ _id: uid('bk'), at: new Date().toISOString(), status: 'failed', error: e.message, by: 'scheduler' }).catch(() => {}));
  setTimeout(run, 10 * 60_000).unref();
  timer = setInterval(run, h * 3600_000);
  timer.unref();
  return true;
}
