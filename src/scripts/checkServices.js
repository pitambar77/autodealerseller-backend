// Check the services in .env before going live.
//   npm run check:services                       status of every service, plus a test upload
//   npm run check:services -- --sms +2557XXXXXXX  also send a test SMS
//   npm run check:services -- --email you@x.com   also send a test email
import { config } from '../config.js';
import { sendSms, smsStatus } from '../services/sms.js';
import { emailHtml, emailStatus, sendEmail, verifyEmail } from '../services/email.js';
import { storageStatus, testStorage } from '../services/storage.js';

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
let failed = 0;
const ok = (label, detail) => console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
const warn = (label, detail) => console.log(`  ! ${label}${detail ? ` — ${detail}` : ''}`);
const bad = (label, e) => {
  failed += 1;
  console.log(`  ✗ ${label} — ${e.message || e}`);
};

console.log(`\nAutoDealer services (${config.env})\n`);

// Storage
const st = storageStatus();
console.log(`Files: ${st.driver}${st.cloud ? ` (cloud "${st.cloud}", folder "${st.folder}")` : ''}`);
try {
  const t = await testStorage();
  ok('upload and delete a test image', t.url);
} catch (e) {
  bad('test upload', e);
}

// SMS
const sms = smsStatus();
console.log(`\nSMS: ${sms.provider}${sms.notifications ? ' (codes + alerts)' : ' (codes only)'}`);
if (sms.provider === 'console') warn('not connected', 'messages are printed in the log. Set SMS_PROVIDER=beem | africastalking | twilio');
const smsTo = arg('sms');
if (smsTo) {
  try {
    const real = await sendSms(smsTo, 'AutoDealer test: SMS is set up correctly.');
    ok(real ? `test SMS sent to ${smsTo}` : 'test SMS printed (console provider)');
  } catch (e) {
    bad('test SMS', e);
  }
} else if (sms.provider !== 'console') {
  console.log('  (add --sms +2557XXXXXXXX to send a test message)');
}

// Email
const em = emailStatus();
console.log(`\nEmail: ${em.provider} from ${em.from}`);
if (em.provider === 'console') warn('not connected', 'emails are printed in the log. Set EMAIL_PROVIDER=smtp and SMTP_*');
else {
  try {
    await verifyEmail();
    ok(`SMTP login to ${config.email.smtp.host}`);
  } catch (e) {
    bad('SMTP login', e);
  }
}
const emailTo = arg('email');
if (emailTo) {
  try {
    const real = await sendEmail({ to: emailTo, subject: 'AutoDealer test email', text: 'Email is set up correctly.', html: emailHtml({ heading: 'Email is set up correctly', lines: ['Sent by npm run check:services.'] }) });
    ok(real ? `test email sent to ${emailTo}` : 'test email printed (console provider)');
  } catch (e) {
    bad('test email', e);
  }
}

// Live updates
console.log(`\nLive updates: ${config.realtime.redisUrl ? 'Redis' : 'built in (one API server)'}`);
if (config.realtime.redisUrl) {
  try {
    const { createClient } = await import('redis');
    const c = createClient({ url: config.realtime.redisUrl });
    await c.connect();
    ok(`Redis replied ${await c.ping()}`);
    await c.quit();
  } catch (e) {
    bad('Redis', e);
  }
}

// Payments
console.log(`\nPayments: ${config.payments.provider}`);
if (config.payments.provider === 'mock') warn('simulated', 'connect your gateway in src/services/payments.js before taking real money');

console.log(failed ? `\n${failed} check(s) failed.\n` : '\nAll checks passed.\n');
process.exit(failed ? 1 : 0);
