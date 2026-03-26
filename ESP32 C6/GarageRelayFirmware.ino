/**
 * ═══════════════════════════════════════════════════════════════
 *  Manazel IoT - ESP32-C6 Firmware v1.0.0
 *  SoftAP + HTTP Provisioning + Proof of Possession + DeviceSecret
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
 * ═══════════════════════════════════════════════════════════════
 */

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <ESPmDNS.h>

// ═══════════════════════════════════════
// CONFIG - غيّر هالقيم لكل جهاز
// ═══════════════════════════════════════
#define SERIAL_NUMBER     "SN-001"
#define DEVICE_NAME       "Garage Relay"
#define DEVICE_SECRET     "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
#define FIRMWARE_VERSION  "1.0.0"
#define POP_CODE          "123456"

// Production: use HTTPS
// #define SERVER_URL     "https://api.manazel.app/devices/inquiry"
#define SERVER_URL        "http://91.98.207.169/devices/inquiry"

// ═══════════════════════════════════════
// SoftAP Settings
// ═══════════════════════════════════════
#define AP_SSID           "Mnazilona_Setup"
#define AP_PASSWORD       "manazel123"
#define AP_CHANNEL        6
#define AP_MAX_CLIENTS    1
#define AP_IP             IPAddress(192, 168, 4, 1)
#define AP_GATEWAY        IPAddress(192, 168, 4, 1)
#define AP_SUBNET         IPAddress(255, 255, 255, 0)

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
#define AP_TIMEOUT_MS            300000UL

// ═══════════════════════════════════════
// Security
// ═══════════════════════════════════════
#define MAX_POP_ATTEMPTS      5
#define POP_LOCKOUT_MS        60000UL
#define MQTT_MAX_RECONNECTS   3

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
  STATE_ERROR,
};

// ═══════════════════════════════════════
// Globals
// ═══════════════════════════════════════
DeviceState currentState   = STATE_BOOT;
bool popVerified           = false;
int popAttempts            = 0;
uint32_t popLockoutUntil   = 0;

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);
WebServer server(80);
WebServer localServer(8080);  // Local API server (runs when online)
bool localServerRunning = false;
Preferences prefs;

String storedSSID = "", storedPassword = "";
String mqttHost = "", mqttUser = "", mqttPass = "", mqttToken = "";
String pairingUserId = "";
int mqttPort = 1883;

uint32_t relayOffTime        = 0;
uint32_t lastHeartbeatMs     = 0;
uint32_t lastMqttReconnectMs = 0;
uint32_t lastWifiRetryMs     = 0;
uint32_t apStartTime         = 0;
uint32_t lastLedToggle       = 0;
uint32_t lastApActivity      = 0;
uint32_t lastDoorCheckMs     = 0;
bool ledToggleState          = false;
int mqttReconnectCount       = 0;
bool lastDoorState           = false;  // false = closed, true = open
bool doorStateInitialized    = false;


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

bool loadSettings() {
  prefs.begin("config", true);
  storedSSID     = prefs.getString("ssid", "");
  storedPassword = prefs.getString("psw", "");
  mqttHost       = prefs.getString("mq_host", "");
  mqttUser       = prefs.getString("mq_user", "");
  mqttPass       = prefs.getString("mq_pass", "");
  mqttToken      = prefs.getString("mq_token", "");
  mqttPort       = prefs.getInt("mq_port", 1883);
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
  mqttPort  = 1883;
  mqttUser  = "";
  mqttPass  = "";
  mqttToken = "";
  pairingUserId = "";
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

  // أول قراءة أو تغيّرت الحالة
  if (!doorStateInitialized || currentOpen != lastDoorState) {
    lastDoorState = currentOpen;
    doorStateInitialized = true;

    const char* state = currentOpen ? "open" : "closed";
    Serial.printf("[Door] State: %s\n", state);

    char logMsg[40];
    snprintf(logMsg, sizeof(logMsg), "Door sensor: %s", state);
    addLog(logMsg, currentOpen ? "warning" : "info");

    // أرسل حالة الباب عبر MQTT
    if (mqttClient.connected()) {
      StaticJsonDocument<128> doc;
      doc["doorState"] = state;
      doc["ts"] = millis();
      String payload;
      serializeJson(doc, payload);
      mqttClient.publish(topicOf("dp/report").c_str(), payload.c_str());
    }
  }
}


