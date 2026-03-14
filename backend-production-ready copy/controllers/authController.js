const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { sendVerificationCode, verifyCode } = require('../services/codeService');
const { normalizeEmail, strongPassword, sanitizeString, generateToken, sanitizeUserResponse } = require('../utils/helpers');

const BCRYPT_ROUNDS = 12;

// ==================== REGISTER ====================
exports.registerSendCode = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const existingUser = await User.findOne({ email }).lean();
    if (existingUser) {
      // FIX: Return same message to prevent user enumeration.
      // Still send a 200 so attacker can't distinguish existing from new.
      return res.json({ message: 'If this email is available, a verification code has been sent' });
    }

    await sendVerificationCode(email, 'register');
    res.json({ message: 'If this email is available, a verification code has been sent' });
  } catch (error) {
    console.error('Register send code error:', error.message);
    res.status(500).json({ message: 'Failed to send verification code' });
  }
};

exports.registerVerifyCode = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { code, name, password, dob, country, city } = req.body;

    if (!email || !code || !name || !password) {
      return res.status(400).json({ message: 'Email, code, name, and password are required' });
    }

    if (!strongPassword(password)) {
      return res.status(400).json({
        message: 'Password must be at least 8 characters with 1 uppercase letter and 1 number',
      });
    }

    const isValidCode = await verifyCode(email, 'register', code);
    if (!isValidCode) return res.status(400).json({ message: 'Invalid or expired verification code' });

    const existingUser = await User.findOne({ email }).lean();
    if (existingUser) return res.status(409).json({ message: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = new User({
      name: sanitizeString(name),
      email,
      password: hashedPassword,
      dob: sanitizeString(dob) || '',
      country: sanitizeString(country) || '',
      city: sanitizeString(city) || '',
    });

    await user.save();
    res.status(201).json({ message: 'Registration successful', userId: user._id });
  } catch (error) {
    console.error('Register verify code error:', error.message);
    if (error.code === 11000) return res.status(409).json({ message: 'Email already registered' });
    res.status(500).json({ message: 'Registration failed' });
  }
};

// ==================== LOGIN ====================
exports.loginSendCode = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return res.status(401).json({ message: 'Invalid credentials' });

    await sendVerificationCode(email, 'login');
    res.json({ message: 'Verification code sent' });
  } catch (error) {
    console.error('Login send code error:', error.message);
    res.status(500).json({ message: 'Failed to send verification code' });
  }
};

exports.loginVerifyCode = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { code } = req.body;

    if (!email || !code) return res.status(400).json({ message: 'Email and code are required' });

    const isValidCode = await verifyCode(email, 'login', code);
    if (!isValidCode) return res.status(400).json({ message: 'Invalid or expired verification code' });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const token = generateToken(user);
    res.json({ message: 'Login successful', token, user: sanitizeUserResponse(user) });
  } catch (error) {
    console.error('Login verify code error:', error.message);
    res.status(500).json({ message: 'Login failed' });
  }
};

// ==================== PASSWORD ====================
exports.forgotPassword = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const user = await User.findOne({ email }).lean();
    if (!user) return res.json({ message: 'If the email exists, a reset code has been sent' });

    await sendVerificationCode(email, 'reset_password');
    res.json({ message: 'If the email exists, a reset code has been sent' });
  } catch (error) {
    console.error('Forgot password error:', error.message);
    res.status(500).json({ message: 'Failed to process request' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return res.status(400).json({ message: 'Email, code, and new password are required' });
    }

    const isValidCode = await verifyCode(email, 'reset_password', code);
    if (!isValidCode) return res.status(400).json({ message: 'Invalid or expired verification code' });

    if (!strongPassword(newPassword)) {
      return res.status(400).json({
        message: 'Password must be at least 8 characters with 1 uppercase letter and 1 number',
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const user = await User.findOneAndUpdate(
      { email },
      { password: hashedPassword, $inc: { tokenVersion: 1 } },
      { new: true }
    );
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('Reset password error:', error.message);
    res.status(500).json({ message: 'Failed to reset password' });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required' });
    }

    if (!strongPassword(newPassword)) {
      return res.status(400).json({
        message: 'Password must be at least 8 characters with 1 uppercase letter and 1 number',
      });
    }

    const user = await User.findById(userId).select('+password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const isPasswordValid = await bcrypt.compare(oldPassword, user.password);
    if (!isPasswordValid) return res.status(401).json({ message: 'Current password is incorrect' });

    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res.status(400).json({ message: 'New password must be different from current password' });
    }

    user.password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    const newToken = generateToken(user);
    res.json({ message: 'Password changed successfully', token: newToken });
  } catch (error) {
    console.error('Change password error:', error.message);
    res.status(500).json({ message: 'Failed to change password' });
  }
};
