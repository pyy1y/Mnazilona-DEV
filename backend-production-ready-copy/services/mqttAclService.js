const crypto = require('crypto');
const Device = require('../models/Device');
const AllowedDevice = require('../models/AllowedDevice');
const DeviceShare = require('../models/DeviceShare');

const DEVICE_TOPIC_REGEX = /^mnazilona\/devices\/([A-Za-z0-9\-_.]+)\/(command|status|heartbeat|dp\/report|ota\/progress)$/;

const DEVICE_PUBLISH_LEAVES = ['status', 'heartbeat', 'dp/report', 'ota/progress'];
const DEVICE_SUBSCRIBE_LEAVES = ['command'];
const USER_PUBLISH_LEAVES = ['command'];
const USER_SUBSCRIBE_LEAVES = ['status', 'heartbeat', 'dp/report'];

const parseTopic = (topic) => {
  const match = topic.match(DEVICE_TOPIC_REGEX);
  if (!match) return null;
  return { serialNumber: match[1], leaf: match[2] };
};

const canUserAccessDevice = async (userId, serialNumber) => {
  const cleanSerial = serialNumber.toUpperCase().trim();
  const device = await Device.findOne({ serialNumber: cleanSerial });
  if (!device) return false;
  if (device.owner && device.owner.toString() === userId.toString()) return true;

  const share = await DeviceShare.findOne({
    device: device._id,
    sharedWith: userId,
    status: 'active',
  });
  return !!share;
};

// Returns the user's access on a device: { role: 'owner'|'shared', permissions }
// or null if no access. Used by canUserPublish/Subscribe and reusable.
const getUserDeviceAccess = async (userId, serialNumber) => {
  const cleanSerial = serialNumber.toUpperCase().trim();
  const device = await Device.findOne({ serialNumber: cleanSerial });
  if (!device) return null;
  if (device.owner && device.owner.toString() === userId.toString()) {
    return { role: 'owner', permissions: ['view', 'control'], device };
  }
  const share = await DeviceShare.findOne({
    device: device._id,
    sharedWith: userId,
    status: 'active',
  }).select('permissions');
  if (!share) return null;
  return { role: 'shared', permissions: share.permissions || [], device };
};

const canUserPublish = async (userId, topic) => {
  const parsed = parseTopic(topic);
  if (!parsed) return false;
  if (!USER_PUBLISH_LEAVES.includes(parsed.leaf)) return false;
  const access = await getUserDeviceAccess(userId, parsed.serialNumber);
  if (!access) return false;
  return access.role === 'owner' || access.permissions.includes('control');
};

const canUserSubscribe = async (userId, topic) => {
  const parsed = parseTopic(topic);
  if (!parsed) return false;
  if (!USER_SUBSCRIBE_LEAVES.includes(parsed.leaf)) return false;
  const access = await getUserDeviceAccess(userId, parsed.serialNumber);
  return !!access; // any active access (owner or shared) can subscribe
};

const canDevicePublish = async (deviceSerialNumber, topic) => {
  const parsed = parseTopic(topic);
  if (!parsed) return false;
  if (parsed.serialNumber !== deviceSerialNumber.toUpperCase().trim()) return false;
  if (!DEVICE_PUBLISH_LEAVES.includes(parsed.leaf)) return false;
  const allowed = await AllowedDevice.findAllowed(deviceSerialNumber);
  return !!allowed;
};

const canDeviceSubscribe = async (deviceSerialNumber, topic) => {
  const parsed = parseTopic(topic);
  if (!parsed) return false;
  if (parsed.serialNumber !== deviceSerialNumber.toUpperCase().trim()) return false;
  if (!DEVICE_SUBSCRIBE_LEAVES.includes(parsed.leaf)) return false;
  const allowed = await AllowedDevice.findAllowed(deviceSerialNumber);
  return !!allowed;
};

