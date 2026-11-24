// Live updates: GET /api/events keeps a Server-Sent Events stream open.
// Signed-in users send their token (Authorization header); a guest buyer can also follow one
// conversation with ?enquiry=<id>&key=<access key>. Everyone receives public listing changes.
import { Router } from 'express';
import { forbidden } from '../lib/http.js';
import { subscribe, toUser } from '../services/realtime.js';
import { conversationKeyOk } from '../services/enquiryView.js';

const r = Router();

r.get('/', (req, res, next) => {
  const channels = ['public'];
  if (req.user) channels.push(toUser(req.user.role === 'bank' ? req.user.lenderId : req.user.id));
  if (req.user?.role === 'admin') channels.push('admins'); // new registrations, documents, listing changes, views
  const { enquiry, key } = req.query;
  if (enquiry) {
    if (!conversationKeyOk(String(enquiry), key)) return next(forbidden('This conversation link is not valid.'));
    channels.push(`enq:${enquiry}`);
  }
  return subscribe(req, res, channels);
});

export default r;
