import mongoose from 'mongoose';
import { baseOptions } from './plugin.js';

export const LISTING_STATUSES = ['draft', 'pending_payment', 'live', 'sold', 'expired', 'suspended', 'removed', 'blocked_duplicate'];
/** Statuses that count as "active" for the one-listing rule and duplicate checks. */
export const ACTIVE_STATUSES = ['live', 'pending_payment', 'draft', 'suspended'];

const VehicleSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    // Key of a category in the Category collection (managed in Admin → Categories).
    category: { type: String, default: 'car', index: true },
    make: String,
    model: String,
    variant: String,
    year: Number,
    price: { type: Number, index: true },
    mileage: Number,
    fuel: String,
    transmission: String,
    condition: String,
    bodyType: String,
    city: { type: String, index: true },
    color: String,
    colorHex: String,
    regNumber: { type: String, default: '' },
    regKey: { type: String, index: true },
    vin: { type: String, default: '' },
    vinKey: { type: String, index: true },
    engineNo: String,
    owners: String,
    insuranceUntil: String,
    specs: { type: mongoose.Schema.Types.Mixed, default: {} },
    description: String,
    photos: { type: [mongoose.Schema.Types.Mixed], default: [] },
    sellerId: { type: String, index: true },
    sellerRole: String,
    ownerInfo: mongoose.Schema.Types.Mixed,
    modifications: String,
    status: { type: String, enum: LISTING_STATUSES, default: 'draft', index: true },
    verification: { type: String, default: 'unverified' },
    paymentStatus: { type: String, default: 'unpaid' },
    planId: String,
    featured: { type: Boolean, default: false },
    /** When a paid "featured" boost ends (ISO date). Empty = featured with no end date. */
    featuredUntil: String,
    // Discount or special offer ({ kind, label, details, discountType, value, originalPrice, discount, startedAt, endsAt }).
    // Declared so queries on offer.* (the expiry check) can never be dropped by the strictQuery setting.
    offer: { type: mongoose.Schema.Types.Mixed, default: undefined },
    views: { type: Number, default: 0 },
    duplicateOf: { type: [String], default: [] },
    suspendedWithUser: Boolean,
    createdAt: String,
    updatedAt: String,
    publishedAt: String,
    expiresAt: String,
  },
  baseOptions({ strict: false }),
);

export const Vehicle = mongoose.models.Vehicle || mongoose.model('Vehicle', VehicleSchema);
