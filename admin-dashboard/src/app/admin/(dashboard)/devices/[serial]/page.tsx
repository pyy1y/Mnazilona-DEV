'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  getDeviceDetail,
  sendDeviceCommand,
  lockDevice,
  unlockDevice,
  unpairDevice,
  factoryResetDevice,
  transferDevice,
  getUsers,
} from '@/lib/api';
import { useToast } from '@/components/Toast';
import { getErrorMessage } from '@/lib/types';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useSocket } from '@/lib/socket';
import StatusBadge from '@/components/StatusBadge';
import {
  ArrowLeft, Wifi, WifiOff, Lock, Unlock, Terminal, Unplug,
  RotateCcw, RefreshCw, Zap, Power, Info, Shield, ArrowRightLeft, Search,
} from 'lucide-react';
import { useDebounce } from '@/lib/hooks';
import { formatDistanceToNow } from 'date-fns';

interface DeviceDetail {
  _id: string;
  name: string;
  serialNumber: string;
  deviceType: string;
  isOnline: boolean;
  lastSeen: string | null;
  firmwareVersion: string | null;
  macAddress: string | null;
  adminLocked: boolean;
  adminLockedAt: string | null;
  adminLockedBy: { name: string; email: string } | null;
  adminLockReason: string | null;
  state: Record<string, unknown>;
  owner: { _id: string; name: string; email: string } | null;
  room: { name: string; icon: string } | null;
  pairedAt: string | null;
  createdAt: string;
}

interface LogEntry {
  _id: string;
  type: string;
  message: string;
  source: string;
  createdAt: string;
}

interface LatestFirmware {
  version: string;
  deviceType: string;
}

interface UserSearchResult {
  id: string;
  name: string;
  email: string;
}

interface OtaSnapshot {
  status: string;
  targetVersion: string | null;
  progress: number;
  error: string | null;
}

// Debounce guard for commands (prevent rapid clicks)
const COMMAND_COOLDOWN = 2000;

