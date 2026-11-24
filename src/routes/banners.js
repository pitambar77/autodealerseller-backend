// Admin → Content → Home banner: the slides behind the home page headline. Upload, edit, reorder,
// switch on/off and remove slides; changes show on the home page straight away.
import { Router } from 'express';
import { z } from 'zod';
import { ah, parse, badRequest, notFound } from '../lib/http.js';
import { uid } from '../lib/ids.js';
import { requirePermission } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { getConfig, updateConfig, publicConfig, adminConfig } from '../services/settings.js';
import { fileUrl, removeFile, saveDataUrl } from '../services/storage.js';
import { cleanHeading, headingText } from '../shared/heading.js';

/** Tidies a slide's styled headline and keeps the plain title in step with it. */
function withHeading(fields) {
  if (fields.heading === undefined) return fields;
  const h = cleanHeading(fields.heading);
  if (h.error) throw badRequest(h.error, { fields: { heading: h.error } });
  return { ...fields, heading: h.segments, title: headingText(h.segments).replace(/\n/g, ' ').slice(0, 90) };
}

const r = Router();
r.use(requirePermission('content.manage'));

const MAX_SLIDES = 10;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const link = z
  .string()
  .trim()
  .max(300)
  .refine((v) => !v || v.startsWith('/') || /^https:\/\//.test(v), 'Use a page on this site (starting with /) or an https:// address')
  .optional();
const Fields = z.object({
  title: z.string().trim().max(90).optional(),
  // Optional styled headline (coloured words, line breaks): see shared/heading.js. Replaces title.
  heading: z.array(z.object({ text: z.string().max(400), color: z.string().max(9).optional() })).max(60).optional(),
  subtitle: z.string().trim().max(220).optional(),
  ctaLabel: z.string().trim().max(30).optional(),
  ctaLink: link,
  alt: z.string().trim().max(140).optional(),
  enabled: z.boolean().optional(),
  imageData: z.string().optional(),
});

const view = (cfg) => (cfg.heroSlides || []).map((h) => ({ ...h, imageUrl: fileUrl(h.image) }));
const reply = (res, cfg, status = 200) => res.status(status).json({ slides: view(cfg), config: adminConfig(cfg) });
const own = (key) => key && !/^(https?:|\/)/.test(key); // uploaded by us (not a built-in /brand image)

r.get(
  '/',
  ah(async (_req, res) => reply(res, await getConfig())),
);

r.post(
  '/',
  ah(async (req, res) => {
    const d = parse(Fields.extend({ imageData: z.string({ message: 'Choose a photo' }).min(30, 'Choose a photo') }), req.body);
    const cfg = await getConfig();
    const slides = cfg.heroSlides || [];
    if (slides.length >= MAX_SLIDES) throw badRequest(`Keep the banner to ${MAX_SLIDES} slides or fewer. Remove one first.`);
    const image = await saveDataUrl(d.imageData, 'photos', IMAGE_TYPES);
    const { imageData: _img, ...rest } = d;
    const fields = withHeading(rest);
    const slide = { id: uid('hs'), image, title: '', subtitle: '', ctaLabel: '', ctaLink: '', alt: '', enabled: true, ...fields, addedAt: new Date().toISOString(), addedBy: req.user.name };
    const value = await updateConfig({ heroSlides: [...slides, slide] });
    await audit(req.user, { action: 'Added banner slide', entityType: 'config', entityId: slide.id, note: slide.title || 'Photo only' });
    return reply(res, value, 201);
  }),
);

r.patch(
  '/:id',
  ah(async (req, res) => {
    const d = parse(Fields.partial(), req.body);
    const cfg = await getConfig();
    const slides = cfg.heroSlides || [];
    const current = slides.find((h) => h.id === req.params.id);
    if (!current) throw notFound('Slide not found.');
    const { imageData, ...rest } = d;
    const fields = withHeading(rest);
    const next = { ...current, ...fields };
    if (rest.title !== undefined && rest.heading === undefined) delete next.heading; // a plain headline replaces a styled one
    if (imageData) {
      next.image = await saveDataUrl(imageData, 'photos', IMAGE_TYPES);
      if (own(current.image)) removeFile(current.image);
    }
    if (next.enabled === false && !slides.some((h) => h.id !== current.id && h.enabled !== false)) throw badRequest('Keep at least one slide switched on.');
    const value = await updateConfig({ heroSlides: slides.map((h) => (h.id === current.id ? next : h)) });
    const what = 'enabled' in fields && Object.keys(d).length === 1 ? (fields.enabled ? 'Showed banner slide' : 'Hid banner slide') : imageData ? 'Replaced banner photo' : 'Edited banner slide';
    await audit(req.user, { action: what, entityType: 'config', entityId: current.id, note: next.title || 'Photo only' });
    return reply(res, value);
  }),
);

r.post(
  '/reorder',
  ah(async (req, res) => {
    const { ids } = parse(z.object({ ids: z.array(z.string()).min(1) }), req.body);
    const cfg = await getConfig();
    const slides = cfg.heroSlides || [];
    const ordered = [...ids.map((id) => slides.find((h) => h.id === id)).filter(Boolean), ...slides.filter((h) => !ids.includes(h.id))];
    const value = await updateConfig({ heroSlides: ordered });
    await audit(req.user, { action: 'Reordered banner slides', entityType: 'config', entityId: 'heroSlides' });
    return reply(res, value);
  }),
);

r.delete(
  '/:id',
  ah(async (req, res) => {
    const cfg = await getConfig();
    const slides = cfg.heroSlides || [];
    const current = slides.find((h) => h.id === req.params.id);
    if (!current) throw notFound('Slide not found.');
    if (slides.length === 1) throw badRequest('The banner needs at least one slide. Add another before removing this one.');
    const rest = slides.filter((h) => h.id !== current.id);
    if (!rest.some((h) => h.enabled !== false)) throw badRequest('Keep at least one slide switched on.');
    if (own(current.image)) removeFile(current.image);
    const value = await updateConfig({ heroSlides: rest });
    await audit(req.user, { action: 'Removed banner slide', entityType: 'config', entityId: current.id, note: current.title || 'Photo only' });
    return reply(res, value);
  }),
);

export default r;
