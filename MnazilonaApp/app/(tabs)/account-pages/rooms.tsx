// app/(tabs)/account-pages/rooms.tsx

import React, { useCallback, useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { api, isAuthError } from '../../../utils/api';
import { useAuth } from '../../../hooks/useAuth';
import { ENDPOINTS } from '../../../constants/api';

const BRAND_COLOR = '#2E5B8E';

// ======================================
// Types
// ======================================
type Room = {
  _id: string;
  name: string;
  icon: string;
  deviceCount: number;
};

type Device = {
  _id?: string;
  serialNumber: string;
  name?: string;
  deviceType?: string;
  isOnline: boolean;
  room?: string | null;
};

// ======================================
// Icon options
// ======================================
const ICON_OPTIONS: { value: string; label: string; icon: string }[] = [
  { value: 'door', label: 'Room', icon: 'door' },
  { value: 'bed', label: 'Bedroom', icon: 'bed' },
  { value: 'sofa', label: 'Living Room', icon: 'sofa' },
  { value: 'silverware-fork-knife', label: 'Kitchen', icon: 'silverware-fork-knife' },
  { value: 'desk', label: 'Office', icon: 'desk' },
  { value: 'shower', label: 'Bathroom', icon: 'shower' },
  { value: 'garage', label: 'Garage', icon: 'garage' },
  { value: 'tree', label: 'Garden', icon: 'tree' },
  { value: 'pool', label: 'Pool', icon: 'pool' },
  { value: 'stairs', label: 'Stairs', icon: 'stairs' },
  { value: 'office-building', label: 'Building', icon: 'office-building' },
  { value: 'home-roof', label: 'Roof', icon: 'home-roof' },
];

// ======================================
// Component
// ======================================
export default function RoomsScreen() {
  const router = useRouter();
  const { handleAuthError } = useAuth();

  const [rooms, setRooms] = useState<Room[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [modalVisible, setModalVisible] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit' | 'assign'>('create');
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [roomName, setRoomName] = useState('');
  const [roomIcon, setRoomIcon] = useState('door');
  const [saving, setSaving] = useState(false);

  // Assign modal
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [assignRoom, setAssignRoom] = useState<Room | null>(null);

  // Room detail modal
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [detailRoom, setDetailRoom] = useState<Room | null>(null);
  const [roomDevices, setRoomDevices] = useState<Device[]>([]);
  const [roomDevicesLoading, setRoomDevicesLoading] = useState(false);

  // ==========================================
  // Load data
  // ==========================================
  const loadRooms = useCallback(async () => {
    try {
      const response = await api.get<any>(ENDPOINTS.ROOMS.LIST, { requireAuth: true });
      if (response.success && response.data?.rooms) {
        setRooms(response.data.rooms);
      } else if (isAuthError(response.status)) {
        await handleAuthError(response.status);
      }
    } catch {
      // silent
    }
  }, [handleAuthError]);

  const loadDevices = useCallback(async () => {
    try {
      const response = await api.get<any>(ENDPOINTS.DEVICES.LIST, { requireAuth: true });
      if (response.success) {
        const list = response.data?.devices || response.data || [];
        setDevices(Array.isArray(list) ? list : []);
      }
    } catch {
      // silent
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadRooms(), loadDevices()]);
    setLoading(false);
  }, [loadRooms, loadDevices]);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll])
  );

  // ==========================================
  // CRUD
  // ==========================================
  const openCreateModal = useCallback(() => {
    setRoomName('');
    setRoomIcon('door');
    setSelectedRoom(null);
    setModalMode('create');
    setModalVisible(true);
  }, []);

  const openEditModal = useCallback((room: Room) => {
    setRoomName(room.name);
    setRoomIcon(room.icon || 'door');
    setSelectedRoom(room);
    setModalMode('edit');
    setModalVisible(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setSelectedRoom(null);
    setRoomName('');
    setRoomIcon('door');
  }, []);

  const handleSave = useCallback(async () => {
    const trimmed = roomName.trim();
    if (!trimmed) {
      Alert.alert('Error', 'Room name is required.');
      return;
    }

    setSaving(true);
    try {
      if (modalMode === 'create') {
        const response = await api.post<any>(
          ENDPOINTS.ROOMS.CREATE,
          { name: trimmed, icon: roomIcon },
          { requireAuth: true }
        );
        if (!response.success) {
          Alert.alert('Error', response.message || 'Failed to create room.');
          return;
        }
      } else if (modalMode === 'edit' && selectedRoom) {
        const response = await api.patch<any>(
          ENDPOINTS.ROOMS.UPDATE(selectedRoom._id),
          { name: trimmed, icon: roomIcon },
          { requireAuth: true }
        );
        if (!response.success) {
          Alert.alert('Error', response.message || 'Failed to update room.');
          return;
        }
      }

      closeModal();
      await loadRooms();
    } catch {
      Alert.alert('Error', 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }, [roomName, roomIcon, modalMode, selectedRoom, closeModal, loadRooms]);

  const handleDelete = useCallback(
    (room: Room) => {
      Alert.alert(
        'Delete Room',
        `Are you sure you want to delete "${room.name}"? Devices will be unassigned but not deleted.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                const response = await api.delete<any>(
                  ENDPOINTS.ROOMS.DELETE(room._id),
                  { requireAuth: true }
                );
                if (!response.success) {
                  Alert.alert('Error', response.message || 'Failed to delete room.');
                  return;
                }
                await Promise.all([loadRooms(), loadDevices()]);
              } catch {
                Alert.alert('Error', 'Something went wrong.');
              }
            },
          },
        ]
      );
    },
    [loadRooms, loadDevices]
  );

  // ==========================================
  // Assign device to room
  // ==========================================
  const openAssignModal = useCallback((room: Room) => {
    setAssignRoom(room);
    setAssignModalVisible(true);
  }, []);

  const closeAssignModal = useCallback(() => {
    setAssignModalVisible(false);
    setAssignRoom(null);
  }, []);

  const unassignedDevices = useMemo(() => {
    return devices.filter((d) => !d.room);
  }, [devices]);

  const handleAssignDevice = useCallback(
    async (device: Device) => {
      if (!assignRoom) return;
      try {
        const response = await api.post<any>(
          ENDPOINTS.ROOMS.ASSIGN_DEVICE(assignRoom._id),
          { serialNumber: device.serialNumber },
          { requireAuth: true }
        );
        if (!response.success) {
          const debugInfo = response.data?.debug ? `\n\nDebug: ${response.data.debug}` : '';
          Alert.alert('Error', (response.message || 'Failed to assign device.') + debugInfo);
          return;
        }
        closeAssignModal();
        await Promise.all([loadRooms(), loadDevices()]);
      } catch {
        Alert.alert('Error', 'Something went wrong.');
      }
    },
    [assignRoom, closeAssignModal, loadRooms, loadDevices]
  );

  // ==========================================
  // Room detail (view devices + unassign)
  // ==========================================
  const openDetailModal = useCallback(
    async (room: Room) => {
      setDetailRoom(room);
      setDetailModalVisible(true);
      setRoomDevicesLoading(true);
      try {
        const response = await api.get<any>(
          ENDPOINTS.ROOMS.DEVICES(room._id),
          { requireAuth: true }
        );
        if (response.success && response.data?.devices) {
          setRoomDevices(response.data.devices);
        } else {
          setRoomDevices([]);
        }
      } catch {
        setRoomDevices([]);
      } finally {
        setRoomDevicesLoading(false);
      }
    },
    []
  );

  const closeDetailModal = useCallback(() => {
    setDetailModalVisible(false);
    setDetailRoom(null);
    setRoomDevices([]);
  }, []);

  const handleUnassignDevice = useCallback(
    async (device: Device) => {
      if (!detailRoom) return;
      Alert.alert(
        'Remove Device',
        `Remove "${device.name || device.serialNumber}" from "${detailRoom.name}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              try {
                const response = await api.delete<any>(
                  ENDPOINTS.ROOMS.REMOVE_DEVICE(detailRoom._id, device.serialNumber),
                  { requireAuth: true }
                );
                if (!response.success) {
                  Alert.alert('Error', response.message || 'Failed to remove device.');
                  return;
                }
                // Refresh
                setRoomDevices((prev) =>
                  prev.filter((d) => d.serialNumber !== device.serialNumber)
                );
                await Promise.all([loadRooms(), loadDevices()]);
              } catch {
                Alert.alert('Error', 'Something went wrong.');
              }
            },
          },
        ]
      );
    },
    [detailRoom, loadRooms, loadDevices]
  );

  // ==========================================
  // Device type icon helper
  // ==========================================
  const getDeviceIcon = (type?: string): string => {
    switch (type) {
      case 'relay': return 'garage';
      case 'light': return 'lightbulb-outline';
      case 'dimmer': return 'brightness-6';
      case 'water-tank': return 'water-outline';
      case 'sensor': return 'thermometer';
      case 'switch': return 'toggle-switch-outline';
      default: return 'devices';
    }
  };

  // ==========================================
  // Render room card
  // ==========================================
  const renderRoom = useCallback(
    ({ item }: { item: Room }) => {
      const iconName = item.icon || 'door';
      return (
        <TouchableOpacity
          style={styles.roomCard}
          onPress={() => openDetailModal(item)}
          activeOpacity={0.7}
        >
          <View style={styles.roomIconWrap}>
            <MaterialCommunityIcons
              name={iconName as any}
              size={28}
              color={BRAND_COLOR}
            />
          </View>
          <View style={styles.roomInfo}>
            <Text style={styles.roomName} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.roomDeviceCount}>
              {item.deviceCount === 0
                ? 'No devices'
                : item.deviceCount === 1
                ? '1 device'
                : `${item.deviceCount} devices`}
            </Text>
          </View>
          <View style={styles.roomActions}>
            <TouchableOpacity
              onPress={() => openAssignModal(item)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.actionBtn}
            >
              <MaterialCommunityIcons name="plus-circle-outline" size={22} color={BRAND_COLOR} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => openEditModal(item)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.actionBtn}
            >
              <MaterialCommunityIcons name="pencil-outline" size={20} color="#888" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleDelete(item)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.actionBtn}
            >
              <MaterialCommunityIcons name="trash-can-outline" size={20} color="#D32F2F" />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      );
    },
    [openDetailModal, openAssignModal, openEditModal, handleDelete]
  );

  // ==========================================
  // Render
  // ==========================================
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={BRAND_COLOR} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Rooms</Text>
        <TouchableOpacity onPress={openCreateModal} style={styles.addBtn}>
          <MaterialCommunityIcons name="plus" size={24} color="#FFF" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={BRAND_COLOR} />
        </View>
      ) : (
        <FlatList
          data={rooms}
          keyExtractor={(item) => item._id}
          renderItem={renderRoom}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons name="door-open" size={64} color="#E0E0E0" />
              <Text style={styles.emptyTitle}>No Rooms Yet</Text>
              <Text style={styles.emptySubtitle}>
                Tap the + button to create your first room
              </Text>
            </View>
          }
        />
      )}

      {/* ==========================================
          Create / Edit Room Modal
          ========================================== */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={closeModal}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable style={styles.modalOverlay} onPress={closeModal}>
            <Pressable style={styles.modalContainer} onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>
                  {modalMode === 'create' ? 'New Room' : 'Edit Room'}
                </Text>

                <TextInput
                  style={styles.textInput}
                  value={roomName}
                  onChangeText={setRoomName}
                  placeholder="Room name"
                  autoFocus
                  maxLength={50}
                />

                {/* Icon picker */}
                <Text style={styles.iconPickerLabel}>Icon</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.iconPickerRow}
                  contentContainerStyle={styles.iconPickerContent}
                >
                  {ICON_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[
                        styles.iconOption,
                        roomIcon === opt.value && styles.iconOptionActive,
                      ]}
                      onPress={() => setRoomIcon(opt.value)}
                    >
                      <MaterialCommunityIcons
                        name={opt.icon as any}
                        size={24}
                        color={roomIcon === opt.value ? '#FFF' : '#666'}
                      />
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <TouchableOpacity
                  style={[styles.saveBtn, { backgroundColor: BRAND_COLOR }]}
                  onPress={handleSave}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <Text style={styles.saveBtnText}>
                      {modalMode === 'create' ? 'Create' : 'Save'}
                    </Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* ==========================================
          Assign Device Modal
          ========================================== */}
      <Modal
        visible={assignModalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeAssignModal}
      >
        <Pressable style={styles.modalOverlay} onPress={closeAssignModal}>
          <Pressable style={styles.modalContainer} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>
                Add Device to &quot;{assignRoom?.name}&quot;
              </Text>

              {unassignedDevices.length === 0 ? (
                <Text style={styles.emptyAssignText}>
                  All devices are already assigned to rooms.
                </Text>
              ) : (
                <ScrollView style={{ maxHeight: 300 }}>
                  {unassignedDevices.map((device) => (
                    <TouchableOpacity
                      key={device.serialNumber}
                      style={styles.assignDeviceRow}
                      onPress={() => handleAssignDevice(device)}
                    >
                      <MaterialCommunityIcons
                        name={getDeviceIcon(device.deviceType) as any}
                        size={22}
                        color={BRAND_COLOR}
                      />
                      <View style={styles.assignDeviceInfo}>
                        <Text style={styles.assignDeviceName} numberOfLines={1}>
                          {device.name || device.serialNumber}
                        </Text>
                        <Text style={styles.assignDeviceSerial}>
                          {device.serialNumber}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.onlineDot,
                          { backgroundColor: device.isOnline ? '#22C55E' : '#D1D5DB' },
                        ]}
                      />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              <TouchableOpacity style={styles.cancelBtn} onPress={closeAssignModal}>
                <Text style={styles.cancelBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ==========================================
          Room Detail Modal (view devices + unassign)
          ========================================== */}
      <Modal
        visible={detailModalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeDetailModal}
      >
        <Pressable style={styles.modalOverlay} onPress={closeDetailModal}>
          <Pressable style={styles.modalContainer} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalContent}>
              <View style={styles.detailHeader}>
                <MaterialCommunityIcons
                  name={(detailRoom?.icon || 'door') as any}
                  size={28}
                  color={BRAND_COLOR}
                />
                <Text style={styles.modalTitle}>{detailRoom?.name}</Text>
              </View>

              {roomDevicesLoading ? (
                <ActivityIndicator
                  size="small"
                  color={BRAND_COLOR}
                  style={{ marginTop: 20 }}
                />
              ) : roomDevices.length === 0 ? (
                <View style={styles.emptyDetailContainer}>
                  <MaterialCommunityIcons
                    name="devices"
                    size={48}
                    color="#E0E0E0"
                  />
                  <Text style={styles.emptyAssignText}>No devices in this room</Text>
                  <TouchableOpacity
                    style={[styles.addDeviceBtn, { backgroundColor: BRAND_COLOR }]}
                    onPress={() => {
                      closeDetailModal();
                      if (detailRoom) openAssignModal(detailRoom);
                    }}
                  >
                    <MaterialCommunityIcons name="plus" size={18} color="#FFF" />
                    <Text style={styles.addDeviceBtnText}>Add Device</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <ScrollView style={{ maxHeight: 350 }}>
                  {roomDevices.map((device) => (
                    <View key={device.serialNumber} style={styles.detailDeviceRow}>
                      <MaterialCommunityIcons
                        name={getDeviceIcon(device.deviceType) as any}
                        size={22}
                        color={BRAND_COLOR}
                      />
                      <View style={styles.assignDeviceInfo}>
                        <Text style={styles.assignDeviceName} numberOfLines={1}>
                          {device.name || device.serialNumber}
                        </Text>
                        <Text style={styles.assignDeviceSerial}>
                          {device.deviceType} • {device.isOnline ? 'Online' : 'Offline'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleUnassignDevice(device)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <MaterialCommunityIcons
                          name="close-circle-outline"
                          size={22}
                          color="#D32F2F"
                        />
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}

              <TouchableOpacity style={styles.cancelBtn} onPress={closeDetailModal}>
                <Text style={styles.cancelBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ======================================
// Styles
// ======================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F8FC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 16,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E8',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F0F5FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: BRAND_COLOR,
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: BRAND_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 24,
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
    color: '#333',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
  },

  // Room card
  roomCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
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
  roomIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#F0F5FA',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  roomInfo: {
    flex: 1,
  },
  roomName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  roomDeviceCount: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  roomActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    padding: 4,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 40,
    maxHeight: '85%',
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
  iconPickerLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 10,
  },
  iconPickerRow: {
    marginBottom: 20,
  },
  iconPickerContent: {
    gap: 10,
  },
  iconOption: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconOptionActive: {
    backgroundColor: BRAND_COLOR,
  },
  saveBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  cancelBtn: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 12,
  },
  cancelBtnText: {
    fontSize: 16,
    color: '#999',
    fontWeight: '600',
  },

  // Assign device
  emptyAssignText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  assignDeviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  assignDeviceInfo: {
    flex: 1,
    marginLeft: 12,
  },
  assignDeviceName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  assignDeviceSerial: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // Detail modal
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  detailDeviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  emptyDetailContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  addDeviceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 12,
    gap: 6,
  },
  addDeviceBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
