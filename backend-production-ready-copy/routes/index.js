const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const deviceRoutes = require('./deviceRoutes');
const apiRoutes = require('./apiRoutes');
const notificationRoutes = require('./notificationRoutes');
const roomRoutes = require('./roomRoutes');
const adminRoutes = require('./adminRoutes');

// API v1 routes
const v1 = express.Router();
v1.use('/auth', authRoutes);
v1.use('/devices', deviceRoutes);
v1.use('/api', apiRoutes);
v1.use('/notifications', notificationRoutes);
v1.use('/rooms', roomRoutes);
v1.use('/admin', adminRoutes);

router.use('/v1', v1);

// Backward compatibility: mount same routes at root (remove when all clients migrate to /v1)
router.use('/auth', authRoutes);
router.use('/devices', deviceRoutes);
router.use('/api', apiRoutes);
router.use('/notifications', notificationRoutes);
router.use('/rooms', roomRoutes);
router.use('/admin', adminRoutes);

router.get('/', (req, res) => {
  res.json({
    name: 'Mnazilona IoT API',
    version: '1.0.0',
    endpoints: {
      v1: '/v1',
    },
  });
});

module.exports = router;
