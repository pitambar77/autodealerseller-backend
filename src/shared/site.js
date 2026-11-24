import { DEFAULT_CITIES } from './catalog.js';
import { DEFAULT_HEADING } from './heading.js';
// Central product configuration. Values marked (admin) can be overridden
// from Admin → Platform Configuration; those overrides live in the mock store.

export const SITE = {
  name: 'AutoDealer',
  tagline: 'Cars, motorcycles and lorries from verified dealers, owners and agents',
  supportPhone: '+255 22 211 8290',
  supportEmail: 'support@autodealer.example',
  supportHours: 'Mon–Sat, 9:00 am – 7:00 pm EAT (Tanzania time, UTC+3)',
  /** Office hours in Tanzania time (Africa/Dar_es_Salaam): days 1–6 = Mon–Sat, hours 9–19. */
  supportOpen: { days: [1, 2, 3, 4, 5, 6], from: 9, to: 19 },
  timeZone: 'Africa/Dar_es_Salaam',
  address: '4th Floor, Plot 52, Bagamoyo Road, Mikocheni, Dar es Salaam',
  currency: 'TZS',
  locale: 'en-GB',
  defaultCountryCode: '+255',
};

export const DEFAULT_CONFIG = {
  // (admin) Official verification portal — buyers are sent here, nothing is checked by AutoDealer
  verificationPortalName: 'TRA — motor vehicle registration',
  verificationPortalUrl: 'https://www.tra.go.tz/',
  // (admin) Agent owner-authorization policy
  agentAuthorizationRequired: true,
  // (admin) Listing validity
  listingValidityDays: 60,
  // (admin) How many active listings a private seller may have at once. 0 = no limit.
  sellerListingLimit: 0,
  // (admin) How long a "Feature this listing" boost lasts
  featuredDays: 7,
  // (admin) Providers — sandbox placeholders only
  paymentGateway: { provider: 'Razorpay', mode: 'test', keyId: 'rzp_test_7Hq2LmX93kP9', keySecret: 'sk_test_51NqAbcDeFgH0aR4xY' },
  otpProvider: { provider: 'MSG91', senderId: 'AUTODL', authKey: 'msg91_8823aa7d9c1e44f2b0', templateId: 'otp_login_v2' },
  email: { provider: 'Amazon SES', fromAddress: 'no-reply@autodealer.example', smtpHost: 'email-smtp.ap-south-1.amazonaws.com', smtpPassword: 'BOQx7Ses93LmZ1pK' },
  loanProviders: [
    // criteria: the lender's own eligibility rules (Partner desk → Eligibility criteria; see lenderCriteria.js).
    { id: 'lp1', name: 'Pwani Auto Finance', commissionPct: 0.75, enabled: true, apiKey: 'saf_live_disabled_9921', criteria: { maxVehicleAge: 10, categories: ['car', 'motorcycle', 'bus'], conditions: [], minPrice: null, maxPrice: null, maxMileageKm: null, cities: [], minDownPct: 15, maxTenureMonths: 60 } },
    { id: 'lp2', name: 'NorthStar Bank Car Loans', commissionPct: 0.6, enabled: true, apiKey: 'nsb_sbx_31ff02a', criteria: { maxVehicleAge: 8, categories: ['car', 'lorry', 'construction'], conditions: [], minPrice: 5000000, maxPrice: null, maxMileageKm: null, cities: [], minDownPct: 10, maxTenureMonths: 60 } },
    { id: 'lp3', name: 'Kilimanjaro Credit Co-op', commissionPct: 0.9, enabled: false, apiKey: 'kcc_sbx_77a10c' },
  ],
  defaultInterestRate: 18,
  // (admin) Security rules for admin staff (Admin → Security)
  security: { adminIdleMinutes: 30, adminSessionHours: 12, maxFailedLogins: 5, lockMinutes: 15, adminTwoFactorRequired: true },
  // (admin) Home page banner slides (Admin → Content → Home banner). Images in the web app's /public
  // folder or uploaded files; title/text/button are optional (empty = the standard headline).
  heroSlides: [
    { id: 'hs_default_1', image: '/brand/banner-bg-4.jpg', title: '', subtitle: '', ctaLabel: '', ctaLink: '', enabled: true },
    { id: 'hs_default_2', image: '/brand/defender-home.webp', title: '', subtitle: '', ctaLabel: '', ctaLink: '', enabled: true },
  ],
  // (admin) Standard banner heading (Admin → Website content → Banner heading & buttons): text pieces with
  // optional colours, "\n" for line breaks (see heading.js). A slide's own headline replaces it on that slide.
  heroHeading: DEFAULT_HEADING,
  // (admin) The yellow "Sell your car" button on the home banner. action: 'smart' (signed-in sellers go to
  // their new-listing form, everyone else to the Sell page) | 'sell' (Sell page) | 'register' | 'link' (link below).
  heroSellButton: { enabled: true, label: 'Sell your car', action: 'smart', link: '' },
  // (admin) "Popular categories" tiles on the home page (Admin → Website content → Popular categories).
  // Each tile opens a vehicle category's page with its filters. image: a built-in file ("/suv2.jpg") or an
  // uploaded photo's storage key.
  popularCategories: {
    title: 'Popular car categories',
    tiles: [
      { id: 'pc_suv', label: 'SUVs', category: 'car', body: 'SUV', fuel: '', minPrice: null, maxPrice: null, image: '/suv2.jpg', enabled: true },
      { id: 'pc_sedan', label: 'Sedans', category: 'car', body: 'Sedan', fuel: '', minPrice: null, maxPrice: null, image: '/sedan.webp', enabled: true },
      { id: 'pc_hatch', label: 'Hatchbacks', category: 'car', body: 'Hatchback', fuel: '', minPrice: null, maxPrice: null, image: '/hatchback.avif', enabled: true },
      { id: 'pc_muv', label: '7-seaters', category: 'car', body: 'MUV', fuel: '', minPrice: null, maxPrice: null, image: '/hatchback2.avif', enabled: true },
      { id: 'pc_ev', label: 'Electric', category: 'car', body: '', fuel: 'Electric', minPrice: null, maxPrice: null, image: '/electic.jpeg', enabled: true },
      { id: 'pc_lux', label: 'Luxury', category: 'car', body: '', fuel: '', minPrice: 87000000, maxPrice: null, image: '/luxury-car.webp', enabled: true },
    ],
  },
  // (admin) Brand logos uploaded in Admin → Website content → Brand logos: [{ make, key }]. An uploaded logo
  // replaces the built-in file in /public/brands; brands with neither show their initials.
  brandLogos: [],
  // (admin) Trust indicators under the home page banner buttons (Admin → Website content → Trust indicators).
  // icon: one of TRUST_ICONS; link (optional): a page on this site ("/how-it-works") or an https:// address.
  trustIndicators: [
    { id: 'ti_default_1', text: 'Direct seller contact', icon: 'badge-check', link: '', enabled: true },
    { id: 'ti_default_2', text: 'Verified documents', icon: 'badge-check', link: '', enabled: true },
    { id: 'ti_default_3', text: 'No middleman', icon: 'badge-check', link: '', enabled: true },
  ],
  // (admin) Cities shown in sign-up, listing and search forms (Admin → Configuration → Cities)
  cities: DEFAULT_CITIES.map((c) => ({ ...c, enabled: true })),
};

