/**
 * سكربت ربط جهاز الإضاءة بحساب المالك
 * شغّله بعد seedLightDevice.js: node scripts/pairLightToOwner.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Device = require('../models/Device');
const AllowedDevice = require('../models/AllowedDevice');

const OWNER_EMAIL = 'aaa654@windowslive.com';
const LIGHT_SERIAL = 'LIGHT-001';

async function pair() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // 1. جيب حساب المالك
    const owner = await User.findOne({ email: OWNER_EMAIL });
    if (!owner) {
      console.error(`User not found: ${OWNER_EMAIL}`);
      console.error('Make sure the owner account is registered first.');
      process.exit(1);
    }
    console.log(`Owner found: ${owner.name} (${owner.email})`);

    // 2. شيك AllowedDevice موجود
    const allowedDevice = await AllowedDevice.findOne({ serialNumber: LIGHT_SERIAL });
    if (!allowedDevice) {
      console.error(`AllowedDevice not found: ${LIGHT_SERIAL}`);
      console.error('Run seedLightDevice.js first.');
      process.exit(1);
    }

    // 3. أنشئ أو حدّث الجهاز في Device collection
    let device = await Device.findOne({ serialNumber: LIGHT_SERIAL });

    if (device) {
      console.log(`Device ${LIGHT_SERIAL} exists, updating owner...`);
      device.owner = owner._id;
      device.pairedAt = new Date();
      device.name = device.name || 'Living Room Light';
      device.deviceType = 'light';
      device.isOnline = true;
      device.macAddress = allowedDevice.macAddress;
      if (!device.warrantyStartDate) {
        device.warrantyStartDate = new Date();
      }
      await device.save();
    } else {
      console.log(`Creating device ${LIGHT_SERIAL}...`);
      device = await Device.create({
        serialNumber: LIGHT_SERIAL,
        name: 'Living Room Light',
        deviceType: 'light',
        owner: owner._id,
        pairedAt: new Date(),
        warrantyStartDate: new Date(),
        macAddress: allowedDevice.macAddress,
        isOnline: true,
        state: { lightState: 'off' },
        mqttUsername: allowedDevice.mqttUsername,
        mqttPassword: allowedDevice.mqttPassword,
      });
    }

    // 4. حدّث AllowedDevice
    allowedDevice.isActivated = true;
    allowedDevice.activatedAt = allowedDevice.activatedAt || new Date();
    allowedDevice.activatedBy = owner._id;
    await allowedDevice.save();

    console.log('\n========================================');
    console.log('   Light Device Paired to Owner!');
    console.log('========================================');
    console.log(`  Device     : ${device.name}`);
    console.log(`  Serial     : ${device.serialNumber}`);
    console.log(`  Type       : ${device.deviceType}`);
    console.log(`  Owner      : ${owner.name} (${owner.email})`);
    console.log(`  Paired At  : ${device.pairedAt}`);
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
