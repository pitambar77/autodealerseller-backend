// Each partner lender's financing eligibility criteria, set by the lender in its lead desk (Partner desk →
// Eligibility criteria). Finance enquiries are only sent to lenders whose criteria the vehicle and loan meet:
// the calculator shows only matching lenders, and the API refuses an enquiry that doesn't match.
// Empty or missing values mean "no limit". The same file is in the web app (src/config/lenderCriteria.js):
// keep both copies identical.

export const EMPTY_CRITERIA = {
  maxVehicleAge: null, // years, e.g. 8 or 10
  categories: [], // vehicle category keys (car, motorcycle, lorry…); empty = all
  sellerTypes: [], // who sells the vehicle: 'seller' (private owner), 'agent', 'dealer'; empty = all
  conditions: [], // 'New', 'Used', 'Certified pre-owned'; empty = all
  minPrice: null, // TSh
  maxPrice: null, // TSh
  maxMileageKm: null,
  cities: [], // where the vehicle is; empty = anywhere
  minDownPct: null, // smallest down payment, % of the price
  maxTenureMonths: null, // longest loan
};

/** Seller types a lender can choose from (the listing's sellerRole). */
export const SELLER_TYPES = [
  { value: 'seller', label: 'Private sellers (owners)' },
  { value: 'agent', label: 'Agents' },
  { value: 'dealer', label: 'Registered dealers' },
];
const sellerName = (v) => ({ seller: 'private sellers', agent: 'agents', dealer: 'registered dealers' })[v] || v;

const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const list = (v) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x).trim()).filter(Boolean))] : []);

/** True when the lender has set at least one limit. */
export const hasCriteria = (c) => !!c && Object.entries(EMPTY_CRITERIA).some(([k, empty]) => (Array.isArray(empty) ? list(c[k]).length : num(c[k]) != null));

/**
 * Checks a vehicle and loan against a lender's criteria.
 * vehicle is optional (the calculator can run on a price alone): vehicle checks are skipped without one.
 * labels.category(key) turns a category key into a name for the reasons ("Trucks & Trailers").
 * Returns a list of reasons it doesn't match ([] = eligible).
 */
export function checkEligibility(criteria, { vehicle, price, downPayment, months, now = new Date() } = {}, labels = {}) {
  const c = criteria || {};
  const out = [];
  const cat = (k) => (labels.category ? labels.category(k) : k);
  const p = num(price ?? vehicle?.price);
  if (vehicle) {
    const maxAge = num(c.maxVehicleAge);
    const year = num(vehicle.year);
    if (maxAge != null && year != null) {
      const age = now.getFullYear() - year;
      if (age > maxAge) out.push({ code: 'age', text: `Finances vehicles up to ${maxAge} year${maxAge === 1 ? '' : 's'} old (this one is ${age})` });
    }
    const cats = list(c.categories);
    const vc = vehicle.category || 'car';
    if (cats.length && !cats.includes(vc)) out.push({ code: 'category', text: `Doesn't finance ${cat(vc)} (finances ${cats.map(cat).join(', ')})` });
    const sellers = list(c.sellerTypes);
    if (sellers.length && vehicle.sellerRole && !sellers.includes(vehicle.sellerRole)) out.push({ code: 'seller', text: `Only finances vehicles sold by ${sellers.map(sellerName).join(' or ')}` });
    const conds = list(c.conditions);
    if (conds.length && vehicle.condition && !conds.includes(vehicle.condition)) out.push({ code: 'condition', text: `Only finances ${conds.join(' or ').toLowerCase()} vehicles` });
    const maxKm = num(c.maxMileageKm);
    if (maxKm != null && num(vehicle.mileage) != null && Number(vehicle.mileage) > maxKm) out.push({ code: 'mileage', text: `Finances vehicles with up to ${maxKm.toLocaleString('en-US')} km` });
    const cities = list(c.cities);
    if (cities.length && vehicle.city && !cities.includes(vehicle.city)) out.push({ code: 'city', text: `Only finances vehicles in ${cities.join(', ')}` });
  }
  const minP = num(c.minPrice);
  const maxP = num(c.maxPrice);
  if (p != null && minP != null && p < minP) out.push({ code: 'price', text: `Finances vehicles from TSh ${minP.toLocaleString('en-US')}` });
  if (p != null && maxP != null && p > maxP) out.push({ code: 'price', text: `Finances vehicles up to TSh ${maxP.toLocaleString('en-US')}` });
  const minDown = num(c.minDownPct);
  if (minDown != null && p) {
    const pct = ((num(downPayment) || 0) / p) * 100;
    if (pct + 1e-9 < minDown) out.push({ code: 'down', text: `Needs at least ${minDown}% down payment` });
  }
  const maxT = num(c.maxTenureMonths);
  if (maxT != null && num(months) != null && Number(months) > maxT) out.push({ code: 'tenure', text: `Longest loan is ${maxT} months` });
  return out;
}

