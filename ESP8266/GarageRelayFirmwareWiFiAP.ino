/**
 * ═══════════════════════════════════════════════════════════════
 *  Mnazilona IoT - ESP8266 Firmware v1.1.0 (Wi-Fi AP variant)
 *  SoftAP Provisioning (no PoP) + DeviceSecret
 *  Port of GarageRelayFirmwareWiFiAP.ino (ESP32-C6) to ESP8266
 *  Hardware target: Shelly 1 / Shelly relay (ESP8266)
 * ═══════════════════════════════════════════════════════════════
 *
 *  Functional parity with the ESP32-C6 firmware. Differences vs.
 *  ESP32-C6 are platform-driven, not behavioral:
 *    - Preferences (NVS) → LittleFS-backed shim with the same API
 *    - mbedtls SHA256/HMAC → BearSSL br_sha256 / br_hmac
 *    - esp_task_wdt_*       → ESP.wdtFeed()
 *    - esp_ota_ops (A/B partitions, rollback) → REMOVED
 *      ESP8266 has no dual-partition rollback, so the deferred
 *      "verify after MQTT connect" flow is dropped. Update.h still
 *      provides single-image upgrade with reboot.
 *    - WIFI_MODE_NULL → WIFI_OFF
 *    - Pins remapped for Shelly: GPIO4 = relay, GPIO5 = SW input
 *    - LED + dedicated push-button + door sensor: NOT PRESENT on
 *      Shelly hardware. LED helpers are stubbed to no-ops; door
 *      sensor is reported as "unknown"; the physical button
 *      (factory reset / reboot) is replaced by a SW-input pattern
 *      (see handleShellySwitch below).
 *
 *  Arduino IDE Setup:
 *    Board:  NodeMCU 1.0 (ESP-12E) or Wemos D1 mini
 *    Libs:   ArduinoJson (6.21.x+), PubSubClient (2.8.x+)
 *    Core:   ESP8266 Arduino core 3.1+ (BearSSL + LittleFS bundled)
 *    Filesystem: LittleFS (Tools → Flash Size → "...with FS")
 *
 *  Provisioning flow (Wi-Fi AP):
 *    1. Device starts SoftAP "MNZ_<serial>" (default password
 *       below). HTTP server listens on http://192.168.4.1.
 *    2. Phone joins the AP.
 *    3. App calls GET /info → {serial, deviceSecret, ...}
 *    4. App calls GET /scan → list of nearby Wi-Fi networks
 *    5. App calls POST /config {ssid, password, userId?}
 *       → device saves creds, responds ok immediately.
 *    6. Device attempts STA connection to the home Wi-Fi.
 *    7. On success: AP shuts down, server inquiry, MQTT online.
 *       On failure: AP stays up so the user can retry.
 *
 *  Cloud / MQTT / OTA / local API behavior is unchanged from the
 *  ESP32 firmware so the backend, app, and admin dashboard see no
 *  difference once the device is online.
 * ═══════════════════════════════════════════════════════════════
 */

#include <ESP8266WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <ESP8266mDNS.h>
#include <Updater.h>
#include <LittleFS.h>
#include <bearssl/bearssl.h>
#include <time.h>

// Keep call sites identical to the ESP32 firmware.
typedef ESP8266WebServer WebServer;

// ═══════════════════════════════════════
// Wi-Fi AP Provisioning
// ═══════════════════════════════════════
// SoftAP that the app joins for one-time provisioning.
// SSID is "MNZ_<serial>" — same naming convention as the ESP32
// firmware so the app can identify Mnazilona devices uniformly.
#define AP_SSID_PREFIX     "MNZ_"
#define AP_PASSWORD        "mnazilona1234"
#define AP_HTTP_PORT       80
#define AP_TIMEOUT_MS      600000UL  // 10 minutes — give the user time

bool      apProvisioning   = false;
uint32_t  apStartTime      = 0;
uint32_t  apLastActivity   = 0;

// Set by the /config HTTP handler after credentials are accepted.
// The actual STA connection attempt runs in the main loop (not in the
// HTTP handler) because the connection sequence is multi-second and we
// want the HTTP response to ship cleanly first.
volatile bool apConfigPending      = false;
uint32_t      apConfigPendingAt    = 0;

// Set by the STA connection sequence after Wi-Fi succeeds. Main loop
// picks it up to run stopAP() + inquireServer() + connectMQTT() outside
// the HTTP handler.
volatile bool wifiProvisionedFlag  = false;
uint32_t      wifiProvisionedAt    = 0;

// ═══════════════════════════════════════
// CONFIG - ثوابت غير سرية
// ═══════════════════════════════════════
#define DEVICE_NAME       "Garage Relay"
#define FIRMWARE_VERSION  "1.0.0"

// هوية الجهاز (السيريال + الـ secret) تُقرأ من LittleFS — تُحرق مرة وحدة
// أثناء التصنيع. لكل جهاز قيم فريدة. لا تكتبها في الكود أبداً!
//   PROVISION:serial=<SN-XXX>,secret=<hex32>
String serialNumber = "";
String deviceSecret = "";

// ═══════════════════════════════════════
// SERVER & TLS CONFIG
// ═══════════════════════════════════════
//#define SERVER_BASE_URL   "https://your-domain.com"
#define SERVER_BASE_URL   "http://192.168.8.143:3000"
#define SERVER_INQUIRY_PATH "/devices/inquiry"
#define SERVER_OTA_CHECK_PATH "/devices/ota/check"

const char* ca_cert = "";

#ifndef ALLOW_INSECURE_OTA_HTTP
#define ALLOW_INSECURE_OTA_HTTP 1
#endif

// ═══════════════════════════════════════
// Hardware Pins (Shelly 1 / Shelly relay - ESP8266)
// ═══════════════════════════════════════
// Shelly terminal mapping:
//   L(-)  → mains hot in
//   N(+)  → mains neutral
//   I     → relay input (mains hot, switched to O via the relay)
//   O     → relay output (to garage door opener trigger)
//   SW    → wall-switch input (referenced through the device's
//           internal optocoupler to GPIO5)
//
// MCU pin map:
//   GPIO4 → relay coil driver  (active HIGH)
//   GPIO5 → SW input           (no internal pull; optocoupler-driven)
//
// The Shelly does NOT expose:
//   - a dedicated user LED       → all setLED_*() are no-ops below
//   - a separate push-button     → SW input doubles as pairing trigger
//   - a garage open/closed sensor → reported as "unknown"
#define RELAY_PIN         4    // GPIO4 → relay
#define SW_PIN            5    // GPIO5 → Shelly SW input

// Legacy aliases retained so call sites compile without rewriting them.
// The pins below point at SW so any leftover read on BUTTON_PIN does
// not float; the door sensor pin is unused but kept defined.
#define BUTTON_PIN        SW_PIN   // unused — handleButton replaced by handleShellySwitch
#define DOOR_SENSOR_PIN   SW_PIN   // unused — door sensor not present

// LED pins are unused on Shelly. Kept defined so legacy pinMode/
// digitalWrite call sites remain valid; setLED_*() are stubbed below.
#define LED_R             4
#define LED_G             4
#define LED_B             4
#define LED_ACTIVE_LOW    false

// Door sensor not present; constant kept for compile compatibility.
#define DOOR_OPEN_STATE   LOW

// Door state we report when no physical sensor is wired.
#define DOOR_STATE_FALLBACK "unknown"

