import mongoose from 'mongoose';
import { baseOptions } from './plugin.js';

export const ROLES = ['admin', 'dealer', 'seller', 'agent', 'buyer', 'bank'];

const savedSearch = new mongoose.Schema({ id: String, label: String, query: mongoose.Schema.Types.Mixed, createdAt: String }, { _id: false });

const UserSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true },
    /** Digits of the phone number — one account per number. */
    phoneKey: { type: String, required: true, unique: true },
    email: { type: String, default: '', lowercase: true, trim: true },
    city: { type: String, default: '' },
    status: { type: String, enum: ['active', 'suspended', 'closed'], default: 'active', index: true },
    docStatus: { type: String, enum: ['not_submitted', 'pending', 'verified', 'rejected', 'flagged'], default: 'not_submitted' },
    registeredAt: { type: String, default: () => new Date().toISOString() },
    business: String,
    agency: String,
    /** Partner bank users: which loan provider (config.loanProviders[].id) they work for. */
    lenderId: String,
    // Admin sign-in
    passwordHash: { type: String, select: false },
    totpSecret: { type: String, select: false },
    twoFactor: { type: Boolean, default: false },
    /** Admin staff: their role key (AdminRole), e.g. 'md', 'finance'. */
    adminRole: { type: String, index: true },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: Date,
    lastLoginAt: String,
    lastLoginIp: String,
    passwordChangedAt: String,
    // Buyer tools that follow the account across devices
    buyer: {
      saved: { type: [String], default: [] },
      savedSearches: { type: [savedSearch], default: [] },
      prefs: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
  },
  // Registration collects different profile fields per role (business address, hours, PAN…): keep them all.
  baseOptions({ strict: false }),
);
UserSchema.index({ email: 1 });

export const User = mongoose.models.User || mongoose.model('User', UserSchema);
