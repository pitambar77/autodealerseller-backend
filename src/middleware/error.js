import { isProd } from '../config.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too large.' });
  if (err?.code === 11000) return res.status(409).json({ error: 'That record already exists.', details: err.keyValue });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  return res.status(status).json({ error: status >= 500 && isProd ? 'Something went wrong. Please try again.' : err.message, ...(err.details ? { details: err.details } : {}) });
}
