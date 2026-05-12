// components/SecurityCard.tsx

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Modal,
  TextInput,
  ScrollView,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// ======================================
// Types
// ======================================
export type LogEntry = {
  timestamp: string;
  message: string;
  type?: 'info' | 'warning' | 'error';
};

type SecurityMode = 'armed_home' | 'armed_away' | 'armed_night' | 'armed_vacation' | 'armed_custom' | 'disarmed';

interface SecurityCardProps {
  name: string;
  serialNumber: string;
  macAddress?: string;
  isOnline: boolean;
  isLoading: boolean;
  securityMode?: SecurityMode | null;
  onAction?: (serialNumber: string, command: { action: string; value?: any }) => void;
  onRename?: (serialNumber: string, newName: string) => void;
  onFetchLogs?: (serialNumber: string) => Promise<LogEntry[]>;
  onSharePress?: () => void;
  brandColor: string;
  isDemo?: boolean;
  onlineText?: string;
  offlineText?: string;
}

// ======================================
// Constants
// ======================================
const MODE_OPTIONS: { value: SecurityMode; label: string; labelAr: string; icon: string }[] = [
  { value: 'armed_home', label: 'Armed Home', labelAr: 'في المنزل', icon: 'home' },
  { value: 'armed_away', label: 'Armed Away', labelAr: 'خارج المنزل', icon: 'lock' },
  { value: 'armed_night', label: 'Armed Night', labelAr: 'وضع الليل', icon: 'moon-waning-crescent' },
  { value: 'armed_vacation', label: 'Armed Vacation', labelAr: 'وضع السفر', icon: 'airplane' },
  { value: 'armed_custom', label: 'Armed Custom', labelAr: 'مخصص', icon: 'shield' },
  { value: 'disarmed', label: 'Disarmed', labelAr: 'معطّل', icon: 'shield-off' },
];

const getModeColor = (mode: SecurityMode): string => {
  switch (mode) {
    case 'armed_home': return '#3B82F6';
    case 'armed_away': return '#22C55E';
    case 'armed_night': return '#6366F1';
    case 'armed_vacation': return '#F59E0B';
    case 'armed_custom': return '#333333';
    case 'disarmed':
    default: return '#6B7280';
  }
};

const getModeLabel = (mode: SecurityMode): string => {
  const option = MODE_OPTIONS.find(o => o.value === mode);
  return option?.label || 'Disarmed';
};

