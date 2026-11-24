// End-to-end API tests. Needs a MongoDB server (uses the database "autodealer_test", which it wipes).
//   MONGODB_TEST_URI=mongodb://127.0.0.1:27017/autodealer_test npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_TEST_URI || 'mongodb://127.0.0.1:27017/autodealer_test';
process.env.ALLOW_DEMO_LOGIN = 'true';
process.env.ALLOW_DEMO_RESET = 'false';
process.env.OTP_DEV_CODE = '';
process.env.UPLOAD_DIR = 'uploads-test';
process.env.SEED_ADMIN_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
process.env.VEHICLE_LOOKUP_PROVIDER = 'mock';

const { createApp } = await import('../src/app.js');
const { connectDb, disconnectDb } = await import('../src/db.js');
const { seedDatabase } = await import('../src/services/seedDb.js');
const { authenticator } = await import('otplib');
const fs = await import('node:fs/promises');

let server;
let base;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}
/** File links are built from PUBLIC_URL; point them at the test server. */
const local = (url) => url.replace(/^https?:\/\/[^/]+/, base);
const demo = async (userId, memberId) => (await call('POST', '/api/auth/demo-login', { body: { userId, memberId } })).body.token;

before(async () => {
  await connectDb(process.env.MONGODB_URI);
  await seedDatabase({ drop: true });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.close();
  await disconnectDb();
  await fs.rm('uploads-test', { recursive: true, force: true });
});

test('guests get public data only', async () => {
  const { status, body } = await call('GET', '/api/bootstrap');
  assert.equal(status, 200);
  assert.ok(body.vehicles.length > 20);
  assert.ok(body.vehicles.every((v) => v.status === 'live'));
  assert.ok(body.vehicles.every((v) => !v.engineNo && !v.ownerInfo && (!v.vin || v.vin.startsWith('X'))));
  assert.ok(body.users.every((u) => u.email === undefined && u.gstin === undefined));
  assert.equal(body.config.paymentGateway.keySecret, undefined);
  assert.equal(body.enquiries.length, 0);
});

