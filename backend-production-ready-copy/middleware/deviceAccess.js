const Device = require('../models/Device');
const DeviceShare = require('../models/DeviceShare');

const ACCESS_LEVELS = ['owner', 'control', 'view'];

// Permission required → permission(s) on the share row that satisfy it.
const SATISFYING_PERMISSIONS = {
  control: ['control'],
  view: ['view', 'control'], // control implies view
};

const requireDeviceAccess = (level = 'view') => {
  if (!ACCESS_LEVELS.includes(level)) {
    throw new Error(`requireDeviceAccess: invalid level "${level}"`);
  }

  return async (req, res, next) => {
    try {
      const serialNumber = req.params.serialNumber || req.body.serialNumber;
      if (!serialNumber) {
        return res.status(400).json({ message: 'Serial number is required' });
      }

      const cleanSerial = String(serialNumber).trim().toUpperCase();
      const userId = req.user.id;

      const device = await Device.findOne({ serialNumber: cleanSerial });
      if (!device) {
        return res.status(404).json({ message: 'Device not found' });
      }

      const isOwner = device.owner && device.owner.toString() === userId.toString();

      if (level === 'owner') {
        if (!isOwner) {
          console.warn(`ACL violation: User ${userId} tried owner-only action on ${cleanSerial}`);
          return res.status(403).json({ message: 'Only the device owner can perform this action' });
        }
      } else {
        let allowed = isOwner;
        if (!allowed) {
          const required = SATISFYING_PERMISSIONS[level];
          const share = await DeviceShare.findOne({
            device: device._id,
            sharedWith: userId,
            status: 'active',
            permissions: { $in: required },
          });
          allowed = !!share;
          if (allowed) {
            req.deviceShare = share;
          }
        }

        if (!allowed) {
          console.warn(`ACL violation: User ${userId} lacks "${level}" access to ${cleanSerial}`);
          return res.status(403).json({ message: 'Access denied' });
        }
      }

      req.device = device;
      req.deviceRole = isOwner ? 'owner' : 'shared';
      next();
    } catch (error) {
      console.error('Device access check error:', error.message);
      res.status(500).json({ message: 'Access control check failed' });
    }
  };
};

module.exports = { requireDeviceAccess };
