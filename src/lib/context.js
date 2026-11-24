// Per-request context (who, from where), available anywhere during a request without passing `req`
// around: the audit log uses it to record the IP address and the person who acted.
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage();

export const requestContext = (req, _res, next) => store.run({ ip: req.ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 200) }, next);
export const ctx = () => store.getStore() || {};
/** Add to the current request's context (e.g. the signed-in team member). */
export const setCtx = (patch) => Object.assign(store.getStore() || {}, patch);
