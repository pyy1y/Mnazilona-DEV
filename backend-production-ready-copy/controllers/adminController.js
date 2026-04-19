const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const AllowedDevice = require('../models/AllowedDevice');
const Device = require('../models/Device');
const User = require('../models/User');
const DeviceLog = require('../models/DeviceLog');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');
const Room = require('../models/Room');
const { topicOf, publishMessage, isMqttHealthy } = require('../config/mqtt');
const { isHealthy: isDbHealthy } = require('../config/database');
const { generateToken, generateRefreshToken, REFRESH_TOKEN_EXPIRY_MS } = require('../utils/helpers');
const { getStats: getRateLimitStats, getRecentEvents, getTopOffenders } = require('../config/rateLimitStore');
const Firmware = require('../models/Firmware');
const IPBlacklist = require('../models/IPBlacklist');
const AnomalyAlert = require('../models/AnomalyAlert');
const { forceRefreshBlacklist } = require('../middleware/ipBlacklist');
const { trackFailedLogin, trackAdminAction } = require('../services/anomalyDetector');
const { sendVerificationCode, verifyCode } = require('../services/codeService');
const { signFirmware, verifyFirmwareSignature } = require('../utils/firmwareSigner');

const BCRYPT_ROUNDS = 12;

// Helper: log admin action
const audit = async (req, action, target, details = {}) => {
  try {
    await AuditLog.create({
      adminId: req.user.id,
      adminEmail: req.user.email,
      action,
      target,
      details,
      ip: req.ip,
    });
    // Track admin activity for anomaly detection
    trackAdminAction(req.user.id, req.user.email);
  } catch (err) {
    console.error('Audit log failed:', err.message);
  }
};

// ============================================================
// ADMIN LOGIN - STEP 1: Validate credentials & send OTP
// ============================================================
exports.loginSendCode = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim(), role: 'admin' }).select('+password');
    if (!user) {
      trackFailedLogin(req.ip);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: 'Account is deactivated' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      trackFailedLogin(req.ip);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Send OTP to admin email
    await sendVerificationCode(email, 'admin_login', {
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    res.json({ message: 'Verification code sent to your email' });
  } catch (error) {
    console.error('Admin login send-code error:', error.message);
    res.status(500).json({ message: 'Failed to send verification code' });
  }
};

// ============================================================
// ADMIN LOGIN - STEP 2: Verify OTP & issue token
// ============================================================
exports.loginVerifyCode = async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ message: 'Email and verification code are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim(), role: 'admin' });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: 'Account is deactivated' });
    }

    const isCodeValid = await verifyCode(email, 'admin_login', code);
    if (!isCodeValid) {
      trackFailedLogin(req.ip);
      return res.status(401).json({ message: 'Invalid or expired verification code' });
    }

    user.lastLoginAt = new Date();
    user.refreshToken = generateRefreshToken();
    user.refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
    await user.save();

    const token = generateToken(user);

    // Log admin login
    await AuditLog.create({
      adminId: user._id,
      adminEmail: user.email,
      action: 'admin_login',
      target: user.email,
      ip: req.ip,
    });

    res.json({
      message: 'Admin login successful',
      token,
      refreshToken: user.refreshToken,
      admin: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Admin login verify-code error:', error.message);
    res.status(500).json({ message: 'Verification failed' });
  }
};

