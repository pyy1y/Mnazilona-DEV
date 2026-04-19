'use client';

import { useEffect, useState } from 'react';
import { getSecurityOverview, unbanDevice } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { getErrorMessage } from '@/lib/types';
import { ShieldAlert, Lock, Ban, AlertTriangle, Activity } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface SecurityData {
  lockedDevices: { serialNumber: string; failedAttempts: number; lockedUntil: string; lastFailedAttempt: string }[];
  bannedDevices: { serialNumber: string; banReason: string | null }[];
  suspiciousDevices: { serialNumber: string; failedAttempts: number; lastFailedAttempt: string; lockedUntil: string | null }[];
  recentFailedInquiries: { serialNumber: string; message: string; createdAt: string }[];
  inactiveUsers: number;
  recentAdminActions: { action: string; target: string; adminEmail: string; createdAt: string }[];
}

const actionLabels: Record<string, string> = {
  admin_login: 'Admin Login',
  user_deactivate: 'User Deactivated',
  user_activate: 'User Activated',
  user_delete: 'User Deleted',
  user_force_logout: 'Force Logout',
  device_register: 'Device Registered',
  device_ban: 'Device Banned',
  device_unban: 'Device Unbanned',
  device_command: 'Command Sent',
  device_unpair: 'Device Unpaired',
  device_transfer: 'Device Transferred',
  device_factory_reset: 'Factory Reset',
};

export default function SecurityPage() {
  const toast = useToast();
  const [data, setData] = useState<SecurityData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = () => {
    setLoading(true);
    getSecurityOverview()
      .then((res) => setData(res.data))
      .catch((err) => toast.error(getErrorMessage(err, 'Failed to load security data')))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const handleUnban = async (serial: string) => {
    try {
      await unbanDevice(serial);
      toast.success(`Device ${serial} unbanned`);
      fetchData();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to unban device')); }
  };

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Security Monitor</h1>
        <p className="text-gray-500 mt-1">Monitor threats and suspicious activity</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-red-700">
            <Lock size={18} />
            <span className="font-medium">Locked Devices</span>
          </div>
          <p className="text-2xl font-bold text-red-800 mt-2">{data.lockedDevices.length}</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-red-700">
            <Ban size={18} />
            <span className="font-medium">Banned Devices</span>
          </div>
          <p className="text-2xl font-bold text-red-800 mt-2">{data.bannedDevices.length}</p>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-yellow-700">
            <AlertTriangle size={18} />
            <span className="font-medium">Suspicious Devices</span>
          </div>
          <p className="text-2xl font-bold text-yellow-800 mt-2">{data.suspiciousDevices.length}</p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-gray-700">
            <ShieldAlert size={18} />
            <span className="font-medium">Inactive Users</span>
          </div>
          <p className="text-2xl font-bold text-gray-800 mt-2">{data.inactiveUsers}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Locked Devices */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Lock size={18} className="text-red-600" /> Locked Devices (Failed Attempts)
          </h2>
          {data.lockedDevices.length === 0 ? (
            <p className="text-gray-400 text-sm">No locked devices</p>
          ) : (
            <div className="space-y-3">
              {data.lockedDevices.map((d) => (
                <div key={d.serialNumber} className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                  <div>
                    <p className="font-mono text-sm font-medium">{d.serialNumber}</p>
                    <p className="text-xs text-red-600">{d.failedAttempts} failed attempts</p>
                    <p className="text-xs text-gray-500">
                      Unlocks {formatDistanceToNow(new Date(d.lockedUntil), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Banned Devices */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Ban size={18} className="text-red-600" /> Banned Devices
          </h2>
          {data.bannedDevices.length === 0 ? (
            <p className="text-gray-400 text-sm">No banned devices</p>
          ) : (
            <div className="space-y-3">
              {data.bannedDevices.map((d) => (
                <div key={d.serialNumber} className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                  <div>
                    <p className="font-mono text-sm font-medium">{d.serialNumber}</p>
                    <p className="text-xs text-gray-500">{d.banReason || 'No reason'}</p>
                  </div>
                  <button onClick={() => handleUnban(d.serialNumber)}
                    className="text-xs bg-white text-green-600 border border-green-300 px-3 py-1 rounded-lg hover:bg-green-50">
                    Unban
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Suspicious Devices */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <AlertTriangle size={18} className="text-yellow-600" /> Suspicious Devices
          </h2>
          {data.suspiciousDevices.length === 0 ? (
            <p className="text-gray-400 text-sm">No suspicious devices</p>
          ) : (
            <div className="space-y-3">
              {data.suspiciousDevices.map((d) => (
                <div key={d.serialNumber} className="p-3 bg-yellow-50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-sm font-medium">{d.serialNumber}</p>
                    <span className="text-xs bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded-full">
                      {d.failedAttempts} attempts
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Last attempt {formatDistanceToNow(new Date(d.lastFailedAttempt), { addSuffix: true })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Admin Actions */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Activity size={18} className="text-blue-600" /> Recent Admin Actions (24h)
          </h2>
          {data.recentAdminActions.length === 0 ? (
            <p className="text-gray-400 text-sm">No recent actions</p>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {data.recentAdminActions.map((a, idx) => (
                <div key={idx} className="flex items-start gap-3 pb-3 border-b border-gray-50 last:border-0">
                  <div className="w-2 h-2 rounded-full mt-2 shrink-0 bg-blue-500" />
                  <div>
                    <p className="text-sm">{actionLabels[a.action] || a.action}: <span className="font-medium">{a.target}</span></p>
                    <div className="flex gap-2 mt-1">
                      <span className="text-xs text-gray-400">{a.adminEmail}</span>
                      <span className="text-xs text-gray-400">
                        {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
