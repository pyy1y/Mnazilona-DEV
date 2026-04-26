// app/_layout.tsx

import React, { useEffect, useState, useCallback } from 'react';
import { View, ActivityIndicator, StyleSheet, Alert, Platform } from 'react-native';
import { Slot, useRouter, useSegments, useGlobalSearchParams } from 'expo-router';
import { checkAuthState, logout } from '../utils/auth';
import { setAuthExpiredHandler } from '../utils/api';
import { hasSeenOnboarding } from '../utils/onboarding';

const BRAND_COLOR = '#2E5B8E';

// ✅ أضفت change-password للصفحات العامة
const PUBLIC_ROUTES = [
  'onboarding',
  'login',
  'register',
  'forgot-password',
  'reset-password',
  'change-password',  // ✅ مهم جداً!
] as const;

// الصفحات المحمية خارج tabs
const PROTECTED_ROUTES = ['settings', 'pairing'] as const;

type PublicRoute = (typeof PUBLIC_ROUTES)[number];
type ProtectedRoute = (typeof PROTECTED_ROUTES)[number];

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const searchParams = useGlobalSearchParams();

  const [isReady, setIsReady] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  // Sanitize deep link params to prevent injection
  const ALLOWED_MODES = ['login', 'register', 'reset_password', 'delete_account'];
  const rawMode = (searchParams?.mode as string) || '';
  const mode = ALLOWED_MODES.includes(rawMode) ? rawMode : '';

  const checkAuth = useCallback(async () => {
    try {
      const { isAuthenticated } = await checkAuthState();
      const onboardingSeen = await hasSeenOnboarding();

      const currentSegment = segments[0] as string | undefined;
      const inTabs = currentSegment === '(tabs)';

      if (!currentSegment) {
        router.replace(isAuthenticated ? '/(tabs)' : onboardingSeen ? '/login' : '/onboarding');
        return;
      }

      // OTP خاصة - تعتبر public إلا لو delete_account
      const isOtpPublic = currentSegment === 'otp' && mode !== 'delete_account';
      const isOtpProtected = currentSegment === 'otp' && mode === 'delete_account';

      // تحقق من نوع الصفحة
      const isPublicRoute =
        PUBLIC_ROUTES.includes(currentSegment as PublicRoute) || isOtpPublic;
      const isProtectedRoute =
        inTabs ||
        PROTECTED_ROUTES.includes(currentSegment as ProtectedRoute) ||
        isOtpProtected;

      if (!isAuthenticated && !onboardingSeen && currentSegment !== 'onboarding') {
        router.replace('/onboarding');
        return;
      }

      if (!isAuthenticated && onboardingSeen && currentSegment === 'onboarding') {
        router.replace('/login');
        return;
      }

      if (!isAuthenticated && isProtectedRoute) {
        // المستخدم مو مسجل ويحاول يدخل صفحة محمية
        router.replace('/login');
        return;
      }

      if (isAuthenticated && isPublicRoute) {
        // المستخدم مسجل ويحاول يدخل صفحة عامة (login/register)
        // ✅ لكن نستثني change-password لأنه يمكن يغير باسورده وهو مسجل
        if (currentSegment !== 'change-password') {
          router.replace('/(tabs)');
          return;
        }
      }
    } catch (error) {
      if (__DEV__) console.error('Auth check error:', error);
      router.replace('/login');
    } finally {
      setIsChecking(false);
      setIsReady(true);
    }
  }, [router, segments, mode]);

  // Jailbreak/root detection warning
  useEffect(() => {
    const checkDeviceIntegrity = () => {
      if (Platform.OS === 'android') {
        // Check for common root indicators via global object properties
        const g = globalThis as any;
        if (g.__is_rooted || g.RootBeer) {
          Alert.alert(
            'Security Warning',
            'This device appears to be rooted. Your smart home data may be at risk.',
            [{ text: 'I Understand' }]
          );
        }
      }
      // iOS jailbreak detection requires native modules (e.g. checking for Cydia paths)
      // which are not accessible from Expo managed workflow JS layer.
      // For production, consider expo-dev-client with a native jailbreak detection library.
    };
    checkDeviceIntegrity();
  }, []);

  // Register global 401 handler for auto-logout
  useEffect(() => {
    setAuthExpiredHandler(async () => {
      await logout();
      router.replace('/login');
    });
  }, [router]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Loading screen
  if (!isReady || isChecking) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={BRAND_COLOR} />
      </View>
    );
  }

  return <Slot />;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
});
