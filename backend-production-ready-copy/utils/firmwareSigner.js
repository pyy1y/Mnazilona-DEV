const crypto = require('crypto');
const fs = require('fs');

/**
 * Signs a firmware binary using RSA-SHA256.
 * The private key path is read from FIRMWARE_SIGNING_KEY env var.
 * Returns the signature as a base64 string.
 */
const signFirmware = (fileBuffer) => {
  const keyPath = process.env.FIRMWARE_SIGNING_KEY;
  if (!keyPath) {
    console.warn('FIRMWARE_SIGNING_KEY not set - firmware will not be signed');
    return null;
  }

  if (!fs.existsSync(keyPath)) {
    console.error(`Firmware signing key not found at: ${keyPath}`);
    return null;
  }

  const privateKey = fs.readFileSync(keyPath, 'utf8');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(fileBuffer);
  sign.end();

  return sign.sign(privateKey, 'base64');
};

/**
 * Verifies a firmware signature using the public key.
 * Used to validate firmware integrity before serving to devices.
 */
const verifyFirmwareSignature = (fileBuffer, signature) => {
  const keyPath = process.env.FIRMWARE_VERIFY_KEY;
  if (!keyPath || !signature) return false;

  if (!fs.existsSync(keyPath)) {
    console.error(`Firmware verify key not found at: ${keyPath}`);
    return false;
  }

  const publicKey = fs.readFileSync(keyPath, 'utf8');
  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(fileBuffer);
  verify.end();

  return verify.verify(publicKey, signature, 'base64');
};

module.exports = { signFirmware, verifyFirmwareSignature };
