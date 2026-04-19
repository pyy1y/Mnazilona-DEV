const mongoose = require('mongoose');

const firmwareSchema = new mongoose.Schema(
  {
    version: {
      type: String,
      required: [true, 'Version is required'],
      trim: true,
    },
    deviceType: {
      type: String,
      enum: ['relay', 'sensor', 'switch', 'light', 'dimmer', 'water-tank', 'ac', 'security', 'lock', 'other'],
      required: [true, 'Device type is required'],
    },
    changelog: {
      type: String,
      default: '',
      maxlength: 2000,
    },
    isStable: {
      type: Boolean,
      default: false,
    },
    // OTA file info
    filePath: { type: String, default: null },
    fileSize: { type: Number, default: null },
    checksum: { type: String, default: null },       // SHA256 of firmware binary
    signature: { type: String, default: null },      // RSA signature (base64) for OTA verification
    downloadUrl: { type: String, default: null },
    // Rollout
    isActive: { type: Boolean, default: true },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: { transform: (doc, ret) => { delete ret.__v; return ret; } },
  }
);

firmwareSchema.index({ deviceType: 1, version: 1 }, { unique: true });
firmwareSchema.index({ deviceType: 1, isStable: 1 });

module.exports = mongoose.model('Firmware', firmwareSchema);
