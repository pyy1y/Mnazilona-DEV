const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');
const { otpSendLimiter, otpVerifyLimiter, loginLimiter, strictLimiter } = require('../middleware/rateLimiter');

router.post('/register/send-code', otpSendLimiter, authController.registerSendCode);
router.post('/register/verify-code', otpVerifyLimiter, authController.registerVerifyCode);
router.post('/login/send-code', loginLimiter, authController.loginSendCode);
router.post('/login/verify-code', otpVerifyLimiter, authController.loginVerifyCode);
router.post('/password/forgot', otpSendLimiter, authController.forgotPassword);
router.post('/password/reset', otpVerifyLimiter, authController.resetPassword);
router.post('/password/change', auth, strictLimiter, authController.changePassword);

module.exports = router;
