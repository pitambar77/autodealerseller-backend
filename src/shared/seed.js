// Deterministic mock dataset. Everything here is fictional demo data.
import { MODELS, CITIES, COLORS, OWNERSHIP } from './catalog.js';
import { daysAgo } from './format.js';
import { DEFAULT_CONFIG, PLANS } from './site.js';
import { buildExtras } from './seedExtras.js';

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(20261027);
const pick = (a) => a[Math.floor(R() * a.length)];
const int = (a, b) => Math.floor(a + R() * (b - a + 1));
const VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
const rand = (n, chars = VIN_CHARS) => Array.from({ length: n }, () => chars[Math.floor(R() * chars.length)]).join('');
const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';
/** A Tanzanian registration number: T 123 DAB (MC 123 DAB for motorcycles, Z 123 AB in Zanzibar). */
const tzReg = (city, moto) =>
  city?.zanzibar ? `Z${int(100, 999)}${LETTERS[int(0, 22)]}${LETTERS[int(0, 22)]}` : `${moto ? 'MC' : 'T'}${int(100, 999)}${'BCDE'[int(0, 3)]}${LETTERS[int(0, 22)]}${LETTERS[int(0, 22)]}`;


// ───────────────────────────── Users
const U = (id, role, name, phone, extra = {}) => ({
  id,
  role,
  name,
  phone,
  email: `${name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/\.$/, '')}@example.co.tz`,
  city: 'Dar es Salaam',
  status: 'active',
  docStatus: 'not_submitted',
  registeredAt: daysAgo(int(20, 380)),
  ...extra,
});

export const DEMO_USER_IDS = {
  dealer: 'u_dealer1',
  seller: 'u_seller1',
  agent: 'u_agent1',
  buyer: 'u_buyer1',
  admin: 'u_admin',
};

