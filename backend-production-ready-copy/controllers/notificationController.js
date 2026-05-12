const Notification = require('../models/Notification');
const Device = require('../models/Device');
const AllowedDevice = require('../models/AllowedDevice');
const DeviceLog = require('../models/DeviceLog');
const DeviceShare = require('../models/DeviceShare');
const { topicOf, publishMessage } = require('../config/mqtt');
const { emitToUser } = require('../config/socket');

// ============================================================
// getAll
// ============================================================
exports.getAll = async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);

    const [notifications, unreadCount] = await Promise.all([
      Notification.getForUser(userId, limit),
      Notification.getUnreadCount(userId),
    ]);

    res.json({ notifications, unreadCount });
  } catch (error) {
    console.error('Get notifications error:', error.message);
    res.status(500).json({ message: 'Failed to fetch notifications' });
  }
};

// ============================================================
// getUnreadCount
// ============================================================
exports.getUnreadCount = async (req, res) => {
  try {
    const count = await Notification.getUnreadCount(req.user.id);
    res.json({ count });
  } catch (error) {
    console.error('Get unread count error:', error.message);
    res.status(500).json({ message: 'Failed to fetch unread count' });
  }
};

// ============================================================
// markAsRead
// ============================================================
exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const notification = await Notification.findOneAndUpdate(
      { _id: id, recipient: userId },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.json({ message: 'Marked as read', notification });
  } catch (error) {
    console.error('Mark as read error:', error.message);
    res.status(500).json({ message: 'Failed to mark notification as read' });
  }
};

// ============================================================
// markAllAsRead
// ============================================================
exports.markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.user.id, isRead: false },
      { isRead: true }
    );

    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Mark all as read error:', error.message);
    res.status(500).json({ message: 'Failed to mark all as read' });
  }
};

// ============================================================
// respondToTransfer
// ============================================================
exports.respondToTransfer = async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;
    const userId = req.user.id;

    if (!action || !['approve', 'deny'].includes(action)) {
      return res.status(400).json({ message: 'Action must be "approve" or "deny"' });
    }

    const notification = await Notification.findOne({
      _id: id,
      recipient: userId,
      type: 'transfer_request',
      status: 'pending',
    });

    if (!notification) {
      return res.status(404).json({ message: 'Transfer request not found or already responded' });
    }

    const { serialNumber, deviceName, requesterId } = notification.data;

    if (action === 'approve') {
      const device = await Device.findOne({ serialNumber, owner: userId });

      if (!device) {
        notification.status = 'expired';
        notification.respondedAt = new Date();
        notification.isRead = true;
        await notification.save();
        return res.status(404).json({ message: 'Device not found or already unlinked' });
      }

      device.owner = null;
      device.pairedAt = null;
      device.name = `Device ${serialNumber}`;
      device.state = {};
      await device.save();

      await DeviceLog.deleteMany({ serialNumber });

      // Drop any shares for this device — ownership is being released, so
      // previously-shared users should lose access immediately. Notify each
      // formerly-shared user before deletion.
      const sharesToNotify = await DeviceShare.find({
        device: device._id,
        status: { $in: ['pending', 'active'] },
      }).select('sharedWith').lean();

      await DeviceShare.deleteMany({ device: device._id });

      for (const s of sharesToNotify) {
        try {
          const cascadeNotif = await Notification.create({
            recipient: s.sharedWith,
            type: 'share_revoked',
            message: `Your access to "${deviceName || serialNumber}" was removed because ownership of the device was released.`,
            data: {
              serialNumber,
              deviceName: deviceName || serialNumber,
              ownerId: userId,
            },
          });
          emitToUser(s.sharedWith, 'notification:new', cascadeNotif);
          emitToUser(s.sharedWith, 'device:share-revoked', { serialNumber });
        } catch (notifErr) {
          console.error('Cascade share-revoked notification failed:', notifErr.message);
        }
      }

      await AllowedDevice.findOneAndUpdate(
        { serialNumber },
        { activatedBy: null }
      );

      try {
        const topic = topicOf(serialNumber, 'command');
        await publishMessage(topic, {
          command: 'unpaired',
          source: 'system',
          ts: Date.now(),
        });
      } catch (mqttErr) {
        console.log('MQTT notify failed (non-critical):', mqttErr.message);
      }

      notification.status = 'approved';
      notification.respondedAt = new Date();
      notification.isRead = true;
      await notification.save();

      if (requesterId) {
        await Notification.create({
          recipient: requesterId,
          type: 'transfer_approved',
          message: `Your request to link "${deviceName || serialNumber}" has been approved. You can now pair the device.`,
          data: { serialNumber, deviceName },
        });
      }

      await DeviceLog.create({
        serialNumber,
        type: 'warning',
        message: 'Device ownership released by owner (transfer request approved)',
        source: 'server',
      });

      console.log(`Transfer approved: ${serialNumber} released by user ${userId}`);

      res.json({
        message: 'Device unlinked successfully. The requester can now pair it.',
      });

    } else {
      notification.status = 'denied';
      notification.respondedAt = new Date();
      notification.isRead = true;
      await notification.save();

      if (requesterId) {
        await Notification.create({
          recipient: requesterId,
          type: 'transfer_denied',
          message: `Your request to link "${deviceName || serialNumber}" has been denied by the device owner.`,
          data: { serialNumber, deviceName },
        });
      }

      console.log(`Transfer denied: ${serialNumber} by user ${userId}`);

      res.json({ message: 'Transfer request denied' });
    }
  } catch (error) {
    console.error('Respond to transfer error:', error.message);
    res.status(500).json({ message: 'Failed to respond to transfer request' });
  }
};
