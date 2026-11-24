// Email: enquiry alerts and replies. EMAIL_PROVIDER=smtp works with any SMTP service
// (Gmail / Google Workspace, Zoho Mail, Amazon SES, Mailgun, SendGrid, Brevo, your host's mail server).
// EMAIL_PROVIDER=console prints emails in the server log.
// Check your setup with: npm run check:services -- --email you@example.com
import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transport = null;
function smtp() {
  if (!transport) {
    const { host, port, secure, user, pass } = config.email.smtp;
    if (!host) throw new Error('Set SMTP_HOST (and SMTP_USER / SMTP_PASS) for EMAIL_PROVIDER=smtp.');
    transport = nodemailer.createTransport({ host, port, secure, auth: user ? { user, pass } : undefined });
  }
  return transport;
}

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Simple branded HTML around a message and an optional button. */
export function emailHtml({ heading, lines = [], button }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f2;font-family:Arial,Helvetica,sans-serif;color:#1d1d1b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
  <tr><td style="background:#111827;padding:16px 24px;color:#ffffff;font-size:18px;font-weight:bold">Auto<span style="color:#E11D2E">Dealer</span></td></tr>
  <tr><td style="padding:24px">
    <h1 style="margin:0 0 12px;font-size:20px">${esc(heading)}</h1>
    ${lines.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;white-space:pre-line">${esc(l)}</p>`).join('')}
    ${button ? `<p style="margin:20px 0 0"><a href="${esc(button.url)}" style="display:inline-block;background:#E11D2E;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px">${esc(button.label)}</a></p>` : ''}
  </td></tr>
  <tr><td style="padding:16px 24px;border-top:1px solid #eee;font-size:12px;color:#777">You get this email because of activity on your AutoDealer account. Change alerts in Account → Notifications.</td></tr>
  </table></td></tr></table></body></html>`;
}

/** Send an email. Returns true if it went to a real server. */
export async function sendEmail({ to, subject, text, html }) {
  if (config.email.provider === 'smtp') {
    await smtp().sendMail({ from: config.email.from, to, subject, text, html });
    return true;
  }
  console.log(`[email] to ${to}: ${subject}\n${text}`);
  return false;
}

/** Alerts: never throws. */
export async function sendEmailAlert(to, { subject, heading, lines, button }) {
  if (!to) return false;
  try {
    const text = [heading, ...(lines || []), button ? `${button.label}: ${button.url}` : ''].filter(Boolean).join('\n\n');
    return await sendEmail({ to, subject, text, html: emailHtml({ heading, lines, button }) });
  } catch (e) {
    console.error('[email] alert not sent:', e.message);
    return false;
  }
}

export async function verifyEmail() {
  if (config.email.provider !== 'smtp') return 'console';
  await smtp().verify();
  return 'smtp';
}

export const emailStatus = () => ({ provider: config.email.provider, from: config.email.from, ready: config.email.provider === 'console' || !!config.email.smtp.host });