const getUserACL = async (userId) => {
  const [ownedDevices, activeShares] = await Promise.all([
    Device.find({ owner: userId }).select('serialNumber').lean(),
    DeviceShare.find({ sharedWith: userId, status: 'active' })
      .select('serialNumber permissions')
      .lean(),
  ]);

  const acl = { publish: [], subscribe: [] };
  const seen = new Set();

  // Owners get full publish + subscribe access on their devices.
  ownedDevices.forEach((device) => {
    if (seen.has(device.serialNumber)) return;
    seen.add(device.serialNumber);
    USER_PUBLISH_LEAVES.forEach((leaf) => {
      acl.publish.push(`mnazilona/devices/${device.serialNumber}/${leaf}`);
    });
    USER_SUBSCRIBE_LEAVES.forEach((leaf) => {
      acl.subscribe.push(`mnazilona/devices/${device.serialNumber}/${leaf}`);
    });
  });

  // Shared users get publish on user-publish topics only when they have
  // 'control'; subscribe is granted whenever they have any active share
  // (control implies view).
  activeShares.forEach((share) => {
    if (seen.has(share.serialNumber)) return;
    seen.add(share.serialNumber);

    const perms = Array.isArray(share.permissions) ? share.permissions : [];
    const canControl = perms.includes('control');

    if (canControl) {
      USER_PUBLISH_LEAVES.forEach((leaf) => {
        acl.publish.push(`mnazilona/devices/${share.serialNumber}/${leaf}`);
      });
    }
    USER_SUBSCRIBE_LEAVES.forEach((leaf) => {
      acl.subscribe.push(`mnazilona/devices/${share.serialNumber}/${leaf}`);
    });
  });

  return acl;
};

const getDeviceACL = (serialNumber) => {
  const sn = serialNumber.toUpperCase().trim();
  return {
    publish: DEVICE_PUBLISH_LEAVES.map((leaf) => `mnazilona/devices/${sn}/${leaf}`),
    subscribe: DEVICE_SUBSCRIBE_LEAVES.map((leaf) => `mnazilona/devices/${sn}/${leaf}`),
  };
};

const enforceDeviceOwnership = async (req, res, next) => {
  try {
    const serialNumber = req.params.serialNumber || req.body.serialNumber;
    if (!serialNumber) {
      return res.status(400).json({ message: 'Serial number is required' });
    }

    const userId = req.user.id;
    const hasAccess = await canUserAccessDevice(userId, serialNumber);

    if (!hasAccess) {
      console.warn(`ACL violation: User ${userId} tried to access device ${serialNumber}`);
      return res.status(403).json({ message: 'Access denied - device not owned by you' });
    }

    next();
  } catch (error) {
    console.error('ACL check error:', error.message);
    res.status(500).json({ message: 'Access control check failed' });
  }
};

const mqttAuthWebhook = async (req, res) => {
  try {
    const { username, password, topic, action } = req.body;

    if (!username) {
      return res.status(400).json({ result: 'deny' });
    }

    // Authentication (no topic/action = login request)
    if (!topic && !action) {
      const backendUser = process.env.MQTT_USERNAME || 'mqtt-user';
      const backendPass = process.env.MQTT_PASSWORD || '';
      if (username === backendUser) {
        // Timing-safe comparison to prevent timing attacks
        const passBuffer = Buffer.from(password || '');
        const expectedBuffer = Buffer.from(backendPass);
        if (passBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(passBuffer, expectedBuffer)) {
          return res.json({ result: 'allow' });
        }
        return res.json({ result: 'deny' });
      }

      if (username.startsWith('dev_')) {
        const serialNumber = username.replace('dev_', '');
        const device = await AllowedDevice.findOne({
          serialNumber: serialNumber.toUpperCase().trim(),
          isBanned: false,
        }).select('+mqttPassword +mqttPasswordHash');

        if (device) {
          const isValid = await device.verifyMqttPassword(password);
          if (isValid) {
            return res.json({ result: 'allow' });
          }
        }
        console.warn(`MQTT auth denied: ${username} - invalid credentials`);
        return res.json({ result: 'deny' });
      }

      return res.json({ result: 'deny' });
    }

    // Authorization (topic + action = permission request)
    if (!topic || !action) {
      return res.status(400).json({ result: 'deny' });
    }

    const backendUser = process.env.MQTT_USERNAME || 'mqtt-user';
    if (username === backendUser) {
      return res.json({ result: 'allow' });
    }

    if (username.startsWith('dev_')) {
      const serialNumber = username.replace('dev_', '');

      if (action === 'publish') {
        const allowed = await canDevicePublish(serialNumber, topic);
        return res.json({ result: allowed ? 'allow' : 'deny' });
      }

      if (action === 'subscribe') {
        const allowed = await canDeviceSubscribe(serialNumber, topic);
        return res.json({ result: allowed ? 'allow' : 'deny' });
      }
    }

    return res.json({ result: 'deny' });
  } catch (error) {
    console.error('MQTT auth webhook error:', error.message);
    return res.json({ result: 'deny' }); // Fail-closed
  }
};

module.exports = {
  parseTopic,
  canUserAccessDevice,
  getUserDeviceAccess,
  canUserPublish,
  canUserSubscribe,
  canDevicePublish,
  canDeviceSubscribe,
  getUserACL,
  getDeviceACL,
  enforceDeviceOwnership,
  mqttAuthWebhook,
};
