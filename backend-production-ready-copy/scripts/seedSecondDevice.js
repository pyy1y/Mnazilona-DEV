/**
 * سكربت إضافة الجهاز التجريبي الثاني في AllowedDevices
 * شغّله مرة وحدة: node scripts/seedSecondDevice.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const AllowedDevice = require('../models/AllowedDevice');

const SECOND_DEVICE = {
  serialNumber: 'SN-002',
  deviceSecret: 'f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3',
  deviceType: 'relay',
  firmwareVersion: '1.0.0',
  hardwareVersion: '1.0',
  macAddress: '20:6E:F1:09:DD:8C',
  notes: 'Second test device for development',
};

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // شيك هل موجود
    const existing = await AllowedDevice.findOne({
      serialNumber: SECOND_DEVICE.serialNumber,
    });

    if (existing) {
      console.log(`⚠️  Device ${SECOND_DEVICE.serialNumber} already exists. Deleting and re-creating...`);
      await AllowedDevice.deleteOne({ serialNumber: SECOND_DEVICE.serialNumber });
    }

    // سجّل الجهاز (يهاش الـ secret تلقائياً)
    const device = await AllowedDevice.registerDevice(SECOND_DEVICE);

    // ✅ استخدم بيانات البروكر الفعلية
    await AllowedDevice.findByIdAndUpdate(device._id, {
      mqttUsername: 'mqtt-user',
      mqttPassword: 'Ar3411279',
    });

    // جيب MQTT credentials
    const full = await AllowedDevice.findById(device._id).select('+mqttUsername +mqttPassword +deviceSecret');

    console.log('\n========================================');
    console.log('   ✅ Second Test Device Registered!');
    console.log('========================================');
    console.log(`  Serial Number : ${device.serialNumber}`);
    console.log(`  MAC Address   : ${device.macAddress || 'Not set'}`);
    console.log(`  Device Secret : ${device._rawSecret}`);
    console.log(`  Device Type   : ${device.deviceType}`);
    console.log(`  FW Version    : ${device.firmwareVersion}`);
    console.log(`  MQTT Username : ${full.mqttUsername}`);
    console.log(`  MQTT Password : ${full.mqttPassword}`);
    console.log('========================================');
    console.log('\n⚠️  احفظ الـ Device Secret! ما بيطلع مرة ثانية (مخزّن مهاش)');
    console.log('📋 حط هالبيانات في كود الـ ESP32 الثاني\n');

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seed();
