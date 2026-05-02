'use client';

import { useEffect, useState, useCallback } from 'react';
import { getAuditLogs } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { getErrorMessage } from '@/lib/types';
import { useDebounce } from '@/lib/hooks';
import DataTable from '@/components/DataTable';
import { Search } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface AuditItem {
  _id: string;
  adminId: string;
  adminEmail: string;
  action: string;
  target: string;
  details: Record<string, unknown>;
  ip: string;
  createdAt: string;
}

const actionLabels: Record<string, string> = {
  admin_login: 'Admin Login',
  user_view: 'View User',
  user_deactivate: 'Deactivate User',
  user_activate: 'Activate User',
  user_delete: 'Delete User',
  user_force_logout: 'Force Logout',
  device_register: 'Register Device',
  device_register_batch: 'Register Batch',
  device_ban: 'Ban Device',
  device_unban: 'Unban Device',
  device_command: 'Send Command',
  device_unpair: 'Unpair Device',
  device_transfer: 'Transfer Device',
  device_factory_reset: 'Factory Reset',
  device_lock: 'Lock Device',
  device_unlock: 'Unlock Device',
  firmware_create: 'Create Firmware',
  firmware_update: 'Update Firmware',
  firmware_delete: 'Delete Firmware',
  settings_update: 'Update Settings',
  ip_block: 'Block IP',
  ip_unblock: 'Unblock IP',
  anomaly_resolve: 'Resolve Anomaly',
  anomaly_acknowledge: 'Acknowledge Anomaly',
};

const actionColors: Record<string, string> = {
  admin_login: 'bg-blue-100 text-blue-700',
  user_deactivate: 'bg-yellow-100 text-yellow-700',
  user_activate: 'bg-green-100 text-green-700',
  user_delete: 'bg-red-100 text-red-700',
  user_force_logout: 'bg-orange-100 text-orange-700',
  device_register: 'bg-purple-100 text-purple-700',
  device_ban: 'bg-red-100 text-red-700',
  device_unban: 'bg-green-100 text-green-700',
  device_command: 'bg-blue-100 text-blue-700',
  device_unpair: 'bg-yellow-100 text-yellow-700',
  device_transfer: 'bg-purple-100 text-purple-700',
  device_factory_reset: 'bg-red-100 text-red-700',
  device_lock: 'bg-red-100 text-red-700',
  device_unlock: 'bg-green-100 text-green-700',
  firmware_create: 'bg-blue-100 text-blue-700',
  firmware_update: 'bg-blue-100 text-blue-700',
  firmware_delete: 'bg-red-100 text-red-700',
  ip_block: 'bg-red-100 text-red-700',
  ip_unblock: 'bg-green-100 text-green-700',
  anomaly_resolve: 'bg-green-100 text-green-700',
  anomaly_acknowledge: 'bg-yellow-100 text-yellow-700',
};

export default function AuditPage() {
  const toast = useToast();
  const [logs, setLogs] = useState<AuditItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 50 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (action) params.action = action;
      const res = await getAuditLogs(params);
      setLogs(res.data.logs);
      setPagination(res.data.pagination);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to load audit logs')); }
    finally { setLoading(false); }
  }, [debouncedSearch, action, toast]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const columns = [
    {
      key: 'createdAt', label: 'Time',
      render: (log: AuditItem) => (
        <span className="text-xs text-gray-500">
          {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
        </span>
      ),
    },
    {
      key: 'action', label: 'Action',
      render: (log: AuditItem) => (
        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${actionColors[log.action] || 'bg-gray-100 text-gray-600'}`}>
          {actionLabels[log.action] || log.action}
        </span>
      ),
    },
    { key: 'target', label: 'Target', render: (log: AuditItem) => <span className="font-mono text-xs">{log.target || '-'}</span> },
    { key: 'adminEmail', label: 'Admin', render: (log: AuditItem) => <span className="text-sm">{log.adminEmail}</span> },
    { key: 'ip', label: 'IP', render: (log: AuditItem) => <span className="font-mono text-xs text-gray-400">{log.ip || '-'}</span> },
    {
      key: 'details', label: 'Details',
      render: (log: AuditItem) => {
        const details = log.details;
        if (!details || Object.keys(details).length === 0) return '-';
        return (
          <span className="text-xs text-gray-500 max-w-xs truncate block" title={JSON.stringify(details)}>
            {JSON.stringify(details).slice(0, 60)}...
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
        <p className="text-gray-500 mt-1">Track all admin actions in the system</p>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input type="text" placeholder="Search..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
        </div>
        <select value={action} onChange={(e) => setAction(e.target.value)}
          className="px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Actions</option>
          {Object.entries(actionLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <DataTable columns={columns} data={logs} pagination={pagination} onPageChange={fetchLogs} loading={loading} emptyMessage="No audit logs found" />
    </div>
  );
}
