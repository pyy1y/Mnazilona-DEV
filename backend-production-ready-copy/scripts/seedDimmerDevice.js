/**
 * سكربت إضافة جهاز الدايمر (Demo) في AllowedDevices
 * شغّله مرة وحدة: node scripts/seedDimmerDevice.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const AllowedDevice = require('../models/AllowedDevice');

const DIMMER_DEVICE = {
  serialNumber: 'DIMMER-001',
  deviceSecret: 'c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3',
  deviceType: 'dimmer',
  firmwareVersion: '1.0.0',
  hardwareVersion: '1.0',
  macAddress: 'AA:BB:CC:DD:EE:02',
  notes: 'Demo dimmer device for investor presentation',
};

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const existing = await AllowedDevice.findOne({
      serialNumber: DIMMER_DEVICE.serialNumber,
    });

    if (existing) {
      console.log(`Device ${DIMMER_DEVICE.serialNumber} already exists. Deleting and re-creating...`);
      await AllowedDevice.deleteOne({ serialNumber: DIMMER_DEVICE.serialNumber });
    }

    const device = await AllowedDevice.registerDevice(DIMMER_DEVICE);

    await AllowedDevice.findByIdAndUpdate(device._id, {
      mqttUsername: 'mqtt-user',
      mqttPassword: 'Ar3411279',
    });

    const full = await AllowedDevice.findById(device._id).select('+mqttUsername +mqttPassword +deviceSecret');

    console.log('\n========================================');
    console.log('   Dimmer Device Registered!');
    console.log('========================================');
    console.log(`  Serial Number : ${device.serialNumber}`);
    console.log(`  MAC Address   : ${device.macAddress || 'Not set'}`);
    console.log(`  Device Secret : ${device._rawSecret}`);
    console.log(`  Device Type   : ${device.deviceType}`);
    console.log(`  FW Version    : ${device.firmwareVersion}`);
    console.log(`  MQTT Username : ${full.mqttUsername}`);
    console.log(`  MQTT Password : ${full.mqttPassword}`);
    console.log('========================================');
    console.log('\n  الحين شغّل: node scripts/pairDimmerToOwner.js\n');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seed();
