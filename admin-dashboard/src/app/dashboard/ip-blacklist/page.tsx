'use client';

import { useEffect, useState, useCallback } from 'react';
import { getBlacklist, blockIP, unblockIP, deleteBlacklistEntry } from '@/lib/api';
import DataTable from '@/components/DataTable';
import StatusBadge from '@/components/StatusBadge';
import { Search, Plus, Trash2, ShieldOff } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface BlacklistEntry {
  _id: string;
  ip: string;
  reason: string;
  source: string;
  blockedBy: { name: string; email: string } | null;
  expiresAt: string | null;
  hitCount: number;
  lastHitAt: string | null;
  isActive: boolean;
  createdAt: string;
}

const sourceLabels: Record<string, string> = {
  manual: 'Manual',
  anomaly_detector: 'Auto-Detected',
  rate_limit: 'Rate Limit',
};

const sourceColors: Record<string, string> = {
  manual: 'bg-blue-100 text-blue-700',
  anomaly_detector: 'bg-red-100 text-red-700',
  rate_limit: 'bg-yellow-100 text-yellow-700',
};

export default function IPBlacklistPage() {
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ ip: '', reason: '', duration: '' });

  const fetchEntries = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 50, active: 'true' };
      if (search) params.search = search;
      if (sourceFilter) params.source = sourceFilter;
      const res = await getBlacklist(params);
      setEntries(res.data.entries);
      setPagination(res.data.pagination);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [search, sourceFilter]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const handleBlock = async () => {
    if (!formData.ip.trim() || !formData.reason.trim()) return;
    try {
      await blockIP({
        ip: formData.ip.trim(),
        reason: formData.reason.trim(),
        duration: formData.duration ? parseInt(formData.duration) : undefined,
      });
      setShowModal(false);
      setFormData({ ip: '', reason: '', duration: '' });
      fetchEntries(pagination.page);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      alert(error.response?.data?.message || 'Failed to block IP');
    }
  };

  const handleUnblock = async (ip: string) => {
    if (!confirm(`Unblock IP ${ip}?`)) return;
    try {
      await unblockIP(ip);
      fetchEntries(pagination.page);
    } catch { alert('Failed to unblock IP'); }
  };

  const handleDelete = async (id: string, ip: string) => {
    if (!confirm(`Delete blacklist entry for ${ip}? This is permanent.`)) return;
    try {
      await deleteBlacklistEntry(id);
      fetchEntries(pagination.page);
    } catch { alert('Failed to delete entry'); }
  };

  const columns = [
    {
      key: 'ip', label: 'IP Address',
      render: (e: BlacklistEntry) => <span className="font-mono text-sm font-medium">{e.ip}</span>,
    },
    {
      key: 'reason', label: 'Reason',
      render: (e: BlacklistEntry) => (
        <span className="text-sm max-w-xs truncate block" title={e.reason}>{e.reason}</span>
      ),
    },
    {
      key: 'source', label: 'Source',
      render: (e: BlacklistEntry) => (
        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${sourceColors[e.source] || 'bg-gray-100 text-gray-600'}`}>
          {sourceLabels[e.source] || e.source}
        </span>
      ),
    },
    {
      key: 'isActive', label: 'Status',
      render: (e: BlacklistEntry) => <StatusBadge status={e.isActive ? 'active' : 'inactive'} label={e.isActive ? 'Blocked' : 'Inactive'} />,
    },
    {
      key: 'hitCount', label: 'Hits',
      render: (e: BlacklistEntry) => (
        <span className={`text-sm font-medium ${e.hitCount > 100 ? 'text-red-600' : e.hitCount > 10 ? 'text-yellow-600' : 'text-gray-600'}`}>
          {e.hitCount.toLocaleString()}
        </span>
      ),
    },
    {
      key: 'expiresAt', label: 'Expires',
      render: (e: BlacklistEntry) => e.expiresAt
        ? <span className="text-xs text-gray-500">{formatDistanceToNow(new Date(e.expiresAt), { addSuffix: true })}</span>
        : <span className="text-xs text-red-500 font-medium">Permanent</span>,
    },
    {
      key: 'createdAt', label: 'Blocked',
      render: (e: BlacklistEntry) => (
        <span className="text-xs text-gray-500">
          {formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}
        </span>
      ),
    },
    {
      key: 'actions', label: 'Actions',
      render: (e: BlacklistEntry) => (
        <div className="flex items-center gap-1">
          {e.isActive && (
            <button onClick={() => handleUnblock(e.ip)}
              className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg" title="Unblock">
              <ShieldOff size={16} />
            </button>
          )}
          <button onClick={() => handleDelete(e._id, e.ip)}
            className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg" title="Delete">
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">IP Blacklist</h1>
          <p className="text-gray-500 mt-1">Block malicious IPs from accessing the system</p>
        </div>
        <button onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-red-600 text-white px-4 py-2.5 rounded-lg font-medium hover:bg-red-700 transition-colors">
          <Plus size={18} /> Block IP
        </button>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input type="text" placeholder="Search by IP or reason..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
        </div>
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}
          className="px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Sources</option>
          <option value="manual">Manual</option>
          <option value="anomaly_detector">Auto-Detected</option>
          <option value="rate_limit">Rate Limit</option>
        </select>
      </div>

      <DataTable columns={columns} data={entries} pagination={pagination} onPageChange={fetchEntries} loading={loading} emptyMessage="No blocked IPs" />

      {/* Block IP Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-4">Block IP Address</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">IP Address</label>
                <input type="text" placeholder="e.g. 192.168.1.100"
                  value={formData.ip} onChange={(e) => setFormData({ ...formData, ip: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-red-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                <input type="text" placeholder="Why is this IP being blocked?"
                  value={formData.reason} onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-red-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Duration (hours)</label>
                <input type="number" placeholder="Leave empty for permanent"
                  value={formData.duration} onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-red-500" />
                <p className="text-xs text-gray-400 mt-1">Leave empty to block permanently</p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={handleBlock}
                className="flex-1 bg-red-600 text-white py-2.5 rounded-lg font-medium hover:bg-red-700">Block IP</button>
              <button onClick={() => { setShowModal(false); setFormData({ ip: '', reason: '', duration: '' }); }}
                className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
