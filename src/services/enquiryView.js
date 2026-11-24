// How an enquiry (conversation) is sent to the website.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { clean } from './serialize.js';

/** A guest buyer's access key for a conversation (derived from the server secret, so never stored). */
export const conversationKey = (id) => crypto.createHmac('sha256', config.fileSecret).update(`enquiry:${id}`).digest('base64url').slice(0, 32);
export function conversationKeyOk(id, key) {
  if (!id || !key) return false;
  const a = Buffer.from(conversationKey(id));
  const b = Buffer.from(String(key));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function enquiryView(e) {
  const o = clean(e);
  delete o.lastGuestSmsAt;
  delete o.lastSellerSmsAt;
  // Enquiries made before chat existed have only `message`: show it as the first message.
  if (!o.messages?.length) o.messages = [{ id: `${o.id}-0`, from: 'buyer', text: o.message || '', at: o.createdAt }];
  // Older enquiries the seller already followed up count as read.
  o.readAt = { buyer: o.createdAt, ...(o.status && o.status !== 'new' ? { seller: o.createdAt } : {}), ...(o.readAt || {}) };
  o.lastMessageAt = o.lastMessageAt || o.messages.at(-1).at;
  return o;
}
