'use client';

import { useEffect, useState, useCallback } from 'react';
import { getAnomalies, updateAnomalyStatus } from '@/lib/api';
import { useSocket } from '@/lib/socket';
import DataTable from '@/components/DataTable';
import { Search, AlertTriangle, ShieldAlert, CheckCircle, XCircle, Eye, Zap } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface AnomalyItem {
  _id: string;
  type: string;
  severity: string;
  ip: string | null;
  target: string | null;
  description: string;
  details: Record<string, unknown>;
  status: string;
  autoBlocked: boolean;
  createdAt: string;
}

interface AnomalyStats {
  byStatus: { open: number; acknowledged: number; resolved: number; false_positive: number };
  openBySeverity: { low: number; medium: number; high: number; critical: number };
}

const typeLabels: Record<string, string> = {
  brute_force: 'Brute Force',
  device_flood: 'Device Flood',
  suspicious_ip: 'Suspicious IP',
  multiple_failed_otp: 'Failed OTPs',
  unusual_admin_activity: 'Admin Activity',
  device_takeover: 'Device Takeover',
  geo_anomaly: 'Geo Anomaly',
};

const typeColors: Record<string, string> = {
  brute_force: 'bg-red-100 text-red-700',
  device_flood: 'bg-orange-100 text-orange-700',
  suspicious_ip: 'bg-yellow-100 text-yellow-700',
  multiple_failed_otp: 'bg-red-100 text-red-700',
  unusual_admin_activity: 'bg-purple-100 text-purple-700',
  device_takeover: 'bg-red-100 text-red-700',
  geo_anomaly: 'bg-blue-100 text-blue-700',
};

const severityColors: Record<string, string> = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

const statusColors: Record<string, string> = {
  open: 'bg-red-100 text-red-700',
  acknowledged: 'bg-yellow-100 text-yellow-700',
  resolved: 'bg-green-100 text-green-700',
  false_positive: 'bg-gray-100 text-gray-500',
};

export default function AnomaliesPage() {
  const [alerts, setAlerts] = useState<AnomalyItem[]>([]);
  const [stats, setStats] = useState<AnomalyStats | null>(null);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [statusFilter, setStatusFilter] = useState('open');
  const [severityFilter, setSeverityFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const { connected, on } = useSocket();

  const fetchAlerts = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 50 };
      if (statusFilter) params.status = statusFilter;
      if (severityFilter) params.severity = severityFilter;
      if (typeFilter) params.type = typeFilter;
      const res = await getAnomalies(params);
      setAlerts(res.data.alerts);
      setPagination(res.data.pagination);
      setStats(res.data.stats);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [statusFilter, severityFilter, typeFilter]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  // Real-time: listen for new anomaly alerts
  useEffect(() => {
    const off = on('anomaly:alert', () => {
      fetchAlerts(pagination.page);
    });
    return off;
  }, [on, fetchAlerts, pagination.page]);

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      await updateAnomalyStatus(id, newStatus);
      fetchAlerts(pagination.page);
    } catch { alert('Failed to update alert status'); }
  };

  const columns = [
    {
      key: 'severity', label: 'Severity',
      render: (a: AnomalyItem) => (
        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold uppercase ${severityColors[a.severity]}`}>
          {a.severity}
        </span>
      ),
    },
    {
      key: 'type', label: 'Type',
      render: (a: AnomalyItem) => (
        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${typeColors[a.type] || 'bg-gray-100 text-gray-600'}`}>
          {typeLabels[a.type] || a.type}
        </span>
      ),
    },
    {
      key: 'description', label: 'Description',
      render: (a: AnomalyItem) => (
        <span className="text-sm max-w-md truncate block" title={a.description}>{a.description}</span>
      ),
    },
    {
      key: 'ip', label: 'IP',
      render: (a: AnomalyItem) => a.ip
        ? <span className="font-mono text-xs">{a.ip}</span>
        : <span className="text-gray-400">-</span>,
    },
    {
      key: 'target', label: 'Target',
      render: (a: AnomalyItem) => a.target
        ? <span className="font-mono text-xs">{a.target}</span>
        : <span className="text-gray-400">-</span>,
    },
    {
      key: 'autoBlocked', label: 'Auto-Blocked',
      render: (a: AnomalyItem) => a.autoBlocked
        ? <span className="text-xs text-red-600 font-medium">Yes</span>
        : <span className="text-xs text-gray-400">No</span>,
    },
    {
      key: 'status', label: 'Status',
      render: (a: AnomalyItem) => (
        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${statusColors[a.status]}`}>
          {a.status.replace('_', ' ')}
        </span>
      ),
    },
    {
      key: 'createdAt', label: 'Time',
      render: (a: AnomalyItem) => (
        <span className="text-xs text-gray-500">
          {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
        </span>
      ),
    },
    {
      key: 'actions', label: 'Actions',
      render: (a: AnomalyItem) => (
        <div className="flex items-center gap-1">
          {a.status === 'open' && (
            <button onClick={() => handleStatusChange(a._id, 'acknowledged')}
              className="p-1.5 text-yellow-600 hover:bg-yellow-50 rounded-lg" title="Acknowledge">
              <Eye size={16} />
            </button>
          )}
          {(a.status === 'open' || a.status === 'acknowledged') && (
            <>
              <button onClick={() => handleStatusChange(a._id, 'resolved')}
                className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg" title="Resolve">
                <CheckCircle size={16} />
              </button>
              <button onClick={() => handleStatusChange(a._id, 'false_positive')}
                className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg" title="False Positive">
                <XCircle size={16} />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Anomaly Detection</h1>
          <p className="text-gray-500 mt-1">Monitor and respond to suspicious activity</p>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
          connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>
          <Zap size={14} />
          {connected ? 'Live Monitoring' : 'Connecting...'}
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <ShieldAlert size={18} className="text-red-600" />
              <span className="text-sm font-medium text-red-700">Open Alerts</span>
            </div>
            <p className="text-2xl font-bold text-red-700">{stats.byStatus.open}</p>
          </div>
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle size={18} className="text-orange-600" />
              <span className="text-sm font-medium text-orange-700">Critical</span>
            </div>
            <p className="text-2xl font-bold text-orange-700">{stats.openBySeverity.critical}</p>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Eye size={18} className="text-yellow-600" />
              <span className="text-sm font-medium text-yellow-700">Acknowledged</span>
            </div>
            <p className="text-2xl font-bold text-yellow-700">{stats.byStatus.acknowledged}</p>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle size={18} className="text-green-600" />
              <span className="text-sm font-medium text-green-700">Resolved</span>
            </div>
            <p className="text-2xl font-bold text-green-700">{stats.byStatus.resolved}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="resolved">Resolved</option>
          <option value="false_positive">False Positive</option>
        </select>
        <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}
          className="px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          className="px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Types</option>
          {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <DataTable columns={columns} data={alerts} pagination={pagination} onPageChange={fetchAlerts} loading={loading} emptyMessage="No anomaly alerts found" />
    </div>
  );
}
