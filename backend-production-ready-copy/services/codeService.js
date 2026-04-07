const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const VerificationCode = require('../models/VerificationCode');
const sendEmail = require('../utils/sendEmail');

const CODE_EXPIRY_MINUTES = parseInt(process.env.CODE_EXPIRY_MINUTES, 10) || 5;
const MAX_ATTEMPTS = parseInt(process.env.CODE_MAX_ATTEMPTS, 10) || 5;
const BCRYPT_ROUNDS = 10;

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const generateCode = () => crypto.randomInt(100000, 1000000).toString();
const getExpirationDate = () => new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);

const EMAIL_TEMPLATES = {
  register: {
    subject: 'Welcome to Mnazilona - Verify Your Email',
    getText: (code, minutes) => `Welcome to Mnazilona!\n\nYour verification code is: ${code}\n\nExpires in ${minutes} minutes.`,
  },
  login: {
    subject: 'Mnazilona - Login Verification Code',
    getText: (code, minutes) => `Your login code is: ${code}\n\nExpires in ${minutes} minutes.`,
  },
  reset_password: {
    subject: 'Mnazilona - Password Reset Code',
    getText: (code, minutes) => `Your password reset code is: ${code}\n\nExpires in ${minutes} minutes.`,
  },
  delete_account: {
    subject: 'Mnazilona - Account Deletion Confirmation',
    getText: (code, minutes) => `Your account deletion code is: ${code}\n\nExpires in ${minutes} minutes.\n\nWARNING: This action is irreversible.`,
  },
  change_email_old: {
    subject: 'Mnazilona - Email Change Verification',
    getText: (code, minutes) => `Someone requested to change your email address.\n\nYour verification code is: ${code}\n\nExpires in ${minutes} minutes.\n\nIf you did not request this, please ignore this email.`,
  },
  change_email_new: {
    subject: 'Mnazilona - Verify Your New Email',
    getText: (code, minutes) => `Your verification code for the new email is: ${code}\n\nExpires in ${minutes} minutes.`,
  },
  admin_login: {
    subject: 'Mnazilona Admin - Login Verification Code',
    getText: (code, minutes) => `Your admin login verification code is: ${code}\n\nExpires in ${minutes} minutes.\n\nIf you did not attempt to log in, please secure your account immediately.`,
  },
};

const sendVerificationCode = async (rawEmail, type, options = {}) => {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new Error('Email is required');

  await VerificationCode.updateMany({ email, type, used: false }, { $set: { used: true } });

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);

  await VerificationCode.create({
    email,
    type,
    codeHash,
    expiresAt: getExpirationDate(),
    used: false,
    attempts: 0,
    ipAddress: options.ipAddress || null,
    userAgent: options.userAgent || null,
  });

  const template = EMAIL_TEMPLATES[type];
  if (!template) throw new Error(`Unknown verification type: ${type}`);

  await sendEmail(email, template.subject, template.getText(code, CODE_EXPIRY_MINUTES));
  console.log(`Verification code sent to ${email} [${type}]`);
  return true;
};

const verifyCode = async (rawEmail, type, code) => {
  const email = normalizeEmail(rawEmail);
  if (!email || !code) return false;

  const record = await VerificationCode.findOne({
    email,
    type,
    used: false,
    expiresAt: { $gt: new Date() },
  });

  if (!record) return false;

  if (record.attempts >= MAX_ATTEMPTS) {
    await VerificationCode.deleteOne({ _id: record._id });
    return false;
  }

  const isMatch = await bcrypt.compare(code.trim(), record.codeHash);

  if (!isMatch) {
    record.attempts += 1;
    if (record.attempts >= MAX_ATTEMPTS) {
      await VerificationCode.deleteOne({ _id: record._id });
    } else {
      await record.save();
    }
    return false;
  }

  record.used = true;
  await record.save();
  return true;
};

module.exports = { sendVerificationCode, verifyCode, CODE_EXPIRY_MINUTES, MAX_ATTEMPTS };
