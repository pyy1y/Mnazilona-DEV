const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Device = require('../models/Device');
const AllowedDevice = require('../models/AllowedDevice');
const DeviceLog = require('../models/DeviceLog');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Firmware = require('../models/Firmware');
const { topicOf, publishMessage, MQTT_BROKER_HOST, invalidateDeviceMeta } = require('../config/mqtt');
const { emitToUser, emitToAdminDevicesView } = require('../config/socket');
const { canUserAccessDevice, getDeviceACL } = require('../services/mqttAclService');
const { trackDeviceCommand, trackPairAttempt } = require('../services/anomalyDetector');
const { buildCommandHmac } = require('../utils/commandSigner');
const {
  buildIdempotencyKey,
  getIdempotentResponse,
  storeIdempotentResponse,
} = require('../services/idempotencyService');

const ALLOWED_COMMANDS = ['open', 'on', 'off', 'toggle', 'status', 'restart', 'config'];

function parseBrokerUrl(url) {
  if (!url) return { host: '', port: 1883 };

  let cleaned = url.trim();
  cleaned = cleaned.replace(/^(mqtt|mqtts|tcp|ssl|ws|wss):\/\//i, '');
  cleaned = cleaned.replace(/\/+$/, '');

  const parts = cleaned.split(':');
  const host = parts[0];
  const port = parts[1] ? parseInt(parts[1], 10) : 1883;

  return { host, port: isNaN(port) ? 1883 : port };
}

const sanitizeDeviceResponse = (device) => ({
  id: device._id,
  name: device.name,
  serialNumber: device.serialNumber,
  macAddress: device.macAddress || null,
  deviceType: device.deviceType,
  isOnline: device.isOnline,
  lastSeen: device.lastSeen,
  pairedAt: device.pairedAt,
  state: device.state,
});

// ============================================================
// inquiry - ESP32 device setup endpoint
// ============================================================
exports.inquiry = async (req, res) => {
  try {
    const { serialNumber, deviceSecret, macAddress } = req.body;

    if (!serialNumber || typeof serialNumber !== 'string') {
      return res.status(400).json({ message: 'Valid serial number is required' });
    }
    if (!deviceSecret || typeof deviceSecret !== 'string') {
      return res.status(400).json({ message: 'Device secret is required' });
    }

    const cleanSerial = serialNumber.trim().toUpperCase();
    console.log(`Device inquiry: ${cleanSerial} from IP: ${req.ip}`);

    const GENERIC_REJECT = 'Device not authorized';

    const allowedDevice = await AllowedDevice.findAllowedWithSecret(cleanSerial);
    if (!allowedDevice) {
      console.warn(`Inquiry rejected: ${cleanSerial} - Not in allowlist`);
      return res.status(403).json({ message: GENERIC_REJECT });
    }

    if (allowedDevice.isBanned) {
      console.warn(`Inquiry rejected: ${cleanSerial} - Device is banned`);
      return res.status(403).json({ message: GENERIC_REJECT });
    }

    if (allowedDevice.isLocked()) {
      console.warn(`Inquiry rejected: ${cleanSerial} - Locked`);
      return res.status(429).json({
        message: 'Too many attempts. Try again later.',
      });
    }

    if (!allowedDevice.verifySecret(deviceSecret)) {
      await allowedDevice.recordFailedAttempt();
      console.warn(`Inquiry rejected: ${cleanSerial} - Invalid secret (attempt ${allowedDevice.failedAttempts})`);
      return res.status(403).json({ message: GENERIC_REJECT });
    }

    await allowedDevice.resetFailedAttempts();

    let device = await Device.findOne({ serialNumber: cleanSerial });
    if (!device) {
      device = new Device({
        name: `Device ${cleanSerial}`,
        serialNumber: cleanSerial,
        deviceType: allowedDevice.deviceType,
        firmwareVersion: allowedDevice.firmwareVersion,
      });
    }

    if (macAddress && typeof macAddress === 'string') {
      device.macAddress = macAddress.trim().toUpperCase();
    }

    const broker = parseBrokerUrl(MQTT_BROKER_HOST);

    device.mqttUsername = allowedDevice.mqttUsername;
    device.mqttPassword = allowedDevice.mqttPassword;
    device.brokerUrl = broker.host;
    device.mqttToken = crypto.randomBytes(32).toString('hex');
    device.wifiConfigured = true;
    device.lastInquiryAt = new Date();
    await device.save();

    if (!allowedDevice.isActivated) {
      allowedDevice.isActivated = true;
      allowedDevice.activatedAt = new Date();
    }
    allowedDevice.lastInquiryAt = new Date();
    await allowedDevice.save();

    console.log(`Inquiry success: ${cleanSerial} -> broker: ${broker.host}:${broker.port}`);

    const macInfo = device.macAddress ? ` (MAC: ${device.macAddress})` : '';
    await DeviceLog.create({
      serialNumber: cleanSerial,
      type: 'info',
      message: `Device booted and connected to server${macInfo}`,
      source: 'server',
    });

    const isOwned = !!(device.owner);

    res.json({
      brokerHost: broker.host,
      brokerPort: broker.port,
      brokerUrl: broker.host,
      mqttUsername: allowedDevice.mqttUsername,
      mqttPassword: allowedDevice.mqttPassword,
      mqttToken: device.mqttToken,
      topics: getDeviceACL(cleanSerial),
      isOwned,
      message: 'Configuration retrieved successfully',
    });
  } catch (error) {
    console.error('Inquiry error:', error.message);
    res.status(500).json({ message: 'Failed to retrieve configuration' });
  }
};

// ============================================================
// pair - Pair device to user
// ============================================================
exports.pair = async (req, res) => {
  try {
    const { serialNumber, deviceSecret, requestId } = req.body;
    const userId = req.user.id;

    if (!serialNumber || typeof serialNumber !== 'string') {
      return res.status(400).json({ message: 'Valid serial number is required' });
    }

    if (!deviceSecret || typeof deviceSecret !== 'string') {
      return res.status(400).json({ message: 'Device secret is required for pairing' });
    }

    const cleanSerial = serialNumber.trim().toUpperCase();
    const cleanRequestId = typeof requestId === 'string' ? requestId.trim() : '';
    const idempotencyKey = buildIdempotencyKey(
      'device-pair',
      cleanRequestId,
      userId,
      cleanSerial
    );
    const cachedResponse = await getIdempotentResponse(idempotencyKey);

    if (cachedResponse) {
      return res.status(cachedResponse.status).json(cachedResponse.body);
    }

    // Track pair attempts for anomaly detection (device takeover)
    trackPairAttempt(cleanSerial, req.ip);

    const GENERIC_REJECT = 'Device not authorized for pairing';

    const allowedDevice = await AllowedDevice.findAllowedWithSecret(cleanSerial);
    if (!allowedDevice) {
      return res.status(403).json({ message: GENERIC_REJECT });
    }

    if (allowedDevice.isBanned) {
      return res.status(403).json({ message: GENERIC_REJECT });
    }

    if (!allowedDevice.verifySecret(deviceSecret)) {
      return res.status(403).json({ message: GENERIC_REJECT });
    }

    const device = await Device.findOne({ serialNumber: cleanSerial });
    if (!device) {
      return res.status(404).json({
        message: 'Device not found. Make sure the device has completed WiFi setup first.',
      });
    }

    if (device.owner) {
      if (device.owner.toString() === userId) {
        const responseBody = {
          message: 'Device already paired to your account',
          device: sanitizeDeviceResponse(device),
          ...(cleanRequestId ? { requestId: cleanRequestId } : {}),
        };

        await storeIdempotentResponse(idempotencyKey, {
          status: 200,
          body: responseBody,
        });

        return res.status(200).json(responseBody);
      }

      try {
        const existingRequest = await Notification.hasPendingRequest(
          device.owner, cleanSerial, userId
        );

        if (!existingRequest) {
          const requester = await User.findById(userId).select('email name');
          const requesterEmail = requester?.email || 'Unknown';
          const requesterName = requester?.name || 'Someone';

          await Notification.create({
            recipient: device.owner,
            type: 'transfer_request',
            message: `${requesterName} is trying to link your device "${device.name || cleanSerial}". Do you want to unlink it?`,
            data: {
              serialNumber: cleanSerial,
              deviceName: device.name || cleanSerial,
              requesterId: userId,
              requesterEmail,
            },
          });

          console.log(`Transfer request sent to owner of ${cleanSerial} from user ${userId}`);

          await DeviceLog.create({
            serialNumber: cleanSerial,
            type: 'warning',
            message: 'Pairing attempt by another user - notification sent to owner',
            source: 'server',
          });
        }
      } catch (notifErr) {
        console.error('Notification creation failed:', notifErr.message);
      }

      const responseBody = {
        message: 'This device is owned by someone else. A request has been sent to the owner to unlink it. You will be notified if they approve.',
        ownerNotified: true,
        ...(cleanRequestId ? { requestId: cleanRequestId } : {}),
      };

      await storeIdempotentResponse(idempotencyKey, {
        status: 409,
        body: responseBody,
      });

      return res.status(409).json(responseBody);
    }

    device.owner = userId;
    device.pairedAt = new Date();
    if (!device.warrantyStartDate) {
      device.warrantyStartDate = new Date();
    }
    await device.save();

    allowedDevice.activatedBy = userId;
    await allowedDevice.save();

    // Ownership changed - drop the cached owner so future MQTT messages
    // route socket events to the new owner.
    invalidateDeviceMeta(cleanSerial);

    // Push the newly paired device to the user's app sockets so the home
    // screen can render it without an extra HTTP roundtrip.
    const paired = sanitizeDeviceResponse(device);
    emitToUser(userId, 'device:paired', paired);

    // Admin devices index: receive the new row so it can prepend without
    // a refetch. Lobby notification (for a future "new pairings" badge)
    // can be added when there's a consumer.
    emitToAdminDevicesView('device:paired', paired);

    try {
      const topic = topicOf(cleanSerial, 'command');
      await publishMessage(topic, {
        command: 'paired',
        source: 'system',
        userId,
        ts: Date.now(),
      });
    } catch (mqttErr) {
      console.log('MQTT notify failed (non-critical):', mqttErr.message);
    }

    console.log(`Device ${cleanSerial} paired to user ${userId}`);

    await DeviceLog.create({
      serialNumber: cleanSerial,
      type: 'info',
      message: 'Device paired to user account',
      source: 'server',
    });

    const responseBody = {
      message: 'Device paired successfully',
      device: sanitizeDeviceResponse(device),
      ...(cleanRequestId ? { requestId: cleanRequestId } : {}),
    };

    await storeIdempotentResponse(idempotencyKey, {
      status: 200,
      body: responseBody,
    });

    res.json(responseBody);
  } catch (error) {
    console.error('Pair device error:', error.message);
    res.status(500).json({ message: 'Failed to pair device' });
  }
};

// ============================================================
// unpair - Unpair device
// ============================================================
exports.unpair = async (req, res) => {
  try {
    const { serialNumber } = req.body;
    const userId = req.user.id;

    if (!serialNumber || typeof serialNumber !== 'string') {
      return res.status(400).json({ message: 'Valid serial number is required' });
    }

    const cleanSerial = serialNumber.trim().toUpperCase();
    const device = await Device.findOne({ serialNumber: cleanSerial, owner: userId });

    if (!device) {
      return res.status(404).json({ message: 'Device not found or not owned by you' });
    }

    const previousOwner = device.owner;

    device.owner = null;
    device.pairedAt = null;
    await device.save();

    await DeviceLog.deleteMany({ serialNumber: cleanSerial });

    await AllowedDevice.findOneAndUpdate(
      { serialNumber: cleanSerial },
      { activatedBy: null }
    );

    // Ownership changed - drop cache + tell the previous owner's sockets
    invalidateDeviceMeta(cleanSerial);
    if (previousOwner) {
      emitToUser(previousOwner, 'device:unpaired', { serialNumber: cleanSerial });
    }
    emitToAdminDevicesView('device:unpaired', { serialNumber: cleanSerial });

    try {
      const topic = topicOf(cleanSerial, 'command');
      await publishMessage(topic, {
        command: 'unpaired',
        source: 'system',
        ts: Date.now(),
      });
    } catch (mqttErr) {
      console.log('MQTT notify failed (non-critical):', mqttErr.message);
    }

    console.log(`Device ${cleanSerial} unpaired from user ${userId}`);

    await DeviceLog.create({
      serialNumber: cleanSerial,
      type: 'warning',
      message: 'Device unpaired from user account',
      source: 'server',
    });

    res.json({ message: 'Device unpaired successfully' });
  } catch (error) {
    console.error('Unpair device error:', error.message);
    res.status(500).json({ message: 'Failed to unpair device' });
  }
};

// ============================================================
// getAll - List all user devices
// ============================================================
exports.getAll = async (req, res) => {
  try {
    const devices = await Device.find({ owner: req.user.id })
      .select('name serialNumber macAddress deviceType isOnline lastSeen pairedAt warrantyStartDate state room')
      .sort({ pairedAt: -1 })
      .lean();

    res.json({ count: devices.length, devices });
  } catch (error) {
    console.error('Get devices error:', error.message);
    res.status(500).json({ message: 'Failed to fetch devices' });
  }
};

// ============================================================
// getOne - Get single device
// ============================================================
exports.getOne = async (req, res) => {
  try {
    const { serialNumber } = req.params;
    if (!serialNumber) return res.status(400).json({ message: 'Serial number is required' });

    const cleanSerial = serialNumber.trim().toUpperCase();
    const device = await Device.findOne({ serialNumber: cleanSerial, owner: req.user.id }).lean();

    if (!device) return res.status(404).json({ message: 'Device not found or not owned by you' });

    res.json(sanitizeDeviceResponse(device));
  } catch (error) {
    console.error('Get device error:', error.message);
    res.status(500).json({ message: 'Failed to fetch device' });
  }
};

// ============================================================
// sendCommand - Send command to device
// ============================================================
exports.sendCommand = async (req, res) => {
  try {
    const { serialNumber } = req.params;
    const { command, params, requestId } = req.body;
    const userId = req.user.id;

    if (!serialNumber) return res.status(400).json({ message: 'Serial number is required' });
    if (!command || typeof command !== 'string') {
      return res.status(400).json({ message: 'Valid command is required' });
    }

    const cleanCommand = command.trim().toLowerCase();
    if (!ALLOWED_COMMANDS.includes(cleanCommand)) {
      return res.status(400).json({
        message: `Invalid command. Allowed: ${ALLOWED_COMMANDS.join(', ')}`,
      });
    }

    const cleanSerial = serialNumber.trim().toUpperCase();
    const cleanRequestId = typeof requestId === 'string' ? requestId.trim() : '';
    const idempotencyKey = buildIdempotencyKey(
      'device-command',
      cleanRequestId,
      userId,
      cleanSerial,
      cleanCommand
    );
    const cachedResponse = await getIdempotentResponse(idempotencyKey);

    if (cachedResponse) {
      return res.status(cachedResponse.status).json(cachedResponse.body);
    }

    const device = await Device.findOne({ serialNumber: cleanSerial, owner: userId })
      .select('+mqttToken');
    if (!device) return res.status(404).json({ message: 'Device not found or not owned by you' });
    if (device.adminLocked) return res.status(423).json({ message: 'Device is locked by admin. Contact support.' });
    if (!device.isOnline) return res.status(503).json({ message: 'Device is offline' });
    if (!device.mqttToken) return res.status(503).json({ message: 'Device command channel is not ready' });

    const allowed = await AllowedDevice.findAllowed(cleanSerial);
    if (!allowed) {
      return res.status(403).json({ message: 'Device is no longer authorized' });
    }

    // Track device command frequency for anomaly detection
    trackDeviceCommand(cleanSerial, req.ip);

    const topic = topicOf(cleanSerial, 'command');
    const ts = Date.now().toString();
    const payload = {
      command: cleanCommand,
      params: params || {},
      ts,
      userId,
      source: 'user',
      hmac: device.mqttToken ? buildCommandHmac(device.mqttToken, cleanCommand, ts) : '',
      ...(cleanRequestId ? { requestId: cleanRequestId } : {}),
    };

    try {
      await publishMessage(topic, payload);

      await DeviceLog.create({
        serialNumber: cleanSerial,
        type: 'info',
        message: `Command "${cleanCommand}" sent`,
        source: 'user',
      });

      const responseBody = {
        message: 'Command sent successfully',
        command: cleanCommand,
        sentAt: new Date().toISOString(),
        ...(cleanRequestId ? { requestId: cleanRequestId } : {}),
      };

      await storeIdempotentResponse(idempotencyKey, {
        status: 200,
        body: responseBody,
      });

      res.json(responseBody);
    } catch (mqttError) {
      return res.status(503).json({ message: 'Failed to send command - MQTT unavailable' });
    }
  } catch (error) {
    console.error('Command error:', error.message);
    res.status(500).json({ message: 'Failed to send command' });
  }
};

// ============================================================
// validateDevice - Validate device before pairing
// ============================================================
exports.validateDevice = async (req, res) => {
  try {
    const { serialNumber } = req.body;

    if (!serialNumber || typeof serialNumber !== 'string') {
      return res.status(400).json({ message: 'Valid serial number is required' });
    }

    const cleanSerial = serialNumber.trim().toUpperCase();

    const allowedDevice = await AllowedDevice.findOne({
      serialNumber: cleanSerial,
    });

    if (!allowedDevice) {
      return res.status(404).json({
        valid: false,
        message: 'Device not recognized. Check the serial number.',
      });
    }

    if (allowedDevice.isBanned) {
      return res.status(403).json({
        valid: false,
        message: 'This device has been suspended. Contact support.',
      });
    }

    const device = await Device.findOne({ serialNumber: cleanSerial });
    const isPaired = device && device.owner;
    const isSetupComplete = device && device.wifiConfigured;

    res.json({
      valid: true,
      serialNumber: cleanSerial,
      deviceType: allowedDevice.deviceType,
      isActivated: allowedDevice.isActivated,
      isSetupComplete: !!isSetupComplete,
      isPaired: !!isPaired,
      message: isPaired
        ? 'Device is already paired to a user'
        : isSetupComplete
          ? 'Device is ready for pairing'
          : 'Device needs WiFi setup first',
    });
  } catch (error) {
    console.error('Validate device error:', error.message);
    res.status(500).json({ message: 'Failed to validate device' });
  }
};

// ============================================================
// renameDevice
// ============================================================
exports.renameDevice = async (req, res) => {
  try {
    const { serialNumber } = req.params;
    const { name } = req.body;
    const userId = req.user.id;

    if (!serialNumber) return res.status(400).json({ message: 'Serial number is required' });
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'Valid name is required' });
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 100) {
      return res.status(400).json({ message: 'Name must be 100 characters or less' });
    }

    const cleanSerial = serialNumber.trim().toUpperCase();
    const device = await Device.findOne({ serialNumber: cleanSerial, owner: userId });

    if (!device) return res.status(404).json({ message: 'Device not found or not owned by you' });

    const oldName = device.name;
    device.name = trimmedName;
    await device.save();

    await DeviceLog.create({
      serialNumber: cleanSerial,
      type: 'info',
      message: `Device renamed from "${oldName}" to "${trimmedName}"`,
      source: 'user',
    });

    // Push the new name to all of this user's app sockets so the rename
    // shows up everywhere (other devices, other tabs) instantly.
    emitToUser(userId, 'device:update', {
      serialNumber: cleanSerial,
      name: trimmedName,
    });

    res.json({
      message: 'Device renamed successfully',
      device: sanitizeDeviceResponse(device),
    });
  } catch (error) {
    console.error('Rename device error:', error.message);
    res.status(500).json({ message: 'Failed to rename device' });
  }
};

