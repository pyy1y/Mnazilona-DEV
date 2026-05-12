const mongoose = require('mongoose');

const PENDING_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const deviceShareSchema = new mongoose.Schema(
  {
    device: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Device',
      required: true,
      index: true,
    },
    serialNumber: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sharedWith: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    invitedEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    permissions: {
      type: [String],
      enum: ['view', 'control'],
      default: ['view', 'control'],
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'rejected', 'revoked', 'expired'],
      default: 'pending',
      index: true,
    },
    invitedAt: { type: Date, default: Date.now },
    respondedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Allow re-invitation after rejection/revocation, but block duplicate pending
// or active rows for the same (device, sharedWith) pair.
deviceShareSchema.index(
  { device: 1, sharedWith: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['pending', 'active'] } },
    name: 'uniq_active_share_per_device_user',
  }
);

deviceShareSchema.index({ sharedWith: 1, status: 1 });
deviceShareSchema.index({ owner: 1, status: 1 });

deviceShareSchema.statics.findActiveForUser = function (userId) {
  return this.find({ sharedWith: userId, status: 'active' });
};

deviceShareSchema.statics.findForDevice = function (deviceId) {
  return this.find({ device: deviceId, status: { $in: ['pending', 'active'] } })
    .sort({ createdAt: -1 });
};

deviceShareSchema.statics.PENDING_INVITATION_TTL_MS = PENDING_INVITATION_TTL_MS;

module.exports = mongoose.model('DeviceShare', deviceShareSchema);
