// Admin console permissions and the built-in staff roles.
// Shared by the API (which enforces them) and the website (which shows only what a role can use).
//
// A role is a named list of permission keys. The Managing Director role has '*' (everything) and
// can't be edited or removed. The MD can create more roles at any time (Admin → Team & roles).

/** Every permission, grouped as shown on the role editor. `sensitive` ones are highlighted there. */
export const PERMISSIONS = [
  { key: 'dashboard.view', group: 'General', label: 'Admin dashboard', hint: 'Key numbers for the areas the role can see.' },

  { key: 'users.view', group: 'Users & dealers', label: 'See user accounts', hint: 'Sellers, agents, dealers and buyers, with contact details.' },
  { key: 'users.manage', group: 'Users & dealers', label: 'Manage user accounts', hint: 'Reactivate accounts and handle account issues.' },
  { key: 'users.suspend', group: 'Users & dealers', label: 'Request account suspensions', hint: 'Needs approval by someone with "Approve suspensions".', sensitive: true },
  { key: 'users.delete', group: 'Users & dealers', label: 'Request permanent account deletion', hint: 'Needs approval by someone with "Approve deletions".', sensitive: true },

  { key: 'listings.view', group: 'Listings & verification', label: 'See all listings' },
  { key: 'listings.moderate', group: 'Listings & verification', label: 'Approve, reject and publish listings', hint: 'Verify, flag, suspend, remove, restore and feature listings; internal notes.' },
  { key: 'listings.delete', group: 'Listings & verification', label: 'Request permanent listing deletion', hint: 'Needs approval by someone with "Approve deletions".', sensitive: true },
  { key: 'documents.review', group: 'Listings & verification', label: 'Review identity and ownership documents', hint: 'Open and verify, reject or flag seller, agent and dealer documents.', sensitive: true },
  { key: 'categories.manage', group: 'Listings & verification', label: 'Vehicle categories' },

  { key: 'support.manage', group: 'Customers & operations', label: 'Customer issues', hint: 'Support requests and buyer–seller enquiries.' },
  { key: 'referrals.view', group: 'Customers & operations', label: 'Loan referrals' },
  { key: 'content.manage', group: 'Customers & operations', label: 'Website content', hint: 'Home page banner, cities and city photos.' },
  { key: 'config.manage', group: 'Customers & operations', label: 'Platform rules', hint: 'Listing validity, seller listing limit, featured days, verification portal.' },

  { key: 'payments.view', group: 'Finance', label: 'Payments, invoices and subscriptions', sensitive: true },
  { key: 'payments.refund', group: 'Finance', label: 'Request refunds', hint: 'Needs approval by someone with "Approve refunds".', sensitive: true },
  { key: 'payments.adjust', group: 'Finance', label: 'Request payment adjustments', hint: 'Mark a payment paid or failed after checking the statement, or correct an amount. Needs approval.', sensitive: true },
  { key: 'payments.reconcile', group: 'Finance', label: 'Reconcile payments', hint: 'Match payments with gateway and bank statements.' },
  { key: 'finance.settings', group: 'Finance', label: 'Loan providers and finance settings' },
  { key: 'reports.view', group: 'Finance', label: 'Reports and financial reporting' },

  { key: 'system.integrations', group: 'Technical', label: 'Integrations', hint: 'Payment gateway, SMS, email and storage status and tests.' },
  { key: 'system.backups', group: 'Technical', label: 'Backups', hint: 'See backup history, run a backup now, download backups.', sensitive: true },
  { key: 'system.security', group: 'Technical', label: 'Security monitoring', hint: 'Sign-in attempts, locked accounts, active sessions, security settings.' },

  { key: 'approve.refund', group: 'Approvals (checker)', label: 'Approve refunds', sensitive: true },
  { key: 'approve.adjustment', group: 'Approvals (checker)', label: 'Approve payment adjustments', sensitive: true },
  { key: 'approve.deletion', group: 'Approvals (checker)', label: 'Approve permanent deletions', sensitive: true },
  { key: 'approve.suspension', group: 'Approvals (checker)', label: 'Approve account suspensions', sensitive: true },

  { key: 'staff.manage', group: 'Oversight', label: 'Manage admin staff and roles', hint: 'Create, change, deactivate admin accounts; edit roles and permissions; end sessions.', sensitive: true },
  { key: 'audit.view', group: 'Oversight', label: 'Full activity history', hint: 'Everything every admin did. Without this, staff see only their own activity.' },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

/** The five launch roles. `locked` roles can't be edited or removed. */
export const DEFAULT_ADMIN_ROLES = [
  {
    key: 'md',
    name: 'Managing Director',
    description: 'Super administrator: full access, staff and permissions, approvals and overall management.',
    permissions: ['*'],
    locked: true,
  },
  {
    key: 'operations',
    name: 'Operations Manager',
    description: 'Daily operations, customer issues, dealer management, verification processes and operational performance.',
    permissions: ['dashboard.view', 'users.view', 'users.manage', 'users.suspend', 'listings.view', 'listings.moderate', 'documents.review', 'support.manage', 'referrals.view', 'content.manage', 'config.manage', 'reports.view', 'approve.suspension'],
  },
  {
    key: 'listings',
    name: 'Listing Administrator',
    description: 'Vehicle listings, seller and dealer documents, vehicle verification, approvals, rejections and publication.',
    permissions: ['dashboard.view', 'users.view', 'listings.view', 'listings.moderate', 'listings.delete', 'documents.review', 'categories.manage'],
  },
  {
    key: 'finance',
    name: 'Finance Administrator',
    description: 'Listing fees, subscriptions, payments, invoices, refunds, reconciliation and financial reporting.',
    permissions: ['dashboard.view', 'users.view', 'payments.view', 'payments.refund', 'payments.adjust', 'payments.reconcile', 'finance.settings', 'reports.view', 'referrals.view', 'approve.refund', 'approve.adjustment'],
  },
  {
    key: 'it',
    name: 'IT / Technical Administrator',
    description: 'Technical maintenance, system security, API and payment gateway integrations, backups and technical support.',
    permissions: ['dashboard.view', 'system.integrations', 'system.backups', 'system.security'],
  },
];

/** Which permission approves each kind of sensitive request, and which may ask for it. */
export const APPROVAL_TYPES = {
  refund: { label: 'Refund', request: ['payments.refund'], approve: 'approve.refund' },
  adjustment: { label: 'Payment adjustment', request: ['payments.adjust'], approve: 'approve.adjustment' },
  deletion: { label: 'Permanent deletion', request: ['listings.delete', 'users.delete'], approve: 'approve.deletion' },
  suspension: { label: 'Account suspension', request: ['users.suspend'], approve: 'approve.suspension' },
};

/** Does a permission list allow `perm`? '*' allows everything. */
export const allows = (perms, perm) => Array.isArray(perms) && (perms.includes('*') || perms.includes(perm));
export const allowsAny = (perms, list) => list.some((p) => allows(perms, p));

// ── Dealership team members (staff of a dealer, signing in with their own number)
export const TEAM_PERMISSIONS = [
  { key: 'listings.create', label: 'Upload vehicles', hint: 'Add new listings (as drafts).' },
  { key: 'listings.edit', label: 'Edit listings', hint: 'Change details, photos, price, offers; mark sold.' },
  { key: 'listings.publish', label: 'Publish and pay', hint: 'Pay listing fees or use pack credits; feature listings.' },
  { key: 'enquiries.respond', label: 'Respond to enquiries', hint: 'Read and reply to buyer messages and loan leads.' },
  { key: 'documents.manage', label: 'Business documents', hint: 'Upload verification documents.', agent: { label: 'ID & owner authorisation', hint: 'Upload ID and owner authorisation letters.' } },
  { key: 'handovers.manage', label: 'Handover tracking', hint: 'Record and update ownership handovers to buyers.', roles: ['agent'] },
  { key: 'payments.view', label: 'See payments', hint: 'Payment history and invoices.' },
];
export const TEAM_PERMISSION_KEYS = TEAM_PERMISSIONS.map((p) => p.key);
/** Account types that can have a team. */
export const TEAM_ROLES = ['dealer', 'agent'];
/** The permissions an owner of this account type can hand out, with labels for that account type. */
export const teamPermissionsFor = (role) =>
  TEAM_PERMISSIONS.filter((p) => !p.roles || p.roles.includes(role)).map(({ agent, roles: _r, ...p }) => (role === 'agent' && agent ? { ...p, ...agent } : p));
/** Starting points the owner can pick from when inviting someone, per account type. */
export const TEAM_PRESETS_BY_ROLE = {
  dealer: {
    manager: { label: 'Manager', permissions: ['listings.create', 'listings.edit', 'listings.publish', 'enquiries.respond', 'documents.manage', 'payments.view'] },
    sales: { label: 'Sales representative', permissions: ['listings.create', 'listings.edit', 'enquiries.respond'] },
    listings: { label: 'Listings assistant', permissions: ['listings.create', 'listings.edit'] },
  },
  agent: {
    manager: { label: 'Office manager', permissions: ['listings.create', 'listings.edit', 'listings.publish', 'enquiries.respond', 'documents.manage', 'handovers.manage', 'payments.view'] },
    field: { label: 'Field agent', permissions: ['listings.create', 'listings.edit', 'enquiries.respond', 'handovers.manage'] },
    listings: { label: 'Listings assistant', permissions: ['listings.create', 'listings.edit'] },
  },
};
export const TEAM_PRESETS = TEAM_PRESETS_BY_ROLE.dealer;