// ============================================================
// getLogs - Get device logs with pagination
// ============================================================
exports.getLogs = async (req, res) => {
  try {
    const { serialNumber } = req.params;
    const userId = req.user.id;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    if (!serialNumber) return res.status(400).json({ message: 'Serial number is required' });

    const cleanSerial = serialNumber.trim().toUpperCase();

    const device = await Device.findOne({ serialNumber: cleanSerial, owner: userId });
    if (!device) return res.status(404).json({ message: 'Device not found or not owned by you' });

    const [logs, total] = await Promise.all([
      DeviceLog.find({ serialNumber: cleanSerial })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      DeviceLog.countDocuments({ serialNumber: cleanSerial }),
    ]);

    res.json({
      logs: logs.map((log) => ({
        timestamp: log.createdAt,
        message: log.message,
        type: log.type,
        source: log.source,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Get logs error:', error.message);
    res.status(500).json({ message: 'Failed to fetch device logs' });
  }
};

// ============================================================
// getAllLogs - Get all logs from all user devices
// ============================================================
exports.getAllLogs = async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    const userDevices = await Device.find({ owner: userId }).select('serialNumber name').lean();
    if (!userDevices.length) {
      return res.json({ logs: [], total: 0, page: 1, pages: 0 });
    }

    const serialNumbers = userDevices.map((d) => d.serialNumber);
    const deviceNames = {};
    userDevices.forEach((d) => { deviceNames[d.serialNumber] = d.name; });

    const [logs, total] = await Promise.all([
      DeviceLog.find({ serialNumber: { $in: serialNumbers } })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      DeviceLog.countDocuments({ serialNumber: { $in: serialNumbers } }),
    ]);

    res.json({
      logs: logs.map((log) => ({
        timestamp: log.createdAt,
        message: log.message,
        type: log.type,
        source: log.source,
        serialNumber: log.serialNumber,
        deviceName: deviceNames[log.serialNumber] || log.serialNumber,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Get all logs error:', error.message);
    res.status(500).json({ message: 'Failed to fetch logs' });
  }
};

// ============================================================
// OTA: Download firmware binary (called by ESP32 device)
// Authenticates via device serial + secret in headers
// ============================================================
exports.otaDownload = async (req, res) => {
  try {
    const { firmwareId } = req.params;
    const deviceSerial = (req.headers['x-device-serial'] || '').trim().toUpperCase();
    const deviceSecret = req.headers['x-device-secret'] || '';

    if (!deviceSerial || !deviceSecret) {
      return res.status(401).json({ message: 'Device authentication required' });
    }

    // Verify device identity
    const allowedDevice = await AllowedDevice.findAllowedWithSecret(deviceSerial);
    if (!allowedDevice || !allowedDevice.verifySecret(deviceSecret)) {
      return res.status(403).json({ message: 'Device not authorized' });
    }

    const firmware = await Firmware.findById(firmwareId);
    if (!firmware) {
      return res.status(404).json({ message: 'Firmware not found' });
    }
    if (!firmware.filePath || !fs.existsSync(firmware.filePath)) {
      return res.status(404).json({ message: 'Firmware binary not available' });
    }

    // Log the download
    await DeviceLog.create({
      serialNumber: deviceSerial,
      type: 'info',
      message: `OTA downloading firmware v${firmware.version}`,
      source: 'device',
    });

    // Send binary with metadata headers
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', firmware.fileSize);
    res.setHeader('X-Firmware-Version', firmware.version);
    res.setHeader('X-Firmware-Checksum', firmware.checksum);
    res.setHeader('X-Firmware-Size', firmware.fileSize);
    if (firmware.signature) {
      res.setHeader('X-Firmware-Signature', firmware.signature);
    }

    const fileStream = fs.createReadStream(firmware.filePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error('OTA download error:', error.message);
    res.status(500).json({ message: 'Failed to serve firmware' });
  }
};

// ============================================================
// OTA: Check for updates (called by ESP32 device on boot)
// ============================================================
exports.otaCheck = async (req, res) => {
  try {
    const deviceSerial = (req.headers['x-device-serial'] || '').trim().toUpperCase();
    const deviceSecret = req.headers['x-device-secret'] || '';
    const currentVersion = req.headers['x-firmware-version'] || '';

    if (!deviceSerial || !deviceSecret) {
      return res.status(401).json({ message: 'Device authentication required' });
    }

    const allowedDevice = await AllowedDevice.findAllowedWithSecret(deviceSerial);
    if (!allowedDevice || !allowedDevice.verifySecret(deviceSecret)) {
      return res.status(403).json({ message: 'Device not authorized' });
    }

    const device = await Device.findOne({ serialNumber: deviceSerial });
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    // Find latest stable firmware for this device type
    const latestFirmware = await Firmware.findOne({
      deviceType: device.deviceType,
      isStable: true,
      isActive: true,
      filePath: { $ne: null },
    }).sort({ createdAt: -1 });

    if (!latestFirmware || latestFirmware.version === currentVersion) {
      return res.json({ updateAvailable: false });
    }

    const serverBase = `${req.protocol}://${req.get('host')}`;

    res.json({
      updateAvailable: true,
      version: latestFirmware.version,
      changelog: latestFirmware.changelog,
      checksum: latestFirmware.checksum,
      signature: latestFirmware.signature || null,
      fileSize: latestFirmware.fileSize,
      url: `${serverBase}/devices/ota/download/${latestFirmware._id}`,
    });
  } catch (error) {
    console.error('OTA check error:', error.message);
    res.status(500).json({ message: 'Failed to check for updates' });
  }
};
