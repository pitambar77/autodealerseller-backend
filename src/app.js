// Express application (no network listening here, so tests can import it).
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import path from 'node:path';
import fs from 'node:fs';
import { config, isProd } from './config.js';
import { attachUser } from './middleware/auth.js';
import { requestContext } from './lib/context.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { root as uploadRoot, verifyFileSig, sendCloudinaryFile } from './services/storage.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import vehicleRoutes from './routes/vehicles.js';
import paymentRoutes from './routes/payments.js';
import enquiryRoutes from './routes/enquiries.js';
import financeRoutes from './routes/finance.js';
import documentRoutes from './routes/documents.js';
import referralRoutes from './routes/referrals.js';
import handoverRoutes from './routes/handovers.js';
import adminRoutes from './routes/admin.js';
import systemRoutes from './routes/system.js';
import supportRoutes from './routes/support.js';
import categoryRoutes from './routes/categories.js';
import eventRoutes from './routes/events.js';
import loanProviderRoutes from './routes/loanProviders.js';
import lenderRoutes from './routes/lenders.js';
import cityRoutes from './routes/cities.js';
import bannerRoutes from './routes/banners.js';
import brandLogoRoutes from './routes/brandLogos.js';
import popularCategoryRoutes from './routes/popularCategories.js';
import staffRoutes from './routes/staff.js';
import securityRoutes from './routes/security.js';
import approvalRoutes from './routes/approvals.js';
import reconciliationRoutes from './routes/reconciliation.js';
import backupRoutes from './routes/backups.js';
import teamRoutes from './routes/team.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // Files are served before helmet so documents (PDFs) can be shown inside the website's preview frame.
  const fileHeaders = (res) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  };
  // Public listing photos
  app.use('/uploads/photos', express.static(path.join(uploadRoot, 'photos'), { maxAge: '30d', immutable: true, index: false, setHeaders: fileHeaders }));
  // Private documents: signed, expiring links only
  app.get('/files/:folder/:name', (req, res, next) => {
    // /files/c/<base64url key>: a private file stored on Cloudinary
    const cloud = req.params.folder === 'c';
    const key = cloud ? Buffer.from(req.params.name, 'base64url').toString() : `${req.params.folder}/${req.params.name}`;
    if (req.params.folder === 'photos' || !verifyFileSig(key, req.query.exp, req.query.sig)) return res.status(403).json({ error: 'This link has expired. Reload the page to get a new one.' });
    if (cloud) {
      fileHeaders(res);
      return sendCloudinaryFile(key, res).catch(next);
    }
    const file = path.join(uploadRoot, key);
    if (!file.startsWith(uploadRoot) || !fs.existsSync(file)) return res.status(404).json({ error: 'File not found.' });
    fileHeaders(res);
    res.set('Cache-Control', 'private, max-age=300');
    res.sendFile(file);
  });

  // Production: only encrypted connections (HTTPS), and browsers told to keep using HTTPS (HSTS).
  if (isProd && process.env.FORCE_HTTPS !== 'false') {
    app.use((req, res, next) => (req.secure || req.headers['x-forwarded-proto'] === 'https' || req.path === '/api/health' ? next() : res.redirect(308, `https://${req.headers.host}${req.originalUrl}`)));
  }
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true } }));
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)),
      credentials: false,
      exposedHeaders: ['X-Total-Count'],
    }),
  );
  // Live event streams must not be compressed (compression buffers them).
  app.use(compression({ filter: (req, res) => !req.path.startsWith('/api/events') && compression.filter(req, res) }));
  if (config.env !== 'test') app.use(morgan(isProd ? 'combined' : 'dev'));
  // Photos and documents arrive as base64 data URLs, so allow large JSON bodies. rawBody is kept for webhook signatures.
  app.use(
    express.json({
      limit: process.env.JSON_LIMIT || '80mb',
      verify: (req, _res, buf) => {
        if (req.originalUrl.startsWith('/api/payments/webhook')) req.rawBody = buf;
      },
    }),
  );

  app.use(requestContext);
  app.use('/api', attachUser);
  app.use('/api', systemRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/me', meRoutes);
  app.use('/api/vehicles', vehicleRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/enquiries', enquiryRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/finance-enquiries', financeRoutes);
  app.use('/api/documents', documentRoutes);
  app.use('/api/referrals', referralRoutes);
  app.use('/api/lenders', lenderRoutes);
  app.use('/api/handovers', handoverRoutes);
  app.use('/api/admin/categories', categoryRoutes);
  app.use('/api/admin/loan-providers', loanProviderRoutes);
  app.use('/api/admin/cities', cityRoutes);
  app.use('/api/admin/banners', bannerRoutes);
  app.use('/api/admin/brand-logos', brandLogoRoutes);
  app.use('/api/admin/popular-categories', popularCategoryRoutes);
  app.use('/api/admin/staff', staffRoutes);
  app.use('/api/admin/security', securityRoutes);
  app.use('/api/admin/approvals', approvalRoutes);
  app.use('/api/admin/reconciliation', reconciliationRoutes);
  app.use('/api/admin/backups', backupRoutes);
  app.use('/api/team', teamRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/support', supportRoutes);

  app.get('/', (_req, res) => res.json({ name: 'AutoDealer API', docs: 'See README.md', health: '/api/health' }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