// ============================================================
// DASHBOARD OVERVIEW
// ============================================================
exports.getDashboard = async (req, res) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers,
      newUsersToday,
      newUsersWeek,
      totalAllowedDevices,
      activatedDevices,
      bannedDevices,
      totalPairedDevices,
      onlineDevices,
      offlineDevices,
      totalLogs,
      logsToday,
      errorLogs,
      lockedDevices,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      User.countDocuments({ createdAt: { $gte: today } }),
      User.countDocuments({ createdAt: { $gte: weekAgo } }),
      AllowedDevice.countDocuments(),
      AllowedDevice.countDocuments({ isActivated: true }),
      AllowedDevice.countDocuments({ isBanned: true }),
      Device.countDocuments({ owner: { $ne: null } }),
      Device.countDocuments({ isOnline: true }),
      Device.countDocuments({ isOnline: false, owner: { $ne: null } }),
      DeviceLog.countDocuments(),
      DeviceLog.countDocuments({ createdAt: { $gte: today } }),
      DeviceLog.countDocuments({ type: 'error' }),
      AllowedDevice.countDocuments({ lockedUntil: { $gt: now } }),
    ]);

    // Recent activity (last 10 logs)
    const recentLogs = await DeviceLog.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // Devices by type
    const devicesByType = await Device.aggregate([
      { $match: { owner: { $ne: null } } },
      { $group: { _id: '$deviceType', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    res.json({
      users: {
        total: totalUsers,
        active: activeUsers,
        inactive: totalUsers - activeUsers,
        newToday: newUsersToday,
        newThisWeek: newUsersWeek,
      },
      allowlist: {
        total: totalAllowedDevices,
        activated: activatedDevices,
        inactive: totalAllowedDevices - activatedDevices,
        banned: bannedDevices,
        locked: lockedDevices,
      },
      devices: {
        paired: totalPairedDevices,
        online: onlineDevices,
        offline: offlineDevices,
        byType: devicesByType.map((d) => ({ type: d._id, count: d.count })),
      },
      logs: {
        total: totalLogs,
        today: logsToday,
        errors: errorLogs,
      },
      services: {
        database: isDbHealthy() ? 'connected' : 'disconnected',
        mqtt: isMqttHealthy() ? 'connected' : 'disconnected',
      },
      recentActivity: recentLogs,
    });
  } catch (error) {
    console.error('Dashboard error:', error.message);
    res.status(500).json({ message: 'Failed to load dashboard' });
  }
};

// ============================================================
// USER MANAGEMENT
// ============================================================
exports.listUsers = async (req, res) => {
  try {
    const { page = 1, limit = 50, search, status, role } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));

    const filter = {};
    if (status === 'active') filter.isActive = true;
    if (status === 'inactive') filter.isActive = false;
    if (role === 'admin') filter.role = 'admin';
    if (role === 'user') filter.role = { $ne: 'admin' };
    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: safeSearch, $options: 'i' } },
        { email: { $regex: safeSearch, $options: 'i' } },
      ];
    }

    const skip = (pageNum - 1) * limitNum;
    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      User.countDocuments(filter),
    ]);

    // Get device count per user
    const userIds = users.map((u) => u._id);
    const deviceCounts = await Device.aggregate([
      { $match: { owner: { $in: userIds } } },
      { $group: { _id: '$owner', count: { $sum: 1 }, online: { $sum: { $cond: ['$isOnline', 1, 0] } } } },
    ]);
    const deviceMap = {};
    deviceCounts.forEach((d) => { deviceMap[d._id.toString()] = { count: d.count, online: d.online }; });

    res.json({
      users: users.map((u) => ({
        id: u._id,
        name: u.name,
        email: u.email,
        role: u.role || 'user',
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
        country: u.country,
        city: u.city,
        devices: deviceMap[u._id.toString()] || { count: 0, online: 0 },
      })),
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    console.error('List users error:', error.message);
    res.status(500).json({ message: 'Failed to list users' });
  }
};

exports.getUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ message: 'User not found' });

    const [devices, rooms, notifications] = await Promise.all([
      Device.find({ owner: userId })
        .select('name serialNumber deviceType isOnline lastSeen pairedAt state macAddress firmwareVersion')
        .sort({ pairedAt: -1 })
        .lean(),
      Room.find({ owner: userId }).sort({ order: 1 }).lean(),
      Notification.find({ recipient: userId }).sort({ createdAt: -1 }).limit(20).lean(),
    ]);

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role || 'user',
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        dob: user.dob,
        country: user.country,
        city: user.city,
      },
      devices,
      rooms,
      notifications,
    });
  } catch (error) {
    console.error('Get user error:', error.message);
    res.status(500).json({ message: 'Failed to get user' });
  }
};

exports.deactivateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.role === 'admin') return res.status(403).json({ message: 'Cannot deactivate admin accounts' });

    user.isActive = false;
    user.tokenVersion = (user.tokenVersion || 0) + 1; // Force logout
    await user.save();

    await audit(req, 'user_deactivate', user.email, { userId });
    res.json({ message: 'User deactivated successfully' });
  } catch (error) {
    console.error('Deactivate user error:', error.message);
    res.status(500).json({ message: 'Failed to deactivate user' });
  }
};

exports.activateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.isActive = true;
    await user.save();

    await audit(req, 'user_activate', user.email, { userId });
    res.json({ message: 'User activated successfully' });
  } catch (error) {
    console.error('Activate user error:', error.message);
    res.status(500).json({ message: 'Failed to activate user' });
  }
};

exports.forceLogout = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    await audit(req, 'user_force_logout', user.email, { userId });
    res.json({ message: 'User sessions invalidated' });
  } catch (error) {
    console.error('Force logout error:', error.message);
    res.status(500).json({ message: 'Failed to force logout' });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.role === 'admin') return res.status(403).json({ message: 'Cannot delete admin accounts from here' });

    // Unpair all devices
    const devices = await Device.find({ owner: userId });
    for (const device of devices) {
      device.owner = null;
      device.pairedAt = null;
      await device.save();
    }

    // Delete rooms
    await Room.deleteMany({ owner: userId });

    // Delete notifications
    await Notification.deleteMany({ recipient: userId });

    // Delete user
    await User.findByIdAndDelete(userId);

    await audit(req, 'user_delete', user.email, { userId, deviceCount: devices.length });
    res.json({ message: 'User deleted successfully', devicesUnpaired: devices.length });
  } catch (error) {
    console.error('Delete user error:', error.message);
    res.status(500).json({ message: 'Failed to delete user' });
  }
};

// ============================================================
// DEVICE MANAGEMENT (AllowedDevices - Allowlist)
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

    await audit(req, 'device_register', device.serialNumber);

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

    await audit(req, 'device_register_batch', `${registeredDevices.length} devices`, {
      serials: uniqueSerials,
    });

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

exports.listAllowedDevices = async (req, res) => {
  try {
    const { page = 1, limit = 50, status, search } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));

    const filter = {};
    if (status === 'activated') filter.isActivated = true;
    if (status === 'inactive') filter.isActivated = false;
    if (status === 'banned') filter.isBanned = true;
    if (status === 'locked') filter.lockedUntil = { $gt: new Date() };
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
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    console.error('List devices error:', error.message);
    res.status(500).json({ message: 'Failed to list devices' });
  }
};

