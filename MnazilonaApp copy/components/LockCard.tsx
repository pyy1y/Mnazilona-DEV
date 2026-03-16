// components/LockCard.tsx

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
  Switch,
  Dimensions,
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

type LockState = 'locked' | 'unlocked';

type PasscodeType = 'timed' | 'one_time' | 'permanent' | 'custom' | 'recurring';
type AccessType = 'timed' | 'permanent' | 'recurring';
type CycleDay = 'weekday' | 'weekend' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

interface PasscodeEntry {
  id: string;
  name: string;
  code?: string;
  type: PasscodeType;
  startTime?: string;
  endTime?: string;
  createdAt: string;
}

interface FingerprintEntry {
  id: string;
  name: string;
  type: AccessType;
  startTime?: string;
  endTime?: string;
  createdAt: string;
}

interface CardEntry {
  id: string;
  name: string;
  type: AccessType;
  startTime?: string;
  endTime?: string;
  createdAt: string;
}

interface LockCardProps {
  name: string;
  serialNumber: string;
  macAddress?: string;
  isOnline: boolean;
  isLoading: boolean;
  lockState?: LockState | null;
  batteryLevel?: number | null;
  onAction?: (serialNumber: string, command: { action: string; value?: any }) => void;
  onRename?: (serialNumber: string, newName: string) => void;
  onFetchLogs?: (serialNumber: string) => Promise<LogEntry[]>;
  brandColor: string;
  isDemo?: boolean;
  onlineText?: string;
  offlineText?: string;
}

// ======================================
// Constants
// ======================================
const LOCK_COLOR = '#3478F6';
const LOCK_RING_SIZE = 180;

const FEATURE_ITEMS = [
  { key: 'passcodes', label: 'Passcodes', icon: 'dialpad' },
  { key: 'cards', label: 'Cards', icon: 'card-account-details-outline' },
  { key: 'fingerprints', label: 'Fingerprints', icon: 'fingerprint' },
  { key: 'records', label: 'Records', icon: 'history' },
] as const;

const PASSCODE_TABS: { value: PasscodeType; label: string }[] = [
  { value: 'timed', label: 'Timed' },
  { value: 'one_time', label: 'One-time' },
  { value: 'permanent', label: 'Permanent' },
  { value: 'custom', label: 'Custom' },
  { value: 'recurring', label: 'Recurring' },
];

const ACCESS_TABS: { value: AccessType; label: string }[] = [
  { value: 'timed', label: 'Timed' },
  { value: 'permanent', label: 'Permanent' },
  { value: 'recurring', label: 'Recurring' },
];

const CYCLE_OPTIONS: { value: CycleDay; label: string }[] = [
  { value: 'weekday', label: 'Weekday' },
  { value: 'weekend', label: 'Weekend' },
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
  { value: 'sunday', label: 'Sunday' },
];

