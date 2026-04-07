const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

let io = null;

const setupSocket = (httpServer) => {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : false,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  // Admin-only namespace for dashboard
  const adminNsp = io.of('/admin');

  adminNsp.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded.id) return next(new Error('Invalid token'));

      const user = await User.findById(decoded.id).select('tokenVersion role name email');
      if (!user) return next(new Error('User not found'));

      const tokenVersion = decoded.tokenVersion ?? 0;
      if (tokenVersion !== (user.tokenVersion || 0)) {
        return next(new Error('Session expired'));
      }

      if (user.role !== 'admin') return next(new Error('Admin access required'));

      socket.adminData = {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
      };

      next();
    } catch (err) {
      next(new Error('Authentication failed'));
    }
  });

  adminNsp.on('connection', (socket) => {
    console.log(`Admin connected: ${socket.adminData.email} [${socket.id}]`);

    socket.on('disconnect', (reason) => {
      console.log(`Admin disconnected: ${socket.adminData.email} [${reason}]`);
    });
  });

  return io;
};

// Emit to all connected admins
const emitToAdmins = (event, data) => {
  if (!io) return;
  io.of('/admin').emit(event, data);
};

const getIO = () => io;

module.exports = { setupSocket, emitToAdmins, getIO };
