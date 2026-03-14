const rateLimit = require('express-rate-limit');

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

const createLimitHandler = (type) => (req, res) => {
  console.warn(`Rate limit exceeded [${type}]: ${req.ip}`);
  res.status(429).json({
    message: 'Too many requests. Please try again later.',
    retryAfter: Math.ceil(DEFAULT_WINDOW_MS / 1000),
  });
};

const otpSendLimiter = rateLimit({
  windowMs: DEFAULT_WINDOW_MS,
  max: parseInt(process.env.OTP_SEND_LIMIT, 10) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createLimitHandler('otp_send'),
});

const otpVerifyLimiter = rateLimit({
  windowMs: DEFAULT_WINDOW_MS,
  max: parseInt(process.env.OTP_VERIFY_LIMIT, 10) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createLimitHandler('otp_verify'),
});

const apiLimiter = rateLimit({
  windowMs: DEFAULT_WINDOW_MS,
  max: parseInt(process.env.API_RATE_LIMIT, 10) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createLimitHandler('api'),
});

const strictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.STRICT_RATE_LIMIT, 10) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createLimitHandler('strict'),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.LOGIN_RATE_LIMIT, 10) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createLimitHandler('login'),
});

const deviceInquiryLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: parseInt(process.env.DEVICE_INQUIRY_LIMIT, 10) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createLimitHandler('device_inquiry'),
});

module.exports = {
  otpSendLimiter,
  otpVerifyLimiter,
  apiLimiter,
  strictLimiter,
  loginLimiter,
  deviceInquiryLimiter,
};
