'use client';

import { useEffect, useState, useCallback } from 'react';
import { getRateLimits } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { getErrorMessage } from '@/lib/types';
import { useSocket } from '@/lib/socket';
import { ShieldBan, Zap, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface RateLimitStats {
  [key: string]: { total: number; blocked: number };
}

interface RateLimitEvent {
  type: string;
  ip: string;
  path: string;
  timestamp: string;
}

interface TopOffender {
  ip: string;
  count: number;
}

interface RateLimitData {
  stats: RateLimitStats;
  recentEvents: RateLimitEvent[];
  topOffenders: TopOffender[];
}

const typeLabels: Record<string, string> = {
  api: 'API General',
  otp_send: 'OTP Send',
  otp_verify: 'OTP Verify',
  login: 'Login',
  strict: 'Strict',
  device_inquiry: 'Device Inquiry',
};

const typeColors: Record<string, string> = {
  api: 'bg-blue-100 text-blue-700',
  otp_send: 'bg-purple-100 text-purple-700',
  otp_verify: 'bg-indigo-100 text-indigo-700',
  login: 'bg-orange-100 text-orange-700',
  strict: 'bg-red-100 text-red-700',
  device_inquiry: 'bg-teal-100 text-teal-700',
};

export default function RateLimitsPage() {
  const toast = useToast();
  const [data, setData] = useState<RateLimitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveHits, setLiveHits] = useState<RateLimitEvent[]>([]);
  const { connected, on } = useSocket();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getRateLimits();
      setData(res.data);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to load rate limits')); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Real-time rate limit hits
  const handleRateLimitHit = useCallback((event: unknown) => {
    const e = event as RateLimitEvent;
    setLiveHits((prev) => [e, ...prev.slice(0, 49)]);
  }, []);

  useEffect(() => {
    const off = on('ratelimit:hit', handleRateLimitHit);
    return off;
  }, [on, handleRateLimitHit]);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  const allEvents = [...liveHits, ...data.recentEvents].slice(0, 100);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rate Limit Monitor</h1>
          <p className="text-gray-500 mt-1">Track blocked requests and rate limit events</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
            connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}>
            <Zap size={14} />
            {connected ? 'Live' : 'Connecting...'}
          </div>
          <button onClick={fetchData}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors">
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {Object.entries(data.stats).map(([key, val]) => (
          <div key={key} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">{typeLabels[key] || key}</p>
            <p className="text-2xl font-bold text-gray-900">{val.blocked}</p>
            <p className="text-xs text-gray-400 mt-1">blocked</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Top Offenders */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <ShieldBan size={18} className="text-red-500" />
            <h2 className="text-lg font-semibold">Top Offenders</h2>
          </div>
          {data.topOffenders.length === 0 ? (
            <p className="text-gray-400 text-sm">No offenders recorded</p>
          ) : (
            <div className="space-y-3">
              {data.topOffenders.map((offender, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <span className="font-mono text-sm text-gray-700">{offender.ip}</span>
                  <span className="bg-red-100 text-red-700 px-2.5 py-0.5 rounded-full text-xs font-medium">
                    {offender.count} hits
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Events */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-lg font-semibold">Recent Blocked Requests</h2>
            {connected && liveHits.length > 0 && (
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
              </span>
            )}
          </div>
          <div className="max-h-[500px] overflow-y-auto">
            {allEvents.length === 0 ? (
              <p className="text-gray-400 text-sm">No rate limit events recorded</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 text-gray-500 font-medium">Time</th>
                    <th className="text-left py-2 text-gray-500 font-medium">Type</th>
                    <th className="text-left py-2 text-gray-500 font-medium">IP</th>
                    <th className="text-left py-2 text-gray-500 font-medium">Path</th>
                  </tr>
                </thead>
                <tbody>
                  {allEvents.map((event, idx) => (
                    <tr key={idx} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 text-xs text-gray-400">
                        {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                      </td>
                      <td className="py-2">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[event.type] || 'bg-gray-100 text-gray-600'}`}>
                          {typeLabels[event.type] || event.type}
                        </span>
                      </td>
                      <td className="py-2 font-mono text-xs text-gray-600">{event.ip}</td>
                      <td className="py-2 font-mono text-xs text-gray-500 max-w-xs truncate">{event.path}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