// ======================================
// Component
// ======================================
function LockCard({
  name,
  serialNumber,
  macAddress,
  isOnline,
  isLoading,
  lockState,
  batteryLevel,
  onAction,
  onRename,
  onFetchLogs,
  brandColor,
  isDemo = false,
  onlineText = 'ONLINE',
  offlineText = 'OFFLINE',
}: LockCardProps) {
  // Demo state
  const [demoLockState, setDemoLockState] = useState<LockState>('locked');
  const [demoBattery, setDemoBattery] = useState(100);

  const effectiveLockState = isDemo ? demoLockState : (lockState ?? 'locked');
  const effectiveBattery = isDemo ? demoBattery : (batteryLevel ?? null);
  const isLocked = effectiveLockState === 'locked';

  // Modal state
  const [menuVisible, setMenuVisible] = useState(false);
  const [activeSection, setActiveSection] = useState<
    'menu' | 'rename' | 'serial' | 'mac' | 'logs' |
    'passcodes' | 'passcode_add' |
    'cards' | 'card_add' |
    'fingerprints' | 'fingerprint_add' |
    'records' | null
  >(null);
  const [newName, setNewName] = useState(name);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Passcode form state
  const [passcodeTab, setPasscodeTab] = useState<PasscodeType>('timed');
  const [passcodeName, setPasscodeName] = useState('');
  const [passcodeValue, setPasscodeValue] = useState('');
  const [passcodePermanent, setPasscodePermanent] = useState(false);
  const [passcodeStartTime, setPasscodeStartTime] = useState('');
  const [passcodeEndTime, setPasscodeEndTime] = useState('');
  const [passcodeCycle, setPasscodeCycle] = useState<CycleDay>('weekend');

  // Fingerprint form state
  const [fingerprintTab, setFingerprintTab] = useState<AccessType>('timed');
  const [fingerprintName, setFingerprintName] = useState('');
  const [fingerprintStartTime, setFingerprintStartTime] = useState('');
  const [fingerprintEndTime, setFingerprintEndTime] = useState('');

  // Card form state
  const [cardTab, setCardTab] = useState<AccessType>('timed');
  const [cardName, setCardName] = useState('');
  const [cardStartTime, setCardStartTime] = useState('');
  const [cardEndTime, setCardEndTime] = useState('');

  // Demo data lists
  const [passcodes, setPasscodes] = useState<PasscodeEntry[]>([]);
  const [fingerprints, setFingerprints] = useState<FingerprintEntry[]>([]);
  const [cards, setCards] = useState<CardEntry[]>([]);

  // Lock/Unlock
  const handleToggleLock = useCallback(() => {
    if (isDemo) {
      setDemoLockState(prev => prev === 'locked' ? 'unlocked' : 'locked');
      return;
    }
    const action = effectiveLockState === 'locked' ? 'unlock' : 'lock';
    if (onAction) onAction(serialNumber, { action, value: action });
  }, [isDemo, onAction, serialNumber, effectiveLockState]);

  // Long press to lock
  const handleLongPress = useCallback(() => {
    if (isDemo) {
      setDemoLockState('locked');
      return;
    }
    if (onAction) onAction(serialNumber, { action: 'lock', value: 'lock' });
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

  // Logs
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

  // Feature handlers
  const openFeature = useCallback((feature: string) => {
    setMenuVisible(true);
    setActiveSection(feature as any);
  }, []);

  // Passcode generation
  const handleGeneratePasscode = useCallback(() => {
    const now = new Date().toISOString();
    const newPasscode: PasscodeEntry = {
      id: Date.now().toString(),
      name: passcodeName || `Passcode ${passcodes.length + 1}`,
      code: passcodeTab === 'custom' ? passcodeValue : Math.floor(100000 + Math.random() * 900000).toString(),
      type: passcodeTab,
      startTime: passcodeStartTime || now,
      endTime: passcodeEndTime || now,
      createdAt: now,
    };
    setPasscodes(prev => [newPasscode, ...prev]);

    if (!isDemo && onAction) {
      onAction(serialNumber, {
        action: 'add_passcode',
        value: {
          name: newPasscode.name,
          code: newPasscode.code,
          type: passcodeTab,
          startTime: passcodeStartTime,
          endTime: passcodeEndTime,
          cycle: passcodeTab === 'recurring' ? passcodeCycle : undefined,
        },
      });
    }

    Alert.alert('Passcode Generated', `Code: ${newPasscode.code}`);
    setPasscodeName('');
    setPasscodeValue('');
    setActiveSection('passcodes');
  }, [passcodeName, passcodeTab, passcodeValue, passcodeStartTime, passcodeEndTime, passcodeCycle, passcodes.length, isDemo, onAction, serialNumber]);

  // Fingerprint add
  const handleAddFingerprint = useCallback(() => {
    const now = new Date().toISOString();
    const newFp: FingerprintEntry = {
      id: Date.now().toString(),
      name: fingerprintName || `Fingerprint ${fingerprints.length + 1}`,
      type: fingerprintTab,
      startTime: fingerprintStartTime || now,
      endTime: fingerprintEndTime || now,
      createdAt: now,
    };
    setFingerprints(prev => [newFp, ...prev]);

    if (!isDemo && onAction) {
      onAction(serialNumber, {
        action: 'add_fingerprint',
        value: { name: newFp.name, type: fingerprintTab, startTime: fingerprintStartTime, endTime: fingerprintEndTime },
      });
    }

    Alert.alert('Fingerprint Added', `"${newFp.name}" has been registered.`);
    setFingerprintName('');
    setActiveSection('fingerprints');
  }, [fingerprintName, fingerprintTab, fingerprintStartTime, fingerprintEndTime, fingerprints.length, isDemo, onAction, serialNumber]);

  // Card add
  const handleAddCard = useCallback(() => {
    const now = new Date().toISOString();
    const newCard: CardEntry = {
      id: Date.now().toString(),
      name: cardName || `Card ${cards.length + 1}`,
      type: cardTab,
      startTime: cardStartTime || now,
      endTime: cardEndTime || now,
      createdAt: now,
    };
    setCards(prev => [newCard, ...prev]);

    if (!isDemo && onAction) {
      onAction(serialNumber, {
        action: 'add_card',
        value: { name: newCard.name, type: cardTab, startTime: cardStartTime, endTime: cardEndTime },
      });
    }

    Alert.alert('Card Added', `"${newCard.name}" has been registered.`);
    setCardName('');
    setActiveSection('cards');
  }, [cardName, cardTab, cardStartTime, cardEndTime, cards.length, isDemo, onAction, serialNumber]);

  // Initialize times
  const getNowString = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const resetPasscodeForm = useCallback(() => {
    const now = getNowString();
    setPasscodeName('');
    setPasscodeValue('');
    setPasscodeStartTime(now);
    setPasscodeEndTime(now);
    setPasscodePermanent(false);
    setPasscodeCycle('weekend');
  }, []);

  const resetFingerprintForm = useCallback(() => {
    const now = getNowString();
    setFingerprintName('');
    setFingerprintStartTime(now);
    setFingerprintEndTime(now);
  }, []);

  const resetCardForm = useCallback(() => {
    const now = getNowString();
    setCardName('');
    setCardStartTime(now);
    setCardEndTime(now);
  }, []);

  // ======================================
  // Tab Bar Component
  // ======================================
  const renderTabBar = (
    tabs: { value: string; label: string }[],
    activeTab: string,
    onSelect: (val: any) => void,
  ) => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tabBarScroll}
      contentContainerStyle={styles.tabBarContent}
    >
      {tabs.map((tab) => {
        const isActive = tab.value === activeTab;
        return (
          <TouchableOpacity
            key={tab.value}
            style={[styles.tabItem, isActive && styles.tabItemActive]}
            onPress={() => onSelect(tab.value)}
          >
            <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  // ======================================
  // Form Field
  // ======================================
  const renderFormField = (label: string, value: string, placeholder: string, onChangeText?: (text: string) => void) => (
    <View style={styles.formField}>
      <Text style={styles.formLabel}>{label}</Text>
      {onChangeText ? (
        <TextInput
          style={styles.formValue}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#666"
        />
      ) : (
        <Text style={styles.formValueText}>{value || placeholder}</Text>
      )}
    </View>
  );

  // ======================================
  // Modal Content
  // ======================================
  const renderModalContent = () => {
    switch (activeSection) {
      // ---- Main Menu ----
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

      // ---- Passcodes List ----
      case 'passcodes':
        return (
          <View style={styles.modalContent}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Passcodes</Text>
              <TouchableOpacity onPress={() => { resetPasscodeForm(); setActiveSection('passcode_add'); }}>
                <Text style={[styles.addBtnText, { color: LOCK_COLOR }]}>+ Generate</Text>
              </TouchableOpacity>
            </View>
            {passcodes.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="file-document-outline" size={48} color="#D1D5DB" />
                <Text style={styles.emptyText}>No Data</Text>
              </View>
            ) : (
              <ScrollView style={styles.listScroll} showsVerticalScrollIndicator={false}>
                {passcodes.map((pc) => (
                  <View key={pc.id} style={styles.listItem}>
                    <View style={styles.listItemLeft}>
                      <MaterialCommunityIcons name="dialpad" size={20} color={LOCK_COLOR} />
                      <View style={{ marginLeft: 12 }}>
                        <Text style={styles.listItemName}>{pc.name}</Text>
                        <Text style={styles.listItemSub}>{pc.type} | {pc.code}</Text>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => {
                      setPasscodes(prev => prev.filter(p => p.id !== pc.id));
                      if (!isDemo && onAction) {
                        onAction(serialNumber, { action: 'remove_passcode', value: { id: pc.id } });
                      }
                    }}>
                      <MaterialCommunityIcons name="delete-outline" size={20} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
              <Text style={styles.cancelBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        );

      // ---- Add Passcode ----
      case 'passcode_add':
        return (
          <View style={styles.modalContent}>
            <TouchableOpacity onPress={() => setActiveSection('passcodes')} style={styles.backBtn}>
              <MaterialCommunityIcons name="arrow-left" size={22} color="#333" />
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Generate Passcode</Text>

            {renderTabBar(PASSCODE_TABS, passcodeTab, setPasscodeTab)}

            <View style={styles.formSection}>
              {/* Timed */}
              {passcodeTab === 'timed' && (
                <>
                  {renderFormField('Start Time', passcodeStartTime, 'Select start time')}
                  {renderFormField('End Time', passcodeEndTime, 'Select end time')}
                  {renderFormField('Name', passcodeName, 'Enter a name for this Passcode', setPasscodeName)}
                  <Text style={styles.hintText}>
                    The passcode can be used for unlimited times within the validity period.{'\n'}
                    This passcode MUST BE used at least ONCE within 24 Hours after Start Time, or it will be SUSPENDED for Security Reasons.
                  </Text>
                </>
              )}

              {/* One-time */}
              {passcodeTab === 'one_time' && (
                <>
                  {renderFormField('Name', passcodeName, 'Enter a name for this Passcode', setPasscodeName)}
                  <Text style={styles.hintText}>
                    This Passcode MUST be used within 6 Hours from the Current Time or it will be SUSPENDED for Security Reasons. This Passcode can ONLY be used ONCE.
                  </Text>
                </>
              )}

              {/* Permanent */}
              {passcodeTab === 'permanent' && (
                <>
                  {renderFormField('Name', passcodeName, 'Enter a name for this Passcode', setPasscodeName)}
                  <Text style={styles.hintText}>
                    This Passcode MUST BE used at least Once, within 24 Hours from Current Time, or it will be SUSPENDED for Security Reasons.
                  </Text>
                </>
              )}

              {/* Custom */}
              {passcodeTab === 'custom' && (
                <>
                  <View style={styles.formField}>
                    <Text style={styles.formLabel}>Permanent</Text>
                    <Switch
                      value={passcodePermanent}
                      onValueChange={setPasscodePermanent}
                      trackColor={{ false: '#E5E7EB', true: LOCK_COLOR }}
                      thumbColor="#FFFFFF"
                    />
                  </View>
                  {renderFormField('Name', passcodeName, 'Enter a name for this Passcode', setPasscodeName)}
                  {renderFormField('Passcode', passcodeValue, '4 - 9 Digits in length', setPasscodeValue)}
                  <Text style={styles.hintText}>
                    You can configure the customized passcode via Bluetooth or remotely via network.
                  </Text>
                </>
              )}

              {/* Recurring */}
              {passcodeTab === 'recurring' && (
                <>
                  <View style={styles.formField}>
                    <Text style={styles.formLabel}>Cycle on</Text>
                    <TouchableOpacity style={styles.cycleSelector}>
                      <Text style={styles.formValueText}>{CYCLE_OPTIONS.find(c => c.value === passcodeCycle)?.label}</Text>
                    </TouchableOpacity>
                  </View>
                  {renderFormField('Start Time', passcodeStartTime.split(' ')[1] || '04:00', 'Start time')}
                  {renderFormField('End Time', passcodeEndTime.split(' ')[1] || '05:00', 'End time')}
                  {renderFormField('Name', passcodeName, 'Enter a name for this Passcode', setPasscodeName)}
                  <Text style={styles.hintText}>
                    This Passcode MUST BE used at least Once, within 24 Hours, after the Start Date and Time or it will be SUSPENDED for Security Reasons.
                  </Text>
                </>
              )}
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: LOCK_COLOR }]}
              onPress={handleGeneratePasscode}
            >
              <Text style={styles.primaryBtnText}>
                {passcodeTab === 'custom' ? 'Set Passcode' : 'Generate Passcode'}
              </Text>
            </TouchableOpacity>
          </View>
        );

      // ---- Fingerprints List ----
      case 'fingerprints':
        return (
          <View style={styles.modalContent}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Fingerprints</Text>
              <TouchableOpacity onPress={() => { resetFingerprintForm(); setActiveSection('fingerprint_add'); }}>
                <Text style={[styles.addBtnText, { color: LOCK_COLOR }]}>+ Add</Text>
              </TouchableOpacity>
            </View>
            {fingerprints.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="fingerprint" size={48} color="#D1D5DB" />
                <Text style={styles.emptyText}>No Data</Text>
              </View>
            ) : (
              <ScrollView style={styles.listScroll} showsVerticalScrollIndicator={false}>
                {fingerprints.map((fp) => (
                  <View key={fp.id} style={styles.listItem}>
                    <View style={styles.listItemLeft}>
                      <MaterialCommunityIcons name="fingerprint" size={20} color={LOCK_COLOR} />
                      <View style={{ marginLeft: 12 }}>
                        <Text style={styles.listItemName}>{fp.name}</Text>
                        <Text style={styles.listItemSub}>{fp.type}</Text>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => {
                      setFingerprints(prev => prev.filter(f => f.id !== fp.id));
                      if (!isDemo && onAction) {
                        onAction(serialNumber, { action: 'remove_fingerprint', value: { id: fp.id } });
                      }
                    }}>
                      <MaterialCommunityIcons name="delete-outline" size={20} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
              <Text style={styles.cancelBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        );

      // ---- Add Fingerprint ----
      case 'fingerprint_add':
        return (
          <View style={styles.modalContent}>
            <TouchableOpacity onPress={() => setActiveSection('fingerprints')} style={styles.backBtn}>
              <MaterialCommunityIcons name="arrow-left" size={22} color="#333" />
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Add Fingerprint</Text>

            {renderTabBar(ACCESS_TABS, fingerprintTab, setFingerprintTab)}

            <View style={styles.formSection}>
              {renderFormField('Name', fingerprintName, 'Please enter here', setFingerprintName)}
              {fingerprintTab !== 'permanent' && (
                <>
                  {renderFormField('Start Time', fingerprintStartTime, 'Select start time')}
                  {renderFormField('End Time', fingerprintEndTime, 'Select end time')}
                </>
              )}
              <Text style={styles.hintText}>
                {fingerprintTab === 'permanent'
                  ? 'The Fingerprint can be used for unlimited times.'
                  : 'The Fingerprint can be used for unlimited times within the validity period.'}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: LOCK_COLOR }]}
              onPress={handleAddFingerprint}
            >
              <Text style={styles.primaryBtnText}>Next</Text>
            </TouchableOpacity>

            {fingerprintTab === 'timed' && (
              <TouchableOpacity style={styles.forcedLink}>
                <Text style={[styles.forcedLinkText, { color: LOCK_COLOR }]}>Forced fingerprint</Text>
              </TouchableOpacity>
            )}
          </View>
        );

      // ---- Cards List ----
      case 'cards':
        return (
          <View style={styles.modalContent}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Cards</Text>
              <TouchableOpacity onPress={() => { resetCardForm(); setActiveSection('card_add'); }}>
                <Text style={[styles.addBtnText, { color: LOCK_COLOR }]}>+ Add</Text>
              </TouchableOpacity>
            </View>
            {cards.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="card-account-details-outline" size={48} color="#D1D5DB" />
                <Text style={styles.emptyText}>No Data</Text>
              </View>
            ) : (
              <ScrollView style={styles.listScroll} showsVerticalScrollIndicator={false}>
                {cards.map((card) => (
                  <View key={card.id} style={styles.listItem}>
                    <View style={styles.listItemLeft}>
                      <MaterialCommunityIcons name="card-account-details-outline" size={20} color={LOCK_COLOR} />
                      <View style={{ marginLeft: 12 }}>
                        <Text style={styles.listItemName}>{card.name}</Text>
                        <Text style={styles.listItemSub}>{card.type}</Text>
                      </View>
                    </View>
                    <TouchableOpacity onPress={() => {
                      setCards(prev => prev.filter(c => c.id !== card.id));
                      if (!isDemo && onAction) {
                        onAction(serialNumber, { action: 'remove_card', value: { id: card.id } });
                      }
                    }}>
                      <MaterialCommunityIcons name="delete-outline" size={20} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
              <Text style={styles.cancelBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        );

      // ---- Add Card ----
      case 'card_add':
        return (
          <View style={styles.modalContent}>
            <TouchableOpacity onPress={() => setActiveSection('cards')} style={styles.backBtn}>
              <MaterialCommunityIcons name="arrow-left" size={22} color="#333" />
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Add Card</Text>

            {renderTabBar(ACCESS_TABS, cardTab, setCardTab)}

            <View style={styles.formSection}>
              {renderFormField('Name', cardName, 'Please enter here', setCardName)}
              {cardTab !== 'permanent' && (
                <>
                  {renderFormField('Start Time', cardStartTime, 'Select start time')}
                  {renderFormField('End Time', cardEndTime, 'Select end time')}
                </>
              )}
              <Text style={styles.hintText}>
                {cardTab === 'permanent'
                  ? 'The Card can be used for unlimited times.'
                  : 'The Card can be used for unlimited times within the validity period.'}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: LOCK_COLOR }]}
              onPress={handleAddCard}
            >
              <Text style={styles.primaryBtnText}>Next</Text>
            </TouchableOpacity>
          </View>
        );

      // ---- Records ----
      case 'records':
        return (
          <View style={styles.logsModalContent}>
            <View style={styles.logsHeader}>
              <Text style={styles.modalTitle}>Records</Text>
            </View>
            {logsLoading ? (
              <ActivityIndicator size="small" color="#999" style={{ marginTop: 20 }} />
            ) : logs.length === 0 ? (
              <Text style={styles.emptyLogs}>No records available.</Text>
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
            <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
              <Text style={styles.cancelBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        );

      // ---- Standard sections ----
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
          {/* Header with name and battery */}
          <View style={styles.header}>
            <Text style={styles.headerName} numberOfLines={1}>{name}</Text>
            {effectiveBattery !== null && (
              <View style={styles.batteryRow}>
                <MaterialCommunityIcons
                  name={effectiveBattery > 80 ? 'battery' : effectiveBattery > 40 ? 'battery-50' : 'battery-20'}
                  size={18}
                  color={effectiveBattery > 20 ? '#22C55E' : '#EF4444'}
                />
                <Text style={styles.batteryText}>{effectiveBattery}%</Text>
              </View>
            )}
          </View>

          {/* Lock Circle */}
          <View style={styles.lockContainer}>
            <TouchableOpacity
              style={styles.lockRingOuter}
              onPress={handleToggleLock}
              onLongPress={handleLongPress}
              delayLongPress={500}
              activeOpacity={0.8}
            >
              <View style={[styles.lockRingInner, { borderColor: isLocked ? LOCK_COLOR : '#22C55E' }]}>
                <View style={[styles.lockCircle, { backgroundColor: isLocked ? `${LOCK_COLOR}15` : '#22C55E15' }]}>
                  <MaterialCommunityIcons
                    name={isLocked ? 'lock' : 'lock-open-variant'}
                    size={48}
                    color={isLocked ? LOCK_COLOR : '#22C55E'}
                  />
                </View>
              </View>
            </TouchableOpacity>
            <Text style={styles.lockHint}>
              {isLocked ? 'Touch to Unlock, Hold to Lock' : 'Unlocked - Touch to Lock'}
            </Text>
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Feature Grid */}
          <View style={styles.featureGrid}>
            {FEATURE_ITEMS.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={styles.featureItem}
                onPress={() => {
                  if (item.key === 'records') {
                    handleOpenLogs();
                    setMenuVisible(true);
                    setActiveSection('records');
                  } else {
                    openFeature(item.key);
                  }
                }}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name={item.icon as any}
                  size={26}
                  color={LOCK_COLOR}
                />
                <Text style={styles.featureLabel}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : (
        <View style={styles.offlineContainer}>
          <MaterialCommunityIcons name="lock-off" size={48} color="#D1D5DB" />
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
              <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
                {renderModalContent()}
              </ScrollView>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

export default memo(LockCard, (prevProps, nextProps) => {
  return (
    prevProps.serialNumber === nextProps.serialNumber &&
    prevProps.name === nextProps.name &&
    prevProps.isOnline === nextProps.isOnline &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.lockState === nextProps.lockState &&
    prevProps.batteryLevel === nextProps.batteryLevel &&
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
  // Header
  header: {
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 8,
    paddingHorizontal: 30,
  },
  headerName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  batteryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  batteryText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  // Lock
  lockContainer: {
    alignItems: 'center',
    marginVertical: 12,
  },
  lockRingOuter: {
    width: LOCK_RING_SIZE,
    height: LOCK_RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockRingInner: {
    width: LOCK_RING_SIZE - 20,
    height: LOCK_RING_SIZE - 20,
    borderRadius: (LOCK_RING_SIZE - 20) / 2,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockCircle: {
    width: LOCK_RING_SIZE - 50,
    height: LOCK_RING_SIZE - 50,
    borderRadius: (LOCK_RING_SIZE - 50) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockHint: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 8,
    fontWeight: '500',
  },
  // Divider
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 8,
    marginVertical: 12,
  },
  // Feature Grid
  featureGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
  },
  featureItem: {
    alignItems: 'center',
    gap: 6,
    width: 70,
  },
  featureLabel: {
    fontSize: 11,
    color: '#333',
    fontWeight: '500',
    textAlign: 'center',
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
  // Tab Bar
  tabBarScroll: {
    marginBottom: 16,
  },
  tabBarContent: {
    gap: 8,
  },
  tabItem: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  tabItemActive: {
    borderBottomWidth: 2,
    borderBottomColor: LOCK_COLOR,
  },
  tabText: {
    fontSize: 14,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  tabTextActive: {
    color: LOCK_COLOR,
    fontWeight: '700',
  },
  // Form
  formSection: {
    marginBottom: 16,
  },
  formField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  formLabel: {
    fontSize: 15,
    color: '#333',
    fontWeight: '500',
  },
  formValue: {
    fontSize: 15,
    color: '#333',
    textAlign: 'right',
    flex: 1,
    marginLeft: 16,
  },
  formValueText: {
    fontSize: 15,
    color: '#6B7280',
  },
  cycleSelector: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hintText: {
    fontSize: 13,
    color: '#9CA3AF',
    lineHeight: 18,
    marginTop: 16,
  },
  // Primary Button
  primaryBtn: {
    borderRadius: 25,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  // Forced Link
  forcedLink: {
    alignItems: 'flex-end',
    marginTop: 20,
  },
  forcedLinkText: {
    fontSize: 14,
    fontWeight: '600',
  },
  // List
  listScroll: {
    maxHeight: 300,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  listItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  listItemName: {
    fontSize: 15,
    color: '#333',
    fontWeight: '600',
  },
  listItemSub: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  // Empty State
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 8,
  },
  // Modal Header Row
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  addBtnText: {
    fontSize: 15,
    fontWeight: '700',
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
