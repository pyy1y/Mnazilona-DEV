const AnomalyAlert = require('../models/AnomalyAlert');
const IPBlacklist = require('../models/IPBlacklist');
const { emitToAdminLobby, emitToAdminMonitoring } = require('../config/socket');
const { forceRefreshBlacklist } = require('../middleware/ipBlacklist');

const ANOMALY_DISABLED = process.env.DISABLE_ANOMALY_DETECTOR === 'true';

// In-memory tracking windows
const trackers = {
  failedLogins: new Map(),    // ip -> { count, firstAt }
  failedOtps: new Map(),      // ip -> { count, firstAt }
  deviceCommands: new Map(),  // serialNumber -> { count, firstAt }
  ipEndpoints: new Map(),     // ip -> Set of endpoints
  adminActions: new Map(),    // adminId -> { count, firstAt }
  pairAttempts: new Map(),    // serialNumber -> { ips: Set, count, firstAt }
};

// Thresholds
const THRESHOLDS = {
  FAILED_LOGINS: { max: 10, windowMs: 15 * 60 * 1000 },       // 10 failed logins in 15 min
  FAILED_OTPS: { max: 15, windowMs: 15 * 60 * 1000 },         // 15 failed OTPs in 15 min
  DEVICE_COMMANDS: { max: 100, windowMs: 5 * 60 * 1000 },     // 100 commands in 5 min
  IP_ENDPOINTS: { max: 50, windowMs: 1 * 60 * 1000 },         // 50 different endpoints in 1 min
  ADMIN_ACTIONS: { max: 200, windowMs: 10 * 60 * 1000 },      // 200 admin actions in 10 min
  PAIR_ATTEMPTS: { max: 5, windowMs: 30 * 60 * 1000 },        // 5 pair attempts in 30 min
};

// Auto-block severity mapping
const AUTO_BLOCK_SEVERITY = ['high', 'critical'];
const AUTO_BLOCK_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Helper: clean expired entries from a tracker
const cleanTracker = (tracker, windowMs) => {
  const cutoff = Date.now() - windowMs;
  for (const [key, val] of tracker) {
    if (val.firstAt < cutoff) tracker.delete(key);
  }
};

// Helper: create alert and optionally auto-block
const createAlert = async (type, severity, ip, target, description, details = {}) => {
  try {
    // Check for duplicate recent alert (same type + ip/target within 1 hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const existing = await AnomalyAlert.findOne({
      type,
      ip: ip || null,
      target: target || null,
      createdAt: { $gte: oneHourAgo },
      status: 'open',
    });

    if (existing) {
      // Update existing alert with new details
      existing.details = { ...existing.details, ...details, lastOccurrence: new Date() };
      await existing.save();
      return existing;
    }

    let autoBlocked = false;

    // Auto-block IP for high/critical severity
    if (ip && AUTO_BLOCK_SEVERITY.includes(severity)) {
      const alreadyBlocked = await IPBlacklist.findOne({ ip, isActive: true });
      if (!alreadyBlocked) {
        await IPBlacklist.create({
          ip,
          reason: `Auto-blocked: ${description}`,
          source: 'anomaly_detector',
          expiresAt: new Date(Date.now() + AUTO_BLOCK_DURATION),
        });
        forceRefreshBlacklist();
        autoBlocked = true;
      }
    }

    const alert = await AnomalyAlert.create({
      type,
      severity,
      ip,
      target,
      description,
      details,
      autoBlocked,
    });

    // Anomalies go to two places: the lobby (every admin gets the badge /
    // toast) and the monitoring view (live feed). Same payload — the
    // dashboard just dedupes by alert.id when both rooms deliver it.
    const payload = {
      id: alert._id,
      type: alert.type,
      severity: alert.severity,
      ip: alert.ip,
      target: alert.target,
      description: alert.description,
      autoBlocked: alert.autoBlocked,
      createdAt: alert.createdAt,
    };
    emitToAdminLobby('anomaly:alert', payload);
    emitToAdminMonitoring('anomaly:alert', payload);

    return alert;
  } catch (err) {
    console.error('Anomaly alert creation failed:', err.message);
  }
};

// ============================================================
// TRACKING FUNCTIONS (called from routes/middleware)
// ============================================================

const trackFailedLogin = (ip) => {
  cleanTracker(trackers.failedLogins, THRESHOLDS.FAILED_LOGINS.windowMs);

  const entry = trackers.failedLogins.get(ip) || { count: 0, firstAt: Date.now() };
  entry.count++;
  trackers.failedLogins.set(ip, entry);

  if (entry.count >= THRESHOLDS.FAILED_LOGINS.max) {
    createAlert(
      'brute_force',
      entry.count >= THRESHOLDS.FAILED_LOGINS.max * 2 ? 'critical' : 'high',
      ip,
      null,
      `${entry.count} failed login attempts from ${ip} in ${THRESHOLDS.FAILED_LOGINS.windowMs / 60000} minutes`,
      { attempts: entry.count, window: THRESHOLDS.FAILED_LOGINS.windowMs }
    );
    trackers.failedLogins.delete(ip);
  }
};

