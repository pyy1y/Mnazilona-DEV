// utils/connectionManager.ts
// Smart routing: local-first, cloud fallback
// Handles: commands, status, logs — all with local priority

import { api } from './api';
import { ENDPOINTS } from '../constants/api';
import { createRequestId } from './requestId';
import {
  isDeviceLocal,
  sendLocalCommand,
  fetchLocalStatus,
  fetchLocalLogs,
} from './localDiscovery';

// ======================================
// Command Whitelist
// ======================================
const ALLOWED_COMMANDS = new Set([
  // Garage
  'open', 'close', 'stop',
  // Light
  'on', 'off',
  // Dimmer
  'brightness',
  // Lock
  'lock', 'add_passcode', 'add_fingerprint', 'add_card',
  'remove_passcode', 'remove_fingerprint', 'remove_card',
  // AC
  'set_temperature', 'set_mode', 'set_fan_mode', 'set_swing_mode', 'set_preset_mode',
  // Security
  'set_security_mode',
]);

// ======================================
// Types
// ======================================

export type CommandResult = {
  success: boolean;
  message?: string;
  status: number;
  local: boolean;
};

export type StatusResult = {
  success: boolean;
  local: boolean;
  data?: {
    relay?: string;
    doorState?: string;
    isOnline: boolean;
    rssi?: number;
    uptime?: number;
    fw?: string;
    mqttConnected?: boolean;
  };
};

export type LogEntry = {
  timestamp: string;
  message: string;
  type: 'info' | 'warning' | 'error';
};

export type LogsResult = {
  success: boolean;
  local: boolean;
  logs: LogEntry[];
};

// ======================================
// Smart Send Command
// local first → cloud fallback
// ======================================

export async function smartSendCommand(
  serialNumber: string,
  command: string,
  params?: Record<string, any>
): Promise<CommandResult> {
  const requestId = createRequestId('cmd');

  // Validate command against whitelist
  if (!ALLOWED_COMMANDS.has(command)) {
    return {
      success: false,
      message: `Unknown command: ${command}`,
      status: 400,
      local: false,
    };
  }

  // Validate serial number format (alphanumeric, max 32 chars)
  if (!serialNumber || serialNumber.length > 32 || !/^[A-Za-z0-9_-]+$/.test(serialNumber)) {
    return { success: false, message: 'Invalid serial number', status: 400, local: false };
  }

  // Validate params size to prevent oversized payloads
  if (params) {
    const paramsStr = JSON.stringify(params);
    if (paramsStr.length > 1024) {
      return { success: false, message: 'Command params too large', status: 400, local: false };
    }
  }

  // Try local first
  if (isDeviceLocal(serialNumber)) {
    const localResult = await sendLocalCommand(
      serialNumber,
      command,
      params,
      requestId
    );

    if (localResult.success) {
      return {
        success: true,
        message: 'Command sent locally',
        status: 200,
        local: true,
      };
    }
  }

  // Cloud fallback
  try {
    const response = await api.post<any>(
      ENDPOINTS.DEVICES.COMMAND(serialNumber),
      { command, params, requestId },
      { requireAuth: true }
    );

    return {
      success: response.success,
      message: response.message || (response.success ? 'Command sent via cloud' : 'Failed'),
      status: response.status,
      local: false,
    };
  } catch {
    return {
      success: false,
      message: 'Could not reach device (no local or cloud connection)',
      status: 0,
      local: false,
    };
  }
}

// ======================================
// Smart Fetch Status
// local first → cloud fallback
// ======================================

export async function smartFetchStatus(
  serialNumber: string
): Promise<StatusResult> {
  // Try local first
  if (isDeviceLocal(serialNumber)) {
    const localResult = await fetchLocalStatus(serialNumber);

    if (localResult.success && localResult.data) {
      return {
        success: true,
        local: true,
        data: {
          relay: localResult.data.relay,
          doorState: localResult.data.doorState,
          isOnline: true, // If we can reach it locally, it's online
          rssi: localResult.data.rssi,
          uptime: localResult.data.uptime,
          fw: localResult.data.fw,
          mqttConnected: localResult.data.mqttConnected,
        },
      };
    }
  }

  // Cloud fallback
  try {
    const response = await api.get<any>(
      ENDPOINTS.DEVICES.GET_ONE(serialNumber),
      { requireAuth: true }
    );

    if (response.success && response.data) {
      return {
        success: true,
        local: false,
        data: {
          relay: response.data.state?.relay,
          doorState: response.data.state?.doorState,
          isOnline: response.data.isOnline ?? false,
        },
      };
    }

    return { success: false, local: false };
  } catch {
    return { success: false, local: false };
  }
}

// ======================================
// Smart Fetch Logs
// local first → cloud fallback
// ======================================

function formatTimestamp(date: Date): string {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Convert ESP32 millis() timestamp to real date/time.
 * Formula: realTime = now - (deviceUptime - logTimestamp)
 * deviceUptime and logTimestamp are both in millis() from boot.
 */
function millisToRealTime(logMillis: number, deviceUptimeMs: number): Date {
  const age = deviceUptimeMs - logMillis; // how long ago this event happened
  return new Date(Date.now() - age);
}

export async function smartFetchLogs(
  serialNumber: string
): Promise<LogsResult> {
  // Try local first
  if (isDeviceLocal(serialNumber)) {
    // First get device uptime so we can convert millis to real time
    const statusResult = await fetchLocalStatus(serialNumber);
    const deviceUptimeMs = statusResult.success && statusResult.data?.uptime
      ? statusResult.data.uptime * 1000  // uptime is in seconds from ESP32
      : 0;

    const localResult = await fetchLocalLogs(serialNumber);

    if (localResult.success && localResult.logs.length > 0) {
      const logs: LogEntry[] = localResult.logs.map((log) => {
        const realDate = deviceUptimeMs > 0
          ? millisToRealTime(log.timestamp, deviceUptimeMs)
          : new Date(); // fallback if no uptime

        return {
          timestamp: formatTimestamp(realDate),
          message: log.message,
          type: log.type,
        };
      });

      return { success: true, local: true, logs };
    }
  }

  // Cloud fallback
  try {
    const response = await api.get<any>(
      ENDPOINTS.DEVICES.LOGS(serialNumber),
      { requireAuth: true }
    );

    if (response.success && response.data?.logs) {
      const logs: LogEntry[] = response.data.logs.map((log: any) => ({
        timestamp: formatTimestamp(new Date(log.timestamp)),
        message: log.message,
        type: log.type || 'info',
      }));

      return { success: true, local: false, logs };
    }

    return { success: false, local: false, logs: [] };
  } catch {
    return { success: false, local: false, logs: [] };
  }
}
