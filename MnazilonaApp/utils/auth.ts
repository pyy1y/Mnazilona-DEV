// utils/auth.ts

// ✅ Store and remove user display info (name/email) locally in SecureStore
import { saveUser, clearUser } from './userStorage';

import { jwtDecode } from 'jwt-decode';
import { TokenManager, UserDataManager } from './api';

// ======================================
// Types
// ======================================
export interface DecodedToken {
  id?: string;
  _id?: string;
  email?: string;
  name?: string;
  exp?: number;
  iat?: number;
}

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

// ======================================
// Token Validation
// ======================================
export function isTokenExpired(token: string): boolean {
  try {
    const decoded = jwtDecode<DecodedToken>(token);
    if (!decoded.exp) return false;
    
    // Add 10 second buffer for network latency
    const nowSec = Math.floor(Date.now() / 1000);
    return decoded.exp <= nowSec + 10;
  } catch {
    return true;
  }
}

export function decodeToken(token: string): DecodedToken | null {
  try {
    return jwtDecode<DecodedToken>(token);
  } catch {
    return null;
  }
}

export function getUserFromToken(token: string): AuthUser | null {
  const decoded = decodeToken(token);
  if (!decoded) return null;

  const id = decoded.id || decoded._id;
  if (!id) return null;

  return {
    id,
    email: decoded.email || '',
    name: decoded.name,
  };
}

// ======================================
// Auth State Management
// ======================================
export async function checkAuthState(): Promise<{
  isAuthenticated: boolean;
  user: AuthUser | null;
  token: string | null;
}> {
  try {
    const token = await TokenManager.get();
    
    if (!token) {
      return { isAuthenticated: false, user: null, token: null };
    }

    if (isTokenExpired(token)) {
      await logout();
      return { isAuthenticated: false, user: null, token: null };
    }

    const user = getUserFromToken(token);
    if (!user) {
      await logout();
      return { isAuthenticated: false, user: null, token: null };
    }

    return { isAuthenticated: true, user, token };
  } catch {
    await logout();
    return { isAuthenticated: false, user: null, token: null };
  }
}

export async function login(
  token: string,
  userData?: Record<string, any>
): Promise<boolean> {
  try {
    if (isTokenExpired(token)) return false;

    // 1) Save token
    await TokenManager.set(token);

    // 2) Extract from token (preferred)
    const userFromToken = getUserFromToken(token);

    // 3) Decide best display info
    const name =
      userFromToken?.name ??
      userData?.name ??
      userData?.fullName ??
      userData?.username ??
      undefined;

    const email =
      userFromToken?.email ??
      userData?.email ??
      undefined;

      const city =
  userData?.city ??
  userData?.location ??
  userData?.userCity ??
  undefined;

    // 4) ✅ Save for UI greeting
    await saveUser({ name, email, city });

    // 5) Keep optional userData storage (as you already do)
    if (userData) {
      await UserDataManager.set(userData);
    }

    return true;
  } catch (e) {
    if (__DEV__) console.error("login() failed:", e);
    return false;
  }
}

export async function logout(): Promise<void> {
  await UserDataManager.clear();
  await TokenManager.remove(); // إذا عندك clear
  await clearUser();           // ✅ يمسح الاسم من SecureStore
}

// ======================================
// Session Refresh Helper
// ======================================
export function getTokenExpiryTime(token: string): number | null {
  const decoded = decodeToken(token);
  if (!decoded?.exp) return null;
  return decoded.exp * 1000; // Convert to milliseconds
}

export function getTimeUntilExpiry(token: string): number {
  const expiryTime = getTokenExpiryTime(token);
  if (!expiryTime) return 0;
  return Math.max(0, expiryTime - Date.now());
}