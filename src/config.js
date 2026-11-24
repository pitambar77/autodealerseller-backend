// All settings come from environment variables (see .env.example).
import 'dotenv/config';

const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/autodealer',
  /** Public base URL of this API, used to build upload/file links (no trailing slash). */
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, ''),
  /** Address of the Next.js site (links in emails, SMS and invites). */
  webUrl: (process.env.WEB_URL || 'http://localhost:3000').replace(/\/$/, ''),
  /** Frontend origins allowed by CORS, comma separated. */
  corsOrigins: list(process.env.CORS_ORIGINS || 'http://localhost:3000'),
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  /** Secret used to sign private file links (documents). Defaults to JWT_SECRET. */
  fileSecret: process.env.FILE_SIGNING_SECRET || process.env.JWT_SECRET || 'change-me-in-production',
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 50),

  otp: {
    /** SMS provider for sign-in codes (same as sms.provider; OTP_PROVIDER is the older name) */
    provider: process.env.SMS_PROVIDER || process.env.OTP_PROVIDER || 'console',
    ttlMinutes: Number(process.env.OTP_TTL_MINUTES || 10),
    maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS || 5),
    /** Fixed code for local development only (ignored in production). */
    devCode: process.env.OTP_DEV_CODE || '',
    twilio: { sid: process.env.TWILIO_ACCOUNT_SID, token: process.env.TWILIO_AUTH_TOKEN, from: process.env.TWILIO_FROM },
    africastalking: { username: process.env.AT_USERNAME, apiKey: process.env.AT_API_KEY, from: process.env.AT_SENDER_ID },
  },

  /** Text messages: sign-in codes, enquiry alerts and replies to guests. */
  sms: {
    /** console | beem | africastalking | twilio — console prints messages (development only) */
    provider: process.env.SMS_PROVIDER || process.env.OTP_PROVIDER || 'console',
    /** Also send enquiry and message alerts by SMS (sign-in codes are always sent) */
    notifications: bool(process.env.SMS_NOTIFICATIONS, true),
    /** Don't text the same person about the same conversation more often than this */
    throttleMinutes: Number(process.env.SMS_THROTTLE_MINUTES || 15),
    beem: { apiKey: process.env.BEEM_API_KEY, secretKey: process.env.BEEM_SECRET_KEY, senderId: process.env.BEEM_SENDER_ID || 'INFO' },
  },

  /** Email: enquiry alerts, replies and receipts. console | smtp */
  email: {
    provider: process.env.EMAIL_PROVIDER || 'console',
    from: process.env.EMAIL_FROM || 'AutoDealer <no-reply@autodealer.example>',
    smtp: {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: bool(process.env.SMTP_SECURE, false),
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  },

  /** Where photos and documents are stored: local | cloudinary */
  storage: {
    driver: process.env.STORAGE_DRIVER || (process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME ? 'cloudinary' : 'local'),
    cloudinary: {
      url: process.env.CLOUDINARY_URL,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      apiSecret: process.env.CLOUDINARY_API_SECRET,
      /** Top-level folder in your Cloudinary media library */
      folder: process.env.CLOUDINARY_FOLDER || 'autodealer',
    },
  },

  /** Live updates (messages, notifications). Set REDIS_URL when running more than one API server. */
  realtime: { redisUrl: process.env.REDIS_URL || '' },

  payments: {
    /** mock — simulated gateway (outcome chosen on the checkout page). Plug a real gateway into services/payments.js. */
    provider: process.env.PAYMENT_PROVIDER || 'mock',
    webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || '',
    vatRate: Number(process.env.VAT_RATE || 0.18),
  },

  /** Database backups (see BACKUP_AND_RECOVERY.md). */
  backup: {
    dir: process.env.BACKUP_DIR || 'backups',
    /** Automatic backup every N hours while the API runs (0 = off; use cron with `npm run backup` instead). */
    everyHours: Number(process.env.BACKUP_EVERY_HOURS ?? (process.env.NODE_ENV === 'test' ? 0 : 24)),
    /** How many backups to keep in BACKUP_DIR (older ones are deleted; off-site copies are kept). */
    keep: Number(process.env.BACKUP_KEEP || 14),
    /** Encrypt backups with AES-256-GCM. Keep this key safe and separate: without it a backup can't be restored. */
    encryptionKey: process.env.BACKUP_ENCRYPTION_KEY || '',
    /** Off-site copy: 'cloudinary' (private raw files), a folder path (e.g. a mounted S3/Drive bucket), or '' for none. */
    offsite: process.env.BACKUP_OFFSITE || '',
    /** Include uploaded files (photos, documents) when they're stored on this server's disk. */
    includeFiles: bool(process.env.BACKUP_INCLUDE_FILES, true),
  },

  /** Development helpers. Keep both OFF in production. */
  allowDemoLogin: bool(process.env.ALLOW_DEMO_LOGIN, false),
  allowDemoReset: bool(process.env.ALLOW_DEMO_RESET, false),
};

export const isProd = config.env === 'production';

if (isProd && config.jwtSecret === 'change-me-in-production') {
  throw new Error('Set JWT_SECRET before running in production.');
}