exports.banDevice = async (req, res) => {
  try {
    const { serialNumber, reason } = req.body;
    if (!serialNumber) return res.status(400).json({ message: 'Serial number is required' });

    const device = await AllowedDevice.findOne({ serialNumber: serialNumber.toUpperCase().trim() });
    if (!device) return res.status(404).json({ message: 'Device not found in allowlist' });

    device.isBanned = true;
    device.banReason = reason || 'Banned by admin';
    await device.save();

    // Unpair and set offline
    await Device.findOneAndUpdate(
      { serialNumber: device.serialNumber },
      { owner: null, pairedAt: null, isOnline: false }
    );

    // Send disconnect command via MQTT
    try {
      await publishMessage(topicOf(device.serialNumber, 'command'), {
        command: 'disconnect',
        reason: 'banned',
        ts: Date.now(),
      });
    } catch {}

    await audit(req, 'device_ban', device.serialNumber, { reason });
    res.json({ message: 'Device banned successfully' });
  } catch (error) {
    console.error('Ban device error:', error.message);
    res.status(500).json({ message: 'Failed to ban device' });
  }
};

exports.unbanDevice = async (req, res) => {
  try {
    const { serialNumber } = req.body;
    if (!serialNumber) return res.status(400).json({ message: 'Serial number is required' });

    const device = await AllowedDevice.findOne({ serialNumber: serialNumber.toUpperCase().trim() });
    if (!device) return res.status(404).json({ message: 'Device not found in allowlist' });

    device.isBanned = false;
    device.banReason = null;
    device.failedAttempts = 0;
    device.lockedUntil = null;
    await device.save();

    await audit(req, 'device_unban', device.serialNumber);
    res.json({ message: 'Device unbanned successfully' });
  } catch (error) {
    console.error('Unban device error:', error.message);
    res.status(500).json({ message: 'Failed to unban device' });
  }
};

