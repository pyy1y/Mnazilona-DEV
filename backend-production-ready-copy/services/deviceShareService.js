const Device = require('../models/Device');
const DeviceShare = require('../models/DeviceShare');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { emitToUser } = require('../config/socket');
const sendEmail = require('../utils/sendEmail');

// Send an email out-of-band so SMTP latency never blocks the API response.
// All failures are logged and swallowed — email is informational, the
// in-app notification is the source of truth.
const sendEmailSafe = (to, subject, text) => {
  if (!to) return;
  setImmediate(async () => {
    try {
      await sendEmail(to, subject, text);
    } catch (err) {
      console.error(`Share email failed to ${to}: ${err.message}`);
    }
  });
};

class ShareError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const ALLOWED_PERMISSIONS = ['view', 'control'];

const sanitizeShare = (share) => ({
  id: share._id,
  device: share.device,
  serialNumber: share.serialNumber,
  owner: share.owner,
  sharedWith: share.sharedWith,
  invitedEmail: share.invitedEmail,
  permissions: share.permissions,
  status: share.status,
  invitedAt: share.invitedAt,
  respondedAt: share.respondedAt,
  revokedAt: share.revokedAt,
  expiresAt: share.expiresAt,
});

const normalizePermissions = (input) => {
  if (!Array.isArray(input) || input.length === 0) {
    return ['view', 'control'];
  }
  const cleaned = [...new Set(input.map((p) => String(p).toLowerCase().trim()))];
  const filtered = cleaned.filter((p) => ALLOWED_PERMISSIONS.includes(p));
  if (filtered.length === 0) {
    throw new ShareError('INVALID_PERMISSIONS', 'No valid permissions provided', 400);
  }
  return filtered;
};

// Treat already-passed expiry as expired even if the sweeper hasn't run.
const isExpired = (share) => {
  if (!share.expiresAt) return false;
  return share.expiresAt.getTime() < Date.now();
};

// ============================================================
// createInvitation - owner invites a user by email
// ============================================================
const createInvitation = async (ownerId, serialNumber, email, permissions) => {
  const cleanSerial = String(serialNumber || '').trim().toUpperCase();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const perms = normalizePermissions(permissions);

  if (!cleanSerial) {
    throw new ShareError('INVALID_INPUT', 'Serial number is required', 400);
  }
  if (!cleanEmail) {
    throw new ShareError('INVALID_INPUT', 'Email is required', 400);
  }

  const device = await Device.findOne({ serialNumber: cleanSerial });
  if (!device) {
    throw new ShareError('DEVICE_NOT_FOUND', 'Device not found', 404);
  }
  if (!device.owner || device.owner.toString() !== ownerId.toString()) {
    throw new ShareError('NOT_OWNER', 'Only the device owner can share this device', 403);
  }

  const invitee = await User.findByEmail(cleanEmail).select('_id email name');
  if (!invitee) {
    throw new ShareError('USER_NOT_FOUND', 'No account found for this email', 404);
  }
  if (invitee._id.toString() === ownerId.toString()) {
    throw new ShareError('CANNOT_SHARE_WITH_SELF', "You can't share a device with yourself", 400);
  }

  const existing = await DeviceShare.findOne({
    device: device._id,
    sharedWith: invitee._id,
    status: { $in: ['pending', 'active'] },
  });
  if (existing) {
    if (existing.status === 'active') {
      throw new ShareError('ALREADY_SHARED', 'This user already has access to the device', 409);
    }
    throw new ShareError('ALREADY_PENDING', 'An invitation is already pending for this user', 409);
  }

  const owner = await User.findById(ownerId).select('email name');

  let share;
  try {
    share = await DeviceShare.create({
      device: device._id,
      serialNumber: device.serialNumber,
      owner: ownerId,
      sharedWith: invitee._id,
      invitedEmail: cleanEmail,
      permissions: perms,
      status: 'pending',
      invitedAt: new Date(),
      expiresAt: new Date(Date.now() + DeviceShare.PENDING_INVITATION_TTL_MS),
    });
  } catch (err) {
    // Race: a parallel request just created an active/pending row.
    if (err && err.code === 11000) {
      throw new ShareError('ALREADY_PENDING', 'An invitation is already pending for this user', 409);
    }
    throw err;
  }

  try {
    const notif = await Notification.create({
      recipient: invitee._id,
      type: 'share_request',
      message: `${owner?.name || 'Someone'} wants to share "${device.name || device.serialNumber}" with you.`,
      data: {
        shareId: share._id,
        serialNumber: device.serialNumber,
        deviceName: device.name || device.serialNumber,
        ownerId,
        ownerEmail: owner?.email || null,
        ownerName: owner?.name || null,
        sharedWithId: invitee._id,
        sharedWithEmail: invitee.email,
      },
    });

    emitToUser(invitee._id, 'notification:new', notif);
  } catch (notifErr) {
    console.error('Share notification creation failed:', notifErr.message);
  }

  sendEmailSafe(
    invitee.email,
    `${owner?.name || 'Someone'} shared a device with you on Mnazilona`,
    `${owner?.name || 'A Mnazilona user'} (${owner?.email || 'unknown'}) wants to share "${device.name || device.serialNumber}" with you.\n\n` +
    `Open the Mnazilona app and check your notifications to accept or decline the invitation.\n\n` +
    `This invitation expires in 7 days.`
  );

  return sanitizeShare(share);
};

