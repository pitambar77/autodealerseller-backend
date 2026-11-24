/** Error with an HTTP status, turned into a JSON response by the error middleware. */
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const badRequest = (m, d) => new HttpError(400, m, d);
export const unauthorized = (m = 'Sign in to continue.') => new HttpError(401, m);
export const forbidden = (m = "You don't have access to this.") => new HttpError(403, m);
export const notFound = (m = 'Not found.') => new HttpError(404, m);
export const conflict = (m, d) => new HttpError(409, m, d);

/** Wrap an async route handler so rejected promises reach the error middleware. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Validate req.body (or another object) with a zod schema; throws 400 with field errors. */
export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields = {};
    for (const i of r.error.issues) fields[i.path.join('.') || '_'] = i.message;
    throw badRequest('Some fields need attention.', { fields });
  }
  return r.data;
}

/** Copy only the listed keys that are present. */
export const pick = (obj = {}, keys = []) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
