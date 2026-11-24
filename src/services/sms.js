// Text messages: sign-in codes, enquiry alerts and replies to guest buyers.
// Choose the provider with SMS_PROVIDER (OTP_PROVIDER still works):
//   console        prints messages in the server log (development only)
//   beem           Beem Africa (Tanzania)            BEEM_API_KEY, BEEM_SECRET_KEY, BEEM_SENDER_ID
//   africastalking Africa's Talking (East Africa)    AT_USERNAME, AT_API_KEY, AT_SENDER_ID
//   twilio         Twilio (international)           TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
// Check your setup with: npm run check:services -- --sms +2557XXXXXXXX
import { config, isProd } from '../config.js';

/** International format without spaces: "+255712345678". */
export const toE164 = (phone = '') => {
  const p = String(phone).replace(/[^\d+]/g, '');
  return p.startsWith('+') ? p : `+${p}`;
};

async function beem(to, text) {
  const { apiKey, secretKey, senderId } = config.sms.beem;
  if (!apiKey || !secretKey) throw new Error('Set BEEM_API_KEY and BEEM_SECRET_KEY.');
  const res = await fetch('https://apisms.beem.africa/v1/send', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString('base64')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_addr: senderId,
      schedule_time: '',
      encoding: 0,
      message: text,
      recipients: [{ recipient_id: 1, dest_addr: to.replace(/^\+/, '') }],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.successful === false) throw new Error(`Beem error ${res.status}: ${body.message || body.data?.message || 'not sent'}`);
}

async function twilio(to, text) {
  const { sid, token, from } = config.otp.twilio;
  if (!sid || !token || !from) throw new Error('Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM.');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: from, Body: text }),
  });
  if (!res.ok) throw new Error(`Twilio error ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function africastalking(to, text) {
  const { username, apiKey, from } = config.otp.africastalking;
  if (!username || !apiKey) throw new Error('Set AT_USERNAME and AT_API_KEY.');
  const host = username === 'sandbox' ? 'api.sandbox.africastalking.com' : 'api.africastalking.com';
  const res = await fetch(`https://${host}/version1/messaging`, {
    method: 'POST',
    headers: { apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, to, message: text, ...(from ? { from } : {}) }),
  });
  if (!res.ok) throw new Error(`Africa's Talking error ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const PROVIDERS = { beem, twilio, africastalking };

/** Send an SMS. Returns true if it went to a real provider, false for the console provider. */
export async function sendSms(phone, text) {
  const to = toE164(phone);
  const send = PROVIDERS[config.sms.provider];
  if (send) {
    await send(to, text);
    return true;
  }
  if (isProd) throw new Error('SMS_PROVIDER=console is not allowed in production. Choose beem, africastalking or twilio.');
  console.log(`[sms] to ${to}: ${text}`);
  return false;
}

/** Alerts (not sign-in codes): never throws, respects SMS_NOTIFICATIONS. */
export async function sendSmsAlert(phone, text) {
  if (!config.sms.notifications || !phone) return false;
  try {
    return await sendSms(phone, text.length > 300 ? `${text.slice(0, 297)}…` : text);
  } catch (e) {
    console.error('[sms] alert not sent:', e.message);
    return false;
  }
}

export const smsStatus = () => ({ provider: config.sms.provider, notifications: config.sms.notifications, ready: config.sms.provider === 'console' ? !isProd : true });