// ============================================================
// acceptInvitation - invitee accepts a pending share
// ============================================================
const acceptInvitation = async (userId, shareId) => {
  const share = await DeviceShare.findById(shareId);
  if (!share || share.sharedWith.toString() !== userId.toString()) {
    throw new ShareError('SHARE_NOT_FOUND', 'Invitation not found', 404);
  }
  if (share.status !== 'pending') {
    throw new ShareError('SHARE_NO_LONGER_AVAILABLE', 'This invitation is no longer available', 410);
  }
  if (isExpired(share)) {
    share.status = 'expired';
    await share.save();
    throw new ShareError('SHARE_NO_LONGER_AVAILABLE', 'This invitation has expired', 410);
  }

  // Atomic flip prevents accept-after-revoke races.
  const updated = await DeviceShare.findOneAndUpdate(
    { _id: share._id, status: 'pending' },
    { status: 'active', respondedAt: new Date() },
    { new: true }
  );
  if (!updated) {
    throw new ShareError('SHARE_NO_LONGER_AVAILABLE', 'This invitation is no longer available', 410);
  }

  let acceptedInvitee = null;
  let acceptedDevice = null;
  let acceptedOwner = null;
  try {
    const [invitee, device, owner] = await Promise.all([
      User.findById(userId).select('email name'),
      Device.findById(updated.device).select('name serialNumber'),
      User.findById(updated.owner).select('email name'),
    ]);
    acceptedInvitee = invitee;
    acceptedDevice = device;
    acceptedOwner = owner;

    const notif = await Notification.create({
      recipient: updated.owner,
      type: 'share_accepted',
      message: `${invitee?.name || invitee?.email || 'A user'} accepted your invitation to access "${device?.name || updated.serialNumber}".`,
      data: {
        shareId: updated._id,
        serialNumber: updated.serialNumber,
        deviceName: device?.name || updated.serialNumber,
        sharedWithId: userId,
        sharedWithEmail: invitee?.email || null,
      },
    });

    emitToUser(updated.owner, 'notification:new', notif);
    emitToUser(userId, 'device:share-accepted', { serialNumber: updated.serialNumber });
  } catch (notifErr) {
    console.error('Share-accepted notification failed:', notifErr.message);
  }

  sendEmailSafe(
    acceptedOwner?.email,
    `Your device share was accepted`,
    `${acceptedInvitee?.name || acceptedInvitee?.email || 'A user'} accepted your invitation ` +
    `to access "${acceptedDevice?.name || updated.serialNumber}".\n\n` +
    `They can now view and control the device through the Mnazilona app.`
  );

  return sanitizeShare(updated);
};

// ============================================================
// rejectInvitation - invitee rejects a pending share
// ============================================================
const rejectInvitation = async (userId, shareId) => {
  const share = await DeviceShare.findById(shareId);
  if (!share || share.sharedWith.toString() !== userId.toString()) {
    throw new ShareError('SHARE_NOT_FOUND', 'Invitation not found', 404);
  }
  if (share.status !== 'pending') {
    throw new ShareError('SHARE_NO_LONGER_AVAILABLE', 'This invitation is no longer available', 410);
  }

  const updated = await DeviceShare.findOneAndUpdate(
    { _id: share._id, status: 'pending' },
    { status: 'rejected', respondedAt: new Date() },
    { new: true }
  );
  if (!updated) {
    throw new ShareError('SHARE_NO_LONGER_AVAILABLE', 'This invitation is no longer available', 410);
  }

  let rejectedInvitee = null;
  let rejectedDevice = null;
  let rejectedOwner = null;
  try {
    const [invitee, device, owner] = await Promise.all([
      User.findById(userId).select('email name'),
      Device.findById(updated.device).select('name serialNumber'),
      User.findById(updated.owner).select('email name'),
    ]);
    rejectedInvitee = invitee;
    rejectedDevice = device;
    rejectedOwner = owner;

    const notif = await Notification.create({
      recipient: updated.owner,
      type: 'share_rejected',
      message: `${invitee?.name || invitee?.email || 'A user'} declined your invitation to access "${device?.name || updated.serialNumber}".`,
      data: {
        shareId: updated._id,
        serialNumber: updated.serialNumber,
        deviceName: device?.name || updated.serialNumber,
        sharedWithId: userId,
        sharedWithEmail: invitee?.email || null,
      },
    });

    emitToUser(updated.owner, 'notification:new', notif);
  } catch (notifErr) {
    console.error('Share-rejected notification failed:', notifErr.message);
  }

  sendEmailSafe(
    rejectedOwner?.email,
    `Your device share was declined`,
    `${rejectedInvitee?.name || rejectedInvitee?.email || 'A user'} declined your invitation ` +
    `to access "${rejectedDevice?.name || updated.serialNumber}".`
  );

  return sanitizeShare(updated);
};

