// app/otp.tsx

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
import { api, TokenManager, UserDataManager } from '../utils/api';
import { ENDPOINTS, APP_CONFIG } from '../constants/api';
import { normalizeEmail, sanitizeOTP, isValidOTP } from '../utils/validation';
import { login } from '../utils/auth';
import * as SecureStore from 'expo-secure-store';

const BRAND_COLOR = '#2E5B8E';
const REGISTER_DRAFT_KEY = '__register_draft';
const DANGER_COLOR = '#FF3B30';

// ======================================
// Types
// ======================================
type OTPMode = 'login' | 'register' | 'reset_password' | 'delete_account';

type RegisterDraft = {
  name: string;
  email: string;
  password: string;
  dob: string;
  country: string;
  city: string;
};

// ======================================
// Mode Configuration
// ======================================
const MODE_CONFIG: Record<OTPMode, {
  title: string;
  subtitle: string;
  buttonText: string;
  icon: keyof typeof Feather.glyphMap;
  color: string;
}> = {
  login: {
    title: 'Verify Login',
    subtitle: 'Enter the 6-digit code sent to',
    buttonText: 'Verify',
    icon: 'shield',
    color: BRAND_COLOR,
  },
  register: {
    title: 'Verify Account',
    subtitle: 'Enter the 6-digit code sent to',
    buttonText: 'Verify',
    icon: 'user-check',
    color: BRAND_COLOR,
  },
  reset_password: {
    title: 'Reset Password',
    subtitle: 'Enter the 6-digit code sent to',
    buttonText: 'Continue',
    icon: 'key',
    color: BRAND_COLOR,
  },
  delete_account: {
    title: 'Confirm Deletion',
    subtitle: 'Enter the code to permanently delete your account',
    buttonText: 'Delete Account',
    icon: 'alert-triangle',
    color: DANGER_COLOR,
  },
};

