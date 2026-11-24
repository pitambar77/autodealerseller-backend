// File storage for listing photos (public) and identity / business documents (private).
//
// STORAGE_DRIVER=local       files go to UPLOAD_DIR on this server (good for development)
// STORAGE_DRIVER=cloudinary  files go to Cloudinary: set CLOUDINARY_URL (or CLOUDINARY_CLOUD_NAME,
//                            CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET) and optionally CLOUDINARY_FOLDER
//
// Stored keys:
//   photos/<uuid>.jpg, docs/<uuid>.pdf                 local files
//   cld:<resource>/<delivery>/<public_id>.<ext>        Cloudinary, e.g. cld:image/upload/autodealer/photos/<uuid>.jpg
//
// Photos are public and served by Cloudinary's CDN (auto format and quality). Documents are uploaded as
// "authenticated" assets, so Cloudinary never serves them publicly: the API hands out short-lived signed
// links (/files/…) and fetches the file from Cloudinary only when the link is valid.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config.js';
import { badRequest } from '../lib/http.js';

const TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(TYPES).map(([m, e]) => [e, m]));
export const root = path.resolve(config.uploadDir);
export const driver = () => config.storage.driver;

// ── Cloudinary set-up
let cldReady = false;
function cld() {
  if (!cldReady) {
    const c = config.storage.cloudinary;
    if (c.url) {
      process.env.CLOUDINARY_URL = c.url; // the SDK reads it from the environment
      cloudinary.config(true);
    } else {
      cloudinary.config({ cloud_name: c.cloudName, api_key: c.apiKey, api_secret: c.apiSecret });
    }
    cloudinary.config({ secure: true });
    if (!cloudinary.config().cloud_name || !cloudinary.config().api_secret) {
      throw new Error('STORAGE_DRIVER=cloudinary needs CLOUDINARY_URL, or CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET.');
    }
    cldReady = true;
  }
  return cloudinary;
}
export const cloudinaryClient = cld;

/** cld:image/upload/autodealer/photos/x.jpg → { resource: 'image', delivery: 'upload', publicId: 'autodealer/photos/x', format: 'jpg' } */
export function parseCldKey(key) {
  const m = /^cld:(image|video|raw)\/(upload|authenticated|private)\/(.+?)(?:\.([a-z0-9]+))?$/i.exec(key || '');
  return m ? { resource: m[1], delivery: m[2], publicId: m[3], format: m[4] ? m[4].toLowerCase() : undefined } : null;
}

/** Public CDN address of a Cloudinary photo (images get automatic format and quality). */
function cldPublicUrl({ resource, publicId, format }) {
  const tr = resource === 'image' ? 'f_auto,q_auto/' : '';
  return `https://res.cloudinary.com/${cld().config().cloud_name}/${resource}/upload/${tr}${publicId}${format ? `.${format}` : ''}`;
}

/** Turn a link the website sends back (when editing a listing) into the stored key again. */
export function keyFromUrl(url) {
  if (typeof url !== 'string') return null;
  const local = `${config.publicUrl}/uploads/`;
  if (url.startsWith(local)) return url.slice(local.length);
  const m = /^https:\/\/res\.cloudinary\.com\/([^/]+)\/(image|video|raw)\/upload\/(?:f_auto,q_auto\/)?(?:v\d+\/)?(.+)$/.exec(url);
  if (m && driver() === 'cloudinary' && m[1] === cld().config().cloud_name) return `cld:${m[2]}/upload/${m[3]}`;
  return null;
}

/** Is this a file we stored (and may delete), rather than an outside link? */
export const isOwnFile = (key) => typeof key === 'string' && /^(photos\/|docs\/|cld:)/.test(key);

function decode(dataUrl, allowed) {
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) throw badRequest('That file could not be read. Try choosing it again.');
  const [, mime, b64] = m;
  if (!allowed.includes(mime) || !TYPES[mime]) throw badRequest(`Files of type ${mime} aren't accepted.`);
  const size = Math.floor((b64.length * 3) / 4);
  if (size > config.maxUploadMb * 1024 * 1024) throw badRequest(`Files must be smaller than ${config.maxUploadMb} MB.`);
  return { mime, b64, ext: TYPES[mime] };
}

