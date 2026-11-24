// What each audience may see of a record. The bootstrap and every endpoint go through these.
import { fileUrl } from './storage.js';

const PRIVATE_USER_FIELDS = ['passwordHash', 'totpSecret', 'buyer', 'phoneKey', 'failedLogins', 'tokenVersion'];
/** Profile fields shown publicly on dealer/seller pages and listings. */
const PUBLIC_USER_FIELDS = [
  'id', 'role', 'name', 'business', 'agency', 'city', 'status', 'docStatus', 'registeredAt', 'phone',
  'businessType', 'yearEstablished', 'about', 'hours', 'brands', 'languages', 'services', 'website', 'lenderId', 'logo',
];

const plain = (doc) => (doc?.toJSON ? doc.toJSON() : { ...doc, id: doc?.id ?? doc?._id });

/** Full record for the account owner and admins (never secrets). */
export function privateUser(u) {
  const o = plain(u);
  delete o._id;
  PRIVATE_USER_FIELDS.forEach((k) => delete o[k]);
  if (o.logo) o.logo = fileUrl(o.logo);
  return o;
}

/** Public profile: contact number and business details, no email, tax or ID numbers. */
export function publicUser(u) {
  const o = plain(u);
  const out = Object.fromEntries(PUBLIC_USER_FIELDS.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  // Dealers show their showroom address; private sellers and agents do not.
  if (o.role === 'dealer' && o.address) out.address = o.address;
  if (out.logo) out.logo = fileUrl(out.logo); // business logo (dealers and agents)
  return out;
}

const photo = (p) => (typeof p === 'string' ? fileUrl(p) : p && { ...p, src: fileUrl(p.src || p.key) });

/** Listing as stored, with photo links resolved. For the seller and admins. */
export function ownerVehicle(v) {
  const o = plain(v);
  delete o._id;
  delete o.regKey;
  delete o.vinKey;
  o.photos = (o.photos || []).map(photo).filter(Boolean);
  if (o.featured && o.featuredUntil && new Date(o.featuredUntil) <= new Date()) o.featured = false; // boost ran out
  return o;
}

/** Listing for the public: no engine number, owner contact or full VIN. */
export function publicVehicle(v) {
  const o = ownerVehicle(v);
  delete o.engineNo;
  delete o.ownerInfo;
  delete o.duplicateOf;
  delete o.suspendedWithUser;
  if (o.vin) o.vin = `${'X'.repeat(Math.max(0, o.vin.length - 5))}${o.vin.slice(-5)}`;
  return o;
}

const kindOf = (key = '') => (/\.(jpe?g|png|webp|gif)$/i.test(key) ? 'image' : /\.pdf$/i.test(key) ? 'pdf' : /\.(mp4|mov|webm)$/i.test(key) ? 'video' : 'other');

/** Document for its owner and admins: a short-lived signed link to the file (`preview` only for images). */
export function documentView(d) {
  const o = plain(d);
  delete o._id;
  if (o.file) {
    o.fileUrl = fileUrl(o.file);
    o.fileKind = kindOf(o.file);
    o.preview = o.fileKind === 'image' ? o.fileUrl : null;
  }
  delete o.file;
  return o;
}

export const clean = (d) => {
  const o = plain(d);
  delete o._id;
  delete o.accessKeyHash;
  return o;
};
