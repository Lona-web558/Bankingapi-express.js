const express = require('express');
const router = express.Router();

const store = require('../db/store');
const { newId, now } = require('../utils/helpers');
const { logEventInDraft } = require('../utils/eventLogger');
const { requireAuth } = require('../middleware/auth');

const LARGE_WITHDRAWAL_THRESHOLD = 30000;

// GET /api/transactions/:accountId
router.get('/:accountId', requireAuth, (req, res) => {
  const account = store.findById('accounts', req.params.accountId);
  if (!account || account.userId !== req.user.id) return res.status(404).json({ error: 'Account not found' });

  let txns = store.getAll('transactions').filter((t) => t.accountId === account.id);
  const { from, to } = req.query;
  if (from) txns = txns.filter((t) => new Date(t.createdAt) >= new Date(from));
  if (to) txns = txns.filter((t) => new Date(t.createdAt) <= new Date(to));
  txns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({ accountId: account.id, transactions: txns });
});

// POST /api/transactions  { accountId, type: 'deposit' | 'withdraw', amount, description }
router.post('/', requireAuth, async (req, res) => {
  const { accountId, type, amount, description } = req.body || {};
  const amt = Number(amount);
  if (!accountId || !['deposit', 'withdraw'].includes(type) || !amt || amt <= 0) {
    return res.status(400).json({ error: "accountId, type ('deposit'|'withdraw') and a positive amount are required" });
  }

  try {
    const result = await store.withTransaction(async (draft) => {
      const account = draft.accounts.find((a) => a.id === accountId);
      if (!account || account.userId !== req.user.id) throw { status: 404, message: 'Account not found' };

      if (type === 'withdraw') {
        if (account.balance < amt) throw { status: 400, message: 'Insufficient funds' };
        account.balance -= amt;
      } else {
        account.balance += amt;
      }

      const txn = {
        id: newId('txn'),
        accountId: account.id,
        type,
        amount: type === 'withdraw' ? -amt : amt,
        balanceAfter: account.balance,
        description: description || type,
        createdAt: now()
      };
      draft.transactions.push(txn);

      logEventInDraft(draft, {
        type: 'transaction.' + type,
        userId: req.user.id,
        details: { accountId: account.id, amount: amt, newBalance: account.balance }
      });

      if (type === 'withdraw' && amt > LARGE_WITHDRAWAL_THRESHOLD) {
        draft.fraudFlags.push({
          id: newId('flag'),
          transferId: null,
          transactionId: txn.id,
          userId: req.user.id,
          rule: 'large_withdrawal',
          message: 'Withdrawal of ' + amt + ' exceeds the large-withdrawal threshold of ' + LARGE_WITHDRAWAL_THRESHOLD,
          createdAt: now(),
          resolved: false
        });
        logEventInDraft(draft, { type: 'fraud.flagged', userId: req.user.id, details: { rule: 'large_withdrawal', transactionId: txn.id } });
      }

      return { account, txn };
    });

    res.status(201).json({ account: result.account, transaction: result.txn });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || e });
  }
});

module.exports = router;
