// constants/api.ts
// ======================================
// API Configuration
// ======================================
const DEFAULT_DEV_API_URL = 'https://mnazilona.xyz/api';
const DEFAULT_PROD_API_URL = 'https://mnazilona.xyz/api';
const isDev = __DEV__;

function normalizeApiUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

const DEV_API_URL = normalizeApiUrl(
  process.env.EXPO_PUBLIC_API_URL_DEV ||
    process.env.EXPO_PUBLIC_API_URL ||
    DEFAULT_DEV_API_URL
);

const PROD_API_URL = normalizeApiUrl(
  process.env.EXPO_PUBLIC_API_URL_PROD ||
    process.env.EXPO_PUBLIC_API_URL ||
    DEFAULT_PROD_API_URL
);

export const API_URL = isDev ? DEV_API_URL : PROD_API_URL;

// ======================================
// API Endpoints
// ======================================
export const ENDPOINTS = {
  // Auth
  AUTH: {
    REGISTER_SEND_CODE: '/auth/register/send-code',
    REGISTER_VERIFY: '/auth/register/verify-code',
    LOGIN_SEND_CODE: '/auth/login/send-code',
    LOGIN_VERIFY: '/auth/login/verify-code',
    FORGOT_PASSWORD: '/auth/password/forgot',
    RESET_PASSWORD: '/auth/password/reset',
    CHANGE_PASSWORD: '/auth/password/change',
    LOGOUT: '/auth/logout',
    REFRESH: '/auth/refresh-token',
  },

  // User / Profile
  USER: {
    PROFILE: '/api/me',
    UPDATE_PROFILE: '/api/me',
    CHANGE_EMAIL_SEND_CODE: '/api/account/change-email/send-code',
    CHANGE_EMAIL_VERIFY_OLD: '/api/account/change-email/verify-old',
    CHANGE_EMAIL_CONFIRM: '/api/account/change-email/confirm',
    DELETE_SEND_CODE: '/api/account/delete/send-code',
    DELETE_CONFIRM: '/api/account/delete/confirm',
  },

  // Devices
  DEVICES: {
    LIST: '/devices',
    GET_ONE: (serial: string) => `/devices/${serial}`,
    PAIR: '/devices/pair',
    UNPAIR: '/devices/unpair',
    VALIDATE: '/devices/validate',
    COMMAND: (serial: string) => `/devices/${serial}/command`,
    RENAME: (serial: string) => `/devices/${serial}/rename`,
    LOGS: (serial: string) => `/devices/${serial}/logs`,
    ALL_LOGS: '/devices/all-logs',
    INQUIRY: '/devices/inquiry',
  },

  // Rooms
  ROOMS: {
    LIST: '/rooms',
    CREATE: '/rooms',
    UPDATE: (id: string) => `/rooms/${id}`,
    DELETE: (id: string) => `/rooms/${id}`,
    DEVICES: (id: string) => `/rooms/${id}/devices`,
    ASSIGN_DEVICE: (id: string) => `/rooms/${id}/devices`,
    REMOVE_DEVICE: (id: string, serial: string) => `/rooms/${id}/devices/${serial}`,
  },

  // Notifications
  NOTIFICATIONS: {
    LIST: '/notifications',
    UNREAD_COUNT: '/notifications/unread-count',
    READ_ALL: '/notifications',
    MARK_READ: (id: string) => `/notifications/${id}`,
    RESPOND: (id: string) => `/notifications/${id}/respond`,
  },
} as const;

// ======================================
// App Constants
// ======================================
export const APP_CONFIG = {
  TOKEN_KEY: 'auth_token',
  REFRESH_TOKEN_KEY: 'auth_refresh_token',
  USER_DATA_KEY: 'user_data',
  OTP_LENGTH: 6,
  OTP_RESEND_SECONDS: 60,
  REQUEST_TIMEOUT: 30000,
  // Local network communication
  LOCAL_DEVICE_PORT: 8080,
  LOCAL_COMMAND_TIMEOUT: 5000,
  // Realtime
  SOCKET_NAMESPACE: '/app',
} as const;

// ======================================
// Validation
// ======================================
export const VALIDATION = {
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_REGEX: /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{}|;:'",.<>?/\\`~]).{8,}$/,
  EMAIL_REGEX: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  NAME_MIN_LENGTH: 2,
  NAME_MAX_LENGTH: 100,
} as const;
