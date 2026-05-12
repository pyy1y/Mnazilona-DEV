const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const deviceRoutes = require('./deviceRoutes');
const apiRoutes = require('./apiRoutes');
const notificationRoutes = require('./notificationRoutes');
const roomRoutes = require('./roomRoutes');
const adminRoutes = require('./adminRoutes');
<<<<<<< HEAD
const shareRoutes = require('./shareRoutes');
=======
const websiteRoutes = require('./websiteRoutes');
const adminWebsiteRoutes = require('./adminWebsiteRoutes');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
>>>>>>> c7012356ca1e3928ff3b797aa12173ee2ec3d193

// API v1 routes
const v1 = express.Router();
v1.use('/auth', authRoutes);
v1.use('/devices', deviceRoutes);
v1.use('/api', apiRoutes);
v1.use('/notifications', notificationRoutes);
v1.use('/rooms', roomRoutes);
v1.use('/admin', adminRoutes);
<<<<<<< HEAD
v1.use('/shares', shareRoutes);
=======
v1.use('/website', websiteRoutes);
>>>>>>> c7012356ca1e3928ff3b797aa12173ee2ec3d193

router.use('/v1', v1);

// Production-facing aliases for the landing-page CMS API.
router.use('/api/v1/website', websiteRoutes);
router.use('/api/v1/admin/website', auth, adminAuth, adminWebsiteRoutes);

// Backward compatibility: mount same routes at root (remove when all clients migrate to /v1)
router.use('/auth', authRoutes);
router.use('/devices', deviceRoutes);
router.use('/api', apiRoutes);
router.use('/notifications', notificationRoutes);
router.use('/rooms', roomRoutes);
router.use('/admin', adminRoutes);
router.use('/shares', shareRoutes);

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
