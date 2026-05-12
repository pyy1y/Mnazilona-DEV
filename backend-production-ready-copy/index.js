require('dotenv').config();

const fs = require('fs');
const https = require('https');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const { connectDB, disconnectDB, isHealthy } = require('./config/database');
const { setupMQTT, disconnectMQTT, isMqttHealthy, MQTT_BROKER_URL } = require('./config/mqtt');
const { disconnectRedis, isRedisHealthy } = require('./config/redis');
const { setupSocket } = require('./config/socket');
const routes = require('./routes');
const { startDeviceTimeoutJob, stopDeviceTimeoutJob } = require('./jobs/deviceTimeoutJob');
const { startDeviceShareExpiryJob, stopDeviceShareExpiryJob } = require('./jobs/deviceShareExpiryJob');
const { apiLimiter } = require('./middleware/rateLimiter');
const { ipBlacklistMiddleware } = require('./middleware/ipBlacklist');
const { trackEndpointAccess } = require('./services/anomalyDetector');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Trust proxy must be set BEFORE rate limiting
app.set('trust proxy', 1);

// Security & Performance
app.use(helmet());
const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length > 0
    ? (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) callback(null, true);
        else callback(new Error('Not allowed by CORS'));
      }
    : false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use(compression());

// Request logging
if (NODE_ENV === 'production') {
  // Production: compact JSON-style log with response time
  morgan.token('body-size', (req) => req.headers['content-length'] || '0');
  app.use(morgan(':remote-addr :method :url :status :res[content-length] - :response-time ms :body-size', {
    skip: (req) => req.url === '/health',
  }));
} else {
  app.use(morgan('dev', {
    skip: (req) => req.url === '/health',
  }));
}

app.use(express.json({ limit: '1mb' }));

// NoSQL Injection Protection
// express-mongo-sanitize is incompatible with Express 5 (req.query is read-only)
function sanitizeValue(val) {
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.map(sanitizeValue);
  if (val && typeof val === 'object') {
    const clean = {};
    for (const key of Object.keys(val)) {
      if (key.startsWith('$') || key.includes('.')) continue;
      clean[key] = sanitizeValue(val[key]);
    }
    return clean;
  }
  return val;
}
app.use((req, _res, next) => {
  if (req.body) req.body = sanitizeValue(req.body);
  if (req.params) req.params = sanitizeValue(req.params);
  // req.query is read-only in Express 5, sanitize individual values in-place
  if (req.query) {
    for (const key of Object.keys(req.query)) {
      if (key.startsWith('$') || key.includes('.')) {
        delete req.query[key];
      } else {
        req.query[key] = sanitizeValue(req.query[key]);
      }
    }
  }
  next();
});

// Request timeout - protect against slow loris and hanging connections
const REQUEST_TIMEOUT_MS = 30000; // 30 seconds
app.use((req, res, next) => {
  req.setTimeout(REQUEST_TIMEOUT_MS);
  res.setTimeout(REQUEST_TIMEOUT_MS, () => {
    if (!res.headersSent) {
      res.status(408).json({ message: 'Request timeout' });
    }
  });
  next();
});

// IP Blacklist check (BEFORE rate limiting - blocked IPs get rejected immediately)
app.use(ipBlacklistMiddleware);

// Anomaly detection: track endpoint access patterns
app.use((req, res, next) => {
  trackEndpointAccess(req.ip, req.path);
  next();
});

// Apply global rate limiting
app.use(apiLimiter);

// Routes
app.use('/', routes);

// Health check
app.get('/health', (req, res) => {
  const dbHealthy = isHealthy();
  const mqttHealthy = isMqttHealthy();
  const redisHealthy = isRedisHealthy();
  const health = {
    status: dbHealthy && mqttHealthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: dbHealthy ? 'connected' : 'disconnected',
      mqtt: mqttHealthy ? 'connected' : 'disconnected',
      redis: redisHealthy ? 'connected' : 'disconnected',
    },
  };
  res.status(dbHealthy && mqttHealthy ? 200 : 503).json(health);
});

// 404
app.use((req, res) => res.status(404).json({ message: 'Not found' }));

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, path: req.path, method: req.method });
  res.status(500).json({ message: 'Internal server error' });
});

// Graceful shutdown
let server;
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received. Shutting down...`);
  server.close(async () => {
    stopDeviceTimeoutJob();
    stopDeviceShareExpiryJob();
    await disconnectMQTT();
    await disconnectRedis();
    await disconnectDB();
    logger.info('Graceful shutdown completed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 30000);
};

// Start
const startServer = async () => {
  try {
    const requiredEnvVars = ['MONGO_URI', 'JWT_SECRET', 'EMAIL_USER', 'EMAIL_PASS', 'MQTT_PASSWORD', 'MQTT_WEBHOOK_SECRET'];
    const missing = requiredEnvVars.filter((v) => !process.env[v]);
    if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);

    await connectDB();
    setupMQTT();
    startDeviceTimeoutJob();
    startDeviceShareExpiryJob();

    // HTTPS support: if SSL cert files exist, use HTTPS; otherwise HTTP
    const sslKeyPath = process.env.SSL_KEY_PATH;
    const sslCertPath = process.env.SSL_CERT_PATH;

    if (sslKeyPath && sslCertPath && fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
      const sslOptions = {
        key: fs.readFileSync(sslKeyPath),
        cert: fs.readFileSync(sslCertPath),
      };
      server = https.createServer(sslOptions, app).listen(PORT, HOST, () => {
        logger.info(`Mnazilona IoT Server started on HTTPS ${HOST}:${PORT} [${NODE_ENV}]`);
      });
    } else {
      server = app.listen(PORT, HOST, () => {
        logger.info(`Mnazilona IoT Server started on ${HOST}:${PORT} [${NODE_ENV}]`);
        if (NODE_ENV === 'production') {
          logger.warn('Running without HTTPS. Set SSL_KEY_PATH and SSL_CERT_PATH for TLS.');
        }
      });
    }

    // Server-level timeouts
    server.keepAliveTimeout = 65000; // slightly higher than typical LB timeout (60s)
    server.headersTimeout = 66000;

    setupSocket(server);
    logger.info('Socket.IO attached to server');

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
};

startServer();

module.exports = app;
