// Admin → Website content → Brand logos: upload, replace or remove the logo shown for a vehicle brand
// (Popular brands, brand filters). An uploaded logo replaces the website's built-in file for that brand;
// removing it goes back to the built-in file, or the brand's initials when there is none.
import { Router } from 'express';
import { ah, badRequest, notFound } from '../lib/http.js';
import { requirePermission } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { removeLogo, saveLogo } from '../services/logos.js';
import { adminConfig, getConfig, updateConfig } from '../services/settings.js';

const r = Router();
r.use(requirePermission('content.manage'));

const makeOf = (req) => {
  const make = String(req.params.make || '').trim();
  if (!make || make.length > 60) throw badRequest('Choose a brand.');
  return make;
};

r.put(
  '/:make',
  ah(async (req, res) => {
    const make = makeOf(req);
    const cfg = await getConfig();
    const list = cfg.brandLogos || [];
    const current = list.find((b) => b.make === make);
    const key = await saveLogo(req.body?.imageData, current?.key, 'photos/brands');
    const value = await updateConfig({ brandLogos: [...list.filter((b) => b.make !== make), { make, key }] });
    await audit(req.user, { action: current ? 'Replaced brand logo' : 'Added brand logo', entityType: 'config', entityId: 'brandLogos', note: make });
    res.json({ config: adminConfig(value) });
  }),
);

r.delete(
  '/:make',
  ah(async (req, res) => {
    const make = makeOf(req);
    const cfg = await getConfig();
    const current = (cfg.brandLogos || []).find((b) => b.make === make);
    if (!current) throw notFound('That brand has no uploaded logo.');
    await removeLogo(current.key);
    const value = await updateConfig({ brandLogos: cfg.brandLogos.filter((b) => b.make !== make) });
    await audit(req.user, { action: 'Removed brand logo', entityType: 'config', entityId: 'brandLogos', note: make });
    res.json({ config: adminConfig(value) });
  }),
);

export default r;
