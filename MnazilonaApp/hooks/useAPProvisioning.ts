// hooks/useAPProvisioning.ts
// ═══════════════════════════════════════════════════════════════
// Wi-Fi AP Provisioning Hook
//
// Counterpart to useBLEProvisioning for devices running the
// GarageRelayFirmwareWiFiAP firmware variant. Uses
// react-native-wifi-reborn so the phone joins / leaves the device
// SoftAP programmatically — no manual trip to OS Wi-Fi settings.
//
// Endpoints (matching the firmware):
//   GET  /info     → { serial, name, fw, deviceSecret, ... }
//   GET  /scan     → { status, count, networks: [{ ssid, rssi, secure }] }
//   POST /config   → { status: "received", deviceSecret, serial }
//   GET  /health   → { ok: true }
//
// Flow (high level):
//   1. App scans for nearby "MNZ_*" Wi-Fi networks (Android) or
//      uses iOS prefix-join.
//   2. User taps "Join". App calls connectToProtectedSSID(...).
//   3. App calls /info, /scan, /config over http://192.168.4.1.
//   4. After /config, app drops the AP — phone auto-reconnects to
//      the user's home Wi-Fi.
// ═══════════════════════════════════════════════════════════════

import { useCallback, useRef, useState } from "react";
import { Platform, PermissionsAndroid } from "react-native";
import WifiManager from "react-native-wifi-reborn";

const AP_BASE_URL = "http://192.168.4.1";
const AP_SSID_PREFIX = "MNZ_";

const PING_TIMEOUT_MS = 4000;
const INFO_TIMEOUT_MS = 6000;
const SCAN_TIMEOUT_MS = 20000;
const CONFIG_TIMEOUT_MS = 10000;

// How long after connecting to the AP we wait before the first HTTP
// call. Gives DHCP time to assign 192.168.4.x.
const AP_SETTLE_MS = 1500;

// On Android 10+ the WifiNetworkSpecifier connection takes a moment
// to fully bind to the app process after forceWifiUsage. The first
// fetch often fails; retry pings until we get one through.
const AP_PING_ATTEMPTS = 8;
const AP_PING_INTERVAL_MS = 1500;

// How long we wait after /config so the phone has time to drop the
// AP and rejoin the home Wi-Fi before the app starts polling the
// backend.
const POST_CONFIG_LEAVE_MS = 5000;

export interface APDeviceInfo {
  serial: string;
  name: string;
  type: string;
  fw: string;
  popRequired: boolean;
  deviceSecret: string;
  transport: string;
}

export interface APWiFiNetwork {
  ssid: string;
  rssi: number;
  secure: boolean;
}

export interface DiscoveredAP {
  ssid: string;     // e.g. "MNZ_SN-001"
  level: number;    // RSSI in dBm
  serialNumber: string;
}

