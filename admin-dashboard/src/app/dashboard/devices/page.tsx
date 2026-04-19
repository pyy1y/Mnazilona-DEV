'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getPairedDevices, sendDeviceCommand, unpairDevice, factoryResetDevice } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { getErrorMessage } from '@/lib/types';
import { useDebounce } from '@/lib/hooks';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useSocket } from '@/lib/socket';
import DataTable from '@/components/DataTable';
import StatusBadge from '@/components/StatusBadge';
import { Search, Unplug, Terminal, RotateCcw, Zap } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface DeviceItem {
  _id: string;
  name: string;
  serialNumber: string;
  deviceType: string;
  isOnline: boolean;
  lastSeen: string | null;
  pairedAt: string | null;
  macAddress: string | null;
  state: Record<string, unknown>;
  owner: { _id: string; name: string; email: string } | null;
  room: { name: string; icon: string } | null;
}

interface DeviceStatusEvent {
  serialNumber: string;
  isOnline: boolean;
  lastSeen: string;
}

const DEVICE_TYPES = ['relay', 'light', 'dimmer', 'ac', 'lock', 'water-tank', 'security'];

export default function DevicesPage() {
  const router = useRouter();
  const toast = useToast();
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(true);
  const [commandModal, setCommandModal] = useState<{ serial: string; name: string } | null>(null);
  const [command, setCommand] = useState('');
  const { connected, on } = useSocket();

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'unpair' | 'factory-reset';
    serial: string;
    name: string;
  } | null>(null);

  const fetchDevices = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (status) params.status = status;
      if (type) params.type = type;
      const res = await getPairedDevices(params);
      setDevices(res.data.devices);
      setPagination(res.data.pagination);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to load devices')); }
    finally { setLoading(false); }
  }, [debouncedSearch, status, type, toast]);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  // Real-time: update device status in the list without refresh
  const handleDeviceStatus = useCallback((event: unknown) => {
    const e = event as DeviceStatusEvent;
    setDevices((prev) =>
      prev.map((d) =>
        d.serialNumber === e.serialNumber
          ? { ...d, isOnline: e.isOnline, lastSeen: e.lastSeen || d.lastSeen }
          : d
      )
    );
  }, []);

  useEffect(() => {
    const off = on('device:status', handleDeviceStatus);
    return off;
  }, [on, handleDeviceStatus]);

  const handleConfirmAction = async () => {
    if (!confirmDialog) return;
    try {
      if (confirmDialog.type === 'unpair') {
        await unpairDevice(confirmDialog.serial);
        toast.success(`Device "${confirmDialog.name}" unpaired`);
      } else {
        await factoryResetDevice(confirmDialog.serial);
        toast.success(`Device "${confirmDialog.name}" factory reset initiated`);
      }
      fetchDevices(pagination.page);
    } catch (err) {
      toast.error(getErrorMessage(err, `Failed to ${confirmDialog.type} device`));
    } finally {
      setConfirmDialog(null);
    }
  };

  const handleSendCommand = async () => {
    if (!commandModal || !command.trim()) return;
    try {
      await sendDeviceCommand(commandModal.serial, command.trim());
      toast.success(`Command "${command}" sent to ${commandModal.name}`);
      setCommandModal(null);
      setCommand('');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to send command'));
    }
  };

  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'serialNumber', label: 'Serial Number', render: (d: DeviceItem) => <span className="font-mono text-xs">{d.serialNumber}</span> },
    { key: 'deviceType', label: 'Type', render: (d: DeviceItem) => <span className="capitalize">{d.deviceType}</span> },
    { key: 'isOnline', label: 'Status', render: (d: DeviceItem) => <StatusBadge status={d.isOnline ? 'online' : 'offline'} /> },
    {
      key: 'owner', label: 'Owner',
      render: (d: DeviceItem) => d.owner ? (
        <div>
          <p className="text-sm">{d.owner.name}</p>
          <p className="text-xs text-gray-400">{d.owner.email}</p>
        </div>
      ) : <span className="text-gray-400">Unpaired</span>,
    },
    { key: 'room', label: 'Room', render: (d: DeviceItem) => d.room?.name || '-' },
    {
      key: 'lastSeen', label: 'Last Seen',
      render: (d: DeviceItem) => d.lastSeen
        ? formatDistanceToNow(new Date(d.lastSeen), { addSuffix: true })
        : '-',
    },
    {
      key: 'state', label: 'State',
      render: (d: DeviceItem) => {
        const doorState = d.state?.doorState as string | undefined;
        if (doorState) {
          return <span className={`text-xs font-medium ${doorState === 'open' ? 'text-red-600' : 'text-green-600'}`}>
            {doorState === 'open' ? 'Open' : 'Closed'}
          </span>;
        }
        return '-';
      },
    },
    {
      key: 'actions', label: 'Actions',
      render: (d: DeviceItem) => (
        <div className="flex items-center gap-1">
          <button onClick={(e) => { e.stopPropagation(); setCommandModal({ serial: d.serialNumber, name: d.name }); }}
            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="Send Command">
            <Terminal size={16} />
          </button>
          {d.owner && (
            <button onClick={(e) => { e.stopPropagation(); setConfirmDialog({ type: 'unpair', serial: d.serialNumber, name: d.name }); }}
              className="p-1.5 text-yellow-600 hover:bg-yellow-50 rounded-lg" title="Unpair">
              <Unplug size={16} />
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); setConfirmDialog({ type: 'factory-reset', serial: d.serialNumber, name: d.name }); }}
            className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg" title="Factory Reset">
            <RotateCcw size={16} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Devices</h1>
          <p className="text-gray-500 mt-1">View and control all paired devices</p>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
          connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>
          <Zap size={14} />
          {connected ? 'Live Updates' : 'Connecting...'}
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input type="text" placeholder="Search by serial number or name..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Statuses</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="paired">Paired</option>
          <option value="unpaired">Unpaired</option>
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)}
          className="px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Types</option>
          {DEVICE_TYPES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
        </select>
      </div>

      <DataTable columns={columns} data={devices} pagination={pagination} onPageChange={fetchDevices} loading={loading} emptyMessage="No devices found"
        onRowClick={(d: DeviceItem) => router.push(`/dashboard/devices/${d.serialNumber}`)} />

      {/* Command Modal */}
      {commandModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-4">Send Command to {commandModal.name}</h3>
            <p className="text-xs text-gray-400 mb-4 font-mono">{commandModal.serial}</p>
            <select value={command} onChange={(e) => setCommand(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg mb-4 outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Select command</option>
              <option value="open">open</option>
              <option value="on">on</option>
              <option value="off">off</option>
              <option value="toggle">toggle</option>
              <option value="status">status</option>
              <option value="restart">restart</option>
            </select>
            <div className="flex gap-3">
              <button onClick={handleSendCommand}
                className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700">Send</button>
              <button onClick={() => { setCommandModal(null); setCommand(''); }}
                className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog for dangerous actions */}
      {confirmDialog && (
        <ConfirmDialog
          open={!!confirmDialog}
          title={confirmDialog.type === 'factory-reset' ? 'Factory Reset Device' : 'Unpair Device'}
          message={confirmDialog.type === 'factory-reset'
            ? `This will erase ALL settings on "${confirmDialog.name}". This action cannot be undone.`
            : `Unpair "${confirmDialog.name}" from its owner?`}
          variant={confirmDialog.type === 'factory-reset' ? 'danger' : 'warning'}
          confirmLabel={confirmDialog.type === 'factory-reset' ? 'Factory Reset' : 'Unpair'}
          typeToConfirm={confirmDialog.type === 'factory-reset' ? confirmDialog.serial : undefined}
          onConfirm={handleConfirmAction}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}