const users = [
  // Admin staff: one account per person (Managing Director + one per launch role). Same demo password.
  U('u_admin', 'admin', 'Amani Mrisho', '+255 700 000 001', { email: 'admin@autodealer.example', docStatus: 'verified', adminRole: 'md', team: 'Managing Director' }),
  U('u_admin_ops', 'admin', 'Zawadi Nyerere', '+255 700 000 002', { email: 'ops@autodealer.example', docStatus: 'verified', adminRole: 'operations', team: 'Operations Manager' }),
  U('u_admin_listings', 'admin', 'Juma Kassim', '+255 700 000 003', { email: 'listings@autodealer.example', docStatus: 'verified', adminRole: 'listings', team: 'Listing Administrator' }),
  U('u_admin_finance', 'admin', 'Halima Said', '+255 700 000 004', { email: 'finance@autodealer.example', docStatus: 'verified', adminRole: 'finance', team: 'Finance Administrator' }),
  U('u_admin_it', 'admin', 'Peter Mushi', '+255 700 000 005', { email: 'it@autodealer.example', docStatus: 'verified', adminRole: 'it', team: 'IT / Technical Administrator' }),
  U('u_dealer1', 'dealer', 'Rashidi Mwakyusa', '+255 761 021 001', { business: 'Bahari Motors', gstin: '21AAKCK4471M1Z6', docStatus: 'verified', registeredAt: daysAgo(310) }),
  U('u_dealer2', 'dealer', 'Neema Kimaro', '+255 722 044 120', { business: 'Kibo Auto Hub', city: 'Moshi', docStatus: 'verified' }),
  U('u_dealer3', 'dealer', 'Hamisi Juma', '+255 711 076 321', { business: 'Capital Car Bazaar', city: 'Dodoma', docStatus: 'pending' }),
  U('u_dealer4', 'dealer', 'Grace Mollel', '+255 784 011 908', { business: 'Highlands Motors', city: 'Iringa', docStatus: 'verified' }),
  U('u_dealer5', 'dealer', 'Baraka Mwakalinga', '+255 745 062 277', { business: 'Mbeya Wheels', city: 'Mbeya', docStatus: 'rejected' }),
  U('u_dealer6', 'dealer', 'Daudi Ngowi', '+255 730 055 410', { business: 'Lake Zone Auto Point', city: 'Mwanza', docStatus: 'flagged', status: 'suspended' }),
  U('u_seller1', 'seller', 'Anna Massawe', '+255 761 021 002', { docStatus: 'pending', registeredAt: daysAgo(46) }),
  U('u_seller2', 'seller', 'Joseph Lyimo', '+255 729 031 877', { city: 'Kigoma', docStatus: 'verified' }),
  U('u_seller3', 'seller', 'Mariam Said', '+255 719 066 412', { city: 'Arusha', docStatus: 'verified' }),
  U('u_seller4', 'seller', 'Emmanuel Mushi', '+255 737 012 093', { city: 'Morogoro', docStatus: 'pending' }),
  U('u_seller5', 'seller', 'Fatma Salim', '+255 748 077 231', { city: 'Tanga', docStatus: 'not_submitted' }),
  U('u_seller6', 'seller', 'Kelvin Mrema', '+255 725 090 012', { city: 'Tabora', docStatus: 'verified' }),
  U('u_seller7', 'seller', 'Rehema Hassan', '+255 710 122 094', { city: 'Dodoma', docStatus: 'rejected' }),
  U('u_agent1', 'agent', 'Salim Mbwana', '+255 761 021 003', { agency: 'Salim Car Consultants', docStatus: 'verified', registeredAt: daysAgo(190) }),
  U('u_agent2', 'agent', 'Nassoro Rajab', '+255 749 013 377', { agency: 'Pwani Auto Agents', city: 'Tanga', docStatus: 'pending' }),
  U('u_agent3', 'agent', 'Saidi Kombo', '+255 741 083 321', { agency: 'SK Car Deals', city: 'Iringa', docStatus: 'verified' }),
  U('u_buyer1', 'buyer', 'Upendo Nyirenda', '+255 761 021 004', { docStatus: 'not_submitted', registeredAt: daysAgo(30) }),
  U('u_buyer2', 'buyer', 'Athumani Mfinanga', '+255 799 041 102'),
  U('u_buyer3', 'buyer', 'Sophia Mwita', '+255 738 022 871'),
  U('u_buyer4', 'buyer', 'Ramadhani Gwau', '+255 733 061 200', { city: 'Arusha' }),
  U('u_buyer5', 'buyer', 'Halima Chacha', '+255 731 050 093', { city: 'Mwanza' }),
  U('u_buyer6', 'buyer', 'Dickson Shirima', '+255 737 188 812'),
  U('u_buyer7', 'buyer', 'Catherine Minja', '+255 745 033 019', { city: 'Mbeya' }),
  U('u_buyer8', 'buyer', 'Amani Temba', '+255 724 017 765', { city: 'Tabora' }),
  U('u_buyer9', 'buyer', 'Sauda Pazi', '+255 737 066 320'),
];

// ───────────────────────────── Vehicles
const SELLER_POOL = [
  ...Array(9).fill('u_dealer1'),
  ...Array(3).fill('u_dealer2'),
  ...Array(3).fill('u_dealer3'),
  ...Array(3).fill('u_dealer4'),
  ...Array(2).fill('u_dealer5'),
  'u_dealer6',
  'u_seller2', 'u_seller3', 'u_seller4', 'u_seller5', 'u_seller6', 'u_seller7',
  ...Array(4).fill('u_agent1'),
  'u_agent2', 'u_agent2', 'u_agent3',
];

const DESC = [
  'Single-owner car with complete service history at the authorised workshop. Tyres replaced last year, no accident history. Insurance valid and transferable.',
  'Well-maintained and garage-parked. All original paint except one bumper touch-up. Second key and owner manual available.',
  'Driven mostly on highways, so the clutch and suspension are in great shape. Recently serviced with new battery. Test drive welcome.',
  'Family-used car, non-smoker. Infotainment, reverse camera and all power windows working perfectly. RC and pollution certificate ready.',
  'Company-maintained vehicle with timely service records. Fresh alignment and balancing. Minor scratches on the rear door, priced accordingly.',
];

