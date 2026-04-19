const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let redisClient = null;
let isConnected = false;

const getRedisClient = () => {
  if (redisClient) return redisClient;

  redisClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null, // required for compatibility with rate-limit-redis
    retryStrategy(times) {
      if (times > 10) {
        console.warn('Redis: max reconnection attempts reached, stopping retries');
        return null;
      }
      return Math.min(times * 500, 5000);
    },
    lazyConnect: true,
    enableOfflineQueue: true,
  });

  // Connect in background - don't block startup if Redis is unavailable
  redisClient.connect().catch((err) => {
    console.warn('Redis initial connection failed (rate limiting will use in-memory):', err.message);
  });

  redisClient.on('connect', () => {
    isConnected = true;
    console.log('Redis connected');
  });

  redisClient.on('error', (err) => {
    isConnected = false;
    console.error('Redis error:', err.message);
  });

  redisClient.on('close', () => {
    isConnected = false;
  });

  return redisClient;
};

const isRedisHealthy = () => isConnected;

const disconnectRedis = async () => {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    isConnected = false;
    console.log('Redis disconnected');
  }
};

module.exports = { getRedisClient, isRedisHealthy, disconnectRedis };
