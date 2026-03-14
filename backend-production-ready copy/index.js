require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

const { connectDB, disconnectDB, isHealthy } = require('./config/database');
const { setupMQTT, disconnectMQTT, isMqttHealthy, MQTT_BROKER_URL } = require('./config/mqtt');
const routes = require('./routes');
const { startDeviceTimeoutJob, stopDeviceTimeoutJob } = require('./jobs/deviceTimeoutJob');
const { apiLimiter } = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Trust proxy must be set BEFORE rate limiting
app.set('trust proxy', 1);

// Security & Performance
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use(compression());
app.use(express.json({ limit: '1mb' }));

// NoSQL Injection Protection
const sanitizeValue = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$')) { delete obj[key]; continue; }
    if (typeof obj[key] === 'object') sanitizeValue(obj[key]);
  }
  return obj;
};
app.use((req, res, next) => {
  if (req.body) sanitizeValue(req.body);
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
  const health = {
    status: dbHealthy && mqttHealthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: dbHealthy ? 'connected' : 'disconnected',
      mqtt: mqttHealthy ? 'connected' : 'disconnected',
    },
  };
  res.status(dbHealthy && mqttHealthy ? 200 : 503).json(health);
});

// 404
app.use((req, res) => res.status(404).json({ message: 'Not found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ message: 'Internal server error' });
});

// Graceful shutdown
let server;
const gracefulShutdown = async (signal) => {
  console.log(`${signal} received. Shutting down...`);
  server.close(async () => {
    stopDeviceTimeoutJob();
    await disconnectMQTT();
    await disconnectDB();
    console.log('Graceful shutdown completed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 30000);
};

// Start
const startServer = async () => {
  try {
    const requiredEnvVars = ['MONGO_URI', 'JWT_SECRET', 'EMAIL_USER', 'EMAIL_PASS', 'MQTT_PASSWORD'];
    const missing = requiredEnvVars.filter((v) => !process.env[v]);
    if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);

    // Warn if MQTT_WEBHOOK_SECRET is not set in production
    if (NODE_ENV === 'production' && !process.env.MQTT_WEBHOOK_SECRET) {
      console.warn('WARNING: MQTT_WEBHOOK_SECRET is not set. MQTT webhook endpoint is unprotected.');
    }

    await connectDB();
    setupMQTT();
    startDeviceTimeoutJob();

    server = app.listen(PORT, HOST, () => {
      console.log(`Manazel IoT Server started on ${HOST}:${PORT} [${NODE_ENV}]`);
    });

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();

module.exports = app;
