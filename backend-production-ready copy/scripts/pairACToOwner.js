/**
 * سكربت ربط المكيف بحساب المالك
 * شغّله بعد seedACDevice.js: node scripts/pairACToOwner.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Device = require('../models/Device');
const AllowedDevice = require('../models/AllowedDevice');

const OWNER_EMAIL = 'abuser6278@gmail.com';
const AC_SERIAL = 'AC-001';

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

    const allowedDevice = await AllowedDevice.findOne({ serialNumber: AC_SERIAL });
    if (!allowedDevice) {
      console.error(`AllowedDevice not found: ${AC_SERIAL}`);
      console.error('Run seedACDevice.js first.');
      process.exit(1);
    }

    let device = await Device.findOne({ serialNumber: AC_SERIAL });

    if (device) {
      console.log(`Device ${AC_SERIAL} exists, updating owner...`);
      device.owner = owner._id;
      device.pairedAt = new Date();
      device.name = device.name || 'Air Conditioner';
      device.deviceType = 'ac';
      device.isOnline = true;
      device.macAddress = allowedDevice.macAddress;
      if (!device.warrantyStartDate) {
        device.warrantyStartDate = new Date();
      }
      await device.save();
    } else {
      console.log(`Creating device ${AC_SERIAL}...`);
      device = await Device.create({
        serialNumber: AC_SERIAL,
        name: 'Air Conditioner',
        deviceType: 'ac',
        owner: owner._id,
        pairedAt: new Date(),
        warrantyStartDate: new Date(),
        macAddress: allowedDevice.macAddress,
        isOnline: true,
        state: {
          currentTemp: 21,
          targetTemp: 23,
          mode: 'off',
          fanMode: 'low',
          swingMode: 'off',
          presetMode: 'none',
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
    console.log('   AC Unit Paired to Owner!');
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
