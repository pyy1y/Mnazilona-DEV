const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Device = require('../models/Device');
const logger = require('../utils/logger');

let io = null;

// Admin room layout — see /admin namespace block below for the full picture.
const ADMIN_LOBBY = 'admin:lobby';
const ADMIN_DEVICES_VIEW = 'admin:devices';
const ADMIN_USERS_VIEW = 'admin:users';
const ADMIN_MONITORING_VIEW = 'admin:monitoring';
const adminDeviceRoom = (sn) => `admin:device:${sn.toString().toUpperCase()}`;

// Defense against a buggy/malicious client trying to join thousands of rooms.
const MAX_ROOMS_PER_ADMIN_SOCKET = 50;

const SERIAL_RX = /^[A-Z0-9_-]{1,64}$/i;

const ROOM_RESOLVERS = {
  device: ({ id } = {}) => {
    if (typeof id !== 'string' || !SERIAL_RX.test(id)) return null;
    return adminDeviceRoom(id);
  },
  devices: () => ADMIN_DEVICES_VIEW,
  users: () => ADMIN_USERS_VIEW,
  monitoring: () => ADMIN_MONITORING_VIEW,
};

const resolveAdminRoom = (payload) => {
  const resolver = ROOM_RESOLVERS[payload?.topic];
  return resolver ? resolver(payload) : null;
};

