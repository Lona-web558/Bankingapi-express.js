const express = require('express');
const router = express.Router();

const store = require('../db/store');
const { requireAuth } = require('../middleware/auth');

// GET /api/statements/:accountId?from=ISO&to=ISO
router.get('/:accountId', requireAuth, (req, res) => {
  const account = store.findById('accounts', req.params.accountId);
  if (!account || account.userId !== req.user.id) return res.status(404).json({ error: 'Account not found' });

  const { from, to } = req.query;
  const fromDate = from ? new Date(from) : new Date(0);
  const toDate = to ? new Date(to) : new Date();

  const all = store.getAll('transactions').filter((t) => t.accountId === account.id);
  const inRange = all.filter((t) => {
    const d = new Date(t.createdAt);
    return d >= fromDate && d <= toDate;
  }).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const before = all.filter((t) => new Date(t.createdAt) < fromDate);
  const openingBalance = before.length
    ? before.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0].balanceAfter
    : 0;
  const closingBalance = inRange.length ? inRange[inRange.length - 1].balanceAfter : openingBalance;

  res.json({
    account: { id: account.id, accountNumber: account.accountNumber, type: account.type, currency: account.currency },
    period: { from: fromDate.toISOString(), to: toDate.toISOString() },
    openingBalance,
    closingBalance,
    transactionCount: inRange.length,
    transactions: inRange,
    generatedAt: new Date().toISOString()
  });
});

module.exports = router;