// ======================================
// Component
// ======================================
function SecurityCard({
  name,
  serialNumber,
  macAddress,
  isOnline,
  isLoading,
  securityMode,
  onAction,
  onRename,
  onFetchLogs,
  onSharePress,
  brandColor,
  isDemo = false,
  onlineText = 'ONLINE',
  offlineText = 'OFFLINE',
}: SecurityCardProps) {
  // Demo state
  const [demoMode, setDemoMode] = useState<SecurityMode>('armed_away');

  const effectiveMode = isDemo ? demoMode : (securityMode ?? 'disarmed');
  const modeColor = getModeColor(effectiveMode);
  const isArmed = effectiveMode !== 'disarmed';

  // Menu modal state
  const [menuVisible, setMenuVisible] = useState(false);
  const [activeSection, setActiveSection] = useState<
    'menu' | 'rename' | 'serial' | 'mac' | 'logs' | null
  >(null);
  const [newName, setNewName] = useState(name);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Mode change
  const handleModeChange = useCallback((newMode: SecurityMode) => {
    if (isDemo) {
      setDemoMode(newMode);
      return;
    }
    if (onAction) onAction(serialNumber, { action: 'set_security_mode', value: newMode });
  }, [isDemo, onAction, serialNumber]);

  // Menu handlers
  const openMenu = useCallback(() => {
    setActiveSection('menu');
    setMenuVisible(true);
  }, []);

  const closeModal = useCallback(() => {
    setMenuVisible(false);
    setActiveSection(null);
    setNewName(name);
  }, [name]);

  const handleRename = useCallback(() => {
    const trimmed = newName.trim();
    if (!trimmed) {
      Alert.alert('Error', 'Device name cannot be empty.');
      return;
    }
    if (onRename) onRename(serialNumber, trimmed);
    closeModal();
  }, [newName, onRename, serialNumber, closeModal]);

  const logsPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async () => {
    if (!onFetchLogs) return;
    try {
      const fetched = await onFetchLogs(serialNumber);
      setLogs(fetched);
    } catch { /* silently ignore */ }
  }, [onFetchLogs, serialNumber]);

  const handleOpenLogs = useCallback(async () => {
    setActiveSection('logs');
    if (!onFetchLogs) return;
    setLogsLoading(true);
    try {
      const fetched = await onFetchLogs(serialNumber);
      setLogs(fetched);
    } catch {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, [onFetchLogs, serialNumber]);

  useEffect(() => {
    if (activeSection !== 'logs' || !onFetchLogs) {
      if (logsPollRef.current) {
        clearInterval(logsPollRef.current);
        logsPollRef.current = null;
      }
      return;
    }
    logsPollRef.current = setInterval(fetchLogs, 5000);
    return () => {
      if (logsPollRef.current) {
        clearInterval(logsPollRef.current);
        logsPollRef.current = null;
      }
    };
  }, [activeSection, fetchLogs, onFetchLogs]);

  // ======================================
  // Menu Modal Content
  // ======================================
  const renderModalContent = () => {
    switch (activeSection) {
      case 'menu':
        return (
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{name}</Text>
            {!isDemo && (
              <TouchableOpacity style={styles.menuItem} onPress={() => setActiveSection('rename')}>
                <MaterialCommunityIcons name="pencil-outline" size={22} color="#333" />
                <Text style={styles.menuItemText}>Edit Name</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.menuItem} onPress={() => setActiveSection('serial')}>
              <MaterialCommunityIcons name="barcode" size={22} color="#333" />
              <Text style={styles.menuItemText}>Serial Number</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => setActiveSection('mac')}>
              <MaterialCommunityIcons name="ethernet" size={22} color="#333" />
              <Text style={styles.menuItemText}>MAC Address</Text>
            </TouchableOpacity>
            {!isDemo && (
              <TouchableOpacity style={styles.menuItem} onPress={handleOpenLogs}>
                <MaterialCommunityIcons name="text-box-outline" size={22} color="#333" />
                <Text style={styles.menuItemText}>Device Logs</Text>
              </TouchableOpacity>
            )}
            {onSharePress && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => { closeModal(); onSharePress(); }}
              >
                <MaterialCommunityIcons name="share-variant" size={22} color="#333" />
                <Text style={styles.menuItemText}>Share Device</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
              <Text style={styles.cancelBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        );

      case 'rename':
        return (
          <View style={styles.modalContent}>
            <TouchableOpacity onPress={() => setActiveSection('menu')} style={styles.backBtn}>
              <MaterialCommunityIcons name="arrow-left" size={22} color="#333" />
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Edit Device Name</Text>
            <TextInput
              style={styles.textInput}
              value={newName}
              onChangeText={setNewName}
              placeholder="Enter new name"
              autoFocus
              maxLength={50}
            />
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: brandColor }]}
              onPress={handleRename}
            >
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        );

      case 'serial':
        return (
          <View style={styles.modalContent}>
            <TouchableOpacity onPress={() => setActiveSection('menu')} style={styles.backBtn}>
              <MaterialCommunityIcons name="arrow-left" size={22} color="#333" />
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Serial Number</Text>
            <View style={styles.infoBox}>
              <Text style={styles.infoValue} selectable>{serialNumber}</Text>
            </View>
          </View>
        );

      case 'mac':
        return (
          <View style={styles.modalContent}>
            <TouchableOpacity onPress={() => setActiveSection('menu')} style={styles.backBtn}>
              <MaterialCommunityIcons name="arrow-left" size={22} color="#333" />
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>MAC Address</Text>
            <View style={styles.infoBox}>
              <Text style={styles.infoValue} selectable>{macAddress || 'N/A'}</Text>
            </View>
          </View>
        );

      case 'logs':
        return (
          <View style={styles.logsModalContent}>
            <View style={styles.logsHeader}>
              <TouchableOpacity onPress={() => setActiveSection('menu')} style={styles.backBtn}>
                <MaterialCommunityIcons name="arrow-left" size={22} color="#333" />
                <Text style={styles.backBtnText}>Back</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Device Logs</Text>
            </View>
            {logsLoading ? (
              <ActivityIndicator size="small" color="#999" style={{ marginTop: 20 }} />
            ) : logs.length === 0 ? (
              <Text style={styles.emptyLogs}>No logs available.</Text>
            ) : (
              <ScrollView
                style={styles.logsScrollView}
                contentContainerStyle={styles.logsScrollContent}
                showsVerticalScrollIndicator={true}
                nestedScrollEnabled={true}
                bounces={true}
              >
                {logs.map((item, index) => (
                  <View key={index} style={styles.logItem}>
                    <Text style={[styles.logTime, { color: item.type === 'error' ? '#EF4444' : item.type === 'warning' ? '#F59E0B' : '#6B7280' }]}>
                      {item.timestamp}
                    </Text>
                    <Text style={styles.logMessage}>{item.message}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <View style={styles.card}>
      {/* Three-dot Menu */}
      <TouchableOpacity
        style={styles.menuButton}
        onPress={openMenu}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Device options"
      >
        <MaterialCommunityIcons name="dots-vertical" size={22} color="#999" />
      </TouchableOpacity>

      {/* Demo Badge */}
      {isDemo && (
        <View style={styles.demoBadge}>
          <Text style={styles.demoBadgeText}>DEMO</Text>
        </View>
      )}

      {/* Status Badge */}
      <View style={[styles.statusBadge, { backgroundColor: isOnline ? '#22C55E' : '#F3F4F6' }]}>
        <View style={[styles.statusDot, { backgroundColor: isOnline ? '#FFFFFF' : '#6B7280' }]} />
        <Text style={[styles.statusText, { color: isOnline ? '#FFFFFF' : '#6B7280' }]}>
          {isOnline ? onlineText : offlineText}
        </Text>
      </View>

      {isOnline ? (
        <>
          {/* Security Icon + Status */}
          <View style={styles.securityHeader}>
            <View style={[styles.securityIconCircle, { backgroundColor: `${modeColor}20` }]}>
              <MaterialCommunityIcons
                name={isArmed ? 'shield-lock' : 'shield-off-outline'}
                size={32}
                color={modeColor}
              />
            </View>
            <View style={styles.securityInfo}>
              <Text style={styles.securityName} numberOfLines={1}>{name}</Text>
              <Text style={[styles.securityStatus, { color: modeColor }]}>
                {getModeLabel(effectiveMode)}
              </Text>
            </View>
          </View>

          {/* Mode Icons Bar */}
          <View style={styles.modeBar}>
            {MODE_OPTIONS.map((opt) => {
              const isSelected = opt.value === effectiveMode;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.modeIconBtn,
                    isSelected && [styles.modeIconBtnActive, { backgroundColor: getModeColor(opt.value) }],
                  ]}
                  onPress={() => handleModeChange(opt.value)}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons
                    name={opt.icon as any}
                    size={22}
                    color={isSelected ? '#FFFFFF' : '#333333'}
                  />
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      ) : (
        <View style={styles.offlineContainer}>
          <MaterialCommunityIcons name="shield-off-outline" size={48} color="#D1D5DB" />
          <Text style={styles.offlineText}>Device is offline</Text>
          <Text style={styles.offlineSubtext}>Check your connection</Text>
        </View>
      )}

      {/* Options Modal */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable style={styles.modalOverlay} onPress={closeModal}>
            <Pressable style={styles.modalContainer} onPress={(e) => e.stopPropagation()}>
              {renderModalContent()}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

export default memo(SecurityCard, (prevProps, nextProps) => {
  return (
    prevProps.serialNumber === nextProps.serialNumber &&
    prevProps.name === nextProps.name &&
    prevProps.isOnline === nextProps.isOnline &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.securityMode === nextProps.securityMode &&
    prevProps.brandColor === nextProps.brandColor &&
    prevProps.macAddress === nextProps.macAddress &&
    prevProps.isDemo === nextProps.isDemo
  );
});

// ======================================
// Styles
// ======================================
const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  menuButton: {
    position: 'absolute',
    top: 14,
    left: 14,
    zIndex: 10,
    padding: 4,
  },
  demoBadge: {
    position: 'absolute',
    top: 42,
    left: 14,
    zIndex: 10,
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  demoBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#7C3AED',
    letterSpacing: 0.5,
  },
  statusBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    zIndex: 10,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  // Security Header
  securityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 16,
    paddingHorizontal: 30,
  },
  securityIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  securityInfo: {
    flex: 1,
  },
  securityName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
    marginBottom: 2,
  },
  securityStatus: {
    fontSize: 14,
    fontWeight: '600',
  },
  // Mode bar
  modeBar: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 14,
    padding: 4,
    justifyContent: 'space-around',
  },
  modeIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeIconBtnActive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  // Offline
  offlineContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  offlineText: {
    fontSize: 16,
    color: '#9CA3AF',
    fontWeight: '600',
    marginTop: 12,
  },
  offlineSubtext: {
    fontSize: 13,
    color: '#D1D5DB',
    marginTop: 4,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 40,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  modalContent: {
    padding: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
    marginBottom: 20,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  menuItemText: {
    fontSize: 16,
    color: '#333',
    marginLeft: 14,
    fontWeight: '500',
    flex: 1,
  },
  cancelBtn: {
    marginTop: 20,
    alignItems: 'center',
    paddingVertical: 12,
  },
  cancelBtnText: {
    fontSize: 16,
    color: '#999',
    fontWeight: '600',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backBtnText: {
    fontSize: 16,
    color: '#333',
    marginLeft: 6,
    fontWeight: '500',
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#333',
    backgroundColor: '#FAFAFA',
    marginBottom: 16,
  },
  saveBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  infoBox: {
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    fontFamily: 'monospace',
  },
  // Logs
  emptyLogs: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    marginTop: 20,
  },
  logItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  logTime: {
    fontSize: 11,
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  logMessage: {
    fontSize: 14,
    color: '#333',
  },
  logsModalContent: {
    flex: 1,
    padding: 24,
  },
  logsHeader: {
    paddingBottom: 4,
  },
  logsScrollView: {
    flex: 1,
  },
  logsScrollContent: {
    paddingBottom: 20,
  },
});
