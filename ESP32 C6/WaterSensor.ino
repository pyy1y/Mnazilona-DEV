#include <Arduino.h>

// تعريف منفذ الحساس
#define SENSOR_PIN 4

// متغيرات حساب النبضات
volatile long pulseCount = 0;
float flowRate = 0.0;
float totalLiters = 0.0;

// متغيرات الوقت للتحديث كل ثانية
unsigned long oldTime = 0;

// معامل المعايرة لحساس YF-B1 (11 نبضة = 1 لتر تقريباً)
const float calibrationFactor = 11.0; 

// دالة المقاطعة (Interrupt) التي تعمل مع كل لفة للمروحة
void IRAM_ATTR pulseCounter() {
  pulseCount++;
}

void setup() {
  Serial.begin(115200);
  
  // إعداد المنفذ كمدخل عادي (لأن المقاومة الخارجية 4.7kΩ متصلة وتؤدي الغرض بامتياز)
  pinMode(SENSOR_PIN, INPUT);
  
  // ربط المنفذ بدالة المقاطعة (تشتغل عندما تنزل الإشارة من High إلى Low)
  attachInterrupt(digitalPinToInterrupt(SENSOR_PIN), pulseCounter, FALLING);
  
  Serial.println("YF-B1 Flow Sensor with External Pull-up Initialized!");
}

void loop() {
  // تحديث الحسابات كل ثانية واحدة (1000 ملي ثانية)
  if ((millis() - oldTime) > 1000) {
    
    // إيقاف المقاطعة مؤقتاً أثناء الحساب لضمان دقة البيانات ومنع التداخل
    detachInterrupt(digitalPinToInterrupt(SENSOR_PIN));
    
    // حساب سرعة التدفق: (النبضات / معامل المعايرة) = لتر في الدقيقة
    flowRate = ((1000.0 / (millis() - oldTime)) * pulseCount) / calibrationFactor;
    
    // حساب إجمالي اللترات المستهلكة
    totalLiters += (flowRate / 60.0);
    
    // طباعة النتائج في الـ Serial Monitor
    Serial.print("Flow Rate: ");
    Serial.print(flowRate);
    Serial.print(" L/min  |  ");
    Serial.print("Total Liquid: ");
    Serial.print(totalLiters);
    Serial.println(" Liters");
    
    // إعادة تصفير العداد للثانية القادمة
    pulseCount = 0;
    oldTime = millis();
    
    // إعادة تشغيل المقاطعة لاستقبال النبضات الجديدة
    attachInterrupt(digitalPinToInterrupt(SENSOR_PIN), pulseCounter, FALLING);
  }
}