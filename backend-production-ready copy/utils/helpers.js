// Email
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const maskEmail = (email) => {
  if (!email || !email.includes('@')) return '***@***.***';
  const [local, domain] = email.split('@');
  return local.slice(0, 2) + '***@' + domain;
};

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());

// Password
const strongPassword = (password) => {
  if (!password || typeof password !== 'string') return false;
  return /^(?=.*[A-Z])(?=.*\d).{8,}$/.test(password);
};

// String
const sanitizeString = (str) => {
  if (!str || typeof str !== 'string') return '';
  return str.trim().replace(/[<>]/g, '').slice(0, 500);
};

const truncate = (str, maxLength = 100) => {
  if (!str || str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
};

// Validation
const isEmpty = (value) => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
};

const isValidObjectId = (id) => /^[a-fA-F0-9]{24}$/.test(String(id || ''));

// Auth
const jwt = require('jsonwebtoken');
const JWT_EXPIRY = '7d';

const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, email: user.email, tokenVersion: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
};

const sanitizeUserResponse = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  dob: user.dob || '',
  country: user.country || '',
  city: user.city || '',
});

// Date
const formatDate = (date) => (date || new Date()).toISOString().split('.')[0] + 'Z';

const timeAgo = (date) => {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  const intervals = [
    { label: 'year', seconds: 31536000 },
    { label: 'month', seconds: 2592000 },
    { label: 'day', seconds: 86400 },
    { label: 'hour', seconds: 3600 },
    { label: 'minute', seconds: 60 },
  ];
  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds);
    if (count >= 1) return `${count} ${interval.label}${count > 1 ? 's' : ''} ago`;
  }
  return 'just now';
};

module.exports = {
  normalizeEmail, maskEmail, isValidEmail,
  strongPassword, sanitizeString, truncate,
  isEmpty, isValidObjectId, formatDate, timeAgo,
  generateToken, sanitizeUserResponse,
};
