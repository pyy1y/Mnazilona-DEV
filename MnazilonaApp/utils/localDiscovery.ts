// utils/localDiscovery.ts
// mDNS discovery for local ESP32 devices + local HTTP communication
// Handles: commands, status polling, logs — all without internet

import Zeroconf from 'react-native-zeroconf';
import { TokenManager } from './api';

const LOCAL_TIMEOUT = 5000;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await TokenManager.get();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export type LocalDevice = {
  serialNumber: string;
  ip: string;
  port: number;
  name: string;
  deviceType: string;
};

export type LocalDeviceStatus = {
  serial: string;
  name: string;
  type: string;
  fw: string;
  relay: 'opened' | 'closed';
  doorState: 'open' | 'closed';
  isOnline: boolean;
  rssi: number;
  heap: number;
  uptime: number;
  ip: string;
  local: boolean;
  mqttConnected: boolean;
};

export type LocalLogEntry = {
  timestamp: number;   // millis from ESP32
  message: string;
  type: 'info' | 'warning' | 'error';
};

// ======================================
// Internal State
// ======================================
const discoveredDevices = new Map<string, LocalDevice>();
let zeroconf: Zeroconf | null = null;
let isScanning = false;

// Listeners for device state changes
type StatusListener = (serialNumber: string, status: LocalDeviceStatus) => void;
const statusListeners: StatusListener[] = [];
let statusPollInterval: ReturnType<typeof setInterval> | null = null;

type DevicesListener = (serialNumbers: string[]) => void;
const deviceListeners: DevicesListener[] = [];

function getLocalSerialNumbers(): string[] {
  return Array.from(discoveredDevices.keys()).sort();
}

function notifyDeviceListeners(): void {
  const serialNumbers = getLocalSerialNumbers();
  deviceListeners.forEach((listener) => listener(serialNumbers));
}

// ======================================
// mDNS Discovery
// ======================================

export function startLocalDiscovery(): void {
  if (isScanning) return;

  try {
    zeroconf = new Zeroconf();

    zeroconf.on('resolved', (service: any) => {
      const serial = service.txt?.serial || service.txt?.sn || '';
      if (!serial) return;

      const device: LocalDevice = {
        serialNumber: serial.toUpperCase(),
        ip: service.host || service.addresses?.[0] || '',
        port: service.port || 8080,
        name: service.name || '',
        deviceType: service.txt?.type || 'unknown',
      };

      if (device.ip) {
        discoveredDevices.set(device.serialNumber, device);
        notifyDeviceListeners();
        if (__DEV__) console.log(`[LocalDiscovery] Found: ${device.serialNumber} at ${device.ip}:${device.port}`);
      }
    });

    zeroconf.on('removed', (service: any) => {
      const serial = service.txt?.serial || service.txt?.sn || '';
      if (serial) {
        discoveredDevices.delete(serial.toUpperCase());
        notifyDeviceListeners();
        if (__DEV__) console.log(`[LocalDiscovery] Removed: ${serial}`);
      }
    });

    zeroconf.on('error', (err: any) => {
      if (__DEV__) console.warn('[LocalDiscovery] Error:', err);
    });

    zeroconf.scan('mnazilona', 'tcp');
    isScanning = true;
    if (__DEV__) console.log('[LocalDiscovery] Scanning started');

    // Start polling local devices for status
    startStatusPolling();
  } catch (err) {
    if (__DEV__) console.warn('[LocalDiscovery] Failed to start:', err);
  }
}

export function stopLocalDiscovery(): void {
  stopStatusPolling();

  if (!isScanning || !zeroconf) return;

  try {
    zeroconf.stop();
    zeroconf.removeAllListeners();
    zeroconf = null;
    isScanning = false;
    if (discoveredDevices.size > 0) {
      discoveredDevices.clear();
      notifyDeviceListeners();
    }
    if (__DEV__) console.log('[LocalDiscovery] Scanning stopped');
  } catch {
    // Non-fatal
  }
}

