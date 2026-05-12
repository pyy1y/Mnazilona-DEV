const express = require('express');
const router = express.Router();
const deviceShareController = require('../controllers/deviceShareController');
const auth = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimiter');

// Invitee-side endpoints
router.post('/:shareId/accept', auth, apiLimiter, deviceShareController.accept);
router.post('/:shareId/reject', auth, apiLimiter, deviceShareController.reject);

module.exports = router;