function vehicle(i) {
  const m = MODELS[(i * 7) % MODELS.length];
  const sellerId = SELLER_POOL[i % SELLER_POOL.length];
  const seller = users.find((u) => u.id === sellerId);
  const city = CITIES.find((c) => c.name === seller.city) || pick(CITIES);
  const isNew = seller.role === 'dealer' && R() < 0.12;
  const year = isNew ? 2026 : int(2016, 2025);
  const age = 2026 - year;
  const mileage = isNew ? int(8, 45) : Math.max(1500, age * int(8500, 14500) + int(0, 4000));
  const fuel = pick(m.fuels);
  const transmission = R() < 0.45 || m.price > 87000000 ? 'Automatic' : 'Manual';
  const condition = isNew ? 'New' : seller.role === 'dealer' && R() < 0.4 ? 'Certified pre-owned' : 'Used';
  const price = Math.round((m.price * (isNew ? 1.02 : Math.max(0.32, 0.88 ** age)) * (0.92 + R() * 0.12)) / 50000) * 50000;
  const reg = isNew ? '' : tzReg(city);
  const color = COLORS[(i * 5) % COLORS.length];
  const created = int(1, 75);
  return {
    id: `v${String(1001 + i)}`,
    make: m.make,
    model: m.model,
    variant: pick(m.variants),
    year,
    price,
    mileage,
    fuel,
    transmission,
    condition,
    bodyType: m.body,
    city: city.name,
    color: color.name,
    colorHex: color.hex,
    regNumber: reg,
    vin: `${m.vin}${rand(17 - m.vin.length)}`,
    engineNo: `${rand(3, 'ABCDEFGHJKLMNPRSTUVWXYZ')}${rand(8, '0123456789')}`,
    owners: isNew ? 'New' : OWNERSHIP[Math.min(3, Math.floor(age / 4 + R()))],
    insuranceUntil: daysAgo(-int(30, 330)),
    specs: {
      engineCc: fuel === 'Electric' ? 0 : m.cc,
      powerBhp: m.bhp,
      seats: m.seats,
      batteryKwh: fuel === 'Electric' ? int(30, 50) : null,
      mileageKmpl: fuel === 'Electric' ? null : Number((12 + R() * 10).toFixed(1)),
      airbags: m.price > 34800000 ? 6 : 2,
      features: ['Power steering', 'ABS with EBD', 'Rear parking sensors', 'Touchscreen infotainment', 'Apple CarPlay / Android Auto', 'Automatic climate control', 'Cruise control', 'Sunroof', 'Alloy wheels', 'Keyless entry'].filter(() => R() < 0.65),
    },
    description: DESC[i % DESC.length],
    photos: [],
    sellerId,
    sellerRole: seller.role,
    ownerInfo: seller.role === 'agent' ? { name: pick(['Bakari Bendera', 'Lucy Shayo', 'Musa Tarimo', 'Getrude Rweyemamu', 'Peter Nyange']), phone: `+255 7${int(10, 99)} ${int(100, 999)} ${int(100, 999)}`, relation: 'Registered owner' } : null,
    modifications: seller.role === 'agent' && R() < 0.4 ? 'Aftermarket alloy wheels and LED headlamps (TRA-compliant).' : '',
    status: 'live',
    verification: 'unverified',
    paymentStatus: 'paid',
    planId: seller.role === 'dealer' ? 'dealer-pro' : seller.role === 'agent' ? 'agent-standard' : 'seller-basic',
    featured: R() < 0.22,
    views: int(40, 2400),
    createdAt: daysAgo(created),
    publishedAt: daysAgo(created),
    expiresAt: daysAgo(created - 60),
  };
}

