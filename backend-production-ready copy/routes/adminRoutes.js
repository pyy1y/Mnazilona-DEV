const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const auth = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimiter');

// Admin Auth Middleware
const adminAuth = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    console.warn(`Admin access denied for user: ${req.user?.id}`);
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// Device Allowlist Management
router.post('/devices/register', auth, adminAuth, apiLimiter, adminController.registerDevice);
router.post('/devices/register-batch', auth, adminAuth, apiLimiter, adminController.registerBatch);
router.get('/devices', auth, adminAuth, adminController.listDevices);

// Device Moderation
router.post('/devices/ban', auth, adminAuth, apiLimiter, adminController.banDevice);
router.post('/devices/unban', auth, adminAuth, apiLimiter, adminController.unbanDevice);

// Stats
router.get('/stats', auth, adminAuth, adminController.getDeviceStats);

module.exports = router;
