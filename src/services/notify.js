// In-app notifications (the bell), pushed live to open pages, with optional SMS and email.
import { Notification, User } from '../models/index.js';
import { uid } from '../lib/ids.js';
import { clean, ownerVehicle, publicVehicle } from './serialize.js';
import { publish, toUser } from './realtime.js';
import { sendSmsAlert } from './sms.js';
import { sendEmailAlert } from './email.js';
import { config } from '../config.js';
import { rolesByKey } from './access.js';
import { allows } from '../shared/permissions.js';

const nowIso = () => new Date().toISOString();

/**
 * Create (or refresh) a notification and push it to the recipient's open pages.
 * `groupKey`: while an earlier notification with the same key is still unread, update it instead of
 * adding another, so a busy conversation shows one line, not fifty.
 */
export async function notify({ recipientId, audience = 'user', kind, title, body = '', link = '', refId = '', groupKey }) {
  if (!recipientId) return null;
  const at = nowIso();
  let n = null;
  if (groupKey) {
    n = await Notification.findOneAndUpdate(
      { recipientId, groupKey, readAt: { $exists: false } },
      { $set: { at, title, body, link, refId, kind }, $inc: { count: 1 } },
      { new: true },
    ).lean();
  }
  if (!n) n = (await Notification.create({ _id: uid('nt'), at, audience, recipientId, kind, title, body, link, refId, groupKey, count: 1 })).toObject();
  const view = clean(n);
  publish(toUser(recipientId), 'notification', { notification: view });
  return view;
}

/** SMS and email for an account, following its Account → Notifications choices. */
export async function alertUser(user, { sms, email }) {
  if (!user) return;
  const prefs = user.notifications || {};
  const jobs = [];
  if (sms && user.phone && prefs.sms !== false) jobs.push(sendSmsAlert(user.phone, sms));
  if (email && user.email && prefs.email !== false) jobs.push(sendEmailAlert(user.email, email));
  await Promise.allSettled(jobs);
}

export const webLink = (path) => `${config.webUrl}${path}`;

// ── Saved vehicles: tell buyers when something they saved changes

const DETAIL_FIELDS = ['mileage', 'description', 'variant', 'color', 'city', 'condition', 'year', 'fuel', 'transmission', 'bodyType'];
const tzs = (n) => `TSh ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const title = (v) => `${v.year} ${v.make} ${v.model}`;

/** What changed between two versions of a listing, in words buyers understand. Null if nothing they care about. */
export function describeChange(before, after) {
  const was = before.status;
  const now = after.status;
  if (was === 'live' && now === 'sold') return { kind: 'sold', title: `Sold: ${title(after)}`, body: 'A vehicle you saved has been sold. Have a look at similar ones.' };
  if (was === 'live' && now !== 'live') return { kind: 'unavailable', title: `No longer available: ${title(after)}`, body: 'A vehicle you saved has been taken off the marketplace.' };
  if (was !== 'live' && now === 'live') return { kind: 'available', title: `Available again: ${title(after)}`, body: 'A vehicle you saved is back on the marketplace.' };
  if (now !== 'live') return null;
  if (Number(before.price) !== Number(after.price)) {
    const down = Number(after.price) < Number(before.price);
    return {
      kind: down ? 'price_drop' : 'price_up',
      title: `${down ? 'Price drop' : 'Price change'}: ${title(after)}`,
      body: `${tzs(before.price)} → ${tzs(after.price)}${down ? ` (save ${tzs(before.price - after.price)})` : ''}`,
    };
  }
  const photos = (before.photos || []).length !== (after.photos || []).length;
  const changed = DETAIL_FIELDS.filter((k) => String(before[k] ?? '') !== String(after[k] ?? ''));
  if (photos || changed.length || JSON.stringify(before.specs || {}) !== JSON.stringify(after.specs || {})) {
    const what = [photos && 'photos', ...changed.map((k) => ({ mileage: 'kilometres', bodyType: 'type' })[k] || k)].filter(Boolean);
    return { kind: 'updated', title: `Updated: ${title(after)}`, body: what.length ? `The seller changed the ${what.slice(0, 3).join(', ')}.` : 'The seller updated the details.' };
  }
  return null;
}

/**
 * Call after a listing changes. Pushes the new version to open pages and notifies buyers who saved it.
 * `before` and `after` are plain objects (use .toObject() on documents).
 */
export async function listingChanged(before, after, path) {
  const view = publicVehicle(after);
  publish([toUser(after.sellerId), 'admins'], 'vehicle', { vehicle: ownerVehicle(after), scope: 'owner' });
  if (after.status === 'live' || before.status === 'live') publish('public', 'vehicle', { vehicle: view, scope: 'public' });
  const change = describeChange(before, after);
  if (!change) return 0;
  const savers = await User.find({ 'buyer.saved': after._id || after.id, status: 'active' }, { _id: 1, phone: 1, email: 1, notifications: 1, buyer: 1 }).lean();
  await Promise.all(
    savers.map(async (u) => {
      await notify({ recipientId: u._id, audience: 'buyer', kind: `saved_${change.kind}`, title: change.title, body: change.body, link: path, refId: view.id, groupKey: `saved:${view.id}` });
      // Price drops are worth an email to buyers who asked for price alerts.
      if (change.kind === 'price_drop' && u.buyer?.prefs?.alerts?.priceDrops !== false) {
        await alertUser(u, { email: { subject: change.title, heading: change.title, lines: [change.body], button: { label: 'See the vehicle', url: webLink(path) } } });
      }
    }),
  );
  return savers.length;
}

// ── Admin alerts and account/listing review results

/**
 * Bell notification (live) and email for the admin staff whose role has `perm` (the MD always),
 * e.g. new registrations go to those who can see users. Pass perm=null for every admin.
 */
export async function notifyStaffWith(perm, { kind, title, body = '', link = '', refId = '', groupKey, email, except }) {
  const staff = await User.find({ role: 'admin', status: 'active' }, { _id: 1, email: 1, phone: 1, notifications: 1, adminRole: 1, name: 1 }).lean();
  const roles = await rolesByKey();
  const admins = staff.filter((a) => a._id !== except && (!perm || allows(roles[a.adminRole || '']?.permissions, perm)));
  await Promise.all(
    admins.map(async (a) => {
      await notify({ recipientId: a._id, audience: 'admin', kind, title, body, link, refId, groupKey });
      if (email) await alertUser(a, { email });
    }),
  );
  publish('admins', 'admin_refresh', { kind, refId });
  return admins.length;
}

/** Bell notification (live) and email for every active admin, e.g. a new registration to review. */
export async function notifyAdmins({ perm = null, kind, title, body = '', link = '', refId = '', groupKey, email }) {
  return notifyStaffWith(perm, { kind, title, body, link, refId, groupKey, email });
}
/**
 * Tell a seller about an admin decision on their documents or a listing: the bell (live), plus
 * email (and SMS when `sms` is given), following their Account → Notifications choices.
 */
export async function notifyAccount(userId, { kind, title, body = '', link = '', refId = '', groupKey, button, sms }) {
  const u = await User.findById(userId, { _id: 1, role: 1, name: 1, email: 1, phone: 1, notifications: 1, status: 1 }).lean();
  if (!u) return null;
  const n = await notify({ recipientId: u._id, audience: u.role, kind, title, body, link, refId, groupKey });
  await alertUser(u, {
    sms,
    email: { subject: title, heading: title, lines: [`Hello ${u.name.split(' ')[0]},`, body].filter(Boolean), button: button || (link ? { label: 'Open AutoDealer', url: webLink(link) } : undefined) },
  });
  return n;
}
