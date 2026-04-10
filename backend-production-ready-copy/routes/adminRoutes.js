const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const { apiLimiter, otpSendLimiter, otpVerifyLimiter } = require('../middleware/rateLimiter');

// Admin Login with OTP (2-step: credentials then verify code)
router.post('/login/send-code', otpSendLimiter, adminController.loginSendCode);
router.post('/login/verify-code', otpVerifyLimiter, adminController.loginVerifyCode);

// All routes below require auth + admin role
router.use(auth, adminAuth);

// Dashboard
router.get('/dashboard', adminController.getDashboard);

// User Management
router.get('/users', adminController.listUsers);
router.get('/users/:userId', adminController.getUser);
router.post('/users/:userId/deactivate', adminController.deactivateUser);
router.post('/users/:userId/activate', adminController.activateUser);
router.post('/users/:userId/force-logout', adminController.forceLogout);
router.delete('/users/:userId', adminController.deleteUser);

// AllowedDevices (Whitelist) Management
router.post('/devices/register', apiLimiter, adminController.registerDevice);
router.post('/devices/register-batch', apiLimiter, adminController.registerBatch);
router.get('/allowed-devices', adminController.listAllowedDevices);
router.post('/devices/ban', apiLimiter, adminController.banDevice);
router.post('/devices/unban', apiLimiter, adminController.unbanDevice);

// Paired Devices Management
router.get('/devices', adminController.listPairedDevices);
router.get('/devices/:serialNumber', adminController.getDevice);
router.post('/devices/:serialNumber/command', apiLimiter, adminController.sendCommand);
router.post('/devices/:serialNumber/unpair', adminController.unpairDevice);
router.post('/devices/:serialNumber/transfer', adminController.transferDevice);
router.post('/devices/:serialNumber/factory-reset', apiLimiter, adminController.factoryResetDevice);

// Logs
router.get('/logs', adminController.getAllLogs);
router.get('/audit-logs', adminController.getAuditLogs);

// Security
router.get('/security', adminController.getSecurityOverview);

// Stats (backward compat)
router.get('/stats', adminController.getDeviceStats);

// Rate Limit Monitoring
router.get('/rate-limits', adminController.getRateLimits);

// Device Override Controls
router.get('/devices/:serialNumber/detail', adminController.getDeviceDetail);
router.post('/devices/:serialNumber/lock', adminController.lockDevice);
router.post('/devices/:serialNumber/unlock', adminController.unlockDevice);

// Firmware Management
router.get('/firmware/stats', adminController.getFirmwareStats);
router.get('/firmware', adminController.listFirmware);
router.post('/firmware', adminController.createFirmware);
router.put('/firmware/:firmwareId', adminController.updateFirmware);
router.delete('/firmware/:firmwareId', adminController.deleteFirmware);

// IP Blacklist Management
router.get('/blacklist', adminController.listBlacklist);
router.post('/blacklist', adminController.blockIP);
router.post('/blacklist/:ip/unblock', adminController.unblockIP);
router.delete('/blacklist/:id', adminController.deleteBlacklistEntry);

// Anomaly Detection
router.get('/anomalies', adminController.listAnomalies);
router.patch('/anomalies/:id', adminController.updateAnomalyStatus);

module.exports = router;
