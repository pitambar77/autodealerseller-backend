// Admin → Website content → Popular categories: the photo tiles on the home page. Each tile opens a vehicle
// category's listings page with filters (body type, fuel, price range). Admins change the section heading,
// add, edit, hide, reorder or delete tiles, and upload each tile's photo.
import { Router } from 'express';
import { z } from 'zod';
import { Category } from '../models/index.js';
import { ah, badRequest, notFound, parse } from '../lib/http.js';
import { requirePermission } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { removeFile, saveDataUrl } from '../services/storage.js';
import { adminConfig, getConfig, updateConfig } from '../services/settings.js';
import { DEFAULT_CONFIG } from '../shared/site.js';

const r = Router();
r.use(requirePermission('content.manage'));

const MAX_TILES = 12;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

const money = z.union([z.number(), z.string(), z.null()]).optional().transform((v, ctx) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 5e10) {
    ctx.addIssue({ code: 'custom', message: 'Enter an amount in TSh' });
    return z.NEVER;
  }
  return Math.round(n);
});
const Tile = z.object({
  label: z.string().trim().min(2, 'Give the tile a name').max(30, 'Keep the name to 30 characters'),
  category: z.string().trim().min(1, 'Choose a vehicle category').max(40),
  body: z.string().trim().max(40).optional().default(''),
  fuel: z.string().trim().max(30).optional().default(''),
  minPrice: money,
  maxPrice: money,
  enabled: z.boolean().optional(),
  imageData: z.string().optional(),
});

const section = (cfg) => {
  const s = cfg.popularCategories || DEFAULT_CONFIG.popularCategories;
  return { title: s.title || 'Popular categories', tiles: [...(s.tiles || [])] };
};
const reply = (res, value, status = 200) => res.status(status).json({ section: adminConfig(value).popularCategories, config: adminConfig(value) });

async function checkTile(d) {
  if (!(await Category.exists({ _id: d.category }))) throw badRequest('Choose a vehicle category.', { fields: { category: 'Unknown category' } });
  if (d.minPrice != null && d.maxPrice != null && d.minPrice > d.maxPrice) throw badRequest('The lowest price is above the highest price.', { fields: { maxPrice: 'Below the lowest price' } });
}

async function savePhoto(dataUrl) {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m || !PHOTO_TYPES.includes(m[1])) throw badRequest('Use a JPG, PNG or WebP photo.', { fields: { image: 'Wrong type' } });
  if (Math.floor((m[2].replace(/\s/g, '').length * 3) / 4) > MAX_PHOTO_BYTES) throw badRequest('That photo is over 4 MB. Use a smaller one.', { fields: { image: 'Too large' } });
  return saveDataUrl(dataUrl, 'photos/categories', PHOTO_TYPES);
}
// Built-in photos ("/suv2.jpg") ship with the website and are never deleted.
const dropPhoto = (p) => (p && !p.startsWith('/') && !/^https?:/.test(p) ? removeFile(p).catch(() => {}) : null);

r.get(
  '/',
  ah(async (_req, res) => reply(res, await getConfig())),
);

/** The section heading. */
r.put(
  '/title',
  ah(async (req, res) => {
    const title = String(req.body?.title ?? '').trim().replace(/\s+/g, ' ');
    if (title.length < 2 || title.length > 60) throw badRequest('Use 2–60 characters for the heading.', { fields: { title: 'Length' } });
    const cfg = await getConfig();
    const value = await updateConfig({ popularCategories: { ...section(cfg), title } });
    await audit(req.user, { action: 'Renamed popular categories', entityType: 'config', entityId: 'popularCategories', note: title });
    reply(res, value);
  }),
);

r.post(
  '/',
  ah(async (req, res) => {
    const d = parse(Tile, req.body);
    await checkTile(d);
    const cfg = await getConfig();
    const s = section(cfg);
    if (s.tiles.length >= MAX_TILES) throw badRequest(`Up to ${MAX_TILES} tiles. Delete or reuse one.`);
    if (!d.imageData) throw badRequest('Add a photo for the tile.', { fields: { image: 'Required' } });
    const { imageData, ...fields } = d;
    const tile = { id: `pc_${Date.now().toString(36)}`, ...fields, enabled: d.enabled !== false, image: await savePhoto(imageData) };
    const value = await updateConfig({ popularCategories: { ...s, tiles: [...s.tiles, tile] } });
    await audit(req.user, { action: 'Added popular category', entityType: 'config', entityId: tile.id, note: tile.label });
    reply(res, value, 201);
  }),
);

r.patch(
  '/:id',
  ah(async (req, res) => {
    const d = parse(Tile.partial(), req.body);
    const cfg = await getConfig();
    const s = section(cfg);
    const current = s.tiles.find((t) => t.id === req.params.id);
    if (!current) throw notFound('Tile not found.');
    const { imageData, ...fields } = d;
    const next = { ...current, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) };
    await checkTile(next);
    if (imageData) {
      next.image = await savePhoto(imageData);
      await dropPhoto(current.image);
    }
    const value = await updateConfig({ popularCategories: { ...s, tiles: s.tiles.map((t) => (t.id === current.id ? next : t)) } });
    const what = Object.keys(d).length === 1 && 'enabled' in d ? (d.enabled ? 'Showed popular category' : 'Hid popular category') : 'Updated popular category';
    await audit(req.user, { action: what, entityType: 'config', entityId: current.id, note: next.label });
    reply(res, value);
  }),
);

r.delete(
  '/:id',
  ah(async (req, res) => {
    const cfg = await getConfig();
    const s = section(cfg);
    const current = s.tiles.find((t) => t.id === req.params.id);
    if (!current) throw notFound('Tile not found.');
    await dropPhoto(current.image);
    const value = await updateConfig({ popularCategories: { ...s, tiles: s.tiles.filter((t) => t.id !== current.id) } });
    await audit(req.user, { action: 'Deleted popular category', entityType: 'config', entityId: current.id, note: current.label });
    reply(res, value);
  }),
);

/** New order: { ids: [...] } (every tile, in the order to show). */
r.post(
  '/reorder',
  ah(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const cfg = await getConfig();
    const s = section(cfg);
    if (ids.length !== s.tiles.length || !s.tiles.every((t) => ids.includes(t.id))) throw badRequest('Send every tile once.');
    const value = await updateConfig({ popularCategories: { ...s, tiles: ids.map((id) => s.tiles.find((t) => t.id === id)) } });
    await audit(req.user, { action: 'Reordered popular categories', entityType: 'config', entityId: 'popularCategories' });
    reply(res, value);
  }),
);

export default r;
