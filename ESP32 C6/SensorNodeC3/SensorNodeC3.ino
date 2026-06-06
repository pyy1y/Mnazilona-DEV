/**
 * ═══════════════════════════════════════════════════════════════
 *  Mnazilona IoT - ESP32-C3 Sensor Node Firmware v1.0.0
 *  Dry contact (NO) → ESP-NOW unicast → ESP32-C6 garage gateway
 * ═══════════════════════════════════════════════════════════════
 *
 *  Role:
 *    Battery-powered door sensor. Wakes from deep sleep on dry
 *    contact state change, sends a single ESP-NOW packet to the
 *    paired ESP32-C6, and goes back to sleep. Event-driven only —
 *    no heartbeat, no periodic timer.
 *
 *  Hardware:
 *    Board:        ESP32-C3
 *    Sensor pin:   GPIO 4 (RTC IO — required for deep sleep wakeup)
 *    Wiring:       NO dry contact between GPIO 4 and GND
 *                  (INPUT_PULLUP → LOW=closed, HIGH=open)
 *
 *  Provisioning (one-time, via Serial @ 115200):
 *    PROVISION:peer_mac=AA:BB:CC:DD:EE:FF,channel=6
 *      peer_mac: ESP32-C6 STA MAC address
 *      channel:  WiFi channel of the router C6 is joined to
 *                (must match — ESP-NOW has no channel discovery)
 *
 *  Arduino IDE setup:
 *    Board:  "ESP32C3 Dev Module"
 *    Core:   arduino-esp32 v3.x (uses wifi_tx_info_t callback)
 * ═══════════════════════════════════════════════════════════════
 */

#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_sleep.h>
#include <esp_mac.h>
#include <driver/gpio.h>
#include <Preferences.h>

// ═══════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════
#define FIRMWARE_VERSION   "1.0.0"
#define SENSOR_PIN          4         // RTC IO on C3 (deep-sleep wake capable)
#define DEBOUNCE_MS         50
#define SEND_TIMEOUT_MS     500
#define DEFAULT_CHANNEL     1

// Door state mapping (matches the deployed wiring):
//   GPIO LOW  → magnet near reed  → door OPEN
//   GPIO HIGH → magnet far / open → door CLOSED
// (Reversed from a textbook NO dry contact — kept this way to match
// the physical install rather than asking the user to re-wire.)
#define DOOR_CLOSED  0
#define DOOR_OPEN    1

// ═══════════════════════════════════════
// PACKET FORMAT — MUST match the C6 receiver layout byte-for-byte
// ═══════════════════════════════════════
typedef struct __attribute__((packed)) {
  uint8_t  version;       // 1
  uint8_t  msgType;       // 1 = sensor_state
  uint8_t  doorState;     // DOOR_CLOSED | DOOR_OPEN
  uint8_t  reserved;
  uint32_t seq;           // monotonic per-boot; replay protection on C6
  uint32_t uptimeSec;
} SensorMsg;

// ═══════════════════════════════════════
// RTC SLOW MEMORY — survives deep sleep, lost on power cut.
// On power cut, seq resets to 0 → C6 detects this and re-anchors.
// ═══════════════════════════════════════
RTC_DATA_ATTR uint32_t rtcSeq        = 0;
RTC_DATA_ATTR uint8_t  rtcLastState  = 0xFF;   // 0xFF = unknown (first boot)
RTC_DATA_ATTR uint32_t rtcBootCount  = 0;

// ═══════════════════════════════════════
// Globals
// ═══════════════════════════════════════
Preferences prefs;
uint8_t peerMac[6]   = {0};
uint8_t wifiChannel  = DEFAULT_CHANNEL;

volatile bool                  sendDone   = false;
volatile esp_now_send_status_t sendStatus = ESP_NOW_SEND_FAIL;

// ══════════════════════════════════════
//        NVS: peer MAC + channel
// ══════════════════════════════════════