/** Icons admins can choose for trust indicators (the website maps each to a lucide icon). */
export const TRUST_ICONS = ['badge-check', 'shield-check', 'file-check', 'phone', 'handshake', 'star', 'map-pin', 'wallet', 'car', 'clock', 'headset', 'thumbs-up'];
export const MAX_TRUST_INDICATORS = 6;

// Listing plans. Fees are in Tanzanian shillings (TSh). (admin) configurable in a real backend.
export const PLANS = [
  {
    id: 'seller-basic',
    role: 'seller',
    name: 'Owner Listing',
    price: 15000,
    validityDays: 60,
    vehicles: 1,
    features: ['Per vehicle', '20 photos', 'Listed for 60 days', 'Call & chat enquiries'],
  },
  {
    id: 'seller-boost',
    role: 'seller',
    name: 'Owner Listing + Boost',
    price: 26000,
    validityDays: 60,
    vehicles: 1,
    highlight: true,
    featuredDays: 7,
    features: ['Everything in Owner Listing', 'Top of search for 7 days', '"Featured" badge', 'Priority support'],
  },
  {
    id: 'agent-standard',
    role: 'agent',
    name: 'Agent Listing',
    price: 20000,
    validityDays: 60,
    vehicles: 1,
    features: ['Per vehicle', 'Owner details kept private', 'Handover tracker', 'Listed for 60 days'],
  },
  {
    id: 'agent-featured',
    role: 'agent',
    name: 'Agent Listing + Featured',
    price: 31000,
    validityDays: 60,
    vehicles: 1,
    highlight: true,
    featuredDays: 7,
    features: ['Everything in Agent Listing', 'Top of search for 7 days', '"Featured" badge', 'Home page featured spots'],
  },
  {
    id: 'dealer-single',
    role: 'dealer',
    name: 'Dealer Single',
    price: 17000,
    validityDays: 60,
    vehicles: 1,
    features: ['Per vehicle', 'Dealer profile badge', 'Lead inbox', 'Listed for 60 days'],
  },
  {
    id: 'dealer-featured',
    role: 'dealer',
    name: 'Dealer Single + Featured',
    price: 28000,
    validityDays: 60,
    vehicles: 1,
    featuredDays: 7,
    features: ['Everything in Dealer Single', 'Top of search for 7 days', '"Featured" badge', 'Home page featured spots'],
  },
  {
    id: 'dealer-pro',
    role: 'dealer',
    name: 'Dealer Pro Pack',
    price: 145000,
    validityDays: 60,
    vehicles: 10,
    /** Pack: the first credit publishes the listing being paid for; the rest publish later listings with no payment. */
    featuredSlots: 2,
    creditDays: 180,
    highlight: true,
    features: ['10 vehicle credits, use within 6 months', 'No payment for the next 9 listings', 'Featured slots ×2', 'Performance analytics'],
  },
];

/**
 * "Feature this listing": a boost bought for a listing that is already live, by any seller type.
 * It lasts `featuredDays` from Admin → Configuration (7 by default) and can be bought again to extend it.
 */
export const BOOST_PLAN = {
  id: 'feature-boost',
  kind: 'boost',
  roles: ['seller', 'agent', 'dealer'],
  name: 'Feature this listing',
  price: 11000,
  features: ['"Featured" badge on the listing', 'Shown first in search results', 'Home page featured spots'],
};

/** Every plan, including the boost (for payment history and receipts). */
export const ALL_PLANS = [...PLANS, BOOST_PLAN];

export const ROLE_META = {
  dealer: { label: 'Dealer', home: '/dealer' },
  seller: { label: 'Private Seller', home: '/seller' },
  agent: { label: 'Agent', home: '/agent' },
  buyer: { label: 'Buyer', home: '/buyer' },
  admin: { label: 'Administrator', home: '/admin' },
};
