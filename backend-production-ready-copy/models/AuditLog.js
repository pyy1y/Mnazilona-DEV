const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    adminEmail: {
      type: String,
      required: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        'admin_login',
        'user_view',
        'user_deactivate',
        'user_activate',
        'user_delete',
        'user_force_logout',
        'device_register',
        'device_register_batch',
        'device_ban',
        'device_unban',
        'device_command',
        'device_unpair',
        'device_transfer',
        'device_factory_reset',
        'device_lock',
        'device_unlock',
        'firmware_create',
        'firmware_update',
        'firmware_delete',
        'settings_update',
        'ip_block',
        'ip_unblock',
        'anomaly_resolve',
        'anomaly_acknowledge',
      ],
      index: true,
    },
    target: {
      type: String,
      default: null,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    ip: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.__v;
        return ret;
      },
    },
  }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

// Keep audit logs for 1 year
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
