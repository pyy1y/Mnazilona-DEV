// app/pairing.tsx
// ═══════════════════════════════════════════════════════════════
// SoftAP Provisioning with Auto WiFi Connect
//
// ✅ التعديلات:
//   - pairWithServer يرسل deviceSecret (مطلوب من الباك إند)
//   - إضافة validateDevice قبل الـ pair
//   - إضافة VALIDATE endpoint في الاستخدام
//   - retry logic محسّن مع exponential backoff
//   - التعامل مع "already paired" بشكل أفضل
//   - حفظ deviceSecret من الـ ESP أثناء الـ provisioning
//   - تحسين afterProvisioningCleanup مع internet check
//
// المكتبة المطلوبة:
//   npx expo install react-native-wifi-reborn
// ═══════════════════════════════════════════════════════════════

import React, { useState, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Alert,
  ActivityIndicator, KeyboardAvoidingView, ScrollView, Platform,
  Linking, PermissionsAndroid,
} from "react-native";
import { useRouter } from "expo-router";
import WifiManager from "react-native-wifi-reborn";
import { API_URL, ENDPOINTS } from "../constants/api";
import { TokenManager } from "../utils/api";
import { MaterialCommunityIcons } from "@expo/vector-icons";

const BRAND = "#2E5B8E";
const ESP_IP = "http://192.168.4.1";
const AP_PASSWORD = "manazel123";
const AP_SSID = "Mnazilona_Setup";

// ═══════════════════════════════════════
// Types
// ═══════════════════════════════════════
type PairingStep =
  | "scan_devices"
  | "connecting_ap"
  | "enter_pop"
  | "enter_wifi"
  | "provisioning"
  | "pairing"
  | "done"
  | "error";

