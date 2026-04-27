'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { listFirmware, createFirmware, updateFirmware, deleteFirmware, getFirmwareStats, pushOtaUpdate, getOtaStatus } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { getErrorMessage } from '@/lib/types';
import ConfirmDialog from '@/components/ConfirmDialog';
import StatusBadge from '@/components/StatusBadge';
import { Plus, Trash2, Edit3, Package, BarChart3, Upload, Rocket, RefreshCw, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useSocketEvent } from '@/lib/socket';

const DEVICE_TYPES = ['relay', 'light', 'dimmer', 'ac', 'lock', 'water-tank', 'security'];

interface FirmwareItem {
  _id: string;
  version: string;
  deviceType: string;
  changelog: string;
  isStable: boolean;
  isActive: boolean;
  filePath: string | null;
  fileSize: number | null;
  checksum: string | null;
  downloadUrl: string | null;
  publishedAt: string;
  publishedBy: { name: string; email: string } | null;
  createdAt: string;
}

interface FirmwareStatsData {
  firmwareCounts: { _id: string; count: number; stable: number }[];
  deviceVersions: { deviceType: string; version: string; count: number }[];
  latestStable: Record<string, string>;
  totalDevicesWithFirmware: number;
  needsUpdate: number;
}

interface OtaDevice {
  serialNumber: string;
  name: string;
  deviceType: string;
  firmwareVersion: string;
  otaStatus: string;
  otaTargetVersion: string;
  otaProgress: number;
  otaError: string | null;
  otaStartedAt: string | null;
  otaCompletedAt: string | null;
  isOnline: boolean;
}

