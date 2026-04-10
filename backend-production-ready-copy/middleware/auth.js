const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');

    if (!authHeader) {
      return res.status(401).json({ error: 'Authentication required', code: 'NO_TOKEN' });
    }

    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Invalid token format', code: 'INVALID_FORMAT' });
    }

    const token = authHeader.slice(7);

    if (!token) {
      return res.status(401).json({ error: 'Token not provided', code: 'NO_TOKEN' });
    }

    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not configured');
      return res.status(500).json({ error: 'Server configuration error', code: 'SERVER_ERROR' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.id) {
      return res.status(401).json({ error: 'Invalid token payload', code: 'INVALID_PAYLOAD' });
    }

    // Check tokenVersion to invalidate old sessions
    const user = await User.findById(decoded.id).select('tokenVersion role');
    if (!user) {
      return res.status(401).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    }

    const tokenVersion = decoded.tokenVersion ?? 0;
    if (tokenVersion !== (user.tokenVersion || 0)) {
      return res.status(401).json({ error: 'Session expired. Please log in again.', code: 'TOKEN_REVOKED' });
    }

    req.user = { id: decoded.id, email: decoded.email, role: user.role || 'user' };
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Token has expired', code: 'TOKEN_EXPIRED' });
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
    }
    return res.status(401).json({ error: 'Authentication failed', code: 'AUTH_FAILED' });
  }
};

const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return next();

    const token = authHeader.slice(7);
    if (!token || !process.env.JWT_SECRET) return next();

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.id) {
      req.user = { id: decoded.id, email: decoded.email };
    }
  } catch {
    // Optional auth - silently continue without user context
  }
  next();
};

module.exports = auth;
module.exports.auth = auth;
module.exports.optionalAuth = optionalAuth;
