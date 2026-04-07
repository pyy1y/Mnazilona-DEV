const mongoose = require('mongoose');

const deviceLogSchema = new mongoose.Schema(
  {
    serialNumber: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['info', 'warning', 'error'],
      default: 'info',
    },
    message: {
      type: String,
      required: true,
      maxlength: 500,
    },
    source: {
      type: String,
      enum: ['device', 'server', 'user', 'mqtt'],
      default: 'server',
    },
  },
  {
    timestamps: true,
  }
);

deviceLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
deviceLogSchema.index({ serialNumber: 1, createdAt: -1 });

module.exports = mongoose.model('DeviceLog', deviceLogSchema);
