const mongoose = require('mongoose');

const CODE_TYPES = ['register', 'login', 'reset_password', 'delete_account', 'change_email_old', 'change_email_new', 'admin_login'];
const MAX_ATTEMPTS = 5;

const verificationCodeSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      lowercase: true,
      trim: true,
    },
    type: {
      type: String,
      enum: CODE_TYPES,
      required: [true, 'Verification type is required'],
    },
    codeHash: {
      type: String,
      required: [true, 'Code hash is required'],
    },
    expiresAt: {
      type: Date,
      required: [true, 'Expiration date is required'],
    },
    used: {
      type: Boolean,
      default: false,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
      max: MAX_ATTEMPTS,
    },
    ipAddress: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

verificationCodeSchema.index({ email: 1, type: 1, used: 1 });
verificationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

verificationCodeSchema.methods.isValid = function () {
  return !this.used && this.expiresAt > new Date() && this.attempts < MAX_ATTEMPTS;
};

verificationCodeSchema.statics.findActiveCode = function (email, type) {
  return this.findOne({
    email: email.toLowerCase().trim(),
    type,
    used: false,
    expiresAt: { $gt: new Date() },
    attempts: { $lt: MAX_ATTEMPTS },
  });
};

verificationCodeSchema.statics.invalidateAll = function (email, type) {
  return this.updateMany(
    { email: email.toLowerCase().trim(), type, used: false },
    { $set: { used: true } }
  );
};

module.exports = mongoose.models.VerificationCode || mongoose.model('VerificationCode', verificationCodeSchema);
