import * as SecureStore from "expo-secure-store";

const USER_KEY = "mnazilona_user";

export type StoredUser = {
  name?: string;
  email?: string;
  city?: string;
};

export async function saveUser(user: StoredUser) {
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
}

export async function getUser(): Promise<StoredUser | null> {
  const raw = await SecureStore.getItemAsync(USER_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function clearUser() {
  await SecureStore.deleteItemAsync(USER_KEY);
}
