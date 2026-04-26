// app/(tabs)/index.tsx
import { getUser } from "../../utils/userStorage";

import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";

import { fetchWeatherByCity, type WeatherResult, type WeatherState } from '../../utils/weather';
import {
  convertTemperature,
  getTemperatureUnitSymbol,
  loadPreferences,
  type TemperatureUnit,
} from '../../utils/preferences';

import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Alert,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { api, isAuthError } from '../../utils/api';
import { useAuth } from '../../hooks/useAuth';
import { ENDPOINTS, APP_CONFIG } from '../../constants/api';
import DeviceListItem from '../../components/DeviceListItem';
import { DeviceCache } from '../../utils/deviceCache';
import {
  startLocalDiscovery,
  stopLocalDiscovery,
  onLocalDevicesChanged,
  onLocalStatusUpdate,
} from '../../utils/localDiscovery';
import { smartSendCommand, smartFetchLogs } from '../../utils/connectionManager';

const BRAND_COLOR = '#2E5B8E';

// ======================================
// Types
// ======================================
type Device = {
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
  state?: {
    doorState?: 'open' | 'closed';
    relay?: string;
    [key: string]: unknown;
  };
};

type Room = {
  _id: string;
  name: string;
  icon: string;
};
// ======================================
// Component
// ======================================
export default function DashboardScreen() {
  const router = useRouter();
  const { handleAuthError } = useAuth();

  // =========================
  // USER DISPLAY NAME (Dynamic)
  // =========================
  // Default value: "Guest" until we load the real user info from SecureStore.
  const [userName, setUserName] = useState("Guest");
  const [userCity, setUserCity] = useState("Dammam"); // fallback

  // =========================
// WEATHER (Dynamic)
// =========================
const [weather, setWeather] = useState<WeatherResult | null>(null);
const [weatherLoading, setWeatherLoading] = useState(true);
const [weatherError, setWeatherError] = useState<string | null>(null);
  const [temperatureUnit, setTemperatureUnit] =
    useState<TemperatureUnit>('Celsius');

  // =========================
  // YOUR EXISTING STATES (Devices, Loading, etc.)
  // =========================
  const [devices, setDevices] = useState<Device[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null); // null = All
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [localSerials, setLocalSerials] = useState<Set<string>>(new Set());

  const abortControllerRef = useRef<AbortController | null>(null);
  const isLoadingRef = useRef(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ==========================================
  // (ADDED) Load user info from SecureStore
  // ==========================================
  const loadUserName = useCallback(async () => {
  try {
    const user = await getUser();

    const fullName = user?.name?.trim();
    const firstName = fullName?.split(" ")[0] || "Guest";
    setUserName(firstName);
    // ✅ هنا نقرأ المدينة
    const city = user?.city?.trim();
    setUserCity(city || "Dammam");

  } catch {
    setUserName("Guest");
    setUserCity("Dammam");
  }
}, []);

  const loadAppPreferences = useCallback(async () => {
    const prefs = await loadPreferences();
    setTemperatureUnit(prefs.temperatureUnit);
  }, []);

  // ==========================================
  // (ADDED) Run once on mount
  // ==========================================
  useEffect(() => {
    loadUserName();
    loadAppPreferences();
  }, [loadUserName, loadAppPreferences]);

  // ==========================================
// Load Weather (Dammam) on screen mount
// ==========================================
useEffect(() => {
  let mounted = true;

  

  const loadWeather = async () => {
    try {
      setWeatherLoading(true);
      setWeatherError(null);


      const w = await fetchWeatherByCity((userCity || "Dammam").trim());

      if (mounted) setWeather(w);
    } catch {
      if (mounted) setWeatherError("Weather unavailable");
    } finally {
      if (mounted) setWeatherLoading(false);
    }
  };

  // أول تحميل
  loadWeather();

  // تحديث كل 15 دقيقة
  const interval = setInterval(loadWeather, 15 * 60 * 1000);

  return () => {
    mounted = false;
    clearInterval(interval);
  };
}, [userCity]); // ✅ مهم جداً

  // ==========================================
  // (ADDED) Run every time you focus/return to Dashboard
  // ==========================================
  useFocusEffect(
    useCallback(() => {
      loadUserName();
      loadAppPreferences();
      return () => {};
    }, [loadUserName, loadAppPreferences])
  );

  // ==========================================
  // Dynamic greeting based on time
  // ==========================================
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 18) return "Good Afternoon";
    return "Good Evening";
  };

  // =========================
