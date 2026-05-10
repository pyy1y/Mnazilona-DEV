const express = require('express');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const adminController = require('../controllers/adminController');
const adminWebsiteRoutes = require('./adminWebsiteRoutes');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const { apiLimiter, otpSendLimiter, otpVerifyLimiter } = require('../middleware/rateLimiter');
const { validate, loginSendCodeSchema, loginVerifyCodeSchema, adminRegisterDeviceSchema, adminRegisterBatchSchema, adminBanDeviceSchema, adminUnbanDeviceSchema, adminTransferDeviceSchema, adminCommandSchema, adminLockDeviceSchema, blockIPSchema } = require('../middleware/validate');

// Multer config for firmware uploads
const firmwareStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'uploads', 'firmware'));
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${timestamp}-${safeName}`);
  },
});

const firmwareUpload = multer({
  storage: firmwareStorage,
  limits: { fileSize: 16 * 1024 * 1024 }, // 16MB max (ESP32 firmware usually < 4MB)
  fileFilter: (req, file, cb) => {
    const allowed = ['.bin', '.ota', '.img'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed: ${allowed.join(', ')}`));
    }
  },
});

// Admin Login with OTP (2-step: credentials then verify code)
router.post('/login/send-code', otpSendLimiter, validate(loginSendCodeSchema), adminController.loginSendCode);
router.post('/login/verify-code', otpVerifyLimiter, validate(loginVerifyCodeSchema), adminController.loginVerifyCode);

// All routes below require auth + admin role
router.use(auth, adminAuth);

// Dashboard
router.get('/dashboard', adminController.getDashboard);

// Landing Page CMS
router.use('/website', adminWebsiteRoutes);

// User Management
router.get('/users', adminController.listUsers);
router.get('/users/:userId', adminController.getUser);
router.post('/users/:userId/deactivate', adminController.deactivateUser);
router.post('/users/:userId/activate', adminController.activateUser);
router.post('/users/:userId/force-logout', adminController.forceLogout);
router.delete('/users/:userId', adminController.deleteUser);

// AllowedDevices (Whitelist) Management
router.post('/devices/register', apiLimiter, validate(adminRegisterDeviceSchema), adminController.registerDevice);
router.post('/devices/register-batch', apiLimiter, validate(adminRegisterBatchSchema), adminController.registerBatch);
router.get('/allowed-devices', adminController.listAllowedDevices);
router.post('/devices/ban', apiLimiter, validate(adminBanDeviceSchema), adminController.banDevice);
router.post('/devices/unban', apiLimiter, validate(adminUnbanDeviceSchema), adminController.unbanDevice);

// Paired Devices Management
router.get('/devices', adminController.listPairedDevices);
router.get('/devices/:serialNumber', adminController.getDevice);
router.post('/devices/:serialNumber/command', apiLimiter, validate(adminCommandSchema), adminController.sendCommand);
router.post('/devices/:serialNumber/unpair', adminController.unpairDevice);
router.post('/devices/:serialNumber/transfer', validate(adminTransferDeviceSchema), adminController.transferDevice);
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
router.post('/devices/:serialNumber/lock', validate(adminLockDeviceSchema), adminController.lockDevice);
router.post('/devices/:serialNumber/unlock', adminController.unlockDevice);

// Firmware Management
router.get('/firmware/stats', adminController.getFirmwareStats);
router.get('/firmware', adminController.listFirmware);
router.post('/firmware', firmwareUpload.single('firmware'), adminController.createFirmware);
router.put('/firmware/:firmwareId', firmwareUpload.single('firmware'), adminController.updateFirmware);
router.delete('/firmware/:firmwareId', adminController.deleteFirmware);

// OTA Management
router.post('/firmware/:firmwareId/push', apiLimiter, adminController.pushOtaUpdate);
router.get('/ota/status', adminController.getOtaStatus);
router.post('/ota/clear/:serialNumber', adminController.clearOtaStatus);
router.post('/ota/clear-all', adminController.clearAllOtaStatus);

// IP Blacklist Management
router.get('/blacklist', adminController.listBlacklist);
router.post('/blacklist', validate(blockIPSchema), adminController.blockIP);
router.post('/blacklist/:ip/unblock', adminController.unblockIP);
router.delete('/blacklist/:id', adminController.deleteBlacklistEntry);

// Anomaly Detection
router.get('/anomalies', adminController.listAnomalies);
router.patch('/anomalies/:id', adminController.updateAnomalyStatus);

module.exports = router;
