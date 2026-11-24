// Closes accounts whose owners asked for closure more than 7 days ago (Account settings → Close my account).
// Listings are removed from the marketplace; payment records are kept. Schedule daily: `npm run close-accounts`.
import { connectDb, disconnectDb } from '../db.js';
import { config } from '../config.js';
import { User, Vehicle } from '../models/index.js';
import { audit } from '../services/audit.js';

try {
  await connectDb(config.mongoUri);
  const cutoff = new Date(Date.now() - 7 * 864e5).toISOString();
  const users = await User.find({ closureRequestedAt: { $lte: cutoff }, status: 'active' });
  for (const u of users) {
    await Vehicle.updateMany({ sellerId: u.id, status: { $in: ['live', 'suspended', 'pending_payment', 'draft'] } }, { status: 'removed' });
    u.status = 'suspended';
    u.set('closedAt', new Date().toISOString());
    await u.save();
    await audit(null, { action: 'Closed account', entityType: 'user', entityId: u.id, note: 'Closure requested by the user 7+ days ago.' });
  }
  console.log(`Closed ${users.length} account(s).`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
