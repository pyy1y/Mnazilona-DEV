/**
 * Create Admin User Script
 *
 * Usage:
 *   node scripts/createAdmin.js <email> <password> <name>
 *
 * Example:
 *   node scripts/createAdmin.js admin@mnazilona.com MyStr0ngPass! "Abdullah Admin"
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const BCRYPT_ROUNDS = 12;

async function createAdmin() {
  const [, , email, password, name] = process.argv;

  if (!email || !password || !name) {
    console.error('Usage: node scripts/createAdmin.js <email> <password> <name>');
    console.error('Example: node scripts/createAdmin.js admin@mnazilona.com MyStr0ngPass! "Abdullah Admin"');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('Password must be at least 8 characters');
    process.exit(1);
  }

  if (!/^(?=.*[A-Z])(?=.*\d)/.test(password)) {
    console.error('Password must contain at least 1 uppercase letter and 1 number');
    process.exit(1);
  }

  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/MnazilonaProject';

  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      if (existing.role === 'admin') {
        console.log(`Admin already exists: ${email}`);
        process.exit(0);
      }
      // Upgrade existing user to admin
      existing.role = 'admin';
      await existing.save();
      console.log(`Upgraded existing user to admin: ${email}`);
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const admin = new User({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      role: 'admin',
      isActive: true,
    });

    await admin.save();
    console.log(`Admin created successfully!`);
    console.log(`  Email: ${admin.email}`);
    console.log(`  Name: ${admin.name}`);
    console.log(`  Role: ${admin.role}`);
    console.log(`  ID: ${admin._id}`);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

createAdmin();
