const crypto = require('crypto');

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}

function newAccountNumber() {
  // 10-digit account number
  return String(Math.floor(1000000000 + Math.random() * 8999999999));
}

function newOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

function now() {
  return new Date().toISOString();
}

module.exports = { newId: newId, newAccountNumber: newAccountNumber, newOtpCode: newOtpCode, now: now };
