// Create (or reset) an admin account from the command line:
//   npm run create-admin -- --email you@company.com --name "Your Name" --phone "+255 712 345 678" --password "S3cure#Password"
// Prints an authenticator key for two-step sign-in.
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { connectDb, disconnectDb } from '../db.js';
import { config } from '../config.js';
import { User } from '../models/index.js';
import { phoneKey, uid } from '../lib/ids.js';

const arg = (k) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const email = arg('email')?.toLowerCase();
const name = arg('name') || 'Admin';
const phone = arg('phone');
const password = arg('password');
const no2fa = process.argv.includes('--no-2fa');

if (!email || !password || !phone) {
  console.error('Usage: npm run create-admin -- --email <email> --name <name> --phone <phone> --password <password> [--no-2fa]');
  process.exit(1);
}
if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
  console.error('Password needs 12+ characters with upper and lower case letters, a number and a symbol.');
  process.exit(1);
}

try {
  await connectDb(config.mongoUri);
  const totpSecret = no2fa ? undefined : authenticator.generateSecret();
  const fields = { role: 'admin', name, phone, phoneKey: phoneKey(phone), email, docStatus: 'verified', status: 'active', passwordHash: await bcrypt.hash(password, 12), totpSecret, twoFactor: !no2fa };
  const existing = await User.findOne({ email, role: 'admin' });
  if (existing) await User.updateOne({ _id: existing._id }, fields);
  else await User.create({ _id: uid('u'), registeredAt: new Date().toISOString(), ...fields });
  console.log(`\nAdmin ${existing ? 'updated' : 'created'}: ${email}`);
  if (totpSecret) console.log(`Authenticator key: ${totpSecret}\n${authenticator.keyuri(email, 'AutoDealer Admin', totpSecret)}\n`);
} catch (e) {
  console.error(`Failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
