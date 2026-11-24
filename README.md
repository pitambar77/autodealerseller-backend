# AutoDealer API

REST API for the AutoDealer marketplace website (`autodealer-web`). It uses Node.js, Express and MongoDB (Mongoose).

It covers every screen of the site: phone sign-in with one-time codes, registration for dealers, private sellers, agents and buyers, and listings in vehicle categories that admins manage themselves (cars, motorcycles & scooters, buses & minibuses, trucks & trailers, construction & heavy machinery, and farm & agricultural machinery to start with). It also handles duplicate checks, listing fees, enquiries, finance enquiries sent to partner banks, verification documents, agent handovers, buyer tools, the admin console and the bank lead desk.

## Run it locally

Requirements: Node.js 18.18 or newer, and MongoDB 6 or newer (local, Docker or MongoDB Atlas).

```bash
cp .env.example .env          # then edit MONGODB_URI and JWT_SECRET
npm install
npm run seed                  # loads the demo marketplace; prints the admin sign-in details
npm run dev                   # http://localhost:4000
```

Check it's running at `http://localhost:4000/api/health`.

The seed script prints:

- The admin email and password, plus an **authenticator key**. Add the key to Google Authenticator, Microsoft Authenticator or Authy by hand. The admin console asks for its 6-digit code.
- A ready-made admin invitation code (`AD-ADMIN-2026` for `new.admin@autodealer.example`) for trying `/admin/invite`.
- The phone numbers of the demo dealer, seller, agent, buyer and the two partner-bank lead desks.

Other scripts:

| Command | What it does |
|---|---|
| `npm run seed:fresh` | Deletes **all** data and loads the demo data again |
| `npm run create-admin -- --email you@company.com --name "Your Name" --phone "+255 712 345 678" --password "S3cure#Password!"` | Creates or resets an admin and prints its authenticator key (`--no-2fa` to skip) |
| `npm run close-accounts` | Closes accounts whose owners asked for closure more than 7 days ago. Schedule it daily. |
| `npm run check:services` | Checks storage, SMS, email and Redis from `.env` (`-- --sms +255… --email you@…` sends test messages) |
| `npm test` | End-to-end API tests (uses and wipes the `autodealer_test` database) |

**Setting up Cloudinary, SMS, email and live updates: see [SETUP.md](SETUP.md).**

## Admin roles, approvals, audit trail and backups

- **[SECURITY.md](SECURITY.md)** covers the five admin roles (Managing Director, Operations, Listings, Finance, IT) and their permissions, individual staff accounts with required 2-step verification, maker-checker approvals, the tamper-evident audit trail, sign-in lockout and idle sign-out, and dealership team accounts.
- **[BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md)** covers automatic encrypted backups, off-site copies and the restore procedure:
  - `npm run backup` makes a backup now;
  - `npm run restore -- <file>` checks a file, and adding `--yes` restores it.

The seed creates one demo account per role: `admin@` (MD), `ops@`, `listings@`, `finance@` and `it@autodealer.example`. They share the demo password and 2-step key printed by `npm run seed`.

## Configuration (.env)

All settings are listed in `.env.example`. The important ones:

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | Your MongoDB connection string (Atlas: `mongodb+srv://…`) |
| `JWT_SECRET` | Long random string. Required in production. |
| `PUBLIC_URL` | Public address of this API (used for photo and document links) |
| `CORS_ORIGINS` | The website's address(es), comma separated |
| `STORAGE_DRIVER` | `local` (files in `uploads/`) or `cloudinary` (with `CLOUDINARY_URL`) |
| `SMS_PROVIDER` | `console` (development: messages are printed and the code is shown on screen), `beem`, `africastalking` or `twilio` |
| `EMAIL_PROVIDER` | `console` or `smtp` (with `SMTP_*`) |
| `REDIS_URL` | Only when running several API servers (live updates go through Redis) |
| `PAYMENT_PROVIDER` | `mock` (test payments with a chosen result). See *Plugging in a payment gateway* below. |
| `VEHICLE_LOOKUP_PROVIDER` | `none` (sellers type the vehicle details), `mock` (sample records for demos) or `tra` (TRA API, with `TRA_API_URL` and `TRA_API_KEY`) |
| `ALLOW_DEMO_LOGIN` / `ALLOW_DEMO_RESET` | Development only: the "All screens" navigator and "Reset demo data". **Keep both off in production.** |

