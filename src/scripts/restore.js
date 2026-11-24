// Restore a backup: npm run restore -- <file> [--yes]
// Without --yes it only checks the file and shows what it contains. With --yes it REPLACES the data
// in the connected database (MONGODB_URI). See BACKUP_AND_RECOVERY.md before using it.
import { connectDb, disconnectDb } from '../db.js';
import { config } from '../config.js';
import { inspectBackup, restoreBackup } from '../services/backup.js';
import { audit } from '../services/audit.js';

const file = process.argv[2];
const yes = process.argv.includes('--yes');
if (!file) {
  console.error('Usage: npm run restore -- <backup file> [--yes]');
  process.exit(1);
}
try {
  await connectDb(config.mongoUri);
  const { header, footer, sha256 } = await inspectBackup(file);
  console.log(`Backup from ${header.createdAt}  (sha256 ${sha256.slice(0, 16)}…)`);
  Object.entries(footer.counts || {}).forEach(([c, n]) => console.log(`  ${c}: ${n}`));
  if (footer.files) console.log(`  uploaded files: ${footer.files}`);
  if (!yes) {
    console.log(`\nThe file is readable and intact. To replace the data in ${config.mongoUri.replace(/\/\/[^@]*@/, '//***@')} with it, run again with --yes.`);
  } else {
    console.log('\nRestoring…');
    const out = await restoreBackup(file);
    await audit(null, { action: 'Restored a backup', entityType: 'backup', entityId: file, note: `Backup from ${out.createdAt} restored from the command line.` });
    console.log('Done. Restart the API.');
  }
} catch (e) {
  console.error(`Restore failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
