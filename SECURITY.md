# Administration security and controls

This covers how the admin console is protected: individual staff accounts, roles and permissions, maker-checker approvals, the audit trail, sessions, backups, and dealership team accounts.

## 1. Access control

### Individual accounts, no shared logins

Every staff member has their own admin account: work email, password and authenticator app (2-step verification). Staff join through an invitation that the Managing Director sends from **Admin → Team & roles → Invite staff member**. They set their own password and authenticator. Nobody else ever sees either.

### Roles and permissions

A role is a named set of permissions. The five launch roles:

| Role | Can |
|---|---|
| **Managing Director** (super admin, locked) | Everything, including staff, roles, permissions and approvals. |
| **Operations Manager** | Users (view, reactivate, request suspensions), listings and document verification, customer issues, loan referrals, website content, platform rules, reports, **approve suspensions**. |
| **Listing Administrator** | Listings (approve, reject, publish, feature, flag, suspend, remove), seller/dealer documents, vehicle categories, **request** permanent listing deletion. |
| **Finance Administrator** | Payments, invoices and subscriptions, **request** refunds and adjustments, reconciliation, loan providers and finance settings, reports, **approve refunds and adjustments**. |
| **IT / Technical Administrator** | Integrations (payment gateway, SMS, email, storage), backups, security monitoring and security rules. |

The full permission list is in `src/shared/permissions.js`. The MD can create more roles at any time from **Team & roles → Roles & permissions → New role**, for example a "Customer Support Agent", and can edit any role except the MD role.

### Enforcement

- **The API is the gate.** Every admin endpoint checks the caller's role permissions on every request (`requirePermission`). The website hides menus and pages a role can't use, but that is only for convenience.
- **Each role receives only its own data.** A Listing Administrator's browser never receives payment records. The IT administrator's never receives customer records.

### Managing staff (MD)

From **Team & roles** the MD can:

- invite staff and cancel invitations;
- change someone's role (they are signed out and get the new access when they sign in again);
- deactivate an account (access is revoked at once and every session ends) and reactivate it;
- end sessions;
- unlock an account locked after failed sign-ins;
- reset 2-step verification when someone loses their phone.

Built-in safeguards: nobody can change their own role or deactivate themselves, and there must always be at least one active MD.

### 2-step verification

2-step verification is required for every admin account (**Admin → Security**; only the MD can turn the requirement off). Staff without it are made to set it up at sign-in before they get in.

## 2. Approvals (maker-checker)

These actions need two people. One admin requests it with a reason; another admin whose role holds the matching approve permission approves or rejects it. **Nobody can approve their own request**: the API refuses it, even for the MD.

| Action | Requested by | Approved by |
|---|---|---|
| Refund (full or part) | `payments.refund` (Finance) | `approve.refund` (Finance, MD) |
| Payment adjustment (mark paid/failed after checking the statement, amount correction) | `payments.adjust` (Finance) | `approve.adjustment` (Finance, MD) |
| Permanent deletion of a listing | `listings.delete` (Listings) | `approve.deletion` (MD) |
| Permanent erasure of an account | `users.delete` | `approve.deletion` (MD) |
| Account suspension | `users.suspend` (Operations) | `approve.suspension` (Operations, MD) |

Approvers are notified (bell and email). The action runs only on approval, and the request, the decision and the result are all in the audit trail. Requests live in **Admin → Approvals**.

## 3. Audit trail

Every important action is recorded with:

- who did it (name, account, role);
- what they did, and on which record;
- when, and from which network (IP);
- **what changed** (for example `status: live → suspended`).

The trail covers sign-ins and lockouts, staff and role changes, listing moderation, document reviews, payment status changes, refunds and adjustments, configuration changes, backups and downloads, and dealership team activity.

**Tamper evidence.** Entries are numbered and chained with SHA-256: each entry's hash covers its content and the previous entry's hash. The application refuses to update or delete entries. If someone with direct database access edits or removes an entry, **Admin → Security → Check the activity log now** (or Activity log → Check integrity) reports exactly which entry.

For stronger protection in production, also:

- give the API a database user that can only insert into the `auditlogs` collection (no update or delete), or
- export the log daily to write-once storage.

**Who sees what.** The MD (`audit.view`) sees everyone's activity in **Admin → Activity log**, with filters and CSV export. Other staff see their own.

