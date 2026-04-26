// app/pairing.tsx
// ═══════════════════════════════════════════════════════════════
// BLE Provisioning — no PoP code
//
// Flow:
//   1. Scan for nearby Mnazilona BLE devices
//   2. Select and connect to device  → device hands the deviceSecret
//      back over the BLE link (no user-entered code required)
//   3. Device scans WiFi networks → app shows sorted list (2.4GHz)
//   4. User selects network and enters password
//   5. Credentials sent to device over BLE
//   6. Device connects to WiFi, does server inquiry
//   7. App pairs with backend server (deviceSecret + auth token)
//
// المكتبة المطلوبة:
//   npx expo install react-native-ble-plx
// ═══════════════════════════════════════════════════════════════

import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Alert,
  ActivityIndicator, KeyboardAvoidingView, ScrollView, Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { API_URL, ENDPOINTS } from "../constants/api";
import { TokenManager } from "../utils/api";
import { createRequestId } from "../utils/requestId";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  useBLEProvisioning,
  DiscoveredDevice,
  WiFiNetwork,
} from "../hooks/useBLEProvisioning";

const BRAND = "#2E5B8E";

// ═══════════════════════════════════════
// Types
// ═══════════════════════════════════════
type PairingStep =
  | "scan_devices"    // BLE scanning for nearby devices
  | "connecting_ble"  // Connecting to selected BLE device
  | "scanning_wifi"   // Device is scanning WiFi networks
  | "select_wifi"     // User picks a network from the list
  | "enter_password"  // User enters WiFi password
  | "provisioning"    // Sending credentials, device connecting
  | "pairing"         // Linking with backend
  | "done"
  | "error";

