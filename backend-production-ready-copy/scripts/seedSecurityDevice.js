/**
 * سكربت إضافة جهاز الأمان (Security) في AllowedDevices
 * شغّله مرة وحدة: node scripts/seedSecurityDevice.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const AllowedDevice = require('../models/AllowedDevice');

const SECURITY_DEVICE = {
  serialNumber: 'SEC-001',
  deviceSecret: 's3cur1ty4cc3ss0k3y9f8e7d6c5b4a3',
  deviceType: 'security',
  firmwareVersion: '1.0.0',
  hardwareVersion: '1.0',
  macAddress: 'AA:BB:CC:DD:EE:07',
  notes: 'Security alarm system panel',
};

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const existing = await AllowedDevice.findOne({
      serialNumber: SECURITY_DEVICE.serialNumber,
    });

    if (existing) {
      console.log(`Device ${SECURITY_DEVICE.serialNumber} already exists. Deleting and re-creating...`);
      await AllowedDevice.deleteOne({ serialNumber: SECURITY_DEVICE.serialNumber });
    }

    const device = await AllowedDevice.registerDevice(SECURITY_DEVICE);

    await AllowedDevice.findByIdAndUpdate(device._id, {
      mqttUsername: 'mqtt-user',
      mqttPassword: 'Ar3411279',
    });

    const full = await AllowedDevice.findById(device._id).select('+mqttUsername +mqttPassword +deviceSecret');

    console.log('\n========================================');
    console.log('   Security Device Registered!');
    console.log('========================================');
    console.log(`  Serial Number : ${device.serialNumber}`);
    console.log(`  MAC Address   : ${device.macAddress || 'Not set'}`);
    console.log(`  Device Secret : ${device._rawSecret}`);
    console.log(`  Device Type   : ${device.deviceType}`);
    console.log(`  FW Version    : ${device.firmwareVersion}`);
    console.log(`  MQTT Username : ${full.mqttUsername}`);
    console.log(`  MQTT Password : ${full.mqttPassword}`);
    console.log('========================================');
    console.log('\n  الحين شغّل: node scripts/pairSecurityToOwner.js\n');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seed();
