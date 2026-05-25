const mongoose = require('mongoose');
const Room = require('../models/Room');
const Device = require('../models/Device');
const UserDeviceRoom = require('../models/UserDeviceRoom');
const { getDeviceAccessRole } = require('../services/deviceAccessService');

// FIX: Escape regex special characters to prevent ReDoS attacks
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// getAll
// ============================================================
exports.getAll = async (req, res) => {
  try {
    const rooms = await Room.findByOwner(req.user.id);

    const roomIds = rooms.map((r) => r._id);
    const userId = mongoose.Types.ObjectId.createFromHexString(req.user.id);

    // Count both owned-device assignments (Device.room) and shared-device
    // assignments (UserDeviceRoom) so a shared device the user filed into one
    // of their rooms still bumps the badge.
    const [ownedCounts, sharedCounts] = await Promise.all([
      Device.aggregate([
        { $match: { owner: userId, room: { $in: roomIds } } },
        { $group: { _id: '$room', count: { $sum: 1 } } },
      ]),
      UserDeviceRoom.aggregate([
        { $match: { user: userId, room: { $in: roomIds } } },
        { $group: { _id: '$room', count: { $sum: 1 } } },
      ]),
    ]);

    const countMap = {};
    ownedCounts.forEach((c) => {
      const key = c._id.toString();
      countMap[key] = (countMap[key] || 0) + c.count;
    });
    sharedCounts.forEach((c) => {
      const key = c._id.toString();
      countMap[key] = (countMap[key] || 0) + c.count;
    });

    const result = rooms.map((room) => ({
      ...room.toJSON(),
      deviceCount: countMap[room._id.toString()] || 0,
    }));

    res.json({ count: result.length, rooms: result });
  } catch (error) {
    console.error('Get rooms error:', error.message);
    res.status(500).json({ message: 'Failed to fetch rooms' });
  }
};

// ============================================================
// create
// ============================================================
exports.create = async (req, res) => {
  try {
    const { name, icon } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'Room name is required' });
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 50) {
      return res.status(400).json({ message: 'Room name must be 50 characters or less' });
    }

    // FIX: Escape user input before using in regex to prevent ReDoS
    const existing = await Room.findOne({
      owner: req.user.id,
      name: { $regex: new RegExp(`^${escapeRegex(trimmedName)}$`, 'i') },
    });

    if (existing) {
      return res.status(409).json({ message: 'A room with this name already exists' });
    }

    const lastRoom = await Room.findOne({ owner: req.user.id }).sort({ order: -1 });
    const nextOrder = lastRoom ? lastRoom.order + 1 : 0;

    const room = await Room.create({
      name: trimmedName,
      icon: icon || 'door',
      owner: req.user.id,
      order: nextOrder,
    });

    res.status(201).json({
      message: 'Room created successfully',
      room: { ...room.toJSON(), deviceCount: 0 },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'A room with this name already exists' });
    }
    console.error('Create room error:', error.message);
    res.status(500).json({ message: 'Failed to create room' });
  }
};

// ============================================================
// update
// ============================================================
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, icon } = req.body;

    const room = await Room.findOne({ _id: id, owner: req.user.id });
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    if (name !== undefined) {
      const trimmedName = (name || '').trim();
      if (!trimmedName) {
        return res.status(400).json({ message: 'Room name cannot be empty' });
      }
      if (trimmedName.length > 50) {
        return res.status(400).json({ message: 'Room name must be 50 characters or less' });
      }

      // FIX: Escape user input before using in regex to prevent ReDoS
      const existing = await Room.findOne({
        owner: req.user.id,
        _id: { $ne: id },
        name: { $regex: new RegExp(`^${escapeRegex(trimmedName)}$`, 'i') },
      });
      if (existing) {
        return res.status(409).json({ message: 'A room with this name already exists' });
      }

      room.name = trimmedName;
    }

    if (icon !== undefined) {
      room.icon = icon;
    }

    await room.save();

    const deviceCount = await Device.countDocuments({ room: room._id, owner: req.user.id });

    res.json({
      message: 'Room updated successfully',
      room: { ...room.toJSON(), deviceCount },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'A room with this name already exists' });
    }
    console.error('Update room error:', error.message);
    res.status(500).json({ message: 'Failed to update room' });
  }
};