/**
 * Save a base64 data URL (what the browser's file pickers produce).
 * @param {string} dataUrl  data:<mime>;base64,<data>
 * @param {'photos'|'docs'} folder  photos are public, docs are private
 * @returns {Promise<string>} stored key
 */
export async function saveDataUrl(dataUrl, folder, allowed = Object.keys(TYPES)) {
  const { mime, b64, ext } = decode(dataUrl, allowed);
  const name = crypto.randomUUID();
  if (driver() === 'cloudinary') {
    const r = await cld()
      .uploader.upload(dataUrl, {
        folder: `${config.storage.cloudinary.folder}/${folder}`,
        public_id: name,
        resource_type: mime.startsWith('video/') ? 'video' : 'image', // PDFs are "image" assets in Cloudinary
        type: folder === 'docs' ? 'authenticated' : 'upload',
        overwrite: false,
      })
      .catch((e) => {
        throw badRequest(`The file couldn't be uploaded (${e.message || e.error?.message || 'Cloudinary error'}). Try again.`);
      });
    return `cld:${r.resource_type}/${r.type}/${r.public_id}${r.format ? `.${r.format}` : `.${ext}`}`;
  }
  const key = `${folder}/${name}.${ext}`;
  await fs.mkdir(path.join(root, folder), { recursive: true });
  await fs.writeFile(path.join(root, key), Buffer.from(b64, 'base64'));
  return key;
}

export async function removeFile(key) {
  if (!isOwnFile(key)) return;
  const c = parseCldKey(key);
  if (c) {
    await cld()
      .uploader.destroy(c.publicId, { resource_type: c.resource, type: c.delivery, invalidate: true })
      .catch((e) => console.error('[storage] Cloudinary delete failed:', e.message));
    return;
  }
  await fs.rm(path.join(root, key), { force: true }).catch(() => {});
}

const sign = (key, exp) => crypto.createHmac('sha256', config.fileSecret).update(`${key}:${exp}`).digest('base64url');

/** Address for a stored file. Private files get a signed link valid for `ttlSec`. */
export function fileUrl(key, ttlSec = 6 * 3600) {
  if (!key) return null;
  if (/^(https?:|data:|\/)/.test(key)) return key; // already a URL (seed data, external images)
  const c = parseCldKey(key);
  if (c && c.delivery === 'upload') return cldPublicUrl(c);
  if (key.startsWith('photos/')) return `${config.publicUrl}/uploads/${key}`;
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  // Private Cloudinary files go through /files/c/<key in base64url> so the link expires.
  const pathPart = c ? `c/${Buffer.from(key).toString('base64url')}` : key;
  return `${config.publicUrl}/files/${pathPart}?exp=${exp}&sig=${sign(key, exp)}`;
}

export function verifyFileSig(key, exp, sig) {
  if (!key || !exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const a = Buffer.from(sign(key, exp));
  const b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Stream a private Cloudinary file to the browser (after the signed link was checked). */
export async function sendCloudinaryFile(key, res) {
  const c = parseCldKey(key);
  if (!c) return res.status(404).json({ error: 'File not found.' });
  const url = cld().utils.private_download_url(c.publicId, c.format || '', { resource_type: c.resource, type: c.delivery, expires_at: Math.floor(Date.now() / 1000) + 120 });
  const upstream = await fetch(url);
  if (!upstream.ok) return res.status(upstream.status === 404 ? 404 : 502).json({ error: 'The file is not available right now.' });
  res.set('Content-Type', MIME_BY_EXT[c.format] || upstream.headers.get('content-type') || 'application/octet-stream');
  res.set('Content-Disposition', 'inline');
  res.set('Cache-Control', 'private, max-age=300');
  res.send(Buffer.from(await upstream.arrayBuffer()));
  return undefined;
}

export const storageStatus = () => {
  if (driver() !== 'cloudinary') return { driver: 'local', folder: root, ready: true };
  try {
    return { driver: 'cloudinary', cloud: cld().config().cloud_name, folder: config.storage.cloudinary.folder, ready: true };
  } catch (e) {
    return { driver: 'cloudinary', ready: false, error: e.message };
  }
};

/** Upload and delete a tiny test image (npm run check:services). */
export async function testStorage() {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const key = await saveDataUrl(png, 'photos');
  const url = fileUrl(key);
  await removeFile(key);
  return { key, url };
}
