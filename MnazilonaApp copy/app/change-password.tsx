// app/change-password.tsx

import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { api } from '../utils/api';
import { ENDPOINTS } from '../constants/api';
import { normalizeEmail, isStrongPassword, getPasswordStrengthErrors } from '../utils/validation';

const BRAND_COLOR = '#2E5B8E';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  // Parse params
  const email = useMemo(() => normalizeEmail((params.email as string) || ''), [params.email]);
  const code = useMemo(() => ((params.code as string) || '').trim(), [params.code]);

  // State
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Refs
  const confirmPasswordRef = useRef<TextInput>(null);

  // Validate params on mount
  useEffect(() => {
    if (!email || !code) {
      Alert.alert(
        'Missing Data',
        'Reset session is invalid or expired. Please request a new reset code.',
        [{ text: 'OK', onPress: () => router.replace('/forgot-password') }]
      );
    }
  }, [email, code, router]);

  // Computed values
  const passwordErrors = useMemo(() => {
    if (!newPassword) return [];
    return getPasswordStrengthErrors(newPassword);
  }, [newPassword]);

  const passwordsMatch = useMemo(() => {
    return newPassword === confirmPassword;
  }, [newPassword, confirmPassword]);

  const canSubmit = useMemo(() => {
    return (
      !isLoading &&
      email &&
      code &&
      isStrongPassword(newPassword) &&
      passwordsMatch &&
      confirmPassword.length > 0
    );
  }, [isLoading, email, code, newPassword, confirmPassword, passwordsMatch]);

  // Handlers
  const handleChangePassword = useCallback(async () => {
    if (isLoading) return;

    // Validation
    if (!email || !code) {
      Alert.alert('Session Expired', 'Please request a new reset code.');
      router.replace('/forgot-password');
      return;
    }

    if (!newPassword.trim()) {
      Alert.alert('Missing Password', 'Please enter a new password.');
      return;
    }

    if (!isStrongPassword(newPassword)) {
      Alert.alert(
        'Weak Password',
        'Password must be at least 8 characters with 1 uppercase letter and 1 number.'
      );
      return;
    }

    if (!passwordsMatch) {
      Alert.alert('Password Mismatch', 'Passwords do not match.');
      return;
    }

    setIsLoading(true);

    try {
      const response = await api.post(ENDPOINTS.AUTH.RESET_PASSWORD, {
        email,
        code,
        newPassword,
      });

      if (!response.success) {
        Alert.alert('Error', response.message || 'Failed to reset password.');
        return;
      }

      Alert.alert(
        'Password Changed',
        'Your password has been successfully changed. Please log in with your new password.',
        [{ text: 'OK', onPress: () => router.replace('/login') }]
      );
    } catch (error) {
      if (__DEV__) console.error('Change password error:', error);
      Alert.alert('Connection Error', 'Could not connect to the server.');
    } finally {
      setIsLoading(false);
    }
  }, [email, code, newPassword, passwordsMatch, isLoading, router]);

  const handleBackToLogin = useCallback(() => {
    router.replace('/login');
  }, [router]);

  // Don't render if params are missing
  if (!email || !code) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={BRAND_COLOR} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Back Button */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleBackToLogin}
          disabled={isLoading}
        >
          <Feather name="arrow-left" size={24} color={BRAND_COLOR} />
        </TouchableOpacity>

        {/* Icon */}
        <View style={styles.iconContainer}>
          <Feather name="refresh-cw" size={50} color={BRAND_COLOR} />
        </View>

        {/* Header */}
        <Text style={styles.title}>Set New Password</Text>
        <Text style={styles.subtitle}>
          Create a strong password with at least 8 characters, including 1 uppercase letter and 1 number.
        </Text>

        {/* New Password Input */}
        <View style={styles.inputContainer}>
          <Feather name="lock" size={20} color={BRAND_COLOR} style={styles.inputIcon} />
          <TextInput
            style={styles.inputField}
            placeholder="New password"
            placeholderTextColor="#999"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry={!showNewPassword}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="password-new"
            textContentType="newPassword"
            returnKeyType="next"
            onSubmitEditing={() => confirmPasswordRef.current?.focus()}
            editable={!isLoading}
          />
          <TouchableOpacity
            onPress={() => setShowNewPassword(v => !v)}
            style={styles.eyeIcon}
            disabled={isLoading}
          >
            <Feather
              name={showNewPassword ? 'eye' : 'eye-off'}
              size={20}
              color={BRAND_COLOR}
            />
          </TouchableOpacity>
        </View>

        {/* Password Strength Indicator */}
        {newPassword.length > 0 && passwordErrors.length > 0 && (
          <View style={styles.errorContainer}>
            {passwordErrors.map((error, index) => (
              <View key={index} style={styles.errorRow}>
                <Feather name="x-circle" size={14} color="#FF3B30" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ))}
          </View>
        )}

        {newPassword.length > 0 && passwordErrors.length === 0 && (
          <View style={styles.successContainer}>
            <Feather name="check-circle" size={14} color="#34C759" />
            <Text style={styles.successText}>Password is strong</Text>
          </View>
        )}

        {/* Confirm Password Input */}
        <View style={styles.inputContainer}>
          <Feather name="check-circle" size={20} color={BRAND_COLOR} style={styles.inputIcon} />
          <TextInput
            ref={confirmPasswordRef}
            style={styles.inputField}
            placeholder="Confirm new password"
            placeholderTextColor="#999"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry={!showConfirmPassword}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="password-new"
            textContentType="newPassword"
            returnKeyType="done"
            onSubmitEditing={handleChangePassword}
            editable={!isLoading}
          />
          <TouchableOpacity
            onPress={() => setShowConfirmPassword(v => !v)}
            style={styles.eyeIcon}
            disabled={isLoading}
          >
            <Feather
              name={showConfirmPassword ? 'eye' : 'eye-off'}
              size={20}
              color={BRAND_COLOR}
            />
          </TouchableOpacity>
        </View>

        {/* Password Match Indicator */}
        {confirmPassword.length > 0 && !passwordsMatch && (
          <View style={styles.errorContainer}>
            <View style={styles.errorRow}>
              <Feather name="x-circle" size={14} color="#FF3B30" />
              <Text style={styles.errorText}>Passwords do not match</Text>
            </View>
          </View>
        )}

        {confirmPassword.length > 0 && passwordsMatch && newPassword.length > 0 && (
          <View style={styles.successContainer}>
            <Feather name="check-circle" size={14} color="#34C759" />
            <Text style={styles.successText}>Passwords match</Text>
          </View>
        )}

        {/* Submit Button */}
        <TouchableOpacity
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
          onPress={handleChangePassword}
          disabled={!canSubmit}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.buttonText}>Change Password</Text>
          )}
        </TouchableOpacity>

        {/* Back to Login Link */}
        <TouchableOpacity
          style={styles.linkContainer}
          onPress={handleBackToLogin}
          disabled={isLoading}
        >
          <Text style={styles.linkText}>Back to Login</Text>
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
    paddingTop: 60,
    paddingBottom: 30,
    justifyContent: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 20,
    zIndex: 10,
    padding: 10,
  },
  iconContainer: {
    alignSelf: 'center',
    marginBottom: 24,
    padding: 24,
    backgroundColor: '#F0F4F8',
    borderRadius: 50,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: BRAND_COLOR,
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    height: 60,
    marginBottom: 12,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  inputIcon: {
    marginRight: 12,
  },
  inputField: {
    flex: 1,
    height: '100%',
    fontSize: 16,
    color: '#333',
  },
  eyeIcon: {
    padding: 8,
  },
  errorContainer: {
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  errorText: {
    fontSize: 12,
    color: '#FF3B30',
    marginLeft: 6,
  },
  successContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  successText: {
    fontSize: 12,
    color: '#34C759',
    marginLeft: 6,
  },
  button: {
    width: '100%',
    height: 58,
    backgroundColor: BRAND_COLOR,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 20,
    shadowColor: BRAND_COLOR,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  linkContainer: {
    alignItems: 'center',
    marginTop: 8,
  },
  linkText: {
    color: BRAND_COLOR,
    fontSize: 15,
    fontWeight: '700',
  },
});