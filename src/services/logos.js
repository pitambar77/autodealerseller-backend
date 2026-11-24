// Business logos for dealers, agents and partner lenders (and vehicle brand logos, see routes/brandLogos.js). Stored as public images (they appear on listings),
// PNG, JPEG or WebP only (no SVG: it can carry scripts), at most 2 MB. Replacing a logo deletes the old file.
import { badRequest } from '../lib/http.js';
import { removeFile, saveDataUrl } from './storage.js';

export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 2 * 1024 * 1024;

/** Saves a logo from a data URL and returns its storage key; removes the previous file. */
export async function saveLogo(dataUrl, previousKey, folder = 'photos/logos') {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) throw badRequest('Choose a PNG, JPG or WebP image for the logo.');
  if (!LOGO_TYPES.includes(m[1])) throw badRequest('Logos must be PNG, JPG or WebP images.');
  const bytes = Math.floor((m[2].replace(/\s/g, '').length * 3) / 4);
  if (bytes > MAX_BYTES) throw badRequest('That logo is larger than 2 MB. Use a smaller image.');
  const key = await saveDataUrl(dataUrl, folder, LOGO_TYPES);
  if (previousKey && previousKey !== key) await removeFile(previousKey).catch(() => {});
  return key;
}

export async function removeLogo(key) {
  if (key) await removeFile(key).catch(() => {});
}
