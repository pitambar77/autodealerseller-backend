# Backups and disaster recovery

## What is backed up

Every backup is **one file** that holds:

- every database collection: users, listings, payments, documents, audit log, settings, and the rest;
- with `STORAGE_DRIVER=local`, the uploaded photos and identity documents from `uploads/`. With Cloudinary, files live in Cloudinary, which keeps its own copies.

Two collections are left out: sign-in sessions and one-time codes. Both expire on their own.

The file is gzip-compressed. When `BACKUP_ENCRYPTION_KEY` is set it is also encrypted with **AES-256-GCM**. Its SHA-256 checksum is recorded in the database (Admin → Backups), so a damaged or altered file is detected before it can be restored. The backup also records the audit log's latest chain hash.

## Settings (`.env`)

| Setting | Default | What it does |
|---|---|---|
| `BACKUP_EVERY_HOURS` | `24` | How often the API backs up while it runs. The first backup is 10 minutes after start. `0` turns it off. |
| `BACKUP_DIR` | `backups` | Where backup files are written. |
| `BACKUP_KEEP` | `14` | How many local backups to keep. Older ones are deleted; off-site copies are kept. |
| `BACKUP_ENCRYPTION_KEY` | *(empty)* | **Set this in production.** Use `openssl rand -base64 32`, and store it away from the backups (for example in a password manager the MD and IT admin can open). Without it a backup can't be restored. |
| `BACKUP_OFFSITE` | *(empty)* | `cloudinary` keeps a private copy in your Cloudinary account. A folder path copies the file there, for example a mounted S3 bucket, Google Drive or NAS. |
| `BACKUP_INCLUDE_FILES` | `true` | Include uploaded files (only when they are stored on this server). |

If the API runs on several servers, set `BACKUP_EVERY_HOURS=0` on all but one. Alternatively, schedule backups with cron on a single machine:

```cron
0 2 * * *  cd /srv/autodealer-api && npm run backup >> /var/log/autodealer-backup.log 2>&1
```

Also turn on your database host's own backups. MongoDB Atlas, for example, offers continuous backup with point-in-time restore. The two kinds complement each other.

## Recommended targets

- **RPO** (how much data you could lose): up to 24 hours with the default daily backup. Use `BACKUP_EVERY_HOURS=6`, or Atlas continuous backup, for less.
- **RTO** (how long recovery takes): about 30–60 minutes for this procedure.

## Recovery procedure

Use this when the database is lost, corrupted or tampered with (for example, Admin → Security → "Check the activity log" reports tampering).

The **IT / Technical Administrator** carries it out and the **Managing Director** authorises it. Write down who did what and when.

1. **Stop the damage.** Stop the API (`Ctrl+C`, or stop the service) so nothing new is written. If an intrusion is suspected, rotate `JWT_SECRET` (this signs everyone out) and the database password before restarting anything.
2. **Pick the backup.** Admin → Backups lists them, newest first. Choose the latest one from before the problem started. If the server itself is lost, get the file from the off-site copy (Cloudinary → Media Library → `autodealer/backups`, or your off-site folder).
3. **Check the file without changing anything:**
   ```bash
   cd autodealer-api
   BACKUP_ENCRYPTION_KEY=… npm run restore -- backups/autodealer-2026-11-17T02-00-00.jsonl.gz
   ```
   It decrypts the file, verifies its checksum and lists what it contains. It changes nothing.
4. **Restore into a fresh database first, if you can.** Point `MONGODB_URI` at a new database, run the same command with `--yes`, start the API against it and check the data.
5. **Restore into production** with `--yes`. Each collection in the backup is replaced, and uploaded files are written back.
6. **Restart the API.** Sign in as the MD and check:
   - Admin → Security → **Check the activity log now** should report "Intact".
   - Recent listings, payments and users look right.
   - Admin → Backups → **Back up now** works.
7. **Reconcile the gap.** Payments made between the backup and the incident exist at the payment gateway but not in the database. Use Admin → Payments → Reconciliation and the gateway's dashboard to find them, then re-enter them with an approved **adjustment**.
8. **Record it.** Note what happened, which backup was used and what was re-entered.

## Test it

Restore the latest backup into a scratch database once a month (step 4). A backup is only proven when it has been restored.
