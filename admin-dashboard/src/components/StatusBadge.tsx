interface StatusBadgeProps {
  status: string;
  label?: string;
}

const statusStyles: Record<string, string> = {
  online: 'bg-green-100 text-green-700',
  offline: 'bg-gray-100 text-gray-600',
  active: 'bg-green-100 text-green-700',
  inactive: 'bg-red-100 text-red-700',
  banned: 'bg-red-100 text-red-700',
  locked: 'bg-yellow-100 text-yellow-700',
  admin: 'bg-purple-100 text-purple-700',
  user: 'bg-blue-100 text-blue-700',
  stable: 'bg-green-100 text-green-700',
  beta: 'bg-yellow-100 text-yellow-700',
  open: 'bg-red-100 text-red-700',
  closed: 'bg-green-100 text-green-700',
};

const statusLabels: Record<string, string> = {
  online: 'Online',
  offline: 'Offline',
  active: 'Active',
  inactive: 'Inactive',
  banned: 'Banned',
  locked: 'Locked',
  admin: 'Admin',
  user: 'User',
  stable: 'Stable',
  beta: 'Beta',
  open: 'Open',
  closed: 'Closed',
};

export default function StatusBadge({ status, label }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyles[status] || 'bg-gray-100 text-gray-600'}`}>
      {label || statusLabels[status] || status}
    </span>
  );
}
