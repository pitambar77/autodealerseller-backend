// Admin → Backups (IT / Technical Administrator and the MD): backup history, back up now, download.
// Restoring is deliberately not possible from the website: it runs on the server (npm run restore),
// see BACKUP_AND_RECOVERY.md.
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { Backup } from '../models/index.js';
import { ah, notFound } from '../lib/http.js';
import { requirePermission } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { backupDir, runBackup } from '../services/backup.js';
import { clean } from '../services/serialize.js';
import { config } from '../config.js';

const r = Router();
r.use(requirePermission('system.backups'));

r.get(
  '/',
  ah(async (_req, res) => {
    const list = (await Backup.find().sort({ at: -1 }).limit(60).lean()).map((b) => ({ ...clean(b), onDisk: !!b.file && fs.existsSync(path.join(backupDir(), b.file)) }));
    res.json({
      backups: list,
      settings: { everyHours: config.backup.everyHours, keep: config.backup.keep, encrypted: !!config.backup.encryptionKey, offsite: config.backup.offsite ? (config.backup.offsite === 'cloudinary' ? 'Cloudinary (private)' : 'Folder') : '', dir: config.backup.dir },
    });
  }),
);

r.post(
  '/',
  ah(async (req, res) => {
    const b = await runBackup(req.user.name);
    await audit(req.user, { action: 'Ran a backup', entityType: 'backup', entityId: b._id, note: `${b.file} (${Math.round(b.size / 1024)} KB)${b.offsite?.ok ? ', copied off-site' : ''}` });
    res.status(201).json({ backup: clean(b) });
  }),
);

/** Download a backup file. Recorded in the activity log. */
r.get(
  '/:id/download',
  ah(async (req, res) => {
    const b = await Backup.findById(req.params.id).lean();
    const file = b?.file && path.join(backupDir(), b.file);
    if (!file || !fs.existsSync(file)) throw notFound('That backup file is no longer on the server.');
    await audit(req.user, { action: 'Downloaded backup', entityType: 'backup', entityId: b._id, note: b.file });
    res.download(file, b.file);
  }),
);

export default r;
