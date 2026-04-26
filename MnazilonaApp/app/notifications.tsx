// app/notifications.tsx
import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { api, isAuthError } from "../utils/api";
import { useAuth } from "../hooks/useAuth";
import { ENDPOINTS } from "../constants/api";

const BRAND = "#2E5B8E";

type NotificationData = {
  serialNumber?: string;
  deviceName?: string;
  requesterId?: string;
  requesterEmail?: string;
};

type NotificationItem = {
  _id: string;
  type: "transfer_request" | "transfer_approved" | "transfer_denied" | "info";
  message: string;
  data: NotificationData;
  isRead: boolean;
  status: "pending" | "approved" | "denied" | "expired";
  createdAt: string;
  respondedAt?: string;
};

export default function NotificationsScreen() {
  const router = useRouter();
  const { handleAuthError } = useAuth();

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const loadNotifications = useCallback(async () => {
    try {
      const response = await api.get<any>(ENDPOINTS.NOTIFICATIONS.LIST, {
        requireAuth: true,
      });

      if (!response.success) {
        if (isAuthError(response.status)) {
          await handleAuthError(response.status);
          return;
        }
        return;
      }

      setNotifications(response.data?.notifications || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [handleAuthError]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadNotifications();
  }, [loadNotifications]);

  const markAllRead = useCallback(async () => {
    try {
      const response = await api.patch(
        ENDPOINTS.NOTIFICATIONS.READ_ALL,
        undefined,
        { requireAuth: true }
      );
      if (!response.success) {
        if (isAuthError(response.status)) {
          await handleAuthError(response.status);
        }
        return;
      }
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch {
      // silent
    }
  }, [handleAuthError]);

  const respondToTransfer = useCallback(
    async (notificationId: string, action: "approve" | "deny") => {
      const actionLabel = action === "approve" ? "unlink" : "deny";
      const confirmMsg =
        action === "approve"
          ? "Are you sure you want to unlink this device? The other user will be able to pair it."
          : "Are you sure you want to deny this request?";

      Alert.alert(
        action === "approve" ? "Unlink Device" : "Deny Request",
        confirmMsg,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: action === "approve" ? "Yes, Unlink" : "Yes, Deny",
            style: action === "approve" ? "destructive" : "default",
            onPress: async () => {
              setRespondingId(notificationId);
              try {
                const response = await api.post<any>(
                  ENDPOINTS.NOTIFICATIONS.RESPOND(notificationId),
                  { action },
                  { requireAuth: true }
                );

                if (!response.success) {
                  Alert.alert("Error", response.message || `Failed to ${actionLabel}`);
                  return;
                }

                Alert.alert(
                  "Done",
                  action === "approve"
                    ? "Device unlinked successfully."
                    : "Request denied."
                );

                // حدث القائمة
                loadNotifications();
              } catch {
                Alert.alert("Error", "Something went wrong. Try again.");
              } finally {
                setRespondingId(null);
              }
            },
          },
        ]
      );
    },
    [loadNotifications]
  );

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "transfer_request":
        return "account-alert";
      case "transfer_approved":
        return "check-circle";
      case "transfer_denied":
        return "close-circle";
      default:
        return "bell";
    }
  };

  const getNotificationColor = (type: string) => {
    switch (type) {
      case "transfer_request":
        return "#FF9800";
      case "transfer_approved":
        return "#4CAF50";
      case "transfer_denied":
        return "#F44336";
      default:
        return BRAND;
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString();
  };

  const renderItem = useCallback(
    ({ item }: { item: NotificationItem }) => {
      const isTransferRequest = item.type === "transfer_request" && item.status === "pending";
      const isResponding = respondingId === item._id;

      return (
        <View style={[styles.notifCard, !item.isRead && styles.notifUnread]}>
          {/* Header */}
          <View style={styles.notifHeader}>
            <View style={[styles.iconCircle, { backgroundColor: getNotificationColor(item.type) + "20" }]}>
              <MaterialCommunityIcons
                name={getNotificationIcon(item.type) as any}
                size={24}
                color={getNotificationColor(item.type)}
              />
            </View>
            <View style={styles.notifTextContainer}>
              <Text style={styles.notifMessage}>{item.message}</Text>
              <Text style={styles.notifTime}>{formatTime(item.createdAt)}</Text>
            </View>
            {!item.isRead && <View style={styles.unreadDot} />}
          </View>

          {/* Device info */}
          {item.data?.serialNumber && (
            <View style={styles.deviceInfo}>
              <MaterialCommunityIcons name="chip" size={14} color="#999" />
              <Text style={styles.deviceInfoText}>
                {item.data.deviceName || item.data.serialNumber}
              </Text>
            </View>
          )}

          {/* Requester info */}
          {item.data?.requesterEmail && item.type === "transfer_request" && (
            <View style={styles.deviceInfo}>
              <MaterialCommunityIcons name="account" size={14} color="#999" />
              <Text style={styles.deviceInfoText}>{item.data.requesterEmail}</Text>
            </View>
          )}

          {/* Status badge for responded requests */}
          {item.type === "transfer_request" && item.status !== "pending" && (
            <View style={[
              styles.statusBadge,
              { backgroundColor: item.status === "approved" ? "#E8F5E9" : "#FFEBEE" },
            ]}>
              <Text style={[
                styles.statusText,
                { color: item.status === "approved" ? "#2E7D32" : "#C62828" },
              ]}>
                {item.status === "approved" ? "Approved" : "Denied"}
              </Text>
            </View>
          )}

          {/* Action buttons for pending transfer requests */}
          {isTransferRequest && (
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.denyBtn]}
                onPress={() => respondToTransfer(item._id, "deny")}
                disabled={isResponding}
              >
                {isResponding ? (
                  <ActivityIndicator size="small" color="#F44336" />
                ) : (
                  <>
                    <MaterialCommunityIcons name="close" size={18} color="#F44336" />
                    <Text style={styles.denyText}>Deny</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, styles.approveBtn]}
                onPress={() => respondToTransfer(item._id, "approve")}
                disabled={isResponding}
              >
                {isResponding ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <MaterialCommunityIcons name="check" size={18} color="#fff" />
                    <Text style={styles.approveText}>Unlink Device</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      );
    },
    [respondingId, respondToTransfer]
  );

  const renderEmpty = useCallback(
    () => (
      <View style={styles.emptyContainer}>
        <MaterialCommunityIcons name="bell-off-outline" size={64} color="#E0E0E0" />
        <Text style={styles.emptyTitle}>No Notifications</Text>
        <Text style={styles.emptySubtitle}>You&apos;re all caught up!</Text>
      </View>
    ),
    []
  );

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <MaterialCommunityIcons name="arrow-left" size={28} color={BRAND} />
          </TouchableOpacity>
          <Text style={styles.title}>Notifications</Text>
          {unreadCount > 0 && (
            <TouchableOpacity onPress={markAllRead} style={styles.markAllBtn}>
              <Text style={styles.markAllText}>Mark all read</Text>
            </TouchableOpacity>
          )}
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={BRAND} />
          </View>
        ) : (
          <FlatList
            data={notifications}
            keyExtractor={(item) => item._id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={BRAND}
                colors={[BRAND]}
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
  safe: { flex: 1, backgroundColor: "#F4F8FC" },
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 16 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    paddingTop: 8,
  },
  backBtn: { marginRight: 12 },
  title: { fontSize: 24, fontWeight: "800", color: BRAND, flex: 1 },
  markAllBtn: { paddingVertical: 6, paddingHorizontal: 12 },
  markAllText: { fontSize: 13, color: BRAND, fontWeight: "600" },

  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  listContent: { paddingBottom: 100, flexGrow: 1 },

  notifCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#1E3A5F",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  notifUnread: {
    borderLeftWidth: 3,
    borderLeftColor: BRAND,
  },

  notifHeader: { flexDirection: "row", alignItems: "flex-start" },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  notifTextContainer: { flex: 1 },
  notifMessage: { fontSize: 14, color: "#333", lineHeight: 20, fontWeight: "500" },
  notifTime: { fontSize: 12, color: "#999", marginTop: 4 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: BRAND,
    marginTop: 6,
    marginLeft: 8,
  },

  deviceInfo: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    marginLeft: 56,
    gap: 6,
  },
  deviceInfoText: { fontSize: 12, color: "#999" },

  statusBadge: {
    alignSelf: "flex-start",
    marginLeft: 56,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: { fontSize: 12, fontWeight: "700" },

  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
    marginLeft: 56,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  denyBtn: {
    backgroundColor: "#FFEBEE",
  },
  approveBtn: {
    backgroundColor: BRAND,
    flex: 1,
    justifyContent: "center",
  },
  denyText: { color: "#F44336", fontWeight: "700", fontSize: 14 },
  approveText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 80,
  },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: "#333", marginTop: 16 },
  emptySubtitle: { fontSize: 14, color: "#999", marginTop: 8 },
});
