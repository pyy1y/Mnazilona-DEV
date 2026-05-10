// Email
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const maskEmail = (email) => {
  if (!email || !email.includes('@')) return '***@***.***';
  const [local, domain] = email.split('@');
  return local.slice(0, 2) + '***@' + domain;
};

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());

// Password - requires: 8+ chars, 1 uppercase, 1 lowercase, 1 digit, 1 special char
const strongPassword = (password) => {
  if (!password || typeof password !== 'string') return false;
  return /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{}|;:'",.<>?/\\`~]).{8,128}$/.test(password);
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
const crypto = require('crypto');
const ACCESS_TOKEN_EXPIRY = '7d';
const REFRESH_TOKEN_EXPIRY = '30d';
const REFRESH_TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, email: user.email, role: user.role || 'user', tokenVersion: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
};

const generateRefreshToken = () => {
  return crypto.randomBytes(40).toString('hex');
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
  generateToken, generateRefreshToken, sanitizeUserResponse,
  REFRESH_TOKEN_EXPIRY_MS,
};
