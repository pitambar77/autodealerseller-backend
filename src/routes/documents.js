import { Router } from 'express';
import { z } from 'zod';
import { Document, User } from '../models/index.js';
import { ah, parse, badRequest, forbidden, notFound } from '../lib/http.js';
import { uid } from '../lib/ids.js';
import { requireAuth, requirePermission, requireTeamPermission, adminCan } from '../middleware/auth.js';
import { saveDataUrl, removeFile } from '../services/storage.js';
import { syncUserDocStatus } from '../services/documents.js';
import { clean, documentView } from '../services/serialize.js';
import { audit } from '../services/audit.js';
import { notifyAccount, notifyAdmins, webLink } from '../services/notify.js';

const DOCS_PAGE = { dealer: '/dealer/documents', agent: '/agent/documents', seller: '/seller/identity' };

const r = Router();
const TYPES = ['business_certificate', 'gst_certificate', 'personal_id', 'owner_authorization', 'verification_video', 'trade_licence', 'other'];

/** Upload (or replace) one of my verification documents. The file arrives as a data URL. */
r.post(
  '/',
  requireAuth,
  requireTeamPermission('documents.manage'),
  ah(async (req, res) => {
    const d = parse(
      z.object({
        type: z.enum(TYPES),
        label: z.string().max(120),
        fileName: z.string().max(200),
        size: z.number().optional(),
        maskedNumber: z.string().max(40).nullable().optional(),
        data: z.string().optional(),
        preview: z.string().optional(),
      }),
      req.body,
    );
    const dataUrl = d.data || d.preview;
    if (d.type !== 'verification_video' && !dataUrl) throw badRequest('Choose a file to upload.');
    const file = dataUrl ? await saveDataUrl(dataUrl, 'docs') : null;
    const old = await Document.find({ userId: req.user.id, type: d.type });
    await Promise.all(old.map((o) => removeFile(o.file)));
    await Document.deleteMany({ userId: req.user.id, type: d.type });
    const doc = await Document.create({
      _id: uid('d'),
      userId: req.user.id,
      type: d.type,
      label: d.label,
      fileName: d.fileName,
      size: d.size || 0,
      maskedNumber: d.maskedNumber || null,
      file,
      status: 'pending',
      reviewNote: '',
      uploadedAt: new Date().toISOString(),
    });
    const docStatus = await syncUserDocStatus(req.user.id);
    const who = req.user.business || req.user.agency || req.user.name;
    notifyAdmins({
      perm: 'documents.review',
      kind: 'document',
      title: `Document to verify: ${who}`,
      body: `${d.label} uploaded`,
      link: '/admin/documents',
      refId: doc.id,
      groupKey: `docs:${req.user.id}`,
      email: { subject: `Document to verify: ${who}`, heading: `${who} uploaded a document`, lines: [`${d.label} (${d.fileName}) is waiting for review.`], button: { label: 'Open the documents queue', url: webLink('/admin/documents') } },
    }).catch((e) => console.error('[notify] document upload:', e.message));
    res.status(201).json({ document: documentView(doc), docStatus });
  }),
);

r.delete(
  '/:id',
  requireAuth,
  ah(async (req, res) => {
    const doc = await Document.findById(req.params.id);
    if (!doc) throw notFound('Document not found.');
    const staff = adminCan(req, 'documents.review');
    if (!staff && doc.userId !== req.user.id) throw forbidden();
    if (!staff && doc.status === 'verified') throw badRequest('Verified documents can only be replaced, not removed.');
    await removeFile(doc.file);
    await doc.deleteOne();
    const docStatus = await syncUserDocStatus(doc.userId);
    res.json({ ok: true, id: doc.id, userId: doc.userId, docStatus });
  }),
);

/** Admin review: verified / rejected / flagged, with a note the user sees. */
r.post(
  '/:id/review',
  requirePermission('documents.review'),
  ah(async (req, res) => {
    const { status, note } = parse(z.object({ status: z.enum(['verified', 'rejected', 'flagged', 'pending']), note: z.string().max(500).optional() }), req.body);
    const doc = await Document.findById(req.params.id);
    if (!doc) throw notFound('Document not found.');
    Object.assign(doc, { status, reviewNote: note || '', reviewedAt: new Date().toISOString() });
    await doc.save();
    const docStatus = await syncUserDocStatus(doc.userId);
    const entry = await audit(req.user, { action: `${status === 'verified' ? 'Verified' : status === 'rejected' ? 'Rejected' : 'Flagged'} document`, entityType: 'user', entityId: doc.userId, note: note || doc.label });
    // Tell the account holder (bell, email; SMS when they need to act).
    if (status !== 'pending') {
      const owner = await User.findById(doc.userId, { role: 1 }).lean();
      const msg = {
        verified: [`Document verified: ${doc.label}`, docStatus === 'verified' ? 'All your documents are verified. Your listings now show the "Verified" badge.' : 'Thanks, this document is verified.'],
        rejected: [`Document not accepted: ${doc.label}`, `${note ? `Reason: ${note}. ` : ''}Please upload it again.`],
        flagged: [`Document needs attention: ${doc.label}`, `${note ? `${note}. ` : ''}Our team will contact you, or you can upload a clearer copy.`],
      }[status];
      notifyAccount(doc.userId, {
        kind: `doc_${status}`,
        title: msg[0],
        body: msg[1],
        link: DOCS_PAGE[owner?.role] || '/account',
        refId: doc.id,
        sms: status === 'verified' ? undefined : `AutoDealer: ${msg[0]}. ${msg[1]}`,
      }).catch((e) => console.error('[notify] document review:', e.message));
    }
    res.json({ document: documentView(doc), docStatus, audit: clean(entry.toObject()) });
  }),
);

export default r;
