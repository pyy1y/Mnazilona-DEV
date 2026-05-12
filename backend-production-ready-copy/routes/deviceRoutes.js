const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');
const deviceShareController = require('../controllers/deviceShareController');
const auth = require('../middleware/auth');
const { deviceInquiryLimiter, apiLimiter } = require('../middleware/rateLimiter');
const { enforceDeviceOwnership, mqttAuthWebhook } = require('../services/mqttAclService');
const { requireDeviceAccess } = require('../middleware/deviceAccess');
const { validate, deviceInquirySchema, devicePairSchema, deviceUnpairSchema, deviceCommandSchema, deviceRenameSchema, deviceValidateSchema, deviceShareInviteSchema } = require('../middleware/validate');

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
router.get('/:serialNumber', auth, requireDeviceAccess('view'), deviceController.getOne);
router.patch('/:serialNumber/rename', auth, apiLimiter, enforceDeviceOwnership, validate(deviceRenameSchema), deviceController.renameDevice);
router.get('/:serialNumber/logs', auth, requireDeviceAccess('view'), deviceController.getLogs);

// Device Commands (owner OR shared user with 'control')
router.post('/:serialNumber/command', auth, apiLimiter, requireDeviceAccess('control'), validate(deviceCommandSchema), deviceController.sendCommand);

// Device Sharing (owner-side)
router.post('/:serialNumber/shares', auth, apiLimiter, enforceDeviceOwnership, validate(deviceShareInviteSchema), deviceShareController.invite);
router.get('/:serialNumber/shares', auth, enforceDeviceOwnership, deviceShareController.list);
router.delete('/:serialNumber/shares/:shareId', auth, apiLimiter, enforceDeviceOwnership, deviceShareController.revoke);

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
