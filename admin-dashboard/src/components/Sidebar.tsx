'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Cpu,
  ListChecks,
  ScrollText,
  Shield,
  ClipboardList,
  ShieldBan,
  Package,
  Ban,
  AlertTriangle,
  LogOut,
} from 'lucide-react';
import { APP_NAME } from '@/app/constants';
import { useAuth } from '@/lib/auth';

const navItems = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/devices', label: 'Devices', icon: Cpu },
  { href: '/admin/allowlist', label: 'Allowlist', icon: ListChecks },
  { href: '/admin/logs', label: 'Logs', icon: ScrollText },
  { href: '/admin/security', label: 'Security', icon: Shield },
  { href: '/admin/firmware', label: 'Firmware', icon: Package },
  { href: '/admin/audit', label: 'Audit Log', icon: ClipboardList },
  { href: '/admin/rate-limits', label: 'Rate Limits', icon: ShieldBan },
  { href: '/admin/ip-blacklist', label: 'IP Blacklist', icon: Ban },
  { href: '/admin/anomalies', label: 'Anomalies', icon: AlertTriangle },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { admin, logout } = useAuth();

  return (
    <aside className="w-64 bg-gray-900 text-white min-h-screen flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-gray-800">
        <h1 className="text-xl font-bold">{APP_NAME.en}</h1>
        <p className="text-gray-400 text-sm mt-1">Admin Dashboard</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive =
            item.href === '/admin'
              ? pathname === '/admin'
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <item.icon size={20} />
              <span className="text-sm font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Admin Info */}
      <div className="p-4 border-t border-gray-800">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{admin?.name}</p>
            <p className="text-xs text-gray-400 truncate">{admin?.email}</p>
          </div>
          <button
            onClick={logout}
            className="p-2 text-gray-400 hover:text-red-400 transition-colors"
            title="Logout"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </aside>
  );
}