// ============================================================
// PAIRED DEVICES MANAGEMENT
// ============================================================
exports.listPairedDevices = async (req, res) => {
  try {
    const { page = 1, limit = 50, status, search, type } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));

    const filter = {};
    if (status === 'online') filter.isOnline = true;
    if (status === 'offline') filter.isOnline = false;
    if (status === 'paired') filter.owner = { $ne: null };
    if (status === 'unpaired') filter.owner = null;
    if (type) filter.deviceType = type;
    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { serialNumber: { $regex: safeSearch.toUpperCase(), $options: 'i' } },
        { name: { $regex: safeSearch, $options: 'i' } },
      ];
    }

    const skip = (pageNum - 1) * limitNum;
    const [devices, total] = await Promise.all([
      Device.find(filter)
        .populate('owner', 'name email')
        .populate('room', 'name icon')
        .sort({ lastSeen: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Device.countDocuments(filter),
    ]);

    res.json({
      devices,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    console.error('List paired devices error:', error.message);
    res.status(500).json({ message: 'Failed to list devices' });
  }
};

exports.getDevice = async (req, res) => {
  try {
    const { serialNumber } = req.params;
    const cleanSerial = serialNumber.trim().toUpperCase();

    const [device, allowedDevice, logs] = await Promise.all([
      Device.findOne({ serialNumber: cleanSerial })
        .populate('owner', 'name email')
        .populate('room', 'name icon')
        .lean(),
      AllowedDevice.findOne({ serialNumber: cleanSerial }).lean(),
      DeviceLog.find({ serialNumber: cleanSerial })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
    ]);

    if (!device && !allowedDevice) {
      return res.status(404).json({ message: 'Device not found' });
    }

    res.json({ device, allowedDevice, logs });
  } catch (error) {
    console.error('Get device error:', error.message);
    res.status(500).json({ message: 'Failed to get device' });
  }
};

// Admin sends command to ANY device (no ownership check)
exports.sendCommand = async (req, res) => {
  try {
    const { serialNumber } = req.params;
    const { command, params } = req.body;

    if (!command) return res.status(400).json({ message: 'Command is required' });

    const cleanSerial = serialNumber.trim().toUpperCase();
    const device = await Device.findOne({ serialNumber: cleanSerial });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    const topic = topicOf(cleanSerial, 'command');
    await publishMessage(topic, {
      command: command.trim().toLowerCase(),
      params: params || {},
      ts: Date.now(),
      source: 'admin',
      adminId: req.user.id,
    });

    await DeviceLog.create({
      serialNumber: cleanSerial,
      type: 'warning',
      message: `Admin command "${command}" sent`,
      source: 'server',
    });

    await audit(req, 'device_command', cleanSerial, { command, params });
    res.json({ message: 'Command sent successfully', command });
  } catch (error) {
    console.error('Admin command error:', error.message);
    res.status(500).json({ message: 'Failed to send command' });
  }
};

// Admin unpairs device from its owner
exports.unpairDevice = async (req, res) => {
  try {
    const { serialNumber } = req.params;
    const cleanSerial = serialNumber.trim().toUpperCase();

    const device = await Device.findOne({ serialNumber: cleanSerial });
    if (!device) return res.status(404).json({ message: 'Device not found' });
    if (!device.owner) return res.status(400).json({ message: 'Device is not paired' });

    const previousOwner = device.owner;
    device.owner = null;
    device.pairedAt = null;
    await device.save();

    await AllowedDevice.findOneAndUpdate(
      { serialNumber: cleanSerial },
      { activatedBy: null }
    );

    try {
      await publishMessage(topicOf(cleanSerial, 'command'), {
        command: 'unpaired',
        source: 'admin',
        ts: Date.now(),
      });
    } catch {}

    await DeviceLog.create({
      serialNumber: cleanSerial,
      type: 'warning',
      message: 'Device unpaired by admin',
      source: 'server',
    });

    await audit(req, 'device_unpair', cleanSerial, { previousOwner });
    res.json({ message: 'Device unpaired successfully' });
  } catch (error) {
    console.error('Admin unpair error:', error.message);
    res.status(500).json({ message: 'Failed to unpair device' });
  }
};

// Admin transfers device to another user
exports.transferDevice = async (req, res) => {
  try {
    const { serialNumber } = req.params;
    const { newOwnerId } = req.body;

    if (!newOwnerId) return res.status(400).json({ message: 'New owner ID is required' });

    const cleanSerial = serialNumber.trim().toUpperCase();

    const [device, newOwner] = await Promise.all([
      Device.findOne({ serialNumber: cleanSerial }),
      User.findById(newOwnerId),
    ]);

    if (!device) return res.status(404).json({ message: 'Device not found' });
    if (!newOwner) return res.status(404).json({ message: 'New owner not found' });

    const previousOwner = device.owner;
    device.owner = newOwnerId;
    device.pairedAt = new Date();
    await device.save();

    await DeviceLog.create({
      serialNumber: cleanSerial,
      type: 'warning',
      message: `Device transferred to ${newOwner.email} by admin`,
      source: 'server',
    });

    await audit(req, 'device_transfer', cleanSerial, {
      previousOwner,
      newOwner: newOwnerId,
      newOwnerEmail: newOwner.email,
    });

    res.json({ message: 'Device transferred successfully' });
  } catch (error) {
    console.error('Transfer device error:', error.message);
    res.status(500).json({ message: 'Failed to transfer device' });
  }
};

// Admin sends factory reset to device
exports.factoryResetDevice = async (req, res) => {
  try {
    const { serialNumber } = req.params;
    const cleanSerial = serialNumber.trim().toUpperCase();

    const device = await Device.findOne({ serialNumber: cleanSerial });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    await publishMessage(topicOf(cleanSerial, 'command'), {
      command: 'factory_reset',
      source: 'admin',
      ts: Date.now(),
    });

    // Unpair the device
    device.owner = null;
    device.pairedAt = null;
    device.isOnline = false;
    device.wifiConfigured = false;
    device.state = {};
    await device.save();

    await DeviceLog.create({
      serialNumber: cleanSerial,
      type: 'error',
      message: 'Factory reset triggered by admin',
      source: 'server',
    });

    await audit(req, 'device_factory_reset', cleanSerial);
    res.json({ message: 'Factory reset command sent' });
  } catch (error) {
    console.error('Factory reset error:', error.message);
    res.status(500).json({ message: 'Failed to send factory reset' });
  }
};

// ============================================================
// LOGS
// ============================================================
exports.getAllLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50, type, source, search, serialNumber } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));

    const filter = {};
    if (type) filter.type = type;
    if (source) filter.source = source;
    if (serialNumber) filter.serialNumber = serialNumber.toUpperCase().trim();
    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { message: { $regex: safeSearch, $options: 'i' } },
        { serialNumber: { $regex: safeSearch.toUpperCase(), $options: 'i' } },
      ];
    }

    const skip = (pageNum - 1) * limitNum;
    const [logs, total] = await Promise.all([
      DeviceLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      DeviceLog.countDocuments(filter),
    ]);

    res.json({
      logs,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    console.error('Get all logs error:', error.message);
    res.status(500).json({ message: 'Failed to fetch logs' });
  }
};

// ============================================================
// AUDIT LOGS
// ============================================================
exports.getAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50, action, search } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));

    const filter = {};
    if (action) filter.action = action;
    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { target: { $regex: safeSearch, $options: 'i' } },
        { adminEmail: { $regex: safeSearch, $options: 'i' } },
      ];
    }

    const skip = (pageNum - 1) * limitNum;
    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({
      logs,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    console.error('Get audit logs error:', error.message);
    res.status(500).json({ message: 'Failed to fetch audit logs' });
  }
};

