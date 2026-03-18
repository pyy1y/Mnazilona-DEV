/**
 * سكربت إضافة جهازين مكيف (Demo) في AllowedDevices
 * شغّله مرة وحدة: node scripts/seedACDevice.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const AllowedDevice = require('../models/AllowedDevice');

const AC_DEVICES = [
  {
    serialNumber: 'AC-001',
    deviceSecret: 'a1c2d3e4f5b6c7d8e9f0a1b2c3d4e5f6',
    deviceType: 'ac',
    firmwareVersion: '1.0.0',
    hardwareVersion: '1.0',
    macAddress: 'AA:BB:CC:DD:EE:04',
    notes: 'Living room AC unit',
  },
  {
    serialNumber: 'AC-002',
    deviceSecret: 'a2c3d4e5f6b7c8d9e0f1a2b3c4d5e6f7',
    deviceType: 'ac',
    firmwareVersion: '1.0.0',
    hardwareVersion: '1.0',
    macAddress: 'AA:BB:CC:DD:EE:14',
    notes: 'Bedroom AC unit',
  },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    for (const AC_DEVICE of AC_DEVICES) {
      const existing = await AllowedDevice.findOne({
        serialNumber: AC_DEVICE.serialNumber,
      });

      if (existing) {
        console.log(`Device ${AC_DEVICE.serialNumber} already exists. Deleting and re-creating...`);
        await AllowedDevice.deleteOne({ serialNumber: AC_DEVICE.serialNumber });
      }

      const device = await AllowedDevice.registerDevice(AC_DEVICE);

      await AllowedDevice.findByIdAndUpdate(device._id, {
        mqttUsername: 'mqtt-user',
        mqttPassword: 'Ar3411279',
      });

      const full = await AllowedDevice.findById(device._id).select('+mqttUsername +mqttPassword +deviceSecret');

      console.log('\n========================================');
      console.log(`   AC Unit Registered! (${AC_DEVICE.serialNumber})`);
      console.log('========================================');
      console.log(`  Serial Number : ${device.serialNumber}`);
      console.log(`  MAC Address   : ${device.macAddress || 'Not set'}`);
      console.log(`  Device Secret : ${device._rawSecret}`);
      console.log(`  Device Type   : ${device.deviceType}`);
      console.log(`  FW Version    : ${device.firmwareVersion}`);
      console.log(`  MQTT Username : ${full.mqttUsername}`);
      console.log(`  MQTT Password : ${full.mqttPassword}`);
      console.log(`  Notes         : ${AC_DEVICE.notes}`);
      console.log('========================================');
    }

    console.log('\n  الحين شغّل: node scripts/pairACToOwner.js\n');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seed();