type APState =
  | "idle"
  | "scanning_aps"  // scanning nearby Wi-Fi for MNZ_* devices
  | "joining"       // calling connectToProtectedSSID
  | "joined"        // system Wi-Fi join completed (not yet verified)
  | "verifying"     // running forceWifiUsage + ping retries
  | "connected"     // AP joined, /health OK
  | "scanning"      // device-side Wi-Fi scan
  | "configuring"
  | "leaving"
  | "error";

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Android: ACCESS_FINE_LOCATION is required for scanning + for
//    joining specific SSIDs on API 29+. Request it once up front.
async function ensureLocationPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true;

  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export function useAPProvisioning() {
  const [apState, setApState] = useState<APState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<APDeviceInfo | null>(null);
  const [discoveredAPs, setDiscoveredAPs] = useState<DiscoveredAP[]>([]);
  const joinedSsidRef = useRef<string | null>(null);
  const cancelRef = useRef(false);

  // ── Scan nearby Wi-Fi for MNZ_* networks (Android only). ──
  // iOS doesn't allow Wi-Fi scanning, so this returns []; the UI
  // should fall back to a prefix-join button on iOS.
  const scanForDeviceAPs = useCallback(async (): Promise<DiscoveredAP[]> => {
    setApState("scanning_aps");
    setError(null);

    if (Platform.OS !== "android") {
      // iOS: nothing to scan. Show single "Join MNZ_…" button instead.
      setDiscoveredAPs([]);
      setApState("idle");
      return [];
    }

    const permOk = await ensureLocationPermission();
    if (!permOk) {
      setError("Location permission is required to scan for nearby devices.");
      setApState("error");
      return [];
    }

    try {
      const list = await WifiManager.reScanAndLoadWifiList();
      const aps: DiscoveredAP[] = list
        .filter((n) => n.SSID && n.SSID.startsWith(AP_SSID_PREFIX))
        // Some Android devices return duplicates from different BSSIDs.
        .reduce<DiscoveredAP[]>((acc, n) => {
          if (acc.find((a) => a.ssid === n.SSID)) return acc;
          acc.push({
            ssid: n.SSID,
            level: n.level,
            serialNumber: n.SSID.substring(AP_SSID_PREFIX.length),
          });
          return acc;
        }, [])
        .sort((a, b) => b.level - a.level);

      setDiscoveredAPs(aps);
      setApState("idle");
      return aps;
    } catch (e: any) {
      if (__DEV__) console.warn("[AP] scan error:", e?.message);
      setError(
        "Couldn't scan for Wi-Fi networks. Make sure location services are on."
      );
      setApState("error");
      return [];
    }
  }, []);

  // ── Trigger the system Wi-Fi join. ──
  // Returns when the OS Wi-Fi join attempt completes (success or
  // user-denied). We do NOT verify reachability here — the caller
  // shows a "I'm connected" screen and explicitly calls
  // verifyConnection() once the user has confirmed.
  //
  // Android: exact SSID via WifiNetworkSpecifier. System prompt asks
  //   the user to allow joining MNZ_*.
  // iOS: NEHotspotConfiguration via prefix or exact SSID. System
  //   sheet asks the user to join.
  const triggerJoin = useCallback(
    async (ssid: string | null, password: string): Promise<boolean> => {
      setApState("joining");
      setError(null);

      try {
        if (Platform.OS === "android") {
          if (!ssid) throw new Error("SSID is required on Android");

          const permOk = await ensureLocationPermission();
          if (!permOk) {
            setError("Location permission is required to join Wi-Fi networks.");
            setApState("error");
            return false;
          }

          // 4th arg = isHidden; the Mnazilona AP is broadcast so false.
          await WifiManager.connectToProtectedSSID(ssid, password, false, false);
          joinedSsidRef.current = ssid;
        } else {
          // iOS — prefer exact SSID if we have one, fall back to
          // prefix join. joinOnce=true so the system forgets the
          // network when the app exits.
          if (ssid) {
            await WifiManager.connectToProtectedSSIDOnce(ssid, password, false, true);
            joinedSsidRef.current = ssid;
          } else {
            await WifiManager.connectToProtectedSSIDPrefixOnce(
              AP_SSID_PREFIX,
              password,
              false,
              true
            );
            try {
              joinedSsidRef.current = await WifiManager.getCurrentWifiSSID();
            } catch {
              joinedSsidRef.current = null;
            }
          }
        }

        setApState("joined");
        return true;
      } catch (e: any) {
        if (__DEV__) console.warn("[AP] join failed:", e?.message || e);
        const code: string = typeof e === "string" ? e : e?.message || "";
        let msg = "Couldn't join the device Wi-Fi.";
        if (code.includes("userDenied")) msg = "Join was cancelled.";
        else if (code.includes("authenticationErrorOccurred"))
          msg = "Wrong AP password (the device defaults to mnazilona1234).";
        else if (code.includes("locationPermissionMissing"))
          msg = "Location permission is required to join Wi-Fi networks.";
        else if (code.includes("locationServicesOff"))
          msg = "Turn on Location services and try again.";
        else if (code.includes("didNotFindNetwork"))
          msg = "Device Wi-Fi not in range. Make sure the device is powered on.";
        setError(msg);
        setApState("error");
        return false;
      }
    },
    []
  );

  // ── /health ping — internal helper, doesn't touch state. ──
  const pingDeviceInternal = async (): Promise<boolean> => {
    try {
      const res = await fetchWithTimeout(
        `${AP_BASE_URL}/health`,
        { method: "GET", headers: { Accept: "application/json" } },
        PING_TIMEOUT_MS
      );
      return res.ok;
    } catch {
      return false;
    }
  };

  const pingDevice = useCallback(pingDeviceInternal, []);

  // ── Verify the AP is actually reachable. ──
  // Called AFTER triggerJoin, once the user has confirmed they're on
  // the device Wi-Fi. Pins app traffic to the AP (Android 10+ needs
  // this — otherwise fetch() goes through cellular) and retries the
  // /health probe until it answers or we run out of attempts.
  const verifyConnection = useCallback(async (): Promise<boolean> => {
    setApState("verifying");
    setError(null);

    // Settle briefly — gives DHCP time to assign 192.168.4.x if the
    // user only just tapped Join in the system prompt.
    await new Promise((r) => setTimeout(r, AP_SETTLE_MS));

    if (Platform.OS === "android") {
      try {
        await WifiManager.forceWifiUsageWithOptions(true, { noInternet: true });
        // Give the binding a moment to propagate before fetch().
        await new Promise((r) => setTimeout(r, 500));
      } catch (e: any) {
        if (__DEV__) console.warn("[AP] forceWifiUsage failed:", e?.message);
        // non-fatal — older Android versions may still route correctly
      }
    }

    for (let i = 0; i < AP_PING_ATTEMPTS; i++) {
      if (await pingDeviceInternal()) {
        setApState("connected");
        return true;
      }
      if (__DEV__) console.log(`[AP] ping ${i + 1}/${AP_PING_ATTEMPTS} failed, retrying...`);
      await new Promise((r) => setTimeout(r, AP_PING_INTERVAL_MS));
    }

    setError(
      "Couldn't reach the device on http://192.168.4.1. Make sure your phone is connected to the MNZ_… network and mobile data is off."
    );
    setApState("error");
    return false;
  }, []);

  // ── Drop the AP and let the phone rejoin its home Wi-Fi. ──
  const leaveAP = useCallback(async (): Promise<void> => {
    setApState("leaving");
    try {
      if (Platform.OS === "android") {
        try {
          await WifiManager.forceWifiUsageWithOptions(false, { noInternet: false });
        } catch { /* ignore */ }
        try {
          await WifiManager.disconnect();
        } catch { /* ignore */ }
        const joined = joinedSsidRef.current;
        if (joined) {
          try { await WifiManager.disconnectFromSSID(joined); } catch { /* ignore */ }
        }
      } else {
        // iOS — remove the NEHotspotConfiguration entry (joinOnce=true
        // already auto-removes on app exit, but we do it eagerly so
        // the phone rejoins home Wi-Fi as fast as possible).
        const joined = joinedSsidRef.current;
        try {
          await WifiManager.disconnectFromSSID(joined || AP_SSID_PREFIX);
        } catch { /* ignore */ }
      }
    } finally {
      joinedSsidRef.current = null;
      setApState("idle");
    }
  }, []);

  // ── GET /info ──
  const fetchDeviceInfo = useCallback(async (): Promise<APDeviceInfo | null> => {
    try {
      const res = await fetchWithTimeout(
        `${AP_BASE_URL}/info`,
        { method: "GET", headers: { Accept: "application/json" } },
        INFO_TIMEOUT_MS
      );
      if (!res.ok) {
        setError(`Device returned HTTP ${res.status} for /info`);
        setApState("error");
        return null;
      }
      const data = (await res.json()) as APDeviceInfo;
      setDeviceInfo(data);
      setApState("connected");
      return data;
    } catch (e: any) {
      if (__DEV__) console.warn("[AP] /info failed:", e?.message);
      setError("Lost connection to the device. Try rejoining the device Wi-Fi.");
      setApState("error");
      return null;
    }
  }, []);

  // ── GET /scan ──
  const fetchWiFiNetworks = useCallback(async (): Promise<APWiFiNetwork[]> => {
    setApState("scanning");
    try {
      const res = await fetchWithTimeout(
        `${AP_BASE_URL}/scan`,
        { method: "GET", headers: { Accept: "application/json" } },
        SCAN_TIMEOUT_MS
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const networks: APWiFiNetwork[] = Array.isArray(data?.networks)
        ? data.networks
        : [];
      networks.sort((a, b) => b.rssi - a.rssi);
      setApState("connected");
      return networks;
    } catch (e: any) {
      if (__DEV__) console.warn("[AP] /scan failed:", e?.message);
      setError("Failed to scan for Wi-Fi networks. Try again.");
      setApState("error");
      throw e;
    }
  }, []);

  // ── POST /config ──
  const sendWiFiConfig = useCallback(
    async (
      ssid: string,
      password: string,
      userId?: string
    ): Promise<{ success: boolean; data: any }> => {
      setApState("configuring");
      try {
        const body: any = { ssid, password };
        if (userId) body.userId = userId;

        const res = await fetchWithTimeout(
          `${AP_BASE_URL}/config`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(body),
          },
          CONFIG_TIMEOUT_MS
        );

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          setApState("error");
          setError(data?.message || `Device rejected config (HTTP ${res.status})`);
          return { success: false, data };
        }

        // Capture deviceSecret if /info hadn't returned it earlier.
        if (data?.deviceSecret) {
          setDeviceInfo((prev) =>
            prev
              ? { ...prev, deviceSecret: data.deviceSecret, serial: data.serial || prev.serial }
              : ({
                  serial: data.serial || "",
                  name: "",
                  type: "",
                  fw: "",
                  popRequired: false,
                  deviceSecret: data.deviceSecret,
                  transport: "wifi-ap",
                } as APDeviceInfo)
          );
        }

        // Step away from the AP automatically. The device is also
        // tearing down its AP at this point, so the phone would
        // disconnect anyway — we just speed it up and force the
        // OS back to the home network.
        await leaveAP();

        // Give the OS time to rejoin home Wi-Fi before the caller
        // tries to talk to the backend.
        await new Promise((r) => setTimeout(r, POST_CONFIG_LEAVE_MS));

        setApState("idle");
        return { success: true, data };
      } catch (e: any) {
        if (__DEV__) console.warn("[AP] /config failed:", e?.message);
        setApState("error");
        setError(e?.message || "Failed to send Wi-Fi credentials.");
        return { success: false, data: { status: "error", message: e?.message } };
      }
    },
    [leaveAP]
  );

  const reset = useCallback(() => {
    cancelRef.current = false;
    setApState("idle");
    setError(null);
    setDeviceInfo(null);
    setDiscoveredAPs([]);
    joinedSsidRef.current = null;
  }, []);

  return {
    // State
    apState,
    error,
    deviceInfo,
    discoveredAPs,

    // Actions
    pingDevice,
    scanForDeviceAPs,
    triggerJoin,       // initiate the OS Wi-Fi join (no verification)
    verifyConnection,  // call after user confirms they're on MNZ_…
    leaveAP,
    fetchDeviceInfo,
    fetchWiFiNetworks,
    sendWiFiConfig,
    reset,
  };
}