// ═══════════════════════════════════════
// Component
// ═══════════════════════════════════════
export default function PairingScreen() {
  const router = useRouter();
  const ble = useBLEProvisioning();

  const [step, setStep] = useState<PairingStep>("scan_devices");
  const [selectedWifi, setSelectedWifi] = useState<WiFiNetwork | null>(null);
  const [password, setPassword] = useState("");
  const [wifiNetworks, setWifiNetworks] = useState<WiFiNetwork[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [errorText, setErrorText] = useState("");

  // Refs for async chain safety
  const serialNumberRef = useRef("");
  const deviceSecretRef = useRef("");
  const pairRequestIdRef = useRef("");
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSerialNumberSynced = (value: string) => {
    serialNumberRef.current = value;
  };
  const setDeviceSecretSynced = (value: string) => {
    deviceSecretRef.current = value;
  };

  // Cleanup BLE on unmount
  useEffect(() => {
    const disconnectBle = ble.disconnect;
    return () => {
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }
      void disconnectBle();
    };
  }, [ble.disconnect]);

  // ═══════════════════════════════════════
  // Step 1: Scan for BLE Devices
  // ═══════════════════════════════════════
  const startBLEScan = async () => {
    pairRequestIdRef.current = "";
    setStep("scan_devices");
    setLoading(true);
    setStatusText("Scanning for nearby devices...");
    setErrorText("");

    await ble.startScan(12000); // 12 seconds

    // Scanning runs in background via the hook — devices appear reactively
    // After scan duration, loading stops
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
    }
    scanTimeoutRef.current = setTimeout(() => {
      setLoading(false);
      setStatusText("");
      scanTimeoutRef.current = null;
    }, 12500);
  };

  // ═══════════════════════════════════════
  // Step 1b: Connect to Selected Device
  // ═══════════════════════════════════════
  const connectToDevice = async (device: DiscoveredDevice) => {
    ble.stopScan();
    pairRequestIdRef.current = "";
    setStep("connecting_ble");
    setLoading(true);
    setStatusText(`Connecting to ${device.name}...`);

    const info = await ble.connectToDevice(device.id);

    if (!info) {
      setLoading(false);
      setErrorText(ble.error || "Failed to connect to device.");
      setStep("error");
      return;
    }

    setSerialNumberSynced(info.serial);

    // Pull the deviceSecret from the BLE compatibility characteristic.
    // PoP is gone, but the firmware still answers a write to the legacy
    // verify characteristic with {status:"ok", deviceSecret:"..."}.
    try {
      const result = await ble.fetchDeviceSecret();
      const secret =
        result.data?.deviceSecret || result.data?.device_secret || result.data?.secret;
      if (secret) {
        setDeviceSecretSynced(secret);
      } else if (__DEV__) {
        console.warn("[Pairing] Device did not return a secret over BLE");
      }
    } catch (e: any) {
      if (__DEV__) console.warn("[Pairing] fetchDeviceSecret failed:", e?.message);
    }

    setLoading(false);
    startWiFiScan();
  };

  // ═══════════════════════════════════════
  // Step 2: Request WiFi Scan from Device
  // ═══════════════════════════════════════
  const startWiFiScan = async () => {
    setStep("scanning_wifi");
    setLoading(true);
    setStatusText("Device is scanning for WiFi networks...");

    try {
      const networks = await ble.requestWiFiScan();
      setWifiNetworks(networks);
      setLoading(false);
      setStep("select_wifi");
    } catch (e: any) {
      setLoading(false);
      if (__DEV__) console.log("[Pairing] WiFi scan failed:", e.message);
      Alert.alert(
        "Scan Failed",
        "Could not get WiFi networks from device. Try again.",
        [
          { text: "Retry", onPress: () => startWiFiScan() },
          { text: "Cancel", style: "cancel", onPress: () => setStep("error") },
        ]
      );
    }
  };

  // ═══════════════════════════════════════
  // Step 4: User Selects WiFi Network
  // ═══════════════════════════════════════
  const selectWifi = (network: WiFiNetwork) => {
    setSelectedWifi(network);
    if (network.secure) {
      setStep("enter_password");
    } else {
      // Open network — send directly
      sendWifiCredentials(network.ssid, "");
    }
  };

  // ═══════════════════════════════════════
  // Step 5: Send WiFi Credentials
  // ═══════════════════════════════════════
  const sendWifiCredentials = async (ssid: string, pass: string) => {
    setStep("provisioning");
    setLoading(true);
    setStatusText("Sending WiFi settings to device...");

    const { success, data } = await ble.sendWiFiConfig(ssid, pass);

    if (success) {
      if (__DEV__) console.log("[Pairing] WiFi config sent — device connected!");
      // Device will stop BLE, connect to WiFi, do server inquiry
      await ble.disconnect();

      setStatusText("Waiting for device to register...");
      // ESP32-C6 shares radio between BLE and WiFi — after responding "ok",
      // it still needs to: delay(1000) + stopBLE/deinit + inquireServer (HTTP).
      // The NimBLE deinit can take 3-5s on C6, then the HTTP inquiry ~2-5s.
      // 12s initial wait gives the device enough time to complete server inquiry.
      await new Promise(resolve => setTimeout(resolve, 12000));

      pairRequestIdRef.current = createRequestId("pair");
      await pairWithServer(0);
    } else if (data.status === "wifi_error") {
      setLoading(false);
      Alert.alert(
        "WiFi Connection Failed",
        data.message || "Could not connect to WiFi. Check your password.",
        [{ text: "OK" }]
      );
      setStep("enter_password");
    } else {
      setLoading(false);
      setErrorText(data.message || "Failed to configure WiFi.");
      setStep("error");
    }
  };

  // ═══════════════════════════════════════
  // Step 6: Pair with Backend Server
  // (Unchanged from AP version — same backend flow)
  // ═══════════════════════════════════════
  const pairWithServer = async (attempt: number) => {
    const MAX_ATTEMPTS = 10;
    if (!pairRequestIdRef.current) {
      pairRequestIdRef.current = createRequestId("pair");
    }
    setStep("pairing");
    setStatusText(`Linking device to your account... (${attempt + 1}/${MAX_ATTEMPTS})`);

    try {
      const sn = serialNumberRef.current;
      const secret = deviceSecretRef.current;
      const requestId = pairRequestIdRef.current;

      if (!sn) {
        if (__DEV__) console.error("[Pairing] No serial number in ref!");
        pairRequestIdRef.current = "";
        setStep("error");
        setErrorText("No serial number found. Please restart the setup.");
        setLoading(false);
        return;
      }

      const token = await TokenManager.get();
      if (!token) {
        if (__DEV__) console.error("[Pairing] No auth token found!");
        pairRequestIdRef.current = "";
        setStep("error");
        setErrorText("Session expired. Please log in again and retry.");
        setLoading(false);
        return;
      }

      if (!secret) {
        if (__DEV__) console.warn("[Pairing] No deviceSecret available! Pair will likely fail with 400.");
      }

      if (__DEV__) console.log(`[Pairing] Attempt ${attempt + 1}/${MAX_ATTEMPTS} | SN: ${sn} | secret: ${secret ? "present" : "MISSING"}`);

      const pairController = new AbortController();
      const pairTimeout = setTimeout(() => pairController.abort(), 15000);
      const res = await fetch(`${API_URL}${ENDPOINTS.DEVICES.PAIR}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          serialNumber: sn,
          deviceSecret: secret,
          requestId,
        }),
        signal: pairController.signal,
      });
      clearTimeout(pairTimeout);

      const data = await res.json().catch(() => ({}));
      if (__DEV__) console.log(`[Pairing] Response: ${res.status}`, JSON.stringify(data));

      if (res.ok) {
        await waitForDeviceOnline(sn, token);
        return;
      }

      if (data.message?.toLowerCase().includes("already paired to your account")) {
        await waitForDeviceOnline(sn, token);
        return;
      }

      if (res.status === 409) {
        pairRequestIdRef.current = "";
        setStep("error");
        setLoading(false);
        setErrorText(
          data.ownerNotified
            ? "This device is owned by someone else. A request has been sent to the owner to unlink it. You'll be notified if they approve."
            : "This device is already linked to another account."
        );
        return;
      }

      if (res.status === 404) {
        throw new Error("Device not ready yet");
      }

      if (res.status === 400) {
        if (__DEV__) console.error("[Pairing] Bad request:", data.message);
        pairRequestIdRef.current = "";
        setStep("error");
        setLoading(false);
        setErrorText("Setup incomplete. Please restart the setup process.");
        return;
      }

      if (res.status === 401) {
        if (__DEV__) console.error("[Pairing] Auth failed:", data.code || data.error);
        pairRequestIdRef.current = "";
        setStep("error");
        setLoading(false);
        setErrorText("Session expired. Please log in again and retry.");
        return;
      }

      if (res.status === 403) {
        if (__DEV__) console.error("[Pairing] Forbidden:", data.message);
        pairRequestIdRef.current = "";
        setStep("error");
        setLoading(false);
        setErrorText("Device verification failed. Please try the setup process again.");
        return;
      }

      throw new Error(data.message || "Pairing failed");

    } catch (e: any) {
      if (__DEV__) console.log(`[Pairing] Attempt ${attempt + 1} failed:`, e.message);

      if (attempt < MAX_ATTEMPTS - 1) {
        const delay = Math.min(3000 * Math.pow(1.5, attempt), 15000);
        setTimeout(() => pairWithServer(attempt + 1), delay);
      } else {
        pairRequestIdRef.current = "";
        setLoading(false);
        setStep("error");
        setStatusText("");
        setErrorText(
          "The device connected, but the app could not confirm pairing with the server. Please try again from the dashboard once the device is online."
        );
      }
    }
  };

  // ═══════════════════════════════════════
  // Wait for device to come online
  // ═══════════════════════════════════════
  const waitForDeviceOnline = async (sn: string, token: string) => {
    setStatusText("Waiting for device to come online...");

    const MAX_WAIT = 30000;
    const POLL_INTERVAL = 3000;
    const startTime = Date.now();

    while (Date.now() - startTime < MAX_WAIT) {
      try {
        const pollController = new AbortController();
        const pollTimeout = setTimeout(() => pollController.abort(), 8000);
        const res = await fetch(`${API_URL}${ENDPOINTS.DEVICES.GET_ONE(sn)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: pollController.signal,
        });
        clearTimeout(pollTimeout);
        if (res.ok) {
          const device = await res.json().catch(() => null);
          if (device.isOnline) {
            pairRequestIdRef.current = "";
            setStep("done");
            setLoading(false);
            setStatusText("Device added successfully!");
            return;
          }
        }
      } catch {
        // Ignore and retry
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }

    pairRequestIdRef.current = "";
    setStep("done");
    setLoading(false);
    setStatusText("Device paired! It may take a moment to appear online in your dashboard.");
  };

  // ═══════════════════════════════════════
  // Helper: signal strength icon
  // ═══════════════════════════════════════
  const wifiSignalIcon = (rssi: number): string => {
    if (rssi > -50) return "wifi-strength-4";
    if (rssi > -60) return "wifi-strength-3";
    if (rssi > -70) return "wifi-strength-2";
    if (rssi > -80) return "wifi-strength-1";
    return "wifi-strength-outline";
  };

  const bleSignalIcon = (rssi: number): string => {
    if (rssi > -50) return "bluetooth-connect";
    if (rssi > -70) return "bluetooth";
    return "bluetooth-off";
  };

  // ═══════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { ble.disconnect(); router.back(); }}>
            <MaterialCommunityIcons name="arrow-left" size={28} color={BRAND} />
          </TouchableOpacity>
          <Text style={styles.title}>Add Device</Text>
        </View>

        {/* Step Indicator */}
        <View style={styles.steps}>
          {["Scan", "WiFi", "Done"].map((label, i) => {
            const stepIndex =
              ["scan_devices", "connecting_ble"].includes(step) ? 0
              : ["scanning_wifi", "select_wifi", "enter_password", "provisioning"].includes(step) ? 1
              : 2;
            const isActive = i <= stepIndex;
            return (
              <View key={label} style={styles.stepRow}>
                <View style={[styles.stepDot, isActive && styles.stepDotActive]} />
                <Text style={[styles.stepLabel, isActive && styles.stepLabelActive]}>{label}</Text>
                {i < 2 && <View style={[styles.stepLine, isActive && styles.stepLineActive]} />}
              </View>
            );
          })}
        </View>

        {/* ──── STEP 1: SCAN BLE DEVICES ──── */}
        {step === "scan_devices" && (
          <View>
            <View style={styles.center}>
              <MaterialCommunityIcons name="bluetooth-connect" size={70} color={BRAND} />
            </View>
            <Text style={styles.h2}>Find Your Device</Text>
            <Text style={styles.p}>
              Make sure your device is powered on and the LED is blinking blue, then tap the button below to search.
            </Text>

            <TouchableOpacity
              style={[styles.btnMain, loading && styles.btnDisabled]}
              onPress={startBLEScan}
              disabled={loading}
            >
              {loading ? (
                <>
                  <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.btnTxt}>Scanning...</Text>
                </>
              ) : (
                <>
                  <MaterialCommunityIcons name="bluetooth-audio" size={20} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.btnTxt}>Scan for Devices</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Device List */}
            {ble.discoveredDevices.length > 0 && (
              <View style={{ marginTop: 20 }}>
                <Text style={styles.label}>Nearby Devices</Text>
                {ble.discoveredDevices.map((device) => (
                  <TouchableOpacity
                    key={device.id}
                    style={styles.deviceCard}
                    onPress={() => connectToDevice(device)}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                      <MaterialCommunityIcons
                        name={bleSignalIcon(device.rssi) as any}
                        size={24}
                        color={BRAND}
                        style={{ marginRight: 12 }}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.deviceName}>{device.serialNumber}</Text>
                        <Text style={styles.deviceSub}>Signal: {device.rssi} dBm</Text>
                      </View>
                      <MaterialCommunityIcons name="chevron-right" size={24} color="#999" />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {!loading && ble.discoveredDevices.length === 0 && ble.bleState === "idle" && (
              <Text style={[styles.p, { marginTop: 20 }]}>
                No devices found yet. Make sure your device is nearby and in pairing mode.
              </Text>
            )}

            {ble.error && (
              <View style={[styles.infoBox, { backgroundColor: "#FFF3F0", borderColor: "#FFD0C7" }]}>
                <Text style={[styles.infoText, { color: "#D32F2F" }]}>{ble.error}</Text>
              </View>
            )}
          </View>
        )}

        {/* ──── CONNECTING BLE ──── */}
        {step === "connecting_ble" && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={BRAND} />
            <Text style={[styles.h2, { marginTop: 20 }]}>Connecting to Device</Text>
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
        )}

        {/* ──── SCANNING WIFI ──── */}
        {step === "scanning_wifi" && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={BRAND} />
            <Text style={[styles.h2, { marginTop: 20 }]}>Scanning Networks</Text>
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
        )}

        {/* ──── STEP 3: SELECT WIFI NETWORK ──── */}
        {step === "select_wifi" && (
          <View>
            <View style={styles.center}>
              <MaterialCommunityIcons name="router-wireless" size={50} color={BRAND} />
            </View>
            <Text style={styles.h2}>Select WiFi Network</Text>
            <Text style={styles.p}>
              Choose your home WiFi network. Only 2.4GHz networks are shown.
            </Text>

            {wifiNetworks.length === 0 ? (
              <View style={styles.center}>
                <Text style={styles.p}>No networks found.</Text>
                <TouchableOpacity style={styles.btnOutline} onPress={startWiFiScan}>
                  <Text style={styles.btnTxtBrand}>Scan Again</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View>
                {wifiNetworks.map((network, index) => (
                  <TouchableOpacity
                    key={`${network.ssid}-${index}`}
                    style={styles.deviceCard}
                    onPress={() => selectWifi(network)}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                      <MaterialCommunityIcons
                        name={wifiSignalIcon(network.rssi) as any}
                        size={24}
                        color={BRAND}
                        style={{ marginRight: 12 }}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.deviceName}>{network.ssid || "(Hidden Network)"}</Text>
                        <Text style={styles.deviceSub}>
                          {network.rssi} dBm {network.secure ? "" : " (Open)"}
                        </Text>
                      </View>
                      {network.secure && (
                        <MaterialCommunityIcons name="lock" size={18} color="#888" />
                      )}
                    </View>
                  </TouchableOpacity>
                ))}

                <TouchableOpacity style={[styles.btnOutline, { marginTop: 16 }]} onPress={startWiFiScan}>
                  <MaterialCommunityIcons name="refresh" size={18} color={BRAND} style={{ marginRight: 8 }} />
                  <Text style={styles.btnTxtBrand}>Scan Again</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* ──── STEP 4: ENTER WIFI PASSWORD ──── */}
        {step === "enter_password" && (
          <View>
            <View style={styles.center}>
              <MaterialCommunityIcons name="wifi-lock" size={50} color={BRAND} />
            </View>
            <Text style={styles.h2}>Enter WiFi Password</Text>
            <Text style={styles.p}>
              Enter the password for &quot;{selectedWifi?.ssid}&quot;.
            </Text>

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="WiFi password"
              secureTextEntry
              autoFocus
            />

            <TouchableOpacity
              style={[styles.btnMain, loading && styles.btnDisabled]}
              onPress={() => {
                if (selectedWifi) {
                  sendWifiCredentials(selectedWifi.ssid, password);
                }
              }}
              disabled={loading}
            >
              <Text style={styles.btnTxt}>Connect Device</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.btnOutline}
              onPress={() => {
                setPassword("");
                setSelectedWifi(null);
                setStep("select_wifi");
              }}
            >
              <Text style={styles.btnTxtBrand}>Choose Different Network</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ──── PROVISIONING ──── */}
        {step === "provisioning" && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={BRAND} />
            <Text style={[styles.h2, { marginTop: 20 }]}>Setting Up Device</Text>
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
        )}

        {/* ──── PAIRING ──── */}
        {step === "pairing" && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={BRAND} />
            <Text style={[styles.h2, { marginTop: 20 }]}>Linking to Account</Text>
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
        )}

        {/* ──── DONE ──── */}
        {step === "done" && (
          <View style={styles.center}>
            <MaterialCommunityIcons name="check-circle" size={80} color="#4CAF50" />
            <Text style={[styles.h2, { marginTop: 20 }]}>All Done!</Text>
            <Text style={styles.p}>{statusText}</Text>

            <TouchableOpacity
              style={styles.btnMain}
              onPress={() => router.replace("/(tabs)")}
            >
              <Text style={styles.btnTxt}>Go to Dashboard</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ──── ERROR ──── */}
        {step === "error" && (
          <View style={styles.center}>
            <MaterialCommunityIcons name="alert-circle" size={60} color="#F44336" />
            <Text style={[styles.h2, { marginTop: 16 }]}>Something Went Wrong</Text>
            <Text style={styles.p}>{errorText}</Text>

            <TouchableOpacity style={styles.btnMain} onPress={() => {
              ble.disconnect();
              setStep("scan_devices");
            }}>
              <Text style={styles.btnTxt}>Try Again</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.btnOutline} onPress={() => {
              ble.disconnect();
              router.back();
            }}>
              <Text style={styles.btnTxtBrand}>Go Back</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ═══════════════════════════════════════
// Styles
// ═══════════════════════════════════════
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  scroll: { padding: 24, paddingTop: 60 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 24 },
  title: { fontSize: 24, fontWeight: "700", color: BRAND, marginLeft: 12 },
  center: { alignItems: "center", marginTop: 20 },

  steps: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 32 },
  stepRow: { flexDirection: "row", alignItems: "center" },
  stepDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#E0E0E0" },
  stepDotActive: { backgroundColor: BRAND, width: 12, height: 12, borderRadius: 6 },
  stepLabel: { fontSize: 11, color: "#999", marginLeft: 4, marginRight: 4 },
  stepLabelActive: { color: BRAND, fontWeight: "600" },
  stepLine: { width: 20, height: 2, backgroundColor: "#E0E0E0", marginHorizontal: 2 },
  stepLineActive: { backgroundColor: BRAND },

  h2: { fontSize: 20, fontWeight: "700", color: "#333", marginBottom: 8, textAlign: "center" },
  p: { fontSize: 15, color: "#777", textAlign: "center", marginBottom: 24, lineHeight: 22 },
  statusText: { fontSize: 15, color: "#555", textAlign: "center", marginTop: 8, lineHeight: 22 },
  label: { fontSize: 14, fontWeight: "600", color: "#444", marginBottom: 6 },
  deviceLabel: { fontSize: 13, color: "#888", marginTop: 8, marginBottom: 12 },

  input: { backgroundColor: "#F5F7FA", padding: 15, borderRadius: 12, marginBottom: 16, fontSize: 16, borderWidth: 1, borderColor: "#E8E8E8" },
  inputCode: { backgroundColor: "#F5F7FA", padding: 18, borderRadius: 12, marginBottom: 20, fontSize: 28, fontWeight: "700", letterSpacing: 8, borderWidth: 1, borderColor: "#E8E8E8" },

  btnMain: { backgroundColor: BRAND, padding: 16, borderRadius: 12, width: "100%", alignItems: "center", marginTop: 12, flexDirection: "row", justifyContent: "center" },
  btnDisabled: { opacity: 0.6 },
  btnOutline: { borderColor: BRAND, borderWidth: 1.5, padding: 14, borderRadius: 12, width: "100%", alignItems: "center", marginTop: 12, flexDirection: "row", justifyContent: "center" },
  btnTxt: { color: "#fff", fontWeight: "700", fontSize: 16 },
  btnTxtBrand: { color: BRAND, fontWeight: "700", fontSize: 15 },

  infoBox: { backgroundColor: "#F0F5FA", padding: 16, borderRadius: 12, marginBottom: 20, width: "100%", borderWidth: 1, borderColor: "#E0E8F0" },
  infoTitle: { fontWeight: "700", color: "#333", marginBottom: 8, fontSize: 15 },
  infoText: { color: "#555", fontSize: 14, lineHeight: 22 },

  // Device & WiFi list cards
  deviceCard: {
    backgroundColor: "#F8FAFB",
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#E8ECF0",
    flexDirection: "row",
    alignItems: "center",
  },
  deviceName: { fontSize: 16, fontWeight: "600", color: "#333" },
  deviceSub: { fontSize: 13, color: "#888", marginTop: 2 },
});
