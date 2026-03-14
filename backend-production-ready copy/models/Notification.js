const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['transfer_request', 'transfer_approved', 'transfer_denied', 'info'],
      required: true,
    },
    message: {
      type: String,
      required: true,
      maxlength: 500,
    },
    data: {
      serialNumber: { type: String, default: null },
      deviceName: { type: String, default: null },
      requesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      requesterEmail: { type: String, default: null },
    },
    isRead: { type: Boolean, default: false, index: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'denied', 'expired'],
      default: 'pending',
    },
    respondedAt: { type: Date, default: null },
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

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

notificationSchema.statics.getForUser = function (userId, limit = 50) {
  return this.find({ recipient: userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

notificationSchema.statics.getUnreadCount = function (userId) {
  return this.countDocuments({ recipient: userId, isRead: false });
};

notificationSchema.statics.hasPendingRequest = function (recipientId, serialNumber, requesterId) {
  return this.findOne({
    recipient: recipientId,
    type: 'transfer_request',
    status: 'pending',
    'data.serialNumber': serialNumber,
    'data.requesterId': requesterId,
  });
};

module.exports = mongoose.model('Notification', notificationSchema);
