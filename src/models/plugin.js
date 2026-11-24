// Shared schema behaviour: string ids (same ids as the frontend, e.g. "v1005", "u_dealer1"),
// and JSON output with `id` instead of `_id`.
export function baseOptions(extra = {}) {
  const transform = (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  };
  // A schema that stores fields it doesn't declare (strict: false) must also be queryable by them.
  // Otherwise the global strictQuery (db.js) silently drops those conditions: a filter such as
  // { 'offer.endsAt': { $lt: now } } became {} and the offer-expiry job ended every listing's offer.
  const queries = extra.strict === false ? { strictQuery: false } : {};
  return { versionKey: false, minimize: false, toJSON: { transform }, toObject: { transform }, ...queries, ...extra };
}