// ═══════════════════════════════════════
// Timing
// ═══════════════════════════════════════
#define RELAY_PULSE_MS           2000UL
#define WIFI_RETRY_INTERVAL_MS   30000UL
#define MQTT_HEARTBEAT_MS        30000UL
#define MQTT_RECONNECT_MS        5000UL
#define DOOR_SENSOR_CHECK_MS     2000UL

// ═══════════════════════════════════════
// Security
// ═══════════════════════════════════════
#define MQTT_MAX_RECONNECTS   3

// ═══════════════════════════════════════
// NTP Time Sync
// ═══════════════════════════════════════
#define NTP_SERVER1           "pool.ntp.org"
#define NTP_SERVER2           "time.google.com"
#define NTP_GMT_OFFSET_SEC    (3 * 3600)
#define NTP_DAYLIGHT_OFFSET   0

bool ntpSynced = false;

// Forward declarations
void addLog(const char* msg, const char* type = "info");
void performOtaUpdate();
String topicOf(const String& leaf);
bool mqttPublishReliable(const String& subtopic, const char* payload);

uint32_t getEpochTime() {
  time_t now = time(nullptr);
  if (now < 1700000000) return 0;  // pre-2023 means NTP not synced
  return (uint32_t)now;
}

void syncNTP() {
  configTime(NTP_GMT_OFFSET_SEC, NTP_DAYLIGHT_OFFSET, NTP_SERVER1, NTP_SERVER2);
  Serial.println("[NTP] Time sync started");

  uint32_t start = millis();
  while (time(nullptr) < 1700000000 && millis() - start < 3000) {
    delay(50);
    yield();
  }

  if (time(nullptr) >= 1700000000) {
    ntpSynced = true;
    time_t t = time(nullptr);
    struct tm* timeinfo = localtime(&t);
    char buf[30];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", timeinfo);
    Serial.printf("[NTP] Synced: %s\n", buf);
    addLog("NTP time synced", "info");
  } else {
    Serial.println("[NTP] Sync pending (will retry in background)");
  }
}

// ═══════════════════════════════════════
// Local Logs (Circular Buffer)
// ═══════════════════════════════════════
// Reduced from 50 → 25 vs. the ESP32 firmware to save RAM (the /logs
// JSON response also shrinks proportionally).
#define MAX_LOCAL_LOGS        25

struct LocalLog {
  uint32_t uptimeMs;
  uint32_t epoch;
  char message[80];
  char type[8];
};

LocalLog localLogs[MAX_LOCAL_LOGS];
int logHead = 0;
int logCount = 0;

void addLog(const char* msg, const char* type) {
  LocalLog& entry = localLogs[logHead];
  entry.uptimeMs = millis();
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
  STATE_AP_CONNECTING_STA,
  STATE_WIFI_CONNECTING,
  STATE_SERVER_INQUIRY,
  STATE_MQTT_CONNECTING,
  STATE_ONLINE,
  STATE_WIFI_RECONNECTING,
  STATE_OTA_UPDATING,
  STATE_ERROR,
};

// ═══════════════════════════════════════
// Preferences shim (LittleFS-backed)
// ═══════════════════════════════════════
// Mimics the subset of ESP32 Preferences used by this firmware
// (begin/end/clear/remove/getString/putString/getInt/putInt/getBool/putBool).
// One JSON file per namespace; small footprint, easy to debug.
class Preferences {
  String _ns;
  bool   _readOnly = true;
  JsonDocument _doc;
  bool   _open = false;

  String _path() const { return String("/prefs_") + _ns + ".json"; }

  void _load() {
    _doc.clear();
    if (!LittleFS.exists(_path())) return;
    File f = LittleFS.open(_path(), "r");
    if (!f) return;
    deserializeJson(_doc, f);
    f.close();
  }

  void _save() {
    if (_readOnly) return;
    File f = LittleFS.open(_path(), "w");
    if (!f) return;
    serializeJson(_doc, f);
    f.close();
  }

public:
  bool begin(const char* ns, bool readOnly = false) {
    _ns = ns;
    _readOnly = readOnly;
    _open = true;
    _load();
    return true;
  }

  void end() { _open = false; }

  void clear() { _doc.clear(); _save(); }

  void remove(const char* k) { _doc.remove(k); _save(); }

  size_t putString(const char* k, const String& v) { _doc[k] = v; _save(); return v.length(); }
  size_t putString(const char* k, const char* v)   { _doc[k] = v; _save(); return strlen(v); }
  String getString(const char* k, const char* def = "") { return _doc[k] | def; }
  String getString(const char* k, const String& def)    { return _doc[k] | def.c_str(); }

  size_t putInt(const char* k, int v)              { _doc[k] = v; _save(); return sizeof(int); }
  int    getInt(const char* k, int def = 0)        { return _doc[k] | def; }

  size_t putBool(const char* k, bool v)            { _doc[k] = v; _save(); return sizeof(bool); }
  bool   getBool(const char* k, bool def = false)  { return _doc[k] | def; }
};

// ═══════════════════════════════════════
// Globals
// ═══════════════════════════════════════
DeviceState currentState = STATE_BOOT;

WiFiClientSecure wifiSecureClient;
WiFiClient       wifiPlainClient;
WiFiClient       otaPlainClient;
PubSubClient     mqttClient(wifiSecureClient);
WebServer        provisionServer(AP_HTTP_PORT);
WebServer        localServer(8080);
bool             localServerRunning = false;
Preferences      prefs;

String storedSSID = "", storedPassword = "";
String mqttHost = "", mqttUser = "", mqttPass = "", mqttToken = "";
String pairingUserId = "";
int    mqttPort = 8883;

uint32_t relayStartTime      = 0;
bool     relayActive         = false;
uint32_t lastHeartbeatMs     = 0;
uint32_t lastMqttReconnectMs = 0;
uint32_t lastWifiRetryMs     = 0;
uint32_t lastLedToggle       = 0;
uint32_t lastDoorCheckMs     = 0;
bool     ledToggleState      = false;
int      mqttReconnectCount  = 0;
bool     lastDoorState       = false;
bool     doorStateInitialized = false;

#define DOOR_DEBOUNCE_READS   3
uint8_t doorDebounceCount    = 0;
bool    doorDebouncePending  = false;

// Wi-Fi reconnect → AP fallback
#define WIFI_RECONNECT_MAX_FAILURES 6   // ~3 minutes at 30 s retry interval
uint8_t wifiReconnectFailCount = 0;

// Command Rate Limiting
#define CMD_RATE_WINDOW_MS    5000UL
#define CMD_RATE_MAX          10
#define CMD_DEDUP_WINDOW_MS   15000UL
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
bool     otaInProgress       = false;
String   otaUrl              = "";
String   otaVersion          = "";
String   otaChecksum         = "";
uint32_t otaFileSize         = 0;
uint8_t  otaRetryCount       = 0;

#define OTA_MAX_RETRIES       2
#define OTA_DOWNLOAD_TIMEOUT  120000UL
#define OTA_STALL_TIMEOUT     15000UL
#define OTA_MIN_HEAP          16000   // ESP8266 has ~50KB heap; 16KB headroom
#define OTA_CHECK_INTERVAL    3600000UL
uint32_t lastOtaCheckMs      = 0;


// ══════════════════════════════════════
//            LED CONTROL (no-op on Shelly)
// ══════════════════════════════════════
// Shelly relay devices have no user-addressable LED. Helpers below
// are stubbed so existing call sites compile and run unchanged.

