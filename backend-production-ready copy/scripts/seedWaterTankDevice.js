/**
 * سكربت إضافة جهازين حساس خزان مويه (Demo) في AllowedDevices
 * شغّله مرة وحدة: node scripts/seedWaterTankDevice.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const AllowedDevice = require('../models/AllowedDevice');

const WATER_TANK_DEVICES = [
  {
    serialNumber: 'WTANK-001',
    deviceSecret: 'd1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6',
    deviceType: 'water-tank',
    firmwareVersion: '1.0.0',
    hardwareVersion: '1.0',
    macAddress: 'AA:BB:CC:DD:EE:03',
    notes: 'Main water tank sensor',
  },
  {
    serialNumber: 'WTANK-002',
    deviceSecret: 'd2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7',
    deviceType: 'water-tank',
    firmwareVersion: '1.0.0',
    hardwareVersion: '1.0',
    macAddress: 'AA:BB:CC:DD:EE:13',
    notes: 'Rooftop water tank sensor',
  },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    for (const WATER_TANK_DEVICE of WATER_TANK_DEVICES) {
      const existing = await AllowedDevice.findOne({
        serialNumber: WATER_TANK_DEVICE.serialNumber,
      });

      if (existing) {
        console.log(`Device ${WATER_TANK_DEVICE.serialNumber} already exists. Deleting and re-creating...`);
        await AllowedDevice.deleteOne({ serialNumber: WATER_TANK_DEVICE.serialNumber });
      }

      const device = await AllowedDevice.registerDevice(WATER_TANK_DEVICE);

      await AllowedDevice.findByIdAndUpdate(device._id, {
        mqttUsername: 'mqtt-user',
        mqttPassword: 'Ar3411279',
      });

      const full = await AllowedDevice.findById(device._id).select('+mqttUsername +mqttPassword +deviceSecret');

      console.log('\n========================================');
      console.log(`   Water Tank Sensor Registered! (${WATER_TANK_DEVICE.serialNumber})`);
      console.log('========================================');
      console.log(`  Serial Number : ${device.serialNumber}`);
      console.log(`  MAC Address   : ${device.macAddress || 'Not set'}`);
      console.log(`  Device Secret : ${device._rawSecret}`);
      console.log(`  Device Type   : ${device.deviceType}`);
      console.log(`  FW Version    : ${device.firmwareVersion}`);
      console.log(`  MQTT Username : ${full.mqttUsername}`);
      console.log(`  MQTT Password : ${full.mqttPassword}`);
      console.log(`  Notes         : ${WATER_TANK_DEVICE.notes}`);
      console.log('========================================');
    }

    console.log('\n  الحين شغّل: node scripts/pairWaterTankToOwner.js\n');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seed();
