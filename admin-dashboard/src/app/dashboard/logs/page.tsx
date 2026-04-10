'use client';

import { useEffect, useState, useCallback } from 'react';
import { getLogs } from '@/lib/api';
import DataTable from '@/components/DataTable';
import { Search, Filter } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface LogItem {
  _id: string;
  serialNumber: string;
  type: string;
  message: string;
  source: string;
  createdAt: string;
}

const typeColors: Record<string, string> = {
  info: 'bg-blue-100 text-blue-700',
  warning: 'bg-yellow-100 text-yellow-700',
  error: 'bg-red-100 text-red-700',
};

export default function LogsPage() {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 50 };
      if (search) params.search = search;
      if (type) params.type = type;
      if (source) params.source = source;
      const res = await getLogs(params);
      setLogs(res.data.logs);
      setPagination(res.data.pagination);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [search, type, source]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const columns = [
    {
      key: 'createdAt', label: 'Time',
      render: (log: LogItem) => (
        <span className="text-xs text-gray-500">
          {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
        </span>
      ),
    },
    {
      key: 'type', label: 'Type',
      render: (log: LogItem) => (
        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[log.type] || 'bg-gray-100 text-gray-600'}`}>
          {log.type}
        </span>
      ),
    },
    { key: 'serialNumber', label: 'Device', render: (log: LogItem) => <span className="font-mono text-xs">{log.serialNumber}</span> },
    { key: 'message', label: 'Message', render: (log: LogItem) => <span className="text-sm max-w-md truncate block">{log.message}</span> },
    {
      key: 'source', label: 'Source',
      render: (log: LogItem) => <span className="text-xs text-gray-500 capitalize">{log.source}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Device Logs</h1>
        <p className="text-gray-500 mt-1">All system and device logs</p>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input type="text" placeholder="Search logs..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-gray-400" />
          <select value={type} onChange={(e) => setType(e.target.value)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Types</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Sources</option>
            <option value="device">Device</option>
            <option value="server">Server</option>
            <option value="user">User</option>
            <option value="mqtt">MQTT</option>
          </select>
        </div>
      </div>

      <DataTable columns={columns} data={logs} pagination={pagination} onPageChange={fetchLogs} loading={loading} emptyMessage="No logs found" />
    </div>
  );
}
