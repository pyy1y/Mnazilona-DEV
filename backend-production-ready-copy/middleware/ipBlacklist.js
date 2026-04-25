const IPBlacklist = require('../models/IPBlacklist');

const IP_BLACKLIST_DISABLED = process.env.DISABLE_IP_BLACKLIST === 'true';

// In-memory cache for fast lookups (refreshed periodically)
let blacklistCache = new Set();
let lastRefresh = 0;
const CACHE_TTL = 30 * 1000; // Refresh cache every 30 seconds

const refreshCache = async () => {
  try {
    const now = new Date();
    const blocked = await IPBlacklist.find({
      isActive: true,
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: now } },
      ],
    }).select('ip').lean();

    blacklistCache = new Set(blocked.map((b) => b.ip));
    lastRefresh = Date.now();
  } catch (err) {
    console.error('IP blacklist cache refresh failed:', err.message);
  }
};

// Initial load
refreshCache();

const ipBlacklistMiddleware = async (req, res, next) => {
  if (IP_BLACKLIST_DISABLED) return next();

  // Refresh cache if stale
  if (Date.now() - lastRefresh > CACHE_TTL) {
    refreshCache(); // Non-blocking refresh
  }

  const clientIP = req.ip;

  if (blacklistCache.has(clientIP)) {
    // Update hit counter (non-blocking)
    IPBlacklist.updateOne(
      { ip: clientIP, isActive: true },
      { $inc: { hitCount: 1 }, $set: { lastHitAt: new Date() } }
    ).catch(() => {});

    return res.status(403).json({
      message: 'Access denied',
      code: 'IP_BLOCKED',
    });
  }

  next();
};

// Force refresh (called after admin adds/removes IP)
const forceRefreshBlacklist = () => {
  refreshCache();
};

module.exports = { ipBlacklistMiddleware, forceRefreshBlacklist };
