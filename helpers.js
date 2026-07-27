const crypto = require('crypto');

// Static identifiers for this simulated bank. Real institutions get these
// from a regulator/SWIFT registry rather than hardcoding them, but for a
// single-bank demo they're constant across every account.
const BANK_INFO = {
  bankName: 'Gold Fundamentals Bank',
  // South African-style 6-digit universal branch code.
  branchCode: '198765',
  // Kept as a separate field for clients/integrations that expect a
  // "routing code" rather than a "branch code" — same value here since this
  // demo bank only operates one branch.
  routingCode: '198765',
  // 11-character SWIFT/BIC: 4 bank code + 2 country + 2 location + 3 branch.
  swiftBic: 'GFBKZAJJXXX'
};

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

module.exports = {
  newId: newId,
  newAccountNumber: newAccountNumber,
  newOtpCode: newOtpCode,
  now: now,
  BANK_INFO: BANK_INFO
};
