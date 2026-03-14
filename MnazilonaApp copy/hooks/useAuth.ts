// hooks/useAuth.ts

import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { TokenManager, UserDataManager } from '../utils/api';
import { logout as authLogout } from '../utils/auth';

export function useAuth() {
  const router = useRouter();

  const logout = useCallback(async (showAlert: boolean = false) => {
    await authLogout();
    
    if (showAlert) {
      Alert.alert('Session Expired', 'Please log in again.');
    }
    
    router.replace('/login');
  }, [router]);

  const handleAuthError = useCallback(async (status: number) => {
    if (status === 401) {
      await logout(true);
      return true;
    }
    return false;
  }, [logout]);

  const confirmLogout = useCallback(() => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Log Out', style: 'destructive', onPress: () => logout(false) },
      ]
    );
  }, [logout]);

  return {
    logout,
    handleAuthError,
    confirmLogout,
  };
}