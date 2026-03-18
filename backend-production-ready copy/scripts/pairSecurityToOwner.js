/**
 * سكربت ربط جهاز الأمان بحساب المالك
 * شغّله بعد seedSecurityDevice.js: node scripts/pairSecurityToOwner.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Device = require('../models/Device');
const AllowedDevice = require('../models/AllowedDevice');

const OWNER_EMAIL = 'aaa654@windowslive.com';
const SECURITY_SERIAL = 'SEC-001';

async function pair() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const owner = await User.findOne({ email: OWNER_EMAIL });
    if (!owner) {
      console.error(`User not found: ${OWNER_EMAIL}`);
      process.exit(1);
    }
    console.log(`Owner found: ${owner.name} (${owner.email})`);

    const allowedDevice = await AllowedDevice.findOne({ serialNumber: SECURITY_SERIAL });
    if (!allowedDevice) {
      console.error(`AllowedDevice not found: ${SECURITY_SERIAL}`);
      console.error('Run seedSecurityDevice.js first.');
      process.exit(1);
    }

    let device = await Device.findOne({ serialNumber: SECURITY_SERIAL });

    if (device) {
      console.log(`Device ${SECURITY_SERIAL} exists, updating owner...`);
      device.owner = owner._id;
      device.pairedAt = new Date();
      device.name = device.name || 'Security';
      device.deviceType = 'security';
      device.isOnline = true;
      device.macAddress = allowedDevice.macAddress;
      if (!device.warrantyStartDate) {
        device.warrantyStartDate = new Date();
      }
      await device.save();
    } else {
      console.log(`Creating device ${SECURITY_SERIAL}...`);
      device = await Device.create({
        serialNumber: SECURITY_SERIAL,
        name: 'Security',
        deviceType: 'security',
        owner: owner._id,
        pairedAt: new Date(),
        warrantyStartDate: new Date(),
        macAddress: allowedDevice.macAddress,
        isOnline: true,
        state: {
          securityMode: 'disarmed',
        },
        mqttUsername: allowedDevice.mqttUsername,
        mqttPassword: allowedDevice.mqttPassword,
      });
    }

    allowedDevice.isActivated = true;
    allowedDevice.activatedAt = allowedDevice.activatedAt || new Date();
    allowedDevice.activatedBy = owner._id;
    await allowedDevice.save();

    console.log('\n========================================');
    console.log('   Security Device Paired to Owner!');
    console.log('========================================');
    console.log(`  Device     : ${device.name}`);
    console.log(`  Serial     : ${device.serialNumber}`);
    console.log(`  Type       : ${device.deviceType}`);
    console.log(`  Owner      : ${owner.name} (${owner.email})`);
    console.log(`  Paired At  : ${device.pairedAt}`);
    console.log(`  Mode       : ${device.state?.securityMode || 'disarmed'}`);
    console.log(`  Status     : Online`);
    console.log('========================================\n');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

pair();