// ============================================================
// remove
// ============================================================
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;

    const room = await Room.findOne({ _id: id, owner: req.user.id });
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    await Device.updateMany({ room: room._id, owner: req.user.id }, { $set: { room: null } });
    await UserDeviceRoom.deleteMany({ user: req.user.id, room: room._id });
    await room.deleteOne();

    res.json({ message: 'Room deleted successfully' });
  } catch (error) {
    console.error('Delete room error:', error.message);
    res.status(500).json({ message: 'Failed to delete room' });
  }
};

// ============================================================
// assignDevice
// ============================================================
exports.assignDevice = async (req, res) => {
  try {
    const { id } = req.params;
    const { serialNumber } = req.body;

    if (!serialNumber) {
      return res.status(400).json({ message: 'Serial number is required' });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid room ID' });
    }

    // Room must belong to the caller — owner XOR shared user, each has their own rooms.
    const room = await Room.findOne({ _id: id, owner: req.user.id });
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    const cleanSerial = serialNumber.trim().toUpperCase();
    const { role, device } = await getDeviceAccessRole(req.user.id, cleanSerial);

    if (role === 'none' || !device) {
      return res.status(404).json({
        message: 'You do not have access to this device.',
      });
    }

    if (role === 'owner') {
      // Owner path — assignment lives on Device.room (unchanged)
      device.room = room._id;
      await device.save();
    } else {
      // Shared path — per-user mapping. Upsert so the same device can be moved
      // between rooms by the shared user without violating the unique
      // (user, device) index.
      await UserDeviceRoom.findOneAndUpdate(
        { user: req.user.id, device: device._id },
        {
          user: req.user.id,
          device: device._id,
          serialNumber: cleanSerial,
          room: room._id,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    res.json({
      message: `Device "${device.name}" assigned to "${room.name}"`,
      device: {
        serialNumber: device.serialNumber,
        name: device.name,
        room: room._id,
      },
    });
  } catch (error) {
    console.error('Assign device error:', error.message, error.stack);
    res.status(500).json({
      message: 'Failed to assign device to room',
      debug: error.message,
    });
  }
};

// ============================================================
// removeDevice
// ============================================================
exports.removeDevice = async (req, res) => {
  try {
    const { id, serialNumber } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid room ID' });
    }

    const room = await Room.findOne({ _id: id, owner: req.user.id });
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    const cleanSerial = serialNumber.trim().toUpperCase();
    const { role, device } = await getDeviceAccessRole(req.user.id, cleanSerial);

    if (role === 'none' || !device) {
      return res.status(404).json({ message: 'Device not found in this room' });
    }

    if (role === 'owner') {
      const updated = await Device.findOneAndUpdate(
        { _id: device._id, owner: req.user.id, room: room._id },
        { room: null },
        { new: true, select: 'name serialNumber deviceType room' }
      );
      if (!updated) {
        return res.status(404).json({ message: 'Device not found in this room' });
      }
    } else {
      const removed = await UserDeviceRoom.findOneAndDelete({
        user: req.user.id,
        device: device._id,
        room: room._id,
      });
      if (!removed) {
        return res.status(404).json({ message: 'Device not found in this room' });
      }
    }

    res.json({
      message: `Device "${device.name}" removed from "${room.name}"`,
    });
  } catch (error) {
    console.error('Remove device from room error:', error.message, error.stack);
    res.status(500).json({ message: 'Failed to remove device from room' });
  }
};

// ============================================================
// getDevices
// ============================================================
exports.getDevices = async (req, res) => {
  try {
    const { id } = req.params;

    const room = await Room.findOne({ _id: id, owner: req.user.id });
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    const OWNER_FIELDS  = 'name serialNumber macAddress deviceType isOnline lastSeen pairedAt state';
    const SHARED_FIELDS = 'name serialNumber deviceType isOnline lastSeen pairedAt state';

    const [ownedDevices, sharedMapRows] = await Promise.all([
      Device.find({ room: room._id, owner: req.user.id })
        .select(OWNER_FIELDS)
        .sort({ pairedAt: -1 })
        .lean(),
      UserDeviceRoom.find({ user: req.user.id, room: room._id })
        .populate({ path: 'device', select: SHARED_FIELDS })
        .lean(),
    ]);

    const owned = ownedDevices.map((d) => ({ ...d, role: 'owner' }));
    const shared = sharedMapRows
      .filter((r) => r.device)
      .map((r) => ({ ...r.device, role: 'shared' }));

    res.json({ room: room.toJSON(), devices: [...owned, ...shared] });
  } catch (error) {
    console.error('Get room devices error:', error.message);
    res.status(500).json({ message: 'Failed to fetch room devices' });
  }
};
