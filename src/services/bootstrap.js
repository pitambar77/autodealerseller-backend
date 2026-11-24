// GET /api/bootstrap — everything one visitor's pages need, scoped to who they are.
// Guests: live listings, public seller profiles, public config.
// Signed-in users: plus their own listings, enquiries, payments, documents, notifications…
// Admins: everything. Partner bank users: their bank's leads.
import { Vehicle, User, Enquiry, Payment, Document, Note, Referral, Notification, Handover, AuditLog, AdminRole, Approval } from '../models/index.js';
import { allows } from '../shared/permissions.js';
import { adminConfig, getConfig, publicConfig } from './settings.js';
import { hiddenCategoryKeys, listCategories } from './categories.js';
import { clean, documentView, ownerVehicle, privateUser, publicUser, publicVehicle } from './serialize.js';
import { enquiryView } from './enquiryView.js';

const SELLER_ROLES = ['dealer', 'seller', 'agent'];
const byNewest = { createdAt: -1 };

/**
 * @param me     the signed-in account (for dealership staff: the dealership)
 * @param ctx    { perms } admin permissions, { member } dealership team member, { authError }
 */
/** The owner's profile as their team members see it: no personal email, ID or tax numbers, or sign-in details. */
function ownerProfileForMember(u) {
  const o = { ...u };
  for (const k of Object.keys(o)) if (/^(email|lastLogin\w*|passwordChangedAt|lockedUntil|failedLogins|twoFactor|closureRequestedAt|(nida|tin|brela|idNumber|idType|dob|dateOfBirth|licen[cs]e)\w*)$/i.test(k)) delete o[k];
  return o;
}

