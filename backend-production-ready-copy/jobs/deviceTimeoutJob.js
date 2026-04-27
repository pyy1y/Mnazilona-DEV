const Device = require('../models/Device');
const DeviceLog = require('../models/DeviceLog');
const { emitToAdmins } = require('../config/socket');

const HEARTBEAT_TIMEOUT_MS = parseInt(process.env.HEARTBEAT_TIMEOUT_MS, 10) || 2 * 60 * 1000;
const CHECK_INTERVAL_MS = parseInt(process.env.DEVICE_CHECK_INTERVAL_MS, 10) || 60 * 1000;

let intervalId = null;
let isRunning = false;

const checkDeviceTimeouts = async () => {
  if (isRunning) return;
  isRunning = true;

  try {
    const cutoffTime = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);

    const timedOutDevices = await Device.find(
      { isOnline: true, lastSeen: { $lt: cutoffTime } },
      { serialNumber: 1, lastSeen: 1, deviceType: 1, name: 1 }
    ).lean();

    const result = await Device.updateMany(
      { isOnline: true, lastSeen: { $lt: cutoffTime } },
      { $set: { isOnline: false } }
    );

    if (result.modifiedCount > 0) {
      console.log(`Marked ${result.modifiedCount} device(s) as offline`);

      const logs = timedOutDevices.map((d) => ({
        serialNumber: d.serialNumber,
        type: 'warning',
        message: `Device marked offline - no heartbeat for ${Math.round(HEARTBEAT_TIMEOUT_MS / 1000)}s`,
        source: 'server',
      }));
      await DeviceLog.insertMany(logs);

      // Notify admin dashboards so live counts and per-device status badges
      // update immediately, instead of staying stale until a manual refresh.
      for (const d of timedOutDevices) {
        emitToAdmins('device:status', {
          serialNumber: d.serialNumber,
          isOnline: false,
          lastSeen: d.lastSeen,
          deviceType: d.deviceType,
          name: d.name,
        });
      }
    }
  } catch (error) {
    console.error('Device timeout job error:', error.message);
  } finally {
    isRunning = false;
  }
};

const startDeviceTimeoutJob = () => {
  if (intervalId) return;
  checkDeviceTimeouts();
  intervalId = setInterval(checkDeviceTimeouts, CHECK_INTERVAL_MS);
  console.log(`Device timeout job started (timeout: ${HEARTBEAT_TIMEOUT_MS / 1000}s, interval: ${CHECK_INTERVAL_MS / 1000}s)`);
};

const stopDeviceTimeoutJob = () => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('Device timeout job stopped');
  }
};

module.exports = { startDeviceTimeoutJob, stopDeviceTimeoutJob, checkDeviceTimeouts, HEARTBEAT_TIMEOUT_MS };
