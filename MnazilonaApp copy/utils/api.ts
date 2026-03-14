// utils/api.ts

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { API_URL, APP_CONFIG } from '../constants/api';

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
// User Data Management
// ======================================
export const UserDataManager = {
  async get<T = any>(): Promise<T | null> {
    try {
      const data = await AsyncStorage.getItem(APP_CONFIG.USER_DATA_KEY);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },

  async set(data: Record<string, any>): Promise<void> {
    try {
      await AsyncStorage.setItem(APP_CONFIG.USER_DATA_KEY, JSON.stringify(data));
    } catch {
      // Non-fatal
    }
  },

  async remove(): Promise<void> {
    try {
      await AsyncStorage.removeItem(APP_CONFIG.USER_DATA_KEY);
    } catch {
      // Non-fatal
    }
  },

  async clear(): Promise<void> {
    try {
      await AsyncStorage.removeItem(APP_CONFIG.USER_DATA_KEY);
      await SecureStore.deleteItemAsync(APP_CONFIG.TOKEN_KEY);
    } catch {
      // Non-fatal
    }
  },
};

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