const vehicles = Array.from({ length: 40 }, (_, i) => vehicle(i));

// Shape statuses so every screen has meaningful data.
const set = (id, patch) => Object.assign(vehicles.find((v) => v.id === id), patch);
vehicles.forEach((v, i) => {
  v.verification = ['verified', 'verified', 'unverified', 'pending', 'verified', 'unverified'][i % 6];
});
set('v1009', { status: 'pending_payment', paymentStatus: 'failed', publishedAt: null, verification: 'unverified' });
set('v1018', { status: 'draft', paymentStatus: 'unpaid', publishedAt: null, verification: 'unverified' });
set('v1027', { status: 'sold', verification: 'verified' });
set('v1036', { status: 'expired' });
set('v1003', { verification: 'flagged' });
set('v1021', { status: 'suspended', verification: 'flagged' });
set('v1024', { status: 'pending_payment', paymentStatus: 'pending', publishedAt: null });

// Seller demo persona: exactly one active listing.
vehicles.push({
  ...vehicle(40),
  id: 'v1100',
  make: 'Hyundai',
  model: 'i20',
  variant: 'Asta (O)',
  bodyType: 'Hatchback',
  year: 2021,
  price: 19850000,
  mileage: 38420,
  fuel: 'Petrol',
  transmission: 'Manual',
  condition: 'Used',
  city: 'Dar es Salaam',
  color: 'Ocean Blue',
  colorHex: '#2C5AA3',
  regNumber: 'T471DBK',
  owners: '1st owner',
  sellerId: 'u_seller1',
  sellerRole: 'seller',
  ownerInfo: null,
  status: 'live',
  verification: 'pending',
  planId: 'seller-basic',
  featured: false,
  views: 312,
  createdAt: daysAgo(12),
  publishedAt: daysAgo(12),
  expiresAt: daysAgo(-48),
  description: 'Single-owner i20 Asta (O), bought new in Dar es Salaam. Serviced every 10,000 km at Hyundai. New tyres at 32,000 km. No accidents, no flood damage.',
});

// A duplicate of a dealer's car, blocked on publish.
const dupSource = vehicles.find((v) => v.id === 'v1001');
vehicles.push({
  ...vehicle(41),
  id: 'v1101',
  make: dupSource.make,
  model: dupSource.model,
  variant: dupSource.variant,
  year: dupSource.year,
  bodyType: dupSource.bodyType,
  regNumber: dupSource.regNumber,
  vin: dupSource.vin,
  sellerId: 'u_seller4',
  sellerRole: 'seller',
  ownerInfo: null,
  status: 'blocked_duplicate',
  paymentStatus: 'unpaid',
  publishedAt: null,
  verification: 'unverified',
  createdAt: daysAgo(3),
  duplicateOf: ['v1001'],
});

// Seller demo persona's earlier attempt, blocked because the registration matched a dealer's car.
const dupSource2 = vehicles.find((v) => v.id === 'v1002');
vehicles.push({
  ...vehicle(42),
  id: 'v1102',
  make: 'Hyundai',
  model: 'i20',
  variant: 'Asta (O)',
  bodyType: 'Hatchback',
  year: 2021,
  price: 20000000,
  mileage: 38100,
  fuel: 'Petrol',
  transmission: 'Manual',
  condition: 'Used',
  city: 'Dar es Salaam',
  color: 'Ocean Blue',
  colorHex: '#2C5AA3',
  regNumber: dupSource2.regNumber || 'T417DBK',
  vin: dupSource2.vin,
  sellerId: 'u_seller1',
  sellerRole: 'seller',
  ownerInfo: null,
  status: 'blocked_duplicate',
  paymentStatus: 'unpaid',
  publishedAt: null,
  verification: 'unverified',
  featured: false,
  views: 0,
  createdAt: daysAgo(14),
  duplicateOf: ['v1002'],
});

