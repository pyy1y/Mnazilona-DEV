// app/pairing-ap.tsx
// ═══════════════════════════════════════════════════════════════
// Wi-Fi AP Provisioning — counterpart to pairing.tsx (BLE).
//
// Flow (auto-join via react-native-wifi-reborn):
//   1. On mount: scan nearby Wi-Fi for "MNZ_*" (Android) or show a
//      single "Join" button (iOS).
//   2. User taps Join. App calls connectToProtectedSSID — OS shows
//      its native prompt and the phone joins the device AP.
//   3. App fetches /info, /scan over http://192.168.4.1.
//   4. User picks home Wi-Fi + types password, app POSTs /config.
//   5. App auto-drops the AP. Phone rejoins the home Wi-Fi.
//   6. App pairs with the backend (same /devices/pair flow as BLE).
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useRef, useState } from "react";
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
  useAPProvisioning,
  APWiFiNetwork,
  DiscoveredAP,
} from "../hooks/useAPProvisioning";

const BRAND = "#2E5B8E";

// Default AP password baked into the firmware (#define AP_PASSWORD).
// Empty string = open AP.
const AP_DEFAULT_PASSWORD = "mnazilona1234";

type APStep =
  | "scan_aps"         // Looking for nearby MNZ_* devices (Android)
  | "select_ap"        // User picks a discovered MNZ_* (Android) or hits Join (iOS)
  | "joining"          // OS join prompt visible / connect call in flight
  | "confirm_joined"   // User taps "I'm Connected" — then we verify
  | "verifying"        // Pinging /health to confirm reachability
  | "fetching_info"    // GET /info
  | "scanning_wifi"    // GET /scan (home networks visible to device)
  | "select_wifi"      // User picks home Wi-Fi
  | "enter_password"   // User types home Wi-Fi password
  | "provisioning"     // POST /config + auto-leave AP
  | "pairing"          // Backend /devices/pair
  | "done"
  | "error";

