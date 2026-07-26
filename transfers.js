const express = require('express');
const router = express.Router();

const store = require('../db/store');
const { newId, now } = require('../utils/helpers');
const { logEventInDraft } = require('../utils/eventLogger');
const { requireAuth } = require('../middleware/auth');
const transferQueue = require('../queue/transferQueue');

// GET /api/transfers — my transfers
router.get('/', requireAuth, (req, res) => {
  const myAccountIds = store.getAll('accounts').filter((a) => a.userId === req.user.id).map((a) => a.id);
  const transfers = store.getAll('transfers')
    .filter((t) => t.userId === req.user.id || myAccountIds.includes(t.fromAccountId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ transfers });
});

// GET /api/transfers/:id
router.get('/:id', requireAuth, (req, res) => {
  const transfer = store.findById('transfers', req.params.id);
  if (!transfer || transfer.userId !== req.user.id) return res.status(404).json({ error: 'Transfer not found' });
  res.json({ transfer });
});

// POST /api/transfers  { fromAccountId, toAccountNumber, amount, description }
// PIN + OTP verification are separate calls (POST /api/auth/verify-pin and
// /api/auth/otp/verify) that the client should complete before calling this.
router.post('/', requireAuth, async (req, res) => {
  const { fromAccountId, toAccountNumber, amount, description } = req.body || {};
  const amt = Number(amount);
  if (!fromAccountId || !toAccountNumber || !amt || amt <= 0) {
    return res.status(400).json({ error: 'fromAccountId, toAccountNumber and a positive amount are required' });
  }

  try {
    const transfer = await store.withTransaction(async (draft) => {
      const fromAccount = draft.accounts.find((a) => a.id === fromAccountId);
      if (!fromAccount || fromAccount.userId !== req.user.id) throw { status: 404, message: 'Source account not found' };
      if (String(fromAccount.accountNumber) === String(toAccountNumber)) {
        throw { status: 400, message: 'Cannot transfer to the same account' };
      }
      if (fromAccount.balance < amt) throw { status: 400, message: 'Insufficient funds' };

      const record = {
        id: newId('trf'),
        userId: req.user.id,
        fromAccountId,
        toAccountNumber: String(toAccountNumber),
        amount: amt,
        description: description || '',
        status: 'queued',
        createdAt: now()
      };
      draft.transfers.push(record);
      logEventInDraft(draft, {
        type: 'transfer.queued',
        userId: req.user.id,
        details: { transferId: record.id, amount: amt, toAccountNumber: record.toAccountNumber }
      });
      return record;
    });

    transferQueue.enqueueTransfer(transfer.id);
    res.status(202).json({
      message: 'Transfer accepted and queued for settlement',
      transfer
    });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || e });
  }
});

module.exports = router;