## What is real and what you plug in

| Area | Status |
|---|---|
| Accounts, roles, sessions (JWT), admin password + two-step (TOTP), admin invitations | Ready |
| Phone one-time codes | Ready. Codes are hashed, expire after 10 minutes and lock after 5 wrong tries. SMS goes through Beem Africa, Africa's Talking or Twilio (see SETUP.md). |
| Buyer–seller chat | Ready. Every enquiry is a conversation. Sellers reply from their inbox; signed-in buyers reply from **Messages**; guest buyers get an SMS with a private link to the conversation. "Seen" receipts, unread counts. |
| Live updates | Ready. New enquiries, messages, notifications and listing changes reach open pages instantly (Server-Sent Events, `GET /api/events`; Redis for several servers). |
| Saved-vehicle alerts | Ready. Buyers who saved a vehicle are notified when its price changes, it's updated, sold or taken down (and emailed about price drops). |
| Featured listings | Ready. Featured plans for private sellers, agents and dealers, a "Feature this listing" boost for live listings (`featuredDays`, default 7), and admin feature/stop featuring. |
| Listings, duplicate detection, listing limits (private sellers can list several; admins can set a limit), listing fees, publishing on payment | Ready |
| Photos and documents | Ready. `STORAGE_DRIVER=local` (disk) or `cloudinary`. Photos are public (Cloudinary CDN). Documents are private (Cloudinary "authenticated" assets) and reached only through API links that expire. |
| Payments | `mock` gateway built in. A real gateway (Selcom, Flutterwave, DPO, Stripe…) goes in `src/services/payments.js` → `startCheckout()`. Its webhook calls `settlePayment()` through `POST /api/payments/webhook`, which already checks an HMAC signature. |
| Vehicle details lookup (TRA) | The listing form starts with registration number, VIN and engine number, then offers **Look up details**. Until TRA access is approved, keep `VEHICLE_LOOKUP_PROVIDER=none` (or `mock` for demos). Sellers then enter the details themselves. To connect TRA, set `tra` plus the URL and key, and map TRA's response fields in `fromTra()` in `src/services/vehicleLookup.js`. Sellers always review a record before it fills the form. |
| Emails | Ready with any SMTP service (`EMAIL_PROVIDER=smtp`): new enquiries, replies, saved-vehicle price drops. |

## API overview

Every endpoint is under `/api`. Send `Authorization: Bearer <token>` once signed in. Errors look like `{ "error": "message", "details": {…} }`.

**Bootstrap and system**
- `GET /bootstrap`: everything the visitor's pages need, scoped to who they are (guest, user, partner bank, admin)
- `GET /health`
- `POST /demo/reset`: development only

**Sign-in and accounts**
- `POST /auth/phone-status`: whether a number is registered
- `POST /auth/otp/request`, `POST /auth/otp/verify`: a registered number signs in; a new number gets a `registrationToken`
- `POST /auth/register`: `{ registrationToken, role, name, …profile }` → `{ token, user }`
- `POST /auth/admin/login`: `{ email, password, totp? }` → `{ needsTotp }` or `{ token, user }`
- `POST /auth/admin/invite/check`, `POST /auth/admin/invite/accept`
- `GET /auth/me`, `POST /auth/demo-login` (development only)
- `PATCH /me` (profile), `POST /me/phone` (change number with a code), `POST /me/sessions/revoke` (sign out other devices), `POST /me/close`
- `POST /me/saved/:vehicleId/toggle`, `POST /me/saved/merge`, `POST /me/saved-searches`, `DELETE /me/saved-searches/:id`, `PATCH /me/prefs`, `POST /me/notifications/read`

