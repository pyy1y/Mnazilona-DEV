const mongoose = require('mongoose');
const Room = require('../models/Room');
const Device = require('../models/Device');

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
    const ownerId = mongoose.Types.ObjectId.createFromHexString(req.user.id);
    const deviceCounts = await Device.aggregate([
      { $match: { owner: ownerId, room: { $in: roomIds } } },
      { $group: { _id: '$room', count: { $sum: 1 } } },
    ]);

    const countMap = {};
    deviceCounts.forEach((dc) => {
      countMap[dc._id.toString()] = dc.count;
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

    const room = await Room.findOne({ _id: id, owner: req.user.id });
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    const device = await Device.findOne({
      serialNumber: serialNumber.trim().toUpperCase(),
      owner: req.user.id,
    });
    if (!device) {
      return res.status(404).json({ message: 'Device not found or not owned by you' });
    }

    device.room = room._id;
    await device.save();

    res.json({
      message: `Device "${device.name}" assigned to "${room.name}"`,
      device: {
        serialNumber: device.serialNumber,
        name: device.name,
        room: room._id,
      },
    });
  } catch (error) {
    console.error('Assign device error:', error.message);
    res.status(500).json({ message: 'Failed to assign device to room' });
  }
};

// ============================================================
// removeDevice
// ============================================================
exports.removeDevice = async (req, res) => {
  try {
    const { id, serialNumber } = req.params;

    const room = await Room.findOne({ _id: id, owner: req.user.id });
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    const device = await Device.findOne({
      serialNumber: serialNumber.trim().toUpperCase(),
      owner: req.user.id,
      room: room._id,
    });
    if (!device) {
      return res.status(404).json({ message: 'Device not found in this room' });
    }

    device.room = null;
    await device.save();

    res.json({
      message: `Device "${device.name}" removed from "${room.name}"`,
    });
  } catch (error) {
    console.error('Remove device from room error:', error.message);
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

    const devices = await Device.find({ room: room._id, owner: req.user.id })
      .select('name serialNumber macAddress deviceType isOnline lastSeen pairedAt state')
      .sort({ pairedAt: -1 })
      .lean();

    res.json({ room: room.toJSON(), devices });
  } catch (error) {
    console.error('Get room devices error:', error.message);
    res.status(500).json({ message: 'Failed to fetch room devices' });
  }
};
