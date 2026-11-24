# Setting up AutoDealer's services

Everything here is configured in the API's `.env` file (copy `.env.example`). Restart the API after a change.

When you're done, check everything in one go:

```bash
npm run check:services                                   # status + a test upload
npm run check:services -- --sms +255712345678 --email you@yourdomain.co.tz
```

Admins can see the same status, and send a test SMS or email, in **Admin → Configuration → Connected services**.

| Service | Development | Production |
|---|---|---|
| Photos & documents | `STORAGE_DRIVER=local` (files in `uploads/`) | `STORAGE_DRIVER=cloudinary` |
| SMS (sign-in codes, enquiry alerts, replies to guests) | `SMS_PROVIDER=console` (printed in the log) | `beem`, `africastalking` or `twilio` |
| Email (enquiry alerts, replies) | `EMAIL_PROVIDER=console` (printed in the log) | `smtp` |
| Live updates (chat, notifications) | built in | built in (one server) or `REDIS_URL` (several servers) |
| Payments | `PAYMENT_PROVIDER=mock` | your gateway in `src/services/payments.js` |

---

## 1. Cloudinary (photos and documents)

1. Create an account at <https://cloudinary.com> (the free plan is enough to start).
2. In the Cloudinary console open **Dashboard** (or **Settings → API Keys**) and copy the **API environment variable**. It looks like `cloudinary://123456789012345:AbCdEf…@your-cloud-name`.
3. In `.env`:
   ```env
   STORAGE_DRIVER=cloudinary
   CLOUDINARY_URL=cloudinary://123456789012345:AbCdEf…@your-cloud-name
   CLOUDINARY_FOLDER=autodealer
   ```
   (Instead of `CLOUDINARY_URL` you can set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`.)
4. Run `npm run check:services`. It uploads and deletes a tiny test image.

How files are stored:

- **Listing photos and category pictures** are uploaded to `autodealer/photos/` as public images and served from Cloudinary's CDN with automatic format and quality (`f_auto,q_auto`), so phones get small WebP/AVIF files.
- **Identity and business documents** (IDs, business certificates, owner authorisations, ID videos) are uploaded to `autodealer/docs/` as **authenticated** assets. Cloudinary never serves them publicly. The website gets a link to the API (`/files/c/…`) that expires after a few hours; the API checks the link and fetches the file from Cloudinary with a 2-minute signed download.
- Deleting a listing photo, a document or a category picture deletes it from Cloudinary too.
- Files uploaded before you switched stay on the server's disk and keep working. To move them, upload them again from the website (or copy the `uploads/` folder to the new server).

Limits: the free Cloudinary plan accepts images up to 10 MB and videos up to 100 MB. `MAX_UPLOAD_MB` (default 50) is checked first.

## 2. SMS

The same provider sends sign-in codes and alerts:

- a seller gets an SMS when a buyer sends an enquiry or a new message (at most one SMS per conversation every `SMS_THROTTLE_MINUTES`),
- a **guest** buyer (no account) gets the seller's reply by SMS with a private link back to the conversation.

Turn alerts off with `SMS_NOTIFICATIONS=false` (codes are still sent). Sellers can switch SMS alerts off in **Account → Notifications**.

Phone numbers are sent in international format (`+255712345678`).

### Beem Africa (recommended for Tanzania)

1. Sign up at <https://beem.africa> and top up SMS credit.
2. Register a **Sender ID** (for example `AUTODEALER`). Tanzanian sender IDs need approval. Until then use the default `INFO`.
3. In **Profile → Authentication information**, create an API key and secret.
4. `.env`:
   ```env
   SMS_PROVIDER=beem
   BEEM_API_KEY=…
   BEEM_SECRET_KEY=…
   BEEM_SENDER_ID=AUTODEALER
   ```

The API posts to `https://apisms.beem.africa/v1/send` with Basic authentication (key:secret). If Beem changes its API, update `beem()` in `src/services/sms.js`.

### Africa's Talking (Kenya, Tanzania, Uganda and more)

```env
SMS_PROVIDER=africastalking
AT_USERNAME=your_app_username     # "sandbox" while testing in the simulator
AT_API_KEY=…
AT_SENDER_ID=AUTODEALER           # optional, needs approval
```

### Twilio (international)

```env
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC…
TWILIO_AUTH_TOKEN=…
TWILIO_FROM=+1…                   # a Twilio number or approved alphanumeric sender
```

## 3. Email

Any SMTP service works: Google Workspace, Zoho Mail, Amazon SES, Mailgun, SendGrid, Brevo or your hosting provider's mail server.

```env
EMAIL_PROVIDER=smtp
EMAIL_FROM=AutoDealer <no-reply@yourdomain.co.tz>
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_SECURE=false        # true for port 465
SMTP_USER=…
SMTP_PASS=…
```

Emails sent: a new enquiry to the seller, a seller's reply to the buyer, and price drops on saved vehicles (buyers who kept price alerts on). Set up SPF and DKIM for your domain with your provider, or emails may land in spam.

## 4. Live updates (chat and notifications)

Open pages keep a connection to `GET /api/events` (Server-Sent Events). New enquiries, chat messages, "seen" receipts, notifications and listing changes (price drops, sold) arrive without reloading. If the connection drops, the page reconnects by itself and catches up.

- **One API server:** nothing to set up.
- **Several API servers** (load balancer, PM2 cluster, autoscaling): set `REDIS_URL=redis://…` (for example Upstash, Redis Cloud or your own Redis). The `redis` package is installed with `npm install`.
- **Behind Nginx:** turn off buffering for the stream, and allow long-lived connections:
  ```nginx
  location /api/events {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_read_timeout 1h;
  }
  ```
  (The API also sends `X-Accel-Buffering: no` and a keep-alive every 25 seconds.)
- Hosting platforms with request time limits (some serverless hosts) close the stream; the page reconnects, but a normal Node host (Render, Railway, Fly.io, a VPS) works best.

## 5. Payments

`PAYMENT_PROVIDER=mock` simulates the gateway. To take real money, connect your gateway (Selcom, AzamPay, Pesapal, DPO, Flutterwave, Stripe…) in `src/services/payments.js`:

1. In `startCheckout()`, create the order with the gateway and return `{ status: 'pending', redirectUrl }`.
2. Point the gateway's webhook at `POST /api/payments/webhook`, and verify its signature in `src/routes/payments.js`.
3. The webhook calls `settlePayment(txnId, 'success' | 'failed')`. That function already publishes listings, starts "featured" boosts and notifies buyers, so the rules stay in one place.

## 6. Production checklist

- `NODE_ENV=production`, a long random `JWT_SECRET` and `FILE_SIGNING_SECRET` (`openssl rand -base64 48`).
- `PUBLIC_URL` = the API's public https address; `WEB_URL` and `CORS_ORIGINS` = the website's address (links in SMS and emails use `WEB_URL`).
- `ALLOW_DEMO_LOGIN=false` and `ALLOW_DEMO_RESET=false`.
- `STORAGE_DRIVER=cloudinary`, a real `SMS_PROVIDER`, `EMAIL_PROVIDER=smtp`.
- `npm run check:services` passes.
- Schedule `npm run close-accounts` daily.
