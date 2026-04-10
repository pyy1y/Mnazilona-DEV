/**
 * سكربت إضافة جهاز القفل الذكي (Lock) في AllowedDevices
 * شغّله مرة وحدة: node scripts/seedLockDevice.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const AllowedDevice = require('../models/AllowedDevice');

const LOCK_DEVICE = {
  serialNumber: 'LOCK-001',
  deviceSecret: 'l0ck4cc3ss5ecr3tk3y9f8e7d6c5b4a',
  deviceType: 'lock',
  firmwareVersion: '1.0.0',
  hardwareVersion: '1.0',
  macAddress: 'AA:BB:CC:DD:EE:08',
  notes: 'Smart door lock - TTLock compatible',
};

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const existing = await AllowedDevice.findOne({
      serialNumber: LOCK_DEVICE.serialNumber,
    });

    if (existing) {
      console.log(`Device ${LOCK_DEVICE.serialNumber} already exists. Deleting and re-creating...`);
      await AllowedDevice.deleteOne({ serialNumber: LOCK_DEVICE.serialNumber });
    }

    const device = await AllowedDevice.registerDevice(LOCK_DEVICE);

    await AllowedDevice.findByIdAndUpdate(device._id, {
      mqttUsername: 'mqtt-user',
      mqttPassword: 'Ar3411279',
    });

    const full = await AllowedDevice.findById(device._id).select('+mqttUsername +mqttPassword +deviceSecret');

    console.log('\n========================================');
    console.log('   Smart Lock Registered!');
    console.log('========================================');
    console.log(`  Serial Number : ${device.serialNumber}`);
    console.log(`  MAC Address   : ${device.macAddress || 'Not set'}`);
    console.log(`  Device Secret : ${device._rawSecret}`);
    console.log(`  Device Type   : ${device.deviceType}`);
    console.log(`  FW Version    : ${device.firmwareVersion}`);
    console.log(`  MQTT Username : ${full.mqttUsername}`);
    console.log(`  MQTT Password : ${full.mqttPassword}`);
    console.log('========================================');
    console.log('\n  الحين شغّل: node scripts/pairLockToOwner.js\n');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seed();
