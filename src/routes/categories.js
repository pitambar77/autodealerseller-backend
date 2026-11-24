// Admin → Categories: add, edit, rename, hide, reorder and remove vehicle categories.
import { Router } from 'express';
import { z } from 'zod';
import { Category, Vehicle } from '../models/index.js';
import { ah, parse, badRequest, conflict, notFound } from '../lib/http.js';
import { requirePermission } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { categoryCounts, categoryView, listCategories } from '../services/categories.js';
import { removeFile, saveDataUrl } from '../services/storage.js';
import { ART_KINDS, ICON_NAMES, RESERVED_SLUGS, SPEC_FIELD_KEYS, USAGE_UNITS } from '../shared/categories.js';

const r = Router();
r.use(requirePermission('categories.manage'));

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const words = (max = 60) => z.array(z.string().trim().min(1).max(max)).max(200);
const steps = z.array(z.number().nonnegative()).max(20);

const CategoryInput = z
  .object({
    name: z.string().trim().min(2, 'Enter a name').max(60),
    singular: z.string().trim().min(2, 'Enter the name of one item').max(40),
    nounPlural: z.string().trim().min(2).max(40),
    slug: z.string().trim().toLowerCase().regex(SLUG, 'Use lowercase letters, numbers and hyphens, e.g. trucks-trailers').max(40),
    icon: z.enum(ICON_NAMES),
    art: z.enum(ART_KINDS),
    tagline: z.string().trim().max(120).default(''),
    typeLabel: z.string().trim().min(2).max(30),
    types: words(40).min(1, 'Add at least one type'),
    fuels: words(30).min(1, 'Add at least one fuel'),
    transmissions: words(30).min(1, 'Add at least one transmission'),
    usage: z.enum(USAGE_UNITS),
    priceSteps: steps.min(2, 'Add at least two budget steps'),
    usageSteps: steps.min(2, 'Add at least two usage steps'),
    minPrice: z.number().nonnegative().default(0),
    maxUsage: z.number().positive(),
    specFields: z
      .array(z.object({ key: z.enum(SPEC_FIELD_KEYS), required: z.boolean().default(false), filter: z.boolean().default(false) }))
      .max(SPEC_FIELD_KEYS.length),
    features: words(60).default([]),
    makes: words(60).default([]),
    registryTypes: words(60).default([]),
    enabled: z.boolean().default(true),
    imageData: z.string().nullable().optional(), // new tile image as a data URL; null removes it
  })
  .strip();

async function checkSlug(slug, key) {
  if (RESERVED_SLUGS.includes(slug)) throw badRequest(`"${slug}" is used by another page. Choose a different web address.`, { fields: { slug: 'reserved' } });
  const clash = await Category.findOne({ _id: { $ne: key }, $or: [{ slug }, { aliases: slug }] }).lean();
  if (clash) throw conflict(`"${slug}" is already used by ${clash.name}.`, { fields: { slug: 'taken' } });
}

async function applyImage(doc, imageData) {
  if (imageData === undefined) return;
  if (doc.image && !/^https?:|^\//.test(doc.image)) await removeFile(doc.image).catch(() => {});
  doc.image = imageData ? await saveDataUrl(imageData, 'photos', ['image/jpeg', 'image/png', 'image/webp']) : null;
}

const respond = async (res, status = 200, extra = {}) => res.status(status).json({ categories: await listCategories(), counts: await categoryCounts(), ...extra });

r.get(
  '/',
  ah(async (_req, res) => respond(res)),
);

r.post(
  '/',
  ah(async (req, res) => {
    const d = parse(CategoryInput, req.body);
    await checkSlug(d.slug);
    // The permanent key comes from the first web address and never changes.
    let key = d.slug.replace(/-/g, '_').slice(0, 30);
    for (let i = 2; await Category.exists({ _id: key }); i++) key = `${d.slug.replace(/-/g, '_').slice(0, 27)}_${i}`;
    const last = await Category.findOne().sort({ order: -1 }).lean();
    const { imageData, ...data } = d;
    const doc = { _id: key, ...data, aliases: [], order: (last?.order ?? -1) + 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await applyImage(doc, imageData);
    const created = await Category.create(doc);
    await audit(req.user, { action: 'Added category', entityType: 'category', entityId: key, note: d.name });
    return respond(res, 201, { category: categoryView(created) });
  }),
);

r.patch(
  '/:key',
  ah(async (req, res) => {
    const cat = await Category.findById(req.params.key);
    if (!cat) throw notFound('Category not found.');
    const d = parse(CategoryInput.partial(), req.body);
    const { imageData, ...data } = d;
    if (data.slug && data.slug !== cat.slug) {
      await checkSlug(data.slug, cat.id);
      // Old addresses keep working: they redirect to the new one.
      data.aliases = [...new Set([...(cat.aliases || []), cat.slug])].filter((a) => a !== data.slug);
    }
    if (data.enabled === false && (await Category.countDocuments({ enabled: true, _id: { $ne: cat.id } })) === 0) throw badRequest('At least one category must stay visible.');
    const doc = cat.toObject();
    await applyImage(doc, imageData);
    cat.set({ ...data, image: doc.image ?? null, updatedAt: new Date().toISOString() });
    await cat.save();
    const what = data.name && data.name !== doc.name ? `Renamed to ${data.name}` : data.enabled === false ? 'Hidden' : data.enabled === true && Object.keys(data).length === 1 ? 'Shown' : 'Edited';
    await audit(req.user, { action: `Category: ${what}`, entityType: 'category', entityId: cat.id, note: cat.name });
    return respond(res, 200, { category: categoryView(cat) });
  }),
);

/** New display order: { keys: ['car', 'bus', …] } */
r.post(
  '/reorder',
  ah(async (req, res) => {
    const { keys } = parse(z.object({ keys: z.array(z.string()).min(1).max(100) }), req.body);
    await Promise.all(keys.map((k, i) => Category.updateOne({ _id: k }, { order: i })));
    await audit(req.user, { action: 'Reordered categories', entityType: 'category', entityId: keys.join(', ') });
    return respond(res);
  }),
);

/** Remove a category. Its listings must move to another category: { moveTo } */
r.delete(
  '/:key',
  ah(async (req, res) => {
    const cat = await Category.findById(req.params.key);
    if (!cat) throw notFound('Category not found.');
    if ((await Category.countDocuments()) <= 1) throw badRequest("The last category can't be removed.");
    const moveTo = req.body?.moveTo || req.query.moveTo;
    const used = await Vehicle.countDocuments(cat.id === 'car' ? { category: { $in: ['car', null] } } : { category: cat.id });
    if (used) {
      if (!moveTo || moveTo === cat.id) throw badRequest(`${used} listing${used === 1 ? '' : 's'} use this category. Choose where to move them.`, { fields: { moveTo: 'required' }, used });
      const target = await Category.findById(moveTo);
      if (!target) throw badRequest('Choose an existing category to move the listings to.');
      await Vehicle.updateMany(cat.id === 'car' ? { category: { $in: ['car', null] } } : { category: cat.id }, { category: target.id });
      // The removed category's addresses now lead to the category that took its listings.
      target.aliases = [...new Set([...(target.aliases || []), cat.slug, ...(cat.aliases || [])])];
      await target.save();
    }
    if (cat.image && !/^https?:|^\//.test(cat.image)) await removeFile(cat.image).catch(() => {});
    await cat.deleteOne();
    await audit(req.user, { action: 'Removed category', entityType: 'category', entityId: cat.id, note: `${cat.name}${used ? `; ${used} listings moved to ${moveTo}` : ''}` });
    return respond(res);
  }),
);

export default r;
