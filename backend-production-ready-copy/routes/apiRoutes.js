const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const auth = require('../middleware/auth');
const { otpSendLimiter, otpVerifyLimiter, strictLimiter, apiLimiter } = require('../middleware/rateLimiter');

// Profile Routes
router.get('/me', auth, userController.getProfile);
router.patch('/me', auth, apiLimiter, userController.updateProfile);
router.put('/me', auth, apiLimiter, userController.updateProfile);

// Change Email Routes
router.post('/account/change-email/send-code', auth, strictLimiter, otpSendLimiter, userController.changeEmailSendCode);
router.post('/account/change-email/verify-old', auth, strictLimiter, otpVerifyLimiter, userController.changeEmailVerifyOld);
router.post('/account/change-email/confirm', auth, strictLimiter, otpVerifyLimiter, userController.changeEmailConfirm);

// Delete Account Routes
router.post('/account/delete/send-code', auth, strictLimiter, otpSendLimiter, userController.deleteAccountSendCode);
router.post('/account/delete/confirm', auth, strictLimiter, otpVerifyLimiter, userController.deleteAccountConfirm);

module.exports = router;