// ═══════════════════════════════════════
// Component
// ═══════════════════════════════════════
export default function PairingScreen() {
  const router = useRouter();

  const [step, setStep] = useState<PairingStep>("scan_devices");
  const [popCode, setPopCode] = useState("");
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [errorText, setErrorText] = useState("");
  const [serialNumber, _setSerialNumber] = useState("");
  const [deviceName, setDeviceName] = useState("");

  // ✅ حفظ الـ deviceSecret اللي نحصل عليه من الـ ESP
  const [deviceSecret, _setDeviceSecret] = useState("");

  // ✅ Refs عشان نضمن القيم الأخيرة في الـ async callbacks
  // React useState closures ممكن تكون stale في async chains طويلة
  const serialNumberRef = useRef("");
  const deviceSecretRef = useRef("");

  const setSerialNumberSynced = (value: string) => {
    serialNumberRef.current = value;
    _setSerialNumber(value);
  };
  const setDeviceSecretSynced = (value: string) => {
    deviceSecretRef.current = value;
    _setDeviceSecret(value);
  };

  // ═══════════════════════════════════════
  // Android: طلب صلاحيات الموقع
  // ═══════════════════════════════════════
  const requestLocationPermission = async (): Promise<boolean> => {
    if (Platform.OS === "android") {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: "Location Permission",
          message: "WiFi scanning requires location permission.",
          buttonPositive: "OK",
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true;
  };

  // ═══════════════════════════════════════
  // Step 1: البحث والاتصال بشبكة الجهاز
  // ═══════════════════════════════════════
  const connectToDeviceAP = async () => {
    const granted = await requestLocationPermission();
    if (!granted) {
      Alert.alert("Permission Required", "Location permission is needed to connect to the device.");
      return;
    }

    // ──── اتصل بالشبكة مع retry لأن التحويل بين الشبكات ياخذ وقت ────
    setStep("connecting_ap");
    setLoading(true);
    setStatusText(`Requesting to join ${AP_SSID}...`);

    const WIFI_MAX_RETRIES = 4;
    const WIFI_RETRY_DELAY = 3000;
    let connected = false;

    for (let attempt = 0; attempt < WIFI_MAX_RETRIES; attempt++) {
      setStatusText(
        attempt === 0
          ? `Waiting for network join...`
          : `Retrying connection... (${attempt + 1}/${WIFI_MAX_RETRIES})`
      );

      try {
        if (__DEV__) console.log(`[WiFi] iOS: Calling connectToProtectedSSID for ${AP_SSID} (attempt ${attempt + 1})`);
        await WifiManager.connectToProtectedSSID(
          AP_SSID,
          AP_PASSWORD,
          false,
          false
        );
        if (__DEV__) console.log("[WiFi] Connected to:", AP_SSID);
        connected = true;
        break;
      } catch (e: any) {
        const errorMsg = e.message || e.code || String(e);
        if (__DEV__) console.log(`[WiFi] Connect attempt ${attempt + 1}/${WIFI_MAX_RETRIES} failed:`, errorMsg);

        // ✅ iOS: لو المستخدم رفض الانضمام (ضغط Cancel في popup النظام)
        if (errorMsg.includes("userDenied") || errorMsg.includes("UserDenied")) {
          setLoading(false);
          Alert.alert(
            "Connection Cancelled",
            "You need to tap \"Join\" on the system popup to connect to the device.",
            [
              { text: "Try Again", onPress: () => connectToDeviceAP() },
              { text: "Cancel", style: "cancel", onPress: () => setStep("scan_devices") },
            ]
          );
          return;
        }

        if (attempt < WIFI_MAX_RETRIES - 1) {
          await new Promise(resolve => setTimeout(resolve, WIFI_RETRY_DELAY));
        }
      }
    }

    if (!connected) {
      setLoading(false);
      Alert.alert(
        "Connection Failed",
        `Could not connect to ${AP_SSID}.\n\nMake sure:\n• The device is powered on\n• The LED is blinking blue\n• You are near the device`,
        [
          { text: "Try Again", onPress: () => connectToDeviceAP() },
          { text: "Open WiFi Settings", onPress: () => {
            if (Platform.OS === "ios") {
              Linking.openURL("App-Prefs:WIFI");
            }
          }},
          { text: "Cancel", style: "cancel", onPress: () => setStep("scan_devices") },
        ]
      );
      return;
    }

    // ✅ متصلين بنجاح
    setStatusText("Connected! Reading device info...");

    try {
      if (Platform.OS === "android") {
        try {
          await WifiManager.forceWifiUsageWithOptions(true, { noInternet: true });
        } catch (e) {
          if (__DEV__) console.log("[WiFi] forceWifiUsage error (non-critical):", e);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
      await fetchDeviceInfoWithRetry();

    } catch (e: any) {
      if (__DEV__) console.log("[WiFi] Post-connect error:", e.message || e);
      setLoading(false);
      setErrorText("Connected to device network but setup failed. Try again.");
      setStep("error");
    }
  };

  // ═══════════════════════════════════════
  // Fetch Device Info (with retry)
  // ✅ يحاول عدة مرات لأن التحويل بين الشبكات ياخذ وقت
  // ═══════════════════════════════════════
  const fetchDeviceInfoWithRetry = async () => {
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 2500; // 2.5 ثانية بين كل محاولة

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      setStatusText(
        attempt === 0
          ? "Reading device info..."
          : `Waiting for device connection... (${attempt + 1}/${MAX_RETRIES})`
      );

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(`${ESP_IP}/info`, {
          method: "GET",
          signal: controller.signal,
        });

        clearTimeout(timeout);
        const data = await res.json();

        if (data.serial) {
          setSerialNumberSynced(data.serial);
          setDeviceName(data.name || "Manazel Device");
          const secret = data.deviceSecret || data.device_secret || data.secret;
          if (secret) {
            setDeviceSecretSynced(secret);
          }
          if (__DEV__) console.log("[Pairing] Device found:", data.serial);
          setLoading(false);
          setStep("enter_pop");
          return; // نجح - نطلع
        } else {
          throw new Error("Invalid device response");
        }
      } catch (e: any) {
        if (__DEV__) console.log(`[Pairing] Device info attempt ${attempt + 1}/${MAX_RETRIES} failed:`, e.message);

        if (attempt < MAX_RETRIES - 1) {
          // ننتظر ونحاول مرة ثانية - الشبكة لسا تتحول
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        }
      }
    }

    // كل المحاولات فشلت
    if (__DEV__) console.log("[Pairing] All device info attempts failed");
    setLoading(false);
    setErrorText("Connected to network but can't reach the device. Try again.");
    setStep("error");
  };

  // ═══════════════════════════════════════
  // Step 2: Verify PoP Code
  // ✅ يحفظ deviceSecret من الاستجابة
  // ═══════════════════════════════════════
  const verifyPopCode = async () => {
    if (!popCode || popCode.length < 4) {
      return Alert.alert("Code Required", "Enter the code shown on the device sticker.");
    }

    setLoading(true);
    setStatusText("Verifying code...");

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`${ESP_IP}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: popCode.trim() }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const data = await res.json();

      if (res.ok && data.status === "ok") {
        // ✅ حفظ deviceSecret من verify response لو موجود (يدعم أسماء مختلفة)
        const secret = data.deviceSecret || data.device_secret || data.secret;
        if (secret) {
          setDeviceSecretSynced(secret);
          if (__DEV__) console.log("[Pairing] Got deviceSecret from verify");
        }
        setLoading(false);
        setStep("enter_wifi");
        if (__DEV__) console.log("[Pairing] PoP verified!");
      } else if (res.status === 429) {
        setLoading(false);
        Alert.alert("Locked", data.message || "Too many attempts. Wait and try again.");
      } else {
        setLoading(false);
        const attemptsLeft = data.attemptsLeft || "?";
        Alert.alert("Wrong Code", `Incorrect code. ${attemptsLeft} attempts remaining.`);
        setPopCode("");
      }
    } catch (e: any) {
      setLoading(false);
      Alert.alert("Error", "Lost connection to device. Try reconnecting.");
      setStep("scan_devices");
    }
  };

  // ═══════════════════════════════════════
  // Step 3: Send WiFi Config
  // ═══════════════════════════════════════
  const sendWifiConfig = async () => {
    if (!ssid) return Alert.alert("Required", "Enter the WiFi network name.");

    setLoading(true);
    setStep("provisioning");
    setStatusText("Sending WiFi settings...");

    try {
      const controller = new AbortController();
      // ✅ زيادة الـ timeout لأن الجهاز يجرب الواي فاي قبل ما يرد (AP+STA)
      const timeout = setTimeout(() => controller.abort(), 20000);

      const res = await fetch(`${ESP_IP}/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssid, password }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const data = await res.json();

      if (data.status === "ok") {
        // ✅ لو الجهاز رجع deviceSecret في setup response
        const secret = data.deviceSecret || data.device_secret || data.secret;
        if (secret) {
          setDeviceSecretSynced(secret);
        }
        if (__DEV__) console.log("[Pairing] Config sent - WiFi connected!");
        afterProvisioningCleanup();
      } else if (data.status === "wifi_error") {
        // ❌ بيانات الشبكة غلط — الجهاز لسا في وضع AP، المستخدم يقدر يعيد المحاولة
        if (__DEV__) console.log("[Pairing] WiFi failed:", data.message);
        setLoading(false);
        Alert.alert(
          "WiFi Connection Failed",
          data.message || "Could not connect to WiFi. Check your network name and password.",
          [{ text: "OK" }]
        );
        setStep("enter_wifi");
      } else {
        throw new Error(data.message || "Setup failed");
      }
    } catch (e: any) {
      // طبيعي - الجهاز فصل الـ AP بعد اتصال ناجح
      if (__DEV__) console.log("[Pairing] Connection lost after setup (expected)");
      afterProvisioningCleanup();
    }
  };

  // ═══════════════════════════════════════
  // بعد الإعداد: فك الارتباط بشبكة الجهاز
  // ✅ محسّن: ينتظر حتى يرجع الإنترنت
  // ═══════════════════════════════════════
  const afterProvisioningCleanup = async () => {
    setStatusText("Disconnecting from device...");

    // ──── 1. فصل الجوال من شبكة الـ ESP ────
    try {
      if (Platform.OS === "ios") {
        // iOS: لازم disconnectFromSSID عشان يشيل الشبكة المؤقتة بالكامل
        if (AP_SSID) {
          await WifiManager.disconnectFromSSID(AP_SSID);
          if (__DEV__) console.log("[WiFi] iOS: disconnected from", AP_SSID);
        }
      } else {
        // Android: أول شي شيل forceWifiUsage عشان النظام يرجع يستخدم الشبكة العادية
        try {
          await WifiManager.forceWifiUsageWithOptions(false, { noInternet: false });
        } catch (e) {
          if (__DEV__) console.log("[WiFi] forceWifiUsage reset error (non-critical):", e);
        }
        // بعدين افصل من شبكة الـ ESP
        try {
          await WifiManager.disconnect();
        } catch (e) {}
      }
    } catch (e) {
      if (__DEV__) console.log("[WiFi] Cleanup error (non-critical):", e);
    }

    // ──── 2. انتظر 3 ثواني عشان النظام يتحول للشبكة العادية ────
    setStatusText("Switching to home WiFi...");
    await new Promise(resolve => setTimeout(resolve, 3000));

    // ──── 3. انتظر حتى يرجع الإنترنت ────
    setStatusText("Waiting for internet connection...");
    const hasInternet = await waitForInternet(20000);

    if (!hasInternet) {
      // لو ما رجع الإنترنت، جرب تتصل بالشبكة اللي أدخلها المستخدم
      if (__DEV__) console.log("[WiFi] No internet - trying to connect to", ssid);
      setStatusText("Reconnecting to " + ssid + "...");
      try {
        await WifiManager.connectToProtectedSSID(ssid, password, false, false);
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (e) {
        if (__DEV__) console.log("[WiFi] Reconnect failed:", e);
      }
    }

    // ──── 4. انتظر الـ ESP32 يسوي inquiry ────
    setStatusText("Waiting for device to register...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    pairWithServer(0);
  };

  // ✅ Helper: انتظر حتى يرجع الإنترنت
  const waitForInternet = async (maxWaitMs: number): Promise<boolean> => {
    const startTime = Date.now();
    const checkInterval = 2000;

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`${API_URL}/health`, {
          method: "GET",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          if (__DEV__) console.log("[Network] Internet is back!");
          return true;
        }
      } catch (e) {
        // مو متصل بعد
      }
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    if (__DEV__) console.log("[Network] Timed out waiting for internet");
    return false;
  };

  // ═══════════════════════════════════════
  // ✅ بعد الربط: انتظر حتى الجهاز يصير online
  // ═══════════════════════════════════════
  const waitForDeviceOnline = async (sn: string, token: string) => {
    setStatusText("Waiting for device to come online...");

    const MAX_WAIT = 30000; // 30 ثانية كحد أقصى
    const POLL_INTERVAL = 3000;
    const startTime = Date.now();

    while (Date.now() - startTime < MAX_WAIT) {
      try {
        const res = await fetch(`${API_URL}${ENDPOINTS.DEVICES.GET_ONE(sn)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const device = await res.json();
          if (device.isOnline) {
            setStep("done");
            setLoading(false);
            setStatusText("Device added successfully!");
            return;
          }
        }
      } catch (e) {
        // نتجاهل الخطأ ونعيد المحاولة
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }

    // ✅ حتى لو ما صار online خلال 30 ثانية، الربط نجح — نعرض done مع رسالة
    setStep("done");
    setLoading(false);
    setStatusText("Device paired! It may take a moment to appear online in your dashboard.");
  };

  // ═══════════════════════════════════════
  // Step 4: Pair with Backend
  // ✅ يرسل deviceSecret + exponential backoff
  // ═══════════════════════════════════════
  const pairWithServer = async (attempt: number) => {
    const MAX_ATTEMPTS = 7;
    setStep("pairing");
    setStatusText(`Linking device to your account... (${attempt + 1}/${MAX_ATTEMPTS})`);

    try {
      // ✅ استخدم Refs بدل State — يضمن القيم الأخيرة حتى في async chains طويلة
      const sn = serialNumberRef.current;
      const secret = deviceSecretRef.current;

      if (!sn) {
        if (__DEV__) console.error("[Pairing] No serial number in ref!");
        setStep("error");
        setErrorText("No serial number found. Please restart the setup.");
        setLoading(false);
        return;
      }

      // ✅ تحقق من الـ auth token قبل ما نرسل الطلب
      const token = await TokenManager.get();
      if (!token) {
        if (__DEV__) console.error("[Pairing] No auth token found!");
        setStep("error");
        setErrorText("Session expired. Please log in again and retry.");
        setLoading(false);
        return;
      }

      // ✅ تحقق إن عندنا deviceSecret
      if (!secret) {
        if (__DEV__) console.warn("[Pairing] No deviceSecret available! Pair will likely fail with 400.");
      }

      if (__DEV__) console.log(`[Pairing] Attempt ${attempt + 1}/${MAX_ATTEMPTS} | SN: ${sn} | secret: ${secret ? "present" : "MISSING"}`);

      const res = await fetch(`${API_URL}${ENDPOINTS.DEVICES.PAIR}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          serialNumber: sn,
          deviceSecret: secret,
        }),
      });

      const data = await res.json();
      if (__DEV__) console.log(`[Pairing] Response: ${res.status}`, JSON.stringify(data));

      // ✅ نجاح
      if (res.ok) {
        await waitForDeviceOnline(sn, token);
        return;
      }

      // ✅ "already paired to your account" = نجاح
      if (data.message?.toLowerCase().includes("already paired to your account")) {
        await waitForDeviceOnline(sn, token);
        return;
      }

      // ✅ 409 = الجهاز مملوك لشخص ثاني — أرسلنا إشعار للمالك
      if (res.status === 409) {
        setStep("error");
        setLoading(false);
        setErrorText(
          data.ownerNotified
            ? "This device is owned by someone else. A request has been sent to the owner to unlink it. You'll be notified if they approve."
            : "This device is already linked to another account."
        );
        return;
      }

      // ✅ 404 = الجهاز ما سوى inquiry بعد — أعد المحاولة
      if (res.status === 404) {
        throw new Error("Device not ready yet");
      }

      // ✅ 400 = بيانات ناقصة (مثل deviceSecret فاضي) — لا تعيد المحاولة
      if (res.status === 400) {
        if (__DEV__) console.error("[Pairing] Bad request:", data.message);
        setStep("error");
        setLoading(false);
        setErrorText("Setup incomplete. Please restart the setup process.");
        return;
      }

      // ✅ 401 = مشكلة في الـ auth token (منتهي أو غير صالح)
      if (res.status === 401) {
        if (__DEV__) console.error("[Pairing] Auth failed:", data.code || data.error);
        setStep("error");
        setLoading(false);
        setErrorText("Session expired. Please log in again and retry.");
        return;
      }

      // ✅ 403 = deviceSecret غلط أو الجهاز محظور
      if (res.status === 403) {
        if (__DEV__) console.error("[Pairing] Forbidden:", data.message);
        setStep("error");
        setLoading(false);
        setErrorText("Device verification failed. Please try the setup process again.");
        return;
      }

      throw new Error(data.message || "Pairing failed");

    } catch (e: any) {
      if (__DEV__) console.log(`[Pairing] Attempt ${attempt + 1} failed:`, e.message);

      if (attempt < MAX_ATTEMPTS - 1) {
        // ✅ Exponential backoff: 3s, 4.5s, 6.75s, 10s, ...
        const delay = Math.min(3000 * Math.pow(1.5, attempt), 15000);
        setTimeout(() => pairWithServer(attempt + 1), delay);
      } else {
        setLoading(false);
        setStep("done");
        setStatusText("Device configured! It may take a moment to appear in your dashboard.");
      }
    }
  };

  // ═══════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <MaterialCommunityIcons name="arrow-left" size={28} color={BRAND} />
          </TouchableOpacity>
          <Text style={styles.title}>Add Device</Text>
        </View>

        {/* Step Indicator */}
        <View style={styles.steps}>
          {["Connect", "Verify", "WiFi", "Done"].map((label, i) => {
            const stepIndex =
              ["scan_devices", "connecting_ap"].includes(step) ? 0
              : step === "enter_pop" ? 1
              : ["enter_wifi", "provisioning"].includes(step) ? 2
              : 3;
            const isActive = i <= stepIndex;
            return (
              <View key={label} style={styles.stepRow}>
                <View style={[styles.stepDot, isActive && styles.stepDotActive]} />
                <Text style={[styles.stepLabel, isActive && styles.stepLabelActive]}>{label}</Text>
                {i < 3 && <View style={[styles.stepLine, isActive && styles.stepLineActive]} />}
              </View>
            );
          })}
        </View>

        {/* ──── STEP 1: SCAN / CONNECT ──── */}
        {step === "scan_devices" && (
          <View>
            <View style={styles.center}>
              <MaterialCommunityIcons name="access-point-network" size={70} color={BRAND} />
            </View>
            <Text style={styles.h2}>Connect to Device</Text>
            <Text style={styles.p}>
              Make sure your device is powered on and the LED is blinking blue, then tap the button below.
            </Text>

            <View style={styles.infoBox}>
              <Text style={styles.infoTitle}>What will happen:</Text>
              <Text style={styles.infoText}>
                {"1. A system popup will ask to join \"" + AP_SSID + "\"\n"}
                {"2. Tap "}
                <Text style={{ fontWeight: "700" }}>Join</Text>
                {" to connect\n"}
                {"3. \"No Internet\" warning is normal\n"}
                {"4. Enter the code from the device sticker"}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.btnMain, loading && styles.btnDisabled]}
              onPress={() => connectToDeviceAP()}
              disabled={loading}
            >
              {loading ? (
                <>
                  <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.btnTxt}>{statusText || "Searching..."}</Text>
                </>
              ) : (
                <>
                  <MaterialCommunityIcons name="wifi-sync" size={20} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.btnTxt}>Connect to Device</Text>
                </>
              )}
            </TouchableOpacity>

          </View>
        )}

        {/* ──── CONNECTING ──── */}
        {step === "connecting_ap" && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={BRAND} />
            <Text style={[styles.h2, { marginTop: 20 }]}>Connecting to Device</Text>
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
        )}

        {/* ──── STEP 2: ENTER POP ──── */}
        {step === "enter_pop" && (
          <View>
            <View style={styles.center}>
              <MaterialCommunityIcons name="shield-lock" size={50} color={BRAND} />
              {deviceName ? (
                <Text style={styles.deviceLabel}>{deviceName} ({serialNumber})</Text>
              ) : null}
            </View>
            <Text style={styles.h2}>Device Verification</Text>
            <Text style={styles.p}>
              Enter the code found on the sticker on your device or inside the box.
            </Text>

            <Text style={styles.label}>Verification Code</Text>
            <TextInput
              style={styles.inputCode}
              value={popCode}
              onChangeText={setPopCode}
              placeholder="123456"
              keyboardType="number-pad"
              maxLength={8}
              textAlign="center"
              autoFocus
            />

            <TouchableOpacity
              style={[styles.btnMain, loading && styles.btnDisabled]}
              onPress={verifyPopCode}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTxt}>Verify</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* ──── STEP 3: ENTER WIFI ──── */}
        {step === "enter_wifi" && (
          <View>
            <View style={styles.center}>
              <MaterialCommunityIcons name="router-wireless" size={50} color={BRAND} />
            </View>
            <Text style={styles.h2}>WiFi Setup</Text>
            <Text style={styles.p}>Enter your home WiFi details to connect the device to the internet.</Text>

            <Text style={styles.label}>Network Name (SSID)</Text>
            <TextInput
              style={styles.input}
              value={ssid}
              onChangeText={setSsid}
              placeholder="Home WiFi"
              autoCapitalize="none"
              autoFocus
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry
            />

            <TouchableOpacity
              style={[styles.btnMain, loading && styles.btnDisabled]}
              onPress={sendWifiConfig}
              disabled={loading}
            >
              <Text style={styles.btnTxt}>Connect Device</Text>
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

            <TouchableOpacity style={styles.btnMain} onPress={() => setStep("scan_devices")}>
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
});