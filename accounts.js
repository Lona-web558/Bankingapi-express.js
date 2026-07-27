const express = require('express');
const router = express.Router();

const store = require('./store');
const { newId, newAccountNumber, now, BANK_INFO } = require('./helpers');
const { logEventInDraft } = require('./eventLogger');
const { requireAuth } = require('./auth');

// GET /api/accounts — list my accounts
router.get('/', requireAuth, (req, res) => {
  const accounts = store.getAll('accounts').filter((a) => a.userId === req.user.id);
  res.json({ accounts });
});

// GET /api/accounts/bank-info — this bank's own branch/routing/SWIFT-BIC
// codes, e.g. for a client to show "receive money" instructions. Must be
// declared before GET /:id so 'bank-info' isn't swallowed as an :id param.
router.get('/bank-info', requireAuth, (req, res) => {
  res.json({ bankInfo: BANK_INFO });
});

// POST /api/accounts — open an additional account
router.post('/', requireAuth, async (req, res) => {
  const type = (req.body && req.body.type) || 'savings';
  if (!['checking', 'savings'].includes(type)) {
    return res.status(400).json({ error: "type must be 'checking' or 'savings'" });
  }

  const account = await store.withTransaction(async (draft) => {
    const acc = {
      id: newId('acc'),
      userId: req.user.id,
      accountNumber: newAccountNumber(),
      type,
      currency: 'ZAR',
      balance: 0,
      branchCode: BANK_INFO.branchCode,
      routingCode: BANK_INFO.routingCode,
      swiftBic: BANK_INFO.swiftBic,
      createdAt: now()
    };
    draft.accounts.push(acc);
    logEventInDraft(draft, { type: 'account.opened', userId: req.user.id, details: { accountId: acc.id, type } });
    return acc;
  });

  res.status(201).json({ account });
});

// GET /api/accounts/:id
router.get('/:id', requireAuth, (req, res) => {
  const account = store.findById('accounts', req.params.id);
  if (!account || account.userId !== req.user.id) {
    return res.status(404).json({ error: 'Account not found' });
  }
  res.json({ account });
});

module.exports = router;
