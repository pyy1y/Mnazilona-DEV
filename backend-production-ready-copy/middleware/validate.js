const Joi = require('joi');

/**
 * Express middleware factory: validates req.body against a Joi schema.
 * Returns 400 with a clear message on validation failure.
 */
const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const messages = error.details.map((d) => d.message).join('. ');
    return res.status(400).json({ message: messages });
  }

  req.body = value; // use sanitized values
  next();
};

// ==================== AUTH SCHEMAS ====================

const loginSendCodeSchema = Joi.object({
  email: Joi.string().email().required().max(255).messages({
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required',
  }),
  password: Joi.string().required().min(1).max(128).messages({
    'any.required': 'Password is required',
  }),
});

const loginVerifyCodeSchema = Joi.object({
  email: Joi.string().email().required().max(255),
  code: Joi.string().required().length(6).pattern(/^\d+$/).messages({
    'string.length': 'Verification code must be 6 digits',
    'string.pattern.base': 'Verification code must be numeric',
  }),
});

const registerSendCodeSchema = Joi.object({
  email: Joi.string().email().required().max(255),
});

const registerVerifyCodeSchema = Joi.object({
  email: Joi.string().email().required().max(255),
  code: Joi.string().required().length(6).pattern(/^\d+$/),
  name: Joi.string().required().min(2).max(100).messages({
    'string.min': 'Name must be at least 2 characters',
  }),
  password: Joi.string().required().min(8).max(128)
    .pattern(/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{}|;:'",.<>?/\\`~])/)
    .messages({
      'string.pattern.base': 'Password must contain uppercase, lowercase, number, and special character',
      'string.min': 'Password must be at least 8 characters',
    }),
  dob: Joi.string().allow('').max(50).optional(),
  country: Joi.string().allow('').max(100).optional(),
  city: Joi.string().allow('').max(100).optional(),
});

const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required().max(255),
});

const resetPasswordSchema = Joi.object({
  email: Joi.string().email().required().max(255),
  code: Joi.string().required().length(6).pattern(/^\d+$/),
  newPassword: Joi.string().required().min(8).max(128)
    .pattern(/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{}|;:'",.<>?/\\`~])/),
});

const changePasswordSchema = Joi.object({
  oldPassword: Joi.string().required().max(128),
  newPassword: Joi.string().required().min(8).max(128)
    .pattern(/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{}|;:'",.<>?/\\`~])/)
    .messages({
      'string.pattern.base': 'Password must contain uppercase, lowercase, number, and special character',
    }),
});

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required().hex().length(80).messages({
    'any.required': 'Refresh token is required',
  }),
});

// ==================== DEVICE SCHEMAS ====================

const serialNumberPattern = /^[A-Za-z0-9\-_.]+$/;
const requestIdSchema = Joi.string().trim().max(80).pattern(/^[A-Za-z0-9:_-]+$/);

const deviceInquirySchema = Joi.object({
  serialNumber: Joi.string().required().max(50).pattern(serialNumberPattern).messages({
    'string.pattern.base': 'Serial number contains invalid characters',
  }),
  deviceSecret: Joi.string().required().max(128),
  macAddress: Joi.string().optional().max(17).pattern(/^[A-Fa-f0-9:.\-]+$/).allow('', null),
});

const devicePairSchema = Joi.object({
  serialNumber: Joi.string().required().max(50).pattern(serialNumberPattern),
  deviceSecret: Joi.string().required().max(128),
  requestId: requestIdSchema.optional(),
});

const deviceUnpairSchema = Joi.object({
  serialNumber: Joi.string().required().max(50).pattern(serialNumberPattern),
});

const deviceCommandSchema = Joi.object({
  command: Joi.string().required().valid('open', 'on', 'off', 'toggle', 'status', 'restart', 'config').messages({
    'any.only': 'Invalid command',
  }),
  params: Joi.object().optional().default({}),
  requestId: requestIdSchema.optional(),
});

const deviceRenameSchema = Joi.object({
  name: Joi.string().required().min(1).max(100).trim(),
});

const deviceValidateSchema = Joi.object({
  serialNumber: Joi.string().required().max(50).pattern(serialNumberPattern),
});

// ==================== ADMIN SCHEMAS ====================

const adminRegisterDeviceSchema = Joi.object({
  serialNumber: Joi.string().required().max(50).pattern(serialNumberPattern),
  deviceType: Joi.string().valid('relay', 'sensor', 'switch', 'light', 'dimmer', 'water-tank', 'ac', 'security', 'lock', 'other').default('relay'),
  deviceSecret: Joi.string().optional().max(128),
  firmwareVersion: Joi.string().optional().max(20).default('1.0.0'),
  hardwareVersion: Joi.string().optional().max(20).default('1.0'),
  macAddress: Joi.string().optional().max(17).allow('', null),
  notes: Joi.string().optional().max(500).allow(''),
});

const adminRegisterBatchSchema = Joi.object({
  devices: Joi.array().items(
    Joi.object({
      serialNumber: Joi.string().required().max(50).pattern(serialNumberPattern),
      deviceType: Joi.string().valid('relay', 'sensor', 'switch', 'light', 'dimmer', 'water-tank', 'ac', 'security', 'lock', 'other').default('relay'),
      deviceSecret: Joi.string().optional().max(128),
      firmwareVersion: Joi.string().optional().max(20),
      hardwareVersion: Joi.string().optional().max(20),
      notes: Joi.string().optional().max(500).allow(''),
    })
  ).min(1).max(100).required().messages({
    'array.min': 'At least one device is required',
    'array.max': 'Maximum 100 devices per batch',
  }),
});

const adminBanDeviceSchema = Joi.object({
  serialNumber: Joi.string().required().max(50).pattern(serialNumberPattern),
  reason: Joi.string().optional().max(500).allow(''),
});

const adminUnbanDeviceSchema = Joi.object({
  serialNumber: Joi.string().required().max(50).pattern(serialNumberPattern),
});

const adminTransferDeviceSchema = Joi.object({
  newOwnerId: Joi.string().required().hex().length(24).messages({
    'string.hex': 'Invalid user ID format',
    'string.length': 'Invalid user ID format',
  }),
});

const adminCommandSchema = Joi.object({
  command: Joi.string().required().valid('open', 'on', 'off', 'toggle', 'status', 'restart', 'config'),
  params: Joi.object().optional().default({}),
});

const adminLockDeviceSchema = Joi.object({
  reason: Joi.string().optional().max(500).allow(''),
});

const blockIPSchema = Joi.object({
  ip: Joi.string().required().ip().messages({
    'string.ip': 'Invalid IP address format',
  }),
  reason: Joi.string().required().max(500),
  duration: Joi.number().optional().integer().min(0).max(365 * 24 * 60),
  expiresAt: Joi.date().optional(),
});

module.exports = {
  validate,
  // Auth
  loginSendCodeSchema,
  loginVerifyCodeSchema,
  registerSendCodeSchema,
  registerVerifyCodeSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  refreshTokenSchema,
  // Device
  deviceInquirySchema,
  devicePairSchema,
  deviceUnpairSchema,
  deviceCommandSchema,
  deviceRenameSchema,
  deviceValidateSchema,
  // Admin
  adminRegisterDeviceSchema,
  adminRegisterBatchSchema,
  adminBanDeviceSchema,
  adminUnbanDeviceSchema,
  adminTransferDeviceSchema,
  adminCommandSchema,
  adminLockDeviceSchema,
  blockIPSchema,
};