/** One-line summary of the criteria for lists ("Cars, Trucks · up to 10 years old · from 20% down"). */
export function describeCriteria(criteria, labels = {}) {
  const c = criteria || {};
  const cat = (k) => (labels.category ? labels.category(k) : k);
  const parts = [];
  if (list(c.categories).length) parts.push(list(c.categories).map(cat).join(', '));
  if (list(c.sellerTypes).length) parts.push(`sold by ${list(c.sellerTypes).map(sellerName).join(' or ')}`);
  if (num(c.maxVehicleAge) != null) parts.push(`up to ${num(c.maxVehicleAge)} years old`);
  if (list(c.conditions).length) parts.push(list(c.conditions).join(' or '));
  if (num(c.minPrice) != null || num(c.maxPrice) != null) parts.push(`TSh ${num(c.minPrice) != null ? num(c.minPrice).toLocaleString('en-US') : '0'}–${num(c.maxPrice) != null ? num(c.maxPrice).toLocaleString('en-US') : 'any'}`);
  if (num(c.maxMileageKm) != null) parts.push(`up to ${num(c.maxMileageKm).toLocaleString('en-US')} km`);
  if (list(c.cities).length) parts.push(`in ${list(c.cities).join(', ')}`);
  if (num(c.minDownPct) != null) parts.push(`from ${num(c.minDownPct)}% down`);
  if (num(c.maxTenureMonths) != null) parts.push(`up to ${num(c.maxTenureMonths)} months`);
  return parts.length ? parts.join(' · ') : 'All vehicles (no limits set)';
}

/**
 * Validates criteria sent by a lender. allowed = { categories: [keys], conditions: [...], cities: [...] }
 * (seller types are always checked against SELLER_TYPES).
 * Returns { criteria } or { error } (a plain sentence).
 */
export function cleanCriteria(input, allowed = {}) {
  const i = input || {};
  const c = { ...EMPTY_CRITERIA };
  const bounded = (k, min, max, label) => {
    const v = num(i[k]);
    if (i[k] !== '' && i[k] != null && v == null) return `${label}: enter a number.`;
    if (v != null && (v < min || v > max)) return `${label}: use ${min.toLocaleString('en-US')}–${max.toLocaleString('en-US')}.`;
    c[k] = v == null ? null : k === 'maxMileageKm' || k === 'minPrice' || k === 'maxPrice' ? Math.round(v) : v;
    return null;
  };
  const errs = [
    bounded('maxVehicleAge', 0, 50, 'Maximum vehicle age'),
    bounded('minPrice', 0, 5e10, 'Lowest price'),
    bounded('maxPrice', 0, 5e10, 'Highest price'),
    bounded('maxMileageKm', 0, 5e6, 'Maximum mileage'),
    bounded('minDownPct', 0, 90, 'Minimum down payment'),
    bounded('maxTenureMonths', 6, 180, 'Longest loan'),
  ].filter(Boolean);
  if (errs.length) return { error: errs[0] };
  if (c.minPrice != null && c.maxPrice != null && c.minPrice > c.maxPrice) return { error: 'The lowest price is above the highest price.' };
  for (const [k, label] of [['categories', 'category'], ['sellerTypes', 'seller type'], ['conditions', 'condition'], ['cities', 'city']]) {
    const v = list(i[k]);
    const ok = k === 'sellerTypes' ? SELLER_TYPES.map((t) => t.value) : allowed[k];
    const bad = ok ? v.filter((x) => !ok.includes(x)) : [];
    if (bad.length) return { error: `Unknown ${label}: ${bad.join(', ')}.` };
    c[k] = v;
  }
  return { criteria: c };
}