// ======================================
// Device Lookup
// ======================================

export function isDeviceLocal(serialNumber: string): boolean {
  return discoveredDevices.has(serialNumber.toUpperCase());
}

export function getLocalDevice(serialNumber: string): LocalDevice | null {
  return discoveredDevices.get(serialNumber.toUpperCase()) || null;
}

export function getLocalDevices(): LocalDevice[] {
  return Array.from(discoveredDevices.values());
}

// ======================================
// Local HTTP: Send Command
// ======================================

export async function sendLocalCommand(
  serialNumber: string,
  command: string,
  params?: Record<string, any>,
  requestId?: string
): Promise<{ success: boolean; data?: any }> {
  const device = getLocalDevice(serialNumber);
  if (!device) return { success: false };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOCAL_TIMEOUT);

  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`http://${device.ip}:${device.port}/command`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ command, params: params || {}, requestId }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    if (!response.ok) return { success: false };

    const data = await response.json().catch(() => null);
    if (__DEV__) console.log(`[Local] Command "${command}" → ${serialNumber} OK`);
    return { success: true, data };
  } catch {
    clearTimeout(timeoutId);
    discoveredDevices.delete(serialNumber.toUpperCase());
    notifyDeviceListeners();
    return { success: false };
  }
}

// ======================================
// Local HTTP: Fetch Status
// ======================================

export async function fetchLocalStatus(
  serialNumber: string
): Promise<{ success: boolean; data?: LocalDeviceStatus }> {
  const device = getLocalDevice(serialNumber);
  if (!device) return { success: false };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOCAL_TIMEOUT);

  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`http://${device.ip}:${device.port}/status`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    if (!response.ok) return { success: false };

    const data = await response.json().catch(() => null);
    return { success: true, data };
  } catch {
    clearTimeout(timeoutId);
    // Device unreachable — remove from local cache
    discoveredDevices.delete(serialNumber.toUpperCase());
    notifyDeviceListeners();
    return { success: false };
  }
}

// ======================================
// Local HTTP: Fetch Logs
// ======================================

export async function fetchLocalLogs(
  serialNumber: string
): Promise<{ success: boolean; logs: LocalLogEntry[] }> {
  const device = getLocalDevice(serialNumber);
  if (!device) return { success: false, logs: [] };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOCAL_TIMEOUT);

  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`http://${device.ip}:${device.port}/logs`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    if (!response.ok) return { success: false, logs: [] };

    const data = await response.json().catch(() => null);
    const logs: LocalLogEntry[] = (data?.logs || []).map((log: any) => ({
      timestamp: log.timestamp || 0,
      message: log.message || '',
      type: log.type || 'info',
    }));

    return { success: true, logs };
  } catch {
    clearTimeout(timeoutId);
    return { success: false, logs: [] };
  }
}

// ======================================
// Status Polling (Local devices)
// ======================================

export function onLocalStatusUpdate(listener: StatusListener): () => void {
  statusListeners.push(listener);
  return () => {
    const idx = statusListeners.indexOf(listener);
    if (idx >= 0) statusListeners.splice(idx, 1);
  };
}

export function onLocalDevicesChanged(listener: DevicesListener): () => void {
  deviceListeners.push(listener);
  listener(getLocalSerialNumbers());
  return () => {
    const idx = deviceListeners.indexOf(listener);
    if (idx >= 0) deviceListeners.splice(idx, 1);
  };
}

function startStatusPolling(): void {
  if (statusPollInterval) return;

  statusPollInterval = setInterval(async () => {
    const devices = getLocalDevices();
    for (const device of devices) {
      const result = await fetchLocalStatus(device.serialNumber);
      if (result.success && result.data) {
        statusListeners.forEach((fn) => fn(device.serialNumber, result.data!));
      }
    }
  }, 5000); // Poll every 5 seconds
}

function stopStatusPolling(): void {
  if (statusPollInterval) {
    clearInterval(statusPollInterval);
    statusPollInterval = null;
  }
}
