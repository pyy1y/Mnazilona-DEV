/**
 * سكربت إضافة جهاز الإضاءة (Demo) في AllowedDevices
 * شغّله مرة وحدة: node scripts/seedLightDevice.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const AllowedDevice = require('../models/AllowedDevice');

const LIGHT_DEVICE = {
  serialNumber: 'LIGHT-001',
  deviceSecret: 'b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2',
  deviceType: 'light',
  firmwareVersion: '1.0.0',
  hardwareVersion: '1.0',
  macAddress: 'AA:BB:CC:DD:EE:01',
  notes: 'Demo light device for investor presentation',
};

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // شيك هل موجود
    const existing = await AllowedDevice.findOne({
      serialNumber: LIGHT_DEVICE.serialNumber,
    });

    if (existing) {
      console.log(`Device ${LIGHT_DEVICE.serialNumber} already exists. Deleting and re-creating...`);
      await AllowedDevice.deleteOne({ serialNumber: LIGHT_DEVICE.serialNumber });
    }

    // سجّل الجهاز (يهاش الـ secret تلقائيا)
    const device = await AllowedDevice.registerDevice(LIGHT_DEVICE);

    // استخدم بيانات البروكر الفعلية
    await AllowedDevice.findByIdAndUpdate(device._id, {
      mqttUsername: 'mqtt-user',
      mqttPassword: 'Ar3411279',
    });

    // جيب MQTT credentials
    const full = await AllowedDevice.findById(device._id).select('+mqttUsername +mqttPassword +deviceSecret');

    console.log('\n========================================');
    console.log('   Light Device Registered!');
    console.log('========================================');
    console.log(`  Serial Number : ${device.serialNumber}`);
    console.log(`  MAC Address   : ${device.macAddress || 'Not set'}`);
    console.log(`  Device Secret : ${device._rawSecret}`);
    console.log(`  Device Type   : ${device.deviceType}`);
    console.log(`  FW Version    : ${device.firmwareVersion}`);
    console.log(`  MQTT Username : ${full.mqttUsername}`);
    console.log(`  MQTT Password : ${full.mqttPassword}`);
    console.log('========================================');
    console.log('\n  احفظ الـ Device Secret! ما بيطلع مرة ثانية (مخزّن مهاش)');
    console.log('  الحين شغّل: node scripts/pairLightToOwner.js\n');

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seed();