// ============================================================
// SECURITY OVERVIEW
// ============================================================
exports.getSecurityOverview = async (req, res) => {
  try {
    const now = new Date();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

    const [
      lockedDevices,
      bannedDevices,
      recentFailedInquiries,
      inactiveUsers,
      recentAdminActions,
    ] = await Promise.all([
      AllowedDevice.find({ lockedUntil: { $gt: now } })
        .select('serialNumber failedAttempts lockedUntil lastFailedAttempt')
        .lean(),
      AllowedDevice.find({ isBanned: true })
        .select('serialNumber banReason isBanned')
        .lean(),
      DeviceLog.find({
        type: 'warning',
        message: { $regex: /attempt|rejected|failed/i },
        createdAt: { $gte: dayAgo },
      })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      User.countDocuments({ isActive: false }),
      AuditLog.find({ createdAt: { $gte: dayAgo } })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ]);

    // Devices with many failed attempts (even if not locked yet)
    const suspiciousDevices = await AllowedDevice.find({
      failedAttempts: { $gte: 2 },
    })
      .select('serialNumber failedAttempts lastFailedAttempt lockedUntil')
      .sort({ failedAttempts: -1 })
      .limit(20)
      .lean();

    res.json({
      lockedDevices,
      bannedDevices,
      suspiciousDevices,
      recentFailedInquiries,
      inactiveUsers,
      recentAdminActions,
    });
  } catch (error) {
    console.error('Security overview error:', error.message);
    res.status(500).json({ message: 'Failed to get security overview' });
  }
};

// ============================================================
// STATS (kept for backward compatibility)
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

// ============================================================
// RATE LIMIT MONITORING
// ============================================================
exports.getRateLimits = async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 100));

    res.json({
      stats: getRateLimitStats(),
      recentEvents: getRecentEvents(limitNum),
      topOffenders: getTopOffenders(20),
    });
  } catch (error) {
    console.error('Rate limit stats error:', error.message);
    res.status(500).json({ message: 'Failed to get rate limit stats' });
  }
};

// ============================================================
// DEVICE OVERRIDE CONTROLS
// ============================================================
exports.lockDevice = async (req, res) => {
  try {
    const { serialNumber } = req.params;
    const { reason } = req.body;
    const cleanSerial = serialNumber.trim().toUpperCase();

    const device = await Device.findOne({ serialNumber: cleanSerial });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    device.adminLocked = true;
    device.adminLockedAt = new Date();
    device.adminLockedBy = req.user.id;
    device.adminLockReason = reason || 'Locked by admin';
    await device.save();

    // Notify device via MQTT
    try {
      await publishMessage(topicOf(cleanSerial, 'command'), {
        command: 'admin_lock',
        locked: true,
        reason: device.adminLockReason,
        ts: Date.now(),
        source: 'admin',
      });
    } catch {}

    await DeviceLog.create({
      serialNumber: cleanSerial,
      type: 'warning',
      message: `Device locked by admin: ${device.adminLockReason}`,
      source: 'server',
    });

    await audit(req, 'device_lock', cleanSerial, { reason });
    res.json({ message: 'Device locked - user commands blocked' });
  } catch (error) {
    console.error('Lock device error:', error.message);
    res.status(500).json({ message: 'Failed to lock device' });
  }
};

exports.unlockDevice = async (req, res) => {
  try {
    const { serialNumber } = req.params;
    const cleanSerial = serialNumber.trim().toUpperCase();

    const device = await Device.findOne({ serialNumber: cleanSerial });
    if (!device) return res.status(404).json({ message: 'Device not found' });

    device.adminLocked = false;
    device.adminLockedAt = null;
    device.adminLockedBy = null;
    device.adminLockReason = null;
    await device.save();

    try {
      await publishMessage(topicOf(cleanSerial, 'command'), {
        command: 'admin_lock',
        locked: false,
        ts: Date.now(),
        source: 'admin',
      });
    } catch {}

    await DeviceLog.create({
      serialNumber: cleanSerial,
      type: 'info',
      message: 'Device unlocked by admin',
      source: 'server',
    });

    await audit(req, 'device_unlock', cleanSerial);
    res.json({ message: 'Device unlocked - user commands restored' });
  } catch (error) {
    console.error('Unlock device error:', error.message);
    res.status(500).json({ message: 'Failed to unlock device' });
  }
};

// Get full device detail for admin control panel
exports.getDeviceDetail = async (req, res) => {
  try {
    const { serialNumber } = req.params;
    const cleanSerial = serialNumber.trim().toUpperCase();

    const [device, allowedDevice, logs] = await Promise.all([
      Device.findOne({ serialNumber: cleanSerial })
        .populate('owner', 'name email')
        .populate('room', 'name icon')
        .populate('adminLockedBy', 'name email')
        .lean(),
      AllowedDevice.findOne({ serialNumber: cleanSerial }).lean(),
      DeviceLog.find({ serialNumber: cleanSerial })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
    ]);

    if (!device && !allowedDevice) {
      return res.status(404).json({ message: 'Device not found' });
    }

    // Get latest firmware for this device type
    let latestFirmware = null;
    if (device?.deviceType) {
      latestFirmware = await Firmware.findOne({
        deviceType: device.deviceType,
        isStable: true,
        isActive: true,
      }).sort({ createdAt: -1 }).lean();
    }

    res.json({ device, allowedDevice, logs, latestFirmware });
  } catch (error) {
    console.error('Get device detail error:', error.message);
    res.status(500).json({ message: 'Failed to get device detail' });
  }
};

