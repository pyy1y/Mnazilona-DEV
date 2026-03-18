// app/(tabs)/account.tsx

import React, { useCallback, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useAuth } from '../../hooks/useAuth';
import { api, isAuthError, TokenManager } from '../../utils/api';
import { getUser } from '../../utils/userStorage';

const BRAND_COLOR = '#2E5B8E';

interface UserInfo {
  name: string;
  email: string;
}

export default function AccountScreen() {
  const router = useRouter();
  const { confirmLogout, logout, handleAuthError } = useAuth();

  const [user, setUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadUser = useCallback(async () => {
    setIsLoading(true);
    try {
      const token = await TokenManager.get();
      if (!token) {
        await logout();
        return;
      }

      const response = await api.get<any>('/api/me', { requireAuth: true });

      if (response.success && response.data) {
        setUser({
          name: response.data.name || '',
          email: response.data.email || '',
        });
      } else {
        if (isAuthError(response.status)) {
          await handleAuthError(response.status);
          return;
        }
        // Fallback to cached user
        const cached = await getUser();
        if (cached) {
          setUser({ name: cached.name || '', email: cached.email || '' });
        }
      }
    } catch {
      const cached = await getUser();
      if (cached) {
        setUser({ name: cached.name || '', email: cached.email || '' });
      }
    } finally {
      setIsLoading(false);
    }
  }, [logout, handleAuthError]);

  useFocusEffect(
    useCallback(() => {
      loadUser();
    }, [loadUser])
  );

  // Navigation
  const handleGoToProfile = useCallback(() => {
    router.push('/(tabs)/account-pages/profile');
  }, [router]);

  const handleGoToPreferences = useCallback(() => {
    router.push('/(tabs)/account-pages/preferences');
  }, [router]);

  const handleGoToSecurity = useCallback(() => {
    router.push('/(tabs)/account-pages/security');
  }, [router]);

  const handleGoToMyDevices = useCallback(() => {
    router.push('/(tabs)/account-pages/my-devices');
  }, [router]);

  const handleGoToRooms = useCallback(() => {
    router.push('/(tabs)/account-pages/rooms');
  }, [router]);

  const handleGoToAbout = useCallback(() => {
    router.push('/(tabs)/account-pages/about');
  }, [router]);

  // Get user initials for avatar
  const getInitials = (name: string) => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name[0].toUpperCase();
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.headerTitle}>Account</Text>
        <Text style={styles.headerSubtitle}>Manage your account settings</Text>

        {/* User Info Header */}
        {isLoading ? (
          <View style={styles.userCard}>
            <ActivityIndicator size="small" color={BRAND_COLOR} />
          </View>
        ) : user ? (
          <View style={styles.userCard}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>{getInitials(user.name)}</Text>
            </View>
            <View style={styles.userInfo}>
              <Text style={styles.userName} numberOfLines={1}>
                {user.name || 'No name set'}
              </Text>
              <Text style={styles.userEmail} numberOfLines={1}>
                {user.email || 'No email set'}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Section: General */}
        <Text style={styles.sectionTitle}>General</Text>

        {/* Profile Card */}
        <TouchableOpacity
          style={styles.cardRow}
          onPress={handleGoToProfile}
          activeOpacity={0.7}
        >
          <View style={styles.leftIconWrap}>
            <MaterialCommunityIcons
              name="account-circle-outline"
              size={28}
              color={BRAND_COLOR}
            />
          </View>
          <View style={styles.cardRowBody}>
            <Text style={styles.cardRowValue}>Profile</Text>
            <Text style={styles.cardRowLabel}>Personal information</Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={24}
            color={BRAND_COLOR}
          />
        </TouchableOpacity>

        {/* Preferences Card */}
        <TouchableOpacity
          style={styles.cardRow}
          onPress={handleGoToPreferences}
          activeOpacity={0.7}
        >
          <View style={styles.leftIconWrap}>
            <MaterialCommunityIcons
              name="tune-variant"
              size={24}
              color={BRAND_COLOR}
            />
          </View>
          <View style={styles.cardRowBody}>
            <Text style={styles.cardRowValue}>Preferences</Text>
            <Text style={styles.cardRowLabel}>Language, theme & units</Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={24}
            color={BRAND_COLOR}
          />
        </TouchableOpacity>

        {/* My Devices Card */}
        <TouchableOpacity
          style={styles.cardRow}
          onPress={handleGoToMyDevices}
          activeOpacity={0.7}
        >
          <View style={styles.leftIconWrap}>
            <MaterialCommunityIcons
              name="devices"
              size={24}
              color={BRAND_COLOR}
            />
          </View>
          <View style={styles.cardRowBody}>
            <Text style={styles.cardRowValue}>My Devices</Text>
            <Text style={styles.cardRowLabel}>Logs & warranty info</Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={24}
            color={BRAND_COLOR}
          />
        </TouchableOpacity>

        {/* Rooms Card */}
        <TouchableOpacity
          style={styles.cardRow}
          onPress={handleGoToRooms}
          activeOpacity={0.7}
        >
          <View style={styles.leftIconWrap}>
            <MaterialCommunityIcons
              name="door-open"
              size={24}
              color={BRAND_COLOR}
            />
          </View>
          <View style={styles.cardRowBody}>
            <Text style={styles.cardRowValue}>Rooms</Text>
            <Text style={styles.cardRowLabel}>Organize devices by location</Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={24}
            color={BRAND_COLOR}
          />
        </TouchableOpacity>

        {/* Section: Security & Privacy */}
        <Text style={styles.sectionTitle}>Security & Privacy</Text>

        {/* Security Card */}
        <TouchableOpacity
          style={styles.cardRow}
          onPress={handleGoToSecurity}
          activeOpacity={0.7}
        >
          <View style={styles.leftIconWrap}>
            <MaterialCommunityIcons
              name="shield-lock-outline"
              size={24}
              color={BRAND_COLOR}
            />
          </View>
          <View style={styles.cardRowBody}>
            <Text style={styles.cardRowValue}>Security</Text>
            <Text style={styles.cardRowLabel}>Password & account deletion</Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={24}
            color={BRAND_COLOR}
          />
        </TouchableOpacity>

        {/* Section: Other */}
        <Text style={styles.sectionTitle}>Other</Text>

        {/* About Card */}
        <TouchableOpacity
          style={styles.cardRow}
          onPress={handleGoToAbout}
          activeOpacity={0.7}
        >
          <View style={styles.leftIconWrap}>
            <MaterialCommunityIcons
              name="information-outline"
              size={24}
              color={BRAND_COLOR}
            />
          </View>
          <View style={styles.cardRowBody}>
            <Text style={styles.cardRowValue}>About</Text>
            <Text style={styles.cardRowLabel}>App info & support</Text>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={24}
            color={BRAND_COLOR}
          />
        </TouchableOpacity>

        {/* Logout Button */}
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={confirmLogout}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name="logout"
            size={20}
            color="#FFFFFF"
            style={styles.logoutIcon}
          />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 30,
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

  // User info card
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F6F8FB',
    borderRadius: 18,
    padding: 16,
    marginBottom: 24,
    minHeight: 80,
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: BRAND_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 2,
  },
  userEmail: {
    fontSize: 14,
    color: '#7A8CA5',
  },

  // Section titles
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7A8CA5',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 4,
  },

  // Card styles
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  leftIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#F6F8FB',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  cardRowBody: {
    flex: 1,
  },
  cardRowLabel: {
    fontSize: 13,
    color: '#888',
    marginBottom: 2,
  },
  cardRowValue: {
    fontSize: 16,
    color: '#333',
    fontWeight: '700',
  },

  // Logout button
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#D32F2F',
  },
  logoutIcon: {
    marginRight: 8,
  },
  logoutText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
