const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Device name is required'],
      trim: true,
      maxlength: 100,
    },
    serialNumber: {
      type: String,
      required: [true, 'Serial number is required'],
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    deviceType: {
      type: String,
      enum: ['relay', 'sensor', 'switch', 'light', 'dimmer', 'water-tank', 'ac', 'security', 'other'],
      default: 'relay',
    },
    firmwareVersion: { type: String, default: null },

    // MQTT Credentials (hidden by default)
    mqttToken: { type: String, default: null, select: false },
    brokerUrl: { type: String, default: null },
    mqttUsername: { type: String, default: null, select: false },
    mqttPassword: { type: String, default: null, select: false },

    // Ownership
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    pairedAt: { type: Date, default: null },

    // Room
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', default: null, index: true },

    // Hardware
    macAddress: { type: String, default: null, uppercase: true, trim: true },

    // Warranty (set on first pairing, never reset)
    warrantyStartDate: { type: Date, default: null },

    // Status
    isOnline: { type: Boolean, default: false, index: true },
    lastSeen: { type: Date, default: null, index: true },

    // WiFi
    wifiConfigured: { type: Boolean, default: false },
    lastInquiryAt: { type: Date, default: null },

    // State
    state: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.__v;
        delete ret.mqttToken;
        delete ret.mqttUsername;
        delete ret.mqttPassword;
        return ret;
      },
    },
  }
);

deviceSchema.index({ owner: 1, isOnline: 1 });
deviceSchema.index({ isOnline: 1, lastSeen: 1 });

deviceSchema.methods.isOwnedBy = function (userId) {
  return this.owner && this.owner.toString() === userId.toString();
};

deviceSchema.statics.findBySerialNumber = function (serialNumber) {
  return this.findOne({ serialNumber: serialNumber.toUpperCase().trim() });
};

deviceSchema.statics.findByOwner = function (ownerId) {
  return this.find({ owner: ownerId }).sort({ pairedAt: -1 });
};

module.exports = mongoose.model('Device', deviceSchema);