// ============================================================
// FIRMWARE MANAGEMENT
// ============================================================
exports.listFirmware = async (req, res) => {
  try {
    const { deviceType, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));

    const filter = {};
    if (deviceType) filter.deviceType = deviceType;

    const skip = (pageNum - 1) * limitNum;
    const [firmwares, total] = await Promise.all([
      Firmware.find(filter)
        .populate('publishedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Firmware.countDocuments(filter),
    ]);

    res.json({
      firmwares,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    console.error('List firmware error:', error.message);
    res.status(500).json({ message: 'Failed to list firmware' });
  }
};

exports.createFirmware = async (req, res) => {
  try {
    const { version, deviceType, changelog, isStable } = req.body;

    if (!version || !deviceType) {
      return res.status(400).json({ message: 'Version and device type are required' });
    }

    const existing = await Firmware.findOne({ version, deviceType });
    if (existing) {
      return res.status(409).json({ message: 'Firmware version already exists for this device type' });
    }

    let filePath = null;
    let fileSize = null;
    let checksum = null;
    let signature = null;

    if (req.file) {
      const fileBuffer = fs.readFileSync(req.file.path);

      // Validate ESP32 firmware magic byte (0xE9) at offset 0
      if (fileBuffer.length < 16 || fileBuffer[0] !== 0xE9) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: 'Invalid firmware binary - not a valid ESP32 firmware file' });
      }

      filePath = req.file.path;
      fileSize = req.file.size;
      checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      signature = signFirmware(fileBuffer);
    }

    const firmware = await Firmware.create({
      version,
      deviceType,
      changelog: changelog || '',
      isStable: isStable === 'true' || isStable === true,
      filePath,
      fileSize,
      checksum,
      signature,
      publishedAt: new Date(),
      publishedBy: req.user.id,
    });

    await audit(req, 'firmware_create', `${deviceType}@${version}`);
    res.status(201).json({ message: 'Firmware version created', firmware });
  } catch (error) {
    console.error('Create firmware error:', error.message);
    res.status(500).json({ message: 'Failed to create firmware' });
  }
};

exports.updateFirmware = async (req, res) => {
  try {
    const { firmwareId } = req.params;
    const { changelog, isStable, isActive } = req.body;

    const firmware = await Firmware.findById(firmwareId);
    if (!firmware) return res.status(404).json({ message: 'Firmware not found' });

    if (changelog !== undefined) firmware.changelog = changelog;
    if (isStable !== undefined) firmware.isStable = isStable === 'true' || isStable === true;
    if (isActive !== undefined) firmware.isActive = isActive === 'true' || isActive === true;

    // If a new firmware binary is uploaded, replace the old one
    if (req.file) {
      const fileBuffer = fs.readFileSync(req.file.path);

      // Validate ESP32 firmware magic byte (0xE9) at offset 0
      if (fileBuffer.length < 16 || fileBuffer[0] !== 0xE9) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ message: 'Invalid firmware binary - not a valid ESP32 firmware file' });
      }

      // Delete old file if exists
      if (firmware.filePath && fs.existsSync(firmware.filePath)) {
        fs.unlinkSync(firmware.filePath);
      }
      firmware.filePath = req.file.path;
      firmware.fileSize = req.file.size;
      firmware.checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      firmware.signature = signFirmware(fileBuffer);
    }

    await firmware.save();

    await audit(req, 'firmware_update', `${firmware.deviceType}@${firmware.version}`);
    res.json({ message: 'Firmware updated', firmware });
  } catch (error) {
    console.error('Update firmware error:', error.message);
    res.status(500).json({ message: 'Failed to update firmware' });
  }
};

exports.deleteFirmware = async (req, res) => {
  try {
    const { firmwareId } = req.params;
    const firmware = await Firmware.findById(firmwareId);
    if (!firmware) return res.status(404).json({ message: 'Firmware not found' });

    // Delete binary file if exists
    if (firmware.filePath && fs.existsSync(firmware.filePath)) {
      fs.unlinkSync(firmware.filePath);
    }

    await Firmware.findByIdAndDelete(firmwareId);

    await audit(req, 'firmware_delete', `${firmware.deviceType}@${firmware.version}`);
    res.json({ message: 'Firmware deleted' });
  } catch (error) {
    console.error('Delete firmware error:', error.message);
    res.status(500).json({ message: 'Failed to delete firmware' });
  }
};

