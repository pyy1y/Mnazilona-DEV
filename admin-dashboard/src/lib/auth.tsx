'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import { adminPath } from './adminRoutes';
import { adminLoginSendCode, adminLoginVerifyCode, getDashboard } from './api';
import { disconnectSocket } from './socket';

interface Admin {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface AuthContextType {
  admin: Admin | null;
  token: string | null;
  loading: boolean;
  sendCode: (email: string, password: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Session timeout: 30 minutes of inactivity
const SESSION_TIMEOUT = 30 * 60 * 1000;

const COOKIE_OPTIONS = {
  expires: 7,
  sameSite: 'strict' as const,
  // When you get a domain with HTTPS, this will auto-enable secure cookies
  secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
  path: '/',
};

const TOKEN_KEY = 'admin_token';
const REFRESH_TOKEN_KEY = 'admin_refresh_token';
const ADMIN_KEY = 'admin';

const getStoredToken = () =>
  Cookies.get(TOKEN_KEY) || (typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_KEY) : null);

const getStoredAdmin = (): Admin | null => {
  if (typeof window === 'undefined') return null;
  const savedAdmin = window.localStorage.getItem(ADMIN_KEY);
  if (!savedAdmin) return null;
  try {
    return JSON.parse(savedAdmin);
  } catch {
    window.localStorage.removeItem(ADMIN_KEY);
    return null;
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSession = useCallback(() => {
    Cookies.remove(TOKEN_KEY);
    Cookies.remove(REFRESH_TOKEN_KEY);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(REFRESH_TOKEN_KEY);
      window.localStorage.removeItem(ADMIN_KEY);
    }
    setToken(null);
    setAdmin(null);
    // Tear down the singleton socket so the next login doesn't reuse a
    // connection authenticated with the previous admin's token.
    disconnectSocket();
  }, []);

  const logout = useCallback(() => {
    clearSession();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    router.push(adminPath('/login', pathname));
  }, [clearSession, pathname, router]);

  // Session timeout: reset on user activity
  const resetSessionTimeout = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      logout();
    }, SESSION_TIMEOUT);
  }, [logout]);

  // Track user activity for session timeout
  useEffect(() => {
    if (!token) return;

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    const handler = () => resetSessionTimeout();

    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    resetSessionTimeout();

    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [token, resetSessionTimeout]);

  // On mount: validate token by making an API call instead of trusting cookie data
  useEffect(() => {
    const savedToken = getStoredToken();

    if (savedToken) {
      setToken(savedToken);
      // Validate token by fetching dashboard (lightweight check)
      getDashboard()
        .then(() => {
          const savedAdmin = getStoredAdmin();
          if (savedAdmin) {
            setAdmin(savedAdmin);
            return;
          }
          // Token is valid - decode admin info from token payload
          try {
            const payload = JSON.parse(atob(savedToken.split('.')[1]));
            setAdmin({
              id: payload.id || payload.sub || '',
              name: payload.name || '',
              email: payload.email || '',
              role: payload.role || 'admin',
            });
          } catch {
            // If token can't be decoded, clear it
            clearSession();
          }
        })
        .catch(() => {
          // Token is invalid/expired
          clearSession();
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [clearSession]);

  const sendCode = async (email: string, password: string) => {
    await adminLoginSendCode(email, password);
  };

  const verifyCode = async (email: string, code: string) => {
    const res = await adminLoginVerifyCode(email, code);
    const { token: newToken, refreshToken, admin: adminData } = res.data;

    // Store access token (short-lived) and refresh token (long-lived)
    Cookies.set(TOKEN_KEY, newToken, COOKIE_OPTIONS);
    Cookies.set(REFRESH_TOKEN_KEY, refreshToken, { ...COOKIE_OPTIONS, expires: 7 });
    window.localStorage.setItem(TOKEN_KEY, newToken);
    window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    window.localStorage.setItem(ADMIN_KEY, JSON.stringify(adminData));

    setToken(newToken);
    setAdmin(adminData);
    router.replace('/admin');
    router.refresh();
  };

  return (
    <AuthContext.Provider value={{ admin, token, loading, sendCode, verifyCode, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