// ══════════════════════════════════════
//            RELAY (Pulse Only)
// ══════════════════════════════════════

void startRelayPulse() {
  // لو الريلاي شغال - تجاهل (حماية من الضغط المتكرر)
  if (relayOffTime > 0) {
    Serial.println("[Relay] Already pulsing - ignored");
    addLog("Open command ignored - already pulsing", "warning");
    return;
  }

  digitalWrite(RELAY_PIN, HIGH);
  setLED_action();
  relayOffTime = millis() + RELAY_PULSE_MS;
  Serial.println("[Relay] OPEN (2s pulse)");
  addLog("Relay OPENED (2s pulse)", "info");

  // أبلغ السيرفر إن الباب انفتح
  if (mqttClient.connected()) {
    StaticJsonDocument<128> doc;
    doc["relay"] = "opened";
    doc["ts"]    = millis();
    String payload;
    serializeJson(doc, payload);
    mqttClient.publish(topicOf("dp/report").c_str(), payload.c_str());
  }
}

void handleRelay() {
  if (relayOffTime > 0 && millis() >= relayOffTime) {
    digitalWrite(RELAY_PIN, LOW);
    relayOffTime = 0;
    Serial.println("[Relay] CLOSED (auto)");
    addLog("Relay CLOSED (auto)", "info");
    if (currentState == STATE_ONLINE) setLED_online();

    // أبلغ السيرفر إن الباب قفل
    if (mqttClient.connected()) {
      StaticJsonDocument<128> doc;
      doc["relay"] = "closed";
      doc["ts"]    = millis();
      String payload;
      serializeJson(doc, payload);
      mqttClient.publish(topicOf("dp/report").c_str(), payload.c_str());
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

int extractPort(const String& url, int defaultPort = 1883) {
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
  if (!http.begin(SERVER_URL)) return INQUIRY_FAIL;

  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);

  StaticJsonDocument<384> doc;
  doc["serialNumber"] = SERIAL_NUMBER;
  doc["deviceSecret"] = DEVICE_SECRET;
  doc["macAddress"]   = WiFi.macAddress();
  if (pairingUserId.length() > 0) {
    doc["userId"] = pairingUserId;
  }

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  if (code == 200) {
    String resp = http.getString();
    Serial.printf("[Server] Response: %s\n", resp.c_str());

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
  return String("manazel/devices/") + SERIAL_NUMBER + "/" + leaf;
}

void mqttPublishStatus(const char* st) {
  if (mqttClient.connected()) {
    mqttClient.publish(topicOf("status").c_str(), st, true);
  }
}

void mqttPublishHeartbeat() {
  if (!mqttClient.connected()) return;
  StaticJsonDocument<192> doc;
  doc["ts"]    = millis();
  doc["rssi"]  = WiFi.RSSI();
  doc["fw"]    = FIRMWARE_VERSION;
  doc["heap"]  = ESP.getFreeHeap();
  doc["relay"] = (relayOffTime > 0) ? "opened" : "closed";
  doc["doorState"] = lastDoorState ? "open" : "closed";
  String payload;
  serializeJson(doc, payload);
  mqttClient.publish(topicOf("heartbeat").c_str(), payload.c_str());
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  Serial.printf("[MQTT] %s: %s\n", topic, msg.c_str());

  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, msg)) {
    Serial.println("[MQTT] Invalid JSON command");
    return;
  }

  String action = doc["command"] | "";

  // ── open / on / toggle = نفس الشي: pulse ثانيتين ──
  if (action == "open" || action == "on" || action == "toggle") {
    startRelayPulse();
  }
  // ── status = أرسل حالة الجهاز ──
  else if (action == "status") {
    if (mqttClient.connected()) {
      StaticJsonDocument<192> rDoc;
      rDoc["relay"]     = (relayOffTime > 0) ? "opened" : "closed";
      rDoc["doorState"] = lastDoorState ? "open" : "closed";
      rDoc["rssi"]      = WiFi.RSSI();
      rDoc["heap"]      = ESP.getFreeHeap();
      rDoc["fw"]        = FIRMWARE_VERSION;
      rDoc["uptime"]    = millis() / 1000;
      String rPayload;
      serializeJson(rDoc, rPayload);
      mqttClient.publish(topicOf("dp/report").c_str(), rPayload.c_str());
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
  else {
    Serial.printf("[MQTT] Unknown command: %s\n", action.c_str());
  }
}

bool connectMQTT() {
  if (mqttHost.length() == 0 || mqttUser.length() == 0) return false;

  mqttClient.setServer(mqttHost.c_str(), mqttPort);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(512);

  String cid = String(SERIAL_NUMBER) + "-" + String(random(0xFFFF), HEX);
  Serial.printf("[MQTT] Connecting to %s:%d as %s...\n", mqttHost.c_str(), mqttPort, mqttUser.c_str());

  if (mqttClient.connect(cid.c_str(), mqttUser.c_str(), mqttPass.c_str(),
                          topicOf("status").c_str(), 1, true, "offline")) {
    mqttClient.subscribe(topicOf("command").c_str(), 1);
    mqttPublishStatus("online");
    mqttPublishHeartbeat();
    mqttReconnectCount = 0;
    Serial.println("[MQTT] Connected!");
    addLog("MQTT connected to broker", "info");
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

void startLocalServer() {
  if (localServerRunning) return;

  // mDNS: broadcast as "manazel-SN-001.local"
  String hostname = "manazel-" + String(SERIAL_NUMBER);
  hostname.toLowerCase();
  hostname.replace(" ", "-");

  if (MDNS.begin(hostname.c_str())) {
    // Register mDNS service: _manazel._tcp with TXT records
    MDNS.addService("manazel", "tcp", 8080);
    MDNS.addServiceTxt("manazel", "tcp", "serial", SERIAL_NUMBER);
    MDNS.addServiceTxt("manazel", "tcp", "sn", SERIAL_NUMBER);
    MDNS.addServiceTxt("manazel", "tcp", "type", "relay");
    MDNS.addServiceTxt("manazel", "tcp", "fw", FIRMWARE_VERSION);
    Serial.printf("[mDNS] Broadcasting: %s.local:8080\n", hostname.c_str());
  } else {
    Serial.println("[mDNS] Failed to start");
  }

  // Local command endpoint
  localServer.on("/command", HTTP_POST, []() {
    if (!localServer.hasArg("plain")) {
      localServer.send(400, "application/json", "{\"status\":\"error\",\"message\":\"No body\"}");
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

    // Add CORS header to all command responses
    localServer.sendHeader("Access-Control-Allow-Origin", "*");

    if (action == "open" || action == "on" || action == "toggle") {
      startRelayPulse();
      addLog("Command: open (via local)", "info");
      localServer.send(200, "application/json", "{\"status\":\"ok\",\"message\":\"Command executed locally\"}");
      Serial.println("[LocalAPI] Command: open (local)");
    }
    else if (action == "restart") {
      addLog("Restart command (via local)", "warning");
      localServer.send(200, "application/json", "{\"status\":\"ok\",\"message\":\"Restarting...\"}");
      delay(500);
      ESP.restart();
    }
    else if (action == "status") {
      StaticJsonDocument<192> rDoc;
      rDoc["relay"]     = (relayOffTime > 0) ? "opened" : "closed";
      rDoc["doorState"] = lastDoorState ? "open" : "closed";
      rDoc["rssi"]      = WiFi.RSSI();
      rDoc["fw"]        = FIRMWARE_VERSION;
      rDoc["local"]     = true;
      String response;
      serializeJson(rDoc, response);
      localServer.send(200, "application/json", response);
    }
    else {
      localServer.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Unknown command\"}");
    }
  });

  // Local status endpoint — full device state
  localServer.on("/status", HTTP_GET, []() {
    localServer.sendHeader("Access-Control-Allow-Origin", "*");
    StaticJsonDocument<384> doc;
    doc["serial"]    = SERIAL_NUMBER;
    doc["name"]      = DEVICE_NAME;
    doc["type"]      = "relay";
    doc["fw"]        = FIRMWARE_VERSION;
    doc["relay"]     = (relayOffTime > 0) ? "opened" : "closed";
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

  // Local logs endpoint — returns last N logs from circular buffer
  localServer.on("/logs", HTTP_GET, []() {
    localServer.sendHeader("Access-Control-Allow-Origin", "*");
    // Build JSON array of logs (newest first)
    DynamicJsonDocument doc(4096);
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

  // CORS support for all local endpoints
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
  Serial.println("[LocalAPI] Server started on port 8080");
}

void stopLocalServer() {
  if (!localServerRunning) return;
  localServer.stop();
  MDNS.end();
  localServerRunning = false;
  Serial.println("[LocalAPI] Server stopped");
}


// ══════════════════════════════════════
//            HTTP ENDPOINTS
// ══════════════════════════════════════

void sendJson(int code, const String& json) {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(code, "application/json", json);
}

void handleInfo() {
  lastApActivity = millis();

  StaticJsonDocument<256> doc;
  doc["serial"]      = SERIAL_NUMBER;
  doc["name"]        = DEVICE_NAME;
  doc["type"]        = "relay";
  doc["fw"]          = FIRMWARE_VERSION;
  doc["popRequired"] = !popVerified;
  doc["state"]       = (int)currentState;

  String response;
  serializeJson(doc, response);
  sendJson(200, response);
  Serial.println("[HTTP] GET /info");
}

void handleVerify() {
  lastApActivity = millis();

  if (popLockoutUntil > 0 && millis() < popLockoutUntil) {
    uint32_t remaining = (popLockoutUntil - millis()) / 1000;
    StaticJsonDocument<128> doc;
    doc["status"] = "locked";
    doc["message"] = "Too many attempts";
    doc["retryAfterSec"] = remaining;
    String response;
    serializeJson(doc, response);
    sendJson(429, response);
    return;
  }

  if (!server.hasArg("plain")) {
    sendJson(400, "{\"status\":\"error\",\"message\":\"No body\"}");
    return;
  }

  StaticJsonDocument<128> doc;
  if (deserializeJson(doc, server.arg("plain"))) {
    sendJson(400, "{\"status\":\"error\",\"message\":\"Invalid JSON\"}");
    return;
  }

  String code = doc["code"] | "";
  code.trim();

  if (code == POP_CODE) {
    popVerified = true;
    popAttempts = 0;
    currentState = STATE_POP_VERIFIED;

    StaticJsonDocument<256> rDoc;
    rDoc["status"]       = "ok";
    rDoc["message"]      = "Verified";
    rDoc["deviceSecret"] = DEVICE_SECRET;

    String response;
    serializeJson(rDoc, response);
    sendJson(200, response);
    Serial.println("[HTTP] PoP VERIFIED - deviceSecret sent to app");
  } else {
    popAttempts++;
    Serial.printf("[HTTP] PoP FAILED (attempt %d/%d)\n", popAttempts, MAX_POP_ATTEMPTS);

    if (popAttempts >= MAX_POP_ATTEMPTS) {
      popLockoutUntil = millis() + POP_LOCKOUT_MS;
      popAttempts = 0;
      sendJson(429, "{\"status\":\"locked\",\"message\":\"Too many attempts. Try again in 60 seconds.\"}");
    } else {
      StaticJsonDocument<128> rDoc;
      rDoc["status"]       = "error";
      rDoc["message"]      = "Wrong code";
      rDoc["attemptsLeft"] = MAX_POP_ATTEMPTS - popAttempts;
      String response;
      serializeJson(rDoc, response);
      sendJson(401, response);
    }
  }
}

void handleSetup() {
  lastApActivity = millis();

  if (!popVerified) {
    sendJson(403, "{\"status\":\"error\",\"message\":\"Verification required first\"}");
    return;
  }

  if (!server.hasArg("plain")) {
    sendJson(400, "{\"status\":\"error\",\"message\":\"No body\"}");
    return;
  }

  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, server.arg("plain"))) {
    sendJson(400, "{\"status\":\"error\",\"message\":\"Invalid JSON\"}");
    return;
  }

  String ssid = doc["ssid"] | "";
  String pass = doc["password"] | "";
  pairingUserId = doc["userId"] | "";

  if (ssid.length() == 0) {
    sendJson(400, "{\"status\":\"error\",\"message\":\"SSID required\"}");
    return;
  }

  Serial.printf("[Setup] Trying WiFi: %s (AP+STA mode)\n", ssid.c_str());
  saveWifiSettings(ssid, pass, pairingUserId);

  // ──── جرب الاتصال بالواي فاي مع إبقاء الـ AP شغال (AP+STA) ────
  WiFi.mode(WIFI_AP_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());

  uint32_t wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 12000) {
    delay(100);
  }

  if (WiFi.status() == WL_CONNECTED) {
    // ✅ الواي فاي اتصل بنجاح
    Serial.printf("[Setup] WiFi connected! IP: %s\n", WiFi.localIP().toString().c_str());

    StaticJsonDocument<128> rDoc;
    rDoc["status"]       = "ok";
    rDoc["message"]      = "Connected to WiFi!";
    rDoc["serialNumber"] = SERIAL_NUMBER;
    String response;
    serializeJson(rDoc, response);
    sendJson(200, response);

    delay(500);

    // أوقف الـ AP وحوّل لـ STA فقط
    server.stop();
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_STA);

    // أكمل مع السيرفر
    currentState = STATE_SERVER_INQUIRY;
    int inqResult = inquireServer();

    if (inqResult == INQUIRY_OWNED) {
      Serial.println("[Setup] Device is owned by another user - ERROR");
      currentState = STATE_ERROR;
      setLED_error();
    } else if (inqResult == INQUIRY_OK) {
      Serial.println("[Setup] Inquiry OK! Connecting MQTT...");
      currentState = STATE_MQTT_CONNECTING;

      if (connectMQTT()) {
        currentState = STATE_ONLINE;
        setLED_online();
        Serial.println("[Setup] Complete! Device is online.");
      } else {
        currentState = STATE_ONLINE;
        setLED_online();
        Serial.println("[Setup] MQTT failed - will retry in loop");
      }
    } else {
      Serial.println("[Setup] Server inquiry failed - restarting AP");
      currentState = STATE_ERROR;
      delay(2000);
      startAP();
    }
  } else {
    // ❌ الواي فاي فشل - أرسل رسالة خطأ للتطبيق (الـ AP لسا شغال)
    Serial.println("[Setup] WiFi FAILED - notifying app");
    WiFi.disconnect();
    WiFi.mode(WIFI_AP);
    WiFi.softAPConfig(AP_IP, AP_GATEWAY, AP_SUBNET);

    StaticJsonDocument<128> rDoc;
    rDoc["status"]  = "wifi_error";
    rDoc["message"] = "WiFi connection failed. Check your network name and password.";
    String response;
    serializeJson(rDoc, response);
    sendJson(400, response);

    // الـ AP لسا شغال — المستخدم يقدر يعيد المحاولة
    currentState = STATE_AP_ACTIVE;
    lastApActivity = millis();
  }
}

void handleStatus() {
  lastApActivity = millis();

  StaticJsonDocument<128> doc;
  doc["state"]       = (int)currentState;
  doc["popVerified"] = popVerified;

  switch (currentState) {
    case STATE_AP_ACTIVE:        doc["message"] = popVerified ? "Ready for WiFi config" : "Waiting for verification"; break;
    case STATE_POP_VERIFIED:     doc["message"] = "Verified - send WiFi config"; break;
    case STATE_WIFI_CONNECTING:  doc["message"] = "Connecting to WiFi..."; break;
    case STATE_SERVER_INQUIRY:   doc["message"] = "Contacting server..."; break;
    case STATE_MQTT_CONNECTING:  doc["message"] = "Connecting to MQTT..."; break;
    case STATE_ONLINE:           doc["message"] = "Online"; break;
    case STATE_ERROR:            doc["message"] = "Error occurred"; break;
    default:                     doc["message"] = "Unknown"; break;
  }

  String response;
  serializeJson(doc, response);
  sendJson(200, response);
}

void handleCORS() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.send(204);
}

void handleNotFound() {
  sendJson(404, "{\"status\":\"error\",\"message\":\"Not found\"}");
}


// ══════════════════════════════════════
//            SOFTAP START / STOP
// ══════════════════════════════════════

void startAP() {
  Serial.println("[AP] Starting SoftAP...");

  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(AP_IP, AP_GATEWAY, AP_SUBNET);

  WiFi.softAP(AP_SSID, AP_PASSWORD, AP_CHANNEL, false, AP_MAX_CLIENTS);

  Serial.printf("[AP] SSID: %s\n", AP_SSID);
  Serial.printf("[AP] Password: %s\n", AP_PASSWORD);
  Serial.printf("[AP] IP: %s\n", WiFi.softAPIP().toString().c_str());

  server.on("/info",    HTTP_GET,  handleInfo);
  server.on("/verify",  HTTP_POST, handleVerify);
  server.on("/setup",   HTTP_POST, handleSetup);
  server.on("/status",  HTTP_GET,  handleStatus);

  server.on("/info",    HTTP_OPTIONS, handleCORS);
  server.on("/verify",  HTTP_OPTIONS, handleCORS);
  server.on("/setup",   HTTP_OPTIONS, handleCORS);
  server.on("/status",  HTTP_OPTIONS, handleCORS);

  server.onNotFound(handleNotFound);
  server.begin();

  apStartTime    = millis();
  lastApActivity = millis();
  currentState   = STATE_AP_ACTIVE;
  Serial.println("[AP] HTTP Server ready");
}

void stopAP() {
  server.stop();
  WiFi.softAPdisconnect(true);
  Serial.println("[AP] Stopped");
}


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
      clearAllSettings();
      delay(500);
      ESP.restart();
    }
    delay(50);
  }

  uint32_t dur = millis() - pressStart;

  if (dur > 2000 && dur <= 5000) {
    if (currentState == STATE_ONLINE || currentState == STATE_WIFI_RECONNECTING) {
      Serial.println("[Button] Medium press - AP re-config");
      popVerified = true;
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
      server.handleClient();
      blinkLED();

      if (millis() - lastApActivity > AP_TIMEOUT_MS) {
        Serial.println("[AP] Timeout - no activity");
        if (storedSSID.length() > 0) {
          stopAP();
          currentState = STATE_WIFI_RECONNECTING;
        } else {
          lastApActivity = millis();
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
      }
      break;

    case STATE_WIFI_RECONNECTING:
      if (millis() - lastWifiRetryMs < WIFI_RETRY_INTERVAL_MS) {
        blinkLED();
        return;
      }
      lastWifiRetryMs = millis();
      if (connectWiFi(storedSSID, storedPassword)) {
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

    case STATE_ERROR:
      server.handleClient();
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

  // MAC Address - نحتاجه عشان نسجل الجهاز في AllowedDevices
  WiFi.mode(WIFI_STA);
  String macAddr = WiFi.macAddress();
  WiFi.mode(WIFI_MODE_NULL);

  Serial.println("\n======================================");
  Serial.printf("  Manazel IoT - %s\n", DEVICE_NAME);
  Serial.printf("  SN:  %s\n", SERIAL_NUMBER);
  Serial.printf("  FW:  %s\n", FIRMWARE_VERSION);
  Serial.printf("  MAC: %s\n", macAddr.c_str());
  Serial.println("  Mode: Garage Relay (Pulse)");
  Serial.println("======================================\n");

  if (loadSettings()) {
    Serial.println("[Boot] Saved settings found");

    if (connectWiFi(storedSSID, storedPassword)) {
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
    } else {
      currentState = STATE_WIFI_RECONNECTING;
      setLED_offline();
    }
  } else {
    Serial.println("[Boot] No settings - starting SoftAP");
    startAP();
  }
}

void loop() {
  handleStateMachine();
  handleRelay();
  handleButton();
  handleDoorSensor();
  delay(10);
}
