const AllowedDevice = require('../models/AllowedDevice');
const Device = require('../models/Device');

// ============================================================
// registerDevice
// ============================================================
exports.registerDevice = async (req, res) => {
  try {
    const { serialNumber, deviceType, firmwareVersion, hardwareVersion, macAddress, notes } = req.body;

    if (!serialNumber || typeof serialNumber !== 'string' || serialNumber.trim().length === 0) {
      return res.status(400).json({ message: 'Valid serial number is required' });
    }

    const existing = await AllowedDevice.findOne({
      serialNumber: serialNumber.toUpperCase().trim(),
    });
    if (existing) {
      return res.status(409).json({ message: 'Device already registered in allowlist' });
    }

    const device = await AllowedDevice.registerDevice({
      serialNumber,
      deviceType: deviceType || 'relay',
      firmwareVersion: firmwareVersion || '1.0.0',
      hardwareVersion: hardwareVersion || '1.0',
      macAddress,
      notes,
    });

    const deviceWithMqtt = await AllowedDevice.findById(device._id).select('+mqttUsername +mqttPassword');

    console.log(`Device registered: ${device.serialNumber}`);

    res.status(201).json({
      message: 'Device registered successfully',
      device: {
        serialNumber: device.serialNumber,
        deviceType: device.deviceType,
        deviceSecret: device._rawSecret,
        mqttUsername: deviceWithMqtt.mqttUsername,
        mqttPassword: deviceWithMqtt.mqttPassword,
      },
      warning: 'Save the deviceSecret securely. It will not be shown again (stored as hash).',
    });
  } catch (error) {
    console.error('Register device error:', error.message);
    res.status(500).json({ message: 'Failed to register device' });
  }
};

// ============================================================
// registerBatch
// ============================================================
exports.registerBatch = async (req, res) => {
  try {
    const { devices } = req.body;

    if (!Array.isArray(devices) || devices.length === 0) {
      return res.status(400).json({ message: 'Devices array is required' });
    }

    if (devices.length > 100) {
      return res.status(400).json({ message: 'Maximum 100 devices per batch' });
    }

    const serials = devices.map((d) => d.serialNumber?.toUpperCase().trim()).filter(Boolean);
    if (serials.length !== devices.length) {
      return res.status(400).json({ message: 'All devices must have valid serial numbers' });
    }

    const uniqueSerials = [...new Set(serials)];
    if (uniqueSerials.length !== serials.length) {
      return res.status(400).json({ message: 'Duplicate serial numbers in batch' });
    }

    const existing = await AllowedDevice.find({ serialNumber: { $in: uniqueSerials } }).select('serialNumber');
    if (existing.length > 0) {
      return res.status(409).json({
        message: 'Some devices already registered',
        duplicates: existing.map((d) => d.serialNumber),
      });
    }

    const result = await AllowedDevice.registerBatch(devices);
    const secretsMap = result._secretsMap;

    const registeredDevices = await AllowedDevice.find({
      serialNumber: { $in: uniqueSerials },
    }).select('+mqttUsername +mqttPassword');

    console.log(`Batch registered: ${registeredDevices.length} devices`);

    res.status(201).json({
      message: `${registeredDevices.length} devices registered successfully`,
      devices: registeredDevices.map((d) => ({
        serialNumber: d.serialNumber,
        deviceSecret: secretsMap[d.serialNumber],
        mqttUsername: d.mqttUsername,
        mqttPassword: d.mqttPassword,
      })),
      warning: 'Save all deviceSecrets securely. They will not be shown again (stored as hash).',
    });
  } catch (error) {
    console.error('Batch register error:', error.message);
    res.status(500).json({ message: 'Failed to register devices' });
  }
};

// ============================================================
// listDevices
// ============================================================
exports.listDevices = async (req, res) => {
  try {
    const { page = 1, limit = 50, status, search } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));

    const filter = {};
    if (status === 'activated') filter.isActivated = true;
    if (status === 'inactive') filter.isActivated = false;
    if (status === 'banned') filter.isBanned = true;
    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.serialNumber = { $regex: safeSearch.toUpperCase(), $options: 'i' };
    }

    const skip = (pageNum - 1) * limitNum;
    const [devices, total] = await Promise.all([
      AllowedDevice.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      AllowedDevice.countDocuments(filter),
    ]);

    res.json({
      devices,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error('List devices error:', error.message);
    res.status(500).json({ message: 'Failed to list devices' });
  }
};

// ============================================================
// banDevice
// ============================================================
exports.banDevice = async (req, res) => {
  try {
    const { serialNumber, reason } = req.body;

    if (!serialNumber) return res.status(400).json({ message: 'Serial number is required' });

    const device = await AllowedDevice.findOne({
      serialNumber: serialNumber.toUpperCase().trim(),
    });
    if (!device) return res.status(404).json({ message: 'Device not found in allowlist' });

    device.isBanned = true;
    device.banReason = reason || 'Banned by admin';
    await device.save();

    await Device.findOneAndUpdate(
      { serialNumber: device.serialNumber },
      { owner: null, pairedAt: null, isOnline: false }
    );

    console.log(`Device banned: ${device.serialNumber}`);
    res.json({ message: 'Device banned successfully' });
  } catch (error) {
    console.error('Ban device error:', error.message);
    res.status(500).json({ message: 'Failed to ban device' });
  }
};

// ============================================================
// unbanDevice
// ============================================================
exports.unbanDevice = async (req, res) => {
  try {
    const { serialNumber } = req.body;

    if (!serialNumber) return res.status(400).json({ message: 'Serial number is required' });

    const device = await AllowedDevice.findOne({
      serialNumber: serialNumber.toUpperCase().trim(),
    });
    if (!device) return res.status(404).json({ message: 'Device not found in allowlist' });

    device.isBanned = false;
    device.banReason = null;
    device.failedAttempts = 0;
    device.lockedUntil = null;
    await device.save();

    console.log(`Device unbanned: ${device.serialNumber}`);
    res.json({ message: 'Device unbanned successfully' });
  } catch (error) {
    console.error('Unban device error:', error.message);
    res.status(500).json({ message: 'Failed to unban device' });
  }
};

// ============================================================
// getDeviceStats
// ============================================================
exports.getDeviceStats = async (req, res) => {
  try {
    const [total, activated, banned, paired, online] = await Promise.all([
      AllowedDevice.countDocuments(),
      AllowedDevice.countDocuments({ isActivated: true }),
      AllowedDevice.countDocuments({ isBanned: true }),
      Device.countDocuments({ owner: { $ne: null } }),
      Device.countDocuments({ isOnline: true }),
    ]);

    res.json({
      allowlist: { total, activated, inactive: total - activated, banned },
      devices: { paired, online },
    });
  } catch (error) {
    console.error('Device stats error:', error.message);
    res.status(500).json({ message: 'Failed to get stats' });
  }
};
