// Demo motorcycles and lorries, plus the dealers and owners who sell them.
// Uses its own random sequence so the original car data stays exactly the same.
import { CITIES, COLORS, LORRY_MODELS, MOTO_MODELS, OWNERSHIP } from './catalog.js';
import { MORE_MODELS } from './catalogMore.js';
import { daysAgo } from './format.js';
import { PLANS } from './site.js';

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(20261031);
const pick = (a) => a[Math.floor(R() * a.length)];
const int = (a, b) => Math.floor(a + R() * (b - a + 1));
const CH = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
const rand = (n, chars = CH) => Array.from({ length: n }, () => chars[Math.floor(R() * chars.length)]).join('');
const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';
/** A Tanzanian registration number: T 123 DAB (MC 123 DAB for motorcycles, Z 123 AB in Zanzibar). */
const tzReg = (city, moto) =>
  city?.zanzibar ? `Z${int(100, 999)}${LETTERS[int(0, 22)]}${LETTERS[int(0, 22)]}` : `${moto ? 'MC' : 'T'}${int(100, 999)}${'BCDE'[int(0, 3)]}${LETTERS[int(0, 22)]}${LETTERS[int(0, 22)]}`;


const person = (id, role, name, phone, extra) => ({
  id,
  role,
  name,
  phone,
  email: `${name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/\.$/, '')}@example.co.tz`,
  city: 'Dar es Salaam',
  status: 'active',
  docStatus: 'verified',
  ...extra,
});

export const EXTRA_USERS = [
  person('u_dealer7', 'dealer', 'Selemani Kapinga', '+255 761 033 017', { business: 'Speedline Two Wheelers', registeredAt: daysAgo(240), brands: ['Bajaj', 'TVS', 'Honda', 'Royal Enfield'] }),
  person('u_dealer8', 'dealer', 'Raphael Akyoo', '+255 761 044 108', { business: 'Highway Commercial Vehicles', city: 'Morogoro', registeredAt: daysAgo(400), brands: ['Tata', 'Ashok Leyland', 'Eicher', 'BharatBenz'] }),
  person('u_dealer9', 'dealer', 'Abdallah Jaffo', '+255 722 055 109', { business: 'Kibo Bikes', city: 'Moshi', docStatus: 'pending', registeredAt: daysAgo(70), brands: ['Yamaha', 'KTM', 'Kawasaki'] }),
  person('u_dealer10', 'dealer', 'Hussein Shaban', '+255 725 066 110', { business: 'Western Truck Mart', city: 'Tabora', registeredAt: daysAgo(520), brands: ['Tata', 'Scania', 'Sinotruk', 'Isuzu'] }),
  person('u_seller8', 'seller', 'Joyce Mwakasege', '+255 737 077 118', { docStatus: 'verified', registeredAt: daysAgo(25) }),
  person('u_seller9', 'seller', 'Godfrey Swai', '+255 731 088 119', { city: 'Mwanza', docStatus: 'pending', registeredAt: daysAgo(18) }),
];

