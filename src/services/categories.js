// Vehicle categories, stored in the database and managed by admins (Admin → Categories).
import { Category, Vehicle } from '../models/index.js';
import { DEFAULT_CATEGORIES } from '../shared/categories.js';
import { fileUrl } from './storage.js';

/** First start (or an older database): add the starting categories. Never overwrites admin changes. */
export async function ensureCategories() {
  if ((await Category.estimatedDocumentCount()) > 0) return false;
  const now = new Date().toISOString();
  await Category.insertMany(DEFAULT_CATEGORIES.map(({ key, ...c }) => ({ _id: key, ...c, createdAt: now, updatedAt: now })));
  return true;
}

/** Category for the browser: `key` instead of `_id`, and a URL for the tile image. */
export function categoryView(c) {
  const o = typeof c.toObject === 'function' ? c.toObject() : { ...c };
  const key = o._id || o.id || o.key;
  delete o._id;
  delete o.id;
  delete o.__v;
  return { ...o, key, image: o.image ? (/^https?:|^\//.test(o.image) ? o.image : fileUrl(o.image)) : null };
}

/** All categories in display order (enabledOnly: what the public site may show). */
export async function listCategories({ enabledOnly = false } = {}) {
  const list = await Category.find(enabledOnly ? { enabled: true } : {})
    .sort({ order: 1, _id: 1 })
    .lean();
  return list.map(categoryView);
}

/** Keys of categories hidden from the public site (their listings are hidden too). */
export async function hiddenCategoryKeys() {
  return (await Category.find({ enabled: false }, { _id: 1 }).lean()).map((c) => c._id);
}

/** Listing counts per category key: { car: { total, live } } */
export async function categoryCounts() {
  const rows = await Vehicle.aggregate([{ $group: { _id: { c: '$category', s: '$status' }, n: { $sum: 1 } } }]);
  const out = {};
  rows.forEach(({ _id, n }) => {
    const c = _id.c || 'car'; // listings saved before categories existed are cars
    out[c] = out[c] || { total: 0, live: 0 };
    out[c].total += n;
    if (_id.s === 'live') out[c].live += n;
  });
  return out;
}

/** Website address of a listing, e.g. /trucks-trailers/v6003 (used in notifications, SMS and emails). */
export async function vehiclePathOf(v) {
  const key = v?.category || 'car';
  const c = await Category.findById(key, { slug: 1 }).lean();
  return `/${c?.slug || 'cars'}/${v?._id || v?.id}`;
}
