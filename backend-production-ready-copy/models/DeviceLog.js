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

    // Actor: the user who triggered this log. Null for device/server/mqtt-originated logs.
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    performedByName: { type: String, default: null },
    performedByRole: {
      type: String,
      enum: ['owner', 'shared', 'system'],
      default: 'system',
    },

    // Structured action key (e.g. 'open', 'close', 'rename') alongside the rendered message
    action: { type: String, default: null },
  },
  {
    timestamps: true,
  }
);

deviceLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
deviceLogSchema.index({ serialNumber: 1, createdAt: -1 });
deviceLogSchema.index({ serialNumber: 1, performedBy: 1, createdAt: -1 });

module.exports = mongoose.model('DeviceLog', deviceLogSchema);
