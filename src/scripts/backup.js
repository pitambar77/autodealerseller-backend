// Make a backup now: npm run backup  (schedule with cron, e.g. "0 2 * * *", if the API's own
// schedule — BACKUP_EVERY_HOURS — is off). See BACKUP_AND_RECOVERY.md.
import { connectDb, disconnectDb } from '../db.js';
import { config } from '../config.js';
import { runBackup } from '../services/backup.js';
import { audit } from '../services/audit.js';

try {
  await connectDb(config.mongoUri);
  const b = await runBackup('command line');
  await audit(null, { action: 'Ran a backup', entityType: 'backup', entityId: b._id, note: `${b.file} from the command line` });
  console.log(`Backup written: ${config.backup.dir}/${b.file} (${Math.round(b.size / 1024)} KB, ${b.encrypted ? 'encrypted' : 'NOT encrypted — set BACKUP_ENCRYPTION_KEY'})`);
  console.log(`  sha256 ${b.sha256}`);
  console.log(`  off-site: ${b.offsite?.ok ? `${b.offsite.where} ${b.offsite.ref}` : b.offsite?.error || 'not set up (BACKUP_OFFSITE)'}`);
} catch (e) {
  console.error(`Backup failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