const trackFailedOtp = (ip, email) => {
  cleanTracker(trackers.failedOtps, THRESHOLDS.FAILED_OTPS.windowMs);

  const entry = trackers.failedOtps.get(ip) || { count: 0, firstAt: Date.now() };
  entry.count++;
  trackers.failedOtps.set(ip, entry);

  if (entry.count >= THRESHOLDS.FAILED_OTPS.max) {
    createAlert(
      'multiple_failed_otp',
      'high',
      ip,
      email,
      `${entry.count} failed OTP attempts from ${ip}`,
      { attempts: entry.count, email }
    );
    trackers.failedOtps.delete(ip);
  }
};

const trackDeviceCommand = (serialNumber, ip) => {
  cleanTracker(trackers.deviceCommands, THRESHOLDS.DEVICE_COMMANDS.windowMs);

  const entry = trackers.deviceCommands.get(serialNumber) || { count: 0, firstAt: Date.now() };
  entry.count++;
  trackers.deviceCommands.set(serialNumber, entry);

  if (entry.count >= THRESHOLDS.DEVICE_COMMANDS.max) {
    createAlert(
      'device_flood',
      'medium',
      ip,
      serialNumber,
      `Device ${serialNumber} received ${entry.count} commands in ${THRESHOLDS.DEVICE_COMMANDS.windowMs / 60000} minutes`,
      { commands: entry.count, serialNumber }
    );
    trackers.deviceCommands.delete(serialNumber);
  }
};

const trackEndpointAccess = (ip, endpoint) => {
  const now = Date.now();
  const entry = trackers.ipEndpoints.get(ip) || { endpoints: new Set(), firstAt: now };

  // Reset if window expired
  if (now - entry.firstAt > THRESHOLDS.IP_ENDPOINTS.windowMs) {
    entry.endpoints = new Set();
    entry.firstAt = now;
  }

  entry.endpoints.add(endpoint);
  trackers.ipEndpoints.set(ip, entry);

  if (entry.endpoints.size >= THRESHOLDS.IP_ENDPOINTS.max) {
    createAlert(
      'suspicious_ip',
      'high',
      ip,
      null,
      `IP ${ip} hit ${entry.endpoints.size} different endpoints in ${THRESHOLDS.IP_ENDPOINTS.windowMs / 60000} minute(s)`,
      { endpointCount: entry.endpoints.size, sampleEndpoints: [...entry.endpoints].slice(0, 10) }
    );
    trackers.ipEndpoints.delete(ip);
  }
};

const trackAdminAction = (adminId, adminEmail) => {
  cleanTracker(trackers.adminActions, THRESHOLDS.ADMIN_ACTIONS.windowMs);

  const entry = trackers.adminActions.get(adminId) || { count: 0, firstAt: Date.now() };
  entry.count++;
  trackers.adminActions.set(adminId, entry);

  if (entry.count >= THRESHOLDS.ADMIN_ACTIONS.max) {
    createAlert(
      'unusual_admin_activity',
      'medium',
      null,
      adminEmail,
      `Admin ${adminEmail} performed ${entry.count} actions in ${THRESHOLDS.ADMIN_ACTIONS.windowMs / 60000} minutes`,
      { actions: entry.count, adminId, adminEmail }
    );
    trackers.adminActions.delete(adminId);
  }
};

const trackPairAttempt = (serialNumber, ip) => {
  cleanTracker(trackers.pairAttempts, THRESHOLDS.PAIR_ATTEMPTS.windowMs);

  const entry = trackers.pairAttempts.get(serialNumber) || { ips: new Set(), count: 0, firstAt: Date.now() };
  entry.ips.add(ip);
  entry.count++;
  trackers.pairAttempts.set(serialNumber, entry);

  if (entry.count >= THRESHOLDS.PAIR_ATTEMPTS.max) {
    createAlert(
      'device_takeover',
      entry.ips.size > 2 ? 'critical' : 'high',
      ip,
      serialNumber,
      `Device ${serialNumber} has ${entry.count} pair attempts from ${entry.ips.size} different IPs`,
      { attempts: entry.count, uniqueIPs: entry.ips.size, ips: [...entry.ips] }
    );
    trackers.pairAttempts.delete(serialNumber);
  }
};

// Cleanup old entries periodically (every 5 minutes)
setInterval(() => {
  for (const [name, threshold] of Object.entries(THRESHOLDS)) {
    const trackerName = {
      FAILED_LOGINS: 'failedLogins',
      FAILED_OTPS: 'failedOtps',
      DEVICE_COMMANDS: 'deviceCommands',
      IP_ENDPOINTS: 'ipEndpoints',
      ADMIN_ACTIONS: 'adminActions',
      PAIR_ATTEMPTS: 'pairAttempts',
    }[name];
    if (trackerName && trackers[trackerName]) {
      cleanTracker(trackers[trackerName], threshold.windowMs);
    }
  }
}, 5 * 60 * 1000);

const noop = () => {};

module.exports = ANOMALY_DISABLED
  ? {
      trackFailedLogin: noop,
      trackFailedOtp: noop,
      trackDeviceCommand: noop,
      trackEndpointAccess: noop,
      trackAdminAction: noop,
      trackPairAttempt: noop,
    }
  : {
      trackFailedLogin,
      trackFailedOtp,
      trackDeviceCommand,
      trackEndpointAccess,
      trackAdminAction,
      trackPairAttempt,
    };
