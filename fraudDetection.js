const LARGE_TRANSFER_THRESHOLD = 50000;
const VELOCITY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const VELOCITY_MAX_COUNT = 3;
const BALANCE_DRAIN_RATIO = 0.9;

/**
 * Evaluate a transfer against a small set of fraud rules.
 * `existingTransfers` should be all prior transfers from the same account
 * (any status) so we can compute recent velocity.
 */
function evaluateTransfer({ amount, fromBalance, fromAccountId, existingTransfers }) {
  const reasons = [];

  if (amount > LARGE_TRANSFER_THRESHOLD) {
    reasons.push({
      rule: 'high_value',
      message: `Transfer amount ${amount} exceeds single-transfer threshold of ${LARGE_TRANSFER_THRESHOLD}`
    });
  }

  if (fromBalance > 0 && amount > fromBalance * BALANCE_DRAIN_RATIO) {
    reasons.push({
      rule: 'balance_drain',
      message: `Transfer would use more than ${Math.round(BALANCE_DRAIN_RATIO * 100)}% of the account balance`
    });
  }

  const cutoff = Date.now() - VELOCITY_WINDOW_MS;
  const recentCount = (existingTransfers || []).filter(
    (t) => t.fromAccountId === fromAccountId && new Date(t.createdAt).getTime() >= cutoff
  ).length;
  if (recentCount >= VELOCITY_MAX_COUNT) {
    reasons.push({
      rule: 'velocity',
      message: `${recentCount} transfers already initiated from this account in the last 5 minutes`
    });
  }

  return { flagged: reasons.length > 0, reasons };
}

module.exports = { evaluateTransfer, LARGE_TRANSFER_THRESHOLD, VELOCITY_WINDOW_MS, VELOCITY_MAX_COUNT };