## 4. Financial controls

- **Automatic records.** Payments are recorded the moment checkout starts. Every status change (succeeded, failed) is written to the audit trail with the gateway reference.
- **Restricted access.** Only roles with `payments.view` can see financial records.
- **Reconciliation.** **Admin → Payments → Reconciliation** shows day-by-day totals. Finance ticks the payments that appear on a statement and records the statement reference. Each batch (who, when, which payments, total) is kept.
- **Approvals.** Refunds and adjustments always need approval (section 2).
- **No card data.** Card details are never sent to or stored by AutoDealer. They are entered on the payment gateway's own page. Only the method name and the gateway's reference are kept.

## 5. Data protection and backups

- **Backups.** Automatic, encrypted, with an off-site copy and a written restore procedure. See [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md).
- **Identity documents and ownership records.** Stored privately and opened only through signed links that expire. Only roles with `documents.review` (and the document's owner) can open them.
- **In transit.** In production all traffic is forced to HTTPS (`FORCE_HTTPS`) and browsers are told to keep using HTTPS (HSTS).
- **At rest.** Use a database host with encryption at rest (MongoDB Atlas encrypts by default), and keep files on Cloudinary or encrypted storage.
- **In the browser.** Admin data is never kept in browser storage.

## 6. Sign-in and session security

- **Passwords.** At least 12 characters, with upper and lower case, a number and a symbol. They may not contain the person's name or email, common words, or 4 repeated characters. Changing a password signs out the person's other devices.
- **Lockout.** After 5 wrong passwords or codes in a row, the account locks for 15 minutes. Both numbers can be changed in Admin → Security. The MD is notified and can unlock early.
- **Idle sign-out.** Admins are signed out after 30 minutes without activity (5–240, set in Admin → Security), with a 1-minute warning. Sessions also end after 12 hours regardless.
- **Server-side sessions.** Every sign-in creates a session on the server. Signing out, deactivation, role changes, password changes and "end session" take effect on the very next request, wherever the person is signed in.
- **Monitoring.** **Admin → Security** shows sign-ins and failures, locked accounts, active sessions, and alerts for:
  - repeated failures from one network;
  - sign-ins from a new network;
  - staff without 2-step verification;
  - unusually many sensitive actions in a day.

  New-network sign-ins also notify the IT administrator and the MD.

## 7. Dealer and agent team accounts

A dealer or an agent (the account owner) can add staff from **Dealer → Team** or **Agent → Team**.

- Each person signs in with **their own mobile number** and works inside the owner's account. They never share the owner's login.
- The owner chooses what each person can do: upload vehicles, edit listings (including offers), publish and pay, respond to enquiries and loan leads, manage business documents (agents: ID and owner authorisation), see payments. Agents can also give **Handover tracking**.
- Starting roles: dealers have Manager, Sales representative and Listings assistant; agents have Office manager, Field agent and Listings assistant. The owner can adjust any of them.
- **Privacy:** a team member's menu, pages and data are limited to their permissions. The server does not send them enquiries, payments, documents, handovers or loan leads they can't work on, or account and security notices. They never receive the owner's personal email, ID or tax numbers. A vehicle owner's contact details (agents) go only to members who edit listings or run handovers.
- Only the owner can manage the team, change the business profile, change the sign-in number or close the account.
- **Business logos** (shown on profiles, listing cards and vehicle pages) can be changed only by the account owner, or by an admin with *Manage user accounts*. A partner lender's logo can be changed only by that lender's own staff, or by an admin with *Finance settings*. Logos must be PNG, JPG or WebP (no SVG, which can carry scripts), up to 2 MB, and every change is in the activity log.
- All listings and conversations stay with the account. The owner sees everyone's activity on the Team page.
- The owner can change permissions, pause access, sign someone out or remove them at any time. Sessions end at once.

## Production checklist

- [ ] `ALLOW_DEMO_LOGIN=false` and `ALLOW_DEMO_RESET=false`
- [ ] Long random `JWT_SECRET`
- [ ] `BACKUP_ENCRYPTION_KEY` set and stored safely; `BACKUP_OFFSITE` set; a test restore done
- [ ] Each staff member invited with their own account; the seeded demo staff removed (`npm run seed` is for demos only)
- [ ] HTTPS in front of the API and the website
- [ ] `npm audit` and dependency updates monthly; OS security updates on the server
