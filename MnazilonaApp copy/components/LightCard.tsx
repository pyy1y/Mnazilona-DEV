// components/LightCard.tsx

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
type LightCommand = {
  action: 'on' | 'off';
};

export type LogEntry = {
  timestamp: string;
  message: string;
  type?: 'info' | 'warning' | 'error';
};

interface LightCardProps {
  name: string;
  serialNumber: string;
  macAddress?: string;
  isOnline: boolean;
  isLoading: boolean;
  lightState?: 'on' | 'off' | null;
  onAction: (serialNumber: string, command: LightCommand) => void;
  onRename?: (serialNumber: string, newName: string) => void;
  onFetchLogs?: (serialNumber: string) => Promise<LogEntry[]>;
  brandColor: string;
  isDemo?: boolean;
  // Optional i18n texts
  onlineText?: string;
  offlineText?: string;
  onButtonText?: string;
  offButtonText?: string;
  lightOnText?: string;
  lightOffText?: string;
}

// ======================================
// Component
// ======================================
function LightCard({
  name,
  serialNumber,
  macAddress,
  isOnline,
  isLoading,
  lightState,
  onAction,
  onRename,
  onFetchLogs,
  brandColor,
  isDemo = false,
  onlineText = 'ONLINE',
  offlineText = 'OFFLINE',
  onButtonText = 'ON',
  offButtonText = 'OFF',
  lightOnText = 'STATUS: ON',
  lightOffText = 'STATUS: OFF',
}: LightCardProps) {
  // Demo mode: local state fallback when no API
  const [demoState, setDemoState] = useState<'on' | 'off'>('off');
  const effectiveState = isDemo ? demoState : (lightState ?? 'off');
  const isLightOn = effectiveState === 'on';

  const [menuVisible, setMenuVisible] = useState(false);
  const [activeSection, setActiveSection] = useState<'menu' | 'rename' | 'serial' | 'mac' | 'logs' | null>(null);
  const [newName, setNewName] = useState(name);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Handlers
  const handleOn = useCallback(() => {
    if (!isOnline || isLoading) return;
    if (isDemo) {
      setDemoState('on');
      return;
    }
    onAction(serialNumber, { action: 'on' });
  }, [onAction, serialNumber, isOnline, isLoading, isDemo]);

  const handleOff = useCallback(() => {
    if (!isOnline || isLoading) return;
    if (isDemo) {
      setDemoState('off');
      return;
    }
    onAction(serialNumber, { action: 'off' });
  }, [onAction, serialNumber, isOnline, isLoading, isDemo]);

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
    if (onRename) {
      onRename(serialNumber, trimmed);
    }
    closeModal();
  }, [newName, onRename, serialNumber, closeModal]);

  const logsPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async () => {
    if (!onFetchLogs) return;
    try {
      const fetched = await onFetchLogs(serialNumber);
      setLogs(fetched);
    } catch {
      // silently ignore poll errors
    }
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

  // Real-time polling: refresh logs every 5 seconds while logs section is open
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

  // Computed styles
  const onBtnBgColor = useMemo(() => {
    if (!isOnline) return '#C7CED8';
    return isLightOn ? '#D97706' : '#E5E7EB';
  }, [isOnline, isLightOn]);

  const offBtnBgColor = useMemo(() => {
    if (!isOnline) return '#C7CED8';
    return !isLightOn ? brandColor : '#E5E7EB';
  }, [isOnline, isLightOn, brandColor]);

  const statusConfig = useMemo(() => {
    if (isOnline) {
      return {
        backgroundColor: '#22C55E',
        dotColor: '#FFFFFF',
        textColor: '#FFFFFF',
        text: onlineText,
      };
    }
    return {
      backgroundColor: '#F3F4F6',
      dotColor: '#6B7280',
      textColor: '#6B7280',
      text: offlineText,
    };
  }, [isOnline, onlineText, offlineText]);

  const textColors = useMemo(() => {
    return {
      name: isOnline ? '#333333' : '#9CA3AF',
      icon: isOnline ? (isLightOn ? '#FBBF24' : '#333333') : '#9CA3AF',
    };
  }, [isOnline, isLightOn]);

  // ======================================
  // Modal Content
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

      case 'logs': {
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
                    <Text style={[styles.logTime, { color: item.type === 'error' ? '#EF4444' : item.type === 'warning' ? '#F59E0B' : '#6B7280' }]}>{item.timestamp}</Text>
                    <Text style={styles.logMessage}>{item.message}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        );
      }

      default:
        return null;
    }
  };

  return (
    <View style={styles.card}>
      {/* Three-dot Menu Button */}
      <TouchableOpacity
        style={styles.menuButton}
        onPress={openMenu}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Device options"
      >
        <MaterialCommunityIcons name="dots-vertical" size={22} color="#999" />
      </TouchableOpacity>

      {/* Demo Badge (only in demo mode) */}
      {isDemo && (
        <View style={styles.demoBadge}>
          <Text style={styles.demoBadgeText}>DEMO</Text>
        </View>
      )}

      {/* Status Badge */}
      <View style={[styles.statusBadge, { backgroundColor: statusConfig.backgroundColor }]}>
        <View style={[styles.statusDot, { backgroundColor: statusConfig.dotColor }]} />
        <Text style={[styles.statusText, { color: statusConfig.textColor }]}>
          {statusConfig.text}
        </Text>
      </View>

      {/* Header */}
      <View style={styles.header}>
        <MaterialCommunityIcons
          name={isLightOn ? 'lightbulb-on' : 'lightbulb-outline'}
          size={32}
          color={textColors.icon}
          style={styles.icon}
        />
        <View style={styles.titleContainer}>
          <Text style={[styles.deviceName, { color: textColors.name }]} numberOfLines={1}>
            {name}
          </Text>
        </View>
      </View>

      {/* Light State Indicator */}
      {isOnline && (
        <View style={[
          styles.stateContainer,
          { backgroundColor: isLightOn ? '#FEF3C7' : '#D1FAE5' }
        ]}>
          <View style={[
            styles.stateDotIndicator,
            { backgroundColor: isLightOn ? '#D97706' : '#059669' }
          ]} />
          <Text style={[
            styles.stateText,
            { color: isLightOn ? '#D97706' : '#059669' }
          ]}>
            {isLightOn ? lightOnText : lightOffText}
          </Text>
        </View>
      )}

      {/* Action Buttons */}
      <View style={styles.buttonsRow}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: onBtnBgColor }]}
          onPress={handleOn}
          disabled={!isOnline || isLoading}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`${onButtonText} - ${name}`}
          accessibilityState={{ disabled: !isOnline || isLoading }}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={[styles.primaryBtnText, !isLightOn ? { color: '#6B7280' } : {}]}>{onButtonText}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: offBtnBgColor }]}
          onPress={handleOff}
          disabled={!isOnline || isLoading}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`${offButtonText} - ${name}`}
          accessibilityState={{ disabled: !isOnline || isLoading }}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={[styles.primaryBtnText, !isLightOn ? {} : { color: '#6B7280' }]}>
              {offButtonText}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Offline Message */}
      {!isOnline && (
        <Text style={styles.offlineMessage}>
          Device is offline. Check your connection.
        </Text>
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

// Use memo with custom comparison for performance
export default memo(LightCard, (prevProps, nextProps) => {
  return (
    prevProps.serialNumber === nextProps.serialNumber &&
    prevProps.name === nextProps.name &&
    prevProps.isOnline === nextProps.isOnline &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.lightState === nextProps.lightState &&
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
    padding: 20,
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 10,
    paddingHorizontal: 30,
  },
  icon: {
    marginRight: 14,
  },
  titleContainer: {
    flex: 1,
  },
  deviceName: {
    fontSize: 20,
    fontWeight: '700',
  },
  stateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  stateDotIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  stateText: {
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 8,
    letterSpacing: 0.5,
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  primaryBtn: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  offlineMessage: {
    marginTop: 12,
    fontSize: 12,
    color: '#999999',
    textAlign: 'center',
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
