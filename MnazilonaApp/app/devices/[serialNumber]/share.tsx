// app/devices/[serialNumber]/share.tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { api, isAuthError } from '../../../utils/api';
import { useAuth } from '../../../hooks/useAuth';
import { ENDPOINTS } from '../../../constants/api';

const BRAND = '#2E5B8E';

type ShareRow = {
  id: string;
  invitedEmail: string;
  sharedWith: { id: string; email: string; name?: string } | null;
  permissions: string[];
  status: 'pending' | 'active';
  invitedAt: string;
  respondedAt?: string | null;
};

const errorMessageFor = (code?: string, fallback = 'Something went wrong.'): string => {
  switch (code) {
    case 'USER_NOT_FOUND':
      return 'No account found for this email.';
    case 'ALREADY_PENDING':
      return 'An invitation is already pending for this user.';
    case 'ALREADY_SHARED':
      return 'This user already has access.';
    case 'CANNOT_SHARE_WITH_SELF':
      return "You can't share a device with yourself.";
    case 'NOT_OWNER':
      return 'Only the device owner can share this device.';
    case 'DEVICE_NOT_FOUND':
      return 'Device not found.';
    case 'INVALID_INPUT':
      return 'Please check your input and try again.';
    default:
      return fallback;
  }
};

export default function ShareDeviceScreen() {
  const router = useRouter();
  const { handleAuthError } = useAuth();
  const params = useLocalSearchParams<{ serialNumber: string; deviceName?: string }>();
  const serialNumber = String(params.serialNumber || '');
  const deviceName = String(params.deviceName || serialNumber);

  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadShares = useCallback(async () => {
    if (!serialNumber) return;
    try {
      const response = await api.get<any>(ENDPOINTS.DEVICES.SHARES_LIST(serialNumber), {
        requireAuth: true,
      });
      if (!response.success) {
        if (isAuthError(response.status)) {
          await handleAuthError(response.status);
          return;
        }
        return;
      }
      setShares(response.data?.shares || []);
    } catch {
      // silent — empty state covers it
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [serialNumber, handleAuthError]);

  useEffect(() => {
    loadShares();
  }, [loadShares]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadShares();
  }, [loadShares]);

  const handleInvite = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      Alert.alert('Error', 'Please enter an email address.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await api.post<any>(
        ENDPOINTS.DEVICES.SHARES_INVITE(serialNumber),
        { email: trimmed },
        { requireAuth: true }
      );
      if (!response.success) {
        if (isAuthError(response.status)) {
          await handleAuthError(response.status);
          return;
        }
        Alert.alert(
          'Could not send invitation',
          errorMessageFor(response.data?.code, response.message || 'Failed to send invitation.')
        );
        return;
      }
      setEmail('');
      Alert.alert('Invitation sent', `An invitation was sent to ${trimmed}.`);
      loadShares();
    } catch {
      Alert.alert('Error', 'Failed to send invitation. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [email, serialNumber, handleAuthError, loadShares]);

  const handleRevoke = useCallback(
    (share: ShareRow) => {
      const targetLabel = share.sharedWith?.email || share.invitedEmail;
      const isPending = share.status === 'pending';
      Alert.alert(
        isPending ? 'Cancel invitation?' : 'Remove access?',
        isPending
          ? `Cancel the pending invitation to ${targetLabel}?`
          : `${targetLabel} will lose access to "${deviceName}" immediately.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: isPending ? 'Cancel Invite' : 'Remove',
            style: 'destructive',
            onPress: async () => {
              setRevokingId(share.id);
              try {
                const response = await api.delete<any>(
                  ENDPOINTS.DEVICES.SHARES_REVOKE(serialNumber, share.id),
                  { requireAuth: true }
                );
                if (!response.success) {
                  if (isAuthError(response.status)) {
                    await handleAuthError(response.status);
                    return;
                  }
                  Alert.alert(
                    'Error',
                    errorMessageFor(response.data?.code, response.message || 'Failed to revoke share.')
                  );
                  return;
                }
                setShares((prev) => prev.filter((s) => s.id !== share.id));
              } catch {
                Alert.alert('Error', 'Something went wrong. Please try again.');
              } finally {
                setRevokingId(null);
              }
            },
          },
        ]
      );
    },
    [serialNumber, deviceName, handleAuthError]
  );

  const renderShare = useCallback(
    ({ item }: { item: ShareRow }) => {
      const display =
        item.sharedWith?.name?.trim() ||
        item.sharedWith?.email ||
        item.invitedEmail;
      const subline = item.sharedWith?.name && item.sharedWith.email
        ? item.sharedWith.email
        : null;
      const isRevoking = revokingId === item.id;
      const isPending = item.status === 'pending';

      return (
        <View style={styles.shareRow}>
          <View style={[styles.avatar, { backgroundColor: isPending ? '#FFF4E6' : '#E8F5E9' }]}>
            <MaterialCommunityIcons
              name={isPending ? 'email-outline' : 'account'}
              size={20}
              color={isPending ? '#D97706' : '#2E7D32'}
            />
          </View>
          <View style={styles.shareInfo}>
            <Text style={styles.shareName} numberOfLines={1}>{display}</Text>
            {subline ? <Text style={styles.shareSub} numberOfLines={1}>{subline}</Text> : null}
            <View style={styles.statusPillRow}>
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: isPending ? '#FFF4E6' : '#E8F5E9' },
                ]}
              >
                <Text
                  style={[
                    styles.statusPillText,
                    { color: isPending ? '#D97706' : '#2E7D32' },
                  ]}
                >
                  {isPending ? 'Pending' : 'Active'}
                </Text>
              </View>
            </View>
          </View>
          <TouchableOpacity
            style={styles.revokeBtn}
            onPress={() => handleRevoke(item)}
            disabled={isRevoking}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            {isRevoking ? (
              <ActivityIndicator size="small" color="#F44336" />
            ) : (
              <MaterialCommunityIcons name="trash-can-outline" size={22} color="#F44336" />
            )}
          </TouchableOpacity>
        </View>
      );
    },
    [revokingId, handleRevoke]
  );

  const renderEmpty = useCallback(
    () => (
      <View style={styles.emptyContainer}>
        <MaterialCommunityIcons name="account-multiple-outline" size={56} color="#E0E0E0" />
        <Text style={styles.emptyTitle}>Not shared with anyone yet</Text>
        <Text style={styles.emptySubtitle}>
          Invite someone above by entering their email.
        </Text>
      </View>
    ),
    []
  );

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <MaterialCommunityIcons name="arrow-left" size={28} color={BRAND} />
            </TouchableOpacity>
            <View style={styles.headerTextWrap}>
              <Text style={styles.title}>Share Device</Text>
              <Text style={styles.subtitle} numberOfLines={1}>{deviceName}</Text>
            </View>
          </View>

          <View style={styles.inviteCard}>
            <Text style={styles.sectionTitle}>Invite a user</Text>
            <Text style={styles.sectionSub}>
              Enter the email of an existing Mnazilona account.
            </Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="user@example.com"
              placeholderTextColor="#B0B8C5"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!submitting}
            />
            <TouchableOpacity
              style={[styles.primaryBtn, submitting && styles.primaryBtnDisabled]}
              onPress={handleInvite}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <MaterialCommunityIcons name="send" size={18} color="#FFF" />
                  <Text style={styles.primaryBtnText}>Send invitation</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.listHeading}>Currently shared with</Text>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={BRAND} />
            </View>
          ) : (
            <FlatList
              data={shares}
              keyExtractor={(item) => item.id}
              renderItem={renderShare}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={renderEmpty}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor={BRAND}
                  colors={[BRAND]}
                />
              }
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F4F8FC' },
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 16 },

  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 18, paddingTop: 8 },
  backBtn: { marginRight: 12 },
  headerTextWrap: { flex: 1 },
  title: { fontSize: 22, fontWeight: '800', color: BRAND },
  subtitle: { fontSize: 13, color: '#7A8A99', marginTop: 2 },

  inviteCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    marginBottom: 18,
    shadowColor: '#1E3A5F',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#244B6B' },
  sectionSub: { fontSize: 12, color: '#7A8A99', marginTop: 4, marginBottom: 14 },
  input: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#333',
    backgroundColor: '#FAFAFA',
    marginBottom: 12,
  },
  primaryBtn: {
    flexDirection: 'row',
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },

  listHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: '#7A8A99',
    marginBottom: 10,
    marginLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  listContent: { paddingBottom: 80, flexGrow: 1 },

  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
    shadowColor: '#1E3A5F',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  shareInfo: { flex: 1, minWidth: 0 },
  shareName: { fontSize: 15, fontWeight: '600', color: '#333' },
  shareSub: { fontSize: 12, color: '#7A8A99', marginTop: 2 },
  statusPillRow: { flexDirection: 'row', marginTop: 6 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  revokeBtn: { padding: 6, marginLeft: 4 },

  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 40,
    paddingHorizontal: 20,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#333', marginTop: 14 },
  emptySubtitle: { fontSize: 13, color: '#999', marginTop: 6, textAlign: 'center' },
});
