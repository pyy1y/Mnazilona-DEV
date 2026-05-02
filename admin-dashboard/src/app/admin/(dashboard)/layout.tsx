'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useSocket } from '@/lib/socket';
import Sidebar from '@/components/Sidebar';

// Persistent banner shown when the admin socket is disconnected — gives the
// admin an honest "data may be stale" signal instead of silently letting
// the dashboard show old state. Mounting from the layout also opens the
// socket eagerly, before any page mounts.
function ConnectionBanner() {
  const { connected } = useSocket();
  if (connected) return null;
  return (
    <div className="bg-amber-100 text-amber-900 text-sm px-4 py-2 border-b border-amber-300">
      Connection lost — live updates paused. Data may be stale until the connection is restored.
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { admin, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !admin) {
      router.replace('/admin/login');
    }
  }, [admin, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!admin) return null;

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <ConnectionBanner />
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
