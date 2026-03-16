/**
 * سكربت ربط حساس خزان المويه بحساب المالك
 * شغّله بعد seedWaterTankDevice.js: node scripts/pairWaterTankToOwner.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Device = require('../models/Device');
const AllowedDevice = require('../models/AllowedDevice');

const OWNER_EMAIL = 'abuser6278@gmail.com';
const WATER_TANK_SERIAL = 'WTANK-001';

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

    const allowedDevice = await AllowedDevice.findOne({ serialNumber: WATER_TANK_SERIAL });
    if (!allowedDevice) {
      console.error(`AllowedDevice not found: ${WATER_TANK_SERIAL}`);
      console.error('Run seedWaterTankDevice.js first.');
      process.exit(1);
    }

    let device = await Device.findOne({ serialNumber: WATER_TANK_SERIAL });

    if (device) {
      console.log(`Device ${WATER_TANK_SERIAL} exists, updating owner...`);
      device.owner = owner._id;
      device.pairedAt = new Date();
      device.name = device.name || 'Water Tank';
      device.deviceType = 'water-tank';
      device.isOnline = true;
      device.macAddress = allowedDevice.macAddress;
      if (!device.warrantyStartDate) {
        device.warrantyStartDate = new Date();
      }
      await device.save();
    } else {
      console.log(`Creating device ${WATER_TANK_SERIAL}...`);
      device = await Device.create({
        serialNumber: WATER_TANK_SERIAL,
        name: 'Water Tank',
        deviceType: 'water-tank',
        owner: owner._id,
        pairedAt: new Date(),
        warrantyStartDate: new Date(),
        macAddress: allowedDevice.macAddress,
        isOnline: true,
        state: { waterLevel: 65 },
        mqttUsername: allowedDevice.mqttUsername,
        mqttPassword: allowedDevice.mqttPassword,
      });
    }

    allowedDevice.isActivated = true;
    allowedDevice.activatedAt = allowedDevice.activatedAt || new Date();
    allowedDevice.activatedBy = owner._id;
    await allowedDevice.save();

    console.log('\n========================================');
    console.log('   Water Tank Sensor Paired to Owner!');
    console.log('========================================');
    console.log(`  Device     : ${device.name}`);
    console.log(`  Serial     : ${device.serialNumber}`);
    console.log(`  Type       : ${device.deviceType}`);
    console.log(`  Owner      : ${owner.name} (${owner.email})`);
    console.log(`  Paired At  : ${device.pairedAt}`);
    console.log(`  Water Level: ${device.state?.waterLevel || 65}%`);
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