export default function DeviceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const toast = useToast();
  const serial = (params.serial as string)?.toUpperCase();

  const [device, setDevice] = useState<DeviceDetail | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [latestFirmware, setLatestFirmware] = useState<LatestFirmware | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [lockReason, setLockReason] = useState('');
  const [showLockModal, setShowLockModal] = useState(false);
  const [commandModal, setCommandModal] = useState(false);
  const [command, setCommand] = useState('');
  const { connected, on } = useSocket();

  // Command cooldown to prevent rapid-fire
  const lastCommandTime = useRef(0);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<'unpair' | 'factory-reset' | null>(null);

  // Transfer modal state
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferSearch, setTransferSearch] = useState('');
  const debouncedTransferSearch = useDebounce(transferSearch, 300);
  const [transferResults, setTransferResults] = useState<UserSearchResult[]>([]);
  const [transferTarget, setTransferTarget] = useState<UserSearchResult | null>(null);

  // Live OTA snapshot, layered on top of whatever was in the most recent fetch
  const [otaLive, setOtaLive] = useState<OtaSnapshot | null>(null);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await getDeviceDetail(serial);
      setDevice(res.data.device);
      setLogs(res.data.logs || []);
      setLatestFirmware(res.data.latestFirmware);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load device'));
    } finally {
      setLoading(false);
    }
  }, [serial, toast]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  // Real-time status updates for this device
  useEffect(() => {
    const offStatus = on('device:status', (event) => {
      if (event.serialNumber === serial) {
        setDevice((prev) => prev
          ? { ...prev, isOnline: event.isOnline, lastSeen: event.lastSeen || prev.lastSeen }
          : prev);
      }
    });
    // Mirror device dp_report payloads into device.state so the State card stays
    // current without a refetch while the user is on the page.
    const offDp = on('device:dp_report', (event) => {
      if (event.serialNumber !== serial) return;
      setDevice((prev) => prev
        ? { ...prev, state: { ...(prev.state || {}), ...(event.payload || {}) } }
        : prev);
    });
    const offHb = on('device:heartbeat', (event) => {
      if (event.serialNumber !== serial) return;
      setDevice((prev) => prev
        ? { ...prev, isOnline: true, lastSeen: event.lastSeen || prev.lastSeen }
        : prev);
    });
    const offOta = on('ota:progress', (event) => {
      if (event.serialNumber !== serial) return;
      setOtaLive({
        status: event.status,
        targetVersion: event.version || null,
        progress: typeof event.progress === 'number' ? event.progress : 0,
        error: event.error || null,
      });
      // On a successful OTA the firmware version on the device changes — refetch
      // so the "Update available" badge resolves correctly.
      if (event.status === 'success') fetchDetail();
    });
    return () => { offStatus(); offDp(); offHb(); offOta(); };
  }, [on, serial, fetchDetail]);

  // Search for transfer target users (debounced)
  useEffect(() => {
    if (!showTransferModal) return;
    const params: Record<string, string | number> = { limit: 10 };
    if (debouncedTransferSearch) params.search = debouncedTransferSearch;
    let cancelled = false;
    getUsers(params)
      .then((res) => {
        if (cancelled) return;
        const users = (res.data?.users || []) as UserSearchResult[];
        setTransferResults(users.filter((u) => u.id !== device?.owner?._id));
      })
      .catch(() => { if (!cancelled) setTransferResults([]); });
    return () => { cancelled = true; };
  }, [debouncedTransferSearch, showTransferModal, device?.owner?._id]);

  const handleTransfer = async () => {
    if (!transferTarget) return;
    setActionLoading(true);
    try {
      await transferDevice(serial, transferTarget.id);
      toast.success(`Transferred to ${transferTarget.email}`);
      setShowTransferModal(false);
      setTransferTarget(null);
      setTransferSearch('');
      fetchDetail();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to transfer device'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCommand = async (cmd: string) => {
    // Command cooldown
    const now = Date.now();
    if (now - lastCommandTime.current < COMMAND_COOLDOWN) {
      toast.warning('Please wait before sending another command');
      return;
    }
    lastCommandTime.current = now;

    setActionLoading(true);
    try {
      await sendDeviceCommand(serial, cmd);
      toast.success(`Command "${cmd}" sent`);
      fetchDetail();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to send command'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCustomCommand = async () => {
    if (!command.trim()) return;
    setActionLoading(true);
    try {
      await sendDeviceCommand(serial, command.trim());
      toast.success(`Command "${command}" sent`);
      setCommandModal(false);
      setCommand('');
      fetchDetail();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to send command'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleLock = async () => {
    setActionLoading(true);
    try {
      await lockDevice(serial, lockReason || undefined);
      toast.success('Device locked');
      setShowLockModal(false);
      setLockReason('');
      fetchDetail();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to lock device'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnlock = async () => {
    setActionLoading(true);
    try {
      await unlockDevice(serial);
      toast.success('Device unlocked');
      fetchDetail();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to unlock device'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmAction = async () => {
    if (!confirmDialog) return;
    setActionLoading(true);
    try {
      if (confirmDialog === 'unpair') {
        await unpairDevice(serial);
        toast.success('Device unpaired');
      } else {
        await factoryResetDevice(serial);
        toast.success('Factory reset initiated');
      }
      fetchDetail();
    } catch (err) {
      toast.error(getErrorMessage(err, `Failed to ${confirmDialog} device`));
    } finally {
      setActionLoading(false);
      setConfirmDialog(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!device) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Device not found</p>
        <button onClick={() => router.back()} className="mt-4 text-blue-600 hover:underline">Go back</button>
      </div>
    );
  }

  const needsUpdate = latestFirmware && device.firmwareVersion && device.firmwareVersion !== latestFirmware.version;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{device.name}</h1>
              {device.isOnline ? (
                <span className="flex items-center gap-1 text-green-600 text-sm"><Wifi size={16} /> Online</span>
              ) : (
                <span className="flex items-center gap-1 text-red-500 text-sm"><WifiOff size={16} /> Offline</span>
              )}
              {device.adminLocked && (
                <span className="flex items-center gap-1 bg-red-100 text-red-700 px-2.5 py-0.5 rounded-full text-xs font-medium">
                  <Lock size={12} /> Admin Locked
                </span>
              )}
            </div>
            <p className="text-gray-400 font-mono text-sm mt-1">{device.serialNumber}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
            connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}>
            <Zap size={14} />
            {connected ? 'Live' : 'Connecting...'}
          </div>
          <button onClick={fetchDetail} className="p-2 hover:bg-gray-100 rounded-lg" title="Refresh">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Type</p>
          <p className="text-sm font-medium capitalize">{device.deviceType}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Firmware</p>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium font-mono">{device.firmwareVersion || 'Unknown'}</p>
            {needsUpdate && (
              <span className="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full text-xs">
                Update available: {latestFirmware?.version}
              </span>
            )}
          </div>
          {otaLive && otaLive.status !== 'idle' && (
            <div className="mt-2 text-xs">
              <div className="flex items-center justify-between text-gray-600">
                <span className="capitalize">OTA: {otaLive.status.replace('_', ' ')} {otaLive.targetVersion ? `→ ${otaLive.targetVersion}` : ''}</span>
                <span>{otaLive.progress}%</span>
              </div>
              <div className="w-full h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${otaLive.status === 'failed' || otaLive.status === 'rolled_back' ? 'bg-red-500' : 'bg-blue-600'}`}
                  style={{ width: `${Math.max(0, Math.min(100, otaLive.progress))}%` }} />
              </div>
              {otaLive.error && <p className="text-red-500 mt-1">{otaLive.error}</p>}
            </div>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Owner</p>
          {device.owner ? (
            <div>
              <p className="text-sm font-medium">{device.owner.name}</p>
              <p className="text-xs text-gray-400">{device.owner.email}</p>
            </div>
          ) : (
            <p className="text-sm text-gray-400">Unpaired</p>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Last Seen</p>
          <p className="text-sm font-medium">
            {device.lastSeen ? formatDistanceToNow(new Date(device.lastSeen), { addSuffix: true }) : 'Never'}
          </p>
        </div>
      </div>

      {/* Admin Lock Info */}
      {device.adminLocked && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <Shield size={20} className="text-red-600 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-red-800">Device is Admin Locked</p>
            <p className="text-sm text-red-600 mt-1">Reason: {device.adminLockReason || 'No reason given'}</p>
            {device.adminLockedBy && (
              <p className="text-xs text-red-500 mt-1">
                Locked by {device.adminLockedBy.name} &bull; {device.adminLockedAt ? formatDistanceToNow(new Date(device.adminLockedAt), { addSuffix: true }) : ''}
              </p>
            )}
            <p className="text-xs text-red-500 mt-2">User commands are blocked. Only admin can control this device.</p>
          </div>
        </div>
      )}

      {/* Override Controls */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Terminal size={20} />
          Device Controls
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <button onClick={() => handleCommand('open')} disabled={actionLoading || !device.isOnline}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 hover:bg-blue-50 hover:border-blue-300 transition-colors disabled:opacity-50 disabled:hover:bg-white">
            <Power size={24} className="text-blue-600" />
            <span className="text-sm font-medium">Open</span>
          </button>
          <button onClick={() => handleCommand('toggle')} disabled={actionLoading || !device.isOnline}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 hover:bg-blue-50 hover:border-blue-300 transition-colors disabled:opacity-50 disabled:hover:bg-white">
            <Power size={24} className="text-indigo-600" />
            <span className="text-sm font-medium">Toggle</span>
          </button>
          <button onClick={() => handleCommand('status')} disabled={actionLoading || !device.isOnline}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 hover:bg-green-50 hover:border-green-300 transition-colors disabled:opacity-50 disabled:hover:bg-white">
            <Info size={24} className="text-green-600" />
            <span className="text-sm font-medium">Status</span>
          </button>
          <button onClick={() => handleCommand('restart')} disabled={actionLoading || !device.isOnline}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 hover:bg-yellow-50 hover:border-yellow-300 transition-colors disabled:opacity-50 disabled:hover:bg-white">
            <RefreshCw size={24} className="text-yellow-600" />
            <span className="text-sm font-medium">Restart</span>
          </button>
          <button onClick={() => setCommandModal(true)} disabled={actionLoading || !device.isOnline}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-200 hover:bg-purple-50 hover:border-purple-300 transition-colors disabled:opacity-50 disabled:hover:bg-white">
            <Terminal size={24} className="text-purple-600" />
            <span className="text-sm font-medium">Custom</span>
          </button>
          {device.adminLocked ? (
            <button onClick={handleUnlock} disabled={actionLoading}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border border-green-200 bg-green-50 hover:bg-green-100 transition-colors disabled:opacity-50">
              <Unlock size={24} className="text-green-600" />
              <span className="text-sm font-medium text-green-700">Unlock</span>
            </button>
          ) : (
            <button onClick={() => setShowLockModal(true)} disabled={actionLoading}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50">
              <Lock size={24} className="text-red-600" />
              <span className="text-sm font-medium text-red-700">Lock</span>
            </button>
          )}
        </div>

        {/* Danger Zone */}
        <div className="mt-6 pt-6 border-t border-gray-200">
          <p className="text-sm font-medium text-gray-500 mb-3">Danger Zone</p>
          <div className="flex flex-wrap gap-3">
            {device.owner && (
              <>
                <button onClick={() => setShowTransferModal(true)} disabled={actionLoading}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 text-sm font-medium disabled:opacity-50">
                  <ArrowRightLeft size={16} /> Transfer Owner
                </button>
                <button onClick={() => setConfirmDialog('unpair')} disabled={actionLoading}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-yellow-300 text-yellow-700 hover:bg-yellow-50 text-sm font-medium disabled:opacity-50">
                  <Unplug size={16} /> Unpair
                </button>
              </>
            )}
            <button onClick={() => setConfirmDialog('factory-reset')} disabled={actionLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 text-sm font-medium disabled:opacity-50">
              <RotateCcw size={16} /> Factory Reset
            </button>
          </div>
        </div>
      </div>

      {/* Device State & Extra Info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Device Info</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">MAC Address</span><span className="font-mono">{device.macAddress || '-'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Room</span><span>{device.room?.name || '-'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Paired</span><span>{device.pairedAt ? formatDistanceToNow(new Date(device.pairedAt), { addSuffix: true }) : '-'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Created</span><span>{formatDistanceToNow(new Date(device.createdAt), { addSuffix: true })}</span></div>
            {device.state && Object.keys(device.state).length > 0 && (
              <>
                <div className="border-t border-gray-100 pt-3 mt-3">
                  <p className="text-gray-500 mb-2">State</p>
                  {Object.entries(device.state).map(([key, val]) => (
                    <div key={key} className="flex justify-between py-1">
                      <span className="text-gray-500">{key}</span>
                      <span className="font-medium">
                        <StatusBadge status={String(val)} />
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Recent Logs */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Logs</h2>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {logs.length === 0 ? (
              <p className="text-gray-400 text-sm">No logs</p>
            ) : (
              logs.map((log) => (
                <div key={log._id} className="flex items-start gap-3 pb-2 border-b border-gray-50 last:border-0">
                  <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${
                    log.type === 'error' ? 'bg-red-500' : log.type === 'warning' ? 'bg-yellow-500' : 'bg-green-500'
                  }`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-700">{log.message}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-400">{log.source}</span>
                      <span className="text-xs text-gray-300">&bull;</span>
                      <span className="text-xs text-gray-400">
                        {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Lock Modal */}
      {showLockModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-2">Lock Device</h3>
            <p className="text-sm text-gray-500 mb-4">This will block all user commands. Only admins can control the device.</p>
            <input type="text" placeholder="Reason (optional)"
              value={lockReason} onChange={(e) => setLockReason(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg mb-4 outline-none focus:ring-2 focus:ring-red-500" />
            <div className="flex gap-3">
              <button onClick={handleLock} disabled={actionLoading}
                className="flex-1 bg-red-600 text-white py-2.5 rounded-lg font-medium hover:bg-red-700 disabled:opacity-50">Lock Device</button>
              <button onClick={() => { setShowLockModal(false); setLockReason(''); }}
                className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Command Modal */}
      {commandModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-4">Send Custom Command</h3>
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
              <button onClick={handleCustomCommand} disabled={actionLoading || !command}
                className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">Send</button>
              <button onClick={() => { setCommandModal(false); setCommand(''); }}
                className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Ownership Modal */}
      {showTransferModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-1">Transfer Device</h3>
            <p className="text-sm text-gray-500 mb-4">
              Currently owned by{' '}
              <span className="font-medium">{device.owner?.email || '(unpaired)'}</span>.
              Search for the new owner.
            </p>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input type="text" autoFocus
                value={transferSearch}
                onChange={(e) => { setTransferSearch(e.target.value); setTransferTarget(null); }}
                placeholder="Search by name or email..."
                className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
              {transferResults.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No matching users</p>
              ) : (
                transferResults.map((u) => (
                  <button key={u.id} type="button"
                    onClick={() => setTransferTarget(u)}
                    className={`w-full text-left px-4 py-2.5 hover:bg-gray-50 ${transferTarget?.id === u.id ? 'bg-blue-50' : ''}`}>
                    <p className="text-sm font-medium">{u.name}</p>
                    <p className="text-xs text-gray-500">{u.email}</p>
                  </button>
                ))
              )}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={handleTransfer} disabled={!transferTarget || actionLoading}
                className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
                {actionLoading ? 'Transferring...' : 'Transfer'}
              </button>
              <button onClick={() => { setShowTransferModal(false); setTransferTarget(null); setTransferSearch(''); }}
                className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog for dangerous actions */}
      {confirmDialog && (
        <ConfirmDialog
          open={!!confirmDialog}
          title={confirmDialog === 'factory-reset' ? 'Factory Reset Device' : 'Unpair Device'}
          message={confirmDialog === 'factory-reset'
            ? `This will erase ALL settings on "${device.name}". This action cannot be undone.`
            : `Unpair "${device.name}" from its owner? The user will lose access.`}
          variant={confirmDialog === 'factory-reset' ? 'danger' : 'warning'}
          confirmLabel={confirmDialog === 'factory-reset' ? 'Factory Reset' : 'Unpair'}
          typeToConfirm={confirmDialog === 'factory-reset' ? device.serialNumber : undefined}
          onConfirm={handleConfirmAction}
          onCancel={() => setConfirmDialog(null)}
          loading={actionLoading}
        />
      )}
    </div>
  );
}