**Live updates**
- `GET /events`: Server-Sent Events stream. Signed-in users get their own events (`enquiry`, `message`, `read`, `notification`, `vehicle`); add `?enquiry=<id>&key=<access key>` to follow a guest conversation. Everyone gets public `vehicle` changes.

**Listings**
- `GET /vehicles?category=&make=&body=&fuel=&minPrice=&maxPrice=&city=&q=&sort=&page=&limit=`: search live listings
- `GET /vehicles/:id`, `POST /vehicles/:id/view`
- `POST /vehicles/duplicate-check`: `{ regNumber, vin, excludeId? }`
- `GET /vehicles/lookup?reg=&vin=`: sellers only; registry details → `{ status: found | not_found | unavailable, source, vehicle }`
- `POST /vehicles` (create draft), `PATCH /vehicles/:id`, `DELETE /vehicles/:id`
- `POST /vehicles/:id/submit`: checks details, required documents and duplicates → `pending_payment`, `live` (already paid) or `blocked_duplicate`
- `POST /vehicles/:id/status`: `sold` | `draft` | `expired`

**Payments**
- `POST /payments/checkout`: `{ listingId, planId, method, outcome? }`; `outcome` is only used by the mock gateway. `planId: "feature-boost"` features a live listing.
- `POST /payments/:id/resolve`: settle a pending payment (admins, or the payer in mock mode)
- `POST /payments/webhook`: for your gateway

**Enquiries, finance and banks**
- `POST /enquiries` (guests allowed) → `{ enquiry, accessKey, conversationPath }`. The access key lets a guest reopen the conversation.
- `GET /enquiries/:id[?key=]`: the conversation with its listing and seller (seller, the buyer, or a guest with the key)
- `POST /enquiries/:id/messages` `{ text, key? }`: send a message (seller or buyer)
- `POST /enquiries/:id/read` `{ key? }`: mark read (shows "Seen" to the other side)
- `PATCH /enquiries/:id`: status (`new`, `contacted`, `negotiating`, `closed`, `lost`, `spam`)
- `POST /finance-enquiries`: notifies the dealer and the chosen partner bank. Returns an `accessKey` for the customer's tracking link.
- `GET /finance-enquiries/:id?key=`
- `POST /referrals/:id/status`: the partner bank (or an admin) moves a lead on; the dealer is notified

**Documents**
- `POST /documents`: `{ type, label, fileName, size, data: <data URL>, maskedNumber? }`
- `DELETE /documents/:id`
- `POST /documents/:id/review`: admin; `verified` | `rejected` | `flagged`

**Agents**
- `POST /handovers/ensure`, `PATCH /handovers/:id` (buyer name), `PATCH /handovers/:id/steps/:key`

**Admin**
- `POST /admin/users/:id/status`: suspending a user hides their live listings; reactivating restores them
- `POST /admin/vehicles/:id/moderate`: flag, suspend, remove, restore, verify, unverify, keepBlocked, releaseDuplicate, feature, unfeature
- `GET/POST /admin/loan-providers`, `PATCH/DELETE /admin/loan-providers/:id`: lenders on the loan calculator (rate, fees, eligibility, documents, contact desk, commission, API key). `loginPhone` creates the bank staff sign-in for the lead desk. Lenders with finance enquiries can only be switched off.
- `POST /admin/cities/:city/image` `{ imageData | null }`: city photo for the Dealers page
- `GET /admin/integrations`, `POST /admin/integrations/test` `{ service: sms | email | storage, to }`: connected services and test messages
- `POST /admin/vehicles/:id/notes`, `PATCH /admin/config`, `POST /admin/invites`, `GET /admin/audit`

