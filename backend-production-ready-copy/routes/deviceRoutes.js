const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');
const auth = require('../middleware/auth');
const { deviceInquiryLimiter, apiLimiter } = require('../middleware/rateLimiter');
const { enforceDeviceOwnership, mqttAuthWebhook } = require('../services/mqttAclService');

// Device Setup (ESP32 calls this)
router.post('/inquiry', deviceInquiryLimiter, deviceController.inquiry);

// Device Validation (mobile app calls before pairing)
router.post('/validate', auth, apiLimiter, deviceController.validateDevice);

// Device Binding
router.post('/pair', auth, apiLimiter, deviceController.pair);
router.post('/unpair', auth, apiLimiter, deviceController.unpair);

// Device Management
router.get('/', auth, deviceController.getAll);
router.get('/all-logs', auth, deviceController.getAllLogs);
router.get('/:serialNumber', auth, deviceController.getOne);
router.patch('/:serialNumber/rename', auth, apiLimiter, enforceDeviceOwnership, deviceController.renameDevice);
router.get('/:serialNumber/logs', auth, deviceController.getLogs);

// Device Commands (with ACL enforcement)
router.post('/:serialNumber/command', auth, apiLimiter, enforceDeviceOwnership, deviceController.sendCommand);

// MQTT Broker Auth Webhook
const mqttWebhookGuard = (req, res, next) => {
  const webhookSecret = process.env.MQTT_WEBHOOK_SECRET;
  if (webhookSecret && req.headers['x-webhook-secret'] !== webhookSecret) {
    return res.status(403).json({ result: 'deny' });
  }
  next();
};
router.post('/mqtt/auth', apiLimiter, mqttWebhookGuard, mqttAuthWebhook);

module.exports = router;
