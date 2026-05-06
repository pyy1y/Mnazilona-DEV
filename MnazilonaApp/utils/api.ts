// utils/api.ts

import * as SecureStore from 'expo-secure-store';
import { API_URL, APP_CONFIG, ENDPOINTS } from '../constants/api';

// ======================================
// Types
// ======================================
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  status: number;
}

export interface ApiError {
  message: string;
  status: number;
  code?: string;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

interface RequestOptions {
  method?: HttpMethod;
  body?: Record<string, any>;
  headers?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
  requireAuth?: boolean;
  skipAuthExpiredHandler?: boolean;
}

// ======================================
// Token Management
// ======================================
export const TokenManager = {
  async get(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(APP_CONFIG.TOKEN_KEY);
    } catch {
      return null;
    }
  },

  async set(token: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(APP_CONFIG.TOKEN_KEY, token);
    } catch {
      // SecureStore write failed — non-fatal
    }
  },

  async remove(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(APP_CONFIG.TOKEN_KEY);
    } catch {
      // SecureStore delete failed — non-fatal
    }
  },

  async exists(): Promise<boolean> {
    const token = await this.get();
    return !!token;
  },
};

// ======================================
// Refresh Token Management
// ======================================
export const RefreshTokenManager = {
  async get(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(APP_CONFIG.REFRESH_TOKEN_KEY);
    } catch {
      return null;
    }
  },

  async set(token: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(APP_CONFIG.REFRESH_TOKEN_KEY, token);
    } catch {
      // Non-fatal
    }
  },

  async remove(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(APP_CONFIG.REFRESH_TOKEN_KEY);
    } catch {
      // Non-fatal
    }
  },
};

// ======================================
// User Data Management
// ======================================
export const UserDataManager = {
  async get<T = any>(): Promise<T | null> {
    try {
      const data = await SecureStore.getItemAsync(APP_CONFIG.USER_DATA_KEY);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },

  async set(data: Record<string, any>): Promise<void> {
    try {
      await SecureStore.setItemAsync(APP_CONFIG.USER_DATA_KEY, JSON.stringify(data));
    } catch {
      // Non-fatal
    }
  },

  async remove(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(APP_CONFIG.USER_DATA_KEY);
    } catch {
      // Non-fatal
    }
  },

  async clear(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(APP_CONFIG.USER_DATA_KEY);
      await SecureStore.deleteItemAsync(APP_CONFIG.TOKEN_KEY);
    } catch {
      // Non-fatal
    }
  },
};

// ======================================
// Auth Expiry Callback
// ======================================
// Set by auth module to handle 401 responses without circular imports
let onAuthExpired: (() => void) | null = null;

export function setAuthExpiredHandler(handler: () => void): void {
  onAuthExpired = handler;
}

// ======================================
// Token Refresh (coalesced — server rotates refresh tokens, so concurrent
// refreshes would invalidate each other).
// ======================================
let refreshInFlight: Promise<string | null> | null = null;

async function performTokenRefresh(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = await RefreshTokenManager.get();
    if (!refreshToken) return null;

    const res = await fetch(`${API_URL}${ENDPOINTS.AUTH.REFRESH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => null);

    if (!res || !res.ok) return null;

    const data = await res.json().catch(() => null);
    if (!data?.token || !data?.refreshToken) return null;

    await TokenManager.set(data.token);
    await RefreshTokenManager.set(data.refreshToken);
    return data.token as string;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

// ======================================
// API Client
// ======================================
export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const {
    method = 'GET',
    body,
    headers = {},
    timeout = APP_CONFIG.REQUEST_TIMEOUT,
    signal,
    requireAuth = false,
    skipAuthExpiredHandler = false,
  } = options;

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // Build headers
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    // Add auth token if required or available
    if (requireAuth) {
      const token = await TokenManager.get();
      if (token) {
        requestHeaders['Authorization'] = `Bearer ${token}`;
      }
    }

    // Make request
    const response = await fetch(`${API_URL}${endpoint}`, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
      signal: signal || controller.signal,
    });

    clearTimeout(timeoutId);

    // Parse response
    let data: any = null;
    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      data = await response.json().catch(() => null);
    } else {
      const text = await response.text().catch(() => '');
      data = text ? { message: text } : null;
    }

    if (!response.ok) {
      // On 401: try a one-shot refresh + retry before giving up.
      // skipAuthExpiredHandler short-circuits this for the logout call itself.
      if (response.status === 401 && requireAuth && !skipAuthExpiredHandler) {
        const newToken = await performTokenRefresh();
        if (newToken) {
          requestHeaders['Authorization'] = `Bearer ${newToken}`;
          const retryController = new AbortController();
          const retryTimeoutId = setTimeout(() => retryController.abort(), timeout);
          try {
            const retry = await fetch(`${API_URL}${endpoint}`, {
              method,
              headers: requestHeaders,
              body: body ? JSON.stringify(body) : undefined,
              signal: signal || retryController.signal,
            });
            clearTimeout(retryTimeoutId);

            const retryCT = retry.headers.get('content-type') || '';
            const retryData = retryCT.includes('application/json')
              ? await retry.json().catch(() => null)
              : null;

            if (retry.ok) {
              return { success: true, data: retryData, status: retry.status };
            }

            // Refresh succeeded but retry still 401 → token version revoked, etc.
            if (retry.status === 401 && onAuthExpired) onAuthExpired();
            return {
              success: false,
              message: retryData?.message || getDefaultErrorMessage(retry.status),
              status: retry.status,
              data: retryData,
            };
          } catch {
            clearTimeout(retryTimeoutId);
            // Fall through to original 401 response below.
          }
        }

        if (onAuthExpired) onAuthExpired();
      }

      return {
        success: false,
        message: data?.message || getDefaultErrorMessage(response.status),
        status: response.status,
        data,
      };
    }

    return {
      success: true,
      data,
      status: response.status,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      return {
        success: false,
        message: 'Request timed out. Please try again.',
        status: 0,
      };
    }

    return {
      success: false,
      message: 'Could not connect to server. Please check your internet connection.',
      status: 0,
    };
  }
}

// ======================================
// Convenience Methods
// ======================================
export const api = {
  get: <T = any>(endpoint: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(endpoint, { ...options, method: 'GET' }),

  post: <T = any>(endpoint: string, body?: Record<string, any>, options?: Omit<RequestOptions, 'method'>) =>
    apiRequest<T>(endpoint, { ...options, method: 'POST', body }),

  put: <T = any>(endpoint: string, body?: Record<string, any>, options?: Omit<RequestOptions, 'method'>) =>
    apiRequest<T>(endpoint, { ...options, method: 'PUT', body }),

  patch: <T = any>(endpoint: string, body?: Record<string, any>, options?: Omit<RequestOptions, 'method'>) =>
    apiRequest<T>(endpoint, { ...options, method: 'PATCH', body }),

  delete: <T = any>(endpoint: string, options?: Omit<RequestOptions, 'method'>) =>
    apiRequest<T>(endpoint, { ...options, method: 'DELETE' }),
};

// ======================================
// Helpers
// ======================================
function getDefaultErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Invalid request. Please check your input.';
    case 401:
      return 'Session expired. Please log in again.';
    case 403:
      return 'You do not have permission to perform this action.';
    case 404:
      return 'Resource not found.';
    case 409:
      return 'This resource already exists.';
    case 429:
      return 'Too many requests. Please wait and try again.';
    case 500:
      return 'Server error. Please try again later.';
    case 503:
      return 'Service unavailable. Please try again later.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

// ======================================
// Auth Check Helper
// ======================================
export function isAuthError(status: number): boolean {
  return status === 401;
}