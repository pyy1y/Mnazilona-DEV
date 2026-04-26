// hooks/useBLEProvisioning.ts
// ═══════════════════════════════════════════════════════════════
// BLE Provisioning Hook — no PoP code
//
// Uses react-native-ble-plx (already installed in package.json)
// to communicate with Mnazilona ESP32 devices during setup.
//
// Flow:
//   1. Scan for BLE devices advertising the Mnazilona service UUID
//   2. Connect to selected device
//   3. Read device info
//   4. Fetch deviceSecret over the BLE link (no user-entered code)
//   5. Request WiFi scan (device scans, returns results via BLE)
//   6. Send WiFi credentials
//   7. Device connects to WiFi and proceeds to server inquiry
// ═══════════════════════════════════════════════════════════════

import { useRef, useState, useCallback, useEffect } from "react";
import { Platform, PermissionsAndroid } from "react-native";
import { BleManager, Device, Characteristic, BleError } from "react-native-ble-plx";

// Must match the ESP32 firmware UUIDs exactly
const SERVICE_UUID       = "4d4e5a00-4c4f-4e41-0001-000000000000";
const CHAR_DEVICE_INFO   = "4d4e5a00-4c4f-4e41-0001-000000000001";
// CHAR_VERIFY is the legacy PoP-verify characteristic. PoP is gone, but the
// firmware still uses it as the channel that hands the deviceSecret back to
// the app — write any payload, read the secret out of the notify response.
const CHAR_VERIFY        = "4d4e5a00-4c4f-4e41-0001-000000000002";
const CHAR_WIFI_SCAN     = "4d4e5a00-4c4f-4e41-0001-000000000003";
const CHAR_WIFI_CONFIG   = "4d4e5a00-4c4f-4e41-0001-000000000004";
// const CHAR_STATUS     = "4d4e5a00-4c4f-4e41-0001-000000000005";

// BLE device name prefix used by ESP32 firmware
const BLE_NAME_PREFIX = "MNZ_";

export interface DiscoveredDevice {
  id: string;          // BLE peripheral ID (MAC on Android, UUID on iOS)
  name: string;        // e.g. "MNZ_SN-001"
  rssi: number;        // signal strength
  serialNumber: string; // extracted from name
}

export interface WiFiNetwork {
  ssid: string;
  rssi: number;
  secure: boolean;
}

export interface DeviceInfo {
  serial: string;
  name: string;
  type: string;
  fw: string;
  popRequired: boolean;
}

type BLEState =
  | "idle"
  | "scanning"
  | "connecting"
  | "connected"
  | "error";

// ── Chunk reassembly helper ──
// ESP32 sends large payloads as: C0:<data>, C1:<data>, ..., E<n>:<data>
function reassembleChunks(buffer: string[], incoming: string): { complete: boolean; json: string } {
  if (incoming.startsWith("C") || incoming.startsWith("E")) {
    const colonIdx = incoming.indexOf(":");
    if (colonIdx > 0) {
      const prefix = incoming.substring(0, colonIdx);
      const data = incoming.substring(colonIdx + 1);
      buffer.push(data);
      if (prefix.startsWith("E")) {
        const full = buffer.join("");
        buffer.length = 0;
        return { complete: true, json: full };
      }
      return { complete: false, json: "" };
    }
  }
  // Not chunked — single message
  buffer.length = 0;
  return { complete: true, json: incoming };
}

