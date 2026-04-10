/**
 * سكربت ربط جهاز الدايمر بحساب المالك
 * شغّله بعد seedDimmerDevice.js: node scripts/pairDimmerToOwner.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Device = require('../models/Device');
const AllowedDevice = require('../models/AllowedDevice');

const OWNER_EMAIL = 'abuser6278@gmail.com';
const DIMMER_SERIAL = 'DIMMER-001';

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

    const allowedDevice = await AllowedDevice.findOne({ serialNumber: DIMMER_SERIAL });
    if (!allowedDevice) {
      console.error(`AllowedDevice not found: ${DIMMER_SERIAL}`);
      console.error('Run seedDimmerDevice.js first.');
      process.exit(1);
    }

    let device = await Device.findOne({ serialNumber: DIMMER_SERIAL });

    if (device) {
      console.log(`Device ${DIMMER_SERIAL} exists, updating owner...`);
      device.owner = owner._id;
      device.pairedAt = new Date();
      device.name = device.name || 'Bedroom Dimmer';
      device.deviceType = 'dimmer';
      device.isOnline = true;
      device.macAddress = allowedDevice.macAddress;
      if (!device.warrantyStartDate) {
        device.warrantyStartDate = new Date();
      }
      await device.save();
    } else {
      console.log(`Creating device ${DIMMER_SERIAL}...`);
      device = await Device.create({
        serialNumber: DIMMER_SERIAL,
        name: 'Bedroom Dimmer',
        deviceType: 'dimmer',
        owner: owner._id,
        pairedAt: new Date(),
        warrantyStartDate: new Date(),
        macAddress: allowedDevice.macAddress,
        isOnline: true,
        state: { lightState: 'off', brightness: 75 },
        mqttUsername: allowedDevice.mqttUsername,
        mqttPassword: allowedDevice.mqttPassword,
      });
    }

    allowedDevice.isActivated = true;
    allowedDevice.activatedAt = allowedDevice.activatedAt || new Date();
    allowedDevice.activatedBy = owner._id;
    await allowedDevice.save();

    console.log('\n========================================');
    console.log('   Dimmer Device Paired to Owner!');
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
