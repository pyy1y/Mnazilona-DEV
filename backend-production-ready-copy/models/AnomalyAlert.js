const mongoose = require('mongoose');

const anomalyAlertSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: [
        'brute_force',           // Too many failed login/OTP attempts from same IP
        'device_flood',          // Device sending too many commands in short time
        'suspicious_ip',         // IP hitting many different endpoints rapidly
        'multiple_failed_otp',   // Multiple failed OTP verifications
        'unusual_admin_activity', // Admin doing unusual number of actions
        'device_takeover',       // Multiple pair attempts on same device
        'geo_anomaly',           // Login from unusual IP range (future)
      ],
      index: true,
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
      index: true,
    },
    ip: {
      type: String,
      default: null,
    },
    target: {
      type: String, // email, serialNumber, or endpoint
      default: null,
    },
    description: {
      type: String,
      required: true,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ['open', 'acknowledged', 'resolved', 'false_positive'],
      default: 'open',
      index: true,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    autoBlocked: {
      type: Boolean,
      default: false,
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

anomalyAlertSchema.index({ createdAt: -1 });
anomalyAlertSchema.index({ status: 1, severity: 1, createdAt: -1 });

// Keep alerts for 6 months
anomalyAlertSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

module.exports = mongoose.model('AnomalyAlert', anomalyAlertSchema);
