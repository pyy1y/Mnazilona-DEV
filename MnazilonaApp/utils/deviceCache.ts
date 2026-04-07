// utils/deviceCache.ts
// Offline-first device caching using AsyncStorage

import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICES_CACHE_KEY = 'mnazilona_devices_cache';
const ROOMS_CACHE_KEY = 'mnazilona_rooms_cache';

export type CachedDevice = {
  _id?: string;
  id?: string;
  serialNumber: string;
  macAddress?: string;
  name?: string;
  isOnline: boolean;
  lastSeen?: string;
  pairedAt?: string;
  deviceType?: string;
  room?: string | null;
  state?: Record<string, any>;
};

export type CachedRoom = {
  _id: string;
  name: string;
  icon: string;
};

export const DeviceCache = {
  async saveDevices(devices: CachedDevice[]): Promise<void> {
    try {
      const payload = JSON.stringify({
        devices,
        cachedAt: Date.now(),
      });
      await AsyncStorage.setItem(DEVICES_CACHE_KEY, payload);
    } catch {
      // Non-fatal
    }
  },

  async getDevices(): Promise<{ devices: CachedDevice[]; cachedAt: number } | null> {
    try {
      const raw = await AsyncStorage.getItem(DEVICES_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return {
        devices: parsed.devices || [],
        cachedAt: parsed.cachedAt || 0,
      };
    } catch {
      return null;
    }
  },

  async saveRooms(rooms: CachedRoom[]): Promise<void> {
    try {
      await AsyncStorage.setItem(ROOMS_CACHE_KEY, JSON.stringify(rooms));
    } catch {
      // Non-fatal
    }
  },

  async getRooms(): Promise<CachedRoom[]> {
    try {
      const raw = await AsyncStorage.getItem(ROOMS_CACHE_KEY);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },

  async clear(): Promise<void> {
    try {
      await AsyncStorage.multiRemove([DEVICES_CACHE_KEY, ROOMS_CACHE_KEY]);
    } catch {
      // Non-fatal
    }
  },
};
