// app/reset-password.tsx
// Note: This screen is now mainly a redirect to forgot-password
// The actual password reset flow is: forgot-password -> otp -> change-password

import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

const BRAND_COLOR = '#2E5B8E';

export default function ResetPasswordScreen() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to the proper forgot-password flow
    router.replace('/forgot-password');
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={BRAND_COLOR} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
});