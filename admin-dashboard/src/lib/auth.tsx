'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSession = useCallback(() => {
    Cookies.remove('admin_token');
    Cookies.remove('admin_refresh_token');
    setToken(null);
    setAdmin(null);
    // Tear down the singleton socket so the next login doesn't reuse a
    // connection authenticated with the previous admin's token.
    disconnectSocket();
  }, []);

  const logout = useCallback(() => {
    clearSession();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    router.push('/admin/login');
  }, [clearSession, router]);

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
    const savedToken = Cookies.get('admin_token');

    if (savedToken) {
      setToken(savedToken);
      // Validate token by fetching dashboard (lightweight check)
      getDashboard()
        .then(() => {
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
    Cookies.set('admin_token', newToken, COOKIE_OPTIONS);
    Cookies.set('admin_refresh_token', refreshToken, { ...COOKIE_OPTIONS, expires: 7 });

    setToken(newToken);
    setAdmin(adminData);
    router.push('/admin');
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
