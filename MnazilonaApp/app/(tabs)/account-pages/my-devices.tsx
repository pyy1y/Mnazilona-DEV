import React, { useCallback, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { api, isAuthError } from '../../../utils/api';
import { useAuth } from '../../../hooks/useAuth';
import { ENDPOINTS } from '../../../constants/api';
import { connectSocket, onSocketEvent } from '../../../utils/socket';

const BRAND_COLOR = '#2E5B8E';
const WARRANTY_YEARS = 2;
const WARRANTY_DAYS = WARRANTY_YEARS * 365;
const LOGS_MAX_BUFFER = 200;

type TabType = 'logs' | 'warranty';

interface DeviceLog {
  serialNumber: string;
  deviceName?: string;
  type: 'info' | 'warning' | 'error';
  message: string;
  source: string;
  timestamp: string;
}

interface DeviceWarranty {
  _id: string;
  name: string;
  serialNumber: string;
  warrantyStartDate: string | null;
  isOnline: boolean;
}

const LOG_COLORS: Record<string, string> = {
  info: '#2E7D32',
  warning: '#F57F17',
  error: '#D32F2F',
};

const LOG_ICONS: Record<string, string> = {
  info: 'information-outline',
  warning: 'alert-outline',
  error: 'alert-circle-outline',
};

export default function MyDevicesScreen() {
  const router = useRouter();
  const { handleAuthError } = useAuth();

  const [activeTab, setActiveTab] = useState<TabType>('logs');

  // Logs state
  const [logs, setLogs] = useState<DeviceLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsRefreshing, setLogsRefreshing] = useState(false);
  const [logsPage, setLogsPage] = useState(1);
  const [hasMoreLogs, setHasMoreLogs] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Warranty state
  const [devices, setDevices] = useState<DeviceWarranty[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);

  const handleGoBack = useCallback(() => {
    router.replace('/(tabs)/account');
  }, [router]);

  // ── Logs ──
  const fetchLogs = useCallback(async (page = 1, append = false) => {
    try {
      const response = await api.get<any>(
        `${ENDPOINTS.DEVICES.ALL_LOGS}?page=${page}&limit=30`,
        { requireAuth: true }
      );

      if (response.success && response.data) {
        const newLogs = response.data.logs || [];
        if (append) {
          setLogs((prev) => [...prev, ...newLogs]);
        } else {
          setLogs(newLogs);
        }
        setHasMoreLogs(page < (response.data.pages || 1));
        setLogsPage(page);
      } else if (isAuthError(response.status)) {
        await handleAuthError(response.status);
      }
    } catch {
      // silent
    }
  }, [handleAuthError]);

  const loadInitialLogs = useCallback(async () => {
    setLogsLoading(true);
    await fetchLogs(1, false);
    setLogsLoading(false);
  }, [fetchLogs]);

  const refreshLogs = useCallback(async () => {
    setLogsRefreshing(true);
    await fetchLogs(1, false);
    setLogsRefreshing(false);
  }, [fetchLogs]);

  const loadMoreLogs = useCallback(async () => {
    if (loadingMore || !hasMoreLogs) return;
    setLoadingMore(true);
    await fetchLogs(logsPage + 1, true);
    setLoadingMore(false);
  }, [loadingMore, hasMoreLogs, logsPage, fetchLogs]);

  // ── Warranty ──
  const fetchDevices = useCallback(async () => {
    try {
      const response = await api.get<any>(ENDPOINTS.DEVICES.LIST, {
        requireAuth: true,
      });

      if (response.success && response.data) {
        setDevices(response.data.devices || []);
      } else if (isAuthError(response.status)) {
        await handleAuthError(response.status);
      }
    } catch {
      // silent
    }
  }, [handleAuthError]);

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    await fetchDevices();
    setDevicesLoading(false);
  }, [fetchDevices]);

  // Logs / warranty: fetch once when the tab is shown, then keep the logs
  // tab live via the realtime socket. The backend pushes a `device:log`
  // event whenever a log row is written for a device this user owns.
  useFocusEffect(
    useCallback(() => {
      if (activeTab === 'logs') {
        loadInitialLogs();
        connectSocket().catch(() => {});

        const unsubscribe = onSocketEvent('device:log', (entry: any) => {
          if (!entry?.serialNumber || !entry?.timestamp) return;
          const incoming: DeviceLog = {
            serialNumber: entry.serialNumber,
            deviceName: entry.deviceName,
            type: entry.type,
            message: entry.message,
            source: entry.source,
            timestamp: entry.timestamp,
          };
          setLogs((prev) => {
            // Reset to page 1 view; cap buffer so the list never grows
            // unbounded while the user keeps the tab open for a long time.
            const next = [incoming, ...prev];
            return next.length > LOGS_MAX_BUFFER
              ? next.slice(0, LOGS_MAX_BUFFER)
              : next;
          });
        });

        return () => {
          unsubscribe();
        };
      }

      loadDevices();
      return () => {};
    }, [activeTab, loadInitialLogs, loadDevices])
  );

  // ── Warranty helpers ──
  const getWarrantyInfo = (startDate: string | null) => {
    if (!startDate) return { daysRemaining: -1, progress: 0, expired: false };

    const start = new Date(startDate).getTime();
    const now = Date.now();
    const elapsed = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    const remaining = Math.max(0, WARRANTY_DAYS - elapsed);
    const progress = Math.min(1, elapsed / WARRANTY_DAYS);

    return {
      daysRemaining: remaining,
      progress,
      expired: remaining === 0,
    };
  };

  const formatDaysRemaining = (days: number) => {
    if (days < 0) return 'Not activated';
    if (days === 0) return 'Expired';
    if (days >= 365) {
      const years = Math.floor(days / 365);
      const remainDays = days % 365;
      const months = Math.floor(remainDays / 30);
      if (months > 0) return `${years}y ${months}m remaining`;
      return `${years}y remaining`;
    }
    if (days >= 30) {
      const months = Math.floor(days / 30);
      const remainDays = days % 30;
      if (remainDays > 0) return `${months}m ${remainDays}d remaining`;
      return `${months}m remaining`;
    }
    return `${days}d remaining`;
  };

  const getProgressColor = (progress: number) => {
    if (progress >= 1) return '#D32F2F';
    if (progress >= 0.75) return '#F57F17';
    return '#2E7D32';
  };

  // ── Format time ──
  const formatLogTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // ── Render items ──
  const renderLogItem = ({ item }: { item: DeviceLog }) => (
    <View style={styles.logItem}>
      <View style={[styles.logIconWrap, { backgroundColor: `${LOG_COLORS[item.type]}15` }]}>
        <MaterialCommunityIcons
          name={LOG_ICONS[item.type] as any}
          size={20}
          color={LOG_COLORS[item.type]}
        />
      </View>
      <View style={styles.logBody}>
        <View style={styles.logHeader}>
          <Text style={styles.logDeviceName} numberOfLines={1}>
            {item.deviceName || item.serialNumber}
          </Text>
          <Text style={styles.logTime}>{formatLogTime(item.timestamp)}</Text>
        </View>
        <Text style={styles.logMessage} numberOfLines={2}>
          {item.message}
        </Text>
        <View style={styles.logMeta}>
          <View style={[styles.logTypeBadge, { backgroundColor: `${LOG_COLORS[item.type]}15` }]}>
            <Text style={[styles.logTypeText, { color: LOG_COLORS[item.type] }]}>
              {item.type}
            </Text>
          </View>
          <Text style={styles.logSource}>{item.source}</Text>
        </View>
      </View>
    </View>
  );

  const renderWarrantyItem = ({ item }: { item: DeviceWarranty }) => {
    const warranty = getWarrantyInfo(item.warrantyStartDate);
    const progressColor = getProgressColor(warranty.progress);

    return (
      <View style={styles.warrantyCard}>
        <View style={styles.warrantyHeader}>
          <View style={styles.warrantyDeviceInfo}>
            <MaterialCommunityIcons
              name="chip"
              size={22}
              color={BRAND_COLOR}
            />
            <View style={styles.warrantyNameWrap}>
              <Text style={styles.warrantyDeviceName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.warrantySerial}>{item.serialNumber}</Text>
            </View>
          </View>
          <View style={[styles.statusDot, { backgroundColor: item.isOnline ? '#2E7D32' : '#999' }]} />
        </View>

        <View style={styles.warrantyBody}>
          <View style={styles.warrantyProgressBg}>
            <View
              style={[
                styles.warrantyProgressFill,
                {
                  width: `${Math.min(warranty.progress * 100, 100)}%`,
                  backgroundColor: progressColor,
                },
              ]}
            />
          </View>

          <View style={styles.warrantyFooter}>
            <Text style={[styles.warrantyRemaining, { color: progressColor }]}>
              {formatDaysRemaining(warranty.daysRemaining)}
            </Text>
            {item.warrantyStartDate && (
              <Text style={styles.warrantyStartDate}>
                Started {new Date(item.warrantyStartDate).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </Text>
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerWrap}>
        <TouchableOpacity style={styles.backButton} onPress={handleGoBack}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={BRAND_COLOR} />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.headerTitle}>My Devices</Text>
        <Text style={styles.headerSubtitle}>Device logs and warranty information</Text>

        {/* Tab Switcher */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'logs' && styles.tabActive]}
            onPress={() => setActiveTab('logs')}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name="text-box-outline"
              size={18}
              color={activeTab === 'logs' ? '#fff' : BRAND_COLOR}
            />
            <Text style={[styles.tabText, activeTab === 'logs' && styles.tabTextActive]}>
              Logs
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tab, activeTab === 'warranty' && styles.tabActive]}
            onPress={() => setActiveTab('warranty')}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name="shield-check-outline"
              size={18}
              color={activeTab === 'warranty' ? '#fff' : BRAND_COLOR}
            />
            <Text style={[styles.tabText, activeTab === 'warranty' && styles.tabTextActive]}>
              Warranty
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      {activeTab === 'logs' ? (
        logsLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={BRAND_COLOR} />
          </View>
        ) : logs.length === 0 ? (
          <View style={styles.centered}>
            <MaterialCommunityIcons name="text-box-remove-outline" size={48} color="#CCC" />
            <Text style={styles.emptyText}>No logs yet</Text>
          </View>
        ) : (
          <FlatList
            data={logs}
            keyExtractor={(item, index) => `${item.serialNumber}-${item.timestamp}-${index}`}
            renderItem={renderLogItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={logsRefreshing}
                onRefresh={refreshLogs}
                tintColor={BRAND_COLOR}
              />
            }
            onEndReached={loadMoreLogs}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              loadingMore ? (
                <ActivityIndicator
                  size="small"
                  color={BRAND_COLOR}
                  style={{ marginVertical: 16 }}
                />
              ) : null
            }
          />
        )
      ) : devicesLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_COLOR} />
        </View>
      ) : devices.length === 0 ? (
        <View style={styles.centered}>
          <MaterialCommunityIcons name="devices" size={48} color="#CCC" />
          <Text style={styles.emptyText}>No devices paired</Text>
        </View>
      ) : (
        <FlatList
          data={devices}
          keyExtractor={(item) => item._id}
          renderItem={renderWarrantyItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  headerWrap: {
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 16,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: 12,
    gap: 6,
  },
  backButtonText: {
    color: BRAND_COLOR,
    fontSize: 16,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: '700',
    color: BRAND_COLOR,
    marginBottom: 6,
  },
  headerSubtitle: {
    fontSize: 15,
    color: '#7A8CA5',
    marginBottom: 20,
  },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#F0F4F8',
    borderRadius: 14,
    padding: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 11,
    gap: 6,
  },
  tabActive: {
    backgroundColor: BRAND_COLOR,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: BRAND_COLOR,
  },
  tabTextActive: {
    color: '#FFFFFF',
  },

  // Lists
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 30,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    fontWeight: '500',
  },

  // Log item
  logItem: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ECECEC',
    padding: 14,
    marginBottom: 10,
  },
  logIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  logBody: {
    flex: 1,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  logDeviceName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
    flex: 1,
    marginRight: 8,
  },
  logTime: {
    fontSize: 12,
    color: '#999',
  },
  logMessage: {
    fontSize: 13,
    color: '#555',
    lineHeight: 18,
    marginBottom: 6,
  },
  logMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  logTypeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  logSource: {
    fontSize: 11,
    color: '#AAA',
  },

  // Warranty card
  warrantyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  warrantyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  warrantyDeviceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  warrantyNameWrap: {
    flex: 1,
  },
  warrantyDeviceName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  warrantySerial: {
    fontSize: 12,
    color: '#999',
    marginTop: 1,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: 8,
  },
  warrantyBody: {
    gap: 8,
  },
  warrantyProgressBg: {
    height: 8,
    backgroundColor: '#F0F0F0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  warrantyProgressFill: {
    height: '100%',
    borderRadius: 4,
  },
  warrantyFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  warrantyRemaining: {
    fontSize: 13,
    fontWeight: '600',
  },
  warrantyStartDate: {
    fontSize: 12,
    color: '#AAA',
  },
});
