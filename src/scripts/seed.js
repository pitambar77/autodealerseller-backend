// npm run seed          → load the demo data into an empty database
// npm run seed:fresh    → delete everything and load the demo data again
import { connectDb, disconnectDb } from '../db.js';
import { config } from '../config.js';
import { seedDatabase } from '../services/seedDb.js';

const drop = process.argv.includes('--drop');
try {
  await connectDb(config.mongoUri);
  const out = await seedDatabase({ drop });
  console.log('\nSeeded AutoDealer demo data:', out.counts);
  console.log('\nAdmin console  (/admin/login) — one account per staff member, same demo password and 2-step key:');
  (out.staff || []).forEach((s) => console.log(`  ${s.role.padEnd(11)} ${s.email}`));
  console.log(`  password  ${out.admin.password}`);
  console.log(`  2-step    add this key to Google Authenticator / Authy: ${out.admin.totpSecret}`);
  console.log(`            (or open: ${out.admin.otpauthUrl})`);
  console.log(`\nAdmin invitation code  ${out.invite.code}  for ${out.invite.email}`);
  console.log('\nPhone sign-in (a code is sent by SMS — in development it is printed in the API log):');
  Object.entries(out.phones).forEach(([id, p]) => console.log(`  ${id.padEnd(12)} ${p}`));
  console.log('\nTeam members (sign in with their own number; they work inside the owner\'s account):');
  (out.team || []).forEach((t) => console.log(`  ${t.name.padEnd(14)} ${t.phone}  in ${t.account}'s account`));
  console.log('');
} catch (e) {
  console.error(`\nSeed failed: ${e.message}\n`);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
