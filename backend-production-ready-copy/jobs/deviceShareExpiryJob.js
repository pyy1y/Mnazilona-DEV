const DeviceShare = require('../models/DeviceShare');
const Notification = require('../models/Notification');
const Device = require('../models/Device');
const { emitToUser } = require('../config/socket');

const CHECK_INTERVAL_MS =
  parseInt(process.env.SHARE_EXPIRY_INTERVAL_MS, 10) || 10 * 60 * 1000; // 10 minutes

let intervalId = null;
let isRunning = false;

const sweepExpiredShares = async () => {
  if (isRunning) return;
  isRunning = true;

  try {
    const now = new Date();

    // Find rows to expire BEFORE updating so we can notify each invitee.
    const expiring = await DeviceShare.find({
      status: 'pending',
      expiresAt: { $lte: now },
    })
      .select('_id device serialNumber sharedWith owner')
      .lean();

    if (expiring.length === 0) {
      return;
    }

    const ids = expiring.map((s) => s._id);
    const result = await DeviceShare.updateMany(
      { _id: { $in: ids }, status: 'pending' },
      { $set: { status: 'expired', respondedAt: now } }
    );

    if (result.modifiedCount > 0) {
      console.log(`Expired ${result.modifiedCount} pending device share(s)`);
    }

    // Best-effort: ping the invitee so their notifications list refreshes.
    // We don't write a new notification — the original share_request just
    // becomes uninteractable; the next refetch will see expiresAt < now.
    const deviceIds = [...new Set(expiring.map((s) => String(s.device)))];
    const devices = await Device.find({ _id: { $in: deviceIds } })
      .select('_id name serialNumber')
      .lean();
    const deviceById = new Map(devices.map((d) => [String(d._id), d]));

    for (const share of expiring) {
      const device = deviceById.get(String(share.device));
      try {
        // Mark the original share_request notification as expired so the
        // mobile app removes the Accept/Decline buttons.
        await Notification.updateMany(
          {
            recipient: share.sharedWith,
            type: 'share_request',
            'data.shareId': share._id,
            status: 'pending',
          },
          { $set: { status: 'expired', respondedAt: now } }
        );

        emitToUser(share.sharedWith, 'share:expired', {
          shareId: String(share._id),
          serialNumber: share.serialNumber,
          deviceName: device?.name || share.serialNumber,
        });
      } catch (notifErr) {
        console.error('Share expiry notification update failed:', notifErr.message);
      }
    }
  } catch (error) {
    console.error('Device share expiry job error:', error.message);
  } finally {
    isRunning = false;
  }
};

const startDeviceShareExpiryJob = () => {
  if (intervalId) return;
  sweepExpiredShares();
  intervalId = setInterval(sweepExpiredShares, CHECK_INTERVAL_MS);
  console.log(
    `Device share expiry job started (interval: ${CHECK_INTERVAL_MS / 1000}s)`
  );
};

const stopDeviceShareExpiryJob = () => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('Device share expiry job stopped');
  }
};

module.exports = {
  startDeviceShareExpiryJob,
  stopDeviceShareExpiryJob,
  sweepExpiredShares,
};