// ───────────────────────────── Enquiries
const BUYERS = users.filter((u) => u.role === 'buyer');
const MSGS = [
  'Is the price negotiable? I can come for a test drive this weekend.',
  'Please share the service history and insurance details.',
  'Has the car been in any accident? Can I get it inspected at my mechanic?',
  'Do you accept exchange of my 2015 Alto? Interested in this car.',
  'Is loan assistance available? Looking for 3-year tenure.',
  'Still available? I am in the same city and can visit tomorrow evening.',
];
const ENQ_STATUSES = ['new', 'new', 'contacted', 'negotiating', 'closed', 'lost'];
const live = vehicles.filter((v) => v.status === 'live' || v.status === 'sold');
const enquiries = Array.from({ length: 46 }, (_, i) => {
  const v = i < 6 ? vehicles.find((x) => x.sellerId === ['u_dealer1', 'u_dealer1', 'u_agent1', 'u_seller1', 'u_seller1', 'u_agent1'][i] && (x.status === 'live')) || live[i] : live[(i * 3) % live.length];
  const b = BUYERS[i % BUYERS.length];
  return {
    id: `e${2001 + i}`,
    vehicleId: v.id,
    sellerId: v.sellerId,
    buyerId: b.id,
    buyerName: b.name,
    buyerPhone: b.phone,
    buyerEmail: b.email,
    message: MSGS[i % MSGS.length],
    channel: ['form', 'call', 'chat', 'form'][i % 4],
    status: ENQ_STATUSES[i % ENQ_STATUSES.length],
    createdAt: daysAgo(i % 21, 9 + (i % 9)),
  };
});

// ───────────────────────────── Payments (listing fees)
const planOf = (id) => PLANS.find((p) => p.id === id);
const payments = [];
vehicles.forEach((v, i) => {
  if (v.paymentStatus === 'unpaid') return;
  const plan = planOf(v.planId);
  const status = v.paymentStatus === 'paid' ? 'success' : v.paymentStatus;
  const fee = v.sellerRole === 'dealer' ? planOf('dealer-single').price : plan.price;
  payments.push({
    id: `TXN${260000 + i * 37}`,
    gatewayRef: `pay_${rand(14, 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789')}`,
    userId: v.sellerId,
    listingId: v.id,
    planId: v.sellerRole === 'dealer' ? 'dealer-single' : v.planId,
    amount: fee,
    gst: Math.round(fee * 0.18),
    total: Math.round(fee * 1.18),
    method: ['Mobile money', 'Card', 'Bank transfer', 'Mobile money'][i % 4],
    status,
    createdAt: v.createdAt,
  });
  if (i % 7 === 2) {
    payments.push({ ...payments[payments.length - 1], id: `TXN${260000 + i * 37 + 1}`, gatewayRef: `pay_${rand(14)}`, status: i % 2 ? 'failed' : 'cancelled', createdAt: daysAgo(int(1, 60)) });
  }
});

// ───────────────────────────── Documents
const DOC_TYPES = {
  dealer: [['business_certificate', 'Business registration certificate'], ['gst_certificate', 'GST registration certificate']],
  seller: [['personal_id', 'Driving licence'], ['verification_video', 'Verification video']],
  agent: [['personal_id', 'PAN card'], ['owner_authorization', 'Owner authorisation letter']],
};
const documents = [];
users.forEach((u) => {
  const types = DOC_TYPES[u.role];
  if (!types || u.docStatus === 'not_submitted') return;
  types.forEach(([type, label], j) => {
    if (u.role === 'seller' && type === 'verification_video' && R() < 0.5) return;
    documents.push({
      id: `d${3001 + documents.length}`,
      userId: u.id,
      type,
      label,
      fileName: `${type.replace(/_/g, '-')}-${u.name.split(' ')[0].toLowerCase()}.${type === 'verification_video' ? 'mp4' : j ? 'pdf' : 'jpg'}`,
      size: type === 'verification_video' ? int(6000, 18000) * 1024 : int(180, 2400) * 1024,
      maskedNumber: type === 'personal_id' ? `XXXX XX${int(10, 99)} ${int(1000, 9999)}` : type === 'gst_certificate' ? u.gstin || `${int(10, 35)}AAB${rand(7)}` : null,
      uploadedAt: daysAgo(int(1, 40)),
      status: u.docStatus === 'verified' ? 'verified' : u.docStatus === 'rejected' && j === 0 ? 'rejected' : u.docStatus === 'flagged' && j === 0 ? 'flagged' : 'pending',
      reviewNote: u.docStatus === 'rejected' && j === 0 ? 'Image is blurred; name and registration number unreadable.' : u.docStatus === 'flagged' && j === 0 ? 'Business name does not match GST record. Escalated.' : '',
      preview: null,
    });
  });
});

