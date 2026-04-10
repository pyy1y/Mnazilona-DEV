const mongoose = require('mongoose');

const ipBlacklistSchema = new mongoose.Schema(
  {
    ip: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    reason: {
      type: String,
      required: true,
    },
    source: {
      type: String,
      enum: ['manual', 'anomaly_detector', 'rate_limit'],
      default: 'manual',
    },
    blockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null, // null = permanent
    },
    hitCount: {
      type: Number,
      default: 0,
    },
    lastHitAt: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
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

// Auto-expire: TTL index on expiresAt (only deletes when expiresAt is set)
ipBlacklistSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } });

module.exports = mongoose.model('IPBlacklist', ipBlacklistSchema);
