/**
 * سكربت إضافة الجهاز الثاني في AllowedDevices
 * شغّله مرة وحدة: node RealScripts/SeedGarageRelay2.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const AllowedDevice = require('../models/AllowedDevice');

const TEST_DEVICE = {
  serialNumber: 'SN-002',
  deviceSecret: 'b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4',  // نفس DEVICE_SECRET اللي بتحرقه على ESP32 الثاني
  deviceType: 'relay',
  firmwareVersion: '1.1.0',
  hardwareVersion: '1.0',
  macAddress: '20:6E:F1:09:DD:8C',
  notes: 'Second garage relay device',
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
    console.log('   ✅ Second Device Registered!');
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
    console.log('📋 حط هالبيانات في كود الـ ESP32 الثاني (GarageRelayFirmware2.ino)\n');

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seed();
