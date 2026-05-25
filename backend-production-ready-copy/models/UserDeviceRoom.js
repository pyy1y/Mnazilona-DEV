const mongoose = require('mongoose');

// One row per (user, device). Tells us which room THIS user has put the device in.
// Owners' assignments still live on Device.room so the existing owner code path
// is untouched. Shared users' assignments live here.
const userDeviceRoomSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
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
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

userDeviceRoomSchema.index({ user: 1, device: 1 }, { unique: true });
userDeviceRoomSchema.index({ user: 1, room: 1 });

module.exports = mongoose.model('UserDeviceRoom', userDeviceRoomSchema);
