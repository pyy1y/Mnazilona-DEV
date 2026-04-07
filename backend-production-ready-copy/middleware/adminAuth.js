const adminAuth = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    console.warn(`Admin access denied for user: ${req.user?.id || 'unknown'}`);
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

module.exports = adminAuth;
