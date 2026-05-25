const Device = require('../models/Device');
const DeviceShare = require('../models/DeviceShare');

// Returns the caller's effective role on a device, with the loaded device and
// (if applicable) the active share row attached so callers can avoid a second
// round-trip.
//
//   role: 'owner' | 'shared' | 'none'
//
// Accepts either a serial number string or a Mongo ObjectId hex.
async function getDeviceAccessRole(userId, serialOrId) {
  if (!userId || !serialOrId) {
    return { role: 'none', device: null, share: null };
  }

  const looksLikeObjectId = /^[0-9a-fA-F]{24}$/.test(String(serialOrId));
  const query = looksLikeObjectId
    ? { _id: serialOrId }
    : { serialNumber: String(serialOrId).trim().toUpperCase() };

  const device = await Device.findOne(query);
  if (!device) return { role: 'none', device: null, share: null };

  if (device.owner && device.owner.toString() === userId.toString()) {
    return { role: 'owner', device, share: null };
  }

  const share = await DeviceShare.findOne({
    device: device._id,
    sharedWith: userId,
    status: 'active',
  });
  if (share) return { role: 'shared', device, share };

  return { role: 'none', device, share: null };
}

const isDeviceOwner = async (userId, serialOrId) =>
  (await getDeviceAccessRole(userId, serialOrId)).role === 'owner';

const hasAcceptedSharedAccess = async (userId, serialOrId) =>
  (await getDeviceAccessRole(userId, serialOrId)).role === 'shared';

module.exports = {
  getDeviceAccessRole,
  isDeviceOwner,
  hasAcceptedSharedAccess,
};