test('search and single listing', async () => {
  const s = await call('GET', '/api/vehicles?category=motorcycle&limit=5');
  assert.equal(s.status, 200);
  assert.ok(s.body.items.every((v) => v.category === 'motorcycle'));
  const one = await call('GET', `/api/vehicles/${s.body.items[0].id}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.vehicle.id, s.body.items[0].id);
});

let sellerToken;
test('register a private seller with phone OTP', async () => {
  const phone = '+255 712 000 101';
  const st = await call('POST', '/api/auth/phone-status', { body: { phone } });
  assert.equal(st.body.registered, false);
  const req = await call('POST', '/api/auth/otp/request', { body: { phone } });
  assert.equal(req.status, 200);
  assert.match(req.body.devCode, /^\d{6}$/);
  const bad = await call('POST', '/api/auth/otp/verify', { body: { phone, code: req.body.devCode === '000000' ? '111111' : '000000' } });
  assert.equal(bad.status, 400);
  const ok = await call('POST', '/api/auth/otp/verify', { body: { phone, code: req.body.devCode } });
  assert.equal(ok.body.registered, false);
  const reg = await call('POST', '/api/auth/register', { body: { registrationToken: ok.body.registrationToken, role: 'seller', name: 'Test Seller', city: 'Arusha', status: 'active', docStatus: 'verified' } });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.role, 'seller');
  assert.equal(reg.body.user.docStatus, 'not_submitted'); // privileged field ignored
  sellerToken = reg.body.token;
  const me = await call('GET', '/api/auth/me', { token: sellerToken });
  assert.equal(me.body.user.name, 'Test Seller');
});

let listingId;
test('listing: draft → missing docs → pending payment → paid and live', async () => {
  const create = await call('POST', '/api/vehicles', {
    token: sellerToken,
    body: { category: 'car', make: 'Toyota', model: 'Corolla', variant: 'GLi', year: 2019, price: 28000000, mileage: '54,000', fuel: 'Petrol', transmission: 'Automatic', condition: 'Used', city: 'Arusha', regNumber: 'T 123 ABC', vin: 'JTDBR32E720012345', description: 'One owner, full service history.', specs: { seats: 5 }, photos: [PNG], status: 'live', paymentStatus: 'paid' },
  });
  assert.equal(create.status, 201);
  const v = create.body.vehicle;
  listingId = v.id;
  assert.equal(v.status, 'draft');
  assert.equal(v.paymentStatus, 'unpaid');
  assert.equal(v.mileage, 54000);
  assert.match(v.photos[0], /\/uploads\/photos\/.+\.png$/);
  const photo = await fetch(local(v.photos[0]));
  assert.equal(photo.status, 200);

  // Private sellers can list several vehicles; an admin can set a limit.
  const second = await call('POST', '/api/vehicles', { token: sellerToken, body: { make: 'Honda', category: 'motorcycle' } });
  assert.equal(second.status, 201, 'private sellers can list more than one vehicle');
  const admin = await demo('u_admin');
  await call('PATCH', '/api/admin/config', { token: admin, body: { sellerListingLimit: 2 } });
  const third = await call('POST', '/api/vehicles', { token: sellerToken, body: { make: 'Bajaj', category: 'motorcycle' } });
  assert.equal(third.status, 409, 'limit set by admin');
  assert.match(third.body.error, /2 active listings/);
  await call('PATCH', '/api/admin/config', { token: admin, body: { sellerListingLimit: 0 } });
  await call('DELETE', `/api/vehicles/${second.body.vehicle.id}`, { token: sellerToken });

  const early = await call('POST', `/api/vehicles/${listingId}/submit`, { token: sellerToken });
  assert.equal(early.status, 422);
  assert.ok(early.body.problems.some((p) => /personal id/.test(p)));

  const doc = await call('POST', '/api/documents', { token: sellerToken, body: { type: 'personal_id', label: 'National ID', fileName: 'id.png', size: 70, maskedNumber: 'XXXX1234', data: PNG } });
  assert.equal(doc.status, 201);
  assert.equal(doc.body.docStatus, 'pending');
  assert.match(doc.body.document.preview, /\/files\/docs\/.+sig=/);
  assert.equal((await fetch(local(doc.body.document.preview))).status, 200);
  assert.equal((await fetch(local(doc.body.document.preview).replace(/sig=.*/, 'sig=x'))).status, 403);

  const sub = await call('POST', `/api/vehicles/${listingId}/submit`, { token: sellerToken });
  assert.equal(sub.body.ok, true);
  assert.equal(sub.body.vehicle.status, 'pending_payment');
  assert.equal((await call('GET', `/api/vehicles/${listingId}`)).status, 404, 'not public before payment');

  const failed = await call('POST', '/api/payments/checkout', { token: sellerToken, body: { listingId, planId: 'seller-basic', method: 'card', outcome: 'failed' } });
  assert.equal(failed.status, 201);
  assert.equal(failed.body.vehicle.status, 'pending_payment');

  const pend = await call('POST', '/api/payments/checkout', { token: sellerToken, body: { listingId, planId: 'seller-basic', method: 'mobile', outcome: 'pending' } });
  assert.equal(pend.body.payment.status, 'pending');
  const settle = await call('POST', `/api/payments/${pend.body.payment.id}/resolve`, { token: sellerToken, body: { outcome: 'success' } });
  assert.equal(settle.status, 200);
  assert.equal(settle.body.vehicle.status, 'live');
  assert.equal(settle.body.vehicle.paymentStatus, 'paid');
  assert.equal(settle.body.vehicle.verification, 'unverified', 'live is not verified');
  const pub = await call('GET', `/api/vehicles/${listingId}`);
  assert.equal(pub.status, 200);
  assert.ok(pub.body.vehicle.vin.startsWith('XXXX'));
});

test('vehicle lookup for the listing form (sellers only)', async () => {
  const dealer = await demo('u_dealer1');
  assert.equal((await call('GET', '/api/vehicles/lookup?reg=T123DEF')).status, 401);
  const found = await call('GET', '/api/vehicles/lookup?reg=T%20123%20def', { token: dealer });
  assert.equal(found.body.status, 'found');
  assert.equal(found.body.vehicle.make, 'Toyota');
  const none = await call('GET', '/api/vehicles/lookup?reg=T999ZZZ', { token: dealer });
  assert.equal(none.body.status, 'not_found');
  process.env.VEHICLE_LOOKUP_PROVIDER = 'none';
  const off = await call('GET', '/api/vehicles/lookup?reg=T123DEF', { token: dealer });
  assert.equal(off.body.status, 'unavailable');
  process.env.VEHICLE_LOOKUP_PROVIDER = 'mock';
});

test('duplicates are blocked', async () => {
  const dealer = await demo('u_dealer1');
  const check = await call('POST', '/api/vehicles/duplicate-check', { body: { regNumber: 't123abc' } });
  assert.equal(check.body.duplicates[0].id, listingId);
  const create = await call('POST', '/api/vehicles', { token: dealer, body: { make: 'Toyota', model: 'Corolla', year: 2019, price: 28000000, mileage: 40000, fuel: 'Petrol', transmission: 'Manual', condition: 'Used', city: 'Arusha', regNumber: 'T-123-ABC', vin: 'OTHERVIN000000001', description: 'x', specs: { seats: 5 } } });
  const sub = await call('POST', `/api/vehicles/${create.body.vehicle.id}/submit`, { token: dealer });
  assert.equal(sub.body.ok, false);
  assert.equal(sub.body.vehicle.status, 'blocked_duplicate');
  const pay = await call('POST', '/api/payments/checkout', { token: dealer, body: { listingId: create.body.vehicle.id, planId: 'dealer-standard', method: 'card', outcome: 'success' } });
  assert.equal(pay.status, 400);
});

test('enquiry reaches the seller', async () => {
  const e = await call('POST', '/api/enquiries', { body: { vehicleId: listingId, buyerName: 'Juma Ali', buyerPhone: '+255 713 222 333', message: 'Is it still available?' } });
  assert.equal(e.status, 201);
  const own = await call('POST', '/api/enquiries', { token: sellerToken, body: { vehicleId: listingId, buyerName: 'Me', buyerPhone: '+255 712 000 101', message: 'x' } });
  assert.equal(own.status, 400);
  const boot = await call('GET', '/api/bootstrap', { token: sellerToken });
  assert.ok(boot.body.enquiries.some((x) => x.id === e.body.enquiry.id));
  const upd = await call('PATCH', `/api/enquiries/${e.body.enquiry.id}`, { token: sellerToken, body: { status: 'contacted' } });
  assert.equal(upd.body.enquiry.status, 'contacted');
});

test('finance enquiry notifies dealer and bank; bank updates the lead', async () => {
  const boot = await call('GET', '/api/bootstrap');
  // A car that meets NorthStar's seeded criteria (cars up to 8 years old, from TSh 5M).
  const v = boot.body.vehicles.find((x) => x.sellerId === 'u_dealer1' && x.status === 'live' && (x.category || 'car') === 'car' && new Date().getFullYear() - x.year <= 8 && x.price >= 5000000);
  const f = await call('POST', '/api/finance-enquiries', {
    body: { vehicleId: v.id, lenderId: 'lp2', price: 1, downPayment: Math.round(v.price * 0.2), ratePct: 9.5, months: 60, buyerName: 'Neema Mushi', buyerPhone: '+255 714 555 666', city: 'Dodoma', employment: 'Salaried', consent: true },
  });
  assert.equal(f.status, 201);
  assert.equal(f.body.enquiry.finance.price, v.price, 'price comes from the listing');
  assert.equal(f.body.notifications.length, 2);
  const id = f.body.enquiry.id;
  assert.equal((await call('GET', `/api/finance-enquiries/${id}`)).status, 403);
  const withKey = await call('GET', `/api/finance-enquiries/${id}?key=${f.body.accessKey}`);
  assert.equal(withKey.status, 200);
  assert.equal(withKey.body.referral.lenderId, 'lp2');

  const bank = await demo('u_bank_lp2');
  const bb = await call('GET', '/api/bootstrap', { token: bank });
  assert.ok(bb.body.referrals.some((r) => r.id === f.body.referral.id));
  assert.ok(bb.body.referrals.every((r) => r.lenderId === 'lp2'));
  const otherBank = await demo('u_bank_lp1');
  assert.equal((await call('POST', `/api/referrals/${f.body.referral.id}/status`, { token: otherBank, body: { status: 'contacted' } })).status, 403);
  const up = await call('POST', `/api/referrals/${f.body.referral.id}/status`, { token: bank, body: { status: 'sanctioned', note: 'Approved' } });
  assert.equal(up.body.referral.status, 'sanctioned');
  assert.equal(up.body.notification.recipientId, 'u_dealer1');
  const dealer = await demo('u_dealer1');
  const db = await call('GET', '/api/bootstrap', { token: dealer });
  assert.ok(db.body.notifications.some((n) => n.id === up.body.notification.id));
});

test('buyer tools follow the account', async () => {
  const buyer = await demo('u_buyer1');
  const t = await call('POST', `/api/me/saved/${listingId}/toggle`, { token: buyer });
  assert.ok(t.body.saved.includes(listingId));
  const ss = await call('POST', '/api/me/saved-searches', { token: buyer, body: { label: 'Corollas', query: { make: 'Toyota' } } });
  assert.equal(ss.status, 201);
  const p = await call('PATCH', '/api/me/prefs', { token: buyer, body: { city: 'Arusha' } });
  assert.equal(p.body.buyerPrefs.city, 'Arusha');
  const boot = await call('GET', '/api/bootstrap', { token: buyer });
  assert.ok(boot.body.saved.includes(listingId));
  assert.ok(boot.body.savedSearches.some((s) => s.label === 'Corollas'));
});

test('agent handover checklist', async () => {
  const agent = await demo('u_agent1');
  const boot = await call('GET', '/api/bootstrap', { token: agent });
  const v = boot.body.vehicles.find((x) => x.sellerId === 'u_agent1');
  const h = await call('POST', '/api/handovers/ensure', { token: agent, body: { vehicleId: v.id } });
  assert.equal(h.status, 200);
  const step = h.body.handover.steps[0].key;
  const u = await call('PATCH', `/api/handovers/${h.body.handover.id}/steps/${step}`, { token: agent, body: { status: 'completed', note: 'Signed' } });
  assert.equal(u.body.handover.steps[0].status, 'completed');
  assert.equal((await call('POST', '/api/handovers/ensure', { token: sellerToken, body: { vehicleId: v.id } })).status, 403);
});

let adminToken;
test('admin sign-in needs password and authenticator code', async () => {
  const wrong = await call('POST', '/api/auth/admin/login', { body: { email: 'admin@autodealer.example', password: 'nope' } });
  assert.equal(wrong.status, 401);
  const step1 = await call('POST', '/api/auth/admin/login', { body: { email: 'admin@autodealer.example', password: 'AutoDealer#2026' } });
  assert.equal(step1.body.needsTotp, true);
  const step2 = await call('POST', '/api/auth/admin/login', { body: { email: 'admin@autodealer.example', password: 'AutoDealer#2026', totp: authenticator.generate('JBSWY3DPEHPK3PXP') } });
  assert.equal(step2.status, 200);
  adminToken = step2.body.token;
  const boot = await call('GET', '/api/bootstrap', { token: adminToken });
  assert.ok(boot.body.audit.length > 0);
  assert.ok(boot.body.config.paymentGateway.keySecret);
  assert.equal((await call('POST', '/api/admin/vehicles/v1001/moderate', { token: sellerToken, body: { action: 'verify' } })).status, 403);
});

test('admin moderation, suspension and config', async () => {
  const m = await call('POST', `/api/admin/vehicles/${listingId}/moderate`, { token: adminToken, body: { action: 'verify', note: 'Docs checked' } });
  assert.equal(m.body.vehicle.verification, 'verified');
  const note = await call('POST', `/api/admin/vehicles/${listingId}/notes`, { token: adminToken, body: { text: 'Called seller' } });
  assert.equal(note.status, 201);
  const me = await call('GET', '/api/auth/me', { token: sellerToken });
  // Suspensions are maker-checker: the request waits for another admin's approval.
  const sus = await call('POST', `/api/admin/users/${me.body.user.id}/status`, { token: adminToken, body: { status: 'suspended', note: 'Test suspension' } });
  assert.equal(sus.status, 202);
  assert.equal((await call('GET', '/api/auth/me', { token: sellerToken })).status, 200, 'nothing happens before approval');
  assert.equal((await call('POST', `/api/admin/approvals/${sus.body.approval.id}/approve`, { token: adminToken, body: {} })).status, 403, 'no self-approval');
  const ops = await demo('u_admin_ops');
  const ok = await call('POST', `/api/admin/approvals/${sus.body.approval.id}/approve`, { token: ops, body: { note: 'Agreed' } });
  assert.equal(ok.body.approval.status, 'approved');
  assert.equal((await call('GET', '/api/auth/me', { token: sellerToken })).status, 401, 'suspended token rejected');
  const re = await call('POST', `/api/admin/users/${me.body.user.id}/status`, { token: adminToken, body: { status: 'active' } });
  assert.equal(re.body.vehicles[0].status, 'live');
  const cfg = await call('PATCH', '/api/admin/config', { token: adminToken, body: { listingValidityDays: 45, hacker: true } });
  assert.equal(cfg.body.config.listingValidityDays, 45);
  assert.equal(cfg.body.config.hacker, undefined);
});

test('admin invitation flow', async () => {
  const inv = await call('POST', '/api/admin/staff/invites', { token: adminToken, body: { email: 'ops2@autodealer.example', adminRole: 'listings' } });
  assert.equal(inv.status, 201);
  const chk = await call('POST', '/api/auth/admin/invite/check', { body: { code: inv.body.code, email: 'ops2@autodealer.example' } });
  assert.match(chk.body.otpauthUrl, /^otpauth:/);
  const weak = await call('POST', '/api/auth/admin/invite/accept', { body: { code: inv.body.code, email: 'ops2@autodealer.example', name: 'Ops Two', phone: '+255 715 000 001', password: 'short', totp: '123456' } });
  assert.equal(weak.status, 400);
  const ok = await call('POST', '/api/auth/admin/invite/accept', {
    body: { code: inv.body.code, email: 'ops2@autodealer.example', name: 'Ops Two', phone: '+255 715 000 001', password: 'Very$trongPass1', totp: authenticator.generate(chk.body.secret) },
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.user.role, 'admin');
  assert.equal(ok.body.user.adminRole, 'listings', 'gets the invited role');
  assert.deepEqual(ok.body.permissions.includes('listings.moderate') && !ok.body.permissions.includes('payments.view'), true);
  const again = await call('POST', '/api/auth/admin/invite/check', { body: { code: inv.body.code, email: 'ops2@autodealer.example' } });
  assert.equal(again.status, 400, 'invite is single-use');
});

test('mark sold', async () => {
  const me = await call('POST', '/api/auth/otp/request', { body: { phone: '+255 712 000 101' } });
  const s = await call('POST', '/api/auth/otp/verify', { body: { phone: '+255 712 000 101', code: me.body.devCode } });
  sellerToken = s.body.token;
  const sold = await call('POST', `/api/vehicles/${listingId}/status`, { token: sellerToken, body: { status: 'sold' } });
  assert.equal(sold.body.vehicle.status, 'sold');
});

test('admin manages vehicle categories', async () => {
  const token = await demo('u_admin');
  const list = await call('GET', '/api/admin/categories', { token });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.categories.map((c) => c.key), ['car', 'motorcycle', 'bus', 'lorry', 'construction', 'agricultural']);
  assert.equal(list.body.categories.find((c) => c.key === 'lorry').slug, 'trucks-trailers');
  assert.equal((await call('GET', '/api/admin/categories', { token: await demo('u_dealer1') })).status, 403, 'admins only');

  // Rename Motorcycles: the key stays, the old address becomes an alias.
  const ren = await call('PATCH', '/api/admin/categories/motorcycle', { token, body: { name: 'Bikes & Scooters', slug: 'bikes' } });
  assert.equal(ren.status, 200);
  assert.equal(ren.body.category.slug, 'bikes');
  assert.ok(ren.body.category.aliases.includes('motorcycles'));
  assert.ok((await call('GET', '/api/vehicles?category=motorcycle&limit=2')).body.items.length > 0, 'listings keep their category');

  // Slugs must be free and not clash with other pages.
  assert.equal((await call('PATCH', '/api/admin/categories/bus', { token, body: { slug: 'bikes' } })).status, 409);
  assert.equal((await call('PATCH', '/api/admin/categories/bus', { token, body: { slug: 'dealers' } })).status, 400);

  // Add a new category, then list a vehicle in it (usage in hours, brand not in any list).
  const base = list.body.categories.find((c) => c.key === 'agricultural');
  const { key: _k, aliases: _a, order: _o, image: _i, ...copy } = base;
  const add = await call('POST', '/api/admin/categories', { token, body: { ...copy, name: 'Boats & Marine', singular: 'Boat', nounPlural: 'boats', slug: 'boats', icon: 'Ship', types: ['Fishing boat', 'Speedboat'] } });
  assert.equal(add.status, 201);
  assert.equal(add.body.category.key, 'boats');
  assert.equal(add.body.categories.at(-1).key, 'boats', 'new categories go last');
  const pub = await call('GET', '/api/bootstrap');
  assert.ok(pub.body.categories.some((c) => c.key === 'boats'));

  const dealer = await demo('u_dealer1');
  const boat = await call('POST', '/api/vehicles', {
    token: dealer,
    body: { category: 'boats', make: 'Yamaha Marine', model: 'F150 Hull', year: 2020, price: 60000000, mileage: 800, fuel: 'Petrol', transmission: 'Manual', condition: 'Used', city: 'Dar es Salaam', regNumber: 'TZ BOAT 1', description: 'Fishing boat with outboard engine.', bodyType: 'Fishing boat' },
  });
  assert.equal(boat.status, 201);
  assert.equal(boat.body.vehicle.category, 'boats');
  assert.equal((await call('POST', '/api/vehicles', { token: dealer, body: { category: 'spaceships', make: 'X' } })).status, 400, 'unknown category');

  // Reorder.
  const order = ['boats', 'car', 'motorcycle', 'bus', 'lorry', 'construction', 'agricultural'];
  const ro = await call('POST', '/api/admin/categories/reorder', { token, body: { keys: order } });
  assert.deepEqual(ro.body.categories.map((c) => c.key), order);

  // Hide: gone from the public site, listings hidden too.
  await call('PATCH', '/api/admin/categories/bus', { token, body: { enabled: false } });
  const hidden = await call('GET', '/api/bootstrap');
  assert.ok(!hidden.body.categories.some((c) => c.key === 'bus'));
  assert.ok(!hidden.body.vehicles.some((v) => v.category === 'bus'));
  assert.equal((await call('GET', '/api/vehicles?category=bus')).body.items.length, 0);
  await call('PATCH', '/api/admin/categories/bus', { token, body: { enabled: true } });

  // Remove: listings must be moved first; the old address then points at the new home.
  const counts = (await call('GET', '/api/admin/categories', { token })).body.counts;
  assert.ok(counts.boats.total >= 1);
  assert.equal((await call('DELETE', '/api/admin/categories/boats', { token })).status, 400, 'needs a destination');
  const del = await call('DELETE', '/api/admin/categories/boats', { token, body: { moveTo: 'agricultural' } });
  assert.equal(del.status, 200);
  assert.ok(!del.body.categories.some((c) => c.key === 'boats'));
  assert.ok(del.body.categories.find((c) => c.key === 'agricultural').aliases.includes('boats'));
  assert.equal((await call('GET', `/api/vehicles/${boat.body.vehicle.id}`, { token: dealer })).body.vehicle.category, 'agricultural');

  // Put Motorcycles back for any later test.
  await call('PATCH', '/api/admin/categories/motorcycle', { token, body: { name: 'Motorcycles & Scooters', slug: 'motorcycles' } });
});

test("a category's own rules apply before payment", async () => {
  const token = await demo('u_admin');
  await call('PATCH', '/api/admin/categories/agricultural', { token, body: { minPrice: 1000000, maxUsage: 30000, specFields: [{ key: 'powerHp', required: true, filter: true }] } });
  const dealer = await demo('u_dealer1');
  const made = await call('POST', '/api/vehicles', {
    token: dealer,
    body: { category: 'agricultural', make: 'Swaraj', model: '744 FE', year: 2019, price: 500000, mileage: 45000, fuel: 'Diesel', transmission: 'Manual', condition: 'Used', city: 'Arusha', regNumber: 'T 744 FRM', vin: 'SWJ74400000000001', description: 'Tractor with plough.', specs: {} },
  });
  assert.equal(made.status, 201);
  const sub = await call('POST', `/api/vehicles/${made.body.vehicle.id}/submit`, { token: dealer });
  assert.equal(sub.status, 422);
  const text = sub.body.problems.join(' ');
  assert.match(text, /at least TSh 1,000,000/);
  assert.match(text, /hours: the most allowed is 30,000/);
  assert.match(text, /engine power/);
});

/** Open the live event stream (as a user, a guest conversation, or anonymous) and collect its events. */
function listen(path, token) {
  const ctrl = new AbortController();
  const events = [];
  (async () => {
    try {
      const res = await fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: ctrl.signal });
      events.status = res.status;
      if (!res.ok) return;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const name = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (name && data) events.push({ name, data: JSON.parse(data) });
        }
      }
    } catch {
      /* closed */
    }
  })();
  const waitFor = async (name, pred = () => true, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = events.find((e) => e.name === name && pred(e.data));
      if (hit) return hit.data;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`No "${name}" event within ${ms} ms (got: ${events.map((e) => e.name).join(', ') || 'nothing'})`);
  };
  return { events, waitFor, close: () => ctrl.abort() };
}

test('chat: guest enquiry, live seller reply, access key', async () => {
  const live = (await call('GET', '/api/vehicles?category=car&limit=1')).body.items[0];
  const sellerToken = await demo(live.sellerId);
  const sellerStream = listen('/api/events', sellerToken);
  await sellerStream.waitFor('ready');

  const made = await call('POST', '/api/enquiries', { body: { vehicleId: live.id, buyerName: 'Guest Gaby', buyerPhone: '+255712000111', message: 'Is it still available?' } });
  assert.equal(made.status, 201);
  const { enquiry, accessKey, conversationPath } = made.body;
  assert.ok(accessKey && conversationPath.includes(accessKey));
  assert.equal(enquiry.messages.length, 1);
  await sellerStream.waitFor('enquiry', (d) => d.enquiry.id === enquiry.id);
  await sellerStream.waitFor('notification', (d) => d.notification.refId === enquiry.id);

  // The guest follows the conversation live with the key; a wrong key gets nothing.
  assert.equal((await call('GET', `/api/events?enquiry=${enquiry.id}&key=nope`)).status, 403);
  const guestStream = listen(`/api/events?enquiry=${enquiry.id}&key=${accessKey}`);
  await guestStream.waitFor('ready');

  const reply = await call('POST', `/api/enquiries/${enquiry.id}/messages`, { token: sellerToken, body: { text: 'Yes, come and see it tomorrow.' } });
  assert.equal(reply.status, 201);
  assert.equal(reply.body.enquiry.status, 'contacted', 'replying moves a new enquiry on');
  const pushed = await guestStream.waitFor('message', (d) => d.message?.from === 'seller');
  assert.equal(pushed.message.text, 'Yes, come and see it tomorrow.');

  assert.equal((await call('GET', `/api/enquiries/${enquiry.id}`)).status, 403, 'private without the key');
  const asGuest = await call('GET', `/api/enquiries/${enquiry.id}?key=${accessKey}`);
  assert.equal(asGuest.body.side, 'buyer');
  assert.equal((await call('POST', `/api/enquiries/${enquiry.id}/messages`, { body: { text: 'hi', key: 'wrong' } })).status, 403);
  const back = await call('POST', `/api/enquiries/${enquiry.id}/messages`, { body: { text: 'Great, 10 am?', key: accessKey } });
  assert.equal(back.status, 201);
  await sellerStream.waitFor('message', (d) => d.message?.text === 'Great, 10 am?');
  assert.equal((await call('POST', `/api/enquiries/${enquiry.id}/messages`, { token: await demo('u_admin'), body: { text: 'admin' } })).status, 403);

  // "Seen": the seller reads, the guest's page hears about it.
  await call('POST', `/api/enquiries/${enquiry.id}/read`, { token: sellerToken });
  const read = await guestStream.waitFor('read', (d) => d.side === 'seller');
  assert.ok(read.enquiry.readAt.seller >= back.body.message.at);
  sellerStream.close();
  guestStream.close();
});

test('chat: a signed-in buyer gets replies in their account', async () => {
  const live = (await call('GET', '/api/vehicles?category=car&limit=3')).body.items[2];
  const buyerToken = await demo('u_buyer1');
  const made = await call('POST', '/api/enquiries', { token: buyerToken, body: { vehicleId: live.id, buyerName: 'Buyer One', buyerPhone: '+255700000001', message: 'Best price?' } });
  assert.equal(made.body.enquiry.buyerId, 'u_buyer1');
  const buyerStream = listen('/api/events', buyerToken);
  await buyerStream.waitFor('ready');
  await call('POST', `/api/enquiries/${made.body.enquiry.id}/messages`, { token: await demo(live.sellerId), body: { text: 'TSh 1M off for you.' } });
  const n = await buyerStream.waitFor('notification', (d) => d.notification.refId === made.body.enquiry.id);
  assert.equal(n.notification.link, `/buyer/messages?c=${made.body.enquiry.id}`);
  const boot = await call('GET', '/api/bootstrap', { token: buyerToken });
  const conv = boot.body.enquiries.find((e) => e.id === made.body.enquiry.id);
  assert.deepEqual(conv.messages.map((m) => m.from), ['buyer', 'seller']);
  buyerStream.close();
});

test('buyers hear when a saved vehicle changes', async () => {
  const live = (await call('GET', '/api/vehicles?category=car&limit=5')).body.items[4];
  const buyerToken = await demo('u_buyer1');
  const saved = await call('POST', `/api/me/saved/${live.id}/toggle`, { token: buyerToken });
  if (!saved.body.saved.includes(live.id)) await call('POST', `/api/me/saved/${live.id}/toggle`, { token: buyerToken });
  const buyerStream = listen('/api/events', buyerToken);
  const publicStream = listen('/api/events');
  await buyerStream.waitFor('ready');
  await publicStream.waitFor('ready');

  const sellerToken = await demo(live.sellerId);
  const cheaper = live.price - 1000000;
  assert.equal((await call('PATCH', `/api/vehicles/${live.id}`, { token: sellerToken, body: { price: cheaper } })).status, 200);
  const n = await buyerStream.waitFor('notification', (d) => d.notification.kind === 'saved_price_drop');
  assert.match(n.notification.title, /^Price drop/);
  assert.match(n.notification.body, /save TSh 1,000,000/);
  const pub = await publicStream.waitFor('vehicle', (d) => d.vehicle.id === live.id);
  assert.equal(pub.vehicle.price, cheaper);
  assert.equal(pub.scope, 'public');

  await call('POST', `/api/vehicles/${live.id}/status`, { token: sellerToken, body: { status: 'sold' } });
  const sold = await buyerStream.waitFor('notification', (d) => d.notification.kind === 'saved_sold');
  assert.match(sold.notification.title, /^Sold/);
  buyerStream.close();
  publicStream.close();
});

test('featured: plans for every seller type and a boost for live listings', async () => {
  const dealer = await demo('u_dealer1');
  const boot = await call('GET', '/api/bootstrap', { token: dealer });
  const liveOne = boot.body.vehicles.find((v) => v.sellerId === 'u_dealer1' && v.status === 'live' && !v.featured);
  const draft = boot.body.vehicles.find((v) => v.sellerId === 'u_dealer1' && v.status !== 'live');
  if (draft) {
    const no = await call('POST', '/api/payments/checkout', { token: dealer, body: { listingId: draft.id, planId: 'feature-boost', method: 'card', outcome: 'success' } });
    assert.equal(no.status, 400, 'only live listings can be boosted');
  }
  const paid = await call('POST', '/api/payments/checkout', { token: dealer, body: { listingId: liveOne.id, planId: 'feature-boost', method: 'card', outcome: 'success' } });
  assert.equal(paid.status, 201);
  assert.equal(paid.body.vehicle.featured, true);
  const days = (new Date(paid.body.vehicle.featuredUntil) - Date.now()) / 864e5;
  assert.ok(days > 6.9 && days <= 7.01, `featured for 7 days (got ${days})`);
  assert.equal(paid.body.vehicle.status, 'live', 'the listing stays live');
  // Buying again extends it.
  const again = await call('POST', '/api/payments/checkout', { token: dealer, body: { listingId: liveOne.id, planId: 'feature-boost', method: 'card', outcome: 'success' } });
  assert.ok((new Date(again.body.vehicle.featuredUntil) - Date.now()) / 864e5 > 13.9);
  // An agent can't use a dealer plan.
  const agentBoot = await call('GET', '/api/bootstrap', { token: await demo('u_agent1') });
  const agentDraft = agentBoot.body.vehicles.find((v) => v.sellerId === 'u_agent1' && ['draft', 'pending_payment'].includes(v.status));
  if (agentDraft) assert.equal((await call('POST', '/api/payments/checkout', { token: await demo('u_agent1'), body: { listingId: agentDraft.id, planId: 'dealer-featured', method: 'card' } })).status, 400);
  // Admins can feature and stop featuring.
  const admin = await demo('u_admin');
  const off = await call('POST', `/api/admin/vehicles/${liveOne.id}/moderate`, { token: admin, body: { action: 'unfeature' } });
  assert.equal(off.body.vehicle.featured, false);
});

test('admins can set and reset a city photo', async () => {
  const admin = await demo('u_admin');
  assert.equal((await call('POST', '/api/admin/cities/Iringa/image', { token: await demo('u_dealer1'), body: { imageData: PNG } })).status, 403);
  const up = await call('POST', '/api/admin/cities/Iringa/image', { token: admin, body: { imageData: PNG } });
  assert.equal(up.status, 200);
  assert.match(up.body.config.cityImages.Iringa, /^http.+\/uploads\/photos\/.+\.png$/);
  const pub = await call('GET', '/api/bootstrap');
  assert.equal(pub.body.config.cityImages.Iringa, up.body.config.cityImages.Iringa, 'everyone sees the photo');
  const reset = await call('POST', '/api/admin/cities/Iringa/image', { token: admin, body: { imageData: null } });
  assert.equal(reset.body.config.cityImages.Iringa, undefined);
});

test('demo data is Tanzanian', async () => {
  const boot = await call('GET', '/api/bootstrap');
  const regs = boot.body.vehicles.map((v) => v.regNumber).filter(Boolean);
  assert.ok(regs.length > 20);
  for (const r of regs) assert.match(r, /^(T\d{3}[A-Z]{3}|MC\d{3}[A-Z]{3}|Z\d{3}[A-Z]{2})$/, `registration ${r}`);
  for (const u of boot.body.users) if (u.phone) assert.match(u.phone, /^\+255 \d{3} \d{3} \d{3}$/, `phone ${u.phone}`);
});

test('admins add, edit, switch off and remove loan providers', async () => {
  const admin = await demo('u_admin');
  assert.equal((await call('POST', '/api/admin/loan-providers', { token: await demo('u_dealer1'), body: { name: 'X', rate: 1, commissionPct: 1 } })).status, 403);
  const add = await call('POST', '/api/admin/loan-providers', {
    token: admin,
    body: { name: 'CRDB Bank Car Loans', short: 'CRDB', rate: 16.5, commissionPct: 0.6, maxFundingPct: 70, maxMonths: 60, documents: ['NIDA ID'], apiKey: 'secret-key', loginPhone: '0754 123 456' },
  });
  assert.equal(add.status, 201);
  const id = add.body.provider.id;
  assert.equal(id, 'lp_crdb');
  assert.equal(add.body.providers.find((p) => p.id === id).loginPhone, '+255 754 123 456');

  // Buyers see it on the loan calculator, without the API key.
  const pub = (await call('GET', '/api/bootstrap')).body.config.loanProviders.find((l) => l.id === id);
  assert.equal(pub.rate, 16.5);
  assert.equal(pub.apiKey, undefined);

  // The bank's staff can sign in with the lead-desk number.
  const desk = await call('POST', '/api/auth/otp/request', { body: { phone: '+255 754 123 456' } });
  assert.equal(desk.status, 200);

  // A number already used by another account is refused.
  const dealerPhone = (await call('GET', '/api/bootstrap', { token: admin })).body.users.find((u) => u.id === 'u_dealer1').phone;
  assert.equal((await call('PATCH', `/api/admin/loan-providers/${id}`, { token: admin, body: { loginPhone: dealerPhone } })).status, 409);

  const off = await call('PATCH', `/api/admin/loan-providers/${id}`, { token: admin, body: { enabled: false, rate: 15.9 } });
  assert.equal(off.body.provider.enabled, false);
  assert.equal(off.body.provider.rate, 15.9);

  // Lenders with finance enquiries can't be removed; new unused ones can.
  assert.equal((await call('DELETE', '/api/admin/loan-providers/lp1', { token: admin })).status, 409);
  const del = await call('DELETE', `/api/admin/loan-providers/${id}`, { token: admin });
  assert.equal(del.status, 200);
  assert.ok(!del.body.providers.some((p) => p.id === id));
});

test('a pack is paid once: the next listings publish with its credits', async () => {
  const dealer = await demo('u_dealer1');
  const make = async (reg) => (await call('POST', '/api/vehicles', { token: dealer, body: { make: 'Toyota', model: 'Probox', year: 2016, price: 18500000, mileage: 88000, fuel: 'Petrol', transmission: 'Automatic', condition: 'Used', city: 'Dar es Salaam', regNumber: reg, description: 'Clean Probox', specs: {} } })).body.vehicle;
  const first = await make('T 811 DKA');
  const pay = await call('POST', '/api/payments/checkout', { token: dealer, body: { listingId: first.id, planId: 'dealer-pro', method: 'Card', outcome: 'success' } });
  assert.equal(pay.status, 201);
  const pack = pay.body.user.listingPacks.at(-1);
  assert.deepEqual([pack.total, pack.used.length, pack.featuredTotal], [10, 1, 2]);

  const second = await make('T 812 DKA');
  const credit = await call('POST', '/api/payments/use-credit', { token: dealer, body: { listingId: second.id } });
  assert.equal(credit.status, 201);
  assert.equal(credit.body.payment.total, 0);
  assert.equal(credit.body.vehicle.status, 'live');
  assert.equal(credit.body.user.listingPacks.at(-1).used.length, 2);
  const again = await call('POST', '/api/payments/use-credit', { token: dealer, body: { listingId: second.id } });
  assert.equal(again.status, 400, 'a live listing does not use another credit');

  const boost = await call('POST', '/api/payments/use-credit', { token: dealer, body: { listingId: second.id, kind: 'feature' } });
  assert.equal(boost.body.vehicle.featured, true);
  assert.equal(boost.body.user.listingPacks.at(-1).featuredUsed.length, 1);

  const seller = await demo('u_seller1');
  const own = (await call('GET', '/api/bootstrap', { token: seller })).body.vehicles.find((v) => v.sellerId === 'u_seller1' && v.status !== 'live');
  if (own) assert.equal((await call('POST', '/api/payments/use-credit', { token: seller, body: { listingId: own.id } })).status, 400, 'no pack, no credit');
});

test('admins hear about new registrations; sellers hear about reviews', async () => {
  const phone = '+91 98610 40404'; // any country works
  const admin = await demo('u_admin');
  const before = (await call('GET', '/api/bootstrap', { token: admin })).body.notifications.length;
  const req = await call('POST', '/api/auth/otp/request', { body: { phone } });
  const ok = await call('POST', '/api/auth/otp/verify', { body: { phone, code: req.body.devCode } });
  const reg = await call('POST', '/api/auth/register', { body: { registrationToken: ok.body.registrationToken, role: 'dealer', name: 'Asha Said', business: 'Asha Motors', city: 'Mwanza' } });
  assert.equal(reg.status, 201);
  await new Promise((r) => setTimeout(r, 300));
  const after = (await call('GET', '/api/bootstrap', { token: admin })).body.notifications;
  assert.ok(after.length > before);
  assert.match(after[0].title, /New dealer registered: Asha Motors/);

  const boot = await call('GET', '/api/bootstrap', { token: admin });
  const v = boot.body.vehicles.find((x) => x.sellerId === 'u_dealer1' && x.status === 'live');
  await call('POST', `/api/admin/vehicles/${v.id}/moderate`, { token: admin, body: { action: 'verify' } });
  await new Promise((r) => setTimeout(r, 300));
  const mine = (await call('GET', '/api/bootstrap', { token: await demo('u_dealer1') })).body.notifications;
  assert.ok(mine.some((n) => n.kind === 'listing_verify' && n.refId === v.id));
});

test('admins manage the city list people choose from', async () => {
  const admin = await demo('u_admin');
  const add = await call('POST', '/api/admin/cities', { token: admin, body: { name: 'Shinyanga', region: 'Shinyanga' } });
  assert.equal(add.status, 201);
  assert.ok((await call('GET', '/api/bootstrap')).body.config.cities.some((c) => c.name === 'Shinyanga' && c.enabled));
  assert.equal((await call('POST', '/api/admin/cities', { token: admin, body: { name: 'shinyanga' } })).status, 409, 'no duplicates');
  const off = await call('PATCH', '/api/admin/cities/Shinyanga', { token: admin, body: { enabled: false } });
  assert.equal(off.body.cities.find((c) => c.name === 'Shinyanga').enabled, false);
  assert.equal((await call('DELETE', '/api/admin/cities/Dar%20es%20Salaam', { token: admin })).status, 409, 'a city in use is switched off, not removed');
  assert.equal((await call('DELETE', '/api/admin/cities/Shinyanga', { token: admin })).status, 200);
  assert.equal((await call('POST', '/api/admin/cities', { token: await demo('u_dealer1'), body: { name: 'Kahama' } })).status, 403);
});


test('admin roles: each role reaches only its own area', async () => {
  const fin = await demo('u_admin_finance');
  const it = await demo('u_admin_it');
  const lst = await demo('u_admin_listings');
  assert.equal((await call('POST', '/api/admin/vehicles/v1001/moderate', { token: fin, body: { action: 'flag', note: 'x' } })).status, 403);
  assert.equal((await call('GET', '/api/admin/integrations', { token: it })).status, 200);
  assert.equal((await call('GET', '/api/admin/staff', { token: it })).status, 403, 'only the MD manages staff');
  assert.equal((await call('GET', '/api/admin/banners', { token: fin })).status, 403);
  const boot = (await call('GET', '/api/bootstrap', { token: lst })).body;
  assert.equal(boot.payments.length, 0, 'listing admins see no payments');
  assert.equal(boot.session.roleName, 'Listing Administrator');
  // Refunds: finance asks, finance can't approve its own, the MD approves.
  const pay = (await call('GET', '/api/bootstrap', { token: fin })).body.payments.find((p) => p.status === 'success' && p.total > 1000);
  const rf = await call('POST', '/api/admin/approvals', { token: fin, body: { type: 'refund', paymentId: pay.id, amount: 1000, reason: 'Charged twice' } });
  assert.equal(rf.status, 201);
  assert.equal((await call('POST', `/api/admin/approvals/${rf.body.approval.id}/approve`, { token: fin, body: {} })).status, 403);
  const done = await call('POST', `/api/admin/approvals/${rf.body.approval.id}/approve`, { token: await demo('u_admin'), body: {} });
  assert.equal(done.body.approval.status, 'approved');
});

test('audit log is chained and refuses changes', async () => {
  const md = await demo('u_admin');
  const v = await call('GET', '/api/admin/audit/verify', { token: md });
  assert.equal(v.body.ok, true);
  assert.ok(v.body.checked > 0);
  const { AuditLog } = await import('../src/models/index.js');
  await assert.rejects(AuditLog.updateOne({}, { $set: { note: 'tampered' } }), /cannot be changed/);
  await assert.rejects(AuditLog.deleteMany({}), /cannot be changed/);
});

test('admin sign-in locks after repeated failures; sessions can be ended', async () => {
  for (let i = 0; i < 4; i += 1) await call('POST', '/api/auth/admin/login', { body: { email: 'it@autodealer.example', password: 'wrong' } });
  const locked = await call('POST', '/api/auth/admin/login', { body: { email: 'it@autodealer.example', password: 'wrong' } });
  assert.equal(locked.status, 423);
  const md = await demo('u_admin');
  assert.equal((await call('POST', '/api/admin/staff/u_admin_it/unlock', { token: md })).status, 200);
  const it = await demo('u_admin_it');
  assert.equal((await call('GET', '/api/admin/integrations', { token: it })).status, 200);
  await call('POST', '/api/admin/staff/u_admin_it/sessions/end', { token: md, body: {} });
  assert.equal((await call('GET', '/api/admin/integrations', { token: it })).status, 401, 'ended session refused');
});

test('dealership team member works inside the dealer account with limited permissions', async () => {
  const owner = await demo('u_dealer1');
  const add = await call('POST', '/api/team', { token: owner, body: { name: 'Musa Ally', phone: '+255 744 555 222', title: 'Sales', permissions: ['listings.create', 'listings.edit', 'enquiries.respond'] } });
  assert.equal(add.status, 201);
  const otp = await call('POST', '/api/auth/otp/request', { body: { phone: '+255 744 555 222' } });
  const signin = await call('POST', '/api/auth/otp/verify', { body: { phone: '+255 744 555 222', code: otp.body.devCode } });
  assert.equal(signin.body.user.id, 'u_dealer1', 'signs in to the dealership');
  const t = signin.body.token;
  const boot = (await call('GET', '/api/bootstrap', { token: t })).body;
  assert.equal(boot.session.member.name, 'Musa Ally');
  assert.equal((await call('POST', '/api/payments/checkout', { token: t, body: { listingId: 'v1001', planId: 'dealer-single', method: 'Card', outcome: 'success' } })).status, 403);
  assert.equal((await call('GET', '/api/team', { token: t })).status, 403, 'only the owner manages the team');
  const team = (await call('GET', '/api/team', { token: owner })).body;
  const m = team.members.find((x) => x.name === 'Musa Ally');
  await call('POST', `/api/team/${m.id}/status`, { token: owner, body: { status: 'suspended' } });
  assert.equal((await call('GET', '/api/auth/me', { token: t })).status, 401, 'paused access ends the session');
});

test('sellers run discounts that change the price and end', async () => {
  const t = await demo('u_dealer1');
  const v = (await call('GET', '/api/bootstrap', { token: t })).body.vehicles.find((x) => x.sellerId === 'u_dealer1' && x.status === 'live');
  const on = await call('POST', `/api/vehicles/${v.id}/offer`, { token: t, body: { kind: 'discount', discountType: 'percent', value: 10, label: 'Year-end deal' } });
  assert.equal(on.body.vehicle.price, v.price - Math.round(v.price * 0.1));
  assert.equal(on.body.vehicle.offer.originalPrice, v.price);
  const off = await call('DELETE', `/api/vehicles/${v.id}/offer`, { token: t });
  assert.equal(off.body.vehicle.price, v.price);
});

test('the automatic expiry ends only offers past their end date', async () => {
  // Regression: with the global strictQuery the expiry filter was dropped, so every offer ended at the next check.
  const { expireOffers } = await import('../src/services/offers.js');
  const t = await demo('u_dealer1');
  const [a, b] = (await call('GET', '/api/bootstrap', { token: t })).body.vehicles.filter((x) => x.sellerId === 'u_dealer1' && x.status === 'live');
  const later = new Date(Date.now() + 9 * 864e5).toISOString().slice(0, 10);
  await call('POST', `/api/vehicles/${a.id}/offer`, { token: t, body: { kind: 'discount', discountType: 'percent', value: 10, endsAt: later } });
  await call('POST', `/api/vehicles/${b.id}/offer`, { token: t, body: { kind: 'special', details: 'Free first service' } });
  await expireOffers();
  const after = (await call('GET', '/api/bootstrap', { token: t })).body.vehicles;
  assert.ok(after.find((x) => x.id === a.id).offer, 'an offer with a future end date stays');
  assert.ok(after.find((x) => x.id === b.id).offer, 'an offer without an end date stays');
  const { Vehicle } = await import('../src/models/index.js');
  await Vehicle.updateOne({ _id: a.id }, { $set: { 'offer.endsAt': new Date(Date.now() - 60000).toISOString() } });
  await expireOffers();
  const done = (await call('GET', '/api/bootstrap', { token: t })).body.vehicles;
  assert.equal(done.find((x) => x.id === a.id).offer, undefined, 'an offer past its end date ends');
  assert.equal(done.find((x) => x.id === a.id).price, a.price, 'and the price goes back');
  assert.ok(done.find((x) => x.id === b.id).offer, 'other offers are untouched');
});

test('dealer team activity shows only that dealership', async () => {
  const owner = await demo('u_dealer1');
  const { activity } = (await call('GET', '/api/team', { token: owner })).body;
  assert.ok(activity.length > 0);
  assert.ok(activity.every((e) => e.accountId === 'u_dealer1' || e.actorId === 'u_dealer1'), 'no other accounts’ activity');
});

test('admins manage the home page banner', async () => {
  const ops = await demo('u_admin_ops');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const add = await call('POST', '/api/admin/banners', { token: ops, body: { imageData: png, title: 'Year-end deals', ctaLabel: 'See offers', ctaLink: '/cars' } });
  assert.equal(add.status, 201);
  const pub = (await call('GET', '/api/bootstrap')).body.config.heroSlides;
  assert.ok(pub.some((h) => h.title === 'Year-end deals' && h.image));
});

test('home trust indicators are managed by content admins', async () => {
  const ops = await demo('u_admin_ops');
  const list = [
    { text: 'Direct seller contact', icon: 'badge-check' },
    { text: 'Help 7 days a week', icon: 'headset', link: '/support' },
    { text: 'No middleman', icon: 'star', enabled: false },
  ];
  const saved = await call('PATCH', '/api/admin/config', { token: ops, body: { trustIndicators: list } });
  assert.equal(saved.status, 200);
  const pub = (await call('GET', '/api/bootstrap')).body.config.trustIndicators;
  assert.deepEqual(pub.map((t) => t.text), ['Direct seller contact', 'Help 7 days a week'], 'only switched-on ones are public');
  assert.equal(pub[1].link, '/support');
  assert.equal((await call('PATCH', '/api/admin/config', { token: ops, body: { trustIndicators: Array.from({ length: 7 }, (_, i) => ({ text: `Item ${i}` })) } })).status, 400);
  assert.equal((await call('PATCH', '/api/admin/config', { token: ops, body: { trustIndicators: [{ text: 'Hi there', link: 'javascript:alert(1)' }] } })).status, 400);
  assert.equal((await call('PATCH', '/api/admin/config', { token: await demo('u_admin_finance'), body: { trustIndicators: [] } })).status, 400, 'finance cannot change website content');
});

test('banner heading (colours, line breaks) and Sell button are managed by content admins', async () => {
  const ops = await demo('u_admin_ops');
  const heading = [{ text: 'Black Friday', color: '#f8d000' }, { text: ' deals\nUp to ' }, { text: '20% off', color: '#E8201C' }];
  const r = await call('PATCH', '/api/admin/config', { token: ops, body: { heroHeading: heading, heroSellButton: { enabled: true, label: 'List your vehicle', action: 'register' } } });
  assert.equal(r.status, 200);
  const pub = (await call('GET', '/api/bootstrap')).body.config;
  assert.deepEqual(pub.heroHeading, [{ text: 'Black Friday', color: '#F8D000' }, { text: ' deals\nUp to ' }, { text: '20% off', color: '#E8201C' }]);
  assert.deepEqual(pub.heroSellButton, { enabled: true, label: 'List your vehicle', action: 'register', link: '' });
  // markup stays text, invalid colours are dropped
  const odd = await call('PATCH', '/api/admin/config', { token: ops, body: { heroHeading: [{ text: '<b>Hi</b>', color: 'red;x:y' }] } });
  assert.deepEqual(odd.body.config.heroHeading, [{ text: '<b>Hi</b>' }]);
  // limits and links
  assert.equal((await call('PATCH', '/api/admin/config', { token: ops, body: { heroHeading: [{ text: 'a\nb\nc\nd\ne' }] } })).status, 400);
  assert.equal((await call('PATCH', '/api/admin/config', { token: ops, body: { heroHeading: [] } })).status, 400);
  assert.equal((await call('PATCH', '/api/admin/config', { token: ops, body: { heroSellButton: { enabled: true, label: 'Sell', action: 'link', link: 'javascript:alert(1)' } } })).status, 400);
  const hidden = await call('PATCH', '/api/admin/config', { token: ops, body: { heroSellButton: { enabled: false, label: '', action: 'smart' } } });
  assert.equal(hidden.body.config.heroSellButton.enabled, false);
  assert.equal((await call('PATCH', '/api/admin/config', { token: await demo('u_admin_finance'), body: { heroSellButton: { enabled: true, label: 'Sell now', action: 'smart' } } })).status, 400);
});

test('agents can have a team; members see only what they are allowed', async () => {
  const owner = await demo('u_agent1');
  const add = await call('POST', '/api/team', { token: owner, body: { name: 'Baraka Mollel', phone: '+255 713 400 199', title: 'Listings assistant', permissions: ['listings.create', 'listings.edit'] } });
  assert.equal(add.status, 201);
  const m = add.body.members.find((x) => x.name === 'Baraka Mollel');
  // dealers can't hand out the agent-only handover permission
  const dealer = await demo('u_dealer1');
  assert.equal((await call('POST', '/api/team', { token: dealer, body: { name: 'Test Person', phone: '+255 713 400 198', permissions: ['handovers.manage'] } })).status, 400);
  assert.equal((await call('POST', '/api/auth/phone-status', { body: { phone: '+255 713 400 199' } })).body.role, 'agent');
  const mt = await demo('u_agent1', m.id);
  const bs = (await call('GET', '/api/bootstrap', { token: mt })).body;
  assert.equal(bs.session.member.name, 'Baraka Mollel');
  assert.deepEqual([bs.enquiries.length, bs.payments.length, bs.documents.length, bs.handovers.length], [0, 0, 0, 0], 'no enquiries, payments, documents or handovers');
  assert.ok(!bs.users.find((u) => u.id === 'u_agent1').email, "owner's email is not shared");
  assert.equal((await call('GET', '/api/team', { token: mt })).status, 403, 'members cannot manage the team');
  assert.equal((await call('GET', '/api/handovers', { token: mt })).status, 403, 'no handover access without the permission');
  // the seeded field agent may track handovers
  assert.notEqual((await call('GET', '/api/handovers', { token: await demo('u_agent1', 'tm_demo_agent') })).status, 403);
});

test('lenders set their own eligibility criteria and only receive matching enquiries', async () => {
  const bank = await demo('u_bank_lp2');
  const saved = await call('PUT', '/api/lenders/lp2/criteria', { token: bank, body: { criteria: { maxVehicleAge: 8, categories: ['car'], minDownPct: 20, maxTenureMonths: 48 } } });
  assert.equal(saved.status, 200);
  const pub = (await call('GET', '/api/bootstrap')).body.config.loanProviders.find((l) => l.id === 'lp2');
  assert.deepEqual([pub.criteria.maxVehicleAge, pub.criteria.categories, pub.maxFundingPct, pub.maxMonths], [8, ['car'], 80, 48]);
  assert.equal((await call('PUT', '/api/lenders/lp1/criteria', { token: bank, body: { criteria: {} } })).status, 403, "can't change another lender");
  assert.equal((await call('PUT', '/api/lenders/lp2/criteria', { token: bank, body: { criteria: { categories: ['boats'] } } })).status, 400);
  const vs = (await call('GET', '/api/bootstrap')).body.vehicles.filter((v) => v.status === 'live');
  const moto = vs.find((v) => v.category === 'motorcycle');
  const car = vs.find((v) => (v.category || 'car') === 'car' && new Date().getFullYear() - v.year <= 8);
  const enquiry = (v, extra) => ({ vehicleId: v.id, lenderId: 'lp2', price: v.price, downPayment: Math.round(v.price * 0.3), ratePct: 36, months: 36, buyerName: 'Test Buyer', buyerPhone: '+255 712 000 111', city: 'Arusha', employment: 'Salaried', consent: true, ...extra });
  const no = await call('POST', '/api/finance-enquiries', { body: enquiry(moto) });
  assert.equal(no.status, 400);
  assert.match(no.body.error, /doesn't finance Motorcycles|doesn't finance motorcycle/i);
  assert.equal((await call('POST', '/api/finance-enquiries', { body: enquiry(car, { downPayment: Math.round(car.price * 0.1) }) })).status, 400, 'below the minimum down payment');
  assert.equal((await call('POST', '/api/finance-enquiries', { body: enquiry(car, { months: 60 }) })).status, 400, 'longer than the longest loan');
  assert.equal((await call('POST', '/api/finance-enquiries', { body: enquiry(car) })).status, 201, 'a matching enquiry (36% rate) goes through');
});

test('business logos: owners, lender staff and admins only; PNG/JPG/WebP only', async () => {
  // 1×1 transparent PNG
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const dealer = await demo('u_dealer1');
  const up = await call('PUT', '/api/me/logo', { token: dealer, body: { imageData: png } });
  assert.equal(up.status, 200);
  assert.match(up.body.user.logo, /logos\//);
  const pub = (await call('GET', '/api/bootstrap')).body.users.find((u) => u.id === 'u_dealer1');
  assert.equal(pub.logo, up.body.user.logo, 'the logo is public on the dealer profile');
  assert.equal((await call('PUT', '/api/me/logo', { token: await demo('u_dealer1', 'tm_demo_dealer'), body: { imageData: png } })).status, 403, 'team members cannot change it');
  assert.equal((await call('PUT', '/api/me/logo', { token: await demo('u_buyer1'), body: { imageData: png } })).status, 403, 'buyers have no logo');
  assert.equal((await call('PUT', '/api/me/logo', { token: dealer, body: { imageData: 'data:image/svg+xml;base64,PHN2Zy8+' } })).status, 400, 'no SVG');
  assert.equal((await call('PUT', '/api/admin/users/u_agent1/logo', { token: await demo('u_admin_ops'), body: { imageData: png } })).status, 200, 'operations can set it');
  assert.equal((await call('PUT', '/api/admin/users/u_agent1/logo', { token: await demo('u_admin_finance'), body: { imageData: png } })).status, 403);
  assert.equal((await call('DELETE', '/api/me/logo', { token: dealer })).status, 200);
  assert.equal((await call('GET', '/api/bootstrap')).body.users.find((u) => u.id === 'u_dealer1').logo, undefined, 'removed');
  // lenders
  const bank = await demo('u_bank_lp2');
  const lp = await call('PUT', '/api/lenders/lp2/logo', { token: bank, body: { imageData: png } });
  assert.equal(lp.status, 200);
  assert.match(lp.body.config.loanProviders.find((l) => l.id === 'lp2').logo, /logos\//);
  assert.equal((await call('PUT', '/api/lenders/lp1/logo', { token: bank, body: { imageData: png } })).status, 403, 'not another lender');
});

test('lender criteria can be limited to seller types', async () => {
  const fin = await demo('u_admin_finance');
  assert.equal((await call('PUT', '/api/lenders/lp1/criteria', { token: fin, body: { criteria: { sellerTypes: ['dealer'] } } })).status, 200);
  assert.equal((await call('PUT', '/api/lenders/lp1/criteria', { token: fin, body: { criteria: { sellerTypes: ['bank'] } } })).status, 400);
  const v = (await call('GET', '/api/bootstrap')).body.vehicles.find((x) => x.status === 'live' && x.sellerRole === 'seller');
  const r = await call('POST', '/api/finance-enquiries', { body: { vehicleId: v.id, lenderId: 'lp1', price: v.price, downPayment: Math.round(v.price * 0.4), ratePct: 18, months: 36, buyerName: 'Test Buyer', buyerPhone: '+255 712 000 111', city: 'Arusha', employment: 'Salaried', consent: true } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /registered dealers/);
  await call('PUT', '/api/lenders/lp1/criteria', { token: fin, body: { criteria: {} } });
});

test('brand logos are managed by content admins and published to the website', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const ops = await demo('u_admin_ops');
  const up = await call('PUT', '/api/admin/brand-logos/Royal%20Enfield', { token: ops, body: { imageData: png } });
  assert.equal(up.status, 200);
  const pub = (await call('GET', '/api/bootstrap')).body.config.brandLogos;
  assert.match(pub['Royal Enfield'], /photos\/brands\//, 'public as a link');
  assert.equal((await call('PUT', '/api/admin/brand-logos/Yamaha', { token: await demo('u_admin_finance'), body: { imageData: png } })).status, 403);
  assert.equal((await call('PUT', '/api/admin/brand-logos/Yamaha', { token: ops, body: { imageData: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' } })).status, 400);
  assert.equal((await call('DELETE', '/api/admin/brand-logos/Royal%20Enfield', { token: ops })).status, 200);
  assert.equal((await call('GET', '/api/bootstrap')).body.config.brandLogos['Royal Enfield'], undefined);
  assert.equal((await call('DELETE', '/api/admin/brand-logos/Yamaha', { token: ops })).status, 404);
});

test('popular categories are managed by content admins', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const ops = await demo('u_admin_ops');
  const before = (await call('GET', '/api/bootstrap')).body.config.popularCategories;
  assert.equal(before.tiles[0].image, '/suv2.jpg', 'defaults use the built-in photos');
  assert.equal((await call('PUT', '/api/admin/popular-categories/title', { token: ops, body: { title: 'Browse by type' } })).status, 200);
  const add = await call('POST', '/api/admin/popular-categories', { token: ops, body: { label: 'Tipper trucks', category: 'lorry', body: 'Tipper', minPrice: '50,000,000', imageData: png } });
  assert.equal(add.status, 201);
  const tile = add.body.section.tiles.at(-1);
  assert.equal(tile.minPrice, 50000000, 'commas are accepted');
  assert.match(tile.image, /photos\/categories\//);
  assert.equal((await call('PATCH', `/api/admin/popular-categories/${tile.id}`, { token: ops, body: { enabled: false } })).status, 200);
  let pub = (await call('GET', '/api/bootstrap')).body.config.popularCategories;
  assert.equal(pub.title, 'Browse by type');
  assert.ok(!pub.tiles.some((t) => t.id === tile.id), 'hidden tiles are not public');
  const ids = [tile.id, ...before.tiles.map((t) => t.id)];
  assert.equal((await call('POST', '/api/admin/popular-categories/reorder', { token: ops, body: { ids } })).body.section.tiles[0].id, tile.id);
  assert.equal((await call('POST', '/api/admin/popular-categories', { token: ops, body: { label: 'Boats', category: 'boat', imageData: png } })).status, 400);
  assert.equal((await call('POST', '/api/admin/popular-categories', { token: ops, body: { label: 'No photo', category: 'car' } })).status, 400);
  assert.equal((await call('PUT', '/api/admin/popular-categories/title', { token: await demo('u_admin_finance'), body: { title: 'Nope nope' } })).status, 403);
  assert.equal((await call('DELETE', `/api/admin/popular-categories/${tile.id}`, { token: ops })).status, 200);
  await call('PUT', '/api/admin/popular-categories/title', { token: ops, body: { title: 'Popular car categories' } });
});
