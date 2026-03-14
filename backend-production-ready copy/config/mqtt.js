const mqtt = require('mqtt');
const Device = require('../models/Device');
const DeviceLog = require('../models/DeviceLog');

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://localhost';
const MQTT_BROKER_HOST = process.env.MQTT_BROKER_HOST || 'localhost';

const mqttOptions = {
  username: process.env.MQTT_USERNAME || 'mqtt-user',
  password: process.env.MQTT_PASSWORD,
  clientId: `backend-server-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
  clean: true,
  connectTimeout: 30000,
  reconnectPeriod: 5000,
  keepalive: 60,
};

const TOPICS = {
  STATUS: 'manazel/devices/+/status',
  HEARTBEAT: 'manazel/devices/+/heartbeat',
  DP_REPORT: 'manazel/devices/+/dp/report',
};

let mqttClient = null;
let isConnected = false;

const topicOf = (serialNumber, leaf) => `manazel/devices/${serialNumber}/${leaf}`;

const parseTopicParts = (topic) => {
  const parts = topic.split('/');
  if (parts.length < 4 || parts[0] !== 'manazel' || parts[1] !== 'devices') {
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

const logDevice = async (serialNumber, type, message, source = 'device') => {
  try {
    const key = `${serialNumber.toUpperCase()}:${message}`;
    const now = Date.now();
    const lastTime = recentLogs.get(key);
    if (lastTime && now - lastTime < DEDUP_WINDOW_MS) return;
    recentLogs.set(key, now);

    if (recentLogs.size > 500) {
      for (const [k, t] of recentLogs) {
        if (now - t > DEDUP_WINDOW_MS) recentLogs.delete(k);
      }
    }

    await DeviceLog.create({ serialNumber: serialNumber.toUpperCase(), type, message, source });
  } catch (err) {
    console.error(`DeviceLog failed: ${err.message}`);
  }
};

const handleStatusMessage = async (serialNumber, message) => {
  const isOnline = message === 'online';
  const updateData = { isOnline };
  if (isOnline) updateData.lastSeen = new Date();
  await Device.findOneAndUpdate({ serialNumber }, updateData);

  await logDevice(serialNumber, 'info',
    isOnline ? 'Device came online' : 'Device went offline',
    'mqtt'
  );
};

const handleHeartbeatMessage = async (serialNumber, message) => {
  const payload = safeJsonParse(message);
  const update = { isOnline: true, lastSeen: new Date() };

  if (payload && (payload.doorState === 'open' || payload.doorState === 'closed')) {
    update['state.doorState'] = payload.doorState;
  }

  await Device.findOneAndUpdate({ serialNumber }, update);
};

const handleDpReportMessage = async (serialNumber, message) => {
  const payload = safeJsonParse(message);
  if (!payload) {
    console.warn(`Invalid JSON on dp/report from ${serialNumber}`);
    return;
  }
  await Device.findOneAndUpdate({ serialNumber }, { isOnline: true, lastSeen: new Date() });

  if (payload.relay === 'opened') {
    await logDevice(serialNumber, 'info', 'Relay activated - door opened', 'device');
  }

  if (payload.doorState === 'open' || payload.doorState === 'closed') {
    await Device.findOneAndUpdate(
      { serialNumber },
      { 'state.doorState': payload.doorState }
    );
    await logDevice(serialNumber, 'info', `Door sensor: ${payload.doorState}`, 'device');
  }
};

const handleMessage = async (topic, messageBuf) => {
  try {
    const parsed = parseTopicParts(topic);
    if (!parsed || !parsed.serialNumber) return;

    const { serialNumber, leaf } = parsed;
    const message = messageBuf.toString();

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
    }
  } catch (error) {
    console.error('Error handling MQTT message:', error.message);
  }
};

const setupMQTT = () => {
  if (!process.env.MQTT_PASSWORD) {
    console.warn('WARNING: MQTT_PASSWORD not set');
  }

  mqttClient = mqtt.connect(MQTT_BROKER_URL, mqttOptions);

  mqttClient.on('connect', () => {
    isConnected = true;
    console.log(`MQTT connected to ${MQTT_BROKER_URL}`);
    mqttClient.subscribe(Object.values(TOPICS), { qos: 1 }, (err) => {
      if (err) console.error('MQTT subscription error:', err.message);
      else console.log('MQTT subscribed to device topics');
    });
  });

  mqttClient.on('message', handleMessage);
  mqttClient.on('error', (err) => { console.error('MQTT error:', err.message); isConnected = false; });
  mqttClient.on('reconnect', () => console.log('MQTT reconnecting...'));
  mqttClient.on('close', () => { isConnected = false; });
  mqttClient.on('offline', () => { isConnected = false; });

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
      console.log('MQTT disconnected');
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
  MQTT_BROKER_HOST,
  MQTT_BROKER_URL,
};
