'use client';

import { useEffect, useState, useCallback } from 'react';
import { listFirmware, createFirmware, updateFirmware, deleteFirmware, getFirmwareStats } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import { Plus, Trash2, Edit3, Package, BarChart3 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const DEVICE_TYPES = ['relay', 'light', 'dimmer', 'ac', 'lock', 'water-tank', 'security'];

interface FirmwareItem {
  _id: string;
  version: string;
  deviceType: string;
  changelog: string;
  isStable: boolean;
  isActive: boolean;
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

export default function FirmwarePage() {
  const [firmwares, setFirmwares] = useState<FirmwareItem[]>([]);
  const [stats, setStats] = useState<FirmwareStatsData | null>(null);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [filterType, setFilterType] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editItem, setEditItem] = useState<FirmwareItem | null>(null);

  // Form state
  const [form, setForm] = useState({ version: '', deviceType: 'relay', changelog: '', isStable: false, downloadUrl: '' });

  const fetchFirmwares = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (filterType) params.deviceType = filterType;
      const res = await listFirmware(params);
      setFirmwares(res.data.firmwares);
      setPagination(res.data.pagination);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [filterType]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await getFirmwareStats();
      setStats(res.data);
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => { fetchFirmwares(); fetchStats(); }, [fetchFirmwares, fetchStats]);

  const handleCreate = async () => {
    if (!form.version || !form.deviceType) return alert('Version and device type are required');
    try {
      await createFirmware(form);
      setShowCreate(false);
      setForm({ version: '', deviceType: 'relay', changelog: '', isStable: false, downloadUrl: '' });
      fetchFirmwares();
      fetchStats();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      alert(error.response?.data?.message || 'Failed to create firmware');
    }
  };

  const handleUpdate = async () => {
    if (!editItem) return;
    try {
      await updateFirmware(editItem._id, {
        changelog: form.changelog,
        isStable: form.isStable,
        isActive: editItem.isActive,
        downloadUrl: form.downloadUrl,
      });
      setEditItem(null);
      fetchFirmwares();
      fetchStats();
    } catch { alert('Failed to update firmware'); }
  };

  const handleDelete = async (fw: FirmwareItem) => {
    if (!confirm(`Delete firmware ${fw.deviceType}@${fw.version}?`)) return;
    try {
      await deleteFirmware(fw._id);
      fetchFirmwares();
      fetchStats();
    } catch { alert('Failed to delete firmware'); }
  };

  const handleToggleActive = async (fw: FirmwareItem) => {
    try {
      await updateFirmware(fw._id, { isActive: !fw.isActive });
      fetchFirmwares();
    } catch { alert('Failed to update'); }
  };

  const openEdit = (fw: FirmwareItem) => {
    setEditItem(fw);
    setForm({ version: fw.version, deviceType: fw.deviceType, changelog: fw.changelog, isStable: fw.isStable, downloadUrl: fw.downloadUrl || '' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Firmware Management</h1>
          <p className="text-gray-500 mt-1">Track firmware versions and prepare for OTA updates</p>
        </div>
        <button onClick={() => { setShowCreate(true); setForm({ version: '', deviceType: 'relay', changelog: '', isStable: false, downloadUrl: '' }); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
          <Plus size={18} /> Add Version
        </button>
      </div>

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
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Changelog</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Published</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {firmwares.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-400">No firmware versions found</td></tr>
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
                    <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">{fw.changelog || '-'}</td>
                    <td className="px-6 py-4 text-xs text-gray-400">
                      {fw.publishedAt ? formatDistanceToNow(new Date(fw.publishedAt), { addSuffix: true }) : '-'}
                      {fw.publishedBy && <span className="block text-gray-300 mt-0.5">{fw.publishedBy.name}</span>}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(fw)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="Edit">
                          <Edit3 size={16} />
                        </button>
                        <button onClick={() => handleToggleActive(fw)}
                          className={`px-2 py-1 rounded text-xs font-medium ${fw.isActive ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                          {fw.isActive ? 'Active' : 'Disabled'}
                        </button>
                        <button onClick={() => handleDelete(fw)}
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
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Changelog</label>
                <textarea placeholder="What changed in this version..." value={form.changelog}
                  onChange={(e) => setForm({ ...form, changelog: e.target.value })} rows={3}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Download URL (optional)</label>
                <input type="text" placeholder="https://..." value={form.downloadUrl}
                  onChange={(e) => setForm({ ...form, downloadUrl: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
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
              <button onClick={() => setShowCreate(false)}
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
              <div>
                <label className="text-sm text-gray-600 mb-1 block">Download URL</label>
                <input type="text" value={form.downloadUrl} onChange={(e) => setForm({ ...form, downloadUrl: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
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
              <button onClick={() => setEditItem(null)}
                className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
