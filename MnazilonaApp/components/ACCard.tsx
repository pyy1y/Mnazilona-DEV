// components/ACCard.tsx

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
export type LogEntry = {
  timestamp: string;
  message: string;
  type?: 'info' | 'warning' | 'error';
};

type ACMode = 'off' | 'auto' | 'heat' | 'cool' | 'dry' | 'fan_only';
type FanMode = 'auto' | 'low' | 'medium_low' | 'medium' | 'medium_high' | 'high';
type SwingMode = 'off' | 'vertical' | 'horizontal' | 'both';
type PresetMode = 'none' | 'eco' | 'away' | 'boost' | 'sleep';

interface ACCardProps {
  name: string;
  serialNumber: string;
  macAddress?: string;
  isOnline: boolean;
  isLoading: boolean;
  currentTemp?: number | null;
  targetTemp?: number | null;
  mode?: ACMode | null;
  fanMode?: FanMode | null;
  swingMode?: SwingMode | null;
  presetMode?: PresetMode | null;
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
const TEMP_MIN = 16;
const TEMP_MAX = 30;

const MODE_OPTIONS: { value: ACMode; label: string; icon: string }[] = [
  { value: 'auto', label: 'Auto', icon: 'autorenew' },
  { value: 'cool', label: 'Cool', icon: 'snowflake' },
  { value: 'dry', label: 'Dry', icon: 'water-outline' },
  { value: 'fan_only', label: 'Fan', icon: 'fan' },
  { value: 'heat', label: 'Heat', icon: 'fire' },
  { value: 'off', label: 'Off', icon: 'power-standby' },
];

const FAN_OPTIONS: { value: FanMode; label: string; icon: string }[] = [
  { value: 'auto', label: 'Auto', icon: 'fan-auto' },
  { value: 'low', label: 'Low', icon: 'fan-speed-1' },
  { value: 'medium_low', label: 'Medium low', icon: 'fan-speed-1' },
  { value: 'medium', label: 'Medium', icon: 'fan-speed-2' },
  { value: 'medium_high', label: 'Medium high', icon: 'fan-speed-2' },
  { value: 'high', label: 'High', icon: 'fan-speed-3' },
];

const SWING_OPTIONS: { value: SwingMode; label: string; icon: string }[] = [
  { value: 'off', label: 'Off', icon: 'swap-vertical-bold' },
  { value: 'vertical', label: 'Vertical', icon: 'arrow-up-down' },
  { value: 'horizontal', label: 'Horizontal', icon: 'arrow-left-right' },
  { value: 'both', label: 'Both', icon: 'arrow-all' },
];

const PRESET_OPTIONS: { value: PresetMode; label: string; icon: string }[] = [
  { value: 'eco', label: 'Eco', icon: 'leaf' },
  { value: 'away', label: 'Away', icon: 'account-arrow-right' },
  { value: 'boost', label: 'Boost', icon: 'rocket-launch' },
  { value: 'none', label: 'None', icon: 'circle-small' },
  { value: 'sleep', label: 'Sleep', icon: 'bed' },
];

const getModeColor = (mode: ACMode): string => {
  switch (mode) {
    case 'heat': return '#EF4444';
    case 'cool': return '#3B82F6';
    case 'dry': return '#F59E0B';
    case 'fan_only': return '#8B5CF6';
    case 'auto': return '#10B981';
    case 'off':
    default: return '#6B7280';
  }
};

// ======================================
// Arc helpers (View-based, no SVG)
// ======================================
const ARC_SIZE = 170;
const ARC_STROKE = 8;
const ARC_RADIUS = (ARC_SIZE - ARC_STROKE) / 2;
const ARC_CENTER = ARC_SIZE / 2;
// Arc goes from 150° to 390° (240° sweep), gap at bottom
const ARC_START_ANGLE = 150;
const ARC_END_ANGLE = 390;
const ARC_SWEEP = ARC_END_ANGLE - ARC_START_ANGLE;

const degToRad = (deg: number) => (deg * Math.PI) / 180;

const getPointOnArc = (angleDeg: number) => ({
  x: ARC_CENTER + ARC_RADIUS * Math.cos(degToRad(angleDeg)),
  y: ARC_CENTER + ARC_RADIUS * Math.sin(degToRad(angleDeg)),
});

const tempToAngle = (temp: number) => {
  const ratio = (temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN);
  return ARC_START_ANGLE + ratio * ARC_SWEEP;
};

// Generate arc segment dots for visual arc
const generateArcDots = (startAngle: number, endAngle: number, count: number) => {
  const dots = [];
  for (let i = 0; i <= count; i++) {
    const angle = startAngle + (i / count) * (endAngle - startAngle);
    const pos = getPointOnArc(angle);
    dots.push({ x: pos.x, y: pos.y, angle });
  }
  return dots;
};

// ======================================
// Component
// ======================================
function ACCard({
  name,
  serialNumber,
  macAddress,
  isOnline,
  isLoading,
  currentTemp,
  targetTemp,
  mode,
  fanMode,
  swingMode,
  presetMode,
  onAction,
  onRename,
  onFetchLogs,
  onSharePress,
  brandColor,
  isDemo = false,
  onlineText = 'ONLINE',
  offlineText = 'OFFLINE',
}: ACCardProps) {
  // Demo state
  const [demoCurrentTemp] = useState(21);
  const [demoTargetTemp, setDemoTargetTemp] = useState(23);
  const [demoMode, setDemoMode] = useState<ACMode>('off');
  const [demoFanMode, setDemoFanMode] = useState<FanMode>('low');
  const [demoSwingMode, setDemoSwingMode] = useState<SwingMode>('off');
  const [demoPresetMode, setDemoPresetMode] = useState<PresetMode>('none');

  const effectiveCurrentTemp = isDemo ? demoCurrentTemp : (currentTemp ?? 0);
  const effectiveTargetTemp = isDemo ? demoTargetTemp : (targetTemp ?? 23);
  const effectiveMode = isDemo ? demoMode : (mode ?? 'off');
  const effectiveFanMode = isDemo ? demoFanMode : (fanMode ?? 'low');
  const effectiveSwingMode = isDemo ? demoSwingMode : (swingMode ?? 'off');
  const effectivePresetMode = isDemo ? demoPresetMode : (presetMode ?? 'none');

  const isACOn = effectiveMode !== 'off';
  const modeColor = getModeColor(effectiveMode);

  // Menu modal state
  const [menuVisible, setMenuVisible] = useState(false);
  const [activeSection, setActiveSection] = useState<
    'menu' | 'rename' | 'serial' | 'mac' | 'logs' | 'fan' | 'swing' | 'preset' | null
  >(null);
  const [newName, setNewName] = useState(name);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Temperature control
  const handleTempUp = useCallback(() => {
    if (isDemo) {
      setDemoTargetTemp(prev => Math.min(TEMP_MAX, prev + 1));
      return;
    }
    if (onAction) onAction(serialNumber, { action: 'set_temperature', value: Math.min(TEMP_MAX, effectiveTargetTemp + 1) });
  }, [isDemo, onAction, serialNumber, effectiveTargetTemp]);

  const handleTempDown = useCallback(() => {
    if (isDemo) {
      setDemoTargetTemp(prev => Math.max(TEMP_MIN, prev - 1));
      return;
    }
    if (onAction) onAction(serialNumber, { action: 'set_temperature', value: Math.max(TEMP_MIN, effectiveTargetTemp - 1) });
  }, [isDemo, onAction, serialNumber, effectiveTargetTemp]);

  // Long press for continuous temp change
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startHold = useCallback((direction: 'up' | 'down') => {
    const step = direction === 'up' ? 1 : -1;
    holdIntervalRef.current = setInterval(() => {
      if (isDemo) {
        setDemoTargetTemp(prev => Math.max(TEMP_MIN, Math.min(TEMP_MAX, prev + step)));
      }
    }, 200);
  }, [isDemo]);

  const stopHold = useCallback(() => {
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  }, []);

  // Mode change (from bottom bar)
  const handleModeChange = useCallback((newMode: ACMode) => {
    if (isDemo) {
      setDemoMode(newMode);
      return;
    }
    if (onAction) onAction(serialNumber, { action: 'set_mode', value: newMode });
  }, [isDemo, onAction, serialNumber]);

  // Fan mode change
  const handleFanModeChange = useCallback((newFanMode: FanMode) => {
    if (isDemo) {
      setDemoFanMode(newFanMode);
      return;
    }
    if (onAction) onAction(serialNumber, { action: 'set_fan_mode', value: newFanMode });
  }, [isDemo, onAction, serialNumber]);

  // Swing mode change
  const handleSwingModeChange = useCallback((newSwingMode: SwingMode) => {
    if (isDemo) {
      setDemoSwingMode(newSwingMode);
      return;
    }
    if (onAction) onAction(serialNumber, { action: 'set_swing_mode', value: newSwingMode });
  }, [isDemo, onAction, serialNumber]);

  // Preset mode change
  const handlePresetModeChange = useCallback((newPresetMode: PresetMode) => {
    if (isDemo) {
      setDemoPresetMode(newPresetMode);
      return;
    }
    if (onAction) onAction(serialNumber, { action: 'set_preset_mode', value: newPresetMode });
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

  // Arc calculations
  const knobAngle = useMemo(() => tempToAngle(effectiveTargetTemp), [effectiveTargetTemp]);
  const knobPos = useMemo(() => getPointOnArc(knobAngle), [knobAngle]);
  const minDotPos = useMemo(() => getPointOnArc(ARC_END_ANGLE - 3), []);

  // Arc dots for the background track
  const arcTrackDots = useMemo(() => generateArcDots(ARC_START_ANGLE, ARC_END_ANGLE, 80), []);
  // Arc dots for the active portion (up to knob)
  const arcActiveDots = useMemo(
    () => generateArcDots(ARC_START_ANGLE, knobAngle, Math.round(80 * ((knobAngle - ARC_START_ANGLE) / ARC_SWEEP))),
    [knobAngle]
  );

  // Current option labels
  const currentModeOption = MODE_OPTIONS.find(o => o.value === effectiveMode) || MODE_OPTIONS[5];
  const currentFanOption = FAN_OPTIONS.find(o => o.value === effectiveFanMode) || FAN_OPTIONS[0];
  const currentSwingOption = SWING_OPTIONS.find(o => o.value === effectiveSwingMode) || SWING_OPTIONS[0];
  const currentPresetOption = PRESET_OPTIONS.find(o => o.value === effectivePresetMode) || PRESET_OPTIONS[3];

  // ======================================
  // Selector List (for fan/swing/preset in menu)
  // ======================================
  const renderSelectorList = (
    title: string,
    options: { value: string; label: string; icon: string }[],
    currentValue: string,
    onSelect: (val: any) => void,
  ) => (
    <View style={styles.modalContent}>
      <TouchableOpacity onPress={() => setActiveSection('menu')} style={styles.backBtn}>
        <MaterialCommunityIcons name="arrow-left" size={22} color="#333" />
        <Text style={styles.backBtnText}>Back</Text>
      </TouchableOpacity>
      <Text style={styles.modalTitle}>{title}</Text>
      {options.map((opt) => {
        const isSelected = opt.value === currentValue;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[styles.selectorItem, isSelected && { backgroundColor: `${brandColor}15` }]}
            onPress={() => {
              onSelect(opt.value);
              setActiveSection('menu');
            }}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name={opt.icon as any}
              size={22}
              color={isSelected ? brandColor : '#6B7280'}
              style={{ marginRight: 14 }}
            />
            <Text style={[styles.selectorItemText, isSelected && { color: brandColor, fontWeight: '700' }]}>
              {opt.label}
            </Text>
            {isSelected && <MaterialCommunityIcons name="check" size={20} color={brandColor} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // ======================================
  // Menu Modal Content
  // ======================================
  const renderModalContent = () => {
    switch (activeSection) {
      case 'menu':
        return (
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{name}</Text>
            {/* AC Controls */}
            <TouchableOpacity style={styles.menuItem} onPress={() => setActiveSection('fan')}>
              <MaterialCommunityIcons name="fan" size={22} color="#333" />
              <Text style={styles.menuItemText}>Fan Mode</Text>
              <Text style={styles.menuItemValue}>{currentFanOption.label}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => setActiveSection('preset')}>
              <MaterialCommunityIcons name="tune-variant" size={22} color="#333" />
              <Text style={styles.menuItemText}>Preset</Text>
              <Text style={styles.menuItemValue}>{currentPresetOption.label}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => setActiveSection('swing')}>
              <MaterialCommunityIcons name="swap-vertical-bold" size={22} color="#333" />
              <Text style={styles.menuItemText}>Swing Mode</Text>
              <Text style={styles.menuItemValue}>{currentSwingOption.label}</Text>
            </TouchableOpacity>
            {/* Divider */}
            <View style={styles.menuDivider} />
            {/* Device Info */}
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

      case 'fan':
        return renderSelectorList('Fan Mode', FAN_OPTIONS, effectiveFanMode, handleFanModeChange);
      case 'swing':
        return renderSelectorList('Swing Mode', SWING_OPTIONS, effectiveSwingMode, handleSwingModeChange);
      case 'preset':
        return renderSelectorList('Preset', PRESET_OPTIONS, effectivePresetMode, handlePresetModeChange);

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
          {isOnline ? 'ONLINE' : 'OFFLINE'}
        </Text>
      </View>

      {/* Header */}
      <View style={styles.header}>
        <MaterialCommunityIcons
          name="air-conditioner"
          size={28}
          color={isOnline ? modeColor : '#9CA3AF'}
          style={styles.headerIcon}
        />
        <Text style={[styles.headerName, { color: isOnline ? '#333' : '#9CA3AF' }]} numberOfLines={1}>
          {name}
        </Text>
      </View>

      {isOnline ? (
        <>
          {/* Arc Dial */}
          <View style={styles.arcContainer}>
            <View style={{ width: ARC_SIZE, height: ARC_SIZE }}>
              {/* Background arc track */}
              {arcTrackDots.map((dot, i) => (
                <View
                  key={`track-${i}`}
                  style={[
                    styles.arcDot,
                    {
                      left: dot.x - 2,
                      top: dot.y - 2,
                      width: 4,
                      height: 4,
                      backgroundColor: '#E0E0E0',
                    },
                  ]}
                />
              ))}

              {/* Active arc (colored) */}
              {isACOn && arcActiveDots.map((dot, i) => (
                <View
                  key={`active-${i}`}
                  style={[
                    styles.arcDot,
                    {
                      left: dot.x - 2.5,
                      top: dot.y - 2.5,
                      width: 5,
                      height: 5,
                      backgroundColor: modeColor,
                    },
                  ]}
                />
              ))}

              {/* Min marker dot */}
              <View
                style={[
                  styles.arcDot,
                  {
                    left: minDotPos.x - 4,
                    top: minDotPos.y - 4,
                    width: 8,
                    height: 8,
                    backgroundColor: '#BCBCBC',
                  },
                ]}
              />

              {/* Knob */}
              <View
                style={[
                  styles.knob,
                  {
                    left: knobPos.x - 10,
                    top: knobPos.y - 10,
                    borderColor: isACOn ? modeColor : '#CCC',
                  },
                ]}
              />

              {/* Center content */}
              <View style={styles.arcCenterContent}>
                <Text style={[styles.modeLabel, { color: isACOn ? modeColor : '#9CA3AF' }]}>
                  {currentModeOption.label}
                </Text>
                <View style={styles.tempRow}>
                  <Text style={styles.tempBig}>{effectiveTargetTemp}</Text>
                  <Text style={styles.tempDegree}>°C</Text>
                </View>
                <View style={styles.currentTempRow}>
                  <MaterialCommunityIcons name="thermometer" size={14} color="#9CA3AF" />
                  <Text style={styles.currentTempText}>{effectiveCurrentTemp} °C</Text>
                </View>
              </View>
            </View>
          </View>

          {/* +/- Buttons */}
          <View style={styles.tempBtnsRow}>
            <TouchableOpacity
              style={styles.roundBtn}
              onPress={handleTempDown}
              onLongPress={() => startHold('down')}
              onPressOut={stopHold}
              delayLongPress={300}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="minus" size={20} color="#6B7280" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.roundBtn}
              onPress={handleTempUp}
              onLongPress={() => startHold('up')}
              onPressOut={stopHold}
              delayLongPress={300}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="plus" size={20} color="#6B7280" />
            </TouchableOpacity>
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
                    isSelected && styles.modeIconBtnActive,
                  ]}
                  onPress={() => handleModeChange(opt.value)}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons
                    name={opt.icon as any}
                    size={22}
                    color={isSelected ? modeColor : '#9CA3AF'}
                  />
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      ) : (
        <View style={styles.offlineContainer}>
          <MaterialCommunityIcons name="air-conditioner" size={48} color="#D1D5DB" />
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

export default memo(ACCard, (prevProps, nextProps) => {
  return (
    prevProps.serialNumber === nextProps.serialNumber &&
    prevProps.name === nextProps.name &&
    prevProps.isOnline === nextProps.isOnline &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.currentTemp === nextProps.currentTemp &&
    prevProps.targetTemp === nextProps.targetTemp &&
    prevProps.mode === nextProps.mode &&
    prevProps.fanMode === nextProps.fanMode &&
    prevProps.swingMode === nextProps.swingMode &&
    prevProps.presetMode === nextProps.presetMode &&
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 10,
    paddingHorizontal: 30,
  },
  headerIcon: {
    marginRight: 12,
  },
  headerName: {
    fontSize: 20,
    fontWeight: '700',
    flex: 1,
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
  // Arc
  arcContainer: {
    alignItems: 'center',
    marginVertical: 2,
  },
  arcDot: {
    position: 'absolute',
    borderRadius: 50,
  },
  knob: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  arcCenterContent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 0,
  },
  tempRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  tempBig: {
    fontSize: 40,
    fontWeight: '200',
    color: '#333333',
    lineHeight: 46,
  },
  tempDegree: {
    fontSize: 16,
    fontWeight: '400',
    color: '#333333',
    marginTop: 6,
  },
  currentTempRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  currentTempText: {
    fontSize: 12,
    color: '#9CA3AF',
    marginLeft: 3,
    fontWeight: '500',
  },
  // Temp buttons
  tempBtnsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginBottom: 12,
  },
  roundBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAFAFA',
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
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeIconBtnActive: {
    backgroundColor: '#E5E7EB',
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
  menuItemValue: {
    fontSize: 14,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 8,
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
  // Selector
  selectorItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 4,
  },
  selectorItemText: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
    flex: 1,
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
