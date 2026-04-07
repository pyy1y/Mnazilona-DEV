'use client';

import { useEffect, useState, useCallback } from 'react';
import { getAllowedDevices, registerDevice, banDevice, unbanDevice } from '@/lib/api';
import DataTable from '@/components/DataTable';
import StatusBadge from '@/components/StatusBadge';
import { Search, Plus, ShieldBan, ShieldCheck, Copy } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface AllowedDeviceItem {
  _id: string;
  serialNumber: string;
  deviceType: string;
  firmwareVersion: string;
  isActivated: boolean;
  isBanned: boolean;
  failedAttempts: number;
  lockedUntil: string | null;
  banReason: string | null;
  createdAt: string;
  lastInquiryAt: string | null;
}

const DEVICE_TYPES = ['relay', 'light', 'dimmer', 'ac', 'lock', 'water-tank', 'security'];

export default function AllowlistPage() {
  const [devices, setDevices] = useState<AllowedDeviceItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [showRegister, setShowRegister] = useState(false);
  const [registerForm, setRegisterForm] = useState({ serialNumber: '', deviceType: 'relay', firmwareVersion: '1.0.0' });
  const [registerResult, setRegisterResult] = useState<{ deviceSecret: string; mqttUsername: string; mqttPassword: string } | null>(null);
  const [registerLoading, setRegisterLoading] = useState(false);

  const fetchDevices = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (search) params.search = search;
      if (status) params.status = status;
      const res = await getAllowedDevices(params);
      setDevices(res.data.devices);
      setPagination(res.data.pagination);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [search, status]);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  const handleRegister = async () => {
    if (!registerForm.serialNumber.trim()) return;
    setRegisterLoading(true);
    try {
      const res = await registerDevice(registerForm);
      setRegisterResult(res.data.device);
      fetchDevices();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      alert(axiosErr.response?.data?.message || 'Failed to register device');
    } finally { setRegisterLoading(false); }
  };

  const handleBan = async (serial: string) => {
    const reason = prompt('Ban reason (optional):');
    if (reason === null) return;
    try {
      await banDevice(serial, reason || undefined);
      fetchDevices(pagination.page);
    } catch { alert('Failed to ban device'); }
  };

  const handleUnban = async (serial: string) => {
    if (!confirm(`Unban ${serial}?`)) return;
    try {
      await unbanDevice(serial);
      fetchDevices(pagination.page);
    } catch { alert('Failed to unban device'); }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const columns = [
    { key: 'serialNumber', label: 'Serial Number', render: (d: AllowedDeviceItem) => <span className="font-mono text-xs font-medium">{d.serialNumber}</span> },
    { key: 'deviceType', label: 'Type', render: (d: AllowedDeviceItem) => <span className="capitalize">{d.deviceType}</span> },
    { key: 'firmwareVersion', label: 'Firmware' },
    {
      key: 'status', label: 'Status',
      render: (d: AllowedDeviceItem) => {
        if (d.isBanned) return <StatusBadge status="banned" />;
        if (d.lockedUntil && new Date(d.lockedUntil) > new Date()) return <StatusBadge status="locked" />;
        if (d.isActivated) return <StatusBadge status="active" label="Activated" />;
        return <StatusBadge status="inactive" label="Not Activated" />;
      },
    },
    {
      key: 'failedAttempts', label: 'Failed Attempts',
      render: (d: AllowedDeviceItem) => (
        <span className={d.failedAttempts >= 3 ? 'text-red-600 font-medium' : ''}>{d.failedAttempts}</span>
      ),
    },
    {
      key: 'lastInquiryAt', label: 'Last Inquiry',
      render: (d: AllowedDeviceItem) => d.lastInquiryAt
        ? formatDistanceToNow(new Date(d.lastInquiryAt), { addSuffix: true })
        : '-',
    },
    {
      key: 'actions', label: 'Actions',
      render: (d: AllowedDeviceItem) => (
        <div className="flex items-center gap-1">
          {d.isBanned ? (
            <button onClick={(e) => { e.stopPropagation(); handleUnban(d.serialNumber); }}
              className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg" title="Unban">
              <ShieldCheck size={16} />
            </button>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); handleBan(d.serialNumber); }}
              className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg" title="Ban">
              <ShieldBan size={16} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Allowlist</h1>
          <p className="text-gray-500 mt-1">Manage registered devices in the system</p>
        </div>
        <button onClick={() => { setShowRegister(true); setRegisterResult(null); }}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg font-medium hover:bg-blue-700">
          <Plus size={18} /> Register Device
        </button>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input type="text" placeholder="Search by serial number..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Statuses</option>
          <option value="activated">Activated</option>
          <option value="inactive">Not Activated</option>
          <option value="banned">Banned</option>
          <option value="locked">Locked</option>
        </select>
      </div>

      <DataTable columns={columns} data={devices} pagination={pagination} onPageChange={fetchDevices} loading={loading} />

      {/* Register Modal */}
      {showRegister && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg mx-4">
            {!registerResult ? (
              <>
                <h3 className="text-lg font-semibold mb-4">Register New Device</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Serial Number</label>
                    <input type="text" value={registerForm.serialNumber}
                      onChange={(e) => setRegisterForm({ ...registerForm, serialNumber: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="SN-001" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Device Type</label>
                    <select value={registerForm.deviceType}
                      onChange={(e) => setRegisterForm({ ...registerForm, deviceType: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
                      {DEVICE_TYPES.map((t) => (
                        <option key={t} value={t} className="capitalize">{t}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Firmware Version</label>
                    <input type="text" value={registerForm.firmwareVersion}
                      onChange={(e) => setRegisterForm({ ...registerForm, firmwareVersion: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div className="flex gap-3 mt-6">
                  <button onClick={handleRegister} disabled={registerLoading}
                    className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
                    {registerLoading ? 'Registering...' : 'Register'}
                  </button>
                  <button onClick={() => setShowRegister(false)}
                    className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200">Cancel</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold mb-2 text-green-700">Device Registered Successfully!</h3>
                <p className="text-sm text-red-600 mb-4">Save these credentials now — they won&apos;t be shown again</p>
                <div className="space-y-3 bg-gray-50 p-4 rounded-lg">
                  {Object.entries(registerResult).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between">
                      <div>
                        <span className="text-xs text-gray-500">{key}</span>
                        <p className="font-mono text-sm break-all">{value}</p>
                      </div>
                      <button onClick={() => copyToClipboard(value)} className="p-1.5 text-gray-400 hover:text-blue-600">
                        <Copy size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                <button onClick={() => { setShowRegister(false); setRegisterResult(null); setRegisterForm({ serialNumber: '', deviceType: 'relay', firmwareVersion: '1.0.0' }); }}
                  className="w-full mt-4 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200">Close</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
