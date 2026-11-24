import crypto from 'node:crypto';

/** Same id style as the frontend: prefix_random+time, e.g. u_k3j9x1lq2m. */
export const uid = (p = 'id') => `${p}_${crypto.randomBytes(4).toString('hex').slice(0, 6)}${Date.now().toString(36).slice(-4)}`;

/** Upper-case letters and digits only, for comparing registration numbers, VINs and phones. */
export const normId = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Digits only — the key used to find a user by phone number. */
/** Digits used to match phone numbers: "+255 712 345 678", "0712345678" and "255712345678" all match. */
export const phoneKey = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return /^0[67]\d{8}$/.test(d) ? `255${d.slice(1)}` : /^[67]\d{8}$/.test(d) ? `255${d}` : d;
};

/** Pick a random numeric id with a prefix that is not used yet. */
export async function uniqueNumericId(Model, prefix, min, max) {
  for (let i = 0; i < 25; i += 1) {
    const id = `${prefix}${Math.floor(min + Math.random() * (max - min))}`;
    // eslint-disable-next-line no-await-in-loop
    if (!(await Model.exists({ _id: id }))) return id;
  }
  return `${prefix}${Date.now()}`;
}

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
