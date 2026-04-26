import AsyncStorage from '@react-native-async-storage/async-storage';

export const ONBOARDING_KEY = 'onboarding_seen';

export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_KEY)) === 'true';
  } catch {
    return false;
  }
}

export async function setOnboardingSeen(seen: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_KEY, seen ? 'true' : 'false');
  } catch {
    if (__DEV__) console.error('Failed to update onboarding state');
  }
}
