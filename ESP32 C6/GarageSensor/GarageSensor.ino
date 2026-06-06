#include <Wire.h>
#include <VL53L1X.h>

#define SDA_PIN 6
#define SCL_PIN 7

#define MAGNET_PIN 10
#define SENSOR_ADDR 0x29

VL53L1X sensor;

bool sensorReady = false;
bool lastDoorOpen = false;

bool checkVL53L1X() {
  Wire.beginTransmission(SENSOR_ADDR);
  return Wire.endTransmission() == 0;
}

bool initVL53L1X() {
  sensor.setTimeout(500);

  if (!sensor.init()) {
    return false;
  }

  sensor.setDistanceMode(VL53L1X::Long);
  sensor.setMeasurementTimingBudget(50000);
  sensor.startContinuous(50);

  return true;
}

void setup() {
  Serial.begin(115200);
  delay(2000);

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(100000);

  pinMode(MAGNET_PIN, INPUT_PULLUP);

  Serial.println("System Started");

  if (checkVL53L1X()) {
    sensorReady = initVL53L1X();

    if (sensorReady) {
      Serial.println("VL53L1X: READY");
    } else {
      Serial.println("VL53L1X: INIT FAILED");
    }
  } else {
    Serial.println("VL53L1X: NOT CONNECTED");
  }

  Serial.println("Waiting for dry contact change...");
}

void loop() {
  // إذا عندك COM -> GND و NO -> GPIO10
  // LOW = الباب مفتوح / المغناطيس بعيد
  // HIGH = الباب مقفل / المغناطيس قريب
  bool doorOpen = (digitalRead(MAGNET_PIN) == LOW);

  // لا يطبع حالة الدراي كونتاكت إلا إذا تغيرت
  if (doorOpen != lastDoorOpen) {
    Serial.println("---------");

    if (doorOpen) {
      Serial.println("Dry Contact: OPEN");
      Serial.println("ToF Reading: STARTED");
    } else {
      Serial.println("Dry Contact: CLOSED");
      Serial.println("ToF Reading: STOPPED");
    }

    lastDoorOpen = doorOpen;
  }

  // إذا الدراي كونتاكت CLOSED يوقف قراءة ToF بالكامل
  if (!doorOpen) {
    delay(100);
    return;
  }

  // إذا الدراي كونتاكت OPEN يبدأ يقرأ ToF
  if (!checkVL53L1X()) {
    Serial.println("VL53L1X: DISCONNECTED");
    sensorReady = false;
    delay(500);
    return;
  }

  if (!sensorReady) {
    sensorReady = initVL53L1X();

    if (sensorReady) {
      Serial.println("VL53L1X: RECONNECTED");
    } else {
      Serial.println("VL53L1X: INIT FAILED");
      delay(500);
      return;
    }
  }

  uint16_t distance = sensor.read();

  if (sensor.timeoutOccurred()) {
    Serial.println("VL53L1X: Read Timeout");
    sensorReady = false;
  } else {
    Serial.print("Distance: ");
    Serial.print(distance);
    Serial.println(" mm");
  }

  delay(300);
}