// ============================================================
// pushOtaUpdate - Push OTA to specific device or all devices of a type
// ============================================================
exports.pushOtaUpdate = async (req, res) => {
  try {
    const { firmwareId } = req.params;
    const { serialNumber } = req.body; // optional - if omitted, push to all matching devices

    const firmware = await Firmware.findById(firmwareId);
    if (!firmware) return res.status(404).json({ message: 'Firmware not found' });
    if (!firmware.filePath || !fs.existsSync(firmware.filePath)) {
      return res.status(400).json({ message: 'No firmware binary uploaded for this version' });
    }
    if (!firmware.isActive) {
      return res.status(400).json({ message: 'Firmware version is not active' });
    }

    // Build the download URL for devices
    const serverBase = `${req.protocol}://${req.get('host')}`;
    const downloadUrl = `${serverBase}/devices/ota/download/${firmware._id}`;

    // Find target devices
    let filter = { deviceType: firmware.deviceType, owner: { $ne: null } };
    if (serialNumber) {
      filter.serialNumber = serialNumber.trim().toUpperCase();
    }

    const devices = await Device.find(filter).select('serialNumber isOnline firmwareVersion');

    if (devices.length === 0) {
      return res.status(404).json({ message: 'No matching devices found' });
    }

    let notifiedCount = 0;
    let skippedCount = 0;
    let offlineCount = 0;

    for (const device of devices) {
      // Skip devices already on this version
      if (device.firmwareVersion === firmware.version) {
        skippedCount++;
        continue;
      }
      if (!device.isOnline) {
        offlineCount++;
        continue;
      }

      // Send OTA command via MQTT
      const topic = topicOf(device.serialNumber, 'command');
      await publishMessage(topic, {
        command: 'ota_update',
        version: firmware.version,
        url: downloadUrl,
        checksum: firmware.checksum,
        fileSize: firmware.fileSize,
        ts: Date.now(),
        source: 'admin',
      });

      // Update device OTA tracking
      await Device.findOneAndUpdate(
        { serialNumber: device.serialNumber },
        {
          otaStatus: 'notified',
          otaTargetVersion: firmware.version,
          otaProgress: 0,
          otaError: null,
          otaStartedAt: null,
          otaCompletedAt: null,
        }
      );

      await DeviceLog.create({
        serialNumber: device.serialNumber,
        type: 'info',
        message: `OTA update to v${firmware.version} initiated by admin`,
        source: 'server',
      });

      notifiedCount++;
    }

    await audit(req, 'ota_push', `${firmware.deviceType}@${firmware.version} -> ${notifiedCount} devices`);

    res.json({
      message: 'OTA update pushed',
      version: firmware.version,
      notified: notifiedCount,
      skipped: skippedCount,
      offline: offlineCount,
      total: devices.length,
    });
  } catch (error) {
    console.error('Push OTA error:', error.message);
    res.status(500).json({ message: 'Failed to push OTA update' });
  }
};

// ============================================================
// getOtaStatus - Get OTA status for all devices or specific device
// ============================================================
exports.getOtaStatus = async (req, res) => {
  try {
    const { deviceType } = req.query;

    const filter = { otaStatus: { $ne: 'idle' } };
    if (deviceType) filter.deviceType = deviceType;

    const devices = await Device.find(filter)
      .select('serialNumber name deviceType firmwareVersion otaStatus otaTargetVersion otaProgress otaError otaStartedAt otaCompletedAt isOnline')
      .sort({ otaStartedAt: -1 })
      .lean();

    res.json({ devices, count: devices.length });
  } catch (error) {
    console.error('Get OTA status error:', error.message);
    res.status(500).json({ message: 'Failed to get OTA status' });
  }
};

