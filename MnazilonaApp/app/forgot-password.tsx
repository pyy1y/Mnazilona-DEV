// app/forgot-password.tsx

import React, { useState, useMemo, useCallback } from 'react';
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
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { api } from '../utils/api';
import { ENDPOINTS } from '../constants/api';
import { isValidEmail, normalizeEmail } from '../utils/validation';

const BRAND_COLOR = '#2E5B8E';

export default function ForgotPasswordScreen() {
  const router = useRouter();

  // State
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Computed values
  const normalizedEmail = useMemo(() => normalizeEmail(email), [email]);
  const canSubmit = useMemo(() => isValidEmail(email) && !isLoading, [email, isLoading]);

  // Handlers
  const handleSendCode = useCallback(async () => {
    if (isLoading) return;

    if (!normalizedEmail) {
      Alert.alert('Missing Email', 'Please enter your email address.');
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }

    setIsLoading(true);

    try {
      const response = await api.post(ENDPOINTS.AUTH.FORGOT_PASSWORD, {
        email: normalizedEmail,
      });

      // Note: Backend always returns success for security (doesn't reveal if email exists)
      Alert.alert(
        'Check Your Email',
        'If an account exists with this email, a reset code has been sent.',
        [
          {
            text: 'OK',
            onPress: () => {
              router.push({
                pathname: '/otp',
                params: {
                  mode: 'reset_password',
                  email: normalizedEmail,
                },
              });
            },
          },
        ]
      );
    } catch (error) {
      if (__DEV__) console.error('Forgot password error:', error);
      Alert.alert('Connection Error', 'Could not connect to the server. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [normalizedEmail, isLoading, router]);

  const handleBackToLogin = useCallback(() => {
    router.replace('/login');
  }, [router]);

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
          <Feather name="key" size={50} color={BRAND_COLOR} />
        </View>

        {/* Header */}
        <Text style={styles.title}>Forgot Password</Text>
        <Text style={styles.subtitle}>
          Enter your email address and we'll send you a code to reset your password.
        </Text>

        {/* Email Input */}
        <View style={styles.inputContainer}>
          <Feather name="mail" size={20} color={BRAND_COLOR} style={styles.inputIcon} />
          <TextInput
            style={styles.inputField}
            placeholder="Email Address"
            placeholderTextColor="#999"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="done"
            onSubmitEditing={handleSendCode}
            editable={!isLoading}
          />
        </View>

        {/* Send Code Button */}
        <TouchableOpacity
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
          onPress={handleSendCode}
          disabled={!canSubmit}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.buttonText}>Send Reset Code</Text>
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
    fontSize: 32,
    fontWeight: '700',
    color: BRAND_COLOR,
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    height: 60,
    marginBottom: 20,
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
  button: {
    width: '100%',
    height: 58,
    backgroundColor: BRAND_COLOR,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
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