bool loadPeerConfig() {
  prefs.begin("sensor", true);
  String macStr = prefs.getString("peer_mac", "");
  uint8_t ch    = prefs.getUChar("channel", DEFAULT_CHANNEL);
  prefs.end();

  if (macStr.length() != 17) return false;  // AA:BB:CC:DD:EE:FF = 17 chars

  int v[6];
  if (sscanf(macStr.c_str(), "%x:%x:%x:%x:%x:%x",
             &v[0], &v[1], &v[2], &v[3], &v[4], &v[5]) != 6) return false;
  for (int i = 0; i < 6; i++) peerMac[i] = (uint8_t)v[i];

  wifiChannel = (ch >= 1 && ch <= 13) ? ch : DEFAULT_CHANNEL;
  return true;
}

void checkSerialProvisioning() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (!line.startsWith("PROVISION:")) return;

  String params = line.substring(10);
  String newMac = "";
  int    newCh  = -1;

  while (params.length() > 0) {
    int comma = params.indexOf(',');
    String pair = (comma < 0) ? params : params.substring(0, comma);
    params      = (comma < 0) ? ""     : params.substring(comma + 1);
    pair.trim();
    if      (pair.startsWith("peer_mac=")) newMac = pair.substring(9);
    else if (pair.startsWith("channel="))  newCh  = pair.substring(8).toInt();
  }

  if (newMac.length() != 17) {
    Serial.println("[PROVISION] Error: peer_mac must be AA:BB:CC:DD:EE:FF");
    return;
  }

  prefs.begin("sensor", false);
  prefs.putString("peer_mac", newMac);
  if (newCh >= 1 && newCh <= 13) prefs.putUChar("channel", (uint8_t)newCh);
  prefs.end();

  Serial.printf("[PROVISION] Saved peer_mac=%s channel=%d\n",
                newMac.c_str(), newCh > 0 ? newCh : DEFAULT_CHANNEL);
  Serial.println("[PROVISION] Restarting to apply...");
  delay(500);
  ESP.restart();
}

// ══════════════════════════════════════
//   ESP-NOW callback (Arduino-ESP32 v3.x signature)
// ══════════════════════════════════════

void onEspNowSent(const wifi_tx_info_t* /*info*/, esp_now_send_status_t status) {
  sendStatus = status;
  sendDone   = true;
}

// ══════════════════════════════════════
//             SEND PACKET
// ══════════════════════════════════════

