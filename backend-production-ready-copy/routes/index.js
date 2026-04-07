const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const deviceRoutes = require('./deviceRoutes');
const apiRoutes = require('./apiRoutes');
const notificationRoutes = require('./notificationRoutes');
const roomRoutes = require('./roomRoutes');
const adminRoutes = require('./adminRoutes');

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
  });
});

module.exports = router;