// Weather Icon Mapper
// =========================
const getWeatherIcon = (state?: WeatherState) => {
  switch (state) {
    case "clear":
      return "weather-sunny";
    case "clouds":
      return "weather-cloudy";
    case "rain":
      return "weather-rainy";
    case "thunder":
      return "weather-lightning";
    case "snow":
      return "weather-snowy";
    case "fog":
      return "weather-fog";
    default:
      return "weather-partly-cloudy";
  }
};

  // =========================
  // ✅ IMPORTANT:
  // Keep your existing code below (normalizeDevices, loadDevices, render, return, etc.)
  // =========================

  // ... عندك هنا normalizeDevices / loadDevices / renderEmpty / deviceCountText ... إلخ
  // ===== ADDED CODE END =====

  const normalizeDevices = useCallback((response: any): Device[] => {
    if (!response) return [];
    const list = Array.isArray(response)
      ? response
      : response?.devices || response?.data || [];
    return Array.isArray(list) ? list : [];
  }, []);

  // Load cached devices on first mount (offline-first)
  const loadCachedDevices = useCallback(async () => {
    const cached = await DeviceCache.getDevices();
    if (cached && cached.devices.length > 0) {
      // Show cached devices immediately (mark all as potentially offline)
      setDevices(cached.devices);
      setLoading(false);
    }
    const cachedRooms = await DeviceCache.getRooms();
    if (cachedRooms.length > 0) {
      setRooms(cachedRooms);
    }
  }, []);

  const loadDevices = useCallback(
    async (options: { isRefresh?: boolean; silent?: boolean } = {}) => {
      const { isRefresh = false, silent = false } = options;

      if (isLoadingRef.current && !silent) return;

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      isLoadingRef.current = true;

      if (!silent && !isRefresh) setLoading(true);

      try {
        const response = await api.get<any>(ENDPOINTS.DEVICES.LIST, {
          requireAuth: true,
          signal: controller.signal,
        });

        if (!response.success) {
          if (isAuthError(response.status)) {
            await handleAuthError(response.status);
            return;
          }
          // Cloud failed — don't show error, cached devices are already showing
          return;
        }

        const freshDevices = normalizeDevices(response.data);
        setDevices(freshDevices);

        // Save to cache for offline use
        DeviceCache.saveDevices(freshDevices);

        // Load rooms (silent, non-blocking)
        try {
          const roomsRes = await api.get<any>(ENDPOINTS.ROOMS.LIST, { requireAuth: true });
          if (roomsRes.success && roomsRes.data?.rooms) {
            setRooms(roomsRes.data.rooms);
            DeviceCache.saveRooms(roomsRes.data.rooms);
          }
        } catch {
          // silent
        }
      } catch (error: any) {
        if (error?.name === 'AbortError') return;
        // Cloud unreachable — cached devices already showing, fail silently
      } finally {
        isLoadingRef.current = false;
        if (!silent && !isRefresh) setLoading(false);
        if (isRefresh) setRefreshing(false);
      }
    },
    [handleAuthError, normalizeDevices]
  );

  const sendCommand = useCallback(
    async (serialNumber: string, command: string, params?: Record<string, any>) => {
      const actionKey = `${serialNumber}:${command}`;
      setActionLoading(actionKey);

      try {
        // Local-first: tries local network, falls back to cloud
        const result = await smartSendCommand(serialNumber, command, params);

        if (!result.success) {
          if (isAuthError(result.status)) {
            await handleAuthError(result.status);
            return;
          }

          Alert.alert('Error', result.message || 'Failed to send command.');
          return;
        }

        loadDevices({ silent: true });
      } catch {
        Alert.alert('Error', 'Failed to send command.');
      } finally {
        setActionLoading(null);
      }
    },
    [handleAuthError, loadDevices]
  );

  const handleSendCommand = useCallback(
    (serialNumber: string, commandPayload: { action: string }) => {
      sendCommand(serialNumber, commandPayload.action);
    },
    [sendCommand]
  );

  const handleRenameDevice = useCallback(
    async (serialNumber: string, newName: string) => {
      try {
        const response = await api.patch<any>(
          ENDPOINTS.DEVICES.RENAME(serialNumber),
          { name: newName },
          { requireAuth: true }
        );

        if (!response.success) {
          if (isAuthError(response.status)) {
            await handleAuthError(response.status);
            return;
          }
          Alert.alert('Error', response.message || 'Failed to rename device.');
          return;
        }

        setDevices((prev) =>
          prev.map((d) =>
            d.serialNumber === serialNumber ? { ...d, name: newName } : d
          )
        );
      } catch {
        Alert.alert('Error', 'Failed to rename device.');
      }
    },
    [handleAuthError]
  );

  const fetchDeviceLogs = useCallback(
    async (serialNumber: string) => {
      // Local-first: tries local logs from ESP32, falls back to cloud
      const result = await smartFetchLogs(serialNumber);
      return result.logs;
    },
    []
  );

  useFocusEffect(
    useCallback(() => {
      // 1. Show cached devices immediately, then fetch from cloud
      loadCachedDevices().then(() => {
        // 4. Fetch fresh data from cloud (after cache is loaded)
        loadDevices();
      });

      // 2. Start local network discovery (mDNS)
      startLocalDiscovery();

      const unsubscribeLocalDevices = onLocalDevicesChanged((serialNumbers) => {
        setLocalSerials(new Set(serialNumbers));
      });

      // 3. Listen for local status updates and merge into device state
      const unsubscribeStatus = onLocalStatusUpdate((serialNumber, status) => {
        setDevices((prev) =>
          prev.map((d) => {
            if (d.serialNumber !== serialNumber) return d;
            return {
              ...d,
              isOnline: true, // reachable locally = online
              state: {
                ...d.state,
                doorState: status.doorState as 'open' | 'closed',
                relay: status.relay,
              },
            };
          })
        );
      });

      // 4. Poll for updates (cloud)
      pollIntervalRef.current = setInterval(() => {
        loadDevices({ silent: true });
      }, APP_CONFIG.DEVICE_POLL_INTERVAL);

      return () => {
        unsubscribeLocalDevices();
        unsubscribeStatus();
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        abortControllerRef.current?.abort();
        stopLocalDiscovery();
      };
    }, [loadDevices, loadCachedDevices])
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadDevices({ isRefresh: true });
  }, [loadDevices]);

  // ==========================================
  // Notification badge count
  // ==========================================
  const loadUnreadCount = useCallback(async () => {
    try {
      const response = await api.get<any>(ENDPOINTS.NOTIFICATIONS.UNREAD_COUNT, {
        requireAuth: true,
      });
      if (!response.success) {
        if (isAuthError(response.status)) {
          await handleAuthError(response.status);
        }
        return;
      }
      if (response.success && response.data?.count !== undefined) {
        setUnreadNotifCount(response.data.count);
      }
    } catch {
      // silent
    }
  }, [handleAuthError]);

  useEffect(() => {
    loadUnreadCount();
    const interval = setInterval(loadUnreadCount, 60000);
    return () => clearInterval(interval);
  }, [loadUnreadCount]);

  useFocusEffect(
    useCallback(() => {
      loadUnreadCount();
      return () => {};
    }, [loadUnreadCount])
  );

  const handleNotifications = useCallback(() => {
    router.push('/notifications' as any);
  }, [router]);

  const handleAddDevice = useCallback(() => {
    router.push('/pairing');
  }, [router]);

  // Room name lookup map
  const roomMap = useMemo(() => {
    const map: Record<string, string> = {};
    rooms.forEach((r) => { map[r._id] = r.name; });
    return map;
  }, [rooms]);

  // Filtered devices based on selected room
  const filteredDevices = useMemo(() => {
    if (!selectedRoomId) return devices; // All
    return devices.filter((d) => d.room === selectedRoomId);
  }, [devices, selectedRoomId]);

  // Rooms that have at least one device
  const roomsWithDevices = useMemo(() => {
    const roomIds = new Set(devices.filter((d) => d.room).map((d) => d.room!));
    return rooms.filter((r) => roomIds.has(r._id));
  }, [rooms, devices]);

  const keyExtractor = useCallback((item: Device) => {
    return item.serialNumber || item._id || item.id || 'unknown';
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Device }) => (
      <DeviceListItem
        device={item}
        actionLoading={actionLoading}
        onSendCommand={handleSendCommand}
        onRenameDevice={handleRenameDevice}
        onFetchLogs={fetchDeviceLogs}
        brandColor={BRAND_COLOR}
        roomName={item.room ? roomMap[item.room] : undefined}
        isLocal={localSerials.has(item.serialNumber)}
      />
    ),
    [actionLoading, handleSendCommand, handleRenameDevice, fetchDeviceLogs, roomMap, localSerials]
  );

  const renderEmpty = useCallback(
    () => (
      <View style={styles.emptyContainer}>
        <MaterialCommunityIcons name="devices" size={64} color="#E0E0E0" />
        <Text style={styles.emptyTitle}>No Devices Found</Text>
        <Text style={styles.emptySubtitle}>
          Tap the + button to pair your first device
        </Text>
      </View>
    ),
    []
  );

  const deviceCountText = useMemo(() => {
    const count = devices.length;
    if (count === 0) return 'No devices';
    if (count === 1) return '1 device';
    return `${count} devices`;
  }, [devices.length]);

  const onlineCount = useMemo(() => {
    return devices.filter(d => d.isOnline).length;
  }, [devices]);

  const localCount = useMemo(() => {
    return devices.filter(d => localSerials.has(d.serialNumber)).length;
  }, [devices, localSerials]);

  const weatherTemp = useMemo(() => {
    if (!weather) return null;
    return Math.round(convertTemperature(weather.tempC, temperatureUnit));
  }, [weather, temperatureUnit]);

  const feelsLikeTemp = useMemo(() => {
    if (!weather || weather.feelsLikeC === undefined) return null;
    return Math.round(convertTemperature(weather.feelsLikeC, temperatureUnit));
  }, [weather, temperatureUnit]);

  const temperatureUnitSymbol = useMemo(
    () => getTemperatureUnitSymbol(temperatureUnit),
    [temperatureUnit]
  );


  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>

        {/* ===== ENHANCED HEADER (ADDED) ===== */}
        <View style={styles.headerRow}>
          <View style={styles.headerTextContainer}>
            <Text style={styles.greetingText}>
              {getGreeting()}, {userName}
            </Text>

            <Text style={styles.headerSub}>
              {deviceCountText}
              {devices.length > 0 && ` • ${onlineCount} online`}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <TouchableOpacity
              style={styles.addButton}
              onPress={handleNotifications}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="bell-outline" size={22} color={BRAND_COLOR} />
              {unreadNotifCount > 0 && (
                <View style={styles.notifBadge}>
                  <Text style={styles.notifBadgeText}>
                    {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.addButton}
              onPress={handleAddDevice}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="plus" size={24} color={BRAND_COLOR} />
            </TouchableOpacity>
          </View>
        </View>
        {/* ===== END HEADER ===== */}

        {/* ===== ADDED: Quick Cards ===== */}
<View style={styles.cardsRow}>
  {/* Weather Card (Placeholder) */}
  <View style={styles.card}>
    <View style={styles.cardTopRow}>
      <Text style={styles.cardTitle}>Weather</Text>
      <Text style={styles.cardMeta}>{userCity}</Text>
    </View>

    {weatherLoading ? (
      <View style={styles.weatherLoadingState}>
        <ActivityIndicator size="small" color={BRAND_COLOR} />
        <Text style={styles.cardSubText}>Loading weather...</Text>
      </View>
    ) : weatherError ? (
      <Text style={styles.cardSubText}>{weatherError}</Text>
    ) : weather ? (
      <View style={styles.weatherContent}>
        <View style={styles.weatherMainRow}>
          <View style={styles.weatherIconWrap}>
            <MaterialCommunityIcons
              name={getWeatherIcon(weather.state)}
              size={28}
              color={BRAND_COLOR}
            />
          </View>

          <Text style={styles.weatherTemp}>
            {weatherTemp}°{temperatureUnitSymbol}
          </Text>
        </View>

        <Text style={styles.weatherSummary}>
          {weather.description}
          {feelsLikeTemp !== null ? ` • Feels ${feelsLikeTemp}°${temperatureUnitSymbol}` : ""}
        </Text>
      </View>
    ) : (
      <Text style={styles.cardSubText}>No weather data</Text>
    )}
  </View>
{/* Status Card */}
<View style={styles.card}>
  <View style={styles.cardTopRow}>
    <Text style={styles.cardTitle}>Status</Text>
    <Text style={styles.cardMeta}>{localCount > 0 ? 'Local' : 'Cloud'}</Text>
  </View>

  <Text style={styles.statusMain}>
    {onlineCount} online
  </Text>

  <Text style={styles.cardSubText}>
    Total: {devices.length} • Local: {localCount} • Offline: {devices.length - onlineCount}
  </Text>
</View>
</View>
{/* ===== END: Quick Cards ===== */}

        {/* ===== Room Filter Chips ===== */}
        {!loading && roomsWithDevices.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.roomChipsRow}
            contentContainerStyle={styles.roomChipsContent}
          >
            <TouchableOpacity
              style={[
                styles.roomChip,
                !selectedRoomId && styles.roomChipActive,
              ]}
              onPress={() => setSelectedRoomId(null)}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name="view-grid-outline"
                size={16}
                color={!selectedRoomId ? '#FFF' : '#7A8CA5'}
              />
              <Text
                style={[
                  styles.roomChipText,
                  !selectedRoomId && styles.roomChipTextActive,
                ]}
              >
                All
              </Text>
            </TouchableOpacity>

            {roomsWithDevices.map((room) => (
              <TouchableOpacity
                key={room._id}
                style={[
                  styles.roomChip,
                  selectedRoomId === room._id && styles.roomChipActive,
                ]}
                onPress={() => setSelectedRoomId(room._id)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name={(room.icon || 'door') as any}
                  size={16}
                  color={selectedRoomId === room._id ? '#FFF' : '#7A8CA5'}
                />
                <Text
                  style={[
                    styles.roomChipText,
                    selectedRoomId === room._id && styles.roomChipTextActive,
                  ]}
                >
                  {room.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={BRAND_COLOR} />
            <Text style={styles.loadingText}>Loading devices...</Text>
          </View>
        ) : (
          <FlatList
            data={filteredDevices}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={BRAND_COLOR}
                colors={[BRAND_COLOR]}
              />
            }
            ListEmptyComponent={renderEmpty}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#F4F8FC',
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },

  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingTop: 8,
  },

  headerTextContainer: {
    flex: 1,
  },

  // ===== ADDED STYLE =====
  greetingText: {
    fontSize: 24,
    fontWeight: '800',
    color: BRAND_COLOR,
  },

  headerSub: {
    fontSize: 14,
    color: '#7B8AA0',
    marginTop: 4,
  },

  addButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#F0F5FA',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },

  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666666',
  },

  listContent: {
    paddingBottom: 100,
    flexGrow: 1,
  },

  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 80,
  },

  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333333',
    marginTop: 16,
  },

  emptySubtitle: {
    fontSize: 14,
    color: '#999999',
    marginTop: 8,
    textAlign: 'center',
  },

    // ===== ADDED STYLES: Quick Cards =====

  cardsRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 18,
  },

  card: {
    flex: 1,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    padding: 16,
    shadowColor: '#1E3A5F',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },

  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#244B6B',
  },

  cardMeta: {
    fontSize: 12,
    color: '#7A8A99',
  },

  weatherLoadingState: {
    marginTop: 12,
  },

  weatherContent: {
    marginTop: 14,
  },

  weatherMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },

  weatherIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#F3F7FB',
    alignItems: 'center',
    justifyContent: 'center',
  },

  weatherTemp: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '900',
    letterSpacing: -1.2,
    color: BRAND_COLOR,
  },

  weatherSummary: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 18,
    color: '#7A8A99',
  },

  statusMain: {
    marginTop: 12,
    fontSize: 18,
    fontWeight: '800',
    color: BRAND_COLOR,
  },

  cardSubText: {
    marginTop: 6,
    fontSize: 12,
    color: '#7A8A99',
  },

  notifBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#F44336',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: '#F4F8FC',
  },
  notifBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },

  // Room filter chips
  roomChipsRow: {
    marginBottom: 14,
    flexGrow: 0,
    flexShrink: 0,
    maxHeight: 44,
  },
  roomChipsContent: {
    gap: 8,
    paddingRight: 8,
    alignItems: 'center',
  },
  roomChip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8E8E8',
    gap: 6,
  },
  roomChipActive: {
    backgroundColor: BRAND_COLOR,
    borderColor: BRAND_COLOR,
  },
  roomChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7A8CA5',
    flexShrink: 0,
  },
  roomChipTextActive: {
    color: '#FFFFFF',
  },
});
