'use client';

import { useEffect, useState, useCallback } from 'react';
import { getDashboard } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { getErrorMessage } from '@/lib/types';
import { useSocket } from '@/lib/socket';
import StatCard from '@/components/StatCard';
import { Users, Cpu, Wifi, WifiOff, ShieldAlert, Activity, Database, Radio, Zap } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface DashboardData {
  users: { total: number; active: number; inactive: number; newToday: number; newThisWeek: number };
  allowlist: { total: number; activated: number; inactive: number; banned: number; locked: number };
  devices: { paired: number; online: number; offline: number; byType: { type: string; count: number }[] };
  logs: { total: number; today: number; errors: number };
  services: { database: string; mqtt: string };
  recentActivity: { serialNumber: string; type: string; message: string; createdAt: string }[];
}

interface DeviceStatusEvent {
  serialNumber: string;
  isOnline: boolean;
  lastSeen: string;
  deviceType: string;
  name: string;
}

export default function DashboardPage() {
  const toast = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const { connected, on } = useSocket();
  const [liveEvents, setLiveEvents] = useState<{ serialNumber: string; isOnline: boolean; time: string }[]>([]);

  useEffect(() => {
    getDashboard()
      .then((res) => setData(res.data))
      .catch((err) => toast.error(getErrorMessage(err, 'Failed to load dashboard')))
      .finally(() => setLoading(false));
  }, [toast]);

  // Real-time device status updates
  const handleDeviceStatus = useCallback((event: unknown) => {
    const e = event as DeviceStatusEvent;
    setData((prev) => {
      if (!prev) return prev;
      const online = e.isOnline
        ? prev.devices.online + 1
        : Math.max(0, prev.devices.online - 1);
      const offline = e.isOnline
        ? Math.max(0, prev.devices.offline - 1)
        : prev.devices.offline + 1;
      return {
        ...prev,
        devices: { ...prev.devices, online, offline },
      };
    });

    setLiveEvents((prev) => [
      { serialNumber: e.serialNumber, isOnline: e.isOnline, time: new Date().toISOString() },
      ...prev.slice(0, 19),
    ]);
  }, []);

  // Real-time service status updates
  const handleServiceStatus = useCallback((event: unknown) => {
    const e = event as { mqtt?: string; database?: string };
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        services: {
          ...prev.services,
          ...(e.mqtt && { mqtt: e.mqtt }),
          ...(e.database && { database: e.database }),
        },
      };
    });
  }, []);

  useEffect(() => {
    const off1 = on('device:status', handleDeviceStatus);
    const off2 = on('service:status', handleServiceStatus);
    return () => { off1(); off2(); };
  }, [on, handleDeviceStatus, handleServiceStatus]);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 mt-1">System overview</p>
        </div>
        {/* Live connection indicator */}
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
          connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>
          <Zap size={14} className={connected ? 'text-green-600' : 'text-gray-400'} />
          {connected ? 'Live' : 'Connecting...'}
        </div>
      </div>

      {/* Service Status */}
      <div className="flex gap-3">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
          data.services.database === 'connected' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
        }`}>
          <Database size={14} />
          Database: {data.services.database === 'connected' ? 'Connected' : 'Disconnected'}
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
          data.services.mqtt === 'connected' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
        }`}>
          <Radio size={14} />
          MQTT: {data.services.mqtt === 'connected' ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Total Users" value={data.users.total} subtitle={`${data.users.newToday} new today`} icon={Users} color="blue" />
        <StatCard title="Online Devices" value={data.devices.online} subtitle={`of ${data.devices.paired} paired`} icon={Wifi} color="green" />
        <StatCard title="Offline Devices" value={data.devices.offline} icon={WifiOff} color="red" />
        <StatCard title="Banned Devices" value={data.allowlist.banned} subtitle={`${data.allowlist.locked} locked`} icon={ShieldAlert} color="yellow" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Allowlist Devices" value={data.allowlist.total} subtitle={`${data.allowlist.activated} activated`} icon={Cpu} color="purple" />
        <StatCard title="Logs Today" value={data.logs.today} subtitle={`${data.logs.errors} errors`} icon={Activity} color="blue" />
        <StatCard title="New Users This Week" value={data.users.newThisWeek} icon={Users} color="green" />
        <StatCard title="Inactive Users" value={data.users.inactive} icon={Users} color="red" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Devices by Type */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Devices by Type</h2>
          {data.devices.byType.length === 0 ? (
            <p className="text-gray-400 text-sm">No devices</p>
          ) : (
            <div className="space-y-3">
              {data.devices.byType.map((item) => (
                <div key={item.type} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 capitalize">{item.type}</span>
                  <div className="flex items-center gap-3">
                    <div className="w-32 bg-gray-100 rounded-full h-2">
                      <div
                        className="bg-blue-600 rounded-full h-2"
                        style={{ width: `${Math.min(100, (item.count / data.devices.paired) * 100)}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium w-8 text-right">{item.count}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {data.recentActivity.map((log, idx) => (
              <div key={idx} className="flex items-start gap-3 pb-3 border-b border-gray-50 last:border-0">
                <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${
                  log.type === 'error' ? 'bg-red-500' : log.type === 'warning' ? 'bg-yellow-500' : 'bg-green-500'
                }`} />
                <div className="min-w-0">
                  <p className="text-sm text-gray-700 truncate">{log.message}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-400 font-mono">{log.serialNumber}</span>
                    <span className="text-xs text-gray-300">&bull;</span>
                    <span className="text-xs text-gray-400">
                      {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live Device Events */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-lg font-semibold">Live Events</h2>
            {connected && (
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
              </span>
            )}
          </div>
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {liveEvents.length === 0 ? (
              <p className="text-gray-400 text-sm">Waiting for device events...</p>
            ) : (
              liveEvents.map((event, idx) => (
                <div key={idx} className="flex items-center gap-3 pb-3 border-b border-gray-50 last:border-0">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${event.isOnline ? 'bg-green-500' : 'bg-red-500'}`} />
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-mono text-gray-600">{event.serialNumber}</span>
                    <span className={`ml-2 text-xs font-medium ${event.isOnline ? 'text-green-600' : 'text-red-600'}`}>
                      {event.isOnline ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {formatDistanceToNow(new Date(event.time), { addSuffix: true })}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
