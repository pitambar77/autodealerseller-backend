import os from 'node:os';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { connectDb } from './db.js';
import { config } from './config.js';
import { ensureCategories } from './services/categories.js';
import { ensureDefaultRoles } from './services/access.js';
import { startRealtime, closeAllStreams } from './services/realtime.js';
import { expireFeatured } from './services/payments.js';
import { startBackupSchedule } from './services/backup.js';
import { expireOffers, removeBogusOfferNotices, OFFER_EXPIRY_VERSION } from './services/offers.js';
import { storageStatus } from './services/storage.js';
import { smsStatus } from './services/sms.js';
import { emailStatus } from './services/email.js';

try {
  await connectDb(config.mongoUri);
  // First start, or a database from before categories were managed: add the starting categories.
  if (await ensureCategories()) console.log('Added the starting vehicle categories (manage them in Admin → Categories).');
  await ensureDefaultRoles(); // Managing Director, Operations, Listings, Finance, IT
} catch (e) {
  console.error(`Could not connect to MongoDB at ${config.mongoUri.replace(/\/\/[^@]*@/, '//***@')}: ${e.message}`);
  process.exit(1);
}
let live = 'memory';
try {
  live = await startRealtime();
} catch (e) {
  console.error(`Live updates: ${e.message}`);
  process.exit(1);
}
// Featured boosts that have run out lose their badge (checked every 10 minutes).
// Automatic backups (BACKUP_EVERY_HOURS, default every 24 hours).
const backups = startBackupSchedule();
setInterval(() => expireFeatured().catch((e) => console.error('[featured]', e.message)), 10 * 60_000).unref();
// Offers past their end date go back to the normal price.
setInterval(() => expireOffers().catch((e) => console.error('[offers]', e.message)), 10 * 60_000).unref();
removeBogusOfferNotices()
  .then((n) => n && console.log(`Removed ${n} wrong "offer ended" notifications.`))
  .catch(() => {})
  .finally(() => expireOffers().catch(() => {}));

const server = createApp().listen(config.port, () => {
  const st = storageStatus();
  console.log(`AutoDealer API on ${config.publicUrl} (${config.env})`);
  console.log(`  offer expiry: ${OFFER_EXPIRY_VERSION} · server ${os.hostname()}, process ${process.pid}`);
  console.log(`  backups: ${backups ? `every ${config.backup.everyHours} h → ${config.backup.dir}${config.backup.offsite ? ` + off-site (${config.backup.offsite})` : ''}${config.backup.encryptionKey ? ', encrypted' : ', NOT encrypted (set BACKUP_ENCRYPTION_KEY)'}` : 'automatic backups off (BACKUP_EVERY_HOURS=0)'}`);
  console.log(`  files: ${st.driver}${st.cloud ? ` (${st.cloud}/${st.folder})` : ''} · sms: ${smsStatus().provider} · email: ${emailStatus().provider} · live updates: ${live}`);
  if (!st.ready) console.warn(`  ⚠ ${st.error}`);
  if (config.allowDemoLogin) console.log('Demo sign-in is ON (ALLOW_DEMO_LOGIN). Turn it off in production.');
});
// Stop cleanly on Ctrl+C / SIGTERM. Open pages keep live-update streams open, which would stop
// server.close() from ever finishing, so end them first. A second Ctrl+C exits immediately.
let stopping = false;
const stop = (signal) => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log(`\n${signal}: stopping the API…`);
  closeAllStreams();
  server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
  server.closeIdleConnections?.();
  setTimeout(() => {
    server.closeAllConnections?.();
    process.exit(0);
  }, 3000).unref();
};
process.once('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