export default function PairingAPScreen() {
  const router = useRouter();
  const ap = useAPProvisioning();

  const [step, setStep] = useState<APStep>("scan_aps");
  const [selectedWifi, setSelectedWifi] = useState<APWiFiNetwork | null>(null);
  const [selectedApSsid, setSelectedApSsid] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [wifiNetworks, setWifiNetworks] = useState<APWiFiNetwork[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [errorText, setErrorText] = useState("");

  const serialNumberRef = useRef("");
  const deviceSecretRef = useRef("");
  const pairRequestIdRef = useRef("");
  // Carries the OS-level join error across to confirmJoinedAndContinue,
  // so that if verify also fails we surface the actual root cause
  // (e.g. "Wrong AP password", "Join was cancelled") instead of a
  // generic "couldn't reach the device" message.
  const fallbackJoinErrorRef = useRef<string | null>(null);

  // Kick off the AP scan as soon as the screen opens.
  useEffect(() => {
    runApScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup: if the screen unmounts mid-flow, drop the AP so the
  // phone goes back to home Wi-Fi.
  useEffect(() => {
    const leave = ap.leaveAP;
    return () => {
      leave();
    };
  }, [ap.leaveAP]);

  // ═══════════════════════════════════════
  // Step 1: Scan for nearby device APs
  // ═══════════════════════════════════════
  const runApScan = async () => {
    setStep("scan_aps");
    setLoading(true);
    setErrorText("");
    setStatusText("Looking for nearby devices...");

    if (Platform.OS !== "android") {
      // iOS can't scan. Skip straight to the manual join UI.
      setLoading(false);
      setStep("select_ap");
      return;
    }

    const aps = await ap.scanForDeviceAPs();
    setLoading(false);
    if (aps.length === 0) {
      // No devices found, but allow the user to retry or fall back
      // to manual entry if they know the SSID.
      setStep("select_ap");
      return;
    }
    setStep("select_ap");
  };

  // ═══════════════════════════════════════
  // Step 2a: User taps Join on a device.
  // Triggers the OS Wi-Fi join, then auto-advances straight into
  // verify → /info → /scan so the user lands on the Wi-Fi credentials
  // screen as soon as the AP is reachable. If the verify step can't
  // hit /health within its retry budget, we fall back to the
  // "I'm Connected" recovery screen so the user can retry without
  // restarting the whole flow.
  // ═══════════════════════════════════════
  const triggerApJoin = async (apSsid: string | null) => {
    setSelectedApSsid(apSsid);
    setStep("joining");
    setLoading(true);
    setErrorText("");
    setStatusText(
      apSsid
        ? `Asking the system to join ${apSsid}...`
        : "Asking the system to join the device Wi-Fi..."
    );

    const ok = await ap.triggerJoin(apSsid, AP_DEFAULT_PASSWORD);

    // Android (especially API 29+ with WifiNetworkSpecifier) sometimes
    // resolves connectToProtectedSSID as failure WHILE the system is
    // still finishing the network handover. Don't trust the false
    // negative — wait for the OS to settle, then let
    // confirmJoinedAndContinue's verify+ping retry budget decide.
    // If verify also fails, we surface the original join error so the
    // user sees the real cause (cancelled, wrong AP password, etc.).
    if (!ok) {
      const joinErr = ap.error;
      if (__DEV__) console.log("[Pairing AP] triggerJoin returned false:", joinErr, "— waiting before declaring failure");
      setStatusText("Finishing connection to the device...");
      // Give Android time to actually finish binding the AP before we probe.
      await new Promise((r) => setTimeout(r, 3000));
      fallbackJoinErrorRef.current = joinErr;
    } else {
      fallbackJoinErrorRef.current = null;
      if (__DEV__) console.log("[Pairing AP] triggerJoin OK, auto-advancing to verify + fetch info");
    }

    // Single path for both success and "false negative" — verify
    // reachability, fetch /info, then move on to the credentials screen.
    await confirmJoinedAndContinue();
  };

  // ═══════════════════════════════════════
  // Step 2b: User taps "I'm Connected".
  // Verifies the AP is actually reachable, then fetches /info and
  // moves on to home Wi-Fi selection.
  // ═══════════════════════════════════════
  const confirmJoinedAndContinue = async () => {
    setStep("verifying");
    setLoading(true);
    setErrorText("");
    setStatusText("Checking connection to the device...");

    const reachable = await ap.verifyConnection();
    if (__DEV__) console.log("[Pairing AP] verifyConnection →", reachable);
    if (!reachable) {
      setLoading(false);
      // If we got here after a falsy triggerJoin, the original OS error
      // is more useful than the generic "couldn't reach" message.
      const joinErr = fallbackJoinErrorRef.current;
      fallbackJoinErrorRef.current = null;
      setErrorText(
        joinErr ||
          ap.error ||
          "Couldn't reach the device. Make sure your phone shows you're connected to MNZ_… and try again."
      );
      // Send the user back to the AP picker if the join itself failed —
      // they need to retry the join, not just confirm reachability.
      setStep(joinErr ? "select_ap" : "confirm_joined");
      return;
    }
    fallbackJoinErrorRef.current = null;

    setStep("fetching_info");
    setStatusText("Reading device information...");

    const info = await ap.fetchDeviceInfo();
    if (__DEV__) console.log("[Pairing AP] /info →", info ? { serial: info.serial, hasSecret: !!info.deviceSecret } : null);
    if (!info) {
      setLoading(false);
      setErrorText(ap.error || "Failed to read device info.");
      setStep("error");
      return;
    }
    serialNumberRef.current = info.serial;
    deviceSecretRef.current = info.deviceSecret || "";

    await runWifiScan();
  };

  // ═══════════════════════════════════════
  // Step 3: Scan home Wi-Fi via device
  // ═══════════════════════════════════════
  const runWifiScan = async () => {
    setStep("scanning_wifi");
    setLoading(true);
    setStatusText("Device is scanning for Wi-Fi networks...");

    try {
      const networks = await ap.fetchWiFiNetworks();
      setWifiNetworks(networks);
      setLoading(false);
      setStep("select_wifi");
    } catch {
      setLoading(false);
      Alert.alert(
        "Scan Failed",
        "Could not get Wi-Fi networks from the device. Try again.",
        [
          { text: "Retry", onPress: () => runWifiScan() },
          { text: "Cancel", style: "cancel", onPress: () => setStep("error") },
        ]
      );
    }
  };

  // ═══════════════════════════════════════
  // Step 4: User picks a home Wi-Fi
  // ═══════════════════════════════════════
  const selectWifi = (network: APWiFiNetwork) => {
    setSelectedWifi(network);
    if (network.secure) setStep("enter_password");
    else sendCredentials(network.ssid, "");
  };

  // ═══════════════════════════════════════
  // Step 5: Send /config + auto-leave AP + pair
  // ═══════════════════════════════════════
  const sendCredentials = async (ssid: string, pass: string) => {
    setStep("provisioning");
    setLoading(true);
    setStatusText("Sending Wi-Fi settings to the device...");

    if (__DEV__) console.log("[Pairing AP] POST /config → ssid:", ssid);
    const { success, data } = await ap.sendWiFiConfig(ssid, pass);
    if (__DEV__) console.log("[Pairing AP] /config response → success:", success, "data:", data);

    if (!success) {
      setLoading(false);
      Alert.alert(
        "Setup Failed",
        data?.message || "The device rejected the Wi-Fi credentials. Try again.",
        [{ text: "OK" }]
      );
      setStep("enter_password");
      return;
    }

    if (data?.deviceSecret) deviceSecretRef.current = data.deviceSecret;
    if (data?.serial) serialNumberRef.current = data.serial;

    // The hook has already auto-left the AP and waited for the phone
    // to rejoin home Wi-Fi. Move straight into the backend pair.
    setStatusText("Linking device to your account...");
    pairRequestIdRef.current = createRequestId("pair");
    await pairWithServer(0);
  };

  // ═══════════════════════════════════════
  // Backend pair (identical to BLE flow)
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
        pairRequestIdRef.current = "";
        setStep("error");
        setErrorText("No serial number found. Please restart the setup.");
        setLoading(false);
        return;
      }

      const token = await TokenManager.get();
      if (!token) {
        pairRequestIdRef.current = "";
        setStep("error");
        setErrorText("Session expired. Please log in again and retry.");
        setLoading(false);
        return;
      }

      if (__DEV__) console.log(`[Pairing AP] Attempt ${attempt + 1}/${MAX_ATTEMPTS} | SN: ${sn} | secret: ${secret ? "present" : "MISSING"}`);

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

      if (res.status === 404) throw new Error("Device not ready yet");

      if (res.status === 400) {
        pairRequestIdRef.current = "";
        setStep("error");
        setLoading(false);
        setErrorText("Setup incomplete. Please restart the setup process.");
        return;
      }

      if (res.status === 401) {
        pairRequestIdRef.current = "";
        setStep("error");
        setLoading(false);
        setErrorText("Session expired. Please log in again and retry.");
        return;
      }

      if (res.status === 403) {
        pairRequestIdRef.current = "";
        setStep("error");
        setLoading(false);
        setErrorText("Device verification failed. Please try the setup process again.");
        return;
      }

      throw new Error(data.message || "Pairing failed");
    } catch (e: any) {
      if (__DEV__) console.log(`[Pairing AP] Attempt ${attempt + 1} failed:`, e.message);

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
          if (device?.isOnline) {
            pairRequestIdRef.current = "";
            setStep("done");
            setLoading(false);
            setStatusText("Device added successfully!");
            return;
          }
        }
      } catch {
        // ignore and retry
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }

    pairRequestIdRef.current = "";
    setStep("done");
    setLoading(false);
    setStatusText("Device paired! It may take a moment to appear online in your dashboard.");
  };

  // ═══════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════
  const wifiSignalIcon = (rssi: number): string => {
    if (rssi > -50) return "wifi-strength-4";
    if (rssi > -60) return "wifi-strength-3";
    if (rssi > -70) return "wifi-strength-2";
    if (rssi > -80) return "wifi-strength-1";
    return "wifi-strength-outline";
  };

  // ═══════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { ap.leaveAP(); router.back(); }}>
            <MaterialCommunityIcons name="arrow-left" size={28} color={BRAND} />
          </TouchableOpacity>
          <Text style={styles.title}>Add Device (Wi-Fi)</Text>
        </View>

        {/* Step Indicator */}
        <View style={styles.steps}>
          {["Join", "Configure", "Done"].map((label, i) => {
            const stepIndex =
              ["scan_aps", "select_ap", "joining", "confirm_joined", "verifying", "fetching_info"].includes(step) ? 0
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

        {/* ──── SCANNING NEARBY APS ──── */}
        {step === "scan_aps" && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={BRAND} />
            <Text style={[styles.h2, { marginTop: 20 }]}>Looking for Devices…</Text>
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
        )}

        {/* ──── PICK / JOIN AN AP ──── */}
        {step === "select_ap" && (
          <View>
            <View style={styles.center}>
              <MaterialCommunityIcons name="access-point-network" size={70} color={BRAND} />
            </View>
            <Text style={styles.h2}>Connect to Your Device</Text>
            <Text style={styles.p}>
              {Platform.OS === "android"
                ? "Tap your device below. The system will ask you to allow the connection."
                : "Tap Join below. iOS will ask you to confirm joining the device's Wi-Fi network."}
            </Text>

            {Platform.OS === "android" && ap.discoveredAPs.length > 0 && (
              <View>
                {ap.discoveredAPs.map((d: DiscoveredAP) => (
                  <TouchableOpacity
                    key={d.ssid}
                    style={styles.deviceCard}
                    onPress={() => triggerApJoin(d.ssid)}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                      <MaterialCommunityIcons
                        name={wifiSignalIcon(d.level) as any}
                        size={24}
                        color={BRAND}
                        style={{ marginRight: 12 }}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.deviceName}>{d.ssid}</Text>
                        <Text style={styles.deviceSub}>Signal: {d.level} dBm</Text>
                      </View>
                      <View style={styles.joinPill}>
                        <Text style={styles.joinPillTxt}>Join</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {Platform.OS === "android" && ap.discoveredAPs.length === 0 && (
              <View style={[styles.infoBox, { backgroundColor: "#FFF7E6", borderColor: "#FFE2A8" }]}>
                <Text style={styles.infoText}>
                  No nearby devices found. Make sure the device is powered on and the LED is blinking blue, then tap Scan Again.
                </Text>
              </View>
            )}

            {Platform.OS === "ios" && (
              <TouchableOpacity
                style={styles.btnMain}
                onPress={() => triggerApJoin(null)}
              >
                <MaterialCommunityIcons name="wifi" size={20} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.btnTxt}>Join Device Wi-Fi</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.btnOutline} onPress={runApScan}>
              <MaterialCommunityIcons name="refresh" size={18} color={BRAND} style={{ marginRight: 8 }} />
              <Text style={styles.btnTxtBrand}>Scan Again</Text>
            </TouchableOpacity>

            {errorText.length > 0 && (
              <View style={[styles.infoBox, { backgroundColor: "#FFF3F0", borderColor: "#FFD0C7" }]}>
                <Text style={[styles.infoText, { color: "#D32F2F" }]}>{errorText}</Text>
              </View>
            )}
          </View>
        )}

        {/* ──── JOINING (system prompt in flight) ──── */}
        {step === "joining" && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={BRAND} />
            <Text style={[styles.h2, { marginTop: 20 }]}>Connecting to Device</Text>
            <Text style={styles.statusText}>{statusText}</Text>
            <Text style={[styles.statusText, { marginTop: 12, fontSize: 13, color: "#999" }]}>
              You may see a system prompt — tap Join / Allow.
            </Text>
          </View>
        )}

        {/* ──── CONFIRM JOINED — recovery state when verify fails ──── */}
        {step === "confirm_joined" && (
          <View>
            <View style={styles.center}>
              <MaterialCommunityIcons name="wifi-alert" size={70} color={BRAND} />
            </View>
            <Text style={styles.h2}>Couldn&apos;t Reach the Device</Text>
            <Text style={styles.p}>
              {selectedApSsid
                ? `Open your phone's Wi-Fi settings and make sure you're connected to "${selectedApSsid}". When you're back here, tap Retry below.`
                : "Open your phone's Wi-Fi settings and make sure you're connected to the MNZ_… network. When you're back here, tap Retry below."}
            </Text>

            <TouchableOpacity
              style={styles.btnMain}
              onPress={confirmJoinedAndContinue}
            >
              <MaterialCommunityIcons name="refresh" size={20} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.btnTxt}>Retry</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.btnOutline}
              onPress={() => triggerApJoin(selectedApSsid)}
            >
              <MaterialCommunityIcons name="wifi-refresh" size={18} color={BRAND} style={{ marginRight: 8 }} />
              <Text style={styles.btnTxtBrand}>Try Joining Again</Text>
            </TouchableOpacity>

            {errorText.length > 0 && (
              <View style={[styles.infoBox, { backgroundColor: "#FFF3F0", borderColor: "#FFD0C7", marginTop: 16 }]}>
                <Text style={[styles.infoText, { color: "#D32F2F" }]}>{errorText}</Text>
              </View>
            )}

            <View style={[styles.infoBox, { marginTop: 24 }]}>
              <Text style={styles.infoTitle}>Tip</Text>
              <Text style={styles.infoText}>
                Your phone may show &quot;No internet&quot; on the device Wi-Fi — that&apos;s expected. Stay on it until setup is complete.
              </Text>
            </View>
          </View>
        )}

        {/* ──── VERIFYING ──── */}
        {step === "verifying" && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={BRAND} />
            <Text style={[styles.h2, { marginTop: 20 }]}>Checking Connection…</Text>
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
        )}

        {/* ──── FETCHING INFO ──── */}
        {step === "fetching_info" && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={BRAND} />
            <Text style={[styles.h2, { marginTop: 20 }]}>Reading Device Info</Text>
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
        )}

        {/* ──── SCANNING HOME WIFI ──── */}
        {step === "scanning_wifi" && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={BRAND} />
            <Text style={[styles.h2, { marginTop: 20 }]}>Scanning Networks</Text>
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
        )}

        {/* ──── SELECT HOME WIFI ──── */}
        {step === "select_wifi" && (
          <View>
            <View style={styles.center}>
              <MaterialCommunityIcons name="router-wireless" size={50} color={BRAND} />
            </View>
            <Text style={styles.h2}>Select Wi-Fi Network</Text>
            <Text style={styles.p}>
              Choose your home Wi-Fi network. Only 2.4GHz networks are shown.
            </Text>

            {wifiNetworks.length === 0 ? (
              <View style={styles.center}>
                <Text style={styles.p}>No networks found.</Text>
                <TouchableOpacity style={styles.btnOutline} onPress={runWifiScan}>
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

                <TouchableOpacity style={[styles.btnOutline, { marginTop: 16 }]} onPress={runWifiScan}>
                  <MaterialCommunityIcons name="refresh" size={18} color={BRAND} style={{ marginRight: 8 }} />
                  <Text style={styles.btnTxtBrand}>Scan Again</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* ──── ENTER WIFI PASSWORD ──── */}
        {step === "enter_password" && (
          <View>
            <View style={styles.center}>
              <MaterialCommunityIcons name="wifi-lock" size={50} color={BRAND} />
            </View>
            <Text style={styles.h2}>Enter Wi-Fi Password</Text>
            <Text style={styles.p}>
              Enter the password for &quot;{selectedWifi?.ssid}&quot;.
            </Text>

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Wi-Fi password"
              secureTextEntry
              autoFocus
            />

            <TouchableOpacity
              style={[styles.btnMain, loading && styles.btnDisabled]}
              onPress={() => {
                if (selectedWifi) sendCredentials(selectedWifi.ssid, password);
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

        {/* ──── PROVISIONING (config + auto-leave) ──── */}
        {step === "provisioning" && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={BRAND} />
            <Text style={[styles.h2, { marginTop: 20 }]}>Setting Up Device</Text>
            <Text style={styles.statusText}>{statusText}</Text>
            <Text style={[styles.statusText, { marginTop: 12, fontSize: 13, color: "#999" }]}>
              Returning your phone to your home Wi-Fi…
            </Text>
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

            <TouchableOpacity
              style={styles.btnMain}
              onPress={() => {
                ap.reset();
                setErrorText("");
                runApScan();
              }}
            >
              <Text style={styles.btnTxt}>Try Again</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.btnOutline} onPress={() => router.back()}>
              <Text style={styles.btnTxtBrand}>Go Back</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ═══════════════════════════════════════
// Styles (mirrors pairing.tsx for visual consistency)
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

  input: { backgroundColor: "#F5F7FA", padding: 15, borderRadius: 12, marginBottom: 16, fontSize: 16, borderWidth: 1, borderColor: "#E8E8E8" },

  btnMain: { backgroundColor: BRAND, padding: 16, borderRadius: 12, width: "100%", alignItems: "center", marginTop: 12, flexDirection: "row", justifyContent: "center" },
  btnDisabled: { opacity: 0.6 },
  btnOutline: { borderColor: BRAND, borderWidth: 1.5, padding: 14, borderRadius: 12, width: "100%", alignItems: "center", marginTop: 12, flexDirection: "row", justifyContent: "center" },
  btnTxt: { color: "#fff", fontWeight: "700", fontSize: 16 },
  btnTxtBrand: { color: BRAND, fontWeight: "700", fontSize: 15 },

  infoBox: { backgroundColor: "#F0F5FA", padding: 16, borderRadius: 12, marginBottom: 20, width: "100%", borderWidth: 1, borderColor: "#E0E8F0" },
  infoTitle: { fontWeight: "700", color: "#333", marginBottom: 8, fontSize: 15 },
  infoText: { color: "#555", fontSize: 14, lineHeight: 22 },

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

  joinPill: {
    backgroundColor: BRAND,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    marginLeft: 8,
  },
  joinPillTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },
});
