'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
  /** If set, user must type this text to confirm (for destructive actions) */
  typeToConfirm?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  typeToConfirm,
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');

  if (!open) return null;

  const canConfirm = typeToConfirm ? typed === typeToConfirm : true;

  const buttonStyles = {
    danger: 'bg-red-600 hover:bg-red-700 text-white',
    warning: 'bg-yellow-600 hover:bg-yellow-700 text-white',
    default: 'bg-blue-600 hover:bg-blue-700 text-white',
  };

  const handleConfirm = () => {
    if (!canConfirm || loading) return;
    setTyped('');
    onConfirm();
  };

  const handleCancel = () => {
    setTyped('');
    onCancel();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4">
        <div className="flex items-start gap-3 mb-4">
          {variant === 'danger' && (
            <div className="p-2 bg-red-100 rounded-full shrink-0">
              <AlertTriangle size={20} className="text-red-600" />
            </div>
          )}
          {variant === 'warning' && (
            <div className="p-2 bg-yellow-100 rounded-full shrink-0">
              <AlertTriangle size={20} className="text-yellow-600" />
            </div>
          )}
          <div>
            <h3 className="text-lg font-semibold">{title}</h3>
            <p className="text-sm text-gray-500 mt-1">{message}</p>
          </div>
        </div>

        {typeToConfirm && (
          <div className="mb-4">
            <p className="text-sm text-gray-600 mb-2">
              Type <span className="font-mono font-bold text-red-600">{typeToConfirm}</span> to confirm:
            </p>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-red-500 font-mono"
              placeholder={typeToConfirm}
              autoFocus
            />
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleConfirm}
            disabled={!canConfirm || loading}
            className={`flex-1 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${buttonStyles[variant]}`}
          >
            {loading ? 'Processing...' : confirmLabel}
          </button>
          <button
            onClick={handleCancel}
            disabled={loading}
            className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-lg font-medium hover:bg-gray-200 transition-colors"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