function formatBytes(bytes: number | null) {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function OtaStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    idle: 'bg-gray-100 text-gray-600',
    notified: 'bg-blue-100 text-blue-700',
    downloading: 'bg-yellow-100 text-yellow-700',
    verifying: 'bg-purple-100 text-purple-700',
    installing: 'bg-orange-100 text-orange-700',
    rebooting: 'bg-indigo-100 text-indigo-700',
    success: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    rolled_back: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-600'}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

export default function FirmwarePage() {
  const toast = useToast();
  const [firmwares, setFirmwares] = useState<FirmwareItem[]>([]);
  const [stats, setStats] = useState<FirmwareStatsData | null>(null);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [filterType, setFilterType] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editItem, setEditItem] = useState<FirmwareItem | null>(null);
  const [pushingOta, setPushingOta] = useState<string | null>(null);
  const [otaDevices, setOtaDevices] = useState<OtaDevice[]>([]);
  const [showOtaPanel, setShowOtaPanel] = useState(false);

  // OTA confirm dialog
  const [otaConfirm, setOtaConfirm] = useState<FirmwareItem | null>(null);

  // Delete confirm dialog
  const [deleteConfirm, setDeleteConfirm] = useState<FirmwareItem | null>(null);

  // Form state
  const [form, setForm] = useState({ version: '', deviceType: 'relay', changelog: '', isStable: false });
  const [firmwareFile, setFirmwareFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  const fetchFirmwares = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (filterType) params.deviceType = filterType;
      const res = await listFirmware(params);
      setFirmwares(res.data.firmwares);
      setPagination(res.data.pagination);
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to load firmware')); }
    finally { setLoading(false); }
  }, [filterType, toast]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await getFirmwareStats();
      setStats(res.data);
    } catch { /* stats are non-critical */ }
  }, []);

  const fetchOtaStatus = useCallback(async () => {
    try {
      const res = await getOtaStatus();
      setOtaDevices(res.data.devices);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { fetchFirmwares(); fetchStats(); fetchOtaStatus(); }, [fetchFirmwares, fetchStats, fetchOtaStatus]);

  // Real-time OTA progress updates — handler must be stable so we don't
  // re-subscribe on every render.
  const handleOtaProgress = useCallback(() => {
    fetchOtaStatus();
  }, [fetchOtaStatus]);
  useSocketEvent('ota:progress', handleOtaProgress);

  // Safety-net polling while updates are in-flight: if the broker drops a
  // progress event we still converge to the right state within ~5s.
  const activeOtaCount = otaDevices.filter(
    (d) => !['idle', 'success', 'failed', 'rolled_back'].includes(d.otaStatus)
  ).length;
  useEffect(() => {
    if (activeOtaCount === 0) return;
    const id = setInterval(fetchOtaStatus, 5000);
    return () => clearInterval(id);
  }, [activeOtaCount, fetchOtaStatus]);

  const handleCreate = async () => {
    if (!form.version || !form.deviceType) return toast.warning('Version and device type are required');
    if (!firmwareFile) return toast.warning('Firmware binary file (.bin) is required');
    try {
      const formData = new FormData();
      formData.append('version', form.version);
      formData.append('deviceType', form.deviceType);
      formData.append('changelog', form.changelog);
      formData.append('isStable', String(form.isStable));
      formData.append('firmware', firmwareFile);

      await createFirmware(formData);
      toast.success(`Firmware v${form.version} created`);
      setShowCreate(false);
      setForm({ version: '', deviceType: 'relay', changelog: '', isStable: false });
      setFirmwareFile(null);
      fetchFirmwares();
      fetchStats();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to create firmware'));
    }
  };

  const handleUpdate = async () => {
    if (!editItem) return;
    try {
      const formData = new FormData();
      formData.append('changelog', form.changelog);
      formData.append('isStable', String(form.isStable));
      if (firmwareFile) {
        formData.append('firmware', firmwareFile);
      }

      await updateFirmware(editItem._id, formData);
      toast.success('Firmware updated');
      setEditItem(null);
      setFirmwareFile(null);
      fetchFirmwares();
      fetchStats();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to update firmware')); }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteFirmware(deleteConfirm._id);
      toast.success(`Firmware ${deleteConfirm.deviceType}@${deleteConfirm.version} deleted`);
      setDeleteConfirm(null);
      fetchFirmwares();
      fetchStats();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to delete firmware')); }
  };

  const handleToggleActive = async (fw: FirmwareItem) => {
    try {
      const formData = new FormData();
      formData.append('isActive', String(!fw.isActive));
      await updateFirmware(fw._id, formData);
      toast.success(`Firmware ${fw.isActive ? 'disabled' : 'activated'}`);
      fetchFirmwares();
    } catch (err) { toast.error(getErrorMessage(err, 'Failed to update')); }
  };

  const handlePushOta = async () => {
    if (!otaConfirm) return;
    setPushingOta(otaConfirm._id);
    try {
      const res = await pushOtaUpdate(otaConfirm._id);
      const d = res.data;
      toast.success(`OTA pushed! Notified: ${d.notified}, Skipped: ${d.skipped}, Offline: ${d.offline}`);
      setOtaConfirm(null);
      fetchOtaStatus();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to push OTA update'));
    } finally {
      setPushingOta(null);
    }
  };

  const openEdit = (fw: FirmwareItem) => {
    setEditItem(fw);
    setForm({ version: fw.version, deviceType: fw.deviceType, changelog: fw.changelog, isStable: fw.isStable });
    setFirmwareFile(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Firmware & OTA Management</h1>
          <p className="text-gray-500 mt-1">Upload firmware binaries and push OTA updates to devices</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => { setShowOtaPanel(!showOtaPanel); fetchOtaStatus(); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium border ${activeOtaCount > 0 ? 'bg-orange-50 border-orange-300 text-orange-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
            <RefreshCw size={18} className={activeOtaCount > 0 ? 'animate-spin' : ''} />
            OTA Status {activeOtaCount > 0 && <span className="px-1.5 py-0.5 bg-orange-200 rounded-full text-xs">{activeOtaCount}</span>}
          </button>
          <button onClick={() => { setShowCreate(true); setForm({ version: '', deviceType: 'relay', changelog: '', isStable: false }); setFirmwareFile(null); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
            <Plus size={18} /> Add Version
          </button>
        </div>
      </div>

      {/* OTA Status Panel */}
      {showOtaPanel && otaDevices.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold">OTA Update Progress</h2>
            <button onClick={fetchOtaStatus} className="text-sm text-blue-600 hover:underline">Refresh</button>
          </div>
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-2 text-left text-xs font-semibold text-gray-500">Device</th>
                <th className="px-6 py-2 text-left text-xs font-semibold text-gray-500">Current FW</th>
                <th className="px-6 py-2 text-left text-xs font-semibold text-gray-500">Target</th>
                <th className="px-6 py-2 text-left text-xs font-semibold text-gray-500">Status</th>
                <th className="px-6 py-2 text-left text-xs font-semibold text-gray-500">Progress</th>
                <th className="px-6 py-2 text-left text-xs font-semibold text-gray-500">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {otaDevices.map(d => (
                <tr key={d.serialNumber} className="hover:bg-gray-50">
                  <td className="px-6 py-3">
                    <p className="text-sm font-medium">{d.name || d.serialNumber}</p>
                    <p className="text-xs text-gray-400">{d.serialNumber}</p>
                  </td>
                  <td className="px-6 py-3 font-mono text-sm">{d.firmwareVersion || '-'}</td>
                  <td className="px-6 py-3 font-mono text-sm text-blue-600">{d.otaTargetVersion || '-'}</td>
                  <td className="px-6 py-3"><OtaStatusBadge status={d.otaStatus} /></td>
                  <td className="px-6 py-3">
                    {d.otaStatus === 'downloading' || d.otaStatus === 'installing' ? (
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${d.otaProgress}%` }} />
                        </div>
                        <span className="text-xs text-gray-500">{d.otaProgress}%</span>
                      </div>
                    ) : d.otaStatus === 'success' ? (
                      <CheckCircle size={16} className="text-green-500" />
                    ) : d.otaStatus === 'failed' || d.otaStatus === 'rolled_back' ? (
                      <AlertTriangle size={16} className="text-red-500" />
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-xs text-red-500 max-w-xs truncate">{d.otaError || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showOtaPanel && otaDevices.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
          No active OTA updates
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Package size={18} className="text-blue-600" />
              <p className="text-xs text-gray-500">Total Versions</p>
            </div>
            <p className="text-2xl font-bold">{pagination.total}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 size={18} className="text-green-600" />
              <p className="text-xs text-gray-500">Devices with Firmware</p>
            </div>
            <p className="text-2xl font-bold">{stats.totalDevicesWithFirmware}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-2">Needs Update</p>
            <p className="text-2xl font-bold text-yellow-600">{stats.needsUpdate}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-2">Latest Stable</p>
            <div className="space-y-1">
              {Object.entries(stats.latestStable).length === 0 ? (
                <p className="text-sm text-gray-400">None</p>
              ) : (
                Object.entries(stats.latestStable).map(([type, ver]) => (
                  <div key={type} className="flex justify-between text-xs">
                    <span className="capitalize text-gray-500">{type}</span>
                    <span className="font-mono font-medium">{ver}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Version Distribution */}
      {stats && stats.deviceVersions.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Device Firmware Distribution</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {stats.deviceVersions.map((dv, idx) => (
              <div key={idx} className="text-center p-3 rounded-lg bg-gray-50">
                <p className="text-xs text-gray-500 capitalize">{dv.deviceType}</p>
                <p className="font-mono font-medium text-sm mt-1">{dv.version}</p>
                <p className="text-xs text-gray-400 mt-1">{dv.count} devices</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-4">
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
          className="px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Types</option>
          {DEVICE_TYPES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
        </select>
      </div>

      {/* Firmware List */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto" />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Version</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Device Type</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Binary</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Changelog</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Published</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {firmwares.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400">No firmware versions found</td></tr>
              ) : (
                firmwares.map((fw) => (
                  <tr key={fw._id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-mono text-sm font-medium">{fw.version}</td>
                    <td className="px-6 py-4 text-sm capitalize">{fw.deviceType}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {fw.isStable && <StatusBadge status="stable" />}
                        {!fw.isActive && <StatusBadge status="inactive" />}
                        {fw.isActive && !fw.isStable && <StatusBadge status="beta" />}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {fw.filePath ? (
                        <div className="text-xs">
                          <p className="text-green-600 font-medium flex items-center gap-1">
                            <Upload size={12} /> Uploaded
                          </p>
                          <p className="text-gray-400 mt-0.5">{formatBytes(fw.fileSize)}</p>
                          {fw.checksum && <p className="text-gray-300 font-mono truncate max-w-[100px]" title={fw.checksum}>SHA256: {fw.checksum.slice(0, 8)}...</p>}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">No binary</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">{fw.changelog || '-'}</td>
                    <td className="px-6 py-4 text-xs text-gray-400">
                      {fw.publishedAt ? formatDistanceToNow(new Date(fw.publishedAt), { addSuffix: true }) : '-'}
                      {fw.publishedBy && <span className="block text-gray-300 mt-0.5">{fw.publishedBy.name}</span>}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        {/* Push OTA button - only if binary exists and active */}
                        {fw.filePath && fw.isActive && (
                          <button onClick={() => setOtaConfirm(fw)}
                            disabled={pushingOta === fw._id}
                            className="p-1.5 text-orange-600 hover:bg-orange-50 rounded-lg disabled:opacity-50" title="Push OTA Update">
                            {pushingOta === fw._id ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />}
                          </button>
                        )}
                        <button onClick={() => openEdit(fw)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="Edit">
                          <Edit3 size={16} />
                        </button>
                        <button onClick={() => handleToggleActive(fw)}
                          className={`px-2 py-1 rounded text-xs font-medium ${fw.isActive ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                          {fw.isActive ? 'Active' : 'Disabled'}
                        </button>
                        <button onClick={() => setDeleteConfirm(fw)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg" title="Delete">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {pagination.pages > 1 && (
            <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 bg-gray-50">
              <p className="text-sm text-gray-500">Total: {pagination.total}</p>
              <div className="flex items-center gap-2">
                <button onClick={() => fetchFirmwares(pagination.page - 1)} disabled={pagination.page <= 1}
                  className="px-3 py-1 rounded text-sm hover:bg-gray-200 disabled:opacity-30">Prev</button>
                <span className="text-sm text-gray-600">{pagination.page} / {pagination.pages}</span>
                <button onClick={() => fetchFirmwares(pagination.page + 1)} disabled={pagination.page >= pagination.pages}
                  className="px-3 py-1 rounded text-sm hover:bg-gray-200 disabled:opacity-30">Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg mx-4">
            <h3 className="text-lg font-semibold mb-4">Add Firmware Version</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">Version *</label>
                  <input type="text" placeholder="e.g. 1.2.0" value={form.version}
                    onChange={(e) => setForm({ ...form, version: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-sm text-gray-600 mb-1 block">Device Type *</label>
                  <select value={form.deviceType} onChange={(e) => setForm({ ...form, deviceType: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
                    {DEVICE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* Firmware Binary Upload */}
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Firmware Binary (.bin) *</label>
                <input type="file" ref={fileInputRef} accept=".bin,.ota,.img"
                  onChange={(e) => setFirmwareFile(e.target.files?.[0] || null)}
                  className="hidden" />
                <button onClick={() => fileInputRef.current?.click()}
                  className={`w-full px-4 py-3 border-2 border-dashed rounded-lg text-sm font-medium flex items-center justify-center gap-2 ${firmwareFile ? 'border-green-400 bg-green-50 text-green-700' : 'border-gray-300 text-gray-500 hover:border-blue-400 hover:bg-blue-50'}`}>
                  <Upload size={18} />
                  {firmwareFile ? (
                    <span>{firmwareFile.name} ({formatBytes(firmwareFile.size)})</span>
                  ) : (
                    <span>Click to upload firmware binary</span>
                  )}
                </button>
              </div>

              <div>
                <label className="text-sm text-gray-600 mb-1 block">Changelog</label>
                <textarea placeholder="What changed in this version..." value={form.changelog}
                  onChange={(e) => setForm({ ...form, changelog: e.target.value })} rows={3}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.isStable}
                  onChange={(e) => setForm({ ...form, isStable: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                <span className="text-sm">Mark as stable release</span>
              </label>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={handleCreate}
                className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700">Create</button>
              <button onClick={() => { setShowCreate(false); setFirmwareFile(null); }}
                className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg mx-4">
            <h3 className="text-lg font-semibold mb-1">Edit Firmware</h3>
            <p className="text-sm text-gray-400 mb-4 font-mono">{editItem.deviceType}@{editItem.version}</p>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Changelog</label>
                <textarea value={form.changelog} onChange={(e) => setForm({ ...form, changelog: e.target.value })} rows={3}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>

              {/* Replace Binary */}
              <div>
                <label className="text-sm text-gray-600 mb-1 block">
                  Replace Binary {editItem.filePath ? '(current file will be replaced)' : '(no binary uploaded yet)'}
                </label>
                <input type="file" ref={editFileInputRef} accept=".bin,.ota,.img"
                  onChange={(e) => setFirmwareFile(e.target.files?.[0] || null)}
                  className="hidden" />
                <button onClick={() => editFileInputRef.current?.click()}
                  className={`w-full px-4 py-3 border-2 border-dashed rounded-lg text-sm font-medium flex items-center justify-center gap-2 ${firmwareFile ? 'border-green-400 bg-green-50 text-green-700' : 'border-gray-300 text-gray-500 hover:border-blue-400 hover:bg-blue-50'}`}>
                  <Upload size={18} />
                  {firmwareFile ? (
                    <span>{firmwareFile.name} ({formatBytes(firmwareFile.size)})</span>
                  ) : editItem.filePath ? (
                    <span>Click to replace ({formatBytes(editItem.fileSize)})</span>
                  ) : (
                    <span>Click to upload firmware binary</span>
                  )}
                </button>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.isStable}
                  onChange={(e) => setForm({ ...form, isStable: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                <span className="text-sm">Stable release</span>
              </label>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={handleUpdate}
                className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700">Save</button>
              <button onClick={() => { setEditItem(null); setFirmwareFile(null); }}
                className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* OTA Push Confirm - requires password-level confirmation */}
      {otaConfirm && (
        <ConfirmDialog
          open={!!otaConfirm}
          title="Push OTA Update"
          message={`This will push firmware v${otaConfirm.version} to ALL online ${otaConfirm.deviceType} devices. A failed update could brick devices.`}
          variant="danger"
          confirmLabel="Push OTA Update"
          typeToConfirm={otaConfirm.deviceType}
          onConfirm={handlePushOta}
          onCancel={() => setOtaConfirm(null)}
          loading={!!pushingOta}
        />
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <ConfirmDialog
          open={!!deleteConfirm}
          title="Delete Firmware"
          message={`Delete firmware ${deleteConfirm.deviceType}@${deleteConfirm.version}? This will also delete the binary file.`}
          variant="danger"
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}
