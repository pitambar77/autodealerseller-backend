// Admin → Configuration → Cities: the cities and towns people can pick when they register, list a
// vehicle or search. Adding a city makes it appear in every form at once; switching one off hides it
// from forms (existing listings and accounts keep it).
import { Router } from 'express';
import { z } from 'zod';
import { User, Vehicle } from '../models/index.js';
import { ah, parse, badRequest, conflict, notFound } from '../lib/http.js';
import { requirePermission } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { getConfig, updateConfig, publicConfig, adminConfig } from '../services/settings.js';

const r = Router();
r.use(requirePermission('content.manage'));

const Name = z
  .string()
  .trim()
  .min(2, 'Enter the city or town name')
  .max(60)
  .regex(/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u, 'Use letters, spaces and hyphens only');
const Fields = z.object({
  name: Name,
  region: z.string().trim().max(60).optional(),
  zanzibar: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/** Cities with how many listings and accounts use each one. */
async function view(cfg) {
  const [vehicles, users] = await Promise.all([Vehicle.find({ status: { $nin: ['removed'] } }, { city: 1 }).lean(), User.find({ status: { $ne: 'closed' } }, { city: 1 }).lean()]);
  const count = (list, name) => list.filter((x) => x.city === name).length;
  return (cfg.cities || []).map((c) => ({ ...c, enabled: c.enabled !== false, listings: count(vehicles, c.name), accounts: count(users, c.name) }));
}
const reply = async (res, cfg, status = 200) => res.status(status).json({ cities: await view(cfg), config: adminConfig(cfg) });

r.get(
  '/',
  ah(async (_req, res) => reply(res, await getConfig())),
);

r.post(
  '/',
  ah(async (req, res) => {
    const d = parse(Fields, req.body);
    const cfg = await getConfig();
    const cities = cfg.cities || [];
    const existing = cities.find((c) => same(c.name, d.name));
    if (existing) throw conflict(existing.enabled === false ? `${existing.name} is already in the list but switched off. Switch it on instead.` : `${existing.name} is already in the list.`, { fields: { name: 'Already in the list' } });
    const city = { name: d.name, region: d.region || d.name, ...(d.zanzibar ? { zanzibar: true } : {}), enabled: d.enabled !== false };
    const value = await updateConfig({ cities: [...cities, city] });
    await audit(req.user, { action: 'Added city', entityType: 'config', entityId: city.name, note: `${city.name} (${city.region} region)` });
    return reply(res, value, 201);
  }),
);

/** Change a city's region, switch it on/off, or rename it (listings and accounts move to the new name). */
r.patch(
  '/:name',
  ah(async (req, res) => {
    const d = parse(Fields.partial(), req.body);
    const cfg = await getConfig();
    const cities = cfg.cities || [];
    const current = cities.find((c) => c.name === req.params.name);
    if (!current) throw notFound('City not found.');
    const next = { ...current, ...d, region: d.region === '' ? current.region : d.region ?? current.region };
    if (d.zanzibar === false) delete next.zanzibar;
    const renamed = d.name && d.name !== current.name;
    if (renamed && cities.some((c) => c !== current && same(c.name, d.name))) throw conflict(`${d.name} is already in the list.`, { fields: { name: 'Already in the list' } });
    if (!cities.some((c) => c !== current && c.enabled !== false) && next.enabled === false) throw badRequest('Keep at least one city switched on, or people have nowhere to choose.');

    const patch = { cities: cities.map((c) => (c === current ? next : c)) };
    if (renamed) {
      // Move listings, accounts, agents' operating areas and the city photo to the new name.
      await Vehicle.updateMany({ city: current.name }, { $set: { city: next.name } });
      await User.updateMany({ city: current.name }, { $set: { city: next.name } });
      const agents = await User.find({ cities: current.name }, { _id: 1, cities: 1 }).lean();
      await Promise.all(agents.map((a) => User.updateOne({ _id: a._id }, { $set: { cities: a.cities.map((x) => (x === current.name ? next.name : x)) } })));
      if (cfg.cityImages?.[current.name]) {
        const { [current.name]: img, ...rest } = cfg.cityImages;
        patch.cityImages = { ...rest, [next.name]: img };
      }
    }
    const value = await updateConfig(patch);
    const what = renamed ? 'Renamed city' : 'enabled' in d && Object.keys(d).length === 1 ? (d.enabled ? 'Switched city on' : 'Switched city off') : 'Updated city';
    await audit(req.user, { action: what, entityType: 'config', entityId: next.name, note: renamed ? `${current.name} → ${next.name}` : `${next.name} (${next.region})` });
    return reply(res, value);
  }),
);

/** Remove a city nobody uses. A city with listings or accounts can only be switched off. */
r.delete(
  '/:name',
  ah(async (req, res) => {
    const cfg = await getConfig();
    const cities = cfg.cities || [];
    const current = cities.find((c) => c.name === req.params.name);
    if (!current) throw notFound('City not found.');
    const [listings, accounts] = await Promise.all([Vehicle.countDocuments({ city: current.name, status: { $ne: 'removed' } }), User.countDocuments({ city: current.name, status: { $ne: 'closed' } })]);
    if (listings || accounts) {
      const parts = [listings && `${listings} listing${listings === 1 ? '' : 's'}`, accounts && `${accounts} account${accounts === 1 ? '' : 's'}`].filter(Boolean).join(' and ');
      throw conflict(`${current.name} has ${parts}, so it can't be removed. Switch it off instead: it disappears from forms and the existing ones keep it.`);
    }
    if (cities.filter((c) => c.enabled !== false && c !== current).length === 0) throw badRequest('Keep at least one city.');
    const value = await updateConfig({ cities: cities.filter((c) => c !== current) });
    await audit(req.user, { action: 'Removed city', entityType: 'config', entityId: current.name, note: current.region });
    return reply(res, value);
  }),
);

export default r;
