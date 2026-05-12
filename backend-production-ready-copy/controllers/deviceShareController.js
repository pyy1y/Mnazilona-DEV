const deviceShareService = require('../services/deviceShareService');
const { ShareError } = deviceShareService;
const { isValidObjectId } = require('../utils/helpers');

const handleError = (res, error, fallbackMessage) => {
  if (error instanceof ShareError) {
    return res.status(error.status).json({ message: error.message, code: error.code });
  }
  console.error(`${fallbackMessage}:`, error.message);
  return res.status(500).json({ message: fallbackMessage });
};

// ============================================================
// invite - POST /devices/:serialNumber/shares
// ============================================================
exports.invite = async (req, res) => {
  try {
    const { serialNumber } = req.params;
    const { email, permissions } = req.body;

    const share = await deviceShareService.createInvitation(
      req.user.id,
      serialNumber,
      email,
      permissions
    );

    res.status(201).json({ message: 'Invitation sent', share });
  } catch (error) {
    handleError(res, error, 'Failed to send invitation');
  }
};

// ============================================================
// list - GET /devices/:serialNumber/shares
// ============================================================
exports.list = async (req, res) => {
  try {
    const { serialNumber } = req.params;
    const shares = await deviceShareService.listSharesForDevice(req.user.id, serialNumber);
    res.json({ count: shares.length, shares });
  } catch (error) {
    handleError(res, error, 'Failed to list shares');
  }
};

// ============================================================
// revoke - DELETE /devices/:serialNumber/shares/:shareId
// ============================================================
exports.revoke = async (req, res) => {
  try {
    const { serialNumber, shareId } = req.params;
    if (!isValidObjectId(shareId)) {
      return res.status(400).json({ message: 'Invalid share id' });
    }

    const share = await deviceShareService.revokeShare(req.user.id, serialNumber, shareId);
    res.json({ message: 'Share revoked', share });
  } catch (error) {
    handleError(res, error, 'Failed to revoke share');
  }
};

// ============================================================
// accept - POST /shares/:shareId/accept
// ============================================================
exports.accept = async (req, res) => {
  try {
    const { shareId } = req.params;
    if (!isValidObjectId(shareId)) {
      return res.status(400).json({ message: 'Invalid share id' });
    }

    const share = await deviceShareService.acceptInvitation(req.user.id, shareId);
    res.json({ message: 'Invitation accepted', share });
  } catch (error) {
    handleError(res, error, 'Failed to accept invitation');
  }
};

// ============================================================
// reject - POST /shares/:shareId/reject
// ============================================================
exports.reject = async (req, res) => {
  try {
    const { shareId } = req.params;
    if (!isValidObjectId(shareId)) {
      return res.status(400).json({ message: 'Invalid share id' });
    }

    const share = await deviceShareService.rejectInvitation(req.user.id, shareId);
    res.json({ message: 'Invitation rejected', share });
  } catch (error) {
    handleError(res, error, 'Failed to reject invitation');
  }
};
