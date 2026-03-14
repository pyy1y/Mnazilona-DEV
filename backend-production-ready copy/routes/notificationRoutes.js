const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const auth = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimiter');

router.get('/', auth, notificationController.getAll);
router.get('/unread-count', auth, notificationController.getUnreadCount);
router.patch('/read-all', auth, apiLimiter, notificationController.markAllAsRead);
router.patch('/:id/read', auth, apiLimiter, notificationController.markAsRead);
router.post('/:id/respond', auth, apiLimiter, notificationController.respondToTransfer);

module.exports = router;