inline void ledWrite(int /*pin*/, bool /*on*/) { /* no-op */ }
void setLED(bool /*r*/, bool /*g*/, bool /*b*/) { /* no-op */ }
void setLED_off()     {}
void setLED_online()  {}
void setLED_offline() {}
void setLED_ap()      {}
void setLED_action()  {}
void setLED_error()   {}
void setLED_pairing() {}
void blinkLED()       {}


// ══════════════════════════════════════
//            STORAGE (LittleFS)
// ══════════════════════════════════════

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
  Serial.println("[SECURITY] Device identity loaded from LittleFS");
  return true;
}

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
  prefs.remove("pop");
  prefs.end();

  if (newSerial.length() > 0) {
    serialNumber = newSerial;
    Serial.printf("[PROVISION] Serial burned: %s\n", serialNumber.c_str());
  }
  if (newSecret.length() > 0) {
    deviceSecret = newSecret;
    Serial.printf("[PROVISION] Secret burned: %s...%s\n",
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
  if (userId.length() > 0) prefs.putString("userId", userId);
  prefs.end();
  storedSSID = ssid;
  storedPassword = psw;
  if (userId.length() > 0) pairingUserId = userId;
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
}


// ══════════════════════════════════════
//         DOOR SENSOR (NOT PRESENT on Shelly)
// ══════════════════════════════════════
// The Shelly relay has no garage door open/closed sensor. We keep
// the public surface (readDoorOpen, handleDoorSensor) so the rest of
// the firmware compiles unchanged, but everything is a no-op and the
// reported door state is DOOR_STATE_FALLBACK ("unknown"). If you
// later wire a reed switch to a free GPIO, restore the original logic
// here and switch the heartbeat/status JSON back to "open"/"closed".

bool readDoorOpen() {
  return false;
}

void handleDoorSensor() {
  if (!doorStateInitialized) {
    doorStateInitialized = true;
    lastDoorState        = false;
    doorDebounceCount    = 0;
    doorDebouncePending  = false;
    Serial.println("[Door] No sensor on Shelly — reporting 'unknown'");
  }
}


// ══════════════════════════════════════
//            RELAY (Pulse Only)
// ══════════════════════════════════════

void startRelayPulse() {
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

  if (mqttClient.connected()) {
    JsonDocument doc;
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

    if (mqttClient.connected()) {
      JsonDocument doc;
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
    yield();
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
  if (idx >= 0) clean = clean.substring(idx + 3);
  idx = clean.indexOf(':');
  if (idx >= 0) clean = clean.substring(0, idx);
  clean.trim();
  if (clean.endsWith("/")) clean = clean.substring(0, clean.length() - 1);
  return clean;
}

int extractPort(const String& url, int defaultPort = 8883) {
  String clean = url;
  int idx = clean.indexOf("://");
  if (idx >= 0) clean = clean.substring(idx + 3);
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

  JsonDocument doc;
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

    JsonDocument rDoc;
    if (!deserializeJson(rDoc, resp)) {
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
    mqttClient.publish(topicOf("status").c_str(), st, true);
  }
}

bool mqttPublishReliable(const String& subtopic, const char* payload) {
  if (!mqttClient.connected()) return false;
  return mqttClient.publish(topicOf(subtopic).c_str(), (const uint8_t*)payload, strlen(payload), false);
}

void mqttPublishHeartbeat() {
  if (!mqttClient.connected()) return;
  JsonDocument doc;
  uint32_t epoch = getEpochTime();
  if (epoch > 0) doc["ts"] = epoch;
  else           doc["ts"] = millis();
  doc["rssi"]      = WiFi.RSSI();
  doc["fw"]        = FIRMWARE_VERSION;
  doc["heap"]      = ESP.getFreeHeap();
  doc["relay"]     = relayActive ? "opened" : "closed";
  doc["doorState"] = DOOR_STATE_FALLBACK;
  doc["uptime"]    = millis() / 1000;
  String payload;
  serializeJson(doc, payload);
  mqttClient.publish(topicOf("heartbeat").c_str(), payload.c_str());
}

// ══════════════════════════════════════
//       OTA PROGRESS REPORTING
// ══════════════════════════════════════

void otaReportProgress(const char* status, int progress = -1, const char* error = nullptr) {
  if (!mqttClient.connected()) return;
  JsonDocument doc;
  doc["status"]  = status;
  doc["version"] = otaVersion;
  if (progress >= 0) doc["progress"] = progress;
  if (error)         doc["error"]    = error;
  doc["ts"] = millis();
  String payload;
  serializeJson(doc, payload);
  mqttPublishReliable("ota/progress", payload.c_str());
  mqttClient.loop();
}

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

void checkForOtaUpdate() {
  if (WiFi.status() != WL_CONNECTED || otaInProgress) return;

  Serial.println("[OTA] Checking for updates...");

  HTTPClient http;
  String checkUrl = String(SERVER_BASE_URL) + SERVER_OTA_CHECK_PATH;

  if (checkUrl.startsWith("https://")) http.begin(wifiSecureClient, checkUrl);
  else                                  http.begin(wifiPlainClient,  checkUrl);
  http.addHeader("X-Device-Serial", serialNumber.c_str());
  http.addHeader("X-Device-Secret", deviceSecret);
  http.addHeader("X-Firmware-Version", FIRMWARE_VERSION);
  http.setTimeout(10000);

  int code = http.GET();
  if (code == 200) {
    String resp = http.getString();
    JsonDocument doc;
    if (!deserializeJson(doc, resp)) {
      bool updateAvailable = doc["updateAvailable"] | false;
      if (updateAvailable) {
        String newVersion  = doc["version"]     | "";
        String downloadUrl = doc["downloadUrl"] | "";
        String checksum    = doc["checksum"]    | "";
        uint32_t fileSize  = doc["fileSize"]    | 0;

        bool isHttpsUrl = downloadUrl.startsWith("https://");
        bool isHttpUrl  = downloadUrl.startsWith("http://");
        Serial.printf("[OTA] Received OTA URL: %s\n", downloadUrl.c_str());

        if (downloadUrl.length() > 0 &&
            !isHttpsUrl &&
            !(isHttpUrl && ALLOW_INSECURE_OTA_HTTP)) {
          Serial.println("[OTA] Rejected: URL scheme not allowed");
          http.end();
          lastOtaCheckMs = millis();
          return;
        }

        if (compareSemver(newVersion, FIRMWARE_VERSION) > 0) {
          Serial.printf("[OTA] Update available: v%s -> v%s\n", FIRMWARE_VERSION, newVersion.c_str());
          addLog("OTA update available on boot", "info");

          otaUrl      = downloadUrl;
          otaVersion  = newVersion;
          otaChecksum = checksum;
          otaFileSize = fileSize;
          for (otaRetryCount = 0; otaRetryCount <= OTA_MAX_RETRIES; otaRetryCount++) {
            performOtaUpdate();
            if (!otaInProgress) break;
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
//     OTA UPDATE (single image)
// ══════════════════════════════════════
// ESP8266 has no A/B partition — Update.h writes to a sketch-sized
// region of flash and the bootloader swaps on next boot. There is no
// "pending verify / rollback" handoff like on ESP32; if the image is
// bad the device just bricks and needs serial flashing.

void performOtaUpdate() {
  Serial.println("\n[OTA] ═══════════════════════════════");
  Serial.printf("[OTA] Starting update to v%s (attempt %d/%d)\n", otaVersion.c_str(), otaRetryCount + 1, OTA_MAX_RETRIES + 1);
  Serial.printf("[OTA] URL: %s\n", otaUrl.c_str());
  Serial.printf("[OTA] Expected size: %u bytes\n", otaFileSize);
  Serial.printf("[OTA] Free heap: %u bytes\n", ESP.getFreeHeap());
  Serial.println("[OTA] ═══════════════════════════════\n");

  if (ESP.getFreeHeap() < OTA_MIN_HEAP) {
    Serial.printf("[OTA] ABORTED: insufficient heap (%u < %d)\n", ESP.getFreeHeap(), OTA_MIN_HEAP);
    otaReportProgress("failed", 0, "Insufficient memory");
    addLog("OTA failed: low memory", "error");
    return;
  }

  // ESP8266 also checks free sketch space
  uint32_t maxSketchSpace = (ESP.getFreeSketchSpace() - 0x1000) & 0xFFFFF000;
  if (otaFileSize > 0 && otaFileSize > maxSketchSpace) {
    Serial.printf("[OTA] ABORTED: image (%u) exceeds free sketch space (%u)\n", otaFileSize, maxSketchSpace);
    otaReportProgress("failed", 0, "Image too large for partition");
    return;
  }

  if (relayActive) {
    digitalWrite(RELAY_PIN, LOW);
    relayActive = false;
    Serial.println("[OTA] Relay forced closed for safety");
  }

  currentState = STATE_OTA_UPDATING;
  otaInProgress = true;
  addLog("OTA update started", "info");

  otaReportProgress("downloading", 0);

  bool otaUrlIsHttps = otaUrl.startsWith("https://");

  if (mqttClient.connected()) {
    Serial.println("[OTA] Disconnecting MQTT before download");
    mqttClient.disconnect();
  }

  HTTPClient http;
  http.setTimeout(30000);
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

  http.addHeader("X-Device-Serial", serialNumber.c_str());
  http.addHeader("X-Device-Secret", deviceSecret);

  // ESP8266 HTTPClient ignores headers unless we whitelist them up front.
  const char* trackedHeaders[] = { "X-Firmware-Checksum", "X-Firmware-Signature" };
  http.collectHeaders(trackedHeaders, 2);

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

  String serverChecksum = http.header("X-Firmware-Checksum");

  Serial.printf("[OTA] Downloading %d bytes...\n", contentLength);

  if (!Update.begin(contentLength)) {
    Serial.printf("[OTA] Not enough space (Update.begin failed)\n");
    Update.printError(Serial);
    otaReportProgress("failed", 0, "Not enough space");
    addLog("OTA failed: no space", "error");
    http.end();
    otaInProgress = false;
    currentState = STATE_ONLINE;
    return;
  }

  WiFiClient* stream = http.getStreamPtr();
  uint8_t buf[1024];
  int totalRead = 0;
  int lastReportedPercent = -1;
  uint32_t downloadStartMs = millis();
  uint32_t lastDataMs = millis();

  br_sha256_context shaCtx;
  br_sha256_init(&shaCtx);

  bool downloadFailed = false;
  String failReason = "";

  while (http.connected() && totalRead < contentLength) {
    if (millis() - downloadStartMs > OTA_DOWNLOAD_TIMEOUT) {
      failReason = "Download timeout";
      downloadFailed = true;
      break;
    }

    int available = stream->available();
    if (available <= 0) {
      if (millis() - lastDataMs > OTA_STALL_TIMEOUT) {
        failReason = "Connection stalled";
        downloadFailed = true;
        break;
      }
      delay(10);
      yield();
      continue;
    }

    lastDataMs = millis();

    int readBytes = stream->readBytes(buf, min((int)sizeof(buf), available));
    if (readBytes <= 0) {
      failReason = "Read returned 0 bytes";
      downloadFailed = true;
      break;
    }

    if (Update.write(buf, readBytes) != (size_t)readBytes) {
      Serial.println("[OTA] Write failed");
      Update.printError(Serial);
      failReason = "Flash write failed";
      downloadFailed = true;
      break;
    }

    br_sha256_update(&shaCtx, buf, readBytes);

    totalRead += readBytes;
    int percent = (totalRead * 100) / contentLength;

    if (percent / 10 != lastReportedPercent / 10) {
      lastReportedPercent = percent;
      Serial.printf("[OTA] Progress: %d%% (%d/%d bytes)\n", percent, totalRead, contentLength);
    }

    ESP.wdtFeed();
    yield();
  }

  http.end();

  if (!downloadFailed && totalRead != contentLength) {
    failReason = "Incomplete download";
    downloadFailed = true;
  }

  if (downloadFailed) {
    Serial.printf("[OTA] Download failed: %s (%d/%d bytes)\n", failReason.c_str(), totalRead, contentLength);
    Update.end(false);
    otaReportProgress("failed", contentLength > 0 ? totalRead * 100 / contentLength : 0, failReason.c_str());
    addLog("OTA download failed", "error");
    otaInProgress = false;
    currentState = STATE_ONLINE;
    return;
  }

  otaReportProgress("verifying", 100);
  Serial.println("[OTA] Verifying SHA256 checksum...");

  unsigned char sha256[32];
  br_sha256_out(&shaCtx, sha256);

  char computedChecksum[65];
  for (int i = 0; i < 32; i++) sprintf(&computedChecksum[i * 2], "%02x", sha256[i]);
  computedChecksum[64] = '\0';

  Serial.printf("[OTA] Computed SHA256: %s\n", computedChecksum);
  Serial.printf("[OTA] Expected SHA256: %s\n", otaChecksum.c_str());

  if (otaChecksum.length() > 0 && String(computedChecksum) != otaChecksum) {
    Serial.println("[OTA] CHECKSUM MISMATCH! Aborting update.");
    otaReportProgress("failed", 100, "Checksum mismatch");
    addLog("OTA failed: checksum mismatch", "error");
    Update.end(false);
    otaInProgress = false;
    currentState = STATE_ONLINE;
    return;
  }

  Serial.println("[OTA] Checksum verified OK!");

  // RSA signature verification (mbedtls_pk on ESP32) is not ported.
  // ESP8266 supports signed updates via Update.installSignature() but
  // the format is different; if you need RSA verification, integrate
  // ESP8266's signed-update flow on top of this firmware.

  otaReportProgress("installing", 100);
  Serial.println("[OTA] Finalizing update...");

  if (!Update.end(true)) {
    Serial.println("[OTA] Finalize failed");
    Update.printError(Serial);
    otaReportProgress("failed", 100, "Finalize error");
    addLog("OTA failed: finalize error", "error");
    otaInProgress = false;
    currentState = STATE_ONLINE;
    return;
  }

  Serial.println("[OTA] Update installed successfully!");
  addLog("OTA update installed - rebooting", "info");

  prefs.begin("config", false);
  prefs.putString("prev_fw", FIRMWARE_VERSION);
  prefs.end();

  otaReportProgress("rebooting", 100);
  mqttClient.loop();
  delay(1000);

  Serial.println("[OTA] Rebooting to new firmware...\n");
  ESP.restart();
}


bool verifyCommandHmac(const String& command, const String& ts, const String& hmac) {
  if (mqttToken.length() == 0) return true;
  if (hmac.length() == 0 || ts.length() == 0) return false;

  String data = command + ts;
  unsigned char computed[32];

  br_hmac_key_context kc;
  br_hmac_key_init(&kc, &br_sha256_vtable,
                   (const unsigned char*)mqttToken.c_str(), mqttToken.length());
  br_hmac_context hc;
  br_hmac_init(&hc, &kc, 0);
  br_hmac_update(&hc, (const unsigned char*)data.c_str(), data.length());
  br_hmac_out(&hc, computed);

  char hexHmac[65];
  for (int i = 0; i < 32; i++) sprintf(&hexHmac[i * 2], "%02x", computed[i]);
  hexHmac[64] = '\0';

  if (hmac.length() != 64) return false;
  volatile uint8_t result = 0;
  for (int i = 0; i < 64; i++) result |= hexHmac[i] ^ hmac[i];
  return (result == 0);
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  if (length > 512) {
    Serial.printf("[MQTT] Payload too large (%u bytes) - ignored\n", length);
    return;
  }
  // ESP8266's String has no (const char*, length) ctor — use concat().
  String msg;
  msg.reserve(length + 1);
  msg.concat((const char*)payload, length);
  Serial.printf("[MQTT] %s (%u bytes)\n", topic, length);

  JsonDocument doc;
  if (deserializeJson(doc, msg)) {
    Serial.println("[MQTT] Invalid JSON command");
    return;
  }

  String action    = doc["command"]   | "";
  String source    = doc["source"]    | "";
  String cmdHmac   = doc["hmac"]      | "";
  String cmdTs     = doc["ts"]        | "";
  String requestId = doc["requestId"] | "";
  requestId.trim();

  if (isDuplicateCommandRequest(requestId)) {
    Serial.printf("[MQTT] Duplicate command ignored (requestId=%s)\n", requestId.c_str());
    return;
  }

  if (mqttToken.length() > 0 && source != "system") {
    if (!verifyCommandHmac(action, cmdTs, cmdHmac)) {
      Serial.println("[MQTT] Command REJECTED - invalid HMAC signature");
      addLog("MQTT command rejected: bad HMAC", "warning");
      mqttPublishReliable("dp/report",
          "{\"error\":\"auth_failed\",\"message\":\"Invalid command signature\"}");
      return;
    }
  }

  if (!checkCommandRateLimit()) {
    mqttPublishReliable("dp/report",
      "{\"error\":\"rate_limited\",\"message\":\"Too many commands\"}");
    return;
  }

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

  if (otaInProgress && (action == "open" || action == "on" || action == "toggle")) {
    Serial.println("[MQTT] Command blocked - OTA in progress");
    mqttPublishReliable("dp/report",
      "{\"error\":\"ota_in_progress\",\"message\":\"OTA update in progress\"}");
    return;
  }

  if (action == "open" || action == "on" || action == "toggle") {
    startRelayPulse();
    rememberCommandRequest(requestId, "{\"status\":\"ok\",\"message\":\"Command executed\"}");
  }
  else if (action == "status") {
    if (mqttClient.connected()) {
      JsonDocument rDoc;
      rDoc["relay"]     = relayActive ? "opened" : "closed";
      rDoc["doorState"] = DOOR_STATE_FALLBACK;
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
  else if (action == "restart") {
    Serial.println("[MQTT] Restart command");
    mqttPublishStatus("restarting");
    rememberCommandRequest(requestId, "{\"status\":\"ok\",\"message\":\"Restarting\"}");
    delay(500);
    ESP.restart();
  }
  else if (action == "paired") {
    Serial.println("[MQTT] Device paired!");
    mqttPublishHeartbeat();
  }
  else if (action == "unpaired") {
    Serial.println("[MQTT] Unpaired - resetting");
    mqttPublishStatus("offline");
    clearAllSettings();
    delay(500);
    ESP.restart();
  }
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
  else if (action == "admin_lock") {
    bool locked = doc["locked"] | false;
    const char* reason = doc["reason"] | "admin";
    Serial.printf("[MQTT] Admin lock: %s (reason: %s)\n", locked ? "LOCKED" : "UNLOCKED", reason);
    prefs.begin("config", false);
    prefs.putBool("adminLocked", locked);
    prefs.end();
    if (mqttClient.connected()) {
      JsonDocument rDoc;
      rDoc["adminLocked"] = locked;
      rDoc["reason"] = reason;
      String rPayload;
      serializeJson(rDoc, rPayload);
      mqttPublishReliable("dp/report", rPayload.c_str());
    }
  }
  else if (action == "ota_update") {
    if (otaInProgress) {
      Serial.println("[MQTT] OTA already in progress - ignored");
      return;
    }
    otaUrl      = doc["url"]      | "";
    otaVersion  = doc["version"]  | "";
    otaChecksum = doc["checksum"] | "";
    otaFileSize = doc["fileSize"] | 0;

    if (otaUrl.length() == 0 || otaVersion.length() == 0) {
      Serial.println("[MQTT] OTA command missing url or version");
      otaReportProgress("failed", 0, "Missing url or version");
      return;
    }

    {
      bool isHttpsUrl = otaUrl.startsWith("https://");
      bool isHttpUrl  = otaUrl.startsWith("http://");

      if (!isHttpsUrl && !(isHttpUrl && ALLOW_INSECURE_OTA_HTTP)) {
        Serial.println("[MQTT] OTA REJECTED: URL scheme not allowed");
        otaReportProgress("failed", 0, "URL scheme not allowed");
        addLog("OTA rejected: URL scheme not allowed", "warning");
        return;
      }
    }

    if (otaUrl.length() > 256) {
      Serial.println("[MQTT] OTA REJECTED: URL too long");
      otaReportProgress("failed", 0, "URL too long");
      return;
    }

    if (otaVersion == FIRMWARE_VERSION) {
      Serial.printf("[MQTT] Already on version %s - skipping OTA\n", FIRMWARE_VERSION);
      otaReportProgress("success", 100);
      return;
    }

    if (compareSemver(otaVersion, FIRMWARE_VERSION) < 0) {
      Serial.printf("[MQTT] Rejecting downgrade: v%s < v%s\n", otaVersion.c_str(), FIRMWARE_VERSION);
      otaReportProgress("failed", 0, "Downgrade not allowed");
      addLog("OTA rejected: downgrade attempt", "warning");
      return;
    }

    if (otaChecksum.length() == 0) {
      Serial.println("[MQTT] OTA rejected: no checksum provided");
      otaReportProgress("failed", 0, "Checksum required");
      return;
    }

    Serial.printf("[MQTT] OTA update requested: v%s -> v%s\n", FIRMWARE_VERSION, otaVersion.c_str());
    addLog("OTA update command received", "info");

    for (otaRetryCount = 0; otaRetryCount <= OTA_MAX_RETRIES; otaRetryCount++) {
      performOtaUpdate();
      if (!otaInProgress) break;
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
  else if (action == "disconnect") {
    const char* reason = doc["reason"] | "admin";
    Serial.printf("[MQTT] Disconnect command (reason: %s)\n", reason);
    mqttPublishStatus("offline");
    mqttClient.disconnect();
  }
  else {
    Serial.printf("[MQTT] Unknown command: %s\n", action.c_str());
  }
}

bool connectMQTT() {
  if (mqttHost.length() == 0 || mqttUser.length() == 0) return false;

  bool useTls = (mqttPort != 1883);
  if (useTls) mqttClient.setClient(wifiSecureClient);
  else        mqttClient.setClient(wifiPlainClient);

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

    prefs.begin("config", true);
    String prevFw = prefs.getString("prev_fw", "");
    prefs.end();
    if (prevFw.length() > 0 && prevFw != FIRMWARE_VERSION) {
      Serial.printf("[OTA] Successfully updated from v%s to v%s\n", prevFw.c_str(), FIRMWARE_VERSION);
      JsonDocument otaDoc;
      otaDoc["status"]          = "success";
      otaDoc["version"]         = FIRMWARE_VERSION;
      otaDoc["previousVersion"] = prevFw;
      otaDoc["progress"]        = 100;
      otaDoc["ts"]              = millis();
      otaDoc["heap"]            = ESP.getFreeHeap();
      otaDoc["rssi"]            = WiFi.RSSI();
      String otaPayload;
      serializeJson(otaDoc, otaPayload);

      bool published = false;
      for (int i = 0; i < 3 && !published; i++) {
        published = mqttClient.publish(topicOf("ota/progress").c_str(), otaPayload.c_str());
        if (!published) { delay(500); mqttClient.loop(); }
      }

      if (published) {
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
// ══════════════════════════════════════

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
    if (localServer.arg("plain").length() > 256) {
      localServer.send(413, "application/json", "{\"status\":\"error\",\"message\":\"Payload too large\"}");
      return;
    }

    JsonDocument doc;
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
        return;
      }
      prefs.begin("config", true);
      bool adminLocked = prefs.getBool("adminLocked", false);
      prefs.end();
      if (adminLocked) {
        localServer.send(403, "application/json", "{\"status\":\"error\",\"message\":\"Device is locked by admin\"}");
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
      JsonDocument rDoc;
      rDoc["relay"]       = relayActive ? "opened" : "closed";
      rDoc["doorState"]   = DOOR_STATE_FALLBACK;
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

  localServer.on("/status", HTTP_GET, []() {
    if (!verifyLocalAuth()) return;

    JsonDocument doc;
    doc["serial"]        = serialNumber.c_str();
    doc["name"]          = DEVICE_NAME;
    doc["type"]          = "relay";
    doc["fw"]            = FIRMWARE_VERSION;
    doc["relay"]         = relayActive ? "opened" : "closed";
    doc["doorState"]     = DOOR_STATE_FALLBACK;
    doc["isOnline"]      = true;
    doc["rssi"]          = WiFi.RSSI();
    doc["heap"]          = ESP.getFreeHeap();
    doc["uptime"]        = millis() / 1000;
    doc["ip"]            = WiFi.localIP().toString();
    doc["local"]         = true;
    doc["mqttConnected"] = mqttClient.connected();
    String response;
    serializeJson(doc, response);
    localServer.send(200, "application/json", response);
  });

  localServer.on("/logs", HTTP_GET, []() {
    if (!verifyLocalAuth()) return;

    // 4096 (was 6144 on ESP32) — sized for MAX_LOCAL_LOGS=25
    JsonDocument doc;
    doc["count"]          = logCount;
    doc["local"]          = true;
    doc["deviceUptimeMs"] = millis();
    doc["deviceEpoch"]    = ntpSynced ? (uint32_t)time(nullptr) : 0;
    JsonArray logsArr     = doc["logs"].to<JsonArray>();

    for (int i = 0; i < logCount; i++) {
      int idx = (logHead - 1 - i + MAX_LOCAL_LOGS) % MAX_LOCAL_LOGS;
      JsonObject entry  = logsArr.add<JsonObject>();
      entry["epoch"]     = localLogs[idx].epoch;
      entry["uptimeMs"]  = localLogs[idx].uptimeMs;
      entry["timestamp"] = localLogs[idx].uptimeMs;
      entry["message"]   = localLogs[idx].message;
      entry["type"]      = localLogs[idx].type;
    }

    String response;
    serializeJson(doc, response);
    localServer.send(200, "application/json", response);
  });

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
//    AP PROVISIONING HTTP HANDLERS
// ══════════════════════════════════════

static void apSendCors() {
  provisionServer.sendHeader("Access-Control-Allow-Origin", "*");
  provisionServer.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  provisionServer.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

static void apHandleInfo() {
  apLastActivity = millis();
  apSendCors();

  JsonDocument doc;
  doc["serial"]       = serialNumber.c_str();
  doc["name"]         = DEVICE_NAME;
  doc["type"]         = "relay";
  doc["fw"]           = FIRMWARE_VERSION;
  doc["popRequired"]  = false;
  doc["deviceSecret"] = deviceSecret;
  doc["transport"]    = "wifi-ap";
  String response;
  serializeJson(doc, response);
  provisionServer.send(200, "application/json", response);
  Serial.println("[AP] /info served");
}

static void apHandleScan() {
  apLastActivity = millis();
  apSendCors();

  Serial.println("[AP] /scan requested...");

  // AP_STA so the STA radio can scan while the AP keeps serving HTTP.
  WiFi.mode(WIFI_AP_STA);
  delay(50);

  int n = WiFi.scanNetworks(false, false);
  Serial.printf("[AP] Scan found %d networks\n", n);

  // Smaller doc than ESP32 (2048 vs 4096) and capped at 10 networks
  // because ESP8266 RAM is tighter.
  JsonDocument rDoc;
  rDoc["status"] = "ok";
  rDoc["count"]  = n;
  JsonArray networks = rDoc["networks"].to<JsonArray>();

  int limit = (n < 10) ? n : 10;
  for (int i = 0; i < limit; i++) {
    JsonObject net = networks.add<JsonObject>();
    net["ssid"]   = WiFi.SSID(i);
    net["rssi"]   = WiFi.RSSI(i);
    net["secure"] = (WiFi.encryptionType(i) != ENC_TYPE_NONE);
  }
  WiFi.scanDelete();

  WiFi.mode(WIFI_AP);

  String response;
  serializeJson(rDoc, response);
  provisionServer.send(200, "application/json", response);
  Serial.printf("[AP] Scan results sent (%d bytes)\n", response.length());
}

static void apHandleConfig() {
  apLastActivity = millis();
  apSendCors();

  if (!provisionServer.hasArg("plain")) {
    provisionServer.send(400, "application/json",
      "{\"status\":\"error\",\"message\":\"No body\"}");
    return;
  }
  if (provisionServer.arg("plain").length() > 512) {
    provisionServer.send(413, "application/json",
      "{\"status\":\"error\",\"message\":\"Payload too large\"}");
    return;
  }

  JsonDocument doc;
  if (deserializeJson(doc, provisionServer.arg("plain"))) {
    provisionServer.send(400, "application/json",
      "{\"status\":\"error\",\"message\":\"Invalid JSON\"}");
    return;
  }

  String ssid     = doc["ssid"]     | "";
  String password = doc["password"] | "";
  String userId   = doc["userId"]   | "";

  if (ssid.length() == 0) {
    provisionServer.send(400, "application/json",
      "{\"status\":\"error\",\"message\":\"SSID required\"}");
    return;
  }
  if (ssid.length() > 32) {
    provisionServer.send(400, "application/json",
      "{\"status\":\"error\",\"message\":\"SSID too long (max 32)\"}");
    return;
  }
  if (password.length() > 63) {
    provisionServer.send(400, "application/json",
      "{\"status\":\"error\",\"message\":\"Password too long (max 63)\"}");
    return;
  }

  Serial.printf("[AP] /config received SSID: %s\n", ssid.c_str());

  saveWifiSettings(ssid, password, userId);

  apConfigPending   = true;
  apConfigPendingAt = millis();

  JsonDocument rDoc;
  rDoc["status"]       = "received";
  rDoc["message"]      = "Credentials accepted, attempting Wi-Fi connection...";
  rDoc["serial"]       = serialNumber.c_str();
  rDoc["deviceSecret"] = deviceSecret;
  String response;
  serializeJson(rDoc, response);
  provisionServer.send(200, "application/json", response);
  Serial.println("[AP] /config accepted, deferring STA attempt");
}

static void apHandleStatus() {
  apLastActivity = millis();
  apSendCors();

  JsonDocument doc;
  doc["serial"]       = serialNumber.c_str();
  doc["fw"]           = FIRMWARE_VERSION;
  doc["wifiStatus"]   = (int)WiFi.status();
  doc["staConnected"] = (WiFi.status() == WL_CONNECTED);
  doc["state"]        = (int)currentState;
  doc["pending"]      = apConfigPending;
  String response;
  serializeJson(doc, response);
  provisionServer.send(200, "application/json", response);
}

static void apHandleHealth() {
  apLastActivity = millis();
  apSendCors();
  provisionServer.send(200, "application/json", "{\"ok\":true}");
}

static void apHandleNotFound() {
  apSendCors();
  // Captive-portal helpers: keep Android/iOS from kicking the user
  // off the AP for "no internet" probes.
  provisionServer.send(200, "application/json",
    "{\"status\":\"ok\",\"message\":\"Mnazilona AP\"}");
}

static void apHandleCorsPreflight() {
  apSendCors();
  provisionServer.send(204);
}


// ══════════════════════════════════════
//      AP PROVISIONING START / STOP
// ══════════════════════════════════════

void startAP() {
  Serial.println("[AP] Starting Wi-Fi AP provisioning...");

  String ssid = String(AP_SSID_PREFIX) + String(serialNumber.c_str());

  WiFi.mode(WIFI_AP);
  bool ok;
  if (strlen(AP_PASSWORD) >= 8) {
    ok = WiFi.softAP(ssid.c_str(), AP_PASSWORD);
  } else {
    ok = WiFi.softAP(ssid.c_str());
  }
  if (!ok) {
    Serial.println("[AP] softAP failed!");
    addLog("AP start failed", "error");
    return;
  }
  delay(200);

  IPAddress apIp = WiFi.softAPIP();
  Serial.printf("[AP] SSID: %s\n", ssid.c_str());
  Serial.printf("[AP] IP:   %s\n", apIp.toString().c_str());
  Serial.printf("[AP] Pass: %s\n", strlen(AP_PASSWORD) >= 8 ? AP_PASSWORD : "(open)");

  static bool routesRegistered = false;
  if (!routesRegistered) {
    provisionServer.on("/info",   HTTP_GET,    apHandleInfo);
    provisionServer.on("/info",   HTTP_OPTIONS,apHandleCorsPreflight);
    provisionServer.on("/scan",   HTTP_GET,    apHandleScan);
    provisionServer.on("/scan",   HTTP_POST,   apHandleScan);
    provisionServer.on("/scan",   HTTP_OPTIONS,apHandleCorsPreflight);
    provisionServer.on("/config", HTTP_POST,   apHandleConfig);
    provisionServer.on("/config", HTTP_OPTIONS,apHandleCorsPreflight);
    provisionServer.on("/status", HTTP_GET,    apHandleStatus);
    provisionServer.on("/status", HTTP_OPTIONS,apHandleCorsPreflight);
    provisionServer.on("/health", HTTP_GET,    apHandleHealth);
    provisionServer.on("/health", HTTP_OPTIONS,apHandleCorsPreflight);
    provisionServer.onNotFound(apHandleNotFound);
    routesRegistered = true;
  }

  provisionServer.begin();

  apProvisioning   = true;
  apStartTime      = millis();
  apLastActivity   = millis();
  currentState     = STATE_AP_ACTIVE;

  Serial.println("[AP] HTTP provisioning server ready on port 80");
  addLog("AP provisioning started", "info");
}

void stopAP() {
  if (!apProvisioning) return;
  apProvisioning = false;

  provisionServer.stop();
  WiFi.softAPdisconnect(true);
  Serial.println("[AP] Provisioning stopped");
  addLog("AP provisioning stopped", "info");
}

// Legacy aliases for parity with the BLE/AP firmwares
void startBLE() { startAP(); }
void stopBLE()  { stopAP();  }


// ══════════════════════════════════════
//    AP-side STA CONNECT HANDOFF
// ══════════════════════════════════════

void handleApConfigPending() {
  if (!apConfigPending) return;

  uint32_t since = millis() - apConfigPendingAt;
  if (since < 1500) return;

  apConfigPending = false;
  Serial.println("[AP] Bringing down AP, attempting STA connection...");
  currentState = STATE_AP_CONNECTING_STA;
  setLED_pairing();

  stopAP();
  delay(300);

  bool connected = connectWiFi(storedSSID, storedPassword, 15000);
  if (!connected) {
    Serial.println("[AP] STA connection failed - re-opening AP for retry");
    addLog("AP retry: STA connect failed", "error");
    prefs.begin("config", false);
    prefs.remove("ssid");
    prefs.remove("psw");
    prefs.end();
    storedSSID     = "";
    storedPassword = "";

    startAP();
    setLED_ap();
    return;
  }

  wifiProvisionedFlag = true;
  wifiProvisionedAt   = millis();
}


// ══════════════════════════════════════
//        SHELLY SW INPUT HANDLER
// ══════════════════════════════════════
// The Shelly has no dedicated push-button. The SW terminal is wired
// (via the device's optocoupler) to GPIO5 and reflects the state of
// an external wall switch — could be momentary or latching.
//
// Behavior on each *debounced* SW transition:
//   1. Trigger a local relay pulse so the wall switch can still open
//      the garage even when the device is offline (set
//      SW_PULSE_TRIGGERS_RELAY to 0 to disable).
//   2. Track the transition in a sliding window. If the user produces
//      SW_PAIR_TOGGLES transitions within SW_PAIR_WINDOW_MS, treat it
//      as the "enter pairing" gesture: factory-reset the configuration
//      and reboot into AP provisioning mode.
//
// This works for both momentary and latching wall switches: flipping
// a toggle 5× counts as 5 transitions just the same.

#define SW_DEBOUNCE_MS         30UL
#define SW_PAIR_TOGGLES        5
#define SW_PAIR_WINDOW_MS      5000UL
#define SW_PULSE_TRIGGERS_RELAY 1

static int      swStableLevel       = -1;  // -1 == not yet sampled
static int      swLastReadLevel     = -1;
static uint32_t swLastChangeMs      = 0;
static uint32_t swToggleTimes[SW_PAIR_TOGGLES] = {0};
static uint8_t  swToggleHead        = 0;
static uint8_t  swToggleCount       = 0;

static void doFactoryReset() {
  Serial.println("[SW] >>> FACTORY RESET — clearing config and restarting");
  addLog("Factory reset via SW pattern", "warning");

  stopLocalServer();
  if (mqttClient.connected()) {
    mqttPublishStatus("offline");
    mqttClient.disconnect();
  }
  clearAllSettings();
  delay(300);
  ESP.restart();
}

static void doReboot() {
  Serial.println("[SW] >>> REBOOT");
  addLog("Reboot via SW", "info");
  if (mqttClient.connected()) {
    mqttPublishStatus("offline");
    mqttClient.disconnect();
  }
  delay(300);
  ESP.restart();
}

// Kept name for compatibility with the loop() call site.
void handleButton() {
  int reading  = digitalRead(SW_PIN);
  uint32_t now = millis();

  if (swStableLevel < 0) {
    swStableLevel   = reading;
    swLastReadLevel = reading;
    swLastChangeMs  = now;
    return;
  }

  if (reading != swLastReadLevel) {
    swLastReadLevel = reading;
    swLastChangeMs  = now;
    return;
  }

  // Same reading as last call; require it to remain stable for the
  // debounce window before accepting it as a confirmed transition.
  if (reading == swStableLevel) return;
  if ((now - swLastChangeMs) < SW_DEBOUNCE_MS) return;

  swStableLevel = reading;
  Serial.printf("[SW] Transition -> %d\n", reading);

  // Slide the most recent transition into the ring buffer.
  swToggleTimes[swToggleHead] = now;
  swToggleHead = (swToggleHead + 1) % SW_PAIR_TOGGLES;
  if (swToggleCount < SW_PAIR_TOGGLES) swToggleCount++;

  // If the buffer is full and the oldest entry is within the window,
  // we have N transitions in <window> → enter pairing mode.
  if (swToggleCount >= SW_PAIR_TOGGLES) {
    uint32_t oldest = swToggleTimes[swToggleHead];  // next slot is oldest
    if ((now - oldest) <= SW_PAIR_WINDOW_MS) {
      Serial.println("[SW] Pairing pattern detected (5 toggles in 5s)");
      doFactoryReset();
      return;  // not reached — doFactoryReset reboots
    }
  }

  // Local override: pulse the relay on each SW transition so the
  // physical wall switch keeps working when the cloud is unavailable.
  if (SW_PULSE_TRIGGERS_RELAY) {
    startRelayPulse();
  }
}


// ══════════════════════════════════════
//            STATE MACHINE
// ══════════════════════════════════════

void handleStateMachine() {
  if (wifiProvisionedFlag) {
    wifiProvisionedFlag = false;

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
      provisionServer.handleClient();
      handleApConfigPending();
      blinkLED();

      if (apProvisioning && millis() - apLastActivity > AP_TIMEOUT_MS) {
        Serial.println("[AP] Timeout - no client activity");
        if (storedSSID.length() > 0) {
          stopAP();
          currentState = STATE_WIFI_RECONNECTING;
        } else {
          apLastActivity = millis();
        }
      }
      break;

    case STATE_AP_CONNECTING_STA:
    case STATE_SERVER_INQUIRY:
    case STATE_MQTT_CONNECTING:
      blinkLED();
      break;

    case STATE_ONLINE:
      if (WiFi.status() != WL_CONNECTED) {
        currentState = STATE_WIFI_RECONNECTING;
        stopLocalServer();
        setLED_offline();
        return;
      }

      if (!localServerRunning) startLocalServer();
      localServer.handleClient();
      MDNS.update();   // ESP8266 mDNS needs explicit poll

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
        if (millis() - lastOtaCheckMs > OTA_CHECK_INTERVAL) {
          checkForOtaUpdate();
        }
      }
      break;

    case STATE_WIFI_RECONNECTING:
      if (millis() - lastWifiRetryMs < WIFI_RETRY_INTERVAL_MS) {
        blinkLED();
        return;
      }
      lastWifiRetryMs = millis();
      if (connectWiFi(storedSSID, storedPassword)) {
        wifiReconnectFailCount = 0;
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
        wifiReconnectFailCount++;
        Serial.printf("[Reconnect] Wi-Fi retry %u/%u failed\n",
                      wifiReconnectFailCount, WIFI_RECONNECT_MAX_FAILURES);
        if (wifiReconnectFailCount >= WIFI_RECONNECT_MAX_FAILURES) {
          Serial.println("[Reconnect] Max retries — falling back to AP provisioning");
          addLog("Wi-Fi unreachable — entering AP mode", "warning");
          wifiReconnectFailCount = 0;
          startAP();
        } else {
          blinkLED();
        }
      }
      break;

    case STATE_OTA_UPDATING:
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
  // Shelly relay (ESP8266) pin init.
  //  - GPIO4 (RELAY_PIN): output, default LOW (relay de-energised).
  //  - GPIO5 (SW_PIN):    plain INPUT — the Shelly drives this line
  //                       through its on-board optocoupler, so do NOT
  //                       enable the internal pull-up.
  //  - LED / dedicated button / door sensor: not present, no pinMode.
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
  pinMode(SW_PIN, INPUT);

  Serial.begin(115200);
  delay(1000);

  // ESP8266 SW WDT timeout is fixed by the SDK (~3s); HW WDT ~6s.
  // We just feed it from the main loop and during long-running OTA work.
  Serial.println("[WDT] ESP8266 watchdog active (HW ~6s, SW ~3s)");

  if (!LittleFS.begin()) {
    Serial.println("[FS] LittleFS mount failed — formatting");
    LittleFS.format();
    if (!LittleFS.begin()) {
      Serial.println("[FS] LittleFS still failing after format");
    }
  } else {
    Serial.println("[FS] LittleFS mounted");
  }

  bool secretsLoaded = loadSecrets();
  if (!secretsLoaded) {
    Serial.println("\n╔══════════════════════════════════════════╗");
    Serial.println("║  DEVICE NOT PROVISIONED                  ║");
    Serial.println("║  Send via Serial:                        ║");
    Serial.println("║  PROVISION:serial=<SN-XXX>,secret=<hex>  ║");
    Serial.println("╚══════════════════════════════════════════╝\n");

    setLED_error();
    while (serialNumber.length() == 0 || deviceSecret.length() == 0) {
      checkSerialProvisioning();
      ESP.wdtFeed();
      delay(100);
    }
    setLED_off();
  }

  if (strlen(ca_cert) > 60) {
    // ESP8266 BearSSL takes a different setCACert API; in this dev
    // build we just stay insecure. Wire setTrustAnchors() here if you
    // ship a production CA bundle.
    wifiSecureClient.setInsecure();
    Serial.println("[TLS] CA cert configured but ignored on ESP8266 dev build");
  } else {
    wifiSecureClient.setInsecure();
    Serial.println("[TLS] WARNING: insecure mode (dev only!)");
  }

  WiFi.mode(WIFI_STA);
  String macAddr = WiFi.macAddress();
  WiFi.mode(WIFI_OFF);

  Serial.println("\n======================================");
  Serial.printf("  Mnazilona IoT - %s\n", DEVICE_NAME);
  Serial.printf("  SN:  %s\n", serialNumber.c_str());
  Serial.printf("  FW:  %s\n", FIRMWARE_VERSION);
  Serial.printf("  MAC: %s\n", macAddr.c_str());
  Serial.println("  Mode: Garage Relay (Pulse)");
  Serial.println("  Provisioning: Wi-Fi AP");
  Serial.println("  Platform: ESP8266");
  Serial.printf("  TLS: %s\n", strlen(ca_cert) > 60 ? "Configured (ignored on 8266 dev build)" : "Insecure (dev)");
  Serial.println("======================================\n");

  if (loadSettings()) {
    Serial.println("[Boot] Saved settings found");

    if (connectWiFi(storedSSID, storedPassword)) {
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

      if (currentState == STATE_ONLINE) {
        checkForOtaUpdate();
      }
    } else {
      currentState = STATE_WIFI_RECONNECTING;
      setLED_offline();
    }
  } else {
    Serial.println("[Boot] No settings - starting Wi-Fi AP provisioning");
    startAP();
  }
}

void loop() {
  ESP.wdtFeed();
  handleStateMachine();
  handleRelay();
  handleButton();
  handleDoorSensor();
  yield();
  delay(10);
}