// ───────────────────────────── Loan referrals
const LENDERS = DEFAULT_CONFIG.loanProviders;
const REF_STATUS = ['referred', 'application', 'sanctioned', 'disbursed', 'disbursed', 'rejected'];
const referrals = Array.from({ length: 34 }, (_, i) => {
  const v = live[(i * 5) % live.length];
  const lender = LENDERS[i % 2];
  const loanAmount = Math.round((v.price * (0.6 + R() * 0.25)) / 100000) * 100000;
  const status = REF_STATUS[i % REF_STATUS.length];
  return {
    id: `LR${5100 + i}`,
    lenderId: lender.id,
    lender: lender.name,
    buyerId: BUYERS[i % BUYERS.length].id,
    vehicleId: v.id,
    loanAmount,
    tenureMonths: [36, 48, 60, 60, 72][i % 5],
    status,
    commission: status === 'disbursed' ? Math.round((loanAmount * lender.commissionPct) / 100) : 0,
    expectedCommission: Math.round((loanAmount * lender.commissionPct) / 100),
    createdAt: daysAgo(int(1, 120)),
  };
});

// ───────────────────────────── Agent handover tracking
export const HANDOVER_STEPS = [
  { key: 'authorization', label: 'Owner authorisation received', party: 'owner' },
  { key: 'inspection', label: 'Vehicle inspected by agent', party: 'agent' },
  { key: 'listed', label: 'Listing published', party: 'agent' },
  { key: 'buyer', label: 'Buyer identified & test drive done', party: 'buyer' },
  { key: 'token', label: 'Token amount agreed', party: 'buyer' },
  { key: 'documents', label: 'RC, insurance & NOC papers handed over', party: 'agent' },
  { key: 'delivery', label: 'Vehicle delivered to buyer', party: 'buyer' },
];
const STEP_PRESETS = [
  ['completed', 'completed', 'completed', 'completed', 'in_progress', 'pending', 'pending'],
  ['completed', 'completed', 'completed', 'in_progress', 'pending', 'pending', 'pending'],
  ['completed', 'completed', 'completed', 'completed', 'completed', 'issue', 'pending'],
  ['completed', 'in_progress', 'pending', 'pending', 'pending', 'pending', 'pending'],
];
const handovers = vehicles
  .filter((v) => v.sellerRole === 'agent')
  .map((v, i) => ({
    id: `h${4001 + i}`,
    vehicleId: v.id,
    agentId: v.sellerId,
    buyerName: i % 4 === 3 ? '' : BUYERS[(i + 2) % BUYERS.length].name,
    steps: HANDOVER_STEPS.map((s, j) => ({
      ...s,
      status: STEP_PRESETS[i % 4][j],
      updatedAt: STEP_PRESETS[i % 4][j] === 'pending' ? null : daysAgo(20 - j * 2),
      note: STEP_PRESETS[i % 4][j] === 'issue' ? 'NOC from the financing bank still awaited — hypothecation not yet removed from RC.' : '',
    })),
  }));

