import rateLimit from 'express-rate-limit';

const opts = (windowMs, limit, message) => ({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: message } });

/** SMS codes and phone lookups. */
export const otpLimiter = rateLimit(opts(15 * 60 * 1000, 30, 'Too many requests. Try again in a few minutes.'));
/** Code checks and password sign-ins. */
export const loginLimiter = rateLimit(opts(15 * 60 * 1000, 40, 'Too many attempts. Try again in 15 minutes.'));
/** Public forms such as enquiries. */
export const formLimiter = rateLimit(opts(60 * 60 * 1000, 60, 'Too many messages sent. Try again later.'));
/** Chat messages in a conversation. */
export const messageLimiter = rateLimit(opts(10 * 60 * 1000, 120, "You're sending messages very fast. Wait a moment and try again."));