exports.getFirmwareStats = async (req, res) => {
  try {
    // Firmware versions count per device type
    const firmwareCounts = await Firmware.aggregate([
      { $group: { _id: '$deviceType', count: { $sum: 1 }, stable: { $sum: { $cond: ['$isStable', 1, 0] } } } },
      { $sort: { count: -1 } },
    ]);

    // Device firmware version distribution
    const deviceVersions = await Device.aggregate([
      { $match: { owner: { $ne: null }, firmwareVersion: { $ne: null } } },
      { $group: { _id: { type: '$deviceType', version: '$firmwareVersion' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Devices needing update (firmware differs from latest stable)
    const latestStable = await Firmware.aggregate([
      { $match: { isStable: true, isActive: true } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$deviceType', latestVersion: { $first: '$version' } } },
    ]);

    const latestMap = {};
    latestStable.forEach((f) => { latestMap[f._id] = f.latestVersion; });

    const outdatedDevices = await Device.countDocuments({
      owner: { $ne: null },
      $expr: {
        $and: [
          { $ne: ['$firmwareVersion', null] },
          { $ne: ['$firmwareVersion', ''] },
        ],
      },
    });

    // Count how many are actually outdated
    let needsUpdateCount = 0;
    if (Object.keys(latestMap).length > 0) {
      const conditions = Object.entries(latestMap).map(([type, version]) => ({
        deviceType: type,
        firmwareVersion: { $ne: version, $ne: null },
        owner: { $ne: null },
      }));
      if (conditions.length > 0) {
        needsUpdateCount = await Device.countDocuments({ $or: conditions });
      }
    }

    res.json({
      firmwareCounts,
      deviceVersions: deviceVersions.map((d) => ({
        deviceType: d._id.type,
        version: d._id.version,
        count: d.count,
      })),
      latestStable: latestMap,
      totalDevicesWithFirmware: outdatedDevices,
      needsUpdate: needsUpdateCount,
    });
  } catch (error) {
    console.error('Firmware stats error:', error.message);
    res.status(500).json({ message: 'Failed to get firmware stats' });
  }
};

// ============================================================
// IP BLACKLIST MANAGEMENT
// ============================================================
exports.listBlacklist = async (req, res) => {
  try {
    const { page = 1, limit = 50, search, source, active } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));

    const filter = {};
    if (source) filter.source = source;
    if (active === 'true') filter.isActive = true;
    if (active === 'false') filter.isActive = false;
    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { ip: { $regex: safeSearch, $options: 'i' } },
        { reason: { $regex: safeSearch, $options: 'i' } },
      ];
    }

    const [entries, total] = await Promise.all([
      IPBlacklist.find(filter)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .populate('blockedBy', 'name email')
        .lean(),
      IPBlacklist.countDocuments(filter),
    ]);

    res.json({
      entries,
      pagination: { page: pageNum, pages: Math.ceil(total / limitNum), total },
    });
  } catch (error) {
    console.error('List blacklist error:', error.message);
    res.status(500).json({ message: 'Failed to list blacklist' });
  }
};

exports.blockIP = async (req, res) => {
  try {
    const { ip, reason, duration } = req.body;

    if (!ip || !reason) {
      return res.status(400).json({ message: 'IP and reason are required' });
    }

    // Validate IP format (basic)
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$|^([0-9a-fA-F:]+)$/;
    if (!ipRegex.test(ip)) {
      return res.status(400).json({ message: 'Invalid IP format' });
    }

    // Check if already blocked
    const existing = await IPBlacklist.findOne({ ip });
    if (existing && existing.isActive) {
      return res.status(409).json({ message: 'IP is already blocked' });
    }

    let expiresAt = null;
    if (duration && duration > 0) {
      expiresAt = new Date(Date.now() + duration * 60 * 60 * 1000); // duration in hours
    }

    if (existing) {
      existing.isActive = true;
      existing.reason = reason;
      existing.blockedBy = req.user.id;
      existing.source = 'manual';
      existing.expiresAt = expiresAt;
      existing.hitCount = 0;
      await existing.save();
    } else {
      await IPBlacklist.create({
        ip,
        reason,
        source: 'manual',
        blockedBy: req.user.id,
        expiresAt,
      });
    }

    forceRefreshBlacklist();
    await audit(req, 'ip_block', ip, { reason, duration: duration || 'permanent' });

    res.json({ message: `IP ${ip} has been blocked` });
  } catch (error) {
    console.error('Block IP error:', error.message);
    res.status(500).json({ message: 'Failed to block IP' });
  }
};

exports.unblockIP = async (req, res) => {
  try {
    const { ip } = req.params;

    const entry = await IPBlacklist.findOne({ ip });
    if (!entry) {
      return res.status(404).json({ message: 'IP not found in blacklist' });
    }

    entry.isActive = false;
    await entry.save();

    forceRefreshBlacklist();
    await audit(req, 'ip_unblock', ip, { previousReason: entry.reason });

    res.json({ message: `IP ${ip} has been unblocked` });
  } catch (error) {
    console.error('Unblock IP error:', error.message);
    res.status(500).json({ message: 'Failed to unblock IP' });
  }
};

exports.deleteBlacklistEntry = async (req, res) => {
  try {
    const { id } = req.params;
    const entry = await IPBlacklist.findByIdAndDelete(id);
    if (!entry) {
      return res.status(404).json({ message: 'Entry not found' });
    }

    forceRefreshBlacklist();
    await audit(req, 'ip_unblock', entry.ip, { action: 'deleted', previousReason: entry.reason });

    res.json({ message: 'Blacklist entry deleted' });
  } catch (error) {
    console.error('Delete blacklist error:', error.message);
    res.status(500).json({ message: 'Failed to delete entry' });
  }
};

// ============================================================
// ANOMALY DETECTION
// ============================================================
exports.listAnomalies = async (req, res) => {
  try {
    const { page = 1, limit = 50, status, severity, type } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));

    const filter = {};
    if (status) filter.status = status;
    if (severity) filter.severity = severity;
    if (type) filter.type = type;

    const [alerts, total, stats] = await Promise.all([
      AnomalyAlert.find(filter)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      AnomalyAlert.countDocuments(filter),
      AnomalyAlert.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const statusCounts = { open: 0, acknowledged: 0, resolved: 0, false_positive: 0 };
    stats.forEach((s) => { statusCounts[s._id] = s.count; });

    const severityCounts = await AnomalyAlert.aggregate([
      { $match: { status: 'open' } },
      { $group: { _id: '$severity', count: { $sum: 1 } } },
    ]);
    const openBySeverity = { low: 0, medium: 0, high: 0, critical: 0 };
    severityCounts.forEach((s) => { openBySeverity[s._id] = s.count; });

    res.json({
      alerts,
      pagination: { page: pageNum, pages: Math.ceil(total / limitNum), total },
      stats: { byStatus: statusCounts, openBySeverity },
    });
  } catch (error) {
    console.error('List anomalies error:', error.message);
    res.status(500).json({ message: 'Failed to list anomalies' });
  }
};

exports.updateAnomalyStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['acknowledged', 'resolved', 'false_positive'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const alert = await AnomalyAlert.findById(id);
    if (!alert) {
      return res.status(404).json({ message: 'Alert not found' });
    }

    alert.status = status;
    if (status === 'resolved' || status === 'false_positive') {
      alert.resolvedBy = req.user.id;
      alert.resolvedAt = new Date();
    }
    await alert.save();

    const auditAction = status === 'resolved' || status === 'false_positive' ? 'anomaly_resolve' : 'anomaly_acknowledge';
    await audit(req, auditAction, alert._id.toString(), { type: alert.type, newStatus: status });

    res.json({ message: `Alert status updated to ${status}`, alert });
  } catch (error) {
    console.error('Update anomaly error:', error.message);
    res.status(500).json({ message: 'Failed to update alert' });
  }
};
