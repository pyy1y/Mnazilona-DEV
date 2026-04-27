const crypto = require('crypto');

// HMAC-SHA256(mqttToken, command + ts) → hex.
// Devices verify this in firmware before acting on any command where
// `source != "system"` (see GarageRelayFirmware*.ino verifyCommandHmac).
// Returns '' when no token is available; firmware treats an empty token as
// "dev mode" and skips verification on its side too, so the contract holds.
function buildCommandHmac(mqttToken, command, ts) {
  if (!mqttToken) return '';
  return crypto
    .createHmac('sha256', mqttToken)
    .update(`${command}${ts}`)
    .digest('hex');
}

// Convenience: build the full signed payload object for a device command.
// Always includes `ts` and `hmac` (possibly empty) so the wire format is
// uniform regardless of caller (user controller, admin controller, OTA, etc.).
function buildSignedCommand(mqttToken, command, extras = {}) {
  const ts = Date.now().toString();
  return {
    command,
    ts,
    hmac: buildCommandHmac(mqttToken, command, ts),
    ...extras,
  };
}

module.exports = { buildCommandHmac, buildSignedCommand };
