const mqtt = require('mqtt');
const Device = require('../models/Device');
const DeviceLog = require('../models/DeviceLog');
const {
  emitToAdminLobby,
  emitToAdminDevicesView,
  emitToDeviceWatchers,
  emitToUser,
} = require('./socket');
const logger = require('../utils/logger');

const fs = require('fs');

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://localhost';
const MQTT_BROKER_HOST = process.env.MQTT_BROKER_HOST || 'localhost';
const MQTT_PUBLIC_HOST = process.env.MQTT_PUBLIC_HOST || MQTT_BROKER_HOST;
const MQTT_PUBLIC_PORT = parseInt(process.env.MQTT_PUBLIC_PORT, 10) || 1883;

const mqttOptions = {
  username: process.env.MQTT_USERNAME || 'mqtt-user',
  password: process.env.MQTT_PASSWORD,
  clientId: `backend-server-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  clean: true,
  connectTimeout: 30000,
  reconnectPeriod: 5000,
  keepalive: 60,
};

// MQTT TLS: if cert files are configured, enable TLS
const mqttCaPath = process.env.MQTT_CA_PATH;
const mqttCertPath = process.env.MQTT_CERT_PATH;
const mqttKeyPath = process.env.MQTT_KEY_PATH;

if (mqttCaPath && fs.existsSync(mqttCaPath)) {
  mqttOptions.ca = [fs.readFileSync(mqttCaPath)];
  mqttOptions.rejectUnauthorized = process.env.MQTT_REJECT_UNAUTHORIZED !== 'false';
  logger.info('MQTT TLS: CA certificate loaded');
}
if (mqttCertPath && mqttKeyPath && fs.existsSync(mqttCertPath) && fs.existsSync(mqttKeyPath)) {
  mqttOptions.cert = fs.readFileSync(mqttCertPath);
  mqttOptions.key = fs.readFileSync(mqttKeyPath);
  logger.info('MQTT TLS: Client certificate loaded');
}

const TOPICS = {
  STATUS: 'mnazilona/devices/+/status',
  HEARTBEAT: 'mnazilona/devices/+/heartbeat',
  DP_REPORT: 'mnazilona/devices/+/dp/report',
  OTA_PROGRESS: 'mnazilona/devices/+/ota/progress',
};

let mqttClient = null;
let isConnected = false;

const topicOf = (serialNumber, leaf) => `mnazilona/devices/${serialNumber}/${leaf}`;

const parseTopicParts = (topic) => {
  const parts = topic.split('/');
  if (parts.length < 4 || parts[0] !== 'mnazilona' || parts[1] !== 'devices') {
    return null;
  }
  return { serialNumber: parts[2], leaf: parts.slice(3).join('/') };
};

const safeJsonParse = (str) => {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
};

// Deduplication cache
const recentLogs = new Map();
const DEDUP_WINDOW_MS = 10000;

// Per-device cache of the last dp/report payload we emitted. Devices commonly
// publish unchanged state on a timer; this skips the socket fan-out (and the
// owner's mobile push) when nothing actually changed. We still write the DB
// (lastSeen needs to advance) — only the socket emit is suppressed.
const lastEmittedDpPayload = new Map();

// Device meta cache (existence + owner + name) - avoids DB query on every MQTT message
const deviceMetaCache = new Map();
const DEVICE_CACHE_TTL_MS = 60000; // 1 minute

const getDeviceMeta = async (serialNumber) => {
  const sn = serialNumber.toUpperCase();
  const now = Date.now();
  const cached = deviceMetaCache.get(sn);

  if (cached && now - cached.time < DEVICE_CACHE_TTL_MS) {
    return cached.meta;
  }

  const device = await Device.findOne({ serialNumber: sn })
    .select('owner name deviceType')
    .lean();
  const meta = device
    ? { exists: true, ownerId: device.owner ? device.owner.toString() : null, name: device.name, deviceType: device.deviceType }
    : { exists: false, ownerId: null, name: null, deviceType: null };

  deviceMetaCache.set(sn, { meta, time: now });

  // Cleanup old entries periodically
  if (deviceMetaCache.size > 1000) {
    for (const [key, val] of deviceMetaCache) {
      if (now - val.time > DEVICE_CACHE_TTL_MS) deviceMetaCache.delete(key);
    }
  }

  return meta;
};

// Backwards-compatible existence check
const isDeviceKnown = async (serialNumber) => (await getDeviceMeta(serialNumber)).exists;

// Public: invalidate the cache when ownership changes (called by deviceController on pair/unpair)
const invalidateDeviceMeta = (serialNumber) => {
  if (!serialNumber) return;
  deviceMetaCache.delete(serialNumber.toUpperCase());
};

const logDevice = async (serialNumber, type, message, source = 'device') => {
  try {
    const sn = serialNumber.toUpperCase();
    const key = `${sn}:${message}`;
    const now = Date.now();
    const lastTime = recentLogs.get(key);
    if (lastTime && now - lastTime < DEDUP_WINDOW_MS) return;
    recentLogs.set(key, now);

    if (recentLogs.size > 500) {
      for (const [k, t] of recentLogs) {
        if (now - t > DEDUP_WINDOW_MS) recentLogs.delete(k);
      }
    }

    const log = await DeviceLog.create({ serialNumber: sn, type, message, source });

    // Push the new log entry to the device owner in real time
    const meta = await getDeviceMeta(sn);
    if (meta.ownerId) {
      emitToUser(meta.ownerId, 'device:log', {
        serialNumber: sn,
        deviceName: meta.name || sn,
        type: log.type,
        message: log.message,
        source: log.source,
        timestamp: log.createdAt,
      });
    }
  } catch (err) {
    logger.error('DeviceLog failed', { error: err.message });
  }
};

const handleStatusMessage = async (serialNumber, message) => {
  const sn = serialNumber.toUpperCase();
  const isOnline = message === 'online';
  const updateData = { isOnline };
  if (isOnline) updateData.lastSeen = new Date();

  const device = await Device.findOneAndUpdate({ serialNumber: sn }, updateData, { new: true })
    .populate('owner', 'name email')
    .lean();
  if (!device) return;

  await logDevice(sn, 'info',
    isOnline ? 'Device came online' : 'Device went offline',
    'mqtt'
  );

  const updatePayload = {
    serialNumber: sn,
    isOnline: device.isOnline,
    lastSeen: device.lastSeen,
    deviceType: device.deviceType,
    name: device.name,
    state: device.state,
  };

  // Status (online/offline) is relevant on the devices index AND on the
  // per-device detail page. Both rooms get it; admins on other pages don't.
  const adminPayload = { ...updatePayload, owner: device.owner };
  emitToAdminDevicesView('device:status', adminPayload);
  emitToDeviceWatchers(sn, 'device:status', adminPayload);

  // Push to the owner's mobile app sockets
  if (device.owner?._id) {
    emitToUser(device.owner._id, 'device:update', updatePayload);
  }
};

const handleHeartbeatMessage = async (serialNumber, message) => {
  const sn = serialNumber.toUpperCase();
  const payload = safeJsonParse(message);
  const update = { isOnline: true, lastSeen: new Date() };

  if (payload && (payload.doorState === 'open' || payload.doorState === 'closed')) {
    update['state.doorState'] = payload.doorState;
  }

  const device = await Device.findOneAndUpdate({ serialNumber: sn }, update, { new: true })
    .select('owner name deviceType isOnline lastSeen state')
    .lean();
  if (!device) return;

  // Heartbeat is high-frequency and only useful when an admin is actively
  // looking at this device. Scope it to the per-device room.
  emitToDeviceWatchers(sn, 'device:heartbeat', {
    serialNumber: sn,
    isOnline: true,
    lastSeen: device.lastSeen,
    payload,
  });

  if (device.owner) {
    emitToUser(device.owner, 'device:update', {
      serialNumber: sn,
      isOnline: true,
      lastSeen: device.lastSeen,
      state: device.state,
    });
  }
};

const handleDpReportMessage = async (serialNumber, message) => {
  const sn = serialNumber.toUpperCase();
  const payload = safeJsonParse(message);
  if (!payload) {
    logger.warn('Invalid JSON on dp/report', { serialNumber: sn });
    return;
  }

  // Build a single update with everything the report carries
  const update = { isOnline: true, lastSeen: new Date() };
  if (payload.doorState === 'open' || payload.doorState === 'closed') {
    update['state.doorState'] = payload.doorState;
  }
  if (typeof payload.relay === 'string') {
    update['state.relay'] = payload.relay;
  }

  const device = await Device.findOneAndUpdate({ serialNumber: sn }, update, { new: true })
    .select('owner name deviceType isOnline lastSeen state')
    .lean();
  if (!device) return;

  if (payload.relay === 'opened') {
    await logDevice(sn, 'info', 'Relay activated - door opened', 'device');
  }
  if (payload.doorState === 'open' || payload.doorState === 'closed') {
    await logDevice(sn, 'info', `Door sensor: ${payload.doorState}`, 'device');
  }

  // Skip the socket fan-out if the payload is byte-identical to the last
  // one we emitted for this device. The DB still advanced lastSeen above.
  const payloadKey = JSON.stringify(payload);
  if (lastEmittedDpPayload.get(sn) === payloadKey) return;
  lastEmittedDpPayload.set(sn, payloadKey);
  if (lastEmittedDpPayload.size > 1000) {
    // Bounded — drop the oldest half. Map iteration is insertion-ordered.
    const toDrop = lastEmittedDpPayload.size - 500;
    let i = 0;
    for (const k of lastEmittedDpPayload.keys()) {
      if (i++ >= toDrop) break;
      lastEmittedDpPayload.delete(k);
    }
  }

  // Telemetry — same reasoning as heartbeat: per-device room only.
  emitToDeviceWatchers(sn, 'device:dp_report', { serialNumber: sn, payload });

  if (device.owner) {
    emitToUser(device.owner, 'device:update', {
      serialNumber: sn,
      isOnline: true,
      lastSeen: device.lastSeen,
      state: device.state,
    });
  }
};

const handleOtaProgressMessage = async (serialNumber, message) => {
  const payload = safeJsonParse(message);
  if (!payload) return;

  const { status, progress, version, error } = payload;
  const update = { lastSeen: new Date(), isOnline: true };

  if (status) update.otaStatus = status;
  if (progress !== undefined) update.otaProgress = progress;
  if (version) update.otaTargetVersion = version;
  if (error) update.otaError = error;

  if (status === 'downloading' && !update.otaStartedAt) {
    update.otaStartedAt = new Date();
  }
  if (status === 'success' || status === 'failed' || status === 'rolled_back') {
    update.otaCompletedAt = new Date();
  }
  if (status === 'success' && version) {
    update.firmwareVersion = version;
    update.otaProgress = 100;
  }

  await Device.findOneAndUpdate({ serialNumber }, update);

  await logDevice(serialNumber,
    status === 'failed' || status === 'rolled_back' ? 'error' : 'info',
    `OTA ${status}${progress !== undefined ? ` (${progress}%)` : ''}${version ? ` v${version}` : ''}${error ? `: ${error}` : ''}`,
    'device'
  );

  const sn = serialNumber.toUpperCase();
  const progressPayload = { serialNumber: sn, status, progress, version, error };

  // Fine-grained progress: per-device room only (high frequency).
  emitToDeviceWatchers(serialNumber, 'ota:progress', progressPayload);

  // Lifecycle (terminal status only): broadcast to lobby so the firmware
  // fleet view refreshes when an OTA completes/fails. The "started"
  // lifecycle event is emitted by the OTA controller at push time, so
  // we don't need to emit on intermediate states like "downloading".
  if (status === 'success' || status === 'failed' || status === 'rolled_back') {
    emitToAdminLobby('ota:lifecycle', progressPayload);
  }
};

const handleMessage = async (topic, messageBuf) => {
  try {
    const parsed = parseTopicParts(topic);
    if (!parsed || !parsed.serialNumber) return;

    const { serialNumber, leaf } = parsed;
    const message = messageBuf.toString();

    // Only process messages for devices that exist in the DB (cached for 1 min)
    const deviceExists = await isDeviceKnown(serialNumber);
    if (!deviceExists) return;

    switch (leaf) {
      case 'status':
        await handleStatusMessage(serialNumber, message);
        break;
      case 'heartbeat':
        await handleHeartbeatMessage(serialNumber, message);
        break;
      case 'dp/report':
        await handleDpReportMessage(serialNumber, message);
        break;
      case 'ota/progress':
        await handleOtaProgressMessage(serialNumber, message);
        break;
    }
  } catch (error) {
    logger.error('Error handling MQTT message', { error: error.message });
  }
};

const setupMQTT = () => {
  if (!process.env.MQTT_PASSWORD) {
    logger.warn('MQTT_PASSWORD not set');
  }

  mqttClient = mqtt.connect(MQTT_BROKER_URL, mqttOptions);

  mqttClient.on('connect', () => {
    isConnected = true;
    logger.info(`MQTT connected to ${MQTT_BROKER_URL}`);
    mqttClient.subscribe(Object.values(TOPICS), { qos: 1 }, (err) => {
      if (err) logger.error('MQTT subscription error', { error: err.message });
      else logger.info('MQTT subscribed to device topics');
    });
  });

  mqttClient.on('message', handleMessage);
  mqttClient.on('error', (err) => { logger.error('MQTT error', { error: err.message }); isConnected = false; emitToAdminLobby('service:status', { mqtt: 'disconnected' }); });
  mqttClient.on('reconnect', () => logger.info('MQTT reconnecting...'));
  mqttClient.on('close', () => { isConnected = false; emitToAdminLobby('service:status', { mqtt: 'disconnected' }); });
  mqttClient.on('offline', () => { isConnected = false; emitToAdminLobby('service:status', { mqtt: 'disconnected' }); });

  return mqttClient;
};

const publishMessage = (topic, payload, options = { qos: 1 }) => {
  return new Promise((resolve, reject) => {
    if (!mqttClient || !isConnected) {
      return reject(new Error('MQTT client not connected'));
    }
    const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
    mqttClient.publish(topic, message, options, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const disconnectMQTT = () => {
  return new Promise((resolve) => {
    if (!mqttClient) return resolve();
    mqttClient.end(false, {}, () => {
      logger.info('MQTT disconnected');
      isConnected = false;
      resolve();
    });
  });
};

const isMqttHealthy = () => isConnected;

module.exports = {
  mqttClient: () => mqttClient,
  setupMQTT,
  disconnectMQTT,
  topicOf,
  publishMessage,
  isMqttHealthy,
  invalidateDeviceMeta,
  MQTT_BROKER_HOST,
  MQTT_BROKER_URL,
  MQTT_PUBLIC_HOST,
  MQTT_PUBLIC_PORT,
};