// ============================================================
// listSharesForDevice - owner lists shares for one device
// ============================================================
const listSharesForDevice = async (ownerId, serialNumber) => {
  const cleanSerial = String(serialNumber || '').trim().toUpperCase();
  const device = await Device.findOne({ serialNumber: cleanSerial });
  if (!device) {
    throw new ShareError('DEVICE_NOT_FOUND', 'Device not found', 404);
  }
  if (!device.owner || device.owner.toString() !== ownerId.toString()) {
    throw new ShareError('NOT_OWNER', 'Only the device owner can list shares', 403);
  }

  const shares = await DeviceShare.find({
    device: device._id,
    status: { $in: ['pending', 'active'] },
  })
    .populate('sharedWith', 'email name')
    .sort({ createdAt: -1 })
    .lean();

  return shares.map((s) => ({
    id: s._id,
    serialNumber: s.serialNumber,
    invitedEmail: s.invitedEmail,
    sharedWith: s.sharedWith
      ? { id: s.sharedWith._id, email: s.sharedWith.email, name: s.sharedWith.name }
      : null,
    permissions: s.permissions,
    status: s.status,
    invitedAt: s.invitedAt,
    respondedAt: s.respondedAt,
    expiresAt: s.expiresAt,
  }));
};

// ============================================================
// revokeShare - owner revokes a pending or active share
// ============================================================
const revokeShare = async (ownerId, serialNumber, shareId) => {
  const cleanSerial = String(serialNumber || '').trim().toUpperCase();
  const device = await Device.findOne({ serialNumber: cleanSerial });
  if (!device) {
    throw new ShareError('DEVICE_NOT_FOUND', 'Device not found', 404);
  }
  if (!device.owner || device.owner.toString() !== ownerId.toString()) {
    throw new ShareError('NOT_OWNER', 'Only the device owner can revoke shares', 403);
  }

  const share = await DeviceShare.findOne({ _id: shareId, device: device._id });
  if (!share) {
    throw new ShareError('SHARE_NOT_FOUND', 'Share not found', 404);
  }
  if (!['pending', 'active'].includes(share.status)) {
    throw new ShareError('SHARE_NOT_REVOCABLE', 'This share is not active or pending', 409);
  }

  const previousStatus = share.status;
  share.status = 'revoked';
  share.revokedAt = new Date();
  await share.save();

  let revokedOwner = null;
  let revokedInvitee = null;
  try {
    const [owner, invitee] = await Promise.all([
      User.findById(ownerId).select('email name'),
      User.findById(share.sharedWith).select('email name'),
    ]);
    revokedOwner = owner;
    revokedInvitee = invitee;

    const notif = await Notification.create({
      recipient: share.sharedWith,
      type: 'share_revoked',
      message: previousStatus === 'pending'
        ? `${owner?.name || 'The owner'} cancelled the invitation to share "${device.name || device.serialNumber}".`
        : `Your access to "${device.name || device.serialNumber}" has been removed by ${owner?.name || 'the owner'}.`,
      data: {
        shareId: share._id,
        serialNumber: device.serialNumber,
        deviceName: device.name || device.serialNumber,
        ownerId,
        ownerEmail: owner?.email || null,
        ownerName: owner?.name || null,
      },
    });

    emitToUser(share.sharedWith, 'notification:new', notif);
    emitToUser(share.sharedWith, 'device:share-revoked', { serialNumber: device.serialNumber });
  } catch (notifErr) {
    console.error('Share-revoked notification failed:', notifErr.message);
  }

  sendEmailSafe(
    revokedInvitee?.email,
    previousStatus === 'pending'
      ? `Invitation cancelled`
      : `Device access removed`,
    previousStatus === 'pending'
      ? `${revokedOwner?.name || 'The owner'} cancelled the invitation to share ` +
        `"${device.name || device.serialNumber}" with you.`
      : `${revokedOwner?.name || 'The owner'} has removed your access to ` +
        `"${device.name || device.serialNumber}". You can no longer view or control this device.`
  );

  return sanitizeShare(share);
};

module.exports = {
  ShareError,
  createInvitation,
  acceptInvitation,
  rejectInvitation,
  listSharesForDevice,
  revokeShare,
};
