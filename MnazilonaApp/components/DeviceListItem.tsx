// components/DeviceListItem.tsx

import React, { memo, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import GarageCard, { LogEntry } from './GarageCard';
import LightCard from './LightCard';
import DimmerCard from './DimmerCard';
import WaterTankCard from './WaterTankCard';
import ACCard from './ACCard';
import SecurityCard from './SecurityCard';
import LockCard from './LockCard';

// ======================================
// Types
// ======================================
type DeviceCommand = {
  action: 'open' | 'close' | 'stop';
};

type Device = {
  _id?: string;
  id?: string;
  name?: string;
  serialNumber: string;
  macAddress?: string;
  isOnline: boolean;
  deviceType?: string;
  lastSeen?: string;
  role?: 'owner' | 'shared';
  permissions?: string[];
  sharedBy?: { id?: string; email?: string; name?: string } | null;
  state?: {
    doorState?: 'open' | 'closed';
    [key: string]: unknown;
  };
};

interface DeviceListItemProps {
  device: Device;
  actionLoading: string | null;
  onSendCommand: (serialNumber: string, command: DeviceCommand) => void;
  onRenameDevice?: (serialNumber: string, newName: string) => void;
  onFetchLogs?: (serialNumber: string) => Promise<LogEntry[]>;
  onSharePress?: (serialNumber: string, deviceName: string) => void;
  brandColor: string;
  roomName?: string;
  isLocal?: boolean;
}

// ======================================
// Helper Functions
// ======================================
const isGarageDevice = (device: Device): boolean => {
  if (device.deviceType === 'garage' || device.deviceType === 'relay') {
    return true;
  }
  const name = (device.name || '').toLowerCase();
  return (
    name.includes('garage') ||
    name.includes('كراج') ||
    name.includes('باب') ||
    name.includes('mnazilona') ||
    name.includes('door') ||
    name.includes('gate')
  );
};

const isLightDevice = (device: Device): boolean => {
  return device.deviceType === 'light' || device.deviceType === 'light-demo';
};

const isDimmerDevice = (device: Device): boolean => {
  return device.deviceType === 'dimmer' || device.deviceType === 'dimmer-demo';
};

const isWaterTankDevice = (device: Device): boolean => {
  return device.deviceType === 'water-tank';
};

const isACDevice = (device: Device): boolean => {
  return device.deviceType === 'ac';
};

const isSecurityDevice = (device: Device): boolean => {
  return device.deviceType === 'security';
};

const isLockDevice = (device: Device): boolean => {
  return device.deviceType === 'lock';
};

const getDeviceDisplayName = (device: Device): string => {
  if (device.name && device.name.trim()) {
    return device.name.trim();
  }
  if (device.deviceType === 'garage' || device.deviceType === 'relay') {
    return 'Garage Door';
  }
  return `Device ${device.serialNumber.slice(-4)}`;
};

// ======================================
// Room Label Component
// ======================================
const RoomLabel = ({ name }: { name: string }) => (
  <View style={styles.roomLabel}>
    <MaterialCommunityIcons name="map-marker-outline" size={12} color="#7A8CA5" />
    <Text style={styles.roomLabelText}>{name}</Text>
  </View>
);

// ======================================
// Connection Mode Badge
// ======================================
const ConnectionBadge = ({ isLocal }: { isLocal: boolean }) => (
  <View style={[styles.connectionBadge, isLocal ? styles.localBadge : styles.cloudBadge]}>
    <MaterialCommunityIcons
      name={isLocal ? 'wifi' : 'cloud-outline'}
      size={10}
      color={isLocal ? '#059669' : '#6B7280'}
    />
    <Text style={[styles.connectionBadgeText, isLocal ? styles.localBadgeText : styles.cloudBadgeText]}>
      {isLocal ? 'Local' : 'Cloud'}
    </Text>
  </View>
);

// ======================================
// Shared Badge — shows on cards for devices shared with this user
// ======================================
const SharedBadge = ({ ownerLabel }: { ownerLabel?: string }) => (
  <View style={[styles.connectionBadge, styles.sharedBadge]}>
    <MaterialCommunityIcons name="account-multiple" size={10} color="#7C3AED" />
    <Text style={[styles.connectionBadgeText, styles.sharedBadgeText]}>
      {ownerLabel ? `Shared by ${ownerLabel}` : 'Shared'}
    </Text>
  </View>
);

// ======================================
// Component
// ======================================
function DeviceListItem({
  device,
  actionLoading,
  onSendCommand,
  onRenameDevice,
  onFetchLogs,
  onSharePress,
  brandColor,
  roomName,
  isLocal = false,
}: DeviceListItemProps) {
  const displayName = useMemo(() => getDeviceDisplayName(device), [device]);
  const isGarage = useMemo(() => isGarageDevice(device), [device]);
  const isLight = useMemo(() => isLightDevice(device), [device]);
  const isDimmer = useMemo(() => isDimmerDevice(device), [device]);
  const isWaterTank = useMemo(() => isWaterTankDevice(device), [device]);
  const isAC = useMemo(() => isACDevice(device), [device]);
  const isSecurity = useMemo(() => isSecurityDevice(device), [device]);
  const isLock = useMemo(() => isLockDevice(device), [device]);

  const isShared = device.role === 'shared';

  // Owner-only actions: rename and share. Shared users get neither.
  const renameProp = isShared ? undefined : onRenameDevice;
  const sharePressHandler = useMemo(() => {
    if (isShared || !onSharePress) return undefined;
    return () => onSharePress(device.serialNumber, displayName);
  }, [isShared, onSharePress, device.serialNumber, displayName]);

  const isLoading = useMemo(() => {
    if (!actionLoading) return false;
    return actionLoading.startsWith(`${device.serialNumber}:`);
  }, [actionLoading, device.serialNumber]);

  const handleCommand = useCallback(
    (command: DeviceCommand) => {
      onSendCommand(device.serialNumber, command);
    },
    [onSendCommand, device.serialNumber]
  );

  // Determine which card to render
  let card: React.ReactNode = null;

  if (isLock) {
    card = (
      <LockCard
        name={displayName}
        serialNumber={device.serialNumber}
        macAddress={device.macAddress}
        isOnline={device.isOnline}
        isLoading={isLoading}
        lockState={(device.state?.lockState as 'locked' | 'unlocked') || null}
        batteryLevel={(device.state?.batteryLevel as number) || null}
        onAction={(_serial, cmd) => onSendCommand(device.serialNumber, { action: cmd.action as any })}
        onRename={renameProp}
        onSharePress={sharePressHandler}
        onFetchLogs={onFetchLogs}
        brandColor={brandColor}
        isDemo={true}
      />
    );
  } else if (isSecurity) {
    card = (
      <SecurityCard
        name={displayName}
        serialNumber={device.serialNumber}
        macAddress={device.macAddress}
        isOnline={device.isOnline}
        isLoading={isLoading}
        securityMode={(device.state?.securityMode as any) || null}
        onAction={(_serial, cmd) => onSendCommand(device.serialNumber, { action: cmd.action as any })}
        onRename={renameProp}
        onSharePress={sharePressHandler}
        onFetchLogs={onFetchLogs}
        brandColor={brandColor}
        isDemo={true}
      />
    );
  } else if (isDimmer) {
    card = (
      <DimmerCard
        name={displayName}
        serialNumber={device.serialNumber}
        macAddress={device.macAddress}
        isOnline={device.isOnline}
        isLoading={isLoading}
        lightState={(device.state?.lightState as 'on' | 'off') || null}
        brightness={(device.state?.brightness as number) || null}
        onAction={(_serial, cmd) => onSendCommand(device.serialNumber, { action: cmd.action as any })}
        onRename={renameProp}
        onSharePress={sharePressHandler}
        onFetchLogs={onFetchLogs}
        brandColor={brandColor}
        isDemo={true}
      />
    );
  } else if (isLight) {
    card = (
      <LightCard
        name={displayName}
        serialNumber={device.serialNumber}
        macAddress={device.macAddress}
        isOnline={device.isOnline}
        isLoading={isLoading}
        lightState={(device.state?.lightState as 'on' | 'off') || null}
        onAction={(_serial, cmd) => onSendCommand(device.serialNumber, { action: cmd.action as any })}
        onRename={renameProp}
        onSharePress={sharePressHandler}
        onFetchLogs={onFetchLogs}
        brandColor={brandColor}
        isDemo={true}
      />
    );
  } else if (isAC) {
    card = (
      <ACCard
        name={displayName}
        serialNumber={device.serialNumber}
        macAddress={device.macAddress}
        isOnline={device.isOnline}
        isLoading={isLoading}
        currentTemp={(device.state?.currentTemp as number) || null}
        targetTemp={(device.state?.targetTemp as number) || null}
        mode={(device.state?.mode as any) || null}
        fanMode={(device.state?.fanMode as any) || null}
        swingMode={(device.state?.swingMode as any) || null}
        presetMode={(device.state?.presetMode as any) || null}
        onAction={(_serial, cmd) => onSendCommand(device.serialNumber, { action: cmd.action as any })}
        onRename={renameProp}
        onSharePress={sharePressHandler}
        onFetchLogs={onFetchLogs}
        brandColor={brandColor}
        isDemo={true}
      />
    );
  } else if (isWaterTank) {
    card = (
      <WaterTankCard
        name={displayName}
        serialNumber={device.serialNumber}
        macAddress={device.macAddress}
        isOnline={device.isOnline}
        isLoading={isLoading}
        waterLevel={(device.state?.waterLevel as number) || null}
        onRename={renameProp}
        onSharePress={sharePressHandler}
        onFetchLogs={onFetchLogs}
        brandColor={brandColor}
        isDemo={true}
      />
    );
  } else if (isGarage) {
    card = (
      <GarageCard
        name={displayName}
        serialNumber={device.serialNumber}
        macAddress={device.macAddress}
        isOnline={device.isOnline}
        isLoading={isLoading}
        doorState={device.state?.doorState || null}
        onAction={(_serial, cmd) => handleCommand(cmd)}
        onRename={renameProp}
        onSharePress={sharePressHandler}
        onFetchLogs={onFetchLogs}
        brandColor={brandColor}
      />
    );
  } else {
    card = (
      <View style={styles.unknownCard}>
        <View style={styles.unknownHeader}>
          <View style={[styles.statusDot, device.isOnline ? styles.online : styles.offline]} />
          <Text style={styles.unknownTitle}>{displayName}</Text>
        </View>
        <Text style={styles.unknownSub}>
          {device.deviceType || 'Unknown Device Type'}
        </Text>
        <Text style={styles.serialText}>SN: {device.serialNumber}</Text>
      </View>
    );
  }

  const ownerLabel = device.sharedBy?.name || device.sharedBy?.email || undefined;

  return (
    <View>
      <View style={styles.metaRow}>
        <View style={styles.metaLeft}>
          {roomName ? <RoomLabel name={roomName} /> : null}
          {isShared ? <SharedBadge ownerLabel={ownerLabel} /> : null}
        </View>
        {device.isOnline ? <ConnectionBadge isLocal={isLocal} /> : null}
      </View>
      {card}
    </View>
  );
}

export default memo(DeviceListItem, (prevProps, nextProps) => {
  return (
    prevProps.device.serialNumber === nextProps.device.serialNumber &&
    prevProps.device.isOnline === nextProps.device.isOnline &&
    prevProps.device.name === nextProps.device.name &&
    prevProps.device.role === nextProps.device.role &&
    prevProps.device.state?.doorState === nextProps.device.state?.doorState &&
    prevProps.actionLoading === nextProps.actionLoading &&
    prevProps.brandColor === nextProps.brandColor &&
    prevProps.roomName === nextProps.roomName &&
    prevProps.isLocal === nextProps.isLocal &&
    prevProps.onSharePress === nextProps.onSharePress
  );
});

// ======================================
// Styles
// ======================================
const styles = StyleSheet.create({
  roomLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    marginLeft: 4,
    gap: 4,
  },
  roomLabelText: {
    fontSize: 12,
    color: '#7A8CA5',
    fontWeight: '600',
  },
  unknownCard: {
    padding: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  unknownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  online: {
    backgroundColor: '#34C759',
  },
  offline: {
    backgroundColor: '#C7C7CC',
  },
  unknownTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#333',
  },
  unknownSub: {
    fontSize: 14,
    color: '#888',
    marginBottom: 4,
  },
  serialText: {
    fontSize: 12,
    color: '#AAA',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    marginHorizontal: 4,
  },
  metaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    flexShrink: 1,
  },
  connectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 4,
  },
  localBadge: {
    backgroundColor: '#D1FAE5',
  },
  cloudBadge: {
    backgroundColor: '#F3F4F6',
  },
  connectionBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  localBadgeText: {
    color: '#059669',
  },
  cloudBadgeText: {
    color: '#6B7280',
  },
  sharedBadge: {
    backgroundColor: '#EDE9FE',
  },
  sharedBadgeText: {
    color: '#7C3AED',
  },
});
