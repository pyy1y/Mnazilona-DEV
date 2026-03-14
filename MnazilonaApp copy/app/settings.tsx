// app/settings.tsx

import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { api, isAuthError } from '../utils/api';
import { useAuth } from '../hooks/useAuth';
import { ENDPOINTS } from '../constants/api';

const BRAND_COLOR = '#2E5B8E';
const DANGER_COLOR = '#FF3B30';

export default function SettingsScreen() {
  const router = useRouter();
  const { handleAuthError } = useAuth();

  // State
  const [isLoading, setIsLoading] = useState(false);

  // ======================================
  // Handlers
  // ======================================
  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const sendDeleteCode = useCallback(async () => {
    if (isLoading) return;

    setIsLoading(true);

    try {
      const response = await api.post(
        ENDPOINTS.USER.DELETE_SEND_CODE,
        {},
        { requireAuth: true }
      );

      if (!response.success) {
        if (isAuthError(response.status)) {
          await handleAuthError(response.status);
          return;
        }
        Alert.alert('Error', response.message || 'Failed to send verification code.');
        return;
      }

      // Navigate to OTP screen for delete confirmation
      router.push({
        pathname: '/otp',
        params: { mode: 'delete_account' },
      });
    } catch (error) {
      if (__DEV__) console.error('Delete account error:', error);
      Alert.alert('Connection Error', 'Could not connect to the server.');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, handleAuthError, router]);

  const handleDeletePress = useCallback(() => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account?\n\nThis will permanently delete your account and unpair all your devices. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: sendDeleteCode,
        },
      ]
    );
  }, [sendDeleteCode]);

  // ======================================
  // Render
  // ======================================
  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Settings</Text>

          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
            activeOpacity={0.7}
            disabled={isLoading}
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={24}
              color={BRAND_COLOR}
            />
          </TouchableOpacity>
        </View>

        {/* Section Title */}
        <Text style={styles.sectionTitle}>Account</Text>

        {/* Delete Account Card */}
        <TouchableOpacity
          style={styles.dangerCard}
          onPress={handleDeletePress}
          activeOpacity={0.7}
          disabled={isLoading}
        >
          <View style={styles.leftIconWrap}>
            {isLoading ? (
              <ActivityIndicator size="small" color={DANGER_COLOR} />
            ) : (
              <MaterialCommunityIcons
                name="trash-can-outline"
                size={24}
                color={DANGER_COLOR}
              />
            )}
          </View>

          <View style={styles.cardBody}>
            <Text style={styles.dangerTitle}>
              {isLoading ? 'Sending verification code...' : 'Delete Account'}
            </Text>
            <Text style={styles.dangerSubtitle}>
              Permanently delete your account and all data
            </Text>
          </View>

          <MaterialCommunityIcons
            name="chevron-right"
            size={24}
            color={DANGER_COLOR}
          />
        </TouchableOpacity>

        {/* Warning Note */}
        <View style={styles.warningContainer}>
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={20}
            color="#FF9500"
            style={styles.warningIcon}
          />
          <Text style={styles.warningText}>
            Deleting your account will remove all your data and unpair all connected devices. This action is irreversible.
          </Text>
        </View>

        {/* App Info Section */}
        <Text style={styles.sectionTitle}>About</Text>

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>App Version</Text>
            <Text style={styles.infoValue}>1.0.0</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Build</Text>
            <Text style={styles.infoValue}>Production</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// ======================================
// Styles
// ======================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 30,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: '700',
    color: BRAND_COLOR,
  },
  backButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#F6F8FB',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
    marginLeft: 4,
  },
  dangerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF5F5',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FFE5E5',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 16,
  },
  leftIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    marginRight: 14,
    borderWidth: 1,
    borderColor: '#FFE5E5',
  },
  cardBody: {
    flex: 1,
  },
  dangerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: DANGER_COLOR,
    marginBottom: 2,
  },
  dangerSubtitle: {
    fontSize: 13,
    color: '#999',
  },
  warningContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFF9E6',
    borderRadius: 12,
    padding: 16,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: '#FFE5B4',
  },
  warningIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: '#8B6914',
    lineHeight: 20,
  },
  infoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  infoLabel: {
    fontSize: 15,
    color: '#333',
  },
  infoValue: {
    fontSize: 15,
    color: '#888',
  },
  divider: {
    height: 1,
    backgroundColor: '#F0F0F0',
    marginHorizontal: 16,
  },
});