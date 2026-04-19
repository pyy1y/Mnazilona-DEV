const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');
const auth = require('../middleware/auth');
const { deviceInquiryLimiter, apiLimiter } = require('../middleware/rateLimiter');
const { enforceDeviceOwnership, mqttAuthWebhook } = require('../services/mqttAclService');
const { validate, deviceInquirySchema, devicePairSchema, deviceUnpairSchema, deviceCommandSchema, deviceRenameSchema, deviceValidateSchema } = require('../middleware/validate');

// Device Setup (ESP32 calls this)
router.post('/inquiry', deviceInquiryLimiter, validate(deviceInquirySchema), deviceController.inquiry);

// Device Validation (mobile app calls before pairing)
router.post('/validate', auth, apiLimiter, validate(deviceValidateSchema), deviceController.validateDevice);

// Device Binding
router.post('/pair', auth, apiLimiter, validate(devicePairSchema), deviceController.pair);
router.post('/unpair', auth, apiLimiter, validate(deviceUnpairSchema), deviceController.unpair);

// Device Management
router.get('/', auth, deviceController.getAll);
router.get('/all-logs', auth, deviceController.getAllLogs);
router.get('/:serialNumber', auth, deviceController.getOne);
router.patch('/:serialNumber/rename', auth, apiLimiter, enforceDeviceOwnership, validate(deviceRenameSchema), deviceController.renameDevice);
router.get('/:serialNumber/logs', auth, deviceController.getLogs);

// Device Commands (with ACL enforcement)
router.post('/:serialNumber/command', auth, apiLimiter, enforceDeviceOwnership, validate(deviceCommandSchema), deviceController.sendCommand);

// OTA Endpoints (called by ESP32 devices - authenticated via device headers)
router.get('/ota/check', deviceInquiryLimiter, deviceController.otaCheck);
router.get('/ota/download/:firmwareId', deviceController.otaDownload);

// MQTT Broker Auth Webhook - secret is REQUIRED
const mqttWebhookGuard = (req, res, next) => {
  const webhookSecret = process.env.MQTT_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('MQTT_WEBHOOK_SECRET is not configured - rejecting webhook request');
    return res.status(503).json({ result: 'deny' });
  }
  if (req.headers['x-webhook-secret'] !== webhookSecret) {
    return res.status(403).json({ result: 'deny' });
  }
  next();
};
router.post('/mqtt/auth', apiLimiter, mqttWebhookGuard, mqttAuthWebhook);

module.exports = router;
