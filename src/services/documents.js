import { Document, User } from '../models/index.js';

export function aggregateDocStatus(docs) {
  if (!docs.length) return 'not_submitted';
  if (docs.some((d) => d.status === 'flagged')) return 'flagged';
  if (docs.some((d) => d.status === 'rejected')) return 'rejected';
  if (docs.some((d) => d.status === 'pending')) return 'pending';
  return 'verified';
}

/** Keep the user's overall document status in step with their documents. */
export async function syncUserDocStatus(userId) {
  const docs = await Document.find({ userId }).lean();
  const docStatus = aggregateDocStatus(docs);
  await User.updateOne({ _id: userId }, { docStatus });
  return docStatus;
}