const SELLERS = {
  motorcycle: ['u_dealer7', 'u_dealer7', 'u_dealer7', 'u_dealer7', 'u_dealer9', 'u_dealer9', 'u_dealer9', 'u_dealer1', 'u_dealer1', 'u_dealer2', 'u_agent1', 'u_dealer7', 'u_dealer9', 'u_dealer7', 'u_dealer4', 'u_dealer7', 'u_seller8'],
  lorry: ['u_dealer8', 'u_dealer8', 'u_dealer8', 'u_dealer8', 'u_dealer10', 'u_dealer10', 'u_dealer10', 'u_dealer8', 'u_dealer3', 'u_agent3', 'u_dealer10', 'u_dealer8', 'u_dealer10', 'u_seller9'],
  bus: ['u_dealer8', 'u_dealer10', 'u_dealer8', 'u_agent3', 'u_dealer10', 'u_dealer3'],
  construction: ['u_dealer10', 'u_dealer8', 'u_dealer10', 'u_agent3', 'u_dealer8'],
  agricultural: ['u_dealer3', 'u_dealer10', 'u_dealer3', 'u_agent1', 'u_dealer3', 'u_dealer10'],
};
const MORE = {
  bus: {
    hours: false,
    features: ['Air conditioning', 'Reclining seats', 'USB charging', 'PA system', 'Luggage compartment', 'CCTV', 'Speed governor', 'Curtains'],
    desc: ['Route-ready with valid LATRA licence. Engine overhauled last year, new tyres all round. Seats and interior in very good condition.', 'Company staff bus, serviced at the dealer every 10,000 km. Speed governor and tracking installed. Available for inspection in our yard.', 'Single owner, used on intercity routes. Gearbox and suspension recently serviced, body without rust. Finance available.'],
  },
  construction: {
    hours: true,
    features: ['Air-conditioned cab', 'Quick coupler', 'Hammer line', 'GPS tracking', 'Rear camera', 'Service records available', 'Extra buckets'],
    desc: ['Fleet-maintained machine with full service records. Undercarriage at 70%, no leaks, ready to work. Transport to site can be arranged.', 'Used on a road project and now surplus. Engine and hydraulics in excellent condition, recently serviced. Inspection welcome.', 'Low hours for its age, operated by our own trained operators. Comes with extra bucket and spare filters.'],
  },
  agricultural: {
    hours: true,
    features: ['Front loader', 'Power steering', 'Three-point hitch', 'PTO', 'Implements included', 'Service records available'],
    desc: ['Well-kept tractor used on a family farm. New rear tyres, serviced every season. Disc plough and harrow can be included.', 'Estate machine with dealer service history. Hydraulics and PTO in perfect order. Ready for the coming planting season.', 'Low hours, garage-kept between seasons. Original paint and documents. Finance through our partner banks.'],
  },
};
/** Buses, construction and farm machinery for the demo marketplace. */
function buildMore(category, i, users, idBase) {
  const models = MORE_MODELS.filter((m) => m.category === category);
  const conf = MORE[category];
  const sellerId = SELLERS[category][i % SELLERS[category].length];
  const seller = sellerOf(users, sellerId);
  const m = models[(i * 3) % models.length];
  const city = CITIES.find((c) => c.name === seller.city) || pick(CITIES);
  const isNew = seller.role === 'dealer' && R() < 0.15;
  const year = isNew ? 2026 : int(2013, 2024);
  const age = 2026 - year;
  const mileage = isNew ? int(0, 30) : conf.hours ? age * int(600, 1400) + int(0, 300) : age * int(45000, 80000) + int(0, 5000);
  const price = Math.round((m.price * (isNew ? 1.02 : Math.max(0.3, 0.9 ** age)) * (0.92 + R() * 0.12)) / 500000) * 500000;
  const color = COLORS[(i * 5 + 2) % COLORS.length];
  const created = int(1, 60);
  const role = seller.role;
  return {
    id: `v${idBase + i}`,
    category,
    make: m.make,
    model: m.model,
    variant: pick(m.variants),
    year,
    price,
    mileage,
    fuel: m.fuels[0],
    transmission: category === 'bus' ? (R() < 0.3 ? 'Automatic' : 'Manual') : category === 'construction' ? 'Hydrostatic' : 'Manual',
    condition: isNew ? 'New' : 'Used',
    bodyType: m.body,
    city: city.name,
    color: color.name,
    colorHex: color.hex,
    regNumber: isNew || category === 'construction' ? '' : tzReg(city),
    vin: `${m.vin}${rand(17 - m.vin.length)}`,
    engineNo: `${rand(3, 'ABCDEFGHJKLMNPRSTUVWXYZ')}${rand(8, '0123456789')}`,
    owners: isNew ? 'New' : OWNERSHIP[Math.min(3, Math.floor(age / 5 + R()))],
    insuranceUntil: daysAgo(-int(30, 330)),
    specs: { ...m.specs, features: conf.features.filter(() => R() < 0.6) },
    description: conf.desc[i % 3],
    photos: [],
    sellerId,
    sellerRole: role,
    ownerInfo: role === 'agent' ? { name: pick(['Bakari Bendera', 'Lucy Shayo', 'Musa Tarimo']), phone: `+255 7${int(10, 99)} ${int(100, 999)} ${int(100, 999)}`, relation: 'Registered owner' } : null,
    modifications: '',
    status: 'live',
    verification: ['verified', 'unverified', 'verified', 'pending'][i % 4],
    paymentStatus: 'paid',
    planId: role === 'dealer' ? 'dealer-pro' : role === 'agent' ? 'agent-standard' : 'seller-basic',
    featured: R() < 0.2,
    views: int(20, 900),
    createdAt: daysAgo(created),
    publishedAt: daysAgo(created),
    expiresAt: daysAgo(created - 60),
  };
}
const MOTO_FEATURES = ['Electric start', 'Front disc brake', 'Digital console', 'LED headlamp', 'Bluetooth connectivity', 'Tubeless tyres', 'USB charging', 'Side-stand engine cut-off', 'Crash guard', 'Pillion backrest'];
const LORRY_FEATURES = ['Power steering', 'Air brakes', 'Air-conditioned cabin', 'GPS tracker', 'Tilt cab', 'Exhaust brake', 'ABS', 'Reverse camera', 'Fleet telematics', 'Fresh tyres'];
const TYRES = { '4x2': 6, '6x2': 10, '6x4': 10, '8x2': 12 };
const MOTO_DESC = [
  'Single owner, serviced every 3,000 km at the authorised service centre. New chain set and tyres. Papers and insurance up to date.',
  'Used for office commute only, garage-parked. Original paint, no falls. Both keys and owner manual available.',
  'Well looked after with all service records. Recently fitted new battery and brake pads. Test ride welcome.',
];
const LORRY_DESC = [
  'Fleet-maintained with full service history. Engine and gearbox in excellent condition, ready for work. Permit and fitness certificate valid.',
  'Single owner-operator. Body rebuilt last year, new clutch plate at the last service. Available for inspection at our yard.',
  'Company-owned vehicle being replaced with a newer model. Regular maintenance, tyres at 70%. Finance available through our partner banks.',
];