**Vehicle categories (admin)**
- `GET /admin/categories`: `{ categories, counts }`; counts are `{ key: { total, live } }`
- `POST /admin/categories`: add a category (see the fields below). It goes last in the order.
- `PATCH /admin/categories/:key`: change any field. A new `slug` keeps the old one in `aliases`, so old links redirect. `{ enabled: false }` hides the category and its listings from the public site.
- `POST /admin/categories/reorder`: `{ keys: [...] }` in display order
- `DELETE /admin/categories/:key`: `{ moveTo }` is required when listings use it. The listings move, and the removed category's addresses redirect to the new one. The last category can't be removed.

**Support**
- `POST /support`: Support page messages
- `GET /support`: admin

## Vehicle categories

Categories live in the `categories` collection and are managed in the admin dashboard (Admin → Vehicle categories), so the business can add, rename, hide, reorder or remove them without code changes. On first start the API creates six: Cars, Motorcycles & Scooters, Buses & Minibuses, Trucks & Trailers (formerly Lorries; `/lorries` still redirects), Construction & Heavy Machinery, and Farm & Agricultural Machinery (including tractors). The defaults are in `src/shared/categories.js`.

Each category has a permanent `key`, which is stored on listings (`vehicle.category`) and never changes, plus these editable fields:

| Field | What it controls |
| --- | --- |
| `name`, `singular`, `nounPlural`, `tagline` | Menu and page wording ("Trucks & Trailers", "Truck type", "24 trucks found") |
| `slug`, `aliases` | Web address (`/trucks-trailers`); old addresses redirect |
| `icon`, `art`, `image` | Menu icon, the illustration used when a listing has no photos, and the home-page picture |
| `typeLabel`, `types` | The type list sellers choose from and buyers filter by (Tipper, Tanker, Tractor…) |
| `fuels`, `transmissions` | Choices in the listing form |
| `usage`, `maxUsage`, `usageSteps` | Usage measured in `km` (odometer) or `hours` (hour meter), its limit and the filter steps |
| `minPrice`, `priceSteps` | Minimum price and the budget filter steps |
| `specFields` | Which specifications sellers fill in, in order: `[{ key, required, filter }]`. The first two show on listing cards. Keys are listed in `SPEC_FIELD_KEYS` (engine size, power, seats, payload, axle, operating weight, bucket capacity, lifting capacity, drive, PTO power and more) |
| `features`, `makes` | Feature checkboxes and the suggested brands (sellers can also type any brand) |
| `registryTypes` | Words in a TRA vehicle class that map a registration lookup to this category |
| `enabled`, `order` | Shown or hidden, and display order |

Listings are checked against their category when created or edited: the category must exist and be shown, and required specifications, the minimum price and the usage limit apply.

## Business rules enforced by the API

- A listing goes **live only after its fee is paid**. "Live" does not mean "verified": document verification is a separate admin step.
- A registration number or VIN can appear in only **one active listing** (live, pending payment, draft or suspended). A duplicate is blocked until an admin releases it.
- **Private sellers**, dealers and agents can all list several vehicles. Admins can cap private sellers in Admin → Configuration (`sellerListingLimit`, 0 = no limit).
- Before payment, a listing needs: dealers, a business certificate; sellers, a personal ID; agents, a personal ID, an owner authorisation (if required in settings) and the owner's details.
- Suspended users can't sign in, and their tokens stop working at once.
- Public pages never receive email addresses, tax numbers, engine numbers, owner contacts or full VINs. Provider keys in the configuration are only sent to admins.

## Deploying

Run with `NODE_ENV=production npm start` behind HTTPS (for example on Render, Railway, Fly.io or a VPS with Nginx). Use MongoDB Atlas, set `JWT_SECRET`, `PUBLIC_URL` and `CORS_ORIGINS`, and keep `ALLOW_DEMO_LOGIN` and `ALLOW_DEMO_RESET` off. Put `UPLOAD_DIR` on a persistent disk, or switch storage to S3.