bool sendSensorState(uint8_t doorState) {
  // ESP-NOW requires WiFi started in STA mode, but no association.
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  esp_wifi_set_ps(WIFI_PS_NONE);                                // no power save during send
  // Pin C3 to legacy protocols so the airframe matches whatever the C6
  // gateway is also restricted to. Without this, a chip mismatch on the
  // PHY rate can silently swallow our frames.
  esp_wifi_set_protocol(WIFI_IF_STA,
                        WIFI_PROTOCOL_11B | WIFI_PROTOCOL_11G | WIFI_PROTOCOL_11N);
  // Crank TX power to the regulatory max (84 = 21 dBm in 0.25-dB units).
  // Dev boards sometimes default to a much lower value; not enough budget
  // to reach the gateway through walls / cable clutter.
  esp_wifi_set_max_tx_power(84);
  esp_err_t setCh = esp_wifi_set_channel(wifiChannel, WIFI_SECOND_CHAN_NONE);

  uint8_t actualPri = 0;
  wifi_second_chan_t actualSec;
  esp_wifi_get_channel(&actualPri, &actualSec);
  Serial.printf("[ESP-NOW] set_channel(%d)=%d -> actual primary=%d sec=%d\n",
                wifiChannel, (int)setCh, actualPri, (int)actualSec);

  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESP-NOW] init failed");
    return false;
  }
  esp_now_register_send_cb(onEspNowSent);

  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, peerMac, 6);
  peer.channel = wifiChannel;
  peer.encrypt = false;
  peer.ifidx   = WIFI_IF_STA;

  if (!esp_now_is_peer_exist(peerMac)) {
    if (esp_now_add_peer(&peer) != ESP_OK) {
      Serial.println("[ESP-NOW] add_peer failed");
      esp_now_deinit();
      return false;
    }
  }

  // Also add the broadcast MAC as a peer so we can send a diagnostic
  // broadcast frame after the unicast. Broadcast doesn't ACK but it lets
  // a paired gateway in promiscuous-enough mode receive the frame even
  // if unicast addressing is somehow broken.
  uint8_t bcastMac[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
  if (!esp_now_is_peer_exist(bcastMac)) {
    esp_now_peer_info_t bpeer = {};
    memcpy(bpeer.peer_addr, bcastMac, 6);
    bpeer.channel = wifiChannel;
    bpeer.encrypt = false;
    bpeer.ifidx   = WIFI_IF_STA;
    esp_now_add_peer(&bpeer);
  }

  rtcSeq++;
  SensorMsg msg = {};
  msg.version   = 1;
  msg.msgType   = 1;
  msg.doorState = doorState;
  msg.reserved  = 0;
  msg.seq       = rtcSeq;
  msg.uptimeSec = millis() / 1000;

  sendDone   = false;
  sendStatus = ESP_NOW_SEND_FAIL;

  esp_err_t r = esp_now_send(peerMac, (uint8_t*)&msg, sizeof(msg));
  if (r != ESP_OK) {
    Serial.printf("[ESP-NOW] send error: %d\n", r);
    esp_now_deinit();
    return false;
  }

  uint32_t start = millis();
  while (!sendDone && millis() - start < SEND_TIMEOUT_MS) {
    delay(5);
  }

  bool ok = sendDone && (sendStatus == ESP_NOW_SEND_SUCCESS);
  Serial.printf("[ESP-NOW] unicast seq=%lu state=%s -> %s\n",
                (unsigned long)rtcSeq,
                doorState == DOOR_OPEN ? "OPEN" : "CLOSED",
                ok ? "ACK" : "NO ACK");

  // Diagnostic broadcast — sent regardless of unicast outcome.
  esp_err_t br = esp_now_send(bcastMac, (uint8_t*)&msg, sizeof(msg));
  Serial.printf("[ESP-NOW] broadcast send ret=%d\n", (int)br);
  delay(50);  // let the broadcast actually leave the radio

  esp_now_deinit();
  WiFi.mode(WIFI_OFF);
  return ok;
}

// ══════════════════════════════════════
//        DEBOUNCED SENSOR READ
// ══════════════════════════════════════

uint8_t readStableDoorState() {
  int     last        = digitalRead(SENSOR_PIN);
  uint32_t stableStart = millis();
  while (millis() - stableStart < DEBOUNCE_MS) {
    int now = digitalRead(SENSOR_PIN);
    if (now != last) {
      last        = now;
      stableStart = millis();
    }
    delay(2);
  }
  // See "Door state mapping" at top of file for the LOW/HIGH meaning.
  return (last == HIGH) ? DOOR_CLOSED : DOOR_OPEN;
}

// ══════════════════════════════════════
//       DEEP SLEEP w/ GPIO WAKEUP
// ══════════════════════════════════════

void enterDeepSleep(uint8_t currentState) {
  // Level-triggered wakeup. Arm on the OPPOSITE level so we wake on change.
  // With the deployed wiring: CLOSED = GPIO HIGH, OPEN = GPIO LOW. So:
  //   currently CLOSED (GPIO HIGH) -> wake on LOW  (door opens)
  //   currently OPEN   (GPIO LOW)  -> wake on HIGH (door closes)
  esp_deepsleep_gpio_wake_up_mode_t wakeLevel =
      (currentState == DOOR_CLOSED) ? ESP_GPIO_WAKEUP_GPIO_LOW
                                    : ESP_GPIO_WAKEUP_GPIO_HIGH;

  // Arduino's pinMode(INPUT_PULLUP) only configures the digital peripheral,
  // which is powered down in deep sleep — the pin would float and either
  // never trigger or trigger on noise. Re-arm the pull-up via the gpio
  // driver and hold the configuration through deep sleep so it survives.
  gpio_num_t pin = (gpio_num_t)SENSOR_PIN;
  gpio_pullup_en(pin);
  gpio_pulldown_dis(pin);
  gpio_hold_en(pin);
  gpio_deep_sleep_hold_en();

  esp_deep_sleep_enable_gpio_wakeup(1ULL << SENSOR_PIN, wakeLevel);

  Serial.printf("[Sleep] Deep sleep — wake on GPIO %d going %s\n",
                SENSOR_PIN,
                wakeLevel == ESP_GPIO_WAKEUP_GPIO_HIGH ? "HIGH" : "LOW");
  Serial.flush();
  esp_deep_sleep_start();
}

