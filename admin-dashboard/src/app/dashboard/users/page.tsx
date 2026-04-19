'use client';

import { useEffect, useState, useCallback } from 'react';
import { getUsers, deactivateUser, activateUser, forceLogoutUser, deleteUser } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { getErrorMessage } from '@/lib/types';
import { useDebounce } from '@/lib/hooks';
import ConfirmDialog from '@/components/ConfirmDialog';
import DataTable from '@/components/DataTable';
import StatusBadge from '@/components/StatusBadge';
import { Search, UserX, UserCheck, LogOut, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface UserItem {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  country: string;
  city: string;
  devices: { count: number; online: number };
}

export default function UsersPage() {
  const toast = useToast();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ action: string; userId: string; userName: string } | null>(null);

  const fetchUsers = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (status) params.status = status;
      const res = await getUsers(params);
      setUsers(res.data.users);
      setPagination(res.data.pagination);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load users'));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, status, toast]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const confirmMessages: Record<string, { title: string; message: string; variant: 'danger' | 'warning' | 'default' }> = {
    deactivate: { title: 'Deactivate Account', message: 'This will prevent the user from logging in.', variant: 'warning' },
    activate: { title: 'Activate Account', message: 'This will restore the user\'s access.', variant: 'default' },
    forceLogout: { title: 'Force Logout', message: 'This will invalidate all active sessions for this user.', variant: 'warning' },
    delete: { title: 'Delete Account', message: 'This action cannot be undone. All user data will be permanently removed.', variant: 'danger' },
  };

  const executeAction = async () => {
    if (!confirmAction) return;
    const { action, userId } = confirmAction;

    setActionLoading(userId);
    try {
      if (action === 'deactivate') await deactivateUser(userId);
      if (action === 'activate') await activateUser(userId);
      if (action === 'forceLogout') await forceLogoutUser(userId);
      if (action === 'delete') await deleteUser(userId);
      toast.success(`User ${action}d successfully`);
      fetchUsers(pagination.page);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Action failed'));
    } finally {
      setActionLoading(null);
      setConfirmAction(null);
    }
  };

  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    {
      key: 'role',
      label: 'Role',
      render: (user: UserItem) => (
        <StatusBadge status={user.role === 'admin' ? 'admin' : 'user'} />
      ),
    },
    {
      key: 'isActive',
      label: 'Status',
      render: (user: UserItem) => (
        <StatusBadge status={user.isActive ? 'active' : 'inactive'} />
      ),
    },
    {
      key: 'devices',
      label: 'Devices',
      render: (user: UserItem) => (
        <span className="text-sm">
          {user.devices.count} <span className="text-gray-400">({user.devices.online} online)</span>
        </span>
      ),
    },
    {
      key: 'lastLoginAt',
      label: 'Last Login',
      render: (user: UserItem) =>
        user.lastLoginAt
          ? formatDistanceToNow(new Date(user.lastLoginAt), { addSuffix: true })
          : 'Never',
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (user: UserItem) => (
        <div className="flex items-center gap-1">
          {user.role !== 'admin' && (
            <>
              {user.isActive ? (
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmAction({ action: 'deactivate', userId: user.id, userName: user.name }); }}
                  disabled={actionLoading === user.id}
                  className="p-1.5 text-yellow-600 hover:bg-yellow-50 rounded-lg transition-colors"
                  title="Deactivate"
                >
                  <UserX size={16} />
                </button>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmAction({ action: 'activate', userId: user.id, userName: user.name }); }}
                  disabled={actionLoading === user.id}
                  className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                  title="Activate"
                >
                  <UserCheck size={16} />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmAction({ action: 'forceLogout', userId: user.id, userName: user.name }); }}
                disabled={actionLoading === user.id}
                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                title="Force Logout"
              >
                <LogOut size={16} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmAction({ action: 'delete', userId: user.id, userName: user.name }); }}
                disabled={actionLoading === user.id}
                className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Delete"
              >
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        <p className="text-gray-500 mt-1">View and manage all users</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="relative flex-1 min-w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        data={users}
        pagination={pagination}
        onPageChange={fetchUsers}
        loading={loading}
        emptyMessage="No users found"
      />

      {/* Confirm Dialog */}
      {confirmAction && (
        <ConfirmDialog
          open={!!confirmAction}
          title={`${confirmMessages[confirmAction.action].title} - ${confirmAction.userName}`}
          message={confirmMessages[confirmAction.action].message}
          variant={confirmMessages[confirmAction.action].variant}
          confirmLabel={confirmMessages[confirmAction.action].title}
          typeToConfirm={confirmAction.action === 'delete' ? confirmAction.userName : undefined}
          onConfirm={executeAction}
          onCancel={() => setConfirmAction(null)}
          loading={!!actionLoading}
        />
      )}
    </div>
  );
}
