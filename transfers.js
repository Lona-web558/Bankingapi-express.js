const express = require('express');
const router = express.Router();

const store = require('./store');
const { newId, now } = require('./helpers');
const { logEventInDraft } = require('./eventLogger');
const { requireAuth } = require('./auth');
const transferQueue = require('./transferQueue');

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
// Destination bank codes are only required when the transfer leaves this
// bank (i.e. the caller supplies one). Loose format checks — this is a demo,
// not a real SWIFT/branch registry.
const BRANCH_CODE_RE = /^\d{6}$/;
const SWIFT_BIC_RE = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

router.post('/', requireAuth, async (req, res) => {
  const {
    fromAccountId, toAccountNumber, amount, description,
    toBranchCode, toRoutingCode, toSwiftBic
  } = req.body || {};
  const amt = Number(amount);
  if (!fromAccountId || !toAccountNumber || !amt || amt <= 0) {
    return res.status(400).json({ error: 'fromAccountId, toAccountNumber and a positive amount are required' });
  }
  if (toBranchCode && !BRANCH_CODE_RE.test(String(toBranchCode))) {
    return res.status(400).json({ error: 'toBranchCode must be a 6-digit branch/routing code' });
  }
  if (toRoutingCode && !BRANCH_CODE_RE.test(String(toRoutingCode))) {
    return res.status(400).json({ error: 'toRoutingCode must be a 6-digit branch/routing code' });
  }
  if (toSwiftBic && !SWIFT_BIC_RE.test(String(toSwiftBic).toUpperCase())) {
    return res.status(400).json({ error: 'toSwiftBic must be a valid 8 or 11-character SWIFT/BIC code' });
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
        // Present only for transfers to another bank; internal transfers
        // resolve the destination account directly by account number and
        // leave these null.
        toBranchCode: toBranchCode ? String(toBranchCode) : null,
        toRoutingCode: toRoutingCode ? String(toRoutingCode) : null,
        toSwiftBic: toSwiftBic ? String(toSwiftBic).toUpperCase() : null,
        amount: amt,
        description: description || '',
        status: 'queued',
        createdAt: now()
      };
      draft.transfers.push(record);
      logEventInDraft(draft, {
        type: 'transfer.queued',
        userId: req.user.id,
        details: {
          transferId: record.id,
          amount: amt,
          toAccountNumber: record.toAccountNumber,
          toBranchCode: record.toBranchCode,
          toSwiftBic: record.toSwiftBic
        }
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