export async function buildBootstrap(me, { perms = [], member = null, authError } = {}) {
  const config = await getConfig();
  const isAdmin = me?.role === 'admin';
  const can = (p) => allows(perms, p);
  const role = isAdmin ? await AdminRole.findById(me.adminRole || '').lean() : null;
  const base = {
    // Admins get the full configuration; city photo keys become addresses for everyone.
    config: isAdmin
      ? { ...config, cityImages: publicConfig(config).cityImages, heroSlides: publicConfig(config).heroSlides, brandLogos: publicConfig(config).brandLogos, popularCategories: adminConfig(config).popularCategories, loanProviders: can('finance.settings') ? adminConfig(config).loanProviders : publicConfig(config).loanProviders }
      : publicConfig(config),
    // Admins get every category (hidden ones too); everyone else only the visible ones.
    categories: await listCategories({ enabledOnly: !isAdmin }),
    session: me
      ? {
          userId: me.id,
          role: me.role,
          at: new Date().toISOString(),
          // Admin staff: role and permissions (the website shows only what they can use)
          ...(isAdmin ? { adminRole: me.adminRole || null, roleName: role?.name || 'No role', permissions: perms, idleMinutes: config.security?.adminIdleMinutes } : {}),
          // Dealership staff: who is signed in, and what the owner allowed
          ...(member ? { member: { id: member.id, name: member.name, title: member.title || '', phone: member.phone, permissions: member.permissions || [] } } : {}),
        }
      : null,
    ...(authError ? { authError } : {}),
    users: [],
    vehicles: [],
    enquiries: [],
    payments: [],
    documents: [],
    notes: [],
    referrals: [],
    notifications: [],
    handovers: [],
    audit: [],
    saved: [],
    savedSearches: [],
    buyerPrefs: {},
  };

  if (me?.role === 'admin') {
    // Each admin role gets only the records its permissions cover.
    const seeListings = can('listings.view') || can('listings.moderate');
    const seeUsers = can('users.view') || seeListings || can('documents.review') || can('payments.view') || can('support.manage');
    const none = Promise.resolve([]);
    const [users, vehicles, enquiries, payments, documents, notes, referrals, notifications, handovers, audit, pendingApprovals] = await Promise.all([
      seeUsers ? User.find().lean() : User.find({ role: 'admin' }).lean(),
      seeListings || can('payments.view') || can('users.view') || can('support.manage') || can('referrals.view') ? Vehicle.find().sort(byNewest).lean() : none,
      can('support.manage') || seeListings ? Enquiry.find().sort(byNewest).lean() : none,
      can('payments.view') ? Payment.find().sort(byNewest).lean() : none,
      can('documents.review') ? Document.find().sort({ uploadedAt: -1 }).lean() : can('users.view') ? Document.find({}, { file: 0 }).sort({ uploadedAt: -1 }).lean() : none,
      seeListings ? Note.find().sort({ at: -1 }).lean() : none,
      can('referrals.view') ? Referral.find().sort(byNewest).lean() : none,
      Notification.find({ recipientId: me.id }).sort({ at: -1 }).limit(200).lean(),
      seeListings ? Handover.find().lean() : none,
      can('audit.view') ? AuditLog.find().sort({ at: -1 }).limit(1000).lean() : AuditLog.find({ actorId: me.id }).sort({ at: -1 }).limit(200).lean(),
      Approval.find({ status: 'pending' }, { type: 1, requestedBy: 1 }).lean(),
    ]);
    return {
      ...base,
      users: users.map(privateUser),
      vehicles: vehicles.map(ownerVehicle),
      enquiries: enquiries.map(enquiryView),
      payments: payments.map(clean),
      documents: documents.map(documentView),
      notes: notes.map(clean),
      referrals: referrals.map(clean),
      notifications: notifications.map(clean),
      handovers: handovers.map(clean),
      audit: audit.map(clean),
      // Pending approvals this person can decide (badge in the menu)
      approvalsWaiting: pendingApprovals.filter((a) => a.requestedBy?.id !== me.id && allows(perms, { refund: 'approve.refund', adjustment: 'approve.adjustment', deletion: 'approve.deletion', suspension: 'approve.suspension' }[a.type])).length,
    };
  }

  // Public marketplace data
  const [live, sellers] = await Promise.all([
    Vehicle.find({ status: 'live', category: { $nin: await hiddenCategoryKeys() } }).sort({ publishedAt: -1 }).limit(5000).lean(),
    User.find({ role: { $in: SELLER_ROLES }, status: 'active' }).lean(),
  ]);
  const vehicles = new Map(live.map((v) => [v._id, publicVehicle(v)]));
  const users = new Map(sellers.map((u) => [u._id, publicUser(u)]));
  const out = { ...base };

  if (me) {
    users.set(me.id, privateUser(me));
    const mine = { $or: [{ sellerId: me.id }, { buyerId: me.id }] };
    const [ownVehicles, enquiries, payments, documents, notifications, handovers, referrals] = await Promise.all([
      SELLER_ROLES.includes(me.role) ? Vehicle.find({ sellerId: me.id }).lean() : [],
      Enquiry.find(mine).sort(byNewest).lean(),
      Payment.find({ userId: me.id }).sort(byNewest).lean(),
      Document.find({ userId: me.id }).lean(),
      Notification.find({ recipientId: me.role === 'bank' ? me.lenderId : me.id }).sort({ at: -1 }).limit(200).lean(),
      me.role === 'agent' ? Handover.find({ agentId: me.id }).lean() : [],
      me.role === 'bank' ? Referral.find({ lenderId: me.lenderId }).sort(byNewest).lean() : Referral.find({ $or: [{ dealerId: me.id }, { buyerId: me.id }] }).sort(byNewest).lean(),
    ]);
    // An agent's vehicle owners' contact details: only for team members who edit listings or run handovers.
    const memberMay = (p) => !member || allows(member.permissions, p);
    const seesOwners = memberMay('listings.edit') || memberMay('handovers.manage');
    ownVehicles.forEach((v) => {
      const o = ownerVehicle(v);
      if (!seesOwners) delete o.ownerInfo;
      vehicles.set(v._id, o);
    });
    // Listings referenced by my enquiries and leads may no longer be live (sold, expired): include them.
    const refIds = [...enquiries.map((e) => e.vehicleId), ...referrals.map((r) => r.vehicleId)].filter((id) => id && !vehicles.has(id));
    if (refIds.length) (await Vehicle.find({ _id: { $in: refIds } }).lean()).forEach((v) => vehicles.set(v._id, publicVehicle(v)));
    // Dealers and buyers behind a bank's leads
    if (me.role === 'bank') {
      const ids = [...new Set(referrals.flatMap((r) => [r.dealerId, r.buyerId]).filter((id) => id && !users.has(id)))];
      if (ids.length) (await User.find({ _id: { $in: ids } }).lean()).forEach((u) => users.set(u._id, publicUser(u)));
    }
    // A team member only receives what their permissions cover (the owner receives everything).
    const memberCan = (p) => !member || allows(member.permissions, p);
    const canSeeNotice = (n) => {
      if (!member) return true;
      const k = n.kind || '';
      if (/^(enquiry|message|referral|lead)/.test(k)) return memberCan('enquiries.respond');
      if (/^(doc|document|correction)/.test(k)) return memberCan('documents.manage');
      if (/^(payment|boost|invoice)/.test(k)) return memberCan('payments.view') || memberCan('listings.publish');
      if (/^handover/.test(k)) return memberCan('handovers.manage');
      if (/^(listing|saved|sold|available|unavailable|updated|approval_result)/.test(k)) return true;
      return false; // account and security notices are for the owner
    };
    if (member) users.set(me.id, ownerProfileForMember(users.get(me.id)));
    Object.assign(out, {
      enquiries: memberCan('enquiries.respond') ? enquiries.map(enquiryView) : [],
      payments: memberCan('payments.view') || memberCan('listings.publish') ? payments.map(clean) : [],
      documents: memberCan('documents.manage') ? documents.map(documentView) : [],
      notifications: notifications.filter(canSeeNotice).map(clean),
      handovers: memberCan('handovers.manage') ? handovers.map(clean) : [],
      referrals: memberCan('enquiries.respond') ? referrals.map(clean) : [],
      saved: me.buyer?.saved || [],
      savedSearches: me.buyer?.savedSearches || [],
      buyerPrefs: me.buyer?.prefs || {},
    });
  }

  out.vehicles = [...vehicles.values()];
  out.users = [...users.values()];
  return out;
}