const sellerOf = (all, id) => all.find((u) => u.id === id);

function build(category, models, i, users, idBase) {
  const sellerId = SELLERS[category][i % SELLERS[category].length];
  const seller = sellerOf(users, sellerId);
  const m = models[(i * 5) % models.length];
  const city = CITIES.find((c) => c.name === seller.city) || pick(CITIES);
  const isNew = seller.role === 'dealer' && R() < 0.15;
  const year = isNew ? 2026 : int(category === 'lorry' ? 2014 : 2017, 2025);
  const age = 2026 - year;
  const mileage = isNew ? int(5, 60) : category === 'lorry' ? age * int(55000, 90000) + int(0, 9000) : Math.max(800, age * int(4000, 8500) + int(0, 2000));
  const fuel = pick(m.fuels);
  const transmission = category === 'motorcycle' ? (m.body === 'Scooter' ? 'Automatic' : 'Manual') : R() < 0.15 ? 'Automatic' : 'Manual';
  const depreciation = category === 'lorry' ? 0.9 : 0.86;
  const step = category === 'lorry' ? 500000 : 50000;
  const price = Math.round((m.price * (isNew ? 1.02 : Math.max(0.3, depreciation ** age)) * (0.92 + R() * 0.12)) / step) * step;
  const reg = isNew ? '' : tzReg(city, category === 'motorcycle');
  const color = COLORS[(i * 3 + (category === 'lorry' ? 1 : 0)) % COLORS.length];
  const created = int(1, 70);
  const features = (category === 'lorry' ? LORRY_FEATURES : MOTO_FEATURES).filter(() => R() < 0.6);
  const specs =
    category === 'motorcycle'
      ? { engineCc: m.cc, powerBhp: m.bhp, seats: 2, weightKg: m.weightKg, mileageKmpl: m.kmpl, rangeKm: m.rangeKm || null, batteryKwh: fuel === 'Electric' ? Number(pick(m.variants).replace(/[^\d.]/g, '')) || 3.7 : null, abs: m.abs, features }
      : { powerHp: m.hp, payloadT: m.payloadT, gvwT: m.gvwT, axle: m.axle, cabin: m.cabin, tyres: TYRES[m.axle] || 6, seats: m.cabin === 'Sleeper' ? 3 : 2, features };
  const role = seller.role;
  return {
    id: `v${idBase + i}`,
    category,
    make: m.make,
    model: m.model,
    variant: pick(m.variants),
    year,
    price,
    mileage,
    fuel,
    transmission,
    condition: isNew ? 'New' : role === 'dealer' && R() < 0.35 ? 'Certified pre-owned' : 'Used',
    bodyType: m.body,
    city: city.name,
    color: color.name,
    colorHex: color.hex,
    regNumber: reg,
    vin: `${m.vin}${rand(17 - m.vin.length)}`,
    engineNo: `${rand(3, 'ABCDEFGHJKLMNPRSTUVWXYZ')}${rand(8, '0123456789')}`,
    owners: isNew ? 'New' : OWNERSHIP[Math.min(3, Math.floor(age / 4 + R()))],
    insuranceUntil: daysAgo(-int(30, 330)),
    specs,
    description: (category === 'lorry' ? LORRY_DESC : MOTO_DESC)[i % 3],
    photos: [],
    sellerId,
    sellerRole: role,
    ownerInfo: role === 'agent' ? { name: pick(['Bakari Bendera', 'Lucy Shayo', 'Musa Tarimo']), phone: `+255 7${int(10, 99)} ${int(100, 999)} ${int(100, 999)}`, relation: 'Registered owner' } : null,
    modifications: '',
    status: 'live',
    verification: ['verified', 'unverified', 'verified', 'pending'][i % 4],
    paymentStatus: 'paid',
    planId: role === 'dealer' ? 'dealer-pro' : role === 'agent' ? 'agent-standard' : 'seller-basic',
    featured: R() < 0.2,
    views: int(20, 1600),
    createdAt: daysAgo(created),
    publishedAt: daysAgo(created),
    expiresAt: daysAgo(created - 60),
  };
}