// ══════════════════════════════════════
//                SETUP
//   Entire program runs here; loop() never executes
//   because we deep-sleep at the end.
// ══════════════════════════════════════

void setup() {
  Serial.begin(115200);

  // USB-CDC on ESP32-C3 needs the host to re-enumerate after every boot/wake.
  // Wait up to 3s for the Serial Monitor to (re)attach so we don't lose the
  // banner. On a battery deploy you'd shrink this, but the few hundred mA·s
  // cost is negligible during dev.
  uint32_t serialStart = millis();
  while (!Serial && millis() - serialStart < 3000) {
    delay(50);
  }
  delay(200);  // small grace period after Serial reports ready

  rtcBootCount++;
  esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();

  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);

  Serial.println("\n======================================");
  Serial.printf("  Mnazilona Sensor Node v%s\n", FIRMWARE_VERSION);
  Serial.printf("  Boot #%lu   Wake cause: %d\n",
                (unsigned long)rtcBootCount, (int)cause);
  Serial.printf("  MAC (STA): %02X:%02X:%02X:%02X:%02X:%02X\n",
                mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  Serial.println("======================================");

  // Release any deep-sleep hold from the previous sleep cycle before
  // reconfiguring the pin. Without this, the pin stays latched at its
  // pre-sleep level and pinMode has no effect.
  gpio_hold_dis((gpio_num_t)SENSOR_PIN);
  gpio_deep_sleep_hold_dis();
  pinMode(SENSOR_PIN, INPUT_PULLUP);

  if (!loadPeerConfig()) {
    Serial.println("\n[PROVISION] Not provisioned. Send via Serial:");
    Serial.println("  PROVISION:peer_mac=AA:BB:CC:DD:EE:FF,channel=N\n");
    // Block here until provisioned. Power-on only — won't reach this branch
    // on a deep-sleep wake because NVS would already be populated.
    while (true) {
      checkSerialProvisioning();
      delay(100);
    }
  }

  // Allow re-provisioning even when already configured (brief window each wake).
  checkSerialProvisioning();

  Serial.printf("[Config] peer=%02X:%02X:%02X:%02X:%02X:%02X channel=%d\n",
                peerMac[0], peerMac[1], peerMac[2],
                peerMac[3], peerMac[4], peerMac[5], wifiChannel);

  uint8_t state = readStableDoorState();
  Serial.printf("[Sensor] Stable state: %s  (last=%s)\n",
                state == DOOR_OPEN ? "OPEN" : "CLOSED",
                rtcLastState == 0xFF ? "UNKNOWN"
                  : (rtcLastState == DOOR_OPEN ? "OPEN" : "CLOSED"));

  // Always send on power-on (cause != GPIO) so C6 learns initial state.
  // On a GPIO wake, only send if the debounced state differs from last
  // sent — protects against spurious wakes that settle to the same level.
  bool shouldSend = (cause != ESP_SLEEP_WAKEUP_GPIO) || (state != rtcLastState);

  if (shouldSend) {
    if (sendSensorState(state)) {
      rtcLastState = state;
    }
  } else {
    Serial.println("[Sensor] No change since last send — skipping");
  }

  enterDeepSleep(state);
}

void loop() {
  // Never reached.
}
