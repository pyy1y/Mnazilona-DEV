const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');
const { otpSendLimiter, otpVerifyLimiter, loginLimiter, strictLimiter, apiLimiter } = require('../middleware/rateLimiter');
const { validate, registerSendCodeSchema, registerVerifyCodeSchema, loginSendCodeSchema, loginVerifyCodeSchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema, refreshTokenSchema } = require('../middleware/validate');

router.post('/register/send-code', otpSendLimiter, validate(registerSendCodeSchema), authController.registerSendCode);
router.post('/register/verify-code', otpVerifyLimiter, validate(registerVerifyCodeSchema), authController.registerVerifyCode);
router.post('/login/send-code', loginLimiter, validate(loginSendCodeSchema), authController.loginSendCode);
router.post('/login/verify-code', otpVerifyLimiter, validate(loginVerifyCodeSchema), authController.loginVerifyCode);
router.post('/password/forgot', otpSendLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/password/reset', otpVerifyLimiter, validate(resetPasswordSchema), authController.resetPassword);
router.post('/password/change', auth, strictLimiter, validate(changePasswordSchema), authController.changePassword);
router.post('/refresh-token', apiLimiter, validate(refreshTokenSchema), authController.refreshToken);
router.post('/logout', auth, authController.logout);

module.exports = router;