const MSGS = {
  motorcycle: ['Is the price negotiable? Can I take a test ride this weekend?', 'Please share the service record and insurance copy.', 'Do you accept exchange of my old scooter?'],
  lorry: ['Is the national permit transferable? Please share fitness certificate validity.', 'Can you arrange finance for 48 months? Need it for my transport business.', 'Available for inspection at your yard tomorrow?'],
  bus: ['Is the route licence included? Please share the service history.', 'Can I inspect it this week? I run a school transport service.', 'Do you offer finance for 36 months?'],
  construction: ['How many hours on the clock exactly? Can you send a video of it working?', 'Can you deliver to a site near Dodoma?', 'Is the price negotiable for a cash buyer?'],
  agricultural: ['Are the plough and harrow included in the price?', 'Can I see it working before buying? Our farm is near Morogoro.', 'Do you take an older tractor in exchange?'],
};

/** Extra users, vehicles, enquiries, payments and documents to merge into the main seed. */
export function buildExtras(users, buyers) {
  const all = [...users, ...EXTRA_USERS];
  const motos = Array.from({ length: 17 }, (_, i) => build('motorcycle', MOTO_MODELS, i, all, 5001));
  const lorries = Array.from({ length: 14 }, (_, i) => build('lorry', LORRY_MODELS, i, all, 6001));
  motos[5].status = 'sold';
  lorries[6] = { ...lorries[6], status: 'pending_payment', paymentStatus: 'pending', publishedAt: null };
  const more = [
    ...Array.from({ length: 6 }, (_, i) => buildMore('bus', i, all, 7001)),
    ...Array.from({ length: 5 }, (_, i) => buildMore('construction', i, all, 8001)),
    ...Array.from({ length: 6 }, (_, i) => buildMore('agricultural', i, all, 9001)),
  ];
  const vehicles = [...motos, ...lorries, ...more];

  const enquiries = vehicles
    .filter((v) => v.status === 'live')
    .filter((_, i) => i % 2 === 0)
    .map((v, i) => {
      const b = buyers[i % buyers.length];
      return {
        id: `e${3001 + i}`,
        vehicleId: v.id,
        sellerId: v.sellerId,
        buyerId: b.id,
        buyerName: b.name,
        buyerPhone: b.phone,
        buyerEmail: b.email,
        message: MSGS[v.category][i % 3],
        channel: ['form', 'call', 'chat'][i % 3],
        status: ['new', 'contacted', 'new', 'negotiating', 'closed'][i % 5],
        createdAt: daysAgo(i % 18, 10 + (i % 8)),
      };
    });

  const planOf = (id) => PLANS.find((p) => p.id === id);
  const payments = vehicles.map((v, i) => {
    const planId = v.sellerRole === 'dealer' ? 'dealer-single' : v.planId;
    const fee = planOf(planId).price;
    return {
      id: `TXN${290000 + i * 41}`,
      gatewayRef: `pay_${rand(14, 'abcdefghijkmnpqrstuvwxyz23456789')}`,
      userId: v.sellerId,
      listingId: v.id,
      planId,
      amount: fee,
      gst: Math.round(fee * 0.18),
      total: Math.round(fee * 1.18),
      method: ['Mobile money', 'Card', 'Bank transfer'][i % 3],
      status: v.paymentStatus === 'pending' ? 'pending' : 'success',
      createdAt: v.createdAt,
    };
  });

  const DOCS = {
    dealer: [['business_certificate', 'Business registration certificate'], ['gst_certificate', 'GST registration certificate']],
    seller: [['personal_id', 'Driving licence']],
  };
  const documents = EXTRA_USERS.flatMap((u, k) =>
    (DOCS[u.role] || []).map(([type, label], j) => ({
      id: `d${4001 + k * 2 + j}`,
      userId: u.id,
      type,
      label,
      fileName: `${type.replace(/_/g, '-')}-${u.name.split(' ')[0].toLowerCase()}.${j ? 'pdf' : 'jpg'}`,
      size: int(180, 2400) * 1024,
      maskedNumber: type === 'personal_id' ? `XXXX XX${int(10, 99)} ${int(1000, 9999)}` : type === 'gst_certificate' ? `${int(10, 35)}AAB${rand(7)}` : null,
      uploadedAt: daysAgo(int(1, 40)),
      status: u.docStatus === 'verified' ? 'verified' : 'pending',
      reviewNote: '',
      preview: null,
    })),
  );

  return { users: EXTRA_USERS, vehicles, enquiries, payments, documents };
}