export function useBLEProvisioning() {
  const managerRef = useRef<BleManager | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const chunkBufferRef = useRef<string[]>([]);

  const [bleState, setBleState] = useState<BLEState>("idle");
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredDevice[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<DeviceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize BleManager once
  useEffect(() => {
    managerRef.current = new BleManager();
    return () => {
      managerRef.current?.destroy();
      managerRef.current = null;
    };
  }, []);

  // ── Request BLE permissions (Android 12+ needs BLUETOOTH_SCAN/CONNECT) ──
  const requestPermissions = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === "ios") return true;

    // Android 12+ (API 31+)
    const platformVersion =
      typeof Platform.Version === "string"
        ? parseInt(Platform.Version, 10)
        : Platform.Version;

    if (platformVersion >= 31) {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return Object.values(results).every(
        (r) => r === PermissionsAndroid.RESULTS.GRANTED
      );
    }
    // Android < 12
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }, []);

  // ── Scan for Mnazilona devices ──
  const startScan = useCallback(async (durationMs: number = 10000) => {
    const manager = managerRef.current;
    if (!manager) return;

    const allowed = await requestPermissions();
    if (!allowed) {
      setError("Bluetooth permissions are required.");
      return;
    }

    // Check BLE state
    const state = await manager.state();
    if (state !== "PoweredOn") {
      setError("Please enable Bluetooth on your device.");
      return;
    }

    setBleState("scanning");
    setDiscoveredDevices([]);
    setError(null);

    const seen = new Map<string, DiscoveredDevice>();

    const scanCallback = (err: BleError | null, device: Device | null) => {
      if (err) {
        if (__DEV__) console.log("[BLE] Scan error:", err.message);
        return;
      }
      if (!device) return;

      // Use localName (from advertising data) with fallback to name (cached/GAP)
      // On iOS especially, name can be null while localName has the correct value
      const deviceName = device.localName || device.name;
      if (!deviceName) return;
      if (!deviceName.startsWith(BLE_NAME_PREFIX)) return;

      const serialNumber = deviceName.substring(BLE_NAME_PREFIX.length);
      const entry: DiscoveredDevice = {
        id: device.id,
        name: deviceName,
        rssi: device.rssi ?? -100,
        serialNumber,
      };
      seen.set(device.id, entry);
      const sorted = Array.from(seen.values()).sort((a, b) => b.rssi - a.rssi);
      setDiscoveredDevices(sorted);
    };

    // First try scanning with service UUID filter for faster results.
    // If no devices found after 4s, restart scan without UUID filter
    // (128-bit custom UUIDs may not appear in iOS advertisement packets).
    manager.startDeviceScan(
      [SERVICE_UUID],
      { allowDuplicates: false },
      scanCallback
    );

    const fallbackTimer = setTimeout(() => {
      if (seen.size === 0) {
        if (__DEV__) console.log("[BLE] No devices via UUID filter — retrying without filter");
        manager.stopDeviceScan();
        manager.startDeviceScan(null, { allowDuplicates: false }, scanCallback);
      }
    }, 4000);

    // Auto-stop after duration
    setTimeout(() => {
      clearTimeout(fallbackTimer);
      manager.stopDeviceScan();
      setBleState((prev) => (prev === "scanning" ? "idle" : prev));
    }, durationMs);
  }, [requestPermissions]);

  const stopScan = useCallback(() => {
    managerRef.current?.stopDeviceScan();
    setBleState("idle");
  }, []);

  // ── Connect to a device ──
  const connectToDevice = useCallback(async (deviceId: string): Promise<DeviceInfo | null> => {
    const manager = managerRef.current;
    if (!manager) return null;

    manager.stopDeviceScan();
    setBleState("connecting");
    setError(null);

    try {
      // Connect with timeout
      const device = await manager.connectToDevice(deviceId, {
        timeout: 10000,
        requestMTU: 512,  // Request large MTU for JSON payloads
      });

      // Discover services and characteristics
      await device.discoverAllServicesAndCharacteristics();
      deviceRef.current = device;

      // Read device info characteristic
      const infoChar = await device.readCharacteristicForService(
        SERVICE_UUID,
        CHAR_DEVICE_INFO
      );

      if (!infoChar.value) {
        throw new Error("Empty device info");
      }

      const infoJson = atob(infoChar.value);  // BLE values are base64 encoded
      const info: DeviceInfo = JSON.parse(infoJson);

      if (__DEV__) console.log("[BLE] Connected to:", info.serial);

      setConnectedDevice(info);
      setBleState("connected");
      return info;
    } catch (e: any) {
      if (__DEV__) console.log("[BLE] Connect error:", e.message);
      setError("Failed to connect to device. Make sure it's nearby and the LED is blinking blue.");
      setBleState("error");
      deviceRef.current = null;
      return null;
    }
  }, []);

  // ── Helper: write to characteristic and wait for notify response ──
  const writeAndWaitForNotify = useCallback(
    (charUUID: string, data: string, timeoutMs: number = 15000): Promise<string> => {
      return new Promise(async (resolve, reject) => {
        const device = deviceRef.current;
        if (!device) {
          reject(new Error("Not connected"));
          return;
        }

        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            subscription?.remove();
            reject(new Error("Timeout waiting for device response"));
          }
        }, timeoutMs);

        chunkBufferRef.current = [];

        // Subscribe to notifications on this characteristic
        const subscription = device.monitorCharacteristicForService(
          SERVICE_UUID,
          charUUID,
          (err: BleError | null, char: Characteristic | null) => {
            if (settled) return;
            if (err) {
              settled = true;
              clearTimeout(timer);
              subscription?.remove();
              reject(new Error(err.message));
              return;
            }
            if (!char?.value) return;

            const decoded = atob(char.value);
            const { complete, json } = reassembleChunks(chunkBufferRef.current, decoded);

            if (complete && json) {
              settled = true;
              clearTimeout(timer);
              subscription?.remove();
              resolve(json);
            }
          }
        );

        // Write the data
        try {
          const encoded = btoa(data);
          await device.writeCharacteristicWithResponseForService(
            SERVICE_UUID,
            charUUID,
            encoded
          );
        } catch (e: any) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            subscription?.remove();
            reject(e);
          }
        }
      });
    },
    []
  );

  // ── Helper: write and collect multiple notify responses until a final one ──
  // Used for WiFi scan where device sends "scanning" then the actual results
  const writeAndCollectNotifies = useCallback(
    (charUUID: string, data: string, isFinal: (parsed: any) => boolean, timeoutMs: number = 20000): Promise<string> => {
      return new Promise(async (resolve, reject) => {
        const device = deviceRef.current;
        if (!device) {
          reject(new Error("Not connected"));
          return;
        }

        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            subscription?.remove();
            reject(new Error("Timeout waiting for device response"));
          }
        }, timeoutMs);

        chunkBufferRef.current = [];

        const subscription = device.monitorCharacteristicForService(
          SERVICE_UUID,
          charUUID,
          (err: BleError | null, char: Characteristic | null) => {
            if (settled) return;
            if (err) {
              settled = true;
              clearTimeout(timer);
              subscription?.remove();
              reject(new Error(err.message));
              return;
            }
            if (!char?.value) return;

            const decoded = atob(char.value);
            const { complete, json } = reassembleChunks(chunkBufferRef.current, decoded);

            if (complete && json) {
              try {
                const parsed = JSON.parse(json);
                if (isFinal(parsed)) {
                  settled = true;
                  clearTimeout(timer);
                  subscription?.remove();
                  resolve(json);
                }
                // else: intermediate notification (e.g. "scanning"), keep listening
              } catch {
                // Not valid JSON yet, keep listening
              }
            }
          }
        );

        try {
          const encoded = btoa(data);
          await device.writeCharacteristicWithResponseForService(
            SERVICE_UUID,
            charUUID,
            encoded
          );
        } catch (e: any) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            subscription?.remove();
            reject(e);
          }
        }
      });
    },
    []
  );

  // ── Fetch deviceSecret over BLE ──
  // Triggers the legacy verify characteristic with an empty payload; the
  // firmware responds with {status:"ok", deviceSecret:"..."} which the app
  // forwards to the backend during pairing.
  const fetchDeviceSecret = useCallback(async (): Promise<{ success: boolean; data: any }> => {
    try {
      const response = await writeAndWaitForNotify(
        CHAR_VERIFY,
        JSON.stringify({})
      );
      const data = JSON.parse(response);
      return { success: data.status === "ok", data };
    } catch (e: any) {
      return { success: false, data: { status: "error", message: e.message } };
    }
  }, [writeAndWaitForNotify]);

  // ── Request WiFi Scan ──
  const requestWiFiScan = useCallback(async (): Promise<WiFiNetwork[]> => {
    // WiFi scan takes time — use longer timeout and wait for final result
    const response = await writeAndCollectNotifies(
      CHAR_WIFI_SCAN,
      JSON.stringify({ action: "scan" }),
      (parsed) => parsed.status !== "scanning",  // "scanning" is intermediate
      25000  // 25 second timeout (scan can take 10-15s)
    );
    const data = JSON.parse(response);
    if (data.status === "ok" && Array.isArray(data.networks)) {
      return data.networks as WiFiNetwork[];
    }
    throw new Error(data.message || "WiFi scan failed");
  }, [writeAndCollectNotifies]);

  // ── Send WiFi Config ──
  const sendWiFiConfig = useCallback(async (
    ssid: string,
    password: string,
    userId?: string
  ): Promise<{ success: boolean; data: any }> => {
    try {
      const payload: any = { ssid, password };
      if (userId) payload.userId = userId;

      // WiFi connection attempt takes time — use longer timeout
      // and collect notifies (device sends "connecting" then result)
      const response = await writeAndCollectNotifies(
        CHAR_WIFI_CONFIG,
        JSON.stringify(payload),
        (parsed) => parsed.status !== "connecting",  // "connecting" is intermediate
        20000
      );
      const data = JSON.parse(response);
      return { success: data.status === "ok", data };
    } catch (e: any) {
      return { success: false, data: { status: "error", message: e.message } };
    }
  }, [writeAndCollectNotifies]);

  // ── Disconnect ──
  const disconnect = useCallback(async () => {
    try {
      if (deviceRef.current) {
        await deviceRef.current.cancelConnection();
      }
    } catch {
      // Ignore disconnect errors
    }
    deviceRef.current = null;
    setConnectedDevice(null);
    setBleState("idle");
  }, []);

  return {
    // State
    bleState,
    discoveredDevices,
    connectedDevice,
    error,

    // Actions
    startScan,
    stopScan,
    connectToDevice,
    fetchDeviceSecret,
    requestWiFiScan,
    sendWiFiConfig,
    disconnect,
  };
}
