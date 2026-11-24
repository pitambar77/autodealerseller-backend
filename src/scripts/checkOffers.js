// Shows what removed discounts and special offers, from the activity log (read-only: changes nothing).
//   npm run check:offers                → the last 3 days, all listings
//   npm run check:offers -- v12345      → one listing, last 30 days
//
// "Offer ended" entries from many listings in the same minute mean an API server with the old expiry bug
// (before 19 Nov 2026) is still running somewhere against this database. The fixed code writes
// "Ended by server <name>, process <id>" in each entry, so you can also see which machine ended an offer.
import { connectDb, disconnectDb } from '../db.js';
import { config } from '../config.js';
import { AuditLog, Vehicle } from '../models/index.js';

const listingId = process.argv[2];
const days = listingId ? 30 : 3;
const since = new Date(Date.now() - days * 864e5).toISOString();
const ist = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' }) + ' IST';

try {
  await connectDb(config.mongoUri);
  const OFFER_ACTIONS = /offer|discount|Edited listing/i;
  const filter = { at: { $gte: since }, entityType: 'listing', action: OFFER_ACTIONS, ...(listingId ? { entityId: listingId } : {}) };
  const entries = await AuditLog.find(filter).sort({ at: 1 }).lean();

  if (listingId) {
    const v = await Vehicle.findById(listingId).lean();
    console.log(`\nListing ${listingId}: ${v ? `${v.year} ${v.make} ${v.model}, price ${v.price}, offer now: ${v.offer ? `${v.offer.kind}, ends ${v.offer.endsAt || 'when the seller ends it'}` : 'none'}` : 'not found'}\n`);
    for (const e of entries) console.log(`${ist(e.at)}  ${e.action.padEnd(16)} by ${e.actor || 'system'}${e.note ? `  · ${e.note}` : ''}${e.changes?.price ? `  · price ${e.changes.price.from ?? e.changes.price[0]} → ${e.changes.price.to ?? e.changes.price[1]}` : ''}`);
    if (!entries.length) console.log('No offer activity recorded for this listing in the last 30 days.');
  }

  // Automatic endings grouped by minute: a burst across many listings is the old bug.
  const auto = entries.filter((e) => e.action === 'Offer ended');
  const byMinute = {};
  for (const e of auto) (byMinute[e.at.slice(0, 16)] ||= []).push(e);
  const bursts = Object.entries(byMinute).filter(([, list]) => list.length > 3);
  console.log(`\nAutomatic "Offer ended" entries in the last ${days} days: ${auto.length}`);
  for (const [minute, list] of Object.entries(byMinute)) {
    const server = list[0].note?.match(/Ended by server (.*)\./)?.[1];
    console.log(`  ${ist(minute + ':00Z')}  ${String(list.length).padStart(3)} listing(s)  ${server ? `by ${server}` : 'by a server running OLD code (no server name)'}`);
  }
  if (bursts.length) {
    console.log(`\n⚠  ${bursts.length} time(s) many listings were "ended" in the same minute. That is the old bug: an API`);
    console.log('   started before the 19 Nov update is still running against this database. Stop every old copy:');
    console.log('   other terminal windows, a background process, or a hosted copy (Render, Railway, a VPS…) that uses');
    console.log('   the same MONGODB_URI. Then start only the updated API. Its start-up shows "offer expiry: 2026-11-19".');
  } else if (auto.some((e) => !/Ended by server/.test(e.note || ''))) {
    console.log('\n⚠  Some offers were ended by a server running old code. Stop every old copy of the API (see above).');
  } else {
    console.log('\n✓  No sign of the old bug in this period.');
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
