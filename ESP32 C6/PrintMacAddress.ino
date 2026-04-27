/**
 * ═══════════════════════════════════════════════════════════════
 *  ESP32-C6 - MAC Address Printer
 * ═══════════════════════════════════════════════════════════════
 *  يطبع الـ MAC Address الخاص بالجهاز كل ثانيتين على Serial Monitor
 *
 *  Arduino IDE Setup:
 *    Board: ESP32C6 Dev Module
 *    Baud:  115200
 * ═══════════════════════════════════════════════════════════════
 */

#include <WiFi.h>

void setup() {
  Serial.begin(115200);
  delay(1000);

  WiFi.mode(WIFI_STA);
  delay(100);

  String mac = WiFi.macAddress();

  Serial.println("\n======================================");
  Serial.println("  ESP32-C6 MAC Address");
  Serial.println("======================================");
  Serial.printf("  MAC: %s\n", mac.c_str());
  Serial.println("======================================\n");
}

void loop() {
  Serial.printf("MAC: %s\n", WiFi.macAddress().c_str());
  delay(2000);
}
