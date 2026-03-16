const mongoose = require('mongoose');
const crypto = require('crypto');

const allowedDeviceSchema = new mongoose.Schema(
  {
    serialNumber: {
      type: String,
      required: [true, 'Serial number is required'],
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    deviceSecret: {
      type: String,
      required: true,
      select: false,
    },
    deviceType: {
      type: String,
      enum: ['relay', 'sensor', 'switch', 'light', 'dimmer', 'water-tank', 'ac', 'security', 'lock', 'other'],
      default: 'relay',
    },
    firmwareVersion: { type: String, default: '1.0.0' },
    hardwareVersion: { type: String, default: '1.0' },
    macAddress: {
      type: String,
      default: null,
      uppercase: true,
      trim: true,
    },
    isActivated: { type: Boolean, default: false, index: true },
    activatedAt: { type: Date, default: null },
    activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isBanned: { type: Boolean, default: false },
    banReason: { type: String, default: null },
    mqttUsername: { type: String, default: null, select: false },
    mqttPassword: { type: String, default: null, select: false },
    notes: { type: String, default: '', maxlength: 500 },
    failedAttempts: { type: Number, default: 0 },
    lastFailedAttempt: { type: Date, default: null },
    lockedUntil: { type: Date, default: null },
    lastInquiryAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.__v;
        delete ret.deviceSecret;
        delete ret.mqttUsername;
        delete ret.mqttPassword;
        return ret;
      },
    },
  }
);

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 60 * 60 * 1000;

function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

allowedDeviceSchema.methods.isLocked = function () {
  if (!this.lockedUntil) return false;
  if (new Date() > this.lockedUntil) {
    this.failedAttempts = 0;
    this.lockedUntil = null;
    return false;
  }
  return true;
};

allowedDeviceSchema.methods.recordFailedAttempt = async function () {
  this.failedAttempts += 1;
  this.lastFailedAttempt = new Date();

  if (this.failedAttempts >= MAX_FAILED_ATTEMPTS) {
    this.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
    console.warn(`Device ${this.serialNumber} locked due to ${this.failedAttempts} failed attempts`);
  }

  await this.save();
};

allowedDeviceSchema.methods.resetFailedAttempts = async function () {
  if (this.failedAttempts > 0) {
    this.failedAttempts = 0;
    this.lockedUntil = null;
    await this.save();
  }
};

allowedDeviceSchema.methods.verifySecret = function (candidateSecret) {
  const candidateHash = hashSecret(candidateSecret);
  const storedHash = this.deviceSecret;
  if (candidateHash.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidateHash, 'hex'), Buffer.from(storedHash, 'hex'));
};

allowedDeviceSchema.statics.findAllowed = function (serialNumber) {
  return this.findOne({
    serialNumber: serialNumber.toUpperCase().trim(),
    isBanned: false,
  });
};

allowedDeviceSchema.statics.findAllowedWithSecret = function (serialNumber) {
  return this.findOne({
    serialNumber: serialNumber.toUpperCase().trim(),
  }).select('+deviceSecret +mqttUsername +mqttPassword');
};

allowedDeviceSchema.statics.registerDevice = async function (deviceData) {
  const rawSecret = deviceData.deviceSecret || crypto.randomBytes(16).toString('hex');
  const hashedSecret = hashSecret(rawSecret);
  const mqttUsername = `dev_${deviceData.serialNumber.toUpperCase().trim()}`;
  const mqttPassword = crypto.randomBytes(24).toString('hex');

  const device = await this.create({
    ...deviceData,
    serialNumber: deviceData.serialNumber.toUpperCase().trim(),
    deviceSecret: hashedSecret,
    mqttUsername,
    mqttPassword,
  });

  device._rawSecret = rawSecret;
  return device;
};

allowedDeviceSchema.statics.registerBatch = async function (devices) {
  const secretsMap = {};

  const prepared = devices.map((d) => {
    const sn = d.serialNumber.toUpperCase().trim();
    const rawSecret = d.deviceSecret || crypto.randomBytes(16).toString('hex');
    secretsMap[sn] = rawSecret;

    return {
      ...d,
      serialNumber: sn,
      deviceSecret: hashSecret(rawSecret),
      mqttUsername: `dev_${sn}`,
      mqttPassword: crypto.randomBytes(24).toString('hex'),
    };
  });

  const result = await this.insertMany(prepared, { ordered: false });
  result._secretsMap = secretsMap;
  return result;
};

module.exports = mongoose.model('AllowedDevice', allowedDeviceSchema);
