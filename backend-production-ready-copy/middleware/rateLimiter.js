const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis').default;
const { getRedisClient } = require('../config/redis');
const { recordRateLimitHit } = require('../config/rateLimitStore');
const { emitToAdminMonitoring } = require('../config/socket');

const RATE_LIMIT_DISABLED = process.env.DISABLE_RATE_LIMIT === 'true';

const noopLimiter = (req, res, next) => next();

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

const createLimitHandler = (type) => (req, res) => {
  console.warn(`Rate limit exceeded [${type}]: ${req.ip}`);

  recordRateLimitHit(type, req.ip, req.originalUrl);

  // Rate-limit hits are firehose-y under attack — only admins on the live
  // monitoring page need them in real time. Other admins see the running
  // counts via the existing recordRateLimitHit() store on next REST fetch.
  emitToAdminMonitoring('ratelimit:hit', {
    type,
    ip: req.ip,
    path: req.originalUrl,
    timestamp: new Date().toISOString(),
  });

  res.status(429).json({
    message: 'Too many requests. Please try again later.',
    retryAfter: Math.ceil(DEFAULT_WINDOW_MS / 1000),
  });
};

// Create Redis store if Redis is available, otherwise fall back to in-memory
const createStore = (prefix) => {
  try {
    const client = getRedisClient();
    if (client) {
      return new RedisStore({
        sendCommand: (...args) => client.call(...args),
        prefix: `rl:${prefix}:`,
      });
    }
  } catch (err) {
    console.warn(`Redis store unavailable for ${prefix}, using in-memory: ${err.message}`);
  }
  return undefined; // express-rate-limit uses MemoryStore by default
};

const otpSendLimiter = rateLimit({
  windowMs: DEFAULT_WINDOW_MS,
  max: parseInt(process.env.OTP_SEND_LIMIT, 10) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore('otp_send'),
  handler: createLimitHandler('otp_send'),
});

const otpVerifyLimiter = rateLimit({
  windowMs: DEFAULT_WINDOW_MS,
  max: parseInt(process.env.OTP_VERIFY_LIMIT, 10) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore('otp_verify'),
  handler: createLimitHandler('otp_verify'),
});

const apiLimiter = rateLimit({
  windowMs: DEFAULT_WINDOW_MS,
  max: parseInt(process.env.API_RATE_LIMIT, 10) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore('api'),
  handler: createLimitHandler('api'),
});

const strictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.STRICT_RATE_LIMIT, 10) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore('strict'),
  handler: createLimitHandler('strict'),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.LOGIN_RATE_LIMIT, 10) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore('login'),
  handler: createLimitHandler('login'),
});

const deviceInquiryLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: parseInt(process.env.DEVICE_INQUIRY_LIMIT, 10) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore('device_inquiry'),
  handler: createLimitHandler('device_inquiry'),
});

module.exports = RATE_LIMIT_DISABLED
  ? {
      otpSendLimiter: noopLimiter,
      otpVerifyLimiter: noopLimiter,
      apiLimiter: noopLimiter,
      strictLimiter: noopLimiter,
      loginLimiter: noopLimiter,
      deviceInquiryLimiter: noopLimiter,
    }
  : {
      otpSendLimiter,
      otpVerifyLimiter,
      apiLimiter,
      strictLimiter,
      loginLimiter,
      deviceInquiryLimiter,
    };
