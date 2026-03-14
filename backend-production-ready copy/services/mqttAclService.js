const Device = require('../models/Device');
const AllowedDevice = require('../models/AllowedDevice');

const DEVICE_TOPIC_REGEX = /^manazel\/devices\/([A-Za-z0-9\-_.]+)\/(command|status|heartbeat|dp\/report)$/;

const DEVICE_PUBLISH_LEAVES = ['status', 'heartbeat', 'dp/report'];
const DEVICE_SUBSCRIBE_LEAVES = ['command'];
const USER_PUBLISH_LEAVES = ['command'];
const USER_SUBSCRIBE_LEAVES = ['status', 'heartbeat', 'dp/report'];

const parseTopic = (topic) => {
  const match = topic.match(DEVICE_TOPIC_REGEX);
  if (!match) return null;
  return { serialNumber: match[1], leaf: match[2] };
};

const canUserAccessDevice = async (userId, serialNumber) => {
  const device = await Device.findOne({
    serialNumber: serialNumber.toUpperCase().trim(),
    owner: userId,
  });
  return !!device;
};

const canUserPublish = async (userId, topic) => {
  const parsed = parseTopic(topic);
  if (!parsed) return false;
  if (!USER_PUBLISH_LEAVES.includes(parsed.leaf)) return false;
  return canUserAccessDevice(userId, parsed.serialNumber);
};

const canUserSubscribe = async (userId, topic) => {
  const parsed = parseTopic(topic);
  if (!parsed) return false;
  if (!USER_SUBSCRIBE_LEAVES.includes(parsed.leaf)) return false;
  return canUserAccessDevice(userId, parsed.serialNumber);
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
  const devices = await Device.find({ owner: userId }).select('serialNumber').lean();

  const acl = { publish: [], subscribe: [] };

  devices.forEach((device) => {
    USER_PUBLISH_LEAVES.forEach((leaf) => {
      acl.publish.push(`manazel/devices/${device.serialNumber}/${leaf}`);
    });
    USER_SUBSCRIBE_LEAVES.forEach((leaf) => {
      acl.subscribe.push(`manazel/devices/${device.serialNumber}/${leaf}`);
    });
  });

  return acl;
};

const getDeviceACL = (serialNumber) => {
  const sn = serialNumber.toUpperCase().trim();
  return {
    publish: DEVICE_PUBLISH_LEAVES.map((leaf) => `manazel/devices/${sn}/${leaf}`),
    subscribe: DEVICE_SUBSCRIBE_LEAVES.map((leaf) => `manazel/devices/${sn}/${leaf}`),
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
        if (password === backendPass) {
          return res.json({ result: 'allow' });
        }
        return res.json({ result: 'deny' });
      }

      if (username.startsWith('dev_')) {
        const serialNumber = username.replace('dev_', '');
        const device = await AllowedDevice.findOne({
          serialNumber: serialNumber.toUpperCase().trim(),
          isBanned: false,
        }).select('+mqttPassword');

        if (device && device.mqttPassword === password) {
          return res.json({ result: 'allow' });
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
  canUserPublish,
  canUserSubscribe,
  canDevicePublish,
  canDeviceSubscribe,
  getUserACL,
  getDeviceACL,
  enforceDeviceOwnership,
  mqttAuthWebhook,
};
