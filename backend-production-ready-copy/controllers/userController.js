const User = require('../models/User');
const Device = require('../models/Device');
const AllowedDevice = require('../models/AllowedDevice');
const DeviceLog = require('../models/DeviceLog');
const VerificationCode = require('../models/VerificationCode');
const { sendVerificationCode, verifyCode } = require('../services/codeService');
const { sanitizeString, maskEmail, generateToken, sanitizeUserResponse, isValidEmail } = require('../utils/helpers');
const { topicOf, publishMessage } = require('../config/mqtt');

// ==================== GET PROFILE ====================
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(sanitizeUserResponse(user));
  } catch (error) {
    console.error('Get profile error:', error.message);
    res.status(500).json({ message: 'Failed to fetch profile' });
  }
};

// ==================== UPDATE PROFILE ====================
exports.updateProfile = async (req, res) => {
  try {
    const { name, dob, country, city } = req.body;
    const updateData = {};

    if (name !== undefined) {
      const cleanName = sanitizeString(name);
      if (!cleanName) return res.status(400).json({ message: 'Name cannot be empty' });
      updateData.name = cleanName;
    }
    if (dob !== undefined) updateData.dob = sanitizeString(dob) || '';
    if (country !== undefined) updateData.country = sanitizeString(country) || '';
    if (city !== undefined) updateData.city = sanitizeString(city) || '';

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: 'No valid fields provided for update' });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) return res.status(404).json({ message: 'User not found' });

    const newToken = generateToken(user);
    res.json({ message: 'Profile updated successfully', token: newToken, user: sanitizeUserResponse(user) });
  } catch (error) {
    console.error('Update profile error:', error.message);
    res.status(500).json({ message: 'Failed to update profile' });
  }
};

// ==================== CHANGE EMAIL - STEP 1 ====================
exports.changeEmailSendCode = async (req, res) => {
  try {
    const { newEmail } = req.body;

    if (!newEmail || typeof newEmail !== 'string') {
      return res.status(400).json({ message: 'New email is required' });
    }

    const cleanNewEmail = sanitizeString(newEmail).toLowerCase();
    if (!isValidEmail(cleanNewEmail)) {
      return res.status(400).json({ message: 'Please enter a valid email' });
    }

    const user = await User.findById(req.user.id).select('email').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.email === cleanNewEmail) {
      return res.status(400).json({ message: 'New email is the same as current email' });
    }

    const existing = await User.findOne({ email: cleanNewEmail, _id: { $ne: req.user.id } }).lean();
    if (existing) {
      return res.status(409).json({ message: 'This email is already in use' });
    }

    await sendVerificationCode(user.email, 'change_email_old');

    res.json({
      message: 'Verification code sent to your current email',
      oldEmail: maskEmail(user.email),
    });
  } catch (error) {
    console.error('Change email send code error:', error.message);
    res.status(500).json({ message: 'Failed to send verification code' });
  }
};

// ==================== CHANGE EMAIL - STEP 2 ====================
exports.changeEmailVerifyOld = async (req, res) => {
  try {
    const { code, newEmail } = req.body;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ message: 'Verification code is required' });
    }

    if (!newEmail || typeof newEmail !== 'string') {
      return res.status(400).json({ message: 'New email is required' });
    }

    const cleanNewEmail = sanitizeString(newEmail).toLowerCase();
    if (!isValidEmail(cleanNewEmail)) {
      return res.status(400).json({ message: 'Please enter a valid email' });
    }

    const user = await User.findById(req.user.id).select('email').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });

    const existing = await User.findOne({ email: cleanNewEmail, _id: { $ne: req.user.id } }).lean();
    if (existing) {
      return res.status(409).json({ message: 'This email is already in use' });
    }

    const isValid = await verifyCode(user.email, 'change_email_old', code.trim());
    if (!isValid) {
      return res.status(400).json({ message: 'Invalid or expired verification code' });
    }

    await sendVerificationCode(cleanNewEmail, 'change_email_new');

    res.json({
      message: 'Verification code sent to your new email',
      newEmail: maskEmail(cleanNewEmail),
    });
  } catch (error) {
    console.error('Change email verify old error:', error.message);
    res.status(500).json({ message: 'Failed to verify code' });
  }
};

