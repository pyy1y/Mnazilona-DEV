const NODE_ENV = process.env.NODE_ENV || 'development';
const LOG_LEVEL = process.env.LOG_LEVEL || (NODE_ENV === 'production' ? 'info' : 'debug');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[LOG_LEVEL] ?? LEVELS.info;

const formatMessage = (level, message, meta = {}) => {
  if (NODE_ENV === 'production') {
    // JSON format for production (easy to parse by log aggregators)
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta,
    });
  }
  // Human-readable for development
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  const prefix = { error: '[ERROR]', warn: '[WARN]', info: '[INFO]', debug: '[DEBUG]' }[level];
  return `${prefix} ${message}${metaStr}`;
};

const logger = {
  error(message, meta = {}) {
    if (currentLevel >= LEVELS.error) {
      console.error(formatMessage('error', message, meta));
    }
  },
  warn(message, meta = {}) {
    if (currentLevel >= LEVELS.warn) {
      console.warn(formatMessage('warn', message, meta));
    }
  },
  info(message, meta = {}) {
    if (currentLevel >= LEVELS.info) {
      console.log(formatMessage('info', message, meta));
    }
  },
  debug(message, meta = {}) {
    if (currentLevel >= LEVELS.debug) {
      console.log(formatMessage('debug', message, meta));
    }
  },
};

module.exports = logger;
