/**
 * ═══════════════════════════════════════════════════════════════
 *  Mnazilona IoT - ESP32-C6 Firmware v1.0.0
 *  BLE Provisioning + Proof of Possession + DeviceSecret
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
 *  Provisioning changed from SoftAP to BLE GATT.
 *  The device advertises a custom BLE service during pairing.
 *  The mobile app connects via BLE, verifies PoP, requests a
 *  WiFi scan, and sends WiFi credentials — all over BLE.
 *
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

// BLE chunked transfer buffer (for WiFi scan results that exceed MTU)
String             bleScanResultBuffer = "";
int                bleScanChunkIndex   = 0;

// Watchdog timeout: 30 seconds - resets device if loop() hangs
#define WDT_TIMEOUT_SEC 30

// ═══════════════════════════════════════
// CONFIG - ثوابت غير سرية
// ═══════════════════════════════════════
#define SERIAL_NUMBER     "SN-001"
#define DEVICE_NAME       "Garage Relay"
#define FIRMWARE_VERSION  "1.0.0"

// الأسرار تُقرأ من NVS (تُحرق مرة وحدة أثناء التصنيع)
// استخدم أمر Provisioning لحرقها - لا تكتبها في الكود!
// DEVICE_SECRET: مفتاح هوية الجهاز (32 حرف hex)
// POP_CODE: رمز إثبات الحيازة (8+ حروف/أرقام، يُطبع على ملصق الجهاز)
String deviceSecret = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
String popCode      = "123456";

// ═══════════════════════════════════════
// SERVER & TLS CONFIG
// ═══════════════════════════════════════
// Production: use HTTPS with your domain
//#define SERVER_BASE_URL   "https://your-domain.com"
// Development: uncomment for local HTTP testing
#define SERVER_BASE_URL   "http://192.168.8.143:3000"
#define SERVER_INQUIRY_PATH "/devices/inquiry"
#define SERVER_OTA_CHECK_PATH "/devices/ota/check"

// TLS: Root CA certificate for server & MQTT broker verification
// Replace with your actual CA cert (Let's Encrypt, etc.)
// Set to "" to use setInsecure() for development ONLY
const char* ca_cert = R"EOF(
-----BEGIN CERTIFICATE-----
PASTE_YOUR_CA_CERTIFICATE_HERE
-----END CERTIFICATE-----
)EOF";

// OTA: RSA public key for firmware signature verification
// Generate keypair: openssl genrsa -out ota_private.pem 2048
//                   openssl rsa -in ota_private.pem -pubout -out ota_public.pem
const char* ota_public_key = R"EOF(
-----BEGIN PUBLIC KEY-----
PASTE_YOUR_OTA_PUBLIC_KEY_HERE
-----END PUBLIC KEY-----
)EOF";

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
#define MAX_POP_ATTEMPTS      5
#define POP_LOCKOUT_MS        60000UL
#define MQTT_MAX_RECONNECTS   3

// ═══════════════════════════════════════
// NTP Time Sync
// ═══════════════════════════════════════
#define NTP_SERVER1           "pool.ntp.org"
#define NTP_SERVER2           "time.google.com"
#define NTP_GMT_OFFSET_SEC    (3 * 3600)   // UTC+3 (السعودية)
#define NTP_DAYLIGHT_OFFSET   0

bool ntpSynced = false;

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
// ═══════════════════════════════════════
#define MAX_LOCAL_LOGS        50

struct LocalLog {
  uint32_t timestamp;   // millis()
  char message[80];
  char type[8];         // "info", "warning", "error"
};

LocalLog localLogs[MAX_LOCAL_LOGS];
int logHead = 0;
int logCount = 0;

void addLog(const char* msg, const char* type = "info") {
  LocalLog& entry = localLogs[logHead];
  entry.timestamp = millis();
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
bool popVerified           = false;
int popAttempts            = 0;
uint32_t popLockoutStart   = 0;
bool popLockedOut          = false;

// TLS-secured clients
WiFiClientSecure wifiSecureClient;
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
uint32_t cmdWindowStart      = 0;
uint8_t  cmdCount            = 0;

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

// Load device secrets from NVS (burned once during manufacturing)
bool loadSecrets() {
  prefs.begin("secrets", true);
  deviceSecret = prefs.getString("secret", "");
  popCode      = prefs.getString("pop", "");
  prefs.end();

  if (deviceSecret.length() == 0 || popCode.length() == 0) {
    Serial.println("[SECURITY] Device secrets NOT provisioned!");
    Serial.println("[SECURITY] Use serial provisioning to burn secrets.");
    return false;
  }
  Serial.println("[SECURITY] Device secrets loaded from NVS");
  return true;
}

// Provision secrets via Serial (run once during manufacturing)
// Send: PROVISION:secret=<hex32>,pop=<code8+>
void checkSerialProvisioning() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();

  if (!line.startsWith("PROVISION:")) return;

  String params = line.substring(10);
  String secret = "", pop = "";

  int commaIdx = params.indexOf(',');
  if (commaIdx < 0) return;

  String part1 = params.substring(0, commaIdx);
  String part2 = params.substring(commaIdx + 1);

  if (part1.startsWith("secret=")) secret = part1.substring(7);
  if (part2.startsWith("pop="))    pop    = part2.substring(4);

  if (secret.length() < 32 || pop.length() < 6) {
    Serial.println("[PROVISION] Error: secret must be 32+ chars, pop must be 6+ chars");
    return;
  }

  prefs.begin("secrets", false);
  prefs.putString("secret", secret);
  prefs.putString("pop", pop);
  prefs.end();

  deviceSecret = secret;
  popCode = pop;

  Serial.println("[PROVISION] Secrets burned to NVS successfully!");
  Serial.printf("[PROVISION] Secret: %s...%s\n", secret.substring(0, 4).c_str(), secret.substring(secret.length() - 4).c_str());
  Serial.printf("[PROVISION] PoP: %d chars\n", pop.length());
}

// Load PoP attempt counter from NVS (survives reboot)
void loadPopAttempts() {
  prefs.begin("security", true);
  popAttempts = prefs.getInt("pop_attempts", 0);
  uint32_t lockoutTime = prefs.getUInt("pop_lockout", 0);
  prefs.end();

  // If lockout was set, keep it active
  if (popAttempts >= MAX_POP_ATTEMPTS) {
    popLockedOut = true;
    popLockoutStart = millis();
    Serial.printf("[SECURITY] PoP locked out (%d failed attempts)\n", popAttempts);
  }
}

void savePopAttempts() {
  prefs.begin("security", false);
  prefs.putInt("pop_attempts", popAttempts);
  prefs.end();
}

void resetPopAttempts() {
  popAttempts = 0;
  popLockedOut = false;
  prefs.begin("security", false);
  prefs.putInt("pop_attempts", 0);
  prefs.end();
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
    addLog("Relay CLOSED (auto)", "info");
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
  if (!http.begin(wifiSecureClient, inquiryUrl)) return INQUIRY_FAIL;

  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);

  StaticJsonDocument<384> doc;
  doc["serialNumber"] = SERIAL_NUMBER;
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
  return String("mnazilona/devices/") + SERIAL_NUMBER + "/" + leaf;
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

  http.begin(wifiSecureClient, checkUrl);
  http.addHeader("X-Device-Serial", SERIAL_NUMBER);
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

        // Security: require HTTPS for OTA download
        if (downloadUrl.length() > 0 && !downloadUrl.startsWith("https://")) {
          Serial.println("[OTA] Rejected: download URL must use HTTPS");
          addLog("OTA rejected: non-HTTPS URL from server", "warning");
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

  // Phase 2: Download firmware (over TLS)
  HTTPClient http;
  http.setTimeout(30000); // 30s connection timeout
  if (!http.begin(wifiSecureClient, otaUrl)) {
    Serial.println("[OTA] Failed to begin HTTPS connection");
    otaReportProgress("failed", 0, "HTTPS connection failed");
    addLog("OTA failed: HTTPS connection", "error");
    otaInProgress = false;
    currentState = STATE_ONLINE;
    return;
  }

  // Add device authentication headers
  http.addHeader("X-Device-Serial", SERIAL_NUMBER);
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

    // Report progress every 10%
    if (percent / 10 != lastReportedPercent / 10) {
      lastReportedPercent = percent;
      Serial.printf("[OTA] Progress: %d%% (%d/%d bytes)\n", percent, totalRead, contentLength);
      otaReportProgress("downloading", percent);
      mqttClient.loop();
    }

    // Keep system alive
    yield();
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
    }
  }
  // ── restart = إعادة تشغيل ──
  else if (action == "restart") {
    Serial.println("[MQTT] Restart command");
    mqttPublishStatus("restarting");
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

    // Security: OTA downloads must use HTTPS (prevent MITM firmware injection)
    if (!otaUrl.startsWith("https://")) {
      Serial.println("[MQTT] OTA REJECTED: URL must use HTTPS");
      otaReportProgress("failed", 0, "HTTPS required for OTA");
      addLog("OTA rejected: non-HTTPS URL", "warning");
      return;
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

  mqttClient.setServer(mqttHost.c_str(), mqttPort);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(1024);

  String cid = String(SERIAL_NUMBER) + "-" + String(random(0xFFFF), HEX);
  Serial.printf("[MQTT] Connecting to %s:%d...\n", mqttHost.c_str(), mqttPort);

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
      String newCid = String(SERIAL_NUMBER) + "-" + String(random(0xFFFF), HEX);
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

// Verify Bearer token on local API requests
// Token = mqttToken (received from server during inquiry, stored in NVS)
bool verifyLocalAuth() {
  if (mqttToken.length() == 0) return true;  // No token set = dev mode (allow all)

  localServer.collectHeaders("Authorization");
  String authHeader = localServer.header("Authorization");

  if (authHeader.length() == 0 || !authHeader.startsWith("Bearer ")) {
    localServer.send(401, "application/json", "{\"status\":\"error\",\"message\":\"Authorization required\"}");
    Serial.println("[LocalAPI] Rejected - no auth token");
    return false;
  }

  String token = authHeader.substring(7);
  // Constant-time comparison
  if (token.length() != mqttToken.length()) {
    localServer.send(401, "application/json", "{\"status\":\"error\",\"message\":\"Invalid token\"}");
    Serial.println("[LocalAPI] Rejected - invalid token");
    return false;
  }

  volatile uint8_t result = 0;
  for (size_t i = 0; i < token.length(); i++) {
    result |= token[i] ^ mqttToken[i];
  }
  if (result != 0) {
    localServer.send(401, "application/json", "{\"status\":\"error\",\"message\":\"Invalid token\"}");
    Serial.println("[LocalAPI] Rejected - token mismatch");
    return false;
  }

  return true;
}

void startLocalServer() {
  if (localServerRunning) return;

  // mDNS: broadcast as "mnazilona-SN-001.local"
  String hostname = "mnazilona-" + String(SERIAL_NUMBER);
  hostname.toLowerCase();
  hostname.replace(" ", "-");

  if (MDNS.begin(hostname.c_str())) {
    MDNS.addService("mnazilona", "tcp", 8080);
    MDNS.addServiceTxt("mnazilona", "tcp", "serial", SERIAL_NUMBER);
    MDNS.addServiceTxt("mnazilona", "tcp", "sn", SERIAL_NUMBER);
    MDNS.addServiceTxt("mnazilona", "tcp", "type", "relay");
    MDNS.addServiceTxt("mnazilona", "tcp", "fw", FIRMWARE_VERSION);
    Serial.printf("[mDNS] Broadcasting: %s.local:8080\n", hostname.c_str());
  } else {
    Serial.println("[mDNS] Failed to start");
  }

  // Collect Authorization header for all requests
  const char* headerKeys[] = {"Authorization"};
  localServer.collectHeaders(headerKeys, 1);

  // Local command endpoint (authenticated + rate limited)
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
      addLog("Command: open (via local)", "info");
      localServer.send(200, "application/json", "{\"status\":\"ok\",\"message\":\"Command executed locally\"}");
      Serial.println("[LocalAPI] Command: open (local, authenticated)");
    }
    else if (action == "restart") {
      addLog("Restart command (via local)", "warning");
      localServer.send(200, "application/json", "{\"status\":\"ok\",\"message\":\"Restarting...\"}");
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
    doc["serial"]    = SERIAL_NUMBER;
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

  // Local logs endpoint (authenticated)
  localServer.on("/logs", HTTP_GET, []() {
    if (!verifyLocalAuth()) return;

    // Build JSON array of logs (newest first) - use StaticJsonDocument
    StaticJsonDocument<4096> doc;
    JsonArray logsArr = doc.createNestedArray("logs");
    doc["count"] = logCount;
    doc["local"] = true;

    // Read from circular buffer newest first
    for (int i = 0; i < logCount; i++) {
      int idx = (logHead - 1 - i + MAX_LOCAL_LOGS) % MAX_LOCAL_LOGS;
      JsonObject entry = logsArr.createNestedObject();
      entry["timestamp"] = localLogs[idx].timestamp;
      entry["message"]   = localLogs[idx].message;
      entry["type"]      = localLogs[idx].type;
    }

    String response;
    serializeJson(doc, response);
    localServer.send(200, "application/json", response);
  });

  // CORS: restrict to Mnazilona app origin only (no wildcard)
  auto handleLocalCORS = []() {
    localServer.sendHeader("Access-Control-Allow-Origin", "app://mnazilona");
    localServer.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    localServer.sendHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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

// Generate HMAC-SHA256 token (time-limited, derived from device secret)
String generatePopToken() {
  uint32_t bucket = millis() / 300000UL;
  String data = String(SERIAL_NUMBER) + String(bucket);

  unsigned char hmac[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)deviceSecret.c_str(), deviceSecret.length());
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)data.c_str(), data.length());
  mbedtls_md_hmac_finish(&ctx, hmac);
  mbedtls_md_free(&ctx);

  char hexToken[65];
  for (int i = 0; i < 32; i++) {
    sprintf(&hexToken[i * 2], "%02x", hmac[i]);
  }
  hexToken[64] = '\0';
  return String(hexToken);
}

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

// ── PoP Verify Callback ──
class PopVerifyCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) override {
    bleLastActivity = millis();
    String value = pCharacteristic->getValue().c_str();

    StaticJsonDocument<128> doc;
    if (deserializeJson(doc, value)) {
      bleNotify(bleCharPopVerify, "{\"status\":\"error\",\"message\":\"Invalid JSON\"}");
      return;
    }

    String code = doc["code"] | "";
    code.trim();

    // PoP lockout check (survives reboot via NVS)
    if (popLockedOut) {
      if (millis() - popLockoutStart < POP_LOCKOUT_MS) {
        uint32_t remaining = (POP_LOCKOUT_MS - (millis() - popLockoutStart)) / 1000;
        StaticJsonDocument<128> rDoc;
        rDoc["status"] = "locked";
        rDoc["message"] = "Too many attempts";
        rDoc["retryAfterSec"] = remaining;
        String response;
        serializeJson(rDoc, response);
        bleNotify(bleCharPopVerify, response);
        return;
      }
      popLockedOut = false;
      resetPopAttempts();
    }

    if (code.length() == 0 || code.length() > 32) {
      bleNotify(bleCharPopVerify, "{\"status\":\"error\",\"message\":\"Invalid code length\"}");
      return;
    }

    // Constant-time comparison to prevent timing attacks
    bool match = false;
    if (code.length() == popCode.length() && code.length() > 0) {
      volatile uint8_t result = 0;
      for (size_t i = 0; i < code.length(); i++) {
        result |= code[i] ^ popCode[i];
      }
      match = (result == 0);
    }

    if (match) {
      popVerified = true;
      resetPopAttempts();
      currentState = STATE_POP_VERIFIED;

      String popToken = generatePopToken();
      StaticJsonDocument<256> rDoc;
      rDoc["status"]   = "ok";
      rDoc["message"]  = "Verified";
      rDoc["popToken"] = popToken;
      String response;
      serializeJson(rDoc, response);
      bleNotify(bleCharPopVerify, response);
      Serial.println("[BLE] PoP VERIFIED");
    } else {
      popAttempts++;
      savePopAttempts();
      Serial.printf("[BLE] PoP FAILED (attempt %d/%d)\n", popAttempts, MAX_POP_ATTEMPTS);

      if (popAttempts >= MAX_POP_ATTEMPTS) {
        popLockedOut = true;
        popLockoutStart = millis();
        bleNotify(bleCharPopVerify, "{\"status\":\"locked\",\"message\":\"Too many attempts. Device locked.\"}");
      } else {
        StaticJsonDocument<128> rDoc;
        rDoc["status"]       = "error";
        rDoc["message"]      = "Wrong code";
        rDoc["attemptsLeft"] = MAX_POP_ATTEMPTS - popAttempts;
        String response;
        serializeJson(rDoc, response);
        bleNotify(bleCharPopVerify, response);
      }
    }
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

    if (!popVerified) {
      bleNotify(bleCharWifiScan, "{\"status\":\"error\",\"message\":\"Verification required first\"}");
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

    if (!popVerified) {
      bleNotify(bleCharWifiConfig, "{\"status\":\"error\",\"message\":\"Verification required first\"}");
      return;
    }

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
      rDoc["serialNumber"] = SERIAL_NUMBER;
      String response;
      serializeJson(rDoc, response);
      bleNotify(bleCharWifiConfig, response);

      // Give the app time to read the response before stopping BLE
      delay(1000);

      // Stop BLE and proceed to server inquiry
      stopBLE();

      currentState = STATE_SERVER_INQUIRY;
      int inqResult = inquireServer();

      if (inqResult == INQUIRY_OWNED) {
        Serial.println("[BLE Setup] Device owned by another user - ERROR");
        currentState = STATE_ERROR;
        setLED_error();
      } else if (inqResult == INQUIRY_OK) {
        Serial.println("[BLE Setup] Inquiry OK! Connecting MQTT...");
        currentState = STATE_MQTT_CONNECTING;

        if (connectMQTT()) {
          currentState = STATE_ONLINE;
          setLED_online();
          Serial.println("[BLE Setup] Complete! Device is online.");
        } else {
          currentState = STATE_ONLINE;
          setLED_online();
          Serial.println("[BLE Setup] MQTT failed - will retry in loop");
        }
      } else {
        Serial.println("[BLE Setup] Server inquiry failed");
        currentState = STATE_ERROR;
        setLED_error();
      }
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
  String bleName = String(BLE_ADV_NAME_PREFIX) + String(SERIAL_NUMBER);

  BLEDevice::init(bleName.c_str());
  // Request max MTU for larger JSON payloads
  BLEDevice::setMTU(517);

  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new BLEProvisioningServerCallbacks());

  // Create provisioning service
  BLEService* service = bleServer->createService(BLE_SERVICE_UUID);

  // ── DeviceInfo (Read) ──
  bleCharDeviceInfo = service->createCharacteristic(
    BLE_CHAR_DEVICE_INFO,
    BLECharacteristic::PROPERTY_READ
  );
  // Set device info JSON as static value
  StaticJsonDocument<256> infoDoc;
  infoDoc["serial"]      = SERIAL_NUMBER;
  infoDoc["name"]        = DEVICE_NAME;
  infoDoc["type"]        = "relay";
  infoDoc["fw"]          = FIRMWARE_VERSION;
  infoDoc["popRequired"] = !popVerified;
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
  advertising->addServiceUUID(BLE_SERVICE_UUID);
  advertising->setScanResponse(true);
  // Helps with iPhone connection issues
  advertising->setMinPreferred(0x06);
  advertising->setMinPreferred(0x12);
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
  bleClientConnected = false;
  BLEDevice::getAdvertising()->stop();
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
// ══════════════════════════════════════

void handleButton() {
  if (digitalRead(BUTTON_PIN) != LOW) return;

  uint32_t pressStart = millis();
  while (digitalRead(BUTTON_PIN) == LOW) {
    if (millis() - pressStart > 5000) {
      Serial.println("[Button] FACTORY RESET");
      setLED(true, true, true);
      stopLocalServer();
      if (mqttClient.connected()) {
        mqttPublishStatus("offline");
        mqttClient.disconnect();
      }
      clearAllSettings();
      delay(500);
      ESP.restart();
    }
    delay(50);
  }

  uint32_t dur = millis() - pressStart;

  if (dur > 2000 && dur <= 5000) {
    if (currentState == STATE_ONLINE || currentState == STATE_WIFI_RECONNECTING) {
      Serial.println("[Button] Medium press - AP re-config (PoP still required)");
      popVerified = false;  // Force PoP re-verification for security
      // Clean up running services before switching to AP
      stopLocalServer();
      if (mqttClient.connected()) {
        mqttPublishStatus("offline");
        mqttClient.disconnect();
      }
      startAP();
    }
  }
}


// ══════════════════════════════════════
//            STATE MACHINE
// ══════════════════════════════════════

void handleStateMachine() {
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

  // ═══════════════════════════════════════
  // HARDWARE WATCHDOG TIMER
  // Resets the device if loop() hangs for > WDT_TIMEOUT_SEC seconds
  // ═══════════════════════════════════════
  esp_task_wdt_init(WDT_TIMEOUT_SEC, true);  // true = panic (reset) on timeout
  esp_task_wdt_add(NULL);                    // Add current task (loopTask)
  Serial.println("[WDT] Watchdog timer initialized (30s)");

  // ═══════════════════════════════════════
  // LOAD DEVICE SECRETS FROM NVS
  // Secrets are burned once during manufacturing via Serial provisioning
  // Command: PROVISION:secret=<hex32>,pop=<code>
  // ═══════════════════════════════════════
  bool secretsLoaded = loadSecrets();
  loadPopAttempts();

  if (!secretsLoaded) {
    Serial.println("\n╔══════════════════════════════════════════╗");
    Serial.println("║  DEVICE NOT PROVISIONED                  ║");
    Serial.println("║  Send via Serial:                        ║");
    Serial.println("║  PROVISION:secret=<32+hex>,pop=<6+chars> ║");
    Serial.println("╚══════════════════════════════════════════╝\n");

    // Wait for provisioning via Serial (blocking until provisioned)
    setLED_error();
    while (deviceSecret.length() == 0 || popCode.length() == 0) {
      checkSerialProvisioning();
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
  Serial.printf("  SN:  %s\n", SERIAL_NUMBER);
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