// Emit the current state of a device to a single socket immediately after it
// joins admin:device:<sn>. Lets the detail page recover from reconnects
// without a full REST refetch — it just patches over what it has.
const sendDeviceSnapshot = async (socket, serialNumber) => {
  try {
    const sn = serialNumber.toString().toUpperCase();
    const device = await Device.findOne({ serialNumber: sn })
      .select('serialNumber name deviceType isOnline lastSeen state otaStatus otaProgress otaTargetVersion otaError firmwareVersion')
      .lean();
    if (!device) return;
    socket.emit('device:snapshot', {
      serialNumber: sn,
      name: device.name,
      deviceType: device.deviceType,
      isOnline: device.isOnline,
      lastSeen: device.lastSeen,
      state: device.state || {},
      otaStatus: device.otaStatus,
      otaProgress: device.otaProgress,
      otaTargetVersion: device.otaTargetVersion,
      otaError: device.otaError,
      firmwareVersion: device.firmwareVersion,
      at: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('device snapshot failed', { error: err.message, serialNumber });
  }
};

const setupSocket = (httpServer) => {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  io = new Server(httpServer, {
    cors: {
      // Mobile clients send no Origin header, so allow all when no whitelist
      // is configured. Web origins are still pinned via ALLOWED_ORIGINS.
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  // ----------------------------------------------------------------
  // Shared JWT verification (same rules as REST middleware/auth.js)
  // ----------------------------------------------------------------
  const verifyJwt = async (socket) => {
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.headers?.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) throw new Error('Authentication required');

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.id) throw new Error('Invalid token');

    const user = await User.findById(decoded.id).select('tokenVersion role name email');
    if (!user) throw new Error('User not found');

    const tokenVersion = decoded.tokenVersion ?? 0;
    if (tokenVersion !== (user.tokenVersion || 0)) {
      throw new Error('Session expired');
    }

    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
    };
  };

  // ----------------------------------------------------------------
  // /admin namespace (admin dashboard)
  //
  // Room layout:
  //   admin:lobby            -> auto-joined; low-frequency dashboard-wide
  //                             events (broker up/down, alerts, etc.)
  //   admin:devices          -> admins on the devices index page
  //   admin:device:<SERIAL>  -> admins on a specific device detail page
  //                             (receives heartbeat / telemetry / ota %)
  //   admin:users            -> admins on the users index page
  //   admin:monitoring       -> admins on the live monitoring view
  //
  // The dashboard joins/leaves the per-page rooms via "subscribe" /
  // "unsubscribe" events. This keeps high-frequency events (heartbeat,
  // dp_report) off admins who aren't looking at the relevant device.
  // ----------------------------------------------------------------
  const adminNsp = io.of('/admin');
  adminNsp.use(async (socket, next) => {
    try {
      const userData = await verifyJwt(socket);
      if (userData.role !== 'admin') return next(new Error('Admin access required'));
      socket.adminData = userData;
      next();
    } catch (err) {
      next(new Error(err.message || 'Authentication failed'));
    }
  });
  adminNsp.on('connection', (socket) => {
    logger.info(`Admin socket connected: ${socket.adminData.email} [${socket.id}]`);
    socket.join(ADMIN_LOBBY);

    socket.on('subscribe', (payload, ack) => {
      const room = resolveAdminRoom(payload);
      if (!room) {
        if (typeof ack === 'function') ack({ ok: false, error: 'invalid topic' });
        return;
      }
      // socket.rooms includes socket.id itself, so the cap is effectively N rooms.
      if (socket.rooms.size > MAX_ROOMS_PER_ADMIN_SOCKET) {
        if (typeof ack === 'function') ack({ ok: false, error: 'subscription cap reached' });
        return;
      }
      socket.join(room);
      if (typeof ack === 'function') ack({ ok: true, room });

      // Per-device room: send a snapshot to this socket so the detail page
      // has fresh state without an extra REST roundtrip on reconnect.
      if (payload?.topic === 'device' && payload?.id) {
        sendDeviceSnapshot(socket, payload.id);
      }
    });

    socket.on('unsubscribe', (payload, ack) => {
      const room = resolveAdminRoom(payload);
      if (room) socket.leave(room);
      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('disconnect', (reason) => {
      logger.info(`Admin socket disconnected: ${socket.adminData.email} [${reason}]`);
    });
  });

  // ----------------------------------------------------------------
  // /app namespace (new — mobile app users)
  // Each user joins a private room "user:<id>" so we can target only
  // them when their devices change state.
  // ----------------------------------------------------------------
  const appNsp = io.of('/app');
  appNsp.use(async (socket, next) => {
    try {
      const userData = await verifyJwt(socket);
      socket.userData = userData;
      next();
    } catch (err) {
      next(new Error(err.message || 'Authentication failed'));
    }
  });
  appNsp.on('connection', (socket) => {
    const userId = socket.userData.id;
    socket.join(`user:${userId}`);
    logger.info(`App socket connected: ${socket.userData.email} [${socket.id}]`);

    socket.on('disconnect', (reason) => {
      logger.info(`App socket disconnected: ${socket.userData.email} [${reason}]`);
    });
  });

  return io;
};

// Broadcast to every admin socket. Use sparingly — prefer the room-scoped
// helpers below so high-frequency events don't reach admins who aren't
// looking at the relevant view.
const emitToAdmins = (event, data) => {
  if (!io) return;
  io.of('/admin').emit(event, data);
};

// Lobby: every admin auto-joins. Low-frequency, dashboard-wide events
// (broker up/down, alerts, OTA started/completed, new device registered).
const emitToAdminLobby = (event, data) => {
  if (!io) return;
  io.of('/admin').to(ADMIN_LOBBY).emit(event, data);
};

// Devices index: only admins viewing the devices list page.
const emitToAdminDevicesView = (event, data) => {
  if (!io) return;
  io.of('/admin').to(ADMIN_DEVICES_VIEW).emit(event, data);
};

// Per-device room: only admins on a specific device's detail page.
// Use for heartbeat / telemetry / OTA progress % / per-device logs.
const emitToDeviceWatchers = (serialNumber, event, data) => {
  if (!io || !serialNumber) return;
  io.of('/admin').to(adminDeviceRoom(serialNumber)).emit(event, data);
};

// Users index: only admins on the users list page.
const emitToAdminUsersView = (event, data) => {
  if (!io) return;
  io.of('/admin').to(ADMIN_USERS_VIEW).emit(event, data);
};

// Live monitoring/security view.
const emitToAdminMonitoring = (event, data) => {
  if (!io) return;
  io.of('/admin').to(ADMIN_MONITORING_VIEW).emit(event, data);
};

// Emit to a single user across all of their open app sockets.
const emitToUser = (userId, event, data) => {
  if (!io || !userId) return;
  io.of('/app').to(`user:${userId.toString()}`).emit(event, data);
};

const getIO = () => io;

module.exports = {
  setupSocket,
  emitToAdmins,
  emitToAdminLobby,
  emitToAdminDevicesView,
  emitToDeviceWatchers,
  emitToAdminUsersView,
  emitToAdminMonitoring,
  emitToUser,
  getIO,
};
