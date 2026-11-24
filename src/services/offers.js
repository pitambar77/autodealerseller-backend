// Discounts and special offers that reached the end date the seller chose finish by themselves (checked
// every 10 minutes): a discounted price goes back to the original, buyers who saved the listing are told,
// and the seller gets a notification (bell and email) so the change never looks like a mistake.
// Offers without an end date ("Until I end it") are never touched here.
import { Vehicle, Notification } from '../models/index.js';
import { listingChanged, notifyAccount } from './notify.js';
import { vehiclePathOf } from './categories.js';
import { audit } from './audit.js';
import os from 'node:os';

/** Shown at start-up and in /api/health, so you can tell which code a running server has. */
export const OFFER_EXPIRY_VERSION = '2026-11-19 (only offers past their end date)';
const whoAmI = () => `${os.hostname()}, process ${process.pid}, expiry ${OFFER_EXPIRY_VERSION.slice(0, 10)}`;

export async function expireOffers() {
  const due = await Vehicle.find({ 'offer.endsAt': { $type: 'string', $lt: new Date().toISOString() } });
  let ended = 0;
  for (const v of due) {
    // Belt and braces: never touch a listing without a real, past end date, whatever the query returned.
    const end = Date.parse(v.offer?.endsAt);
    if (!v.offer?.kind || Number.isNaN(end) || end > Date.now()) continue;
    const before = v.toObject();
    ended += 1;
    const offerWas = JSON.parse(JSON.stringify(v.offer || {})); // a copy: clearing the offer below empties the original
    if (v.offer?.originalPrice) v.set('price', v.offer.originalPrice);
    v.set('offer', undefined);
    v.set('updatedAt', new Date().toISOString());
    await v.save();
    vehiclePathOf(v)
      .then((path) => listingChanged(before, v.toObject(), path))
      .catch(() => {});
    await audit(null, { action: 'Offer ended', entityType: 'listing', entityId: v.id, note: `Reached its end date (${offerWas.endsAt}). Ended by server ${whoAmI()}.`, changes: { price: [before.price, v.price] } });
    console.log(`[offers] ${v.id}: offer ended (end date ${offerWas.endsAt})`);
    const title = `${[v.year, v.make, v.model].filter(Boolean).join(' ')}: your ${offerWas.kind === 'discount' ? 'discount' : 'special offer'} has ended`;
    const body = `It reached the end date you chose (${new Date(offerWas.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Dar_es_Salaam' })}).${offerWas.kind === 'discount' ? ` The price is back to TSh ${Number(v.price).toLocaleString('en-US')}.` : ''} You can start a new offer from your listings at any time.`;
    const base = { dealer: '/dealer', agent: '/agent' }[v.sellerRole] || '/seller';
    await notifyAccount(v.sellerId, { kind: 'listing_offer_ended', title, body, link: `${base}/listings`, refId: v.id }).catch(() => {});
  }
  return ended;
}

/**
 * One-off clean-up for the expiry bug (fixed 19 Nov 2026): the check matched every listing, so sellers got
 * "your special offer has ended (Invalid Date)" for listings that never had an offer. Deletes those.
 */
export async function removeBogusOfferNotices() {
  const r = await Notification.deleteMany({ kind: 'listing_offer_ended', body: /Invalid Date/ });
  return r.deletedCount || 0;
}
