/**
 * سكربت ربط جهازين أمان بحسابات المالكين
 * شغّله بعد seedSecurityDevice.js: node scripts/pairSecurityToOwner.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Device = require('../models/Device');
const AllowedDevice = require('../models/AllowedDevice');

const DEVICES_CONFIG = [
  {
    serial: 'SEC-001',
    ownerEmail: 'aaa654@windowslive.com',
    name: 'Main Entrance Security',
    state: { securityMode: 'disarmed' },
  },
  {
    serial: 'SEC-002',
    ownerEmail: 'mohammed.almuosa@gmail.com',
    name: 'Garage Security',
    state: { securityMode: 'disarmed' },
  },
];

async function pair() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    for (const config of DEVICES_CONFIG) {
      const owner = await User.findOne({ email: config.ownerEmail });
      if (!owner) {
        console.error(`User not found: ${config.ownerEmail}`);
        continue;
      }
      console.log(`Owner found: ${owner.name} (${owner.email})`);

      const allowedDevice = await AllowedDevice.findOne({ serialNumber: config.serial });
      if (!allowedDevice) {
        console.error(`AllowedDevice not found: ${config.serial}`);
        console.error('Run seedSecurityDevice.js first.');
        continue;
      }

      let device = await Device.findOne({ serialNumber: config.serial });

      if (device) {
        console.log(`Device ${config.serial} exists, updating owner...`);
        device.owner = owner._id;
        device.pairedAt = new Date();
        device.name = device.name || config.name;
        device.deviceType = 'security';
        device.isOnline = true;
        device.macAddress = allowedDevice.macAddress;
        if (!device.warrantyStartDate) {
          device.warrantyStartDate = new Date();
        }
        await device.save();
      } else {
        console.log(`Creating device ${config.serial}...`);
        device = await Device.create({
          serialNumber: config.serial,
          name: config.name,
          deviceType: 'security',
          owner: owner._id,
          pairedAt: new Date(),
          warrantyStartDate: new Date(),
          macAddress: allowedDevice.macAddress,
          isOnline: true,
          state: config.state,
          mqttUsername: allowedDevice.mqttUsername,
          mqttPassword: allowedDevice.mqttPassword,
        });
      }

      allowedDevice.isActivated = true;
      allowedDevice.activatedAt = allowedDevice.activatedAt || new Date();
      allowedDevice.activatedBy = owner._id;
      await allowedDevice.save();

      console.log('\n========================================');
      console.log(`   Security Device Paired! (${config.serial})`);
      console.log('========================================');
      console.log(`  Device     : ${device.name}`);
      console.log(`  Serial     : ${device.serialNumber}`);
      console.log(`  Type       : ${device.deviceType}`);
      console.log(`  Owner      : ${owner.name} (${owner.email})`);
      console.log(`  Paired At  : ${device.pairedAt}`);
      console.log(`  Mode       : ${device.state?.securityMode || 'disarmed'}`);
      console.log(`  Status     : Online`);
      console.log('========================================\n');
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

pair();
