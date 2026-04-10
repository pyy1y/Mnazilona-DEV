// app/login.tsx

import React, { useState, useRef, useMemo, useCallback } from 'react';
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
import { useRouter, Link } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { api } from '../utils/api';
import { ENDPOINTS } from '../constants/api';
import { isValidEmail, normalizeEmail } from '../utils/validation';

const BRAND_COLOR = '#2E5B8E';

export default function LoginScreen() {
  const router = useRouter();

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Refs
  const passwordRef = useRef<TextInput>(null);

  // Computed values
  const normalizedEmail = useMemo(() => normalizeEmail(email), [email]);

  const isFormValid = useMemo(() => {
    return isValidEmail(email) && password.trim().length > 0 && !isLoading;
  }, [email, password, isLoading]);

  // Handlers
  const togglePasswordVisibility = useCallback(() => {
    setIsPasswordVisible(prev => !prev);
  }, []);

  const handleLogin = useCallback(async () => {
    if (isLoading) return;

    // Validation
    if (!normalizedEmail) {
      Alert.alert('Missing Email', 'Please enter your email address.');
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }

    if (!password.trim()) {
      Alert.alert('Missing Password', 'Please enter your password.');
      return;
    }

    setIsLoading(true);

    try {
      const response = await api.post(ENDPOINTS.AUTH.LOGIN_SEND_CODE, {
        email: normalizedEmail,
        password: password,
      });

      if (!response.success) {
        Alert.alert('Login Failed', response.message || 'Invalid email or password.');
        return;
      }

      // Navigate to OTP screen
      router.push({
        pathname: '/otp',
        params: {
          mode: 'login',
          email: normalizedEmail,
        },
      });
    } catch (error) {
      if (__DEV__) console.error('Login error:', error);
      Alert.alert('Connection Error', 'Could not connect to the server. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [normalizedEmail, password, isLoading, router]);

  const handleForgotPassword = useCallback(() => {
    router.push('/forgot-password');
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
        {/* Icon */}
        <View style={styles.iconContainer}>
          <Feather name="log-in" size={50} color={BRAND_COLOR} />
        </View>

        {/* Header */}
        <Text style={styles.headerTitle}>Welcome Back</Text>
        <Text style={styles.subtitle}>Sign in to continue to your smart home</Text>

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
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            editable={!isLoading}
          />
        </View>

        {/* Password Input */}
        <View style={styles.inputContainer}>
          <Feather name="lock" size={20} color={BRAND_COLOR} style={styles.inputIcon} />
          <TextInput
            ref={passwordRef}
            style={styles.inputField}
            placeholder="Password"
            placeholderTextColor="#999"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!isPasswordVisible}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="password"
            textContentType="password"
            returnKeyType="done"
            onSubmitEditing={handleLogin}
            editable={!isLoading}
          />
          <TouchableOpacity
            onPress={togglePasswordVisibility}
            style={styles.eyeIcon}
            disabled={isLoading}
          >
            <Feather
              name={isPasswordVisible ? 'eye' : 'eye-off'}
              size={20}
              color={BRAND_COLOR}
            />
          </TouchableOpacity>
        </View>

        {/* Forgot Password */}
        <TouchableOpacity
          style={styles.forgotContainer}
          onPress={handleForgotPassword}
          disabled={isLoading}
        >
          <Text style={styles.forgotLink}>Forgot Password?</Text>
        </TouchableOpacity>

        {/* Login Button */}
        <TouchableOpacity
          style={[styles.button, !isFormValid && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={!isFormValid}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.buttonText}>Login</Text>
          )}
        </TouchableOpacity>

        {/* Register Link */}
        <Link href="/register" asChild>
          <TouchableOpacity style={styles.linkContainer} disabled={isLoading}>
            <Text style={styles.linkText}>
              Don't have an account?{' '}
              <Text style={styles.linkHighlight}>Sign Up</Text>
            </Text>
          </TouchableOpacity>
        </Link>
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
    paddingTop: 80,
    paddingBottom: 30,
    justifyContent: 'center',
  },
  iconContainer: {
    alignSelf: 'center',
    marginBottom: 24,
    padding: 20,
    backgroundColor: '#F0F4F8',
    borderRadius: 50,
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: '700',
    color: BRAND_COLOR,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 40,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    height: 60,
    marginBottom: 16,
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
  forgotContainer: {
    alignSelf: 'flex-end',
    marginBottom: 24,
    marginTop: -4,
  },
  forgotLink: {
    color: BRAND_COLOR,
    fontSize: 14,
    fontWeight: '600',
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
    marginTop: 10,
  },
  linkText: {
    color: '#666',
    fontSize: 15,
  },
  linkHighlight: {
    color: BRAND_COLOR,
    fontWeight: '700',
  },
});