// ───────────────────────────── Audit log
const audit = [
  { id: 'a1', at: daysAgo(0, 9), actor: 'Juma Kassim', actorId: 'u_admin_listings', actorRole: 'admin', adminRole: 'listings', action: 'Flagged listing', entityType: 'listing', entityId: 'v1003', note: 'Price far below market for this model year.' },
  { id: 'a2', at: daysAgo(1, 15), actor: 'System', actorRole: 'system', action: 'Blocked duplicate', entityType: 'listing', entityId: 'v1101', note: 'Registration number and VIN match active listing v1001.' },
  { id: 'a3', at: daysAgo(1, 11), actor: 'Juma Kassim', actorId: 'u_admin_listings', actorRole: 'admin', adminRole: 'listings', action: 'Suspended listing', entityType: 'listing', entityId: 'v1021', note: 'Buyer complaint: car not available at stated location.' },
  { id: 'a4', at: daysAgo(2, 16), actor: 'Zawadi Nyerere', actorId: 'u_admin_ops', actorRole: 'admin', adminRole: 'operations', action: 'Verified document', entityType: 'user', entityId: 'u_agent1', note: 'NIDA ID and owner authorisation checked.' },
  { id: 'a5', at: daysAgo(3, 10), actor: 'Zawadi Nyerere', actorId: 'u_admin_ops', actorRole: 'admin', adminRole: 'operations', action: 'Rejected document', entityType: 'user', entityId: 'u_dealer5', note: 'Certificate image unreadable.' },
  { id: 'a6', at: daysAgo(4, 12), actor: 'Amani Mrisho', actorId: 'u_admin', actorRole: 'admin', adminRole: 'md', action: 'Suspended user', entityType: 'user', entityId: 'u_dealer6', note: 'Business details mismatch.' },
  { id: 'a7', at: daysAgo(12, 10), actor: 'Anna Massawe', actorId: 'u_seller1', actorRole: 'seller', action: 'Published listing', entityType: 'listing', entityId: 'v1100', note: 'Payment TXN confirmed, auto-published.' },
  { id: 'a8', at: daysAgo(5, 14), actor: 'Juma Kassim', actorId: 'u_admin_listings', actorRole: 'admin', adminRole: 'listings', action: 'Verified listing', entityType: 'listing', entityId: 'v1001', note: 'Registration card and seller documents checked.' },
];

const notes = [{ id: 'n1', listingId: 'v1003', at: daysAgo(0, 9), author: 'Juma Kassim', text: 'Asked dealer to confirm odometer reading with a photo.' }];

// Motorcycles and lorries (separate random sequence, so car data is unchanged).
const extras = buildExtras(users, BUYERS);

export function buildSeed() {
  return {
    version: 5,
    users: structuredClone([...users, ...extras.users]),
    vehicles: structuredClone([...vehicles.map((v) => ({ category: 'car', ...v })), ...extras.vehicles]),
    enquiries: structuredClone([...enquiries, ...extras.enquiries]),
    payments: structuredClone([...payments, ...extras.payments]),
    documents: structuredClone([...documents, ...extras.documents]),
    referrals: structuredClone(referrals),
    handovers: structuredClone(handovers),
    audit: structuredClone(audit),
    notes: structuredClone(notes),
    config: structuredClone(DEFAULT_CONFIG),
    session: null,
    saved: ['v1005', 'v1012', 'v1020'],
    compare: ['v1005', 'v1012'],
    recent: ['v1014', 'v1005', 'v1030', 'v1012', 'v1008'],
    savedSearches: [
      { id: 'ss1', label: 'SUVs under TSh 40M in Dar es Salaam', query: { body: 'SUV', maxPrice: '40000000', city: 'Dar es Salaam' }, createdAt: daysAgo(6) },
      { id: 'ss2', label: 'Automatic hatchbacks, 2020 or newer', query: { body: 'Hatchback', transmission: 'Automatic', minYear: '2020' }, createdAt: daysAgo(14) },
    ],
    buyerPrefs: { budget: '15000000-40000000', bodies: ['SUV', 'Hatchback'], city: 'Dar es Salaam' },
  };
}
