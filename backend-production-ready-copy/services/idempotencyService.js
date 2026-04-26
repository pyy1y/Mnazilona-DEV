const { getRedisClient, isRedisHealthy } = require('../config/redis');

const memoryCache = new Map();

function sanitizeSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9:_-]+/g, '_')
    .slice(0, 120);
}

function buildIdempotencyKey(scope, requestId, ...parts) {
  if (!requestId) return null;

  const segments = [
    'idem',
    sanitizeSegment(scope),
    ...parts.map(sanitizeSegment).filter(Boolean),
    sanitizeSegment(requestId),
  ];

  return segments.join(':');
}

function getMemoryValue(key) {
  const cached = memoryCache.get(key);
  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }

  return cached.value;
}

function setMemoryValue(key, value, ttlSeconds) {
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  if (memoryCache.size > 1000) {
    const now = Date.now();
    for (const [cacheKey, cacheValue] of memoryCache) {
      if (cacheValue.expiresAt <= now) {
        memoryCache.delete(cacheKey);
      }
    }
  }
}

async function getIdempotentResponse(key) {
  if (!key) return null;

  if (isRedisHealthy()) {
    try {
      const raw = await getRedisClient().get(key);
      if (raw) return JSON.parse(raw);
    } catch {
      // Fall back to memory cache
    }
  }

  return getMemoryValue(key);
}

async function storeIdempotentResponse(key, response, ttlSeconds = 300) {
  if (!key) return;

  if (isRedisHealthy()) {
    try {
      await getRedisClient().set(key, JSON.stringify(response), 'EX', ttlSeconds);
    } catch {
      // Fall back to memory cache
    }
  }

  setMemoryValue(key, response, ttlSeconds);
}

module.exports = {
  buildIdempotencyKey,
  getIdempotentResponse,
  storeIdempotentResponse,
};