// ======================================
// Component
// ======================================
export default function OTPScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  // Parse params
  const mode: OTPMode = useMemo(() => {
    const m = (params?.mode as string) || 'login';
    if (['login', 'register', 'reset_password', 'delete_account'].includes(m)) {
      return m as OTPMode;
    }
    return 'login';
  }, [params?.mode]);

  const emailFromParams = useMemo(() => {
    return normalizeEmail((params?.email as string) || '');
  }, [params?.email]);

  // State
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(APP_CONFIG.OTP_RESEND_SECONDS);
  const [userEmail, setUserEmail] = useState(emailFromParams);

  // Refs
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<TextInput>(null);

  // Config for current mode
  const config = MODE_CONFIG[mode];

  // ======================================
  // Timer Management
  // ======================================
  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    setSecondsLeft(APP_CONFIG.OTP_RESEND_SECONDS);

    timerRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          stopTimer();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [stopTimer]);

  // ======================================
  // Initialization
  // ======================================
  useEffect(() => {
    startTimer();

    // Focus input on mount
    setTimeout(() => inputRef.current?.focus(), 100);

    return () => stopTimer();
  }, [startTimer, stopTimer]);

  // Fetch email for delete_account mode
  useEffect(() => {
    if (mode === 'delete_account' && !userEmail) {
      (async () => {
        try {
          const userData = await UserDataManager.get<{ email?: string }>();
          if (userData?.email) {
            setUserEmail(normalizeEmail(userData.email));
          }
        } catch (error) {
          if (__DEV__) console.error('Failed to get user email:', error);
        }
      })();
    }
  }, [mode, userEmail]);

  // Validate register draft
  useEffect(() => {
    if (mode === 'register') {
      (async () => {
        try {
          const raw = await SecureStore.getItemAsync(REGISTER_DRAFT_KEY);
          if (!raw) {
            Alert.alert('Missing Data', 'Registration data was not found. Please register again.',
              [{ text: 'OK', onPress: () => router.replace('/register') }]);
            return;
          }
          const draft: RegisterDraft = JSON.parse(raw);
          if (normalizeEmail(draft.email) !== emailFromParams) {
            Alert.alert('Missing Data', 'Registration data was not found. Please register again.',
              [{ text: 'OK', onPress: () => router.replace('/register') }]);
          }
        } catch {
          Alert.alert('Missing Data', 'Registration data was not found. Please register again.',
            [{ text: 'OK', onPress: () => router.replace('/register') }]);
        }
      })();
    }
  }, [mode, emailFromParams, router]);

  // ======================================
  // Computed Values
  // ======================================
  const displayEmail = userEmail || emailFromParams;
  const canVerify = isValidOTP(code, APP_CONFIG.OTP_LENGTH) && !isLoading;
  const canResend = secondsLeft === 0 && !isLoading;

  // ======================================
  // Handlers
  // ======================================
  const handleCodeChange = useCallback((value: string) => {
    setCode(sanitizeOTP(value, APP_CONFIG.OTP_LENGTH));
  }, []);

  const handleVerify = useCallback(async () => {
    if (!canVerify) return;

    // Validate code
    if (!isValidOTP(code, APP_CONFIG.OTP_LENGTH)) {
      Alert.alert('Invalid Code', `Please enter the ${APP_CONFIG.OTP_LENGTH}-digit verification code.`);
      return;
    }

    // Mode-specific validation
    if (mode !== 'delete_account' && !displayEmail) {
      Alert.alert('Missing Email', 'Email is missing. Please go back and try again.');
      return;
    }

    // Handle reset_password mode - navigate to change password screen
    if (mode === 'reset_password') {
      router.push({
        pathname: '/change-password',
        params: { email: displayEmail, code },
      });
      return;
    }

    // Handle delete_account mode - show confirmation
    if (mode === 'delete_account') {
      Alert.alert(
        'Final Confirmation',
        'Are you sure you want to permanently delete your account? This action cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: handleDeleteAccount },
        ]
      );
      return;
    }

    // Handle login and register modes
    await handleVerifyCode();
  }, [canVerify, code, mode, displayEmail, router]);

  const handleVerifyCode = useCallback(async () => {
    setIsLoading(true);

    try {
      let endpoint = '';
      let body: Record<string, any> = { email: displayEmail, code };

      if (mode === 'register') {
        endpoint = ENDPOINTS.AUTH.REGISTER_VERIFY;

        const raw = await SecureStore.getItemAsync(REGISTER_DRAFT_KEY);
        if (!raw) {
          Alert.alert('Missing Data', 'Registration data not found. Please register again.');
          router.replace('/register');
          return;
        }
        const draft: RegisterDraft = JSON.parse(raw);

        body = {
          email: displayEmail,
          code,
          name: draft.name,
          password: draft.password,
          dob: draft.dob,
          country: draft.country,
          city: draft.city,
        };
      } else {
        endpoint = ENDPOINTS.AUTH.LOGIN_VERIFY;
      }

      const response = await api.post<any>(endpoint, body);

      if (!response.success) {
        Alert.alert('Verification Failed', response.message || 'Invalid or expired code.');
        return;
      }

      // Handle successful verification
      const { token, user } = response.data || {};

      if (token) {
        await login(token, user);
      }

      // Clear register draft from SecureStore
      if (mode === 'register') {
        await SecureStore.deleteItemAsync(REGISTER_DRAFT_KEY);
      }

      // Navigate
      if (token) {
        router.replace('/(tabs)');
      } else {
        Alert.alert('Success', 'Account verified successfully! Please login.');
        router.replace('/login');
      }
    } catch (error) {
      if (__DEV__) console.error('Verify code error:', error);
      Alert.alert('Connection Error', 'Could not connect to the server.');
    } finally {
      setIsLoading(false);
    }
  }, [displayEmail, code, mode, router]);

  const handleDeleteAccount = useCallback(async () => {
    setIsLoading(true);

    try {
      const token = await TokenManager.get();
      if (!token) {
        router.replace('/login');
        return;
      }

      const response = await api.post<any>(
        ENDPOINTS.USER.DELETE_CONFIRM,
        { code },
        { requireAuth: true }
      );

      if (!response.success) {
        Alert.alert('Deletion Failed', response.message || 'Invalid or expired code.');
        return;
      }

      // Clear all local data
      await UserDataManager.clear();

      const deletedDevices = response.data?.deletedDevices || 0;

      Alert.alert(
        'Account Deleted',
        `Your account has been permanently deleted.\n\n${deletedDevices} device(s) have been unpaired.`,
        [{ text: 'OK', onPress: () => router.replace('/login') }]
      );
    } catch (error) {
      if (__DEV__) console.error('Delete account error:', error);
      Alert.alert('Connection Error', 'Could not connect to the server.');
    } finally {
      setIsLoading(false);
    }
  }, [code, router]);

  const handleResend = useCallback(async () => {
    if (!canResend) return;

    setIsLoading(true);

    try {
      let endpoint = '';
      let body: Record<string, any> = {};
      let requireAuth = false;

      switch (mode) {
        case 'delete_account':
          endpoint = ENDPOINTS.USER.DELETE_SEND_CODE;
          requireAuth = true;
          break;
        case 'register':
          endpoint = ENDPOINTS.AUTH.REGISTER_SEND_CODE;
          body = { email: displayEmail };
          break;
        case 'login':
          endpoint = ENDPOINTS.AUTH.LOGIN_SEND_CODE;
          body = { email: displayEmail };
          // Note: login/send-code needs password, but we don't have it here
          // This is a limitation - user may need to go back to login
          Alert.alert(
            'Resend Code',
            'Please go back to the login screen and try again.',
            [{ text: 'OK', onPress: () => router.replace('/login') }]
          );
          return;
        case 'reset_password':
          endpoint = ENDPOINTS.AUTH.FORGOT_PASSWORD;
          body = { email: displayEmail };
          break;
      }

      const response = await api.post(endpoint, body, { requireAuth });

      if (response.success) {
        Alert.alert('Code Sent', 'A new verification code has been sent to your email.');
        startTimer();
        setCode('');
      } else {
        Alert.alert('Error', response.message || 'Failed to resend code.');
      }
    } catch (error) {
      if (__DEV__) console.error('Resend code error:', error);
      Alert.alert('Connection Error', 'Could not connect to the server.');
    } finally {
      setIsLoading(false);
    }
  }, [canResend, mode, displayEmail, startTimer, router]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  // ======================================
  // Render
  // ======================================
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
          onPress={handleBack}
          disabled={isLoading}
        >
          <Feather name="arrow-left" size={24} color={config.color} />
        </TouchableOpacity>

        {/* Icon */}
        <View style={[styles.iconContainer, { backgroundColor: `${config.color}15` }]}>
          <Feather name={config.icon} size={50} color={config.color} />
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: config.color }]}>{config.title}</Text>

        {/* Subtitle */}
        <Text style={styles.subtitle}>{config.subtitle}</Text>

        {/* Email */}
        {displayEmail && (
          <Text style={styles.emailText}>{displayEmail}</Text>
        )}

        {/* OTP Input */}
        <View style={[styles.inputContainer, { borderColor: config.color }]}>
          <Feather name="hash" size={22} color={config.color} style={styles.inputIcon} />
          <TextInput
            ref={inputRef}
            style={styles.inputField}
            placeholder="• • • • • •"
            placeholderTextColor="#CCC"
            value={code}
            onChangeText={handleCodeChange}
            keyboardType="number-pad"
            maxLength={APP_CONFIG.OTP_LENGTH}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            editable={!isLoading}
          />
        </View>

        {/* Verify Button */}
        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: config.color, shadowColor: config.color },
            !canVerify && styles.buttonDisabled,
          ]}
          onPress={handleVerify}
          disabled={!canVerify}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.buttonText}>{config.buttonText}</Text>
          )}
        </TouchableOpacity>

        {/* Resend Section */}
        <View style={styles.resendContainer}>
          {secondsLeft > 0 ? (
            <Text style={styles.resendTextDisabled}>
              Resend code in <Text style={styles.resendTimer}>{secondsLeft}s</Text>
            </Text>
          ) : (
            <TouchableOpacity onPress={handleResend} disabled={!canResend}>
              <Text style={[styles.resendTextActive, { color: config.color }]}>
                Resend Code
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
    alignItems: 'center',
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 20,
    zIndex: 10,
    padding: 10,
  },
  iconContainer: {
    marginTop: 40,
    marginBottom: 24,
    padding: 24,
    borderRadius: 50,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 8,
  },
  emailText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 32,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 2,
    height: 68,
    width: '100%',
    marginBottom: 24,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  inputIcon: {
    marginRight: 16,
  },
  inputField: {
    flex: 1,
    height: '100%',
    fontSize: 24,
    color: '#333',
    letterSpacing: 8,
    fontWeight: '600',
    textAlign: 'center',
  },
  button: {
    width: '100%',
    height: 58,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
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
  resendContainer: {
    marginTop: 8,
  },
  resendTextDisabled: {
    color: '#999',
    fontSize: 15,
  },
  resendTimer: {
    fontWeight: '700',
  },
  resendTextActive: {
    fontSize: 16,
    fontWeight: '700',
  },
});