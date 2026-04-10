// In-memory store for rate limit events (for admin monitoring)
const rateLimitEvents = [];
const MAX_EVENTS = 500;

// Stats counters
const stats = {
  api: { total: 0, blocked: 0 },
  otp_send: { total: 0, blocked: 0 },
  otp_verify: { total: 0, blocked: 0 },
  login: { total: 0, blocked: 0 },
  strict: { total: 0, blocked: 0 },
  device_inquiry: { total: 0, blocked: 0 },
};

const recordRateLimitHit = (type, ip, path) => {
  if (!stats[type]) stats[type] = { total: 0, blocked: 0 };
  stats[type].blocked++;

  rateLimitEvents.push({
    type,
    ip,
    path,
    timestamp: new Date().toISOString(),
  });

  // Keep only the latest events
  if (rateLimitEvents.length > MAX_EVENTS) {
    rateLimitEvents.splice(0, rateLimitEvents.length - MAX_EVENTS);
  }
};

const recordRequest = (type) => {
  if (!stats[type]) stats[type] = { total: 0, blocked: 0 };
  stats[type].total++;
};

const getStats = () => ({ ...stats });

const getRecentEvents = (limit = 100) => {
  return rateLimitEvents.slice(-limit).reverse();
};

const getTopOffenders = (limit = 20) => {
  const ipCounts = {};
  for (const event of rateLimitEvents) {
    ipCounts[event.ip] = (ipCounts[event.ip] || 0) + 1;
  }
  return Object.entries(ipCounts)
    .map(([ip, count]) => ({ ip, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
};

module.exports = {
  recordRateLimitHit,
  recordRequest,
  getStats,
  getRecentEvents,
  getTopOffenders,
};
