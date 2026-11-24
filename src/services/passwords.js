// Password policy for admin staff.
const COMMON = ['password', 'autodealer', 'qwerty', '123456', 'letmein', 'welcome', 'admin', 'tanzania'];

/** Returns what's wrong with a password, or '' if it's acceptable. */
export function passwordProblem(pw, { email = '', name = '' } = {}) {
  const p = String(pw || '');
  if (p.length < 12) return 'Use at least 12 characters.';
  if (p.length > 128) return 'Use 128 characters or fewer.';
  if (!/[A-Z]/.test(p)) return 'Add a capital letter.';
  if (!/[a-z]/.test(p)) return 'Add a lowercase letter.';
  if (!/\d/.test(p)) return 'Add a number.';
  if (!/[^A-Za-z0-9]/.test(p)) return 'Add a symbol, such as ! or #.';
  if (/(.)\1\1\1/.test(p)) return "Don't repeat the same character 4 times in a row.";
  const low = p.toLowerCase();
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && low.includes(local)) return "Don't use your email address in the password.";
  if (String(name).split(/\s+/).some((w) => w.length >= 4 && low.includes(w.toLowerCase()))) return "Don't use your name in the password.";
  if (COMMON.some((w) => low.includes(w))) return 'Avoid common words like "password" or the company name.';
  return '';
}
