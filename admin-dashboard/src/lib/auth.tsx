'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import { adminLoginSendCode, adminLoginVerifyCode } from './api';

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const savedToken = Cookies.get('admin_token');
    const savedAdmin = Cookies.get('admin_data');

    if (savedToken && savedAdmin) {
      try {
        setToken(savedToken);
        setAdmin(JSON.parse(savedAdmin));
      } catch {
        Cookies.remove('admin_token');
        Cookies.remove('admin_data');
      }
    }
    setLoading(false);
  }, []);

  const sendCode = async (email: string, password: string) => {
    await adminLoginSendCode(email, password);
  };

  const verifyCode = async (email: string, code: string) => {
    const res = await adminLoginVerifyCode(email, code);
    const { token: newToken, admin: adminData } = res.data;

    const cookieOptions = {
      expires: 7,
      sameSite: 'strict' as const,
      secure: window.location.protocol === 'https:',
    };
    Cookies.set('admin_token', newToken, cookieOptions);
    Cookies.set('admin_data', JSON.stringify(adminData), cookieOptions);

    setToken(newToken);
    setAdmin(adminData);
    router.push('/dashboard');
  };

  const logout = () => {
    Cookies.remove('admin_token');
    Cookies.remove('admin_data');
    setToken(null);
    setAdmin(null);
    router.push('/login');
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
