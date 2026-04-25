/**
 * ═══════════════════════════════════════════════════════════════
 *  Mnazilona ESP32-C6 — FULL WIPE UTILITY
 * ═══════════════════════════════════════════════════════════════
 *
 *  يمسح كل البيانات المحلية على الجهاز:
 *    - NVS partition (secrets, config, security namespaces)
 *    - OTA pending verify state
 *    - أي إعدادات WiFi / MQTT / PoP محفوظة
 *
 *  بعد التشغيل يطبع رسالة نجاح ويتوقف. ارفع الفيرموير الأصلي بعدها.
 *
 *  Usage:
 *    1. افتح هذا السكتش في Arduino IDE
 *    2. Board: ESP32C6 Dev Module
 *    3. Upload → افتح Serial Monitor (115200 baud)
 *    4. شوف "WIPE COMPLETE" ثم ارفع GarageRelayFirmware.ino
 * ═══════════════════════════════════════════════════════════════
 */

#include <nvs_flash.h>
#include <esp_ota_ops.h>
#include <Preferences.h>

void wipeNamespace(const char* ns) {
  Preferences prefs;
  if (prefs.begin(ns, false)) {
    prefs.clear();
    prefs.end();
    Serial.printf("  [OK]   Namespace '%s' cleared\n", ns);
  } else {
    Serial.printf("  [SKIP] Namespace '%s' not found\n", ns);
  }
}

void setup() {
  Serial.begin(115200);
  delay(2000);  // wait for serial

  Serial.println("\n╔══════════════════════════════════════════╗");
  Serial.println("║   ESP32-C6 FULL WIPE STARTING            ║");
  Serial.println("╚══════════════════════════════════════════╝\n");

  // ─── 1. Clear known namespaces ───
  Serial.println("[1/3] Clearing known NVS namespaces...");
  wipeNamespace("secrets");   // deviceSecret + popCode
  wipeNamespace("config");    // ssid, mqtt, prev_fw, adminLocked, etc.
  wipeNamespace("security");  // pop_attempts, pop_lockout

  // ─── 2. Erase entire NVS partition (nuclear option) ───
  Serial.println("\n[2/3] Erasing entire NVS partition...");
  esp_err_t err = nvs_flash_erase();
  if (err == ESP_OK) {
    Serial.println("  [OK]   NVS partition fully erased");
  } else {
    Serial.printf("  [ERR]  nvs_flash_erase failed: %d\n", err);
  }

  // Re-init NVS so next boot doesn't panic
  err = nvs_flash_init();
  if (err == ESP_OK) {
    Serial.println("  [OK]   NVS re-initialized empty");
  } else {
    Serial.printf("  [ERR]  nvs_flash_init failed: %d\n", err);
  }

  // ─── 3. Clear any OTA pending verify state ───
  Serial.println("\n[3/3] Clearing OTA state...");
  const esp_partition_t* running = esp_ota_get_running_partition();
  esp_ota_img_states_t otaState;
  if (esp_ota_get_state_partition(running, &otaState) == ESP_OK) {
    if (otaState == ESP_OTA_IMG_PENDING_VERIFY) {
      esp_ota_mark_app_valid_cancel_rollback();
      Serial.println("  [OK]   OTA pending-verify cancelled");
    } else {
      Serial.println("  [SKIP] No pending OTA state");
    }
  }

  Serial.println("\n╔══════════════════════════════════════════╗");
  Serial.println("║   WIPE COMPLETE — DEVICE IS NOW BLANK    ║");
  Serial.println("║   Now upload GarageRelayFirmware.ino     ║");
  Serial.println("║   Then re-burn secrets via:              ║");
  Serial.println("║   PROVISION:secret=<32+hex>,pop=<6+>     ║");
  Serial.println("╚══════════════════════════════════════════╝\n");
}

void loop() {
  delay(5000);
  Serial.println("[Wipe] Done. Upload your main firmware now.");
}
