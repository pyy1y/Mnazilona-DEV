/**
 * ═══════════════════════════════════════════════════════════════
 *  Mnazilona IoT - ESP32-C6 Firmware v1.1.0
 *  BLE Provisioning (no PoP) + DeviceSecret
 * ═══════════════════════════════════════════════════════════════
 *
 *  Garage Relay - Pulse Mode Only
 *  Open = 2 second pulse then auto-close
 *  No persistent on/off state
 *
 *  Arduino IDE Setup:
 *    Board:  ESP32C6 Dev Module
 *    Libs:   ArduinoJson (6.21.x+), PubSubClient (2.8.x+)
 *
 *  Provisioning: BLE GATT (no PoP). Device identity is proved by
 *  the cloud-side allowlist + device secret on /devices/inquiry.
 *  Local API on port 8080 is open to the LAN (Tuya/SmartLife model);
 *  it is gated on the device being paired to a user.
 * ═══════════════════════════════════════════════════════════════
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <ESPmDNS.h>
#include <Update.h>
#include <esp_ota_ops.h>
#include <mbedtls/md.h>
#include <mbedtls/pk.h>
#include <mbedtls/sha256.h>
#include <mbedtls/base64.h>
#include <esp_task_wdt.h>
#include <esp_log.h>
#include <time.h>

// ═══════════════════════════════════════
// BLE Provisioning
// ═══════════════════════════════════════
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// Custom GATT Service & Characteristic UUIDs for Mnazilona provisioning
#define BLE_SERVICE_UUID        "4d4e5a00-4c4f-4e41-0001-000000000000"
#define BLE_CHAR_DEVICE_INFO    "4d4e5a00-4c4f-4e41-0001-000000000001"  // Read
#define BLE_CHAR_POP_VERIFY     "4d4e5a00-4c4f-4e41-0001-000000000002"  // Write + Notify
#define BLE_CHAR_WIFI_SCAN      "4d4e5a00-4c4f-4e41-0001-000000000003"  // Write + Notify
#define BLE_CHAR_WIFI_CONFIG    "4d4e5a00-4c4f-4e41-0001-000000000004"  // Write + Notify
#define BLE_CHAR_STATUS         "4d4e5a00-4c4f-4e41-0001-000000000005"  // Read + Notify

#define BLE_ADV_NAME_PREFIX     "MNZ_"
#define BLE_TIMEOUT_MS          300000UL  // 5 minutes BLE advertising timeout

// BLE globals
BLEServer*         bleServer         = nullptr;
BLECharacteristic* bleCharDeviceInfo = nullptr;
BLECharacteristic* bleCharPopVerify  = nullptr;
BLECharacteristic* bleCharWifiScan   = nullptr;
BLECharacteristic* bleCharWifiConfig = nullptr;
BLECharacteristic* bleCharStatus     = nullptr;
bool               bleClientConnected = false;
bool               bleProvisioning    = false;  // true when BLE provisioning is active
uint32_t           bleStartTime       = 0;
uint32_t           bleLastActivity    = 0;

// Set by WiFiConfigCallback after WiFi succeeds. Main loop picks it up to run
// stopBLE() + inquireServer() + connectMQTT() outside NimBLE host task —
// running heavy/blocking work inside a BLE callback deadlocks NimBLE on ESP32-C6.
volatile bool      wifiProvisionedFlag = false;
uint32_t           wifiProvisionedAt   = 0;

// BLE chunked transfer buffer (for WiFi scan results that exceed MTU)
String             bleScanResultBuffer = "";
int                bleScanChunkIndex   = 0;

// Watchdog timeout: 30 seconds - resets device if loop() hangs
#define WDT_TIMEOUT_SEC 30

// ═══════════════════════════════════════
// CONFIG - ثوابت غير سرية
// ═══════════════════════════════════════
#define DEVICE_NAME       "Garage Relay"
#define FIRMWARE_VERSION  "1.0.2"

// هوية الجهاز (السيريال + الـ secret) تُقرأ من NVS — تُحرق مرة وحدة
// أثناء التصنيع. لكل جهاز قيم فريدة. لا تكتبها في الكود أبداً!
//   PROVISION:serial=<SN-XXX>,secret=<hex32>
String serialNumber = "";
String deviceSecret = "";

// ═══════════════════════════════════════
// SERVER & TLS CONFIG
// ═══════════════════════════════════════
// Production: use HTTPS with your domain
//#define SERVER_BASE_URL   "https://your-domain.com"
// Development: uncomment for local HTTP testing
#define SERVER_BASE_URL   "https://mnazilona.xyz/api"
#define SERVER_INQUIRY_PATH "/devices/inquiry"
#define SERVER_OTA_CHECK_PATH "/devices/ota/check"

// TLS: Root CA certificate for server & MQTT broker verification
// Empty in dev mode → setInsecure() is used. For production, paste a real
// Let's Encrypt / your CA chain here (length must exceed 60 to activate).
const char* ca_cert = "";

// OTA: RSA public key for firmware signature verification
// Empty in dev mode → signature check skipped. For production, generate keypair:
//   openssl genrsa -out ota_private.pem 2048
//   openssl rsa -in ota_private.pem -pubout -out ota_public.pem
// then paste the public key here (length must exceed 60 to activate).
const char* ota_public_key = "";

// ─────────────────────────────────────────────────────────────────────────────
// OTA SCHEME POLICY — DEV vs PROD
// ─────────────────────────────────────────────────────────────────────────────
// HTTPS is the default and only allowed scheme for OTA downloads.
//
// Set ALLOW_INSECURE_OTA_HTTP = 1 ONLY for local/private-network development
// where the OTA server is reachable over plain http:// (e.g. a LAN dev box at
// http://192.168.x.x:3000). When this flag is 0, the firmware behaves exactly
// as before: HTTPS-only.
//
// Integrity is still enforced regardless of scheme:
//   • SHA-256 checksum is verified against the server-provided value.
//   • RSA-SHA256 signature is verified if ota_public_key is configured.
// So even on plain HTTP, a tampered binary is rejected before flashing.
//
// MUST be set back to 0 for production builds.
#ifndef ALLOW_INSECURE_OTA_HTTP
#define ALLOW_INSECURE_OTA_HTTP 1   // 1 = HTTP allowed (DEV), 0 = HTTPS-only (PROD default)
#endif

// ═══════════════════════════════════════
// SoftAP Settings (LEGACY — no longer used for provisioning)
// Provisioning now uses BLE. See BLE_* defines above.
// Kept commented out for reference only.
// ═══════════════════════════════════════

// ═══════════════════════════════════════
// Hardware Pins
// ═══════════════════════════════════════
#define RELAY_PIN         5
#define BUTTON_PIN        13
#define DOOR_SENSOR_PIN   10    // SW-420 vibration/tilt sensor (DO pin)
#define LED_R             6
#define LED_G             7
#define LED_B             4
#define LED_ACTIVE_LOW    false

// Door sensor: اضبط هالقيمة حسب تركيب الحساس
// LOW = الباب مفتوح (الحساس مائل)، غيّرها لـ HIGH لو طلع عندك العكس
#define DOOR_OPEN_STATE   LOW

// ═══════════════════════════════════════
// Timing
// ═══════════════════════════════════════
#define RELAY_PULSE_MS           2000UL    // ثانيتين ثم يقفل
#define WIFI_RETRY_INTERVAL_MS   30000UL
#define MQTT_HEARTBEAT_MS        30000UL
#define MQTT_RECONNECT_MS        5000UL
#define DOOR_SENSOR_CHECK_MS     2000UL   // كل ثانيتين يتشيك على حالة الباب
// AP_TIMEOUT_MS replaced by BLE_TIMEOUT_MS (defined in BLE section above)

// ═══════════════════════════════════════
// Security
// ═══════════════════════════════════════
#define MQTT_MAX_RECONNECTS   3

// ═══════════════════════════════════════
// NTP Time Sync
// ═══════════════════════════════════════
#define NTP_SERVER1           "pool.ntp.org"
#define NTP_SERVER2           "time.google.com"
#define NTP_GMT_OFFSET_SEC    (3 * 3600)   // UTC+3 (السعودية)
#define NTP_DAYLIGHT_OFFSET   0

bool ntpSynced = false;

// Forward declaration
void addLog(const char* msg, const char* type = "info");

// Get current epoch time (0 if not synced)
uint32_t getEpochTime() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 100)) return 0;
  return (uint32_t)mktime(&timeinfo);
}

void syncNTP() {
  configTime(NTP_GMT_OFFSET_SEC, NTP_DAYLIGHT_OFFSET, NTP_SERVER1, NTP_SERVER2);
  Serial.println("[NTP] Time sync started");

  // Wait briefly for sync (non-blocking in subsequent calls)
  struct tm timeinfo;
  if (getLocalTime(&timeinfo, 3000)) {
    ntpSynced = true;
    char buf[30];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &timeinfo);
    Serial.printf("[NTP] Synced: %s\n", buf);
    addLog("NTP time synced", "info");
  } else {
    Serial.println("[NTP] Sync pending (will retry in background)");
  }
}

// ═══════════════════════════════════════
// Local Logs (Circular Buffer)
// Each entry stores both the device uptime (millis) and the real epoch
// timestamp when NTP is synced. The mobile app can use either —
// `epoch` is preferred, `uptimeMs` is a fallback.
// ═══════════════════════════════════════
#define MAX_LOCAL_LOGS        50

struct LocalLog {
  uint32_t uptimeMs;    // millis() at the time of the event
  uint32_t epoch;       // unix epoch seconds (0 if NTP not synced yet)
  char message[80];
  char type[8];         // "info", "warning", "error"
};

LocalLog localLogs[MAX_LOCAL_LOGS];
int logHead = 0;
int logCount = 0;

void addLog(const char* msg, const char* type) {
  LocalLog& entry = localLogs[logHead];
  entry.uptimeMs = millis();
  // Non-blocking epoch read. If NTP hasn't synced yet, time() returns a
  // small value (seconds since boot), so guard with ntpSynced.
  entry.epoch    = ntpSynced ? (uint32_t)time(nullptr) : 0;
  strncpy(entry.message, msg, sizeof(entry.message) - 1);
  entry.message[sizeof(entry.message) - 1] = '\0';
  strncpy(entry.type, type, sizeof(entry.type) - 1);
  entry.type[sizeof(entry.type) - 1] = '\0';
  logHead = (logHead + 1) % MAX_LOCAL_LOGS;
  if (logCount < MAX_LOCAL_LOGS) logCount++;
}

// ═══════════════════════════════════════
// State Machine
// ═══════════════════════════════════════
enum DeviceState {
  STATE_BOOT,
  STATE_AP_ACTIVE,
  STATE_POP_VERIFIED,
  STATE_WIFI_CONNECTING,
  STATE_SERVER_INQUIRY,
  STATE_MQTT_CONNECTING,
  STATE_ONLINE,
  STATE_WIFI_RECONNECTING,
  STATE_OTA_UPDATING,
  STATE_ERROR,
};

// ═══════════════════════════════════════
// Globals
// ═══════════════════════════════════════
DeviceState currentState   = STATE_BOOT;

// TLS-secured clients
WiFiClientSecure wifiSecureClient;
WiFiClient       wifiPlainClient;   // for plain HTTP (dev/local server)
// Dedicated client for OTA download. MUST NOT be shared with MQTT —
// PubSubClient and HTTPClient operating on the same WiFiClient instance
// corrupts the underlying TCP socket and aborts the download mid-stream.
WiFiClient       otaPlainClient;
PubSubClient mqttClient(wifiSecureClient);
WebServer server(80);
WebServer localServer(8080);  // Local API server (runs when online)
bool localServerRunning = false;
Preferences prefs;

String storedSSID = "", storedPassword = "";
String mqttHost = "", mqttUser = "", mqttPass = "", mqttToken = "";
String pairingUserId = "";
int mqttPort = 8883;  // Default MQTTS port

uint32_t relayStartTime      = 0;
bool relayActive             = false;
uint32_t lastHeartbeatMs     = 0;
uint32_t lastMqttReconnectMs = 0;
uint32_t lastWifiRetryMs     = 0;
// apStartTime/lastApActivity removed — replaced by bleStartTime/bleLastActivity (BLE section)
uint32_t lastLedToggle       = 0;
uint32_t lastDoorCheckMs     = 0;
bool ledToggleState          = false;
int mqttReconnectCount       = 0;
bool lastDoorState           = false;  // false = closed, true = open
bool doorStateInitialized    = false;

// Door sensor debounce: SW-420 is noisy, require consistent reads
#define DOOR_DEBOUNCE_READS   3       // عدد القراءات المتطابقة المطلوبة
uint8_t doorDebounceCount    = 0;
bool    doorDebouncePending  = false;  // هل فيه تغيّر ينتظر التأكيد

// Command Rate Limiting
#define CMD_RATE_WINDOW_MS    5000UL  // نافذة 5 ثواني
#define CMD_RATE_MAX          10      // أقصى 10 أوامر في النافذة
#define CMD_DEDUP_WINDOW_MS   15000UL // تجاهل تكرار نفس requestId لمدة 15 ثانية
uint32_t cmdWindowStart      = 0;
uint8_t  cmdCount            = 0;
String   lastCommandRequestId = "";
String   lastCommandResponse  = "";
uint32_t lastCommandHandledAt = 0;

bool checkCommandRateLimit() {
  uint32_t now = millis();
  if (now - cmdWindowStart > CMD_RATE_WINDOW_MS) {
    cmdWindowStart = now;
    cmdCount = 1;
    return true;
  }
  cmdCount++;
  if (cmdCount > CMD_RATE_MAX) {
    Serial.println("[Security] Command rate limit exceeded");
    addLog("Rate limit exceeded", "warning");
    return false;
  }
  return true;
}

bool isDuplicateCommandRequest(const String& requestId) {
  if (requestId.length() == 0 || lastCommandRequestId.length() == 0) return false;
  if (requestId != lastCommandRequestId) return false;
  if (millis() - lastCommandHandledAt > CMD_DEDUP_WINDOW_MS) {
    lastCommandRequestId = "";
    lastCommandResponse = "";
    lastCommandHandledAt = 0;
    return false;
  }
  return true;
}

void rememberCommandRequest(const String& requestId, const String& responseJson) {
  if (requestId.length() == 0) return;
  lastCommandRequestId = requestId;
  lastCommandResponse = responseJson;
  lastCommandHandledAt = millis();
}

// OTA Update Variables
bool otaInProgress           = false;
String otaUrl                = "";
String otaVersion            = "";
String otaChecksum           = "";
uint32_t otaFileSize         = 0;
uint8_t otaRetryCount        = 0;

// OTA Rollback Verification
bool otaPendingVerify        = false;   // true = new firmware, needs connectivity proof
uint32_t otaBootTime         = 0;      // millis() at boot for rollback timeout

// OTA Production Config
#define OTA_MAX_RETRIES       2         // عدد محاولات التحميل
#define OTA_DOWNLOAD_TIMEOUT  120000UL  // 2 دقيقة timeout كامل للتحميل
#define OTA_STALL_TIMEOUT     15000UL   // 15 ثانية بدون بيانات = فشل
#define OTA_VERIFY_TIMEOUT    120000UL  // دقيقتين عشان يثبت الاتصال قبل ما يأكد الفيرموير
#define OTA_MIN_HEAP          40000     // 40KB minimum heap للتحديث
#define OTA_CHECK_INTERVAL    3600000UL // كل ساعة يتشيك على تحديثات جديدة
uint32_t lastOtaCheckMs      = 0;


// ══════════════════════════════════════
//            LED CONTROL
// ══════════════════════════════════════

inline void ledWrite(int pin, bool on) {
  digitalWrite(pin, LED_ACTIVE_LOW ? (on ? LOW : HIGH) : (on ? HIGH : LOW));
}

void setLED(bool r, bool g, bool b) {
  ledWrite(LED_R, r);
  ledWrite(LED_G, g);
  ledWrite(LED_B, b);
}

void setLED_off()     { setLED(false, false, false); }
void setLED_online()  { setLED(false, true,  false); }
void setLED_offline() { setLED(true,  false, false); }
void setLED_ap()      { setLED(false, false, true);  }
void setLED_action()  { setLED(false, true,  true);  }
void setLED_error()   { setLED(true,  false, true);  }
void setLED_pairing() { setLED(true,  true,  false); }

void blinkLED() {
  if (millis() - lastLedToggle < 500) return;
  lastLedToggle = millis();
  ledToggleState = !ledToggleState;

  switch (currentState) {
    case STATE_AP_ACTIVE:
      ledToggleState ? setLED_ap() : setLED_off();
      break;
    case STATE_POP_VERIFIED:
    case STATE_WIFI_CONNECTING:
    case STATE_SERVER_INQUIRY:
    case STATE_MQTT_CONNECTING:
      ledToggleState ? setLED_pairing() : setLED_off();
      break;
    case STATE_WIFI_RECONNECTING:
      ledToggleState ? setLED_offline() : setLED_off();
      break;
    case STATE_OTA_UPDATING:
      ledToggleState ? setLED_pairing() : setLED_ap();  // Blue+Yellow alternating = OTA
      break;
    case STATE_ERROR:
      ledToggleState ? setLED_error() : setLED_off();
      break;
    default:
      break;
  }
}


// ══════════════════════════════════════
//            NVS STORAGE
// ══════════════════════════════════════

// Load device identity (serial + secret) from NVS.
// Both are burned once during manufacturing via Serial provisioning and
// MUST remain unique per physical device — never hardcoded in firmware.
bool loadSecrets() {
  prefs.begin("secrets", true);
  serialNumber = prefs.getString("serial", "");
  deviceSecret = prefs.getString("secret", "");
  prefs.end();

  bool ok = (serialNumber.length() > 0 && deviceSecret.length() > 0);
  if (!ok) {
    Serial.println("[SECURITY] Device identity NOT fully provisioned!");
    Serial.printf("[SECURITY]   serial: %s\n", serialNumber.length() ? "OK" : "MISSING");
    Serial.printf("[SECURITY]   secret: %s\n", deviceSecret.length() ? "OK" : "MISSING");
    Serial.println("[SECURITY] Use serial provisioning to burn missing values.");
    return false;
  }
  Serial.println("[SECURITY] Device identity loaded from NVS");
  return true;
}

// Provision device identity via Serial (run once during manufacturing).
// Accepted forms (any combination of serial/secret, comma-separated):
//   PROVISION:serial=<SN-XXX>
//   PROVISION:secret=<hex32>
//   PROVISION:serial=<SN-XXX>,secret=<hex32>
// (PoP code is no longer used; any extra params are ignored.)
void checkSerialProvisioning() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();

  if (!line.startsWith("PROVISION:")) return;

  String params    = line.substring(10);
  String newSerial = "";
  String newSecret = "";

  while (params.length() > 0) {
    int comma = params.indexOf(',');
    String pair = (comma < 0) ? params : params.substring(0, comma);
    params      = (comma < 0) ? ""     : params.substring(comma + 1);
    pair.trim();

    if      (pair.startsWith("serial=")) newSerial = pair.substring(7);
    else if (pair.startsWith("secret=")) newSecret = pair.substring(7);
  }

  if (newSerial.length() == 0 && newSecret.length() == 0) {
    Serial.println("[PROVISION] Error: provide serial=<SN> and/or secret=<hex32>");
    return;
  }
  if (newSecret.length() > 0 && newSecret.length() < 32) {
    Serial.println("[PROVISION] Error: secret must be 32+ chars");
    return;
  }

  prefs.begin("secrets", false);
  if (newSerial.length() > 0) prefs.putString("serial", newSerial);
  if (newSecret.length() > 0) prefs.putString("secret", newSecret);
  prefs.remove("pop");  // clean up any legacy PoP value from older firmware
  prefs.end();

  if (newSerial.length() > 0) {
    serialNumber = newSerial;
    Serial.printf("[PROVISION] Serial burned to NVS: %s\n", serialNumber.c_str());
  }
  if (newSecret.length() > 0) {
    deviceSecret = newSecret;
    Serial.printf("[PROVISION] Secret burned to NVS: %s...%s\n",
                  newSecret.substring(0, 4).c_str(),
                  newSecret.substring(newSecret.length() - 4).c_str());
  }
}

bool loadSettings() {
  prefs.begin("config", true);
  storedSSID     = prefs.getString("ssid", "");
  storedPassword = prefs.getString("psw", "");
  mqttHost       = prefs.getString("mq_host", "");
  mqttUser       = prefs.getString("mq_user", "");
  mqttPass       = prefs.getString("mq_pass", "");
  mqttToken      = prefs.getString("mq_token", "");
  mqttPort       = prefs.getInt("mq_port", 8883);
  pairingUserId  = prefs.getString("userId", "");
  prefs.end();
  return (storedSSID.length() > 0 && mqttHost.length() > 0);
}

void saveWifiSettings(const String& ssid, const String& psw, const String& userId = "") {
  prefs.begin("config", false);
  prefs.putString("ssid", ssid);
  prefs.putString("psw", psw);
  if (userId.length() > 0) {
    prefs.putString("userId", userId);
  }
  prefs.end();
  storedSSID = ssid;
  storedPassword = psw;
  if (userId.length() > 0) {
    pairingUserId = userId;
  }
}

void saveMqttSettings(const String& host, int port, const String& user, const String& pass, const String& token) {
  prefs.begin("config", false);
  prefs.putString("mq_host", host);
  prefs.putInt("mq_port", port);
  prefs.putString("mq_user", user);
  prefs.putString("mq_pass", pass);
  prefs.putString("mq_token", token);
  prefs.end();
  mqttHost  = host;
  mqttPort  = port;
  mqttUser  = user;
  mqttPass  = pass;
  mqttToken = token;
}

void clearAllSettings() {
  prefs.begin("config", false);
  prefs.clear();
  prefs.end();
  storedSSID = "";
  storedPassword = "";
  mqttHost  = "";
  mqttPort  = 8883;
  mqttUser  = "";
  mqttPass  = "";
  mqttToken = "";
  pairingUserId = "";
  // Note: secrets (NVS "secrets" namespace) are NOT cleared - they survive factory reset
}


// ══════════════════════════════════════
//         DOOR SENSOR (SW-420)
// ══════════════════════════════════════

bool readDoorOpen() {
  return digitalRead(DOOR_SENSOR_PIN) == DOOR_OPEN_STATE;
}

void handleDoorSensor() {
  if (millis() - lastDoorCheckMs < DOOR_SENSOR_CHECK_MS) return;
  lastDoorCheckMs = millis();

  bool currentOpen = readDoorOpen();

  // أول قراءة - خذها مباشرة بدون debounce
  if (!doorStateInitialized) {
    lastDoorState = currentOpen;
    doorStateInitialized = true;
    doorDebounceCount = 0;
    doorDebouncePending = false;

    const char* state = currentOpen ? "open" : "closed";
    Serial.printf("[Door] Initial state: %s\n", state);
    return;
  }

  // Debounce: لازم القراءة تتغير وتثبت DOOR_DEBOUNCE_READS مرات متتالية
  if (currentOpen != lastDoorState) {
    // القراءة مختلفة عن الحالة الحالية
    if (!doorDebouncePending) {
      // بداية تغيّر محتمل
      doorDebouncePending = true;
      doorDebounceCount = 1;
    } else {
      doorDebounceCount++;
    }

    // وصلنا العدد المطلوب من القراءات المتتالية المتطابقة
    if (doorDebounceCount >= DOOR_DEBOUNCE_READS) {
      lastDoorState = currentOpen;
      doorDebouncePending = false;
      doorDebounceCount = 0;

      const char* state = currentOpen ? "open" : "closed";
      Serial.printf("[Door] State: %s (debounced)\n", state);

      char logMsg[40];
      snprintf(logMsg, sizeof(logMsg), "Door sensor: %s", state);
      addLog(logMsg, currentOpen ? "warning" : "info");

      // أرسل حالة الباب عبر MQTT (QoS 1 لضمان الوصول)
      if (mqttClient.connected()) {
        StaticJsonDocument<128> doc;
        doc["doorState"] = state;
        doc["ts"] = millis();
        String payload;
        serializeJson(doc, payload);
        mqttClient.publish(topicOf("dp/report").c_str(), payload.c_str(), false);
      }
    }
  } else {
    // القراءة رجعت للحالة الأصلية - ألغي الـ debounce
    doorDebouncePending = false;
    doorDebounceCount = 0;
  }
}


// ══════════════════════════════════════
//            RELAY (Pulse Only)
// ══════════════════════════════════════

void startRelayPulse() {
  // لو الريلاي شغال - تجاهل (حماية من الضغط المتكرر)
  if (relayActive) {
    Serial.println("[Relay] Already pulsing - ignored");
    addLog("Open command ignored - already pulsing", "warning");
    return;
  }

  digitalWrite(RELAY_PIN, HIGH);
  setLED_action();
  relayActive = true;
  relayStartTime = millis();
  Serial.println("[Relay] OPEN (2s pulse)");
  addLog("Relay OPENED (2s pulse)", "info");

  // أبلغ السيرفر إن الباب انفتح (QoS 1)
  if (mqttClient.connected()) {
    StaticJsonDocument<128> doc;
    doc["relay"] = "opened";
    doc["ts"]    = millis();
    String payload;
    serializeJson(doc, payload);
    mqttPublishReliable("dp/report", payload.c_str());
  }
}

void handleRelay() {
  if (relayActive && (millis() - relayStartTime >= RELAY_PULSE_MS)) {
    digitalWrite(RELAY_PIN, LOW);
    relayActive = false;
    Serial.println("[Relay] CLOSED (auto)");
    if (currentState == STATE_ONLINE) setLED_online();

    // أبلغ السيرفر إن الباب قفل (QoS 1)
    if (mqttClient.connected()) {
      StaticJsonDocument<128> doc;
      doc["relay"] = "closed";
      doc["ts"]    = millis();
      String payload;
      serializeJson(doc, payload);
      mqttPublishReliable("dp/report", payload.c_str());
    }
  }
}


// ══════════════════════════════════════
//            WIFI STA
// ══════════════════════════════════════

bool connectWiFi(const String& ssid, const String& psw, uint32_t timeoutMs = 12000) {
  Serial.printf("[WiFi] Connecting to: %s\n", ssid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), psw.c_str());

  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) {
    delay(100);
  }

  bool ok = (WiFi.status() == WL_CONNECTED);
  if (ok) {
    Serial.printf("[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    addLog("WiFi connected", "info");
  } else {
    Serial.println("[WiFi] Connection failed");
    addLog("WiFi connection failed", "error");
  }
  return ok;
}


// ══════════════════════════════════════
//      HELPER: Clean Broker URL
// ══════════════════════════════════════

String cleanBrokerHost(const String& url) {
  String clean = url;
  int idx = clean.indexOf("://");
  if (idx >= 0) {
    clean = clean.substring(idx + 3);
  }
  idx = clean.indexOf(':');
  if (idx >= 0) {
    clean = clean.substring(0, idx);
  }
  clean.trim();
  if (clean.endsWith("/")) {
    clean = clean.substring(0, clean.length() - 1);
  }
  return clean;
}

int extractPort(const String& url, int defaultPort = 8883) {
  String clean = url;
  int idx = clean.indexOf("://");
  if (idx >= 0) {
    clean = clean.substring(idx + 3);
  }
  idx = clean.indexOf(':');
  if (idx >= 0) {
    String portStr = clean.substring(idx + 1);
    int slashIdx = portStr.indexOf('/');
    if (slashIdx >= 0) portStr = portStr.substring(0, slashIdx);
    int port = portStr.toInt();
    if (port > 0 && port <= 65535) return port;
  }
  return defaultPort;
}


// ══════════════════════════════════════
//            SERVER INQUIRY
// ══════════════════════════════════════

// Return values: 0 = fail, 1 = success, 2 = device owned by someone else
#define INQUIRY_FAIL    0
#define INQUIRY_OK      1
#define INQUIRY_OWNED   2

int inquireServer() {
  if (WiFi.status() != WL_CONNECTED) return INQUIRY_FAIL;

  Serial.println("[Server] Sending inquiry...");
  HTTPClient http;

  String inquiryUrl = String(SERVER_BASE_URL) + SERVER_INQUIRY_PATH;
  bool isHttps = inquiryUrl.startsWith("https://");
  bool ok = isHttps ? http.begin(wifiSecureClient, inquiryUrl)
                    : http.begin(wifiPlainClient,  inquiryUrl);
  if (!ok) return INQUIRY_FAIL;

  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);

  StaticJsonDocument<384> doc;
  doc["serialNumber"] = serialNumber.c_str();
  doc["deviceSecret"] = deviceSecret;
  doc["macAddress"]   = WiFi.macAddress();
  if (pairingUserId.length() > 0) {
    doc["userId"] = pairingUserId;
  }

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  if (code == 200) {
    String resp = http.getString();
    Serial.printf("[Server] Response received (%d bytes)\n", resp.length());

    StaticJsonDocument<512> rDoc;
    if (!deserializeJson(rDoc, resp)) {
      // ──── تحقق من حالة الملكية ────
      // "none" = ما فيه مالك، "self" = نفس المالك، "other" = مالك آخر
      String ownershipStatus = rDoc["ownershipStatus"] | "none";

      String h = rDoc["brokerHost"] | "";
      int p    = rDoc["brokerPort"] | 0;

      if (h.length() == 0) {
        String rawUrl = rDoc["brokerUrl"] | "";
        h = cleanBrokerHost(rawUrl);
        if (p == 0) p = extractPort(rawUrl, 1883);
      }
      if (p == 0) p = 1883;

      String u  = rDoc["mqttUsername"] | "";
      String pw = rDoc["mqttPassword"] | "";
      String t  = rDoc["mqttToken"]    | "";

      if (h.length() > 0 && u.length() > 0) {
        saveMqttSettings(h, p, u, pw, t);
        Serial.printf("[Server] Inquiry OK -> broker: %s:%d\n", h.c_str(), p);
        http.end();

        if (ownershipStatus == "other") {
          Serial.println("[Server] Device is owned by another user!");
          return INQUIRY_OWNED;
        }
        if (ownershipStatus == "self") {
          Serial.println("[Server] Same owner re-pairing - allowed");
        }
        return INQUIRY_OK;
      } else {
        Serial.println("[Server] Inquiry response missing broker info");
      }
    } else {
      Serial.println("[Server] Failed to parse JSON response");
    }
  } else {
    Serial.printf("[Server] Inquiry failed: HTTP %d\n", code);
    if (code > 0) Serial.println(http.getString());
  }
  http.end();
  return INQUIRY_FAIL;
}


// ══════════════════════════════════════
//            MQTT
// ══════════════════════════════════════

String topicOf(const String& leaf) {
  return String("mnazilona/devices/") + serialNumber.c_str() + "/" + leaf;
}

void mqttPublishStatus(const char* st) {
  if (mqttClient.connected()) {
    mqttClient.publish(topicOf("status").c_str(), st, true);  // retained
  }
}

// Publish important messages with QoS 1 (at-least-once delivery)
bool mqttPublishReliable(const String& subtopic, const char* payload) {
  if (!mqttClient.connected()) return false;
  return mqttClient.publish(topicOf(subtopic).c_str(), (const uint8_t*)payload, strlen(payload), false);
}

void mqttPublishHeartbeat() {
  if (!mqttClient.connected()) return;
  StaticJsonDocument<256> doc;
  uint32_t epoch = getEpochTime();
  if (epoch > 0) {
    doc["ts"] = epoch;        // Real epoch time (NTP synced)
  } else {
    doc["ts"] = millis();     // Fallback to uptime millis
  }
  doc["rssi"]  = WiFi.RSSI();
  doc["fw"]    = FIRMWARE_VERSION;
  doc["heap"]  = ESP.getFreeHeap();
  doc["relay"] = relayActive ? "opened" : "closed";
  doc["doorState"] = lastDoorState ? "open" : "closed";
  doc["uptime"] = millis() / 1000;
  String payload;
  serializeJson(doc, payload);
  mqttClient.publish(topicOf("heartbeat").c_str(), payload.c_str());
}

// ══════════════════════════════════════
//       OTA PROGRESS REPORTING
// ══════════════════════════════════════

void otaReportProgress(const char* status, int progress = -1, const char* error = nullptr) {
  if (!mqttClient.connected()) return;
  StaticJsonDocument<256> doc;
  doc["status"] = status;
  doc["version"] = otaVersion;
  if (progress >= 0) doc["progress"] = progress;
  if (error) doc["error"] = error;
  doc["ts"] = millis();
  String payload;
  serializeJson(doc, payload);
  mqttPublishReliable("ota/progress", payload.c_str());
  mqttClient.loop(); // Ensure the message is sent
}

// ══════════════════════════════════════
//     OTA: VERSION COMPARISON (Semver)
// ══════════════════════════════════════

// Returns: -1 = a < b, 0 = equal, 1 = a > b
int compareSemver(const String& a, const String& b) {
  int aParts[3] = {0, 0, 0};
  int bParts[3] = {0, 0, 0};
  sscanf(a.c_str(), "%d.%d.%d", &aParts[0], &aParts[1], &aParts[2]);
  sscanf(b.c_str(), "%d.%d.%d", &bParts[0], &bParts[1], &bParts[2]);
  for (int i = 0; i < 3; i++) {
    if (aParts[i] > bParts[i]) return 1;
    if (aParts[i] < bParts[i]) return -1;
  }
  return 0;
}

// ══════════════════════════════════════
//     OTA: ROLLBACK VERIFICATION
// ══════════════════════════════════════

void confirmOtaFirmware() {
  if (!otaPendingVerify) return;
  esp_ota_mark_app_valid_cancel_rollback();
  otaPendingVerify = false;
  Serial.println("[OTA] ✓ Firmware CONFIRMED - connectivity proven, rollback cancelled");
  addLog("OTA firmware confirmed valid", "info");
}

void checkOtaRollbackTimeout() {
  if (!otaPendingVerify) return;
  if (millis() - otaBootTime > OTA_VERIFY_TIMEOUT) {
    Serial.println("[OTA] ✗ Verification TIMEOUT - rebooting for rollback!");
    addLog("OTA verify timeout - rolling back", "error");
    delay(500);
    ESP.restart(); // Bootloader will rollback to previous firmware
  }
}

// ══════════════════════════════════════
//     OTA: BOOT-TIME UPDATE CHECK
// ══════════════════════════════════════

void checkForOtaUpdate() {
  if (WiFi.status() != WL_CONNECTED || otaInProgress) return;

  Serial.println("[OTA] Checking for updates...");

  HTTPClient http;
  String checkUrl = String(SERVER_BASE_URL) + SERVER_OTA_CHECK_PATH;

  if (checkUrl.startsWith("https://")) {
    http.begin(wifiSecureClient, checkUrl);
  } else {
    http.begin(wifiPlainClient, checkUrl);
  }
  http.addHeader("X-Device-Serial", serialNumber.c_str());
  http.addHeader("X-Device-Secret", deviceSecret);
  http.addHeader("X-Firmware-Version", FIRMWARE_VERSION);
  http.setTimeout(10000);

  int code = http.GET();
  if (code == 200) {
    String resp = http.getString();
    StaticJsonDocument<512> doc;
    if (!deserializeJson(doc, resp)) {
      bool updateAvailable = doc["updateAvailable"] | false;
      if (updateAvailable) {
        String newVersion = doc["version"] | "";
        String downloadUrl = doc["downloadUrl"] | "";
        String checksum = doc["checksum"] | "";
        uint32_t fileSize = doc["fileSize"] | 0;

        // URL scheme validation. HTTPS always allowed; HTTP only when
        // ALLOW_INSECURE_OTA_HTTP is enabled (dev/local-network testing).
        bool isHttpsUrl = downloadUrl.startsWith("https://");
        bool isHttpUrl  = downloadUrl.startsWith("http://");
        Serial.printf("[OTA] Received OTA URL: %s\n", downloadUrl.c_str());
        Serial.printf("[OTA] Detected protocol: %s\n",
                      isHttpsUrl ? "HTTPS" : (isHttpUrl ? "HTTP" : "UNKNOWN"));
        Serial.printf("[OTA] HTTP OTA allowed by config: %s\n",
                      ALLOW_INSECURE_OTA_HTTP ? "YES (dev)" : "NO");

        if (downloadUrl.length() > 0 &&
            !isHttpsUrl &&
            !(isHttpUrl && ALLOW_INSECURE_OTA_HTTP)) {
          Serial.println("[OTA] Rejected: URL scheme not allowed (set ALLOW_INSECURE_OTA_HTTP=1 to permit http://)");
          addLog("OTA rejected: URL scheme not allowed", "warning");
          http.end();
          lastOtaCheckMs = millis();
          return;
        }

        // Verify it's actually newer (prevent downgrade)
        if (compareSemver(newVersion, FIRMWARE_VERSION) > 0) {
          Serial.printf("[OTA] Update available: v%s -> v%s\n", FIRMWARE_VERSION, newVersion.c_str());
          addLog("OTA update available on boot", "info");

          otaUrl = downloadUrl;
          otaVersion = newVersion;
          otaChecksum = checksum;
          otaFileSize = fileSize;
          // Iterative retry loop (no recursion)
          for (otaRetryCount = 0; otaRetryCount <= OTA_MAX_RETRIES; otaRetryCount++) {
            performOtaUpdate();
            if (!otaInProgress) break;  // Success (rebooted) or fatal error
            Serial.printf("[OTA] Retry %d/%d in 5 seconds...\n", otaRetryCount + 1, OTA_MAX_RETRIES);
            delay(5000);
          }
          if (otaRetryCount > OTA_MAX_RETRIES) {
            addLog("OTA failed: max retries exceeded", "error");
            otaInProgress = false;
            currentState = STATE_ONLINE;
          }
        } else {
          Serial.printf("[OTA] Server version v%s is not newer - skipping\n", newVersion.c_str());
        }
      } else {
        Serial.println("[OTA] No update available");
      }
    }
  } else {
    Serial.printf("[OTA] Check failed: HTTP %d\n", code);
  }
  http.end();
  lastOtaCheckMs = millis();
}

// ══════════════════════════════════════
//     OTA UPDATE (A/B Partition)
//     Uses ESP32 native Update library
//     with SHA256 verification + rollback
// ══════════════════════════════════════

void performOtaUpdate() {
  Serial.println("\n[OTA] ═══════════════════════════════");
  Serial.printf("[OTA] Starting update to v%s (attempt %d/%d)\n", otaVersion.c_str(), otaRetryCount + 1, OTA_MAX_RETRIES + 1);
  Serial.printf("[OTA] URL: %s\n", otaUrl.c_str());
  Serial.printf("[OTA] Expected size: %u bytes\n", otaFileSize);
  Serial.printf("[OTA] Expected checksum: %s\n", otaChecksum.c_str());
  Serial.printf("[OTA] Free heap: %u bytes\n", ESP.getFreeHeap());
  Serial.println("[OTA] ═══════════════════════════════\n");

  // Pre-flight checks
  if (ESP.getFreeHeap() < OTA_MIN_HEAP) {
    Serial.printf("[OTA] ABORTED: insufficient heap (%u < %d)\n", ESP.getFreeHeap(), OTA_MIN_HEAP);
    otaReportProgress("failed", 0, "Insufficient memory");
    addLog("OTA failed: low memory", "error");
    return;
  }

  // Disable relay during OTA for safety
  if (relayActive) {
    digitalWrite(RELAY_PIN, LOW);
    relayActive = false;
    Serial.println("[OTA] Relay forced closed for safety");
  }

  currentState = STATE_OTA_UPDATING;
  otaInProgress = true;
  addLog("OTA update started", "info");

  // Phase 1: Report downloading
  otaReportProgress("downloading", 0);

  // Phase 2: Download firmware
  // - HTTPS  -> wifiSecureClient (TLS)
  // - HTTP   -> wifiPlainClient (only when ALLOW_INSECURE_OTA_HTTP=1; the
  //   scheme has already been validated by the OTA command/check handler)
  bool otaUrlIsHttps = otaUrl.startsWith("https://");
  bool otaUrlIsHttp  = otaUrl.startsWith("http://");
  Serial.printf("[OTA] Detected protocol: %s\n",
                otaUrlIsHttps ? "HTTPS" : (otaUrlIsHttp ? "HTTP" : "UNKNOWN"));
  Serial.printf("[OTA] HTTP OTA allowed by config: %s\n",
                ALLOW_INSECURE_OTA_HTTP ? "YES (dev)" : "NO");

  // Quiesce MQTT for the duration of the download. PubSubClient and
  // HTTPClient must not be active on the same WiFiClient at the same
  // time, and MQTT keepalive activity during a multi-second download
  // tears the OTA TCP stream. We reconnect MQTT after the update path
  // completes (or naturally on reboot if the update succeeds).
  if (mqttClient.connected()) {
    Serial.println("[OTA] Disconnecting MQTT before download");
    mqttClient.disconnect();
  }

  HTTPClient http;
  http.setTimeout(30000); // 30s connection timeout
  bool beginOk = otaUrlIsHttps
                   ? http.begin(wifiSecureClient, otaUrl)
                   : http.begin(otaPlainClient,   otaUrl);
  if (!beginOk) {
    Serial.printf("[OTA] Failed to begin %s connection\n",
                  otaUrlIsHttps ? "HTTPS" : "HTTP");
    otaReportProgress("failed", 0,
                      otaUrlIsHttps ? "HTTPS connection failed" : "HTTP connection failed");
    addLog("OTA failed: connection begin", "error");
    otaInProgress = false;
    currentState = STATE_ONLINE;
    return;
  }
  Serial.printf("[OTA] OTA download started via %s\n",
                otaUrlIsHttps ? "HTTPS" : "HTTP");

  // Add device authentication headers
  http.addHeader("X-Device-Serial", serialNumber.c_str());
  http.addHeader("X-Device-Secret", deviceSecret);

  int httpCode = http.GET();
  if (httpCode != 200) {
    Serial.printf("[OTA] HTTP error: %d\n", httpCode);
    char errMsg[40];
    snprintf(errMsg, sizeof(errMsg), "HTTP error %d", httpCode);
    otaReportProgress("failed", 0, errMsg);
    addLog("OTA failed: HTTP download", "error");
    http.end();
    otaInProgress = false;
    currentState = STATE_ONLINE;
    return;
  }

  int contentLength = http.getSize();
  if (contentLength <= 0) {
    Serial.println("[OTA] Invalid content length");
    otaReportProgress("failed", 0, "Invalid content length");
    http.end();
    otaInProgress = false;
    currentState = STATE_ONLINE;
    return;
  }

  // Get checksum and RSA signature from server headers
  String serverChecksum = http.header("X-Firmware-Checksum");
  String firmwareSignature = http.header("X-Firmware-Signature");
  if (firmwareSignature.length() > 0) {
    Serial.println("[OTA] RSA signature received from server");
  }

  Serial.printf("[OTA] Downloading %d bytes...\n", contentLength);

  // Phase 3: Begin update on the other (inactive) partition
  if (!Update.begin(contentLength)) {
    Serial.printf("[OTA] Not enough space: %s\n", Update.errorString());
    otaReportProgress("failed", 0, "Not enough space");
    addLog("OTA failed: no space", "error");
    http.end();
    otaInProgress = false;
    currentState = STATE_ONLINE;
    return;
  }

  // Enable MD5 check if we have a checksum (Update library uses MD5 internally)
  // We'll also compute SHA256 manually for extra security

  WiFiClient* stream = http.getStreamPtr();
  uint8_t buf[1024];
  int totalRead = 0;
  int lastReportedPercent = -1;
  uint32_t downloadStartMs = millis();
  uint32_t lastDataMs = millis();   // Stall detection

  // SHA256 computation - using mbedtls directly
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 0);
  mbedtls_md_starts(&ctx);

  bool downloadFailed = false;
  String failReason = "";

  while (http.connected() && totalRead < contentLength) {
    // Total download timeout
    if (millis() - downloadStartMs > OTA_DOWNLOAD_TIMEOUT) {
      failReason = "Download timeout";
      downloadFailed = true;
      break;
    }

    int available = stream->available();
    if (available <= 0) {
      // Stall detection - no data for too long
      if (millis() - lastDataMs > OTA_STALL_TIMEOUT) {
        failReason = "Connection stalled";
        downloadFailed = true;
        break;
      }
      delay(10);
      continue;
    }

    lastDataMs = millis(); // Reset stall timer

    int readBytes = stream->readBytes(buf, min((int)sizeof(buf), available));
    if (readBytes <= 0) {
      failReason = "Read returned 0 bytes";
      downloadFailed = true;
      break;
    }

    // Write to OTA partition
    if (Update.write(buf, readBytes) != (size_t)readBytes) {
      Serial.printf("[OTA] Write failed: %s\n", Update.errorString());
      failReason = "Flash write failed";
      downloadFailed = true;
      break;
    }

    // Update SHA256
    mbedtls_md_update(&ctx, buf, readBytes);

    totalRead += readBytes;
    int percent = (totalRead * 100) / contentLength;

    // Report progress every 10% — Serial only. MQTT is intentionally
    // disconnected for the duration of the download (see top of
    // performOtaUpdate); otaReportProgress would be a no-op anyway, and
    // any MQTT activity here would corrupt the HTTP TCP stream.
    if (percent / 10 != lastReportedPercent / 10) {
      lastReportedPercent = percent;
      Serial.printf("[OTA] Progress: %d%% (%d/%d bytes)\n", percent, totalRead, contentLength);
    }

    // Feed the task watchdog and yield to IDLE.
    // yield() alone is insufficient: it only reschedules equal/higher
    // priority tasks, and the IDLE task (which feeds the WDT for
    // loopTask) never gets to run during a tight download loop. Update.write()
    // also performs synchronous flash sector erases that can exceed the
    // default 5s WDT window. delay(1) blocks loopTask for one tick so
    // IDLE runs; esp_task_wdt_reset() is belt-and-suspenders.
    esp_task_wdt_reset();
    delay(1);
  }

  http.end();

  // Check for incomplete download
  if (!downloadFailed && totalRead != contentLength) {
    failReason = "Incomplete download";
    downloadFailed = true;
  }

  if (downloadFailed) {
    Serial.printf("[OTA] Download failed: %s (%d/%d bytes)\n", failReason.c_str(), totalRead, contentLength);
    Update.abort();
    mbedtls_md_free(&ctx);

    // Retry handled by caller (iterative, not recursive)
    otaReportProgress("failed", totalRead * 100 / contentLength, failReason.c_str());
    addLog("OTA download failed", "error");
    otaInProgress = false;
    currentState = STATE_ONLINE;
    return;
  }

  // Phase 4: Verify SHA256 checksum
  otaReportProgress("verifying", 100);
  Serial.println("[OTA] Verifying SHA256 checksum...");

  unsigned char sha256[32];
  mbedtls_md_finish(&ctx, sha256);
  mbedtls_md_free(&ctx);

  // Convert to hex string
  char computedChecksum[65];
  for (int i = 0; i < 32; i++) {
    sprintf(&computedChecksum[i * 2], "%02x", sha256[i]);
  }
  computedChecksum[64] = '\0';

  Serial.printf("[OTA] Computed SHA256: %s\n", computedChecksum);
  Serial.printf("[OTA] Expected SHA256: %s\n", otaChecksum.c_str());

  if (otaChecksum.length() > 0 && String(computedChecksum) != otaChecksum) {
    Serial.println("[OTA] CHECKSUM MISMATCH! Aborting update.");
    otaReportProgress("failed", 100, "Checksum mismatch");
    addLog("OTA failed: checksum mismatch", "error");
    Update.abort();
    otaInProgress = false;
    currentState = STATE_ONLINE;
    return;
  }

  Serial.println("[OTA] Checksum verified OK!");

  // Phase 4b: Verify RSA-SHA256 signature (mandatory in production)
  if (firmwareSignature.length() > 0 && strlen(ota_public_key) > 60) {
    Serial.println("[OTA] Verifying RSA-SHA256 signature...");

    // Decode base64 signature
    size_t sigLen = 0;
    unsigned char sigBuf[512];
    int b64Ret = mbedtls_base64_decode(sigBuf, sizeof(sigBuf), &sigLen,
        (const unsigned char*)firmwareSignature.c_str(), firmwareSignature.length());

    if (b64Ret != 0) {
      Serial.println("[OTA] SIGNATURE DECODE FAILED!");
      otaReportProgress("failed", 100, "Signature decode failed");
      addLog("OTA failed: bad signature encoding", "error");
      Update.abort();
      otaInProgress = false;
      currentState = STATE_ONLINE;
      return;
    }

    // Verify with RSA public key using mbedtls
    mbedtls_pk_context pk;
    mbedtls_pk_init(&pk);

    int ret = mbedtls_pk_parse_public_key(&pk,
        (const unsigned char*)ota_public_key, strlen(ota_public_key) + 1);

    if (ret != 0) {
      Serial.printf("[OTA] Public key parse failed: -0x%04x\n", -ret);
      mbedtls_pk_free(&pk);
      otaReportProgress("failed", 100, "Public key error");
      Update.abort();
      otaInProgress = false;
      currentState = STATE_ONLINE;
      return;
    }

    ret = mbedtls_pk_verify(&pk, MBEDTLS_MD_SHA256, sha256, 32, sigBuf, sigLen);
    mbedtls_pk_free(&pk);

    if (ret != 0) {
      Serial.printf("[OTA] SIGNATURE VERIFICATION FAILED! (ret=-0x%04x)\n", -ret);
      otaReportProgress("failed", 100, "Signature verification failed");
      addLog("OTA REJECTED: invalid signature!", "error");
      Update.abort();
      otaInProgress = false;
      currentState = STATE_ONLINE;
      return;
    }

    Serial.println("[OTA] RSA signature verified OK!");
    addLog("OTA signature verified", "info");
  } else if (strlen(ota_public_key) > 60) {
    // Public key is configured but no signature received - reject in production
    Serial.println("[OTA] REJECTED: no signature provided but key is configured");
    otaReportProgress("failed", 100, "Signature required");
    addLog("OTA REJECTED: missing signature", "error");
    Update.abort();
    otaInProgress = false;
    currentState = STATE_ONLINE;
    return;
  } else {
    Serial.println("[OTA] Warning: signature verification skipped (no public key configured)");
  }

  // Phase 5: Finalize the update (write to OTA partition)
  otaReportProgress("installing", 100);
  Serial.println("[OTA] Finalizing update...");

  if (!Update.end(true)) {
    Serial.printf("[OTA] Finalize failed: %s\n", Update.errorString());
    otaReportProgress("failed", 100, Update.errorString());
    addLog("OTA failed: finalize error", "error");
    otaInProgress = false;
    currentState = STATE_ONLINE;
    return;
  }

  Serial.println("[OTA] Update installed successfully!");
  addLog("OTA update installed - rebooting", "info");

  // Save current version so we can report success after reboot
  prefs.begin("config", false);
  prefs.putString("prev_fw", FIRMWARE_VERSION);
  prefs.end();

  // Phase 6: Report success and reboot
  // The new firmware will run on next boot
  // ESP32 OTA marks the new partition as "pending verify"
  // On successful boot, we must call esp_ota_mark_app_valid_cancel_rollback()
  // If the new firmware crashes, the bootloader will rollback automatically
  otaReportProgress("rebooting", 100);

  // Give MQTT time to send the message
  mqttClient.loop();
  delay(1000);

  Serial.println("[OTA] Rebooting to new firmware...\n");
  ESP.restart();
}


// Verify MQTT command HMAC: hmac = HMAC-SHA256(mqttToken, command + ts)
bool verifyCommandHmac(const String& command, const String& ts, const String& hmac) {
  if (mqttToken.length() == 0) return true;  // No token = dev mode
  if (hmac.length() == 0 || ts.length() == 0) return false;

  String data = command + ts;
  unsigned char computed[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)mqttToken.c_str(), mqttToken.length());
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)data.c_str(), data.length());
  mbedtls_md_hmac_finish(&ctx, computed);
  mbedtls_md_free(&ctx);

  // Convert to hex
  char hexHmac[65];
  for (int i = 0; i < 32; i++) {
    sprintf(&hexHmac[i * 2], "%02x", computed[i]);
  }
  hexHmac[64] = '\0';

  // Constant-time comparison
  if (hmac.length() != 64) return false;
  volatile uint8_t result = 0;
  for (int i = 0; i < 64; i++) {
    result |= hexHmac[i] ^ hmac[i];
  }
  return (result == 0);
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  // Build string from payload (efficient single allocation)
  // Limit payload size to prevent memory issues
  if (length > 512) {
    Serial.printf("[MQTT] Payload too large (%u bytes) - ignored\n", length);
    return;
  }
  String msg((char*)payload, length);
  // Don't log full payload (may contain HMAC tokens)
  Serial.printf("[MQTT] %s (%u bytes)\n", topic, length);

  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, msg)) {
    Serial.println("[MQTT] Invalid JSON command");
    return;
  }

  String action = doc["command"] | "";
  String source = doc["source"] | "";
  String cmdHmac = doc["hmac"] | "";
  String cmdTs   = doc["ts"] | "";
  String requestId = doc["requestId"] | "";
  requestId.trim();

  if (isDuplicateCommandRequest(requestId)) {
    Serial.printf("[MQTT] Duplicate command ignored (requestId=%s)\n", requestId.c_str());
    return;
  }

  // Verify command authenticity via HMAC (skip for system commands from broker)
  if (mqttToken.length() > 0 && source != "system") {
    if (!verifyCommandHmac(action, cmdTs, cmdHmac)) {
      Serial.println("[MQTT] Command REJECTED - invalid HMAC signature");
      addLog("MQTT command rejected: bad HMAC", "warning");
      mqttPublishReliable("dp/report",
          "{\"error\":\"auth_failed\",\"message\":\"Invalid command signature\"}");
      return;
    }
  }

  // Rate limit: prevent command flooding
  if (!checkCommandRateLimit()) {
    mqttPublishReliable("dp/report",
      "{\"error\":\"rate_limited\",\"message\":\"Too many commands\"}");
    return;
  }

  // Check admin lock - block user commands but allow admin commands
  if (source != "admin") {
    prefs.begin("config", true);
    bool adminLocked = prefs.getBool("adminLocked", false);
    prefs.end();
    if (adminLocked && (action == "open" || action == "on" || action == "toggle" || action == "off")) {
      Serial.println("[MQTT] Command blocked - device is admin locked");
      mqttPublishReliable("dp/report",
        "{\"error\":\"admin_locked\",\"message\":\"Device is locked by admin\"}");
      return;
    }
  }

  // Block relay commands during OTA
  if (otaInProgress && (action == "open" || action == "on" || action == "toggle")) {
    Serial.println("[MQTT] Command blocked - OTA in progress");
    mqttPublishReliable("dp/report",
      "{\"error\":\"ota_in_progress\",\"message\":\"OTA update in progress\"}");
    return;
  }

  // ── open / on / toggle = نفس الشي: pulse ثانيتين ──
  if (action == "open" || action == "on" || action == "toggle") {
    startRelayPulse();
    rememberCommandRequest(requestId, "{\"status\":\"ok\",\"message\":\"Command executed\"}");
  }
  // ── status = أرسل حالة الجهاز ──
  else if (action == "status") {
    if (mqttClient.connected()) {
      StaticJsonDocument<192> rDoc;
      rDoc["relay"]     = relayActive ? "opened" : "closed";
      rDoc["doorState"] = lastDoorState ? "open" : "closed";
      rDoc["rssi"]      = WiFi.RSSI();
      rDoc["heap"]      = ESP.getFreeHeap();
      rDoc["fw"]        = FIRMWARE_VERSION;
      rDoc["uptime"]    = millis() / 1000;
      String rPayload;
      serializeJson(rDoc, rPayload);
      mqttPublishReliable("dp/report", rPayload.c_str());
      rememberCommandRequest(requestId, rPayload);
    }
  }
  // ── restart = إعادة تشغيل ──
  else if (action == "restart") {
    Serial.println("[MQTT] Restart command");
    mqttPublishStatus("restarting");
    rememberCommandRequest(requestId, "{\"status\":\"ok\",\"message\":\"Restarting\"}");
    delay(500);
    ESP.restart();
  }
  // ── paired = تأكيد الربط ──
  else if (action == "paired") {
    Serial.println("[MQTT] Device paired!");
    mqttPublishHeartbeat();
  }
  // ── unpaired = فك الربط وريستارت ──
  else if (action == "unpaired") {
    Serial.println("[MQTT] Unpaired - resetting");
    mqttPublishStatus("offline");
    clearAllSettings();
    delay(500);
    ESP.restart();
  }
  // ── factory_reset = ريسيت كامل من الأدمن (admin only) ──
  else if (action == "factory_reset") {
    if (source != "admin") {
      Serial.println("[MQTT] Factory reset DENIED - admin source required");
      addLog("Factory reset denied: not admin", "warning");
      return;
    }
    Serial.println("[MQTT] Factory reset by admin");
    addLog("Factory reset by admin command", "warning");
    mqttPublishStatus("offline");
    clearAllSettings();
    delay(500);
    ESP.restart();
  }
  // ── admin_lock = قفل/فتح إداري ──
  else if (action == "admin_lock") {
    bool locked = doc["locked"] | false;
    const char* reason = doc["reason"] | "admin";
    Serial.printf("[MQTT] Admin lock: %s (reason: %s)\n", locked ? "LOCKED" : "UNLOCKED", reason);
    // Store lock state - device will refuse user commands when locked
    prefs.begin("config", false);
    prefs.putBool("adminLocked", locked);
    prefs.end();
    // Report state (QoS 1)
    if (mqttClient.connected()) {
      StaticJsonDocument<128> rDoc;
      rDoc["adminLocked"] = locked;
      rDoc["reason"] = reason;
      String rPayload;
      serializeJson(rDoc, rPayload);
      mqttPublishReliable("dp/report", rPayload.c_str());
    }
  }
  // ── ota_update = تحديث الفيرموير عن بعد ──
  else if (action == "ota_update") {
    if (otaInProgress) {
      Serial.println("[MQTT] OTA already in progress - ignored");
      return;
    }
    otaUrl = doc["url"] | "";
    otaVersion = doc["version"] | "";
    otaChecksum = doc["checksum"] | "";
    otaFileSize = doc["fileSize"] | 0;

    if (otaUrl.length() == 0 || otaVersion.length() == 0) {
      Serial.println("[MQTT] OTA command missing url or version");
      otaReportProgress("failed", 0, "Missing url or version");
      return;
    }

    // URL scheme validation. HTTPS always allowed; HTTP only when
    // ALLOW_INSECURE_OTA_HTTP is enabled (dev/local-network testing).
    // Integrity is still enforced via SHA-256 checksum (and RSA signature
    // if ota_public_key is configured), so a tampered binary is rejected
    // before flashing even on plain HTTP.
    {
      bool isHttpsUrl = otaUrl.startsWith("https://");
      bool isHttpUrl  = otaUrl.startsWith("http://");
      Serial.printf("[MQTT] Received OTA URL: %s\n", otaUrl.c_str());
      Serial.printf("[MQTT] Detected protocol: %s\n",
                    isHttpsUrl ? "HTTPS" : (isHttpUrl ? "HTTP" : "UNKNOWN"));
      Serial.printf("[MQTT] HTTP OTA allowed by config: %s\n",
                    ALLOW_INSECURE_OTA_HTTP ? "YES (dev)" : "NO");

      if (!isHttpsUrl && !(isHttpUrl && ALLOW_INSECURE_OTA_HTTP)) {
        Serial.println("[MQTT] OTA REJECTED: URL scheme not allowed (set ALLOW_INSECURE_OTA_HTTP=1 to permit http://)");
        otaReportProgress("failed", 0, "URL scheme not allowed");
        addLog("OTA rejected: URL scheme not allowed", "warning");
        return;
      }
    }

    // Validate URL length (prevent buffer abuse)
    if (otaUrl.length() > 256) {
      Serial.println("[MQTT] OTA REJECTED: URL too long");
      otaReportProgress("failed", 0, "URL too long");
      return;
    }

    // Skip if already on this version
    if (otaVersion == FIRMWARE_VERSION) {
      Serial.printf("[MQTT] Already on version %s - skipping OTA\n", FIRMWARE_VERSION);
      otaReportProgress("success", 100);
      return;
    }

    // Downgrade protection - only update to newer versions
    if (compareSemver(otaVersion, FIRMWARE_VERSION) < 0) {
      Serial.printf("[MQTT] Rejecting downgrade: v%s < v%s\n", otaVersion.c_str(), FIRMWARE_VERSION);
      otaReportProgress("failed", 0, "Downgrade not allowed");
      addLog("OTA rejected: downgrade attempt", "warning");
      return;
    }

    // Checksum is mandatory for production
    if (otaChecksum.length() == 0) {
      Serial.println("[MQTT] OTA rejected: no checksum provided");
      otaReportProgress("failed", 0, "Checksum required");
      return;
    }

    Serial.printf("[MQTT] OTA update requested: v%s -> v%s\n", FIRMWARE_VERSION, otaVersion.c_str());
    addLog("OTA update command received", "info");

    // Iterative retry loop (no recursion - prevents stack overflow)
    for (otaRetryCount = 0; otaRetryCount <= OTA_MAX_RETRIES; otaRetryCount++) {
      performOtaUpdate();
      if (!otaInProgress) break;  // Success (rebooted) or fatal error
      Serial.printf("[OTA] Retry %d/%d in 5 seconds...\n", otaRetryCount + 1, OTA_MAX_RETRIES);
      delay(5000);
    }
    if (otaRetryCount > OTA_MAX_RETRIES) {
      otaReportProgress("failed", 0, "Max retries exceeded");
      addLog("OTA failed: max retries exceeded", "error");
      otaInProgress = false;
      currentState = STATE_ONLINE;
    }
  }
  // ── disconnect = فصل بأمر من الأدمن (حظر) ──
  else if (action == "disconnect") {
    const char* reason = doc["reason"] | "admin";
    Serial.printf("[MQTT] Disconnect command (reason: %s)\n", reason);
    mqttPublishStatus("offline");
    mqttClient.disconnect();
    // Don't clear settings - device can reconnect if unbanned
  }
  else {
    Serial.printf("[MQTT] Unknown command: %s\n", action.c_str());
  }
}

bool connectMQTT() {
  if (mqttHost.length() == 0 || mqttUser.length() == 0) return false;

  // Pick TCP transport based on port: 1883 = plain MQTT (dev/local),
  // anything else = TLS. PubSubClient::setClient lets us swap at runtime.
  bool useTls = (mqttPort != 1883);
  if (useTls) {
    mqttClient.setClient(wifiSecureClient);
  } else {
    mqttClient.setClient(wifiPlainClient);
  }

  mqttClient.setServer(mqttHost.c_str(), mqttPort);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(1024);

  String cid = String(serialNumber.c_str()) + "-" + String(random(0xFFFF), HEX);
  Serial.printf("[MQTT] Connecting to %s:%d (%s)...\n",
                mqttHost.c_str(), mqttPort, useTls ? "TLS" : "plain");

  if (mqttClient.connect(cid.c_str(), mqttUser.c_str(), mqttPass.c_str(),
                          topicOf("status").c_str(), 1, true, "offline")) {
    mqttClient.subscribe(topicOf("command").c_str(), 1);
    mqttPublishStatus("online");
    mqttPublishHeartbeat();
    mqttReconnectCount = 0;
    Serial.println("[MQTT] Connected!");
    addLog("MQTT connected to broker", "info");

    // ── DEFERRED OTA VERIFICATION ──
    // WiFi + MQTT are working → firmware is functional → confirm it
    if (otaPendingVerify) {
      confirmOtaFirmware();
    }

    // ── OTA SUCCESS REPORTING ──
    // If prev_fw exists, this boot followed an OTA update
    prefs.begin("config", true);
    String prevFw = prefs.getString("prev_fw", "");
    prefs.end();
    if (prevFw.length() > 0 && prevFw != FIRMWARE_VERSION) {
      Serial.printf("[OTA] Successfully updated from v%s to v%s\n", prevFw.c_str(), FIRMWARE_VERSION);
      StaticJsonDocument<256> otaDoc;
      otaDoc["status"] = "success";
      otaDoc["version"] = FIRMWARE_VERSION;
      otaDoc["previousVersion"] = prevFw;
      otaDoc["progress"] = 100;
      otaDoc["ts"] = millis();
      otaDoc["heap"] = ESP.getFreeHeap();
      otaDoc["rssi"] = WiFi.RSSI();
      String otaPayload;
      serializeJson(otaDoc, otaPayload);

      // Retry publish up to 3 times to ensure dashboard gets the success report
      bool published = false;
      for (int i = 0; i < 3 && !published; i++) {
        published = mqttClient.publish(topicOf("ota/progress").c_str(), otaPayload.c_str());
        if (!published) { delay(500); mqttClient.loop(); }
      }

      if (published) {
        // Clear previous version marker only after successful publish
        prefs.begin("config", false);
        prefs.remove("prev_fw");
        prefs.end();
        addLog("OTA update success confirmed", "info");
      } else {
        Serial.println("[OTA] Warning: failed to publish success - will retry next reconnect");
        addLog("OTA success publish failed - will retry", "warning");
      }
    }

    return true;
  }

  mqttReconnectCount++;
  Serial.printf("[MQTT] Failed, rc=%d (attempt %d/%d)\n",
                mqttClient.state(), mqttReconnectCount, MQTT_MAX_RECONNECTS);
  addLog("MQTT connection failed", "error");

  if (mqttReconnectCount >= MQTT_MAX_RECONNECTS) {
    Serial.println("[MQTT] Too many failures - re-doing server inquiry");
    mqttReconnectCount = 0;
    int inqResult = inquireServer();
    if (inqResult == INQUIRY_OWNED) {
      Serial.println("[MQTT] Device owned by another user - entering error state");
      currentState = STATE_ERROR;
      return false;
    }
    if (inqResult == INQUIRY_OK) {
      mqttClient.setServer(mqttHost.c_str(), mqttPort);
      String newCid = String(serialNumber.c_str()) + "-" + String(random(0xFFFF), HEX);
      if (mqttClient.connect(newCid.c_str(), mqttUser.c_str(), mqttPass.c_str(),
                              topicOf("status").c_str(), 1, true, "offline")) {
        mqttClient.subscribe(topicOf("command").c_str(), 1);
        mqttPublishStatus("online");
        mqttPublishHeartbeat();
        Serial.println("[MQTT] Connected after re-inquiry!");
        return true;
      }
    }
  }

  return false;
}


// ══════════════════════════════════════
//    LOCAL API SERVER (mDNS + HTTP)
//    يشتغل وقت الجهاز أونلاين عشان
//    التطبيق يقدر يتحكم بدون كلاود
// ══════════════════════════════════════

// Local API gate (no Bearer token required).
// Trust boundary = local Wi-Fi. The local HTTP server only listens on the
// LAN interface and only on a configured device. "Configured" means the
// device has already passed /devices/inquiry — at that point the cloud
// allowlist accepted it and issued MQTT credentials. We use mqttUser as
// the marker because pairingUserId is only set when the BLE provisioning
// payload happens to include `userId` (older app builds may not send it).
bool verifyLocalAuth() {
  if (mqttUser.length() == 0) {
    localServer.send(403, "application/json",
        "{\"status\":\"error\",\"message\":\"Device is not provisioned\"}");
    Serial.println("[LocalAPI] Rejected - device not provisioned");
    return false;
  }
  return true;
}

void startLocalServer() {
  if (localServerRunning) return;

  // mDNS: broadcast as "mnazilona-SN-001.local"
  String hostname = "mnazilona-" + String(serialNumber.c_str());
  hostname.toLowerCase();
  hostname.replace(" ", "-");

  if (MDNS.begin(hostname.c_str())) {
    MDNS.addService("mnazilona", "tcp", 8080);
    MDNS.addServiceTxt("mnazilona", "tcp", "serial", serialNumber.c_str());
    MDNS.addServiceTxt("mnazilona", "tcp", "sn", serialNumber.c_str());
    MDNS.addServiceTxt("mnazilona", "tcp", "type", "relay");
    MDNS.addServiceTxt("mnazilona", "tcp", "fw", FIRMWARE_VERSION);
    Serial.printf("[mDNS] Broadcasting: %s.local:8080\n", hostname.c_str());
  } else {
    Serial.println("[mDNS] Failed to start");
  }

  // Local command endpoint (paired devices only + rate limited)
  localServer.on("/command", HTTP_POST, []() {
    if (!verifyLocalAuth()) return;
    if (!checkCommandRateLimit()) {
      localServer.send(429, "application/json", "{\"status\":\"error\",\"message\":\"Too many requests\"}");
      return;
    }

    if (!localServer.hasArg("plain")) {
      localServer.send(400, "application/json", "{\"status\":\"error\",\"message\":\"No body\"}");
      return;
    }
    // Reject oversized payloads
    if (localServer.arg("plain").length() > 256) {
      localServer.send(413, "application/json", "{\"status\":\"error\",\"message\":\"Payload too large\"}");
      return;
    }

    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, localServer.arg("plain"))) {
      localServer.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Invalid JSON\"}");
      return;
    }

    String action = doc["command"] | "";
    action.trim();
    action.toLowerCase();
    String requestId = doc["requestId"] | "";
    requestId.trim();

    if (isDuplicateCommandRequest(requestId)) {
      String duplicateResponse = lastCommandResponse.length() > 0
        ? lastCommandResponse
        : "{\"status\":\"ok\",\"message\":\"Duplicate command ignored\"}";
      localServer.send(200, "application/json", duplicateResponse);
      Serial.printf("[LocalAPI] Duplicate command ignored (requestId=%s)\n", requestId.c_str());
      return;
    }

    if (action == "open" || action == "on" || action == "toggle") {
      if (otaInProgress) {
        localServer.send(503, "application/json", "{\"status\":\"error\",\"message\":\"OTA update in progress\"}");
        Serial.println("[LocalAPI] Command blocked - OTA in progress");
        return;
      }
      prefs.begin("config", true);
      bool adminLocked = prefs.getBool("adminLocked", false);
      prefs.end();
      if (adminLocked) {
        localServer.send(403, "application/json", "{\"status\":\"error\",\"message\":\"Device is locked by admin\"}");
        Serial.println("[LocalAPI] Command blocked - admin locked");
        return;
      }
      startRelayPulse();
      addLog("Local API: open command executed", "info");
      String response = "{\"status\":\"ok\",\"message\":\"Command executed locally\"}";
      rememberCommandRequest(requestId, response);
      localServer.send(200, "application/json", response);
      Serial.println("[LocalAPI] Command: open (local, authenticated)");
    }
    else if (action == "restart") {
      addLog("Local API: restart command", "warning");
      String response = "{\"status\":\"ok\",\"message\":\"Restarting...\"}";
      rememberCommandRequest(requestId, response);
      localServer.send(200, "application/json", response);
      delay(500);
      ESP.restart();
    }
    else if (action == "status") {
      prefs.begin("config", true);
      bool isLocked = prefs.getBool("adminLocked", false);
      prefs.end();
      StaticJsonDocument<256> rDoc;
      rDoc["relay"]       = relayActive ? "opened" : "closed";
      rDoc["doorState"]   = lastDoorState ? "open" : "closed";
      rDoc["rssi"]        = WiFi.RSSI();
      rDoc["fw"]          = FIRMWARE_VERSION;
      rDoc["local"]       = true;
      rDoc["adminLocked"] = isLocked;
      String response;
      serializeJson(rDoc, response);
      rememberCommandRequest(requestId, response);
      localServer.send(200, "application/json", response);
    }
    else {
      localServer.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Unknown command\"}");
    }
  });

  // Local status endpoint (authenticated)
  localServer.on("/status", HTTP_GET, []() {
    if (!verifyLocalAuth()) return;

    StaticJsonDocument<384> doc;
    doc["serial"]    = serialNumber.c_str();
    doc["name"]      = DEVICE_NAME;
    doc["type"]      = "relay";
    doc["fw"]        = FIRMWARE_VERSION;
    doc["relay"]     = relayActive ? "opened" : "closed";
    doc["doorState"] = lastDoorState ? "open" : "closed";
    doc["isOnline"]  = true;
    doc["rssi"]      = WiFi.RSSI();
    doc["heap"]      = ESP.getFreeHeap();
    doc["uptime"]    = millis() / 1000;
    doc["ip"]        = WiFi.localIP().toString();
    doc["local"]     = true;
    doc["mqttConnected"] = mqttClient.connected();
    String response;
    serializeJson(doc, response);
    localServer.send(200, "application/json", response);
  });

  // Local logs endpoint (paired devices only)
  localServer.on("/logs", HTTP_GET, []() {
    if (!verifyLocalAuth()) return;

    // Build JSON array of logs (newest first).
    // Each entry contains:
    //   - epoch:    real unix seconds when NTP was synced, else 0
    //   - uptimeMs: device millis() at the time of the event (always present)
    //   - timestamp: kept as legacy alias of uptimeMs for older app builds
    // The response also includes deviceUptimeMs / deviceEpoch so the app
    // can convert millis() entries to wall-clock when epoch is 0.
    DynamicJsonDocument doc(6144);
    doc["count"]          = logCount;
    doc["local"]          = true;
    doc["deviceUptimeMs"] = millis();
    doc["deviceEpoch"]    = ntpSynced ? (uint32_t)time(nullptr) : 0;
    JsonArray logsArr     = doc.createNestedArray("logs");

    for (int i = 0; i < logCount; i++) {
      int idx = (logHead - 1 - i + MAX_LOCAL_LOGS) % MAX_LOCAL_LOGS;
      JsonObject entry  = logsArr.createNestedObject();
      entry["epoch"]     = localLogs[idx].epoch;
      entry["uptimeMs"]  = localLogs[idx].uptimeMs;
      entry["timestamp"] = localLogs[idx].uptimeMs;  // legacy field
      entry["message"]   = localLogs[idx].message;
      entry["type"]      = localLogs[idx].type;
    }

    String response;
    serializeJson(doc, response);
    localServer.send(200, "application/json", response);
  });

  // CORS: app talks to a different origin (mDNS host); allow native + web clients.
  // The local server is LAN-only and gated on pairing — there is nothing to
  // protect with a strict CORS policy here.
  auto handleLocalCORS = []() {
    localServer.sendHeader("Access-Control-Allow-Origin", "*");
    localServer.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    localServer.sendHeader("Access-Control-Allow-Headers", "Content-Type");
    localServer.send(204);
  };
  localServer.on("/command", HTTP_OPTIONS, handleLocalCORS);
  localServer.on("/status",  HTTP_OPTIONS, handleLocalCORS);
  localServer.on("/logs",    HTTP_OPTIONS, handleLocalCORS);

  localServer.begin();
  localServerRunning = true;
  Serial.println("[LocalAPI] Server started on port 8080 (auth required)");
}

void stopLocalServer() {
  if (!localServerRunning) return;
  localServer.stop();
  MDNS.end();
  localServerRunning = false;
  Serial.println("[LocalAPI] Server stopped");
}


// ══════════════════════════════════════
//      BLE PROVISIONING ENDPOINTS
//  (replaces SoftAP HTTP provisioning)
// ══════════════════════════════════════

// Helper: send a JSON string via BLE notify (handles chunking for large payloads)
void bleNotify(BLECharacteristic* characteristic, const String& json) {
  // BLE MTU is negotiated (typically 512 after negotiation, 20 default)
  // We chunk to 500 bytes to be safe
  const int CHUNK_SIZE = 500;
  int len = json.length();

  if (len <= CHUNK_SIZE) {
    characteristic->setValue(json.c_str());
    characteristic->notify();
    return;
  }

  // Chunked: prefix each chunk with "C<index>:" and last with "E<index>:"
  int totalChunks = (len + CHUNK_SIZE - 1) / CHUNK_SIZE;
  for (int i = 0; i < totalChunks; i++) {
    String prefix = (i == totalChunks - 1) ? "E" : "C";
    prefix += String(i) + ":";
    int start = i * CHUNK_SIZE;
    int chunkLen = min(CHUNK_SIZE, len - start);
    String chunk = prefix + json.substring(start, start + chunkLen);
    characteristic->setValue(chunk.c_str());
    characteristic->notify();
    delay(20);  // BLE needs time between notifications
  }
}

// ── BLE Callbacks ──

class BLEProvisioningServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    bleClientConnected = true;
    bleLastActivity = millis();
    Serial.println("[BLE] Client connected");
    addLog("BLE client connected", "info");
  }

  void onDisconnect(BLEServer* pServer) override {
    bleClientConnected = false;
    Serial.println("[BLE] Client disconnected");
    addLog("BLE client disconnected", "info");
    // Re-advertise if still in provisioning mode
    if (bleProvisioning && currentState == STATE_AP_ACTIVE) {
      delay(500);
      pServer->startAdvertising();
      Serial.println("[BLE] Re-advertising...");
    }
  }
};

// ── PoP Verify Callback (no-op compatibility shim) ──
// PoP has been removed from the protocol. We keep this characteristic so
// older apps can still complete the BLE handshake — any write returns
// {"status":"ok"} and hands the deviceSecret to the app for backend pairing.
class PopVerifyCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) override {
    bleLastActivity = millis();
    StaticJsonDocument<256> rDoc;
    rDoc["status"]       = "ok";
    rDoc["message"]      = "Verified";
    rDoc["deviceSecret"] = deviceSecret;
    String response;
    serializeJson(rDoc, response);
    bleNotify(bleCharPopVerify, response);
    currentState = STATE_POP_VERIFIED;  // legacy state name; means "ready for WiFi config"
    Serial.println("[BLE] Verified (PoP removed - auto-ack)");
  }
};

// ── WiFi Scan Callback ──
// App writes {"action":"scan"} → device scans → notifies with results
class WiFiScanCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) override {
    bleLastActivity = millis();
    String value = pCharacteristic->getValue().c_str();

    StaticJsonDocument<64> doc;
    if (deserializeJson(doc, value)) {
      bleNotify(bleCharWifiScan, "{\"status\":\"error\",\"message\":\"Invalid JSON\"}");
      return;
    }

    String action = doc["action"] | "";
    if (action != "scan") {
      bleNotify(bleCharWifiScan, "{\"status\":\"error\",\"message\":\"Unknown action\"}");
      return;
    }

    Serial.println("[BLE] WiFi scan requested...");
    bleNotify(bleCharWifiScan, "{\"status\":\"scanning\"}");

    // Perform WiFi scan (ESP32-C6 is 2.4GHz only — all results are 2.4GHz)
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    delay(100);

    int n = WiFi.scanNetworks(false, false);  // sync scan, no hidden networks
    Serial.printf("[BLE] Scan found %d networks\n", n);

    // Build JSON response with networks sorted by RSSI (strongest first)
    // WiFi.scanNetworks already returns sorted by RSSI on ESP32
    DynamicJsonDocument rDoc(4096);
    rDoc["status"] = "ok";
    rDoc["count"]  = n;
    JsonArray networks = rDoc.createNestedArray("networks");

    // Limit to 20 strongest networks (BLE transfer size constraint)
    int limit = min(n, 20);
    for (int i = 0; i < limit; i++) {
      JsonObject net = networks.createNestedObject();
      net["ssid"] = WiFi.SSID(i);
      net["rssi"] = WiFi.RSSI(i);
      // Auth type: 0=open, others=secured
      net["secure"] = (WiFi.encryptionType(i) != WIFI_AUTH_OPEN);
    }

    WiFi.scanDelete();
    WiFi.mode(WIFI_MODE_NULL);  // Release WiFi radio back

    String response;
    serializeJson(rDoc, response);
    bleNotify(bleCharWifiScan, response);
    Serial.printf("[BLE] Scan results sent (%d bytes)\n", response.length());
  }
};

// ── WiFi Config Callback ──
// App writes {"ssid":"X","password":"Y"} → device connects → notifies result
class WiFiConfigCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) override {
    bleLastActivity = millis();
    String value = pCharacteristic->getValue().c_str();

    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, value)) {
      bleNotify(bleCharWifiConfig, "{\"status\":\"error\",\"message\":\"Invalid JSON\"}");
      return;
    }

    String ssid = doc["ssid"] | "";
    String pass = doc["password"] | "";
    pairingUserId = doc["userId"] | "";

    if (ssid.length() == 0) {
      bleNotify(bleCharWifiConfig, "{\"status\":\"error\",\"message\":\"SSID required\"}");
      return;
    }
    if (ssid.length() > 32) {
      bleNotify(bleCharWifiConfig, "{\"status\":\"error\",\"message\":\"SSID too long (max 32)\"}");
      return;
    }
    if (pass.length() > 63) {
      bleNotify(bleCharWifiConfig, "{\"status\":\"error\",\"message\":\"Password too long (max 63)\"}");
      return;
    }

    Serial.printf("[BLE] WiFi config received: %s\n", ssid.c_str());
    bleNotify(bleCharWifiConfig, "{\"status\":\"connecting\"}");
    saveWifiSettings(ssid, pass, pairingUserId);

    // Connect to WiFi (STA mode — BLE stays active during this)
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid.c_str(), pass.c_str());

    uint32_t wifiStart = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 12000) {
      delay(100);
    }

    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("[BLE] WiFi connected! IP: %s\n", WiFi.localIP().toString().c_str());

      StaticJsonDocument<128> rDoc;
      rDoc["status"]       = "ok";
      rDoc["message"]      = "Connected to WiFi!";
      rDoc["serialNumber"] = serialNumber.c_str();
      String response;
      serializeJson(rDoc, response);
      bleNotify(bleCharWifiConfig, response);

      // Defer stopBLE/inquireServer/connectMQTT to main loop.
      // Running them here (NimBLE host task) deadlocks NimBLE on ESP32-C6.
      currentState        = STATE_SERVER_INQUIRY;
      wifiProvisionedAt   = millis();
      wifiProvisionedFlag = true;
      return;
    } else {
      Serial.println("[BLE] WiFi FAILED - notifying app");
      WiFi.disconnect();
      WiFi.mode(WIFI_MODE_NULL);

      StaticJsonDocument<128> rDoc;
      rDoc["status"]  = "wifi_error";
      rDoc["message"] = "WiFi connection failed. Check your network name and password.";
      String response;
      serializeJson(rDoc, response);
      bleNotify(bleCharWifiConfig, response);

      // Stay in provisioning mode — user can retry
      currentState = STATE_AP_ACTIVE;
      bleLastActivity = millis();
    }
  }
};


// ══════════════════════════════════════
//      BLE PROVISIONING START / STOP
//  (replaces startAP / stopAP)
// ══════════════════════════════════════

void startBLE() {
  Serial.println("[BLE] Starting BLE provisioning...");

  // BLE device name: MNZ_SN-001 (short for advertising)
  String bleName = String(BLE_ADV_NAME_PREFIX) + String(serialNumber.c_str());

  BLEDevice::init(bleName.c_str());
  // Request max MTU for larger JSON payloads
  BLEDevice::setMTU(517);

  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new BLEProvisioningServerCallbacks());

  // Create provisioning service
  // 5 characteristics + 4 BLE2902 descriptors = need ~30 handles
  BLEService* service = bleServer->createService(BLEUUID(BLE_SERVICE_UUID), 30);

  // ── DeviceInfo (Read) ──
  bleCharDeviceInfo = service->createCharacteristic(
    BLE_CHAR_DEVICE_INFO,
    BLECharacteristic::PROPERTY_READ
  );
  // Set device info JSON as static value
  StaticJsonDocument<256> infoDoc;
  infoDoc["serial"]      = serialNumber.c_str();
  infoDoc["name"]        = DEVICE_NAME;
  infoDoc["type"]        = "relay";
  infoDoc["fw"]          = FIRMWARE_VERSION;
  infoDoc["popRequired"] = false;  // PoP removed; field kept for app compat
  String infoJson;
  serializeJson(infoDoc, infoJson);
  bleCharDeviceInfo->setValue(infoJson.c_str());

  // ── PoP Verify (Write + Notify) ──
  bleCharPopVerify = service->createCharacteristic(
    BLE_CHAR_POP_VERIFY,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_NOTIFY
  );
  bleCharPopVerify->addDescriptor(new BLE2902());
  bleCharPopVerify->setCallbacks(new PopVerifyCallback());

  // ── WiFi Scan (Write + Notify) ──
  bleCharWifiScan = service->createCharacteristic(
    BLE_CHAR_WIFI_SCAN,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_NOTIFY
  );
  bleCharWifiScan->addDescriptor(new BLE2902());
  bleCharWifiScan->setCallbacks(new WiFiScanCallback());

  // ── WiFi Config (Write + Notify) ──
  bleCharWifiConfig = service->createCharacteristic(
    BLE_CHAR_WIFI_CONFIG,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_NOTIFY
  );
  bleCharWifiConfig->addDescriptor(new BLE2902());
  bleCharWifiConfig->setCallbacks(new WiFiConfigCallback());

  // ── Status (Read + Notify) ──
  bleCharStatus = service->createCharacteristic(
    BLE_CHAR_STATUS,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  bleCharStatus->addDescriptor(new BLE2902());
  bleCharStatus->setValue("{\"state\":1,\"message\":\"Waiting for verification\"}");

  // Start service and advertising
  service->start();

  BLEAdvertising* advertising = BLEDevice::getAdvertising();

  // Explicitly split advertising data between adv packet and scan response.
  // A 128-bit UUID (18 bytes) + flags (3 bytes) = 21 bytes, leaving only
  // 10 bytes in the 31-byte adv packet — not enough for "MNZ_SN-001" (12 bytes).
  // Solution: put UUID in the adv packet, device name in scan response.
  BLEAdvertisementData advData;
  advData.setFlags(ESP_BLE_ADV_FLAG_GEN_DISC | ESP_BLE_ADV_FLAG_BREDR_NOT_SPT);
  advData.setCompleteServices(BLEUUID(BLE_SERVICE_UUID));

  BLEAdvertisementData scanResponseData;
  scanResponseData.setName(bleName.c_str());

  advertising->setAdvertisementData(advData);
  advertising->setScanResponseData(scanResponseData);
  // Connection interval hints for iOS compatibility
  advertising->setMinPreferred(0x06);  // 7.5ms min
  advertising->setMaxPreferred(0x12);  // 22.5ms max
  BLEDevice::startAdvertising();

  bleProvisioning   = true;
  bleStartTime      = millis();
  bleLastActivity   = millis();
  currentState      = STATE_AP_ACTIVE;  // Reuse same state (means "awaiting provisioning")
  Serial.printf("[BLE] Advertising as: %s\n", bleName.c_str());
  Serial.println("[BLE] Provisioning service ready");
}

void stopBLE() {
  if (!bleProvisioning) return;
  bleProvisioning = false;

  BLEDevice::getAdvertising()->stop();

  // Server-initiated disconnect for any still-connected peers, otherwise
  // NimBLE's internal cleanup races with deinit and prints rc=514 on ESP32-C6.
  if (bleClientConnected && bleServer != nullptr) {
    auto peers = bleServer->getPeerDevices(true);
    for (auto& p : peers) {
      bleServer->disconnect(p.first);
    }
    uint32_t waitStart = millis();
    while (bleClientConnected && millis() - waitStart < 1500) {
      delay(50);
    }
  }
  bleClientConnected = false;

  // Let NimBLE host task finish processing the disconnect HCI events
  delay(300);

  // Deinit frees all BLE memory (~70KB) back to heap
  BLEDevice::deinit(true);
  bleServer = nullptr;
  Serial.println("[BLE] Provisioning stopped, memory freed");
}

// Legacy aliases — kept so the rest of the firmware compiles unchanged
void startAP() { startBLE(); }
void stopAP()  { stopBLE();  }


// ══════════════════════════════════════
//            BUTTON
// ──────────────────────────────────────
//   2s hold  → reboot
//   5s hold  → factory reset (returns to BLE pairing mode)
//
// The action fires on release, so a 5s factory reset never accidentally
// triggers the 2s reboot first. The press is tracked across loop()
// iterations (no blocking while-loop) so the watchdog stays fed.
// ══════════════════════════════════════

#define BUTTON_DEBOUNCE_MS    50UL
#define BUTTON_REBOOT_MS      2000UL
#define BUTTON_RESET_MS       5000UL

static bool     buttonHeld         = false;
static uint32_t buttonPressStartMs = 0;
static uint32_t buttonLastEdgeMs   = 0;
static uint8_t  buttonLedPhase     = 0;   // 0 = idle, 1 = >=2s feedback, 2 = >=5s feedback

static void doFactoryReset() {
  Serial.println("[Button] >>> FACTORY RESET (5s) — clearing config and restarting");
  addLog("Factory reset (button 5s)", "warning");

  setLED(true, true, true);  // solid white = factory reset
  stopLocalServer();
  if (mqttClient.connected()) {
    mqttPublishStatus("offline");
    mqttClient.disconnect();
  }
  clearAllSettings();         // wipes WiFi + MQTT credentials, keeps deviceSecret
  delay(300);                 // let LED + serial flush
  ESP.restart();              // device reboots into BLE provisioning (no settings)
}

static void doReboot() {
  Serial.println("[Button] >>> REBOOT (2s)");
  addLog("Reboot (button 2s)", "info");

  setLED(false, false, true); // blue flash before reboot
  if (mqttClient.connected()) {
    mqttPublishStatus("offline");
    mqttClient.disconnect();
  }
  delay(300);
  ESP.restart();
}

void handleButton() {
  bool pressed = (digitalRead(BUTTON_PIN) == LOW);
  uint32_t now = millis();

  // Edge detection with simple debounce
  if (pressed && !buttonHeld) {
    if (now - buttonLastEdgeMs < BUTTON_DEBOUNCE_MS) return;
    buttonHeld         = true;
    buttonPressStartMs = now;
    buttonLastEdgeMs   = now;
    buttonLedPhase     = 0;
    Serial.println("[Button] Press start");
    return;
  }

  if (!pressed && buttonHeld) {
    if (now - buttonLastEdgeMs < BUTTON_DEBOUNCE_MS) return;
    uint32_t dur = now - buttonPressStartMs;
    buttonHeld       = false;
    buttonLastEdgeMs = now;
    buttonLedPhase   = 0;
    Serial.printf("[Button] Released after %lu ms\n", (unsigned long)dur);

    // Decide on release: longest threshold wins, so 5s does not trip 2s.
    if (dur >= BUTTON_RESET_MS) {
      doFactoryReset();
    } else if (dur >= BUTTON_REBOOT_MS) {
      doReboot();
    }
    return;
  }

  // While held: give visual feedback at each threshold so the user knows
  // when to release. We do NOT trigger any action here — actions fire on
  // release only.
  if (pressed && buttonHeld) {
    uint32_t dur = now - buttonPressStartMs;
    if (dur >= BUTTON_RESET_MS && buttonLedPhase < 2) {
      buttonLedPhase = 2;
      setLED(true, true, true);  // solid white: release now for factory reset
      Serial.println("[Button] 5s threshold — release for FACTORY RESET");
    } else if (dur >= BUTTON_REBOOT_MS && buttonLedPhase < 1) {
      buttonLedPhase = 1;
      setLED(false, false, true); // solid blue: release for reboot
      Serial.println("[Button] 2s threshold — release for REBOOT");
    }
  }
}


// ══════════════════════════════════════
//            STATE MACHINE
// ══════════════════════════════════════

void handleStateMachine() {
  // BLE provisioning handoff — runs in main loop task (not NimBLE callback)
  // so heavy/blocking work (BLE deinit, HTTPS, MQTT) is safe here.
  if (wifiProvisionedFlag) {
    wifiProvisionedFlag = false;

    // Give the app ~800ms after our "ok" notify to read it and disconnect itself
    uint32_t since = millis() - wifiProvisionedAt;
    if (since < 800) delay(800 - since);

    Serial.println("[Provision] Stopping BLE...");
    stopBLE();
    delay(200);  // radio settling

    Serial.println("[Provision] Inquiring server...");
    int inqResult = inquireServer();

    if (inqResult == INQUIRY_OWNED) {
      Serial.println("[Provision] Device owned by another user - ERROR");
      currentState = STATE_ERROR;
      setLED_error();
    } else if (inqResult == INQUIRY_OK) {
      Serial.println("[Provision] Inquiry OK! Connecting MQTT...");
      currentState = STATE_MQTT_CONNECTING;
      bool ok = connectMQTT();
      currentState = STATE_ONLINE;
      setLED_online();
      Serial.println(ok ? "[Provision] Complete! Device is online."
                        : "[Provision] MQTT failed - will retry in loop");
    } else {
      Serial.println("[Provision] Server inquiry failed");
      currentState = STATE_ERROR;
      setLED_error();
    }
    return;
  }

  switch (currentState) {

    case STATE_AP_ACTIVE:
    case STATE_POP_VERIFIED:
      // BLE provisioning: no handleClient needed — BLE callbacks handle everything
      blinkLED();

      if (bleProvisioning && millis() - bleLastActivity > BLE_TIMEOUT_MS) {
        Serial.println("[BLE] Timeout - no activity");
        if (storedSSID.length() > 0) {
          stopBLE();
          currentState = STATE_WIFI_RECONNECTING;
        } else {
          bleLastActivity = millis();  // Keep advertising indefinitely if no saved WiFi
        }
      }
      break;

    case STATE_SERVER_INQUIRY:
    case STATE_MQTT_CONNECTING:
      // Transient states during provisioning — keep LED blinking yellow
      blinkLED();
      break;

    case STATE_ONLINE:
      if (WiFi.status() != WL_CONNECTED) {
        currentState = STATE_WIFI_RECONNECTING;
        stopLocalServer();
        setLED_offline();
        return;
      }

      // Rollback timeout check (if pending verification)
      checkOtaRollbackTimeout();

      // Start local API server if not running
      if (!localServerRunning) {
        startLocalServer();
      }
      localServer.handleClient();

      if (!mqttClient.connected()) {
        if (millis() - lastMqttReconnectMs > MQTT_RECONNECT_MS) {
          lastMqttReconnectMs = millis();
          connectMQTT();
        }
      } else {
        mqttClient.loop();
        if (millis() - lastHeartbeatMs > MQTT_HEARTBEAT_MS) {
          lastHeartbeatMs = millis();
          mqttPublishHeartbeat();
        }
        // Periodic OTA check (every hour)
        if (millis() - lastOtaCheckMs > OTA_CHECK_INTERVAL) {
          checkForOtaUpdate();
        }
      }
      break;

    case STATE_WIFI_RECONNECTING:
      // Rollback timeout - if new firmware can't connect, rollback
      checkOtaRollbackTimeout();

      if (millis() - lastWifiRetryMs < WIFI_RETRY_INTERVAL_MS) {
        blinkLED();
        return;
      }
      lastWifiRetryMs = millis();
      if (connectWiFi(storedSSID, storedPassword)) {
        // Re-sync NTP after WiFi reconnect
        if (!ntpSynced) syncNTP();

        if (mqttHost.length() == 0) {
          int inqResult = inquireServer();
          if (inqResult == INQUIRY_OWNED) {
            Serial.println("[Reconnect] Device owned by another user - ERROR");
            currentState = STATE_ERROR;
            setLED_error();
            return;
          }
          if (inqResult != INQUIRY_OK) { setLED_offline(); return; }
        }
        currentState = STATE_ONLINE;
        setLED_online();
        connectMQTT();
      } else {
        blinkLED();
      }
      break;

    case STATE_OTA_UPDATING:
      // OTA is handled inside performOtaUpdate() - just keep MQTT alive
      mqttClient.loop();
      break;

    case STATE_ERROR:
      blinkLED();
      break;

    default:
      break;
  }
}


// ══════════════════════════════════════
//            SETUP & LOOP
// ══════════════════════════════════════

void setup() {
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(DOOR_SENSOR_PIN, INPUT);   // SW-420 sensor
  pinMode(LED_R, OUTPUT);
  pinMode(LED_G, OUTPUT);
  pinMode(LED_B, OUTPUT);
  setLED_off();

  Serial.begin(115200);
  delay(1000);

  // Suppress cosmetic NimBLE shutdown warnings (rc=514 etc.) — actual errors
  // still surface via Serial.println in our own BLE code.
  esp_log_level_set("NimBLE", ESP_LOG_WARN);

  // ═══════════════════════════════════════
  // HARDWARE WATCHDOG TIMER
  // Resets the device if loop() hangs for > WDT_TIMEOUT_SEC seconds
  // ═══════════════════════════════════════
  esp_task_wdt_config_t wdt_config = {
    .timeout_ms = WDT_TIMEOUT_SEC * 1000,
    .idle_core_mask = 0,
    .trigger_panic = true
  };
  esp_task_wdt_init(&wdt_config);
  esp_task_wdt_add(NULL);                    // Add current task (loopTask)
  Serial.println("[WDT] Watchdog timer initialized (30s)");

  // ═══════════════════════════════════════
  // LOAD DEVICE IDENTITY FROM NVS
  // Both serial and secret are burned once during manufacturing via
  // Serial provisioning. They MUST be unique per device — never put
  // them in the firmware source.
  // Command: PROVISION:serial=<SN-XXX>,secret=<hex32>
  // ═══════════════════════════════════════
  bool secretsLoaded = loadSecrets();

  if (!secretsLoaded) {
    Serial.println("\n╔══════════════════════════════════════════╗");
    Serial.println("║  DEVICE NOT PROVISIONED                  ║");
    Serial.println("║  Send via Serial:                        ║");
    Serial.println("║  PROVISION:serial=<SN-XXX>,secret=<hex>  ║");
    Serial.println("╚══════════════════════════════════════════╝\n");

    // Wait for provisioning via Serial (blocking until both are set).
    // Watchdog must keep being fed while we wait or it will reset us.
    setLED_error();
    while (serialNumber.length() == 0 || deviceSecret.length() == 0) {
      checkSerialProvisioning();
      esp_task_wdt_reset();
      delay(100);
    }
    setLED_off();
  }

  // ═══════════════════════════════════════
  // TLS SETUP
  // Configure WiFiClientSecure with CA certificate
  // ═══════════════════════════════════════
  if (strlen(ca_cert) > 60) {
    wifiSecureClient.setCACert(ca_cert);
    Serial.println("[TLS] CA certificate loaded");
  } else {
    // Development only: skip TLS verification
    wifiSecureClient.setInsecure();
    Serial.println("[TLS] WARNING: No CA cert - using insecure mode (dev only!)");
  }

  // ═══════════════════════════════════════
  // OTA ROLLBACK PROTECTION (Deferred Verification)
  // After OTA, firmware boots as "pending verify".
  // We do NOT confirm immediately - we wait until WiFi + MQTT
  // are connected successfully, proving the firmware works.
  // If connectivity fails within OTA_VERIFY_TIMEOUT, the device
  // reboots and the bootloader rolls back automatically.
  // ═══════════════════════════════════════
  const esp_partition_t* running = esp_ota_get_running_partition();
  esp_ota_img_states_t otaState;
  if (esp_ota_get_state_partition(running, &otaState) == ESP_OK) {
    if (otaState == ESP_OTA_IMG_PENDING_VERIFY) {
      otaPendingVerify = true;
      otaBootTime = millis();
      Serial.println("[OTA] New firmware booted - DEFERRED verification");
      Serial.println("[OTA] Will confirm after WiFi+MQTT connectivity proven");
      addLog("OTA new firmware - awaiting connectivity proof", "info");
    }
  }

  // MAC Address (needed for logging)
  WiFi.mode(WIFI_STA);
  String macAddr = WiFi.macAddress();
  WiFi.mode(WIFI_MODE_NULL);

  Serial.println("\n======================================");
  Serial.printf("  Mnazilona IoT - %s\n", DEVICE_NAME);
  Serial.printf("  SN:  %s\n", serialNumber.c_str());
  Serial.printf("  FW:  %s\n", FIRMWARE_VERSION);
  Serial.printf("  MAC: %s\n", macAddr.c_str());
  Serial.println("  Mode: Garage Relay (Pulse)");
  Serial.println("  Provisioning: BLE");
  Serial.printf("  TLS: %s\n", strlen(ca_cert) > 60 ? "Enabled" : "Insecure (dev)");
  Serial.printf("  OTA Signing: %s\n", strlen(ota_public_key) > 60 ? "Enabled" : "Disabled");
  Serial.println("======================================\n");

  if (loadSettings()) {
    Serial.println("[Boot] Saved settings found");

    if (connectWiFi(storedSSID, storedPassword)) {
      // Sync time via NTP (non-blocking, runs in background)
      syncNTP();

      if (mqttHost.length() == 0) {
        int inqResult = inquireServer();
        if (inqResult == INQUIRY_OWNED) {
          Serial.println("[Boot] Device owned by another user - ERROR");
          currentState = STATE_ERROR;
          setLED_error();
        } else if (inqResult == INQUIRY_OK) {
          currentState = STATE_ONLINE;
          setLED_online();
          connectMQTT();
        } else {
          startAP();
        }
      } else {
        currentState = STATE_ONLINE;
        setLED_online();
        connectMQTT();
      }

      // Check for pending OTA on boot (only if not just updated)
      if (currentState == STATE_ONLINE && !otaPendingVerify) {
        checkForOtaUpdate();
      }
    } else {
      currentState = STATE_WIFI_RECONNECTING;
      setLED_offline();
    }
  } else {
    Serial.println("[Boot] No settings - starting BLE provisioning");
    startBLE();
  }
}

void loop() {
  esp_task_wdt_reset();  // Feed watchdog - must run every < 30s
  handleStateMachine();
  handleRelay();
  handleButton();
  handleDoorSensor();
  delay(10);
}
