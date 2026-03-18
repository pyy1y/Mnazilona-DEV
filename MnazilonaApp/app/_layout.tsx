// app/_layout.tsx

import React, { useEffect, useState, useCallback } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Slot, useRouter, useSegments, useGlobalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { checkAuthState } from '../utils/auth';

const ONBOARDING_KEY = 'onboarding_seen';

const BRAND_COLOR = '#2E5B8E';

// ✅ أضفت change-password للصفحات العامة
const PUBLIC_ROUTES = [
  'login',
  'register',
  'forgot-password',
  'reset-password',
  'change-password',
  'onboarding',
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

  const mode = (searchParams?.mode as string) || '';

  const checkAuth = useCallback(async () => {
    try {
      const currentSegment = segments[0] as string | undefined;

      // تحقق إذا المستخدم شاف الـ onboarding أو لا (نقرأ من AsyncStorage كل مرة)
      const onboardingSeen = await AsyncStorage.getItem(ONBOARDING_KEY);

      // إذا ما شاف الـ onboarding وهو مو فيها حالياً -> وجهه للـ onboarding
      if (!onboardingSeen && currentSegment !== 'onboarding') {
        router.replace('/onboarding' as any);
        return;
      }

      // إذا هو في صفحة الـ onboarding خله فيها بدون تحقق auth
      if (currentSegment === 'onboarding') {
        return;
      }

      const { isAuthenticated } = await checkAuthState();

      const inTabs = currentSegment === '(tabs)';

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

      if (!isAuthenticated && isProtectedRoute) {
        router.replace('/login');
        return;
      }

      if (isAuthenticated && isPublicRoute) {
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