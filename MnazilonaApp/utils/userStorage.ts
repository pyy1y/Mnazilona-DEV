import AsyncStorage from "@react-native-async-storage/async-storage";

const USER_KEY = "mnazilona_user";

export type StoredUser = {
  name?: string;
  email?: string;
  city?: string;
};

export async function saveUser(user: StoredUser) {
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
}

export async function getUser(): Promise<StoredUser | null> {
  const raw = await AsyncStorage.getItem(USER_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function clearUser() {
  await AsyncStorage.removeItem(USER_KEY);
}