// const rateLimit = require('express-rate-limit');

// ⚠️ Rate limiting temporarily disabled — re-enable when done debugging
const noopLimiter = (req, res, next) => next();

const otpSendLimiter = noopLimiter;
const otpVerifyLimiter = noopLimiter;
const apiLimiter = noopLimiter;
const strictLimiter = noopLimiter;
const loginLimiter = noopLimiter;
const deviceInquiryLimiter = noopLimiter;

module.exports = {
  otpSendLimiter,
  otpVerifyLimiter,
  apiLimiter,
  strictLimiter,
  loginLimiter,
  deviceInquiryLimiter,
};
