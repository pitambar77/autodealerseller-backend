import { Setting } from '../models/index.js';
import { DEFAULT_CONFIG } from '../shared/site.js';
import { fileUrl } from './storage.js';

/** Platform configuration with defaults filled in. */
export async function getConfig() {
  const s = await Setting.findById('platform').lean();
  const c = { ...structuredClone(DEFAULT_CONFIG), ...(s?.value || {}) };
  c.security = { ...DEFAULT_CONFIG.security, ...(s?.value?.security || {}) };
  return c;
}

// Sign-in checks read the security rules on every request: keep them for a few seconds.
let securityCache = null;
/** Admin security rules (idle sign-out, lockout, 2FA). */
export async function getSecurity() {
  if (securityCache && Date.now() - securityCache.at < 5000) return securityCache.value;
  const value = (await getConfig()).security;
  securityCache = { at: Date.now(), value };
  return value;
}

export async function updateConfig(patch) {
  const current = await getConfig();
  const value = { ...current, ...patch };
  await Setting.findByIdAndUpdate('platform', { _id: 'platform', value }, { upsert: true });
  securityCache = null;
  return value;
}

/** Public part of the configuration: no gateway keys, passwords or lender API keys. */
/** Popular-category tiles with photo links (built-in files start with "/"; uploads are storage keys). */
export function popularView(section, { all }) {
  const s = section || DEFAULT_CONFIG.popularCategories;
  const img = (p) => (!p ? '' : p.startsWith('/') || /^https?:/.test(p) ? p : fileUrl(p));
  return { title: s.title || 'Popular categories', tiles: (s.tiles || []).filter((t) => all || t.enabled !== false).map((t) => ({ ...t, image: img(t.image) })) };
}

export function publicConfig(c) {
  return {
    verificationPortalName: c.verificationPortalName,
    verificationPortalUrl: c.verificationPortalUrl,
    agentAuthorizationRequired: c.agentAuthorizationRequired,
    listingValidityDays: c.listingValidityDays,
    sellerListingLimit: c.sellerListingLimit ?? 0,
    featuredDays: c.featuredDays ?? 7,
    defaultInterestRate: c.defaultInterestRate,
    // Lenders and what buyers see about them (never their API keys)
    loanProviders: (c.loanProviders || []).map(({ apiKey: _key, ...l }) => (l.logo ? { ...l, logo: fileUrl(l.logo) } : l)),
    paymentGateway: { provider: c.paymentGateway?.provider, mode: c.paymentGateway?.mode },
    otpProvider: { provider: c.otpProvider?.provider },
    email: { provider: c.email?.provider },
    // Home page banner slides that are switched on, with image addresses
    heroSlides: (c.heroSlides || []).filter((h) => h.enabled !== false && h.image).map((h) => ({ ...h, image: fileUrl(h.image) })),
    // Home banner heading (coloured words, line breaks) and the "Sell your car" button
    heroHeading: c.heroHeading,
    heroSellButton: c.heroSellButton,
    // Trust indicators under the home banner buttons (only the ones switched on)
    trustIndicators: (c.trustIndicators || []).filter((t) => t.enabled !== false && t.text).map(({ id, text, icon, link }) => ({ id, text, icon, link: link || '' })),
    // Cities people can choose (Admin → Configuration → Cities); switched-off ones are hidden in forms
    cities: (c.cities || []).map(({ name, region, zanzibar, enabled }) => ({ name, region, ...(zanzibar ? { zanzibar: true } : {}), enabled: enabled !== false })),
    // Photos admins uploaded for the dealer directory's city tiles: { 'Dar es Salaam': url }
    cityImages: Object.fromEntries(Object.entries(c.cityImages || {}).map(([city, key]) => [city, fileUrl(key)])),
    // Popular categories on the home page (switched-on tiles, photos as links)
    popularCategories: popularView(c.popularCategories, { all: false }),
    // Uploaded brand logos as { make: url } (the website falls back to its built-in files)
    brandLogos: Object.fromEntries((c.brandLogos || []).filter((b) => b?.make && b?.key).map((b) => [b.make, fileUrl(b.key)])),
  };
}

/** The configuration as admin screens get it: everything, with file keys turned into addresses. */
export function adminConfig(c) {
  const pub = publicConfig(c);
  const logos = Object.fromEntries(pub.loanProviders.map((l) => [l.id, l.logo]));
  // trustIndicators: all of them, including switched-off ones; lender logos as links
  return { ...c, cityImages: pub.cityImages, heroSlides: pub.heroSlides, brandLogos: pub.brandLogos, popularCategories: popularView(c.popularCategories, { all: true }), loanProviders: (c.loanProviders || []).map((l) => (l.logo ? { ...l, logo: logos[l.id] } : l)) };
}