// ==================== CHANGE EMAIL - STEP 3 ====================
exports.changeEmailConfirm = async (req, res) => {
  try {
    const { code, newEmail } = req.body;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ message: 'Verification code is required' });
    }

    if (!newEmail || typeof newEmail !== 'string') {
      return res.status(400).json({ message: 'New email is required' });
    }

    const cleanNewEmail = sanitizeString(newEmail).toLowerCase();
    if (!isValidEmail(cleanNewEmail)) {
      return res.status(400).json({ message: 'Please enter a valid email' });
    }

    const user = await User.findById(req.user.id).select('email').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });

    const existing = await User.findOne({ email: cleanNewEmail, _id: { $ne: req.user.id } }).lean();
    if (existing) {
      return res.status(409).json({ message: 'This email is already in use' });
    }

    const isValid = await verifyCode(cleanNewEmail, 'change_email_new', code.trim());
    if (!isValid) {
      return res.status(400).json({ message: 'Invalid or expired verification code' });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { email: cleanNewEmail } },
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) return res.status(404).json({ message: 'User not found' });

    await VerificationCode.deleteMany({ email: user.email, type: 'change_email_old' });
    await VerificationCode.deleteMany({ email: cleanNewEmail, type: 'change_email_new' });

    const newToken = generateToken(updatedUser);

    res.json({
      message: 'Email changed successfully',
      token: newToken,
      user: sanitizeUserResponse(updatedUser),
    });
  } catch (error) {
    console.error('Change email confirm error:', error.message);
    res.status(500).json({ message: 'Failed to change email' });
  }
};

// ==================== DELETE ACCOUNT - SEND CODE ====================
exports.deleteAccountSendCode = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('email').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });

    await sendVerificationCode(user.email, 'delete_account');
    res.json({ message: 'Verification code sent to your email', email: maskEmail(user.email) });
  } catch (error) {
    console.error('Delete account send code error:', error.message);
    res.status(500).json({ message: 'Failed to send verification code' });
  }
};

// ==================== DELETE ACCOUNT - CONFIRM ====================
exports.deleteAccountConfirm = async (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.user.id;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ message: 'Verification code is required' });
    }

    const user = await User.findById(userId).select('email').lean();
    if (!user) {
      return res.status(200).json({ message: 'Account already deleted' });
    }

    const isValidCode = await verifyCode(user.email, 'delete_account', code.trim());
    if (!isValidCode) {
      return res.status(400).json({ message: 'Invalid or expired verification code' });
    }

    const userDevices = await Device.find({ owner: userId }).select('serialNumber');

    for (const device of userDevices) {
      const serial = device.serialNumber;

      try {
        const topic = topicOf(serial, 'command');
        await publishMessage(topic, { command: 'unpaired', ts: Date.now() });
      } catch (mqttErr) {
        console.log(`MQTT notify failed for ${serial} (non-critical):`, mqttErr.message);
      }

      await AllowedDevice.findOneAndUpdate(
        { serialNumber: serial },
        { activatedBy: null }
      );

      await DeviceLog.create({
        serialNumber: serial,
        type: 'warning',
        message: 'Device unpaired - owner account deleted',
        source: 'server',
      });
    }

    const devicesResult = await Device.updateMany(
      { owner: userId },
      {
        $set: {
          owner: null,
          pairedAt: null,
          mqttToken: null,
          mqttUsername: null,
          mqttPassword: null,
          isOnline: false,
        },
      }
    );

    const deletedDevices = devicesResult.modifiedCount || 0;

    await VerificationCode.deleteMany({ email: user.email });
    await User.deleteOne({ _id: userId });

    console.log(`Account deleted: ${maskEmail(user.email)}, ${deletedDevices} devices unpaired`);

    res.json({
      message: 'Account deleted successfully',
      deletedDevices,
    });
  } catch (error) {
    console.error('Delete account confirm error:', error.message);
    res.status(500).json({ message: 'Failed to delete account' });
  }
};
