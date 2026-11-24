export const cn = (...c) => c.filter(Boolean).join(' ');

// Money is stored and shown in Tanzanian shillings (TZS).
const numFmt = new Intl.NumberFormat('en-US');
export const num = (n) => numFmt.format(Math.round(Number(n) || 0));

export const CURRENCY = { code: 'TZS', symbol: 'TSh' };

/** Full amount: TSh 26,400,000 */
export const tzs = (n) => `TSh ${num(n)}`;

/** Compact amount for tight spaces: TSh 26.4M · TSh 850K · TSh 1.2B */
export function tzsShort(n) {
  const v = Math.round(Number(n) || 0);
  const trim = (x, d) => String(parseFloat(x.toFixed(d)));
  if (Math.abs(v) >= 1e9) return `TSh ${trim(v / 1e9, 2)}B`;
  if (Math.abs(v) >= 1e6) return `TSh ${trim(v / 1e6, Math.abs(v) >= 1e8 ? 0 : Math.abs(v) >= 1e7 ? 1 : 2)}M`;
  if (Math.abs(v) >= 1e4) return `TSh ${trim(v / 1e3, 0)}K`;
  return tzs(v);
}

export const km = (n) => `${num(n)} km`;

// Dates and times are shown in Tanzania time (EAT, UTC+3) wherever the visitor is.
export const TIME_ZONE = 'Africa/Dar_es_Salaam';
export function date(d, opts = { day: '2-digit', month: 'short', year: 'numeric' }) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { timeZone: TIME_ZONE, ...opts });
}
export function dateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { timeZone: TIME_ZONE, day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
}
export function ago(d) {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return date(d);
}

export const daysAgo = (n, h = 10) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, (n * 17) % 60, 0, 0);
  return d.toISOString();
};

export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

/** Normalise registration numbers / VINs for comparisons: "T 123-abc" → "T123ABC" */
export const normId = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Tanzanian registration numbers: T 123 ABC (vehicles), MC 123 ABC (motorcycles), Z 123 AB (Zanzibar).
 * Spaces and case don't matter: "t123abc" is the same as "T 123 ABC".
 */
export const REG_RE = /^(T\d{3}[A-Z]{3}|MC\d{3}[A-Z]{3}|Z\d{3}[A-Z]{2,3})$/;
export const isRegNumber = (s) => REG_RE.test(normId(s));
export const REG_HINT = 'e.g. T 123 ABC (motorcycles MC 123 ABC)';

/** Pretty-print a registration number: T123ABC → T 123 ABC */
export function prettyReg(s) {
  const n = normId(s);
  const tz = n.match(/^(T|MC|Z)(\d{3})([A-Z]{2,3})$/);
  return tz ? `${tz[1]} ${tz[2]} ${tz[3]}` : n;
}

// ── Tanzanian phone numbers: +255 and 9 digits; mobiles start with 6 or 7 (+255 712 345 678).
export const COUNTRY_CODE = '+255';
/** The 9 national digits, accepting 0712…, 255712…, +255 712 … */
export function tzDigits(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.startsWith('255') && d.length > 9) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return d;
}
export const isTzMobile = (s) => /^[67]\d{8}$/.test(tzDigits(s));
/** "+255 712 345 678" */
export const tzPhone = (s) => {
  const d = tzDigits(s);
  return `${COUNTRY_CODE} ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`.trim();
};
/** The part after +255, for an input with a "+255" prefix: "712 345 678" */
export const tzLocal = (s) => (s ? tzPhone(s).slice(COUNTRY_CODE.length + 1) : '');
export const MOBILE_ERROR = 'Enter a Tanzanian mobile number, e.g. 712 345 678';
export const MOBILE_PLACEHOLDER = '712 345 678';

/** "+255 712 ••• 678" */
export const maskPhone = (p) => (p ? p.replace(/^(\+\d{1,3}\s?)(\d{3})[\s\d]*?(\d{3})$/, '$1$2 ••• $3') : '');
export const maskSecret = (s) => (s ? `${s.slice(0, 4)}${'•'.repeat(Math.max(4, s.length - 8))}${s.slice(-4)}` : '');

export const initials = (name = '') =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

export function toCSV(rows, columns) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.value])).join(',')).join('\n');
  return `${head}\n${body}`;
}

/** Try a real download; callers also show the CSV in a modal because some sandboxes block downloads. */
export function tryDownload(filename, text, type = 'text/csv') {
  try {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    /* ignored — modal fallback */
  }
}

export const readFileAsDataURL = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
