const express = require('express');
const router = express.Router();

const store = require('../db/store');
const { newId, now } = require('../utils/helpers');
const { logEventInDraft } = require('../utils/eventLogger');
const { requireAuth } = require('../middleware/auth');

// GET /api/wallets/me
router.get('/me', requireAuth, (req, res) => {
  const wallet = store.getAll('wallets').find((w) => w.userId === req.user.id);
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
  res.json({ wallet });
});

// POST /api/wallets/topup { amount, source }
router.post('/topup', requireAuth, async (req, res) => {
  const amount = Number(req.body && req.body.amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount must be a positive number' });

  try {
    const wallet = await store.withTransaction(async (draft) => {
      const w = draft.wallets.find((x) => x.userId === req.user.id);
      if (!w) throw { status: 404, message: 'Wallet not found' };
      w.balance += amount;
      logEventInDraft(draft, {
        type: 'wallet.topup',
        userId: req.user.id,
        details: { amount, source: (req.body && req.body.source) || 'external', newBalance: w.balance }
      });
      return w;
    });
    res.json({ wallet });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || e });
  }
});

module.exports = router;
