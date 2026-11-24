import crypto from 'node:crypto';
import { config, isProd } from '../config.js';
import { Otp } from '../models/index.js';
import { phoneKey, sha256 } from '../lib/ids.js';
import { badRequest, HttpError } from '../lib/http.js';
import { sendSms } from './sms.js';

const hash = (key, code) => sha256(`${key}:${code}:${config.jwtSecret}`);

/** Create and send a 6-digit code. In development the code is returned so the UI can show it. */
export async function issueOtp(phone) {
  const key = phoneKey(phone);
  const recent = await Otp.findById(key);
  if (recent && Date.now() - new Date(recent.createdAt).getTime() < 25 * 1000) {
    throw new HttpError(429, 'Please wait a few seconds before asking for another code.');
  }
  const code = !isProd && config.otp.devCode ? config.otp.devCode : String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  await Otp.findByIdAndUpdate(
    key,
    { _id: key, phoneKey: key, codeHash: hash(key, code), attempts: 0, createdAt: new Date(), expiresAt: new Date(Date.now() + config.otp.ttlMinutes * 60000) },
    { upsert: true },
  );
  const sent = await sendSms(phone, `Your AutoDealer code is ${code}. It expires in ${config.otp.ttlMinutes} minutes. Never share it.`);
  return { sent: true, devCode: sent || isProd ? undefined : code };
}

/** Check a code. Throws 400 with a message the UI shows under the code boxes. */
export async function checkOtp(phone, code) {
  const key = phoneKey(phone);
  const otp = await Otp.findById(key);
  if (!otp || otp.expiresAt < new Date()) throw badRequest('That code has expired. Request a new one.', { reason: 'expired' });
  if (otp.attempts >= config.otp.maxAttempts) throw badRequest('Too many attempts. Request a new code.', { reason: 'locked' });
  if (otp.codeHash !== hash(key, String(code))) {
    otp.attempts += 1;
    await otp.save();
    const left = config.otp.maxAttempts - otp.attempts;
    throw badRequest(left > 0 ? `That code is incorrect. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many attempts. Request a new code.', { reason: left > 0 ? 'wrong' : 'locked', left });
  }
  await Otp.deleteOne({ _id: key });
  return true;
}
