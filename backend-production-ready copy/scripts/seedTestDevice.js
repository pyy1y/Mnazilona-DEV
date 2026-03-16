/**
 * سكربت إضافة جهاز تجريبي في AllowedDevices
 * شغّله مرة وحدة: node scripts/seedTestDevice.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const AllowedDevice = require('../models/AllowedDevice');

const TEST_DEVICE = {
  serialNumber: 'SN-001',
  deviceSecret: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',  // نفس DEVICE_SECRET في كود ESP32
  deviceType: 'relay',
  firmwareVersion: '1.0.0',
  hardwareVersion: '1.0',
  macAddress: '54:32:04:0C:0A:50',
  notes: 'Test device for development',
};

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // شيك هل موجود
    const existing = await AllowedDevice.findOne({
      serialNumber: TEST_DEVICE.serialNumber,
    });

    if (existing) {
      console.log(`⚠️  Device ${TEST_DEVICE.serialNumber} already exists. Deleting and re-creating...`);
      await AllowedDevice.deleteOne({ serialNumber: TEST_DEVICE.serialNumber });
    }

    // سجّل الجهاز (يهاش الـ secret تلقائياً)
    const device = await AllowedDevice.registerDevice(TEST_DEVICE);

    // ✅ استخدم بيانات البروكر الفعلية (Mosquitto ما يدعم webhook auth حالياً)
    // TODO: لما تضبط webhook auth في Mosquitto، شيل هالسطرين وخلي credentials فريدة لكل جهاز
    await AllowedDevice.findByIdAndUpdate(device._id, {
      mqttUsername: 'mqtt-user',
      mqttPassword: 'Ar3411279',
    });

    // جيب MQTT credentials
    const full = await AllowedDevice.findById(device._id).select('+mqttUsername +mqttPassword +deviceSecret');

    console.log('\n========================================');
    console.log('   ✅ Test Device Registered!');
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
    console.log('📋 حط هالبيانات في كود الـ ESP32\n');

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seed();
