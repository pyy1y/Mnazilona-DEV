const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roomController = require('../controllers/roomController');

router.use(auth);

router.get('/', roomController.getAll);
router.post('/', roomController.create);
router.patch('/:id', roomController.update);
router.delete('/:id', roomController.remove);

router.get('/:id/devices', roomController.getDevices);
router.post('/:id/devices', roomController.assignDevice);
router.delete('/:id/devices/:serialNumber', roomController.removeDevice);

module.exports = router;
