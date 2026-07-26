const express = require('express');
const router = express.Router();

const store = require('./store');
const { newId, now } = require('./helpers');
const { logEventInDraft } = require('./eventLogger');
const { requireAuth, requireAdmin } = require('./auth');

function interestRateFor(amount) {
  if (amount <= 5000) return 8.5;
  if (amount <= 20000) return 11.5;
  if (amount <= 50000) return 14.5;
  return 18.0;
}

// GET /api/loans — my loans
router.get('/', requireAuth, (req, res) => {
  const loans = store.getAll('loans').filter((l) => l.userId === req.user.id);
  res.json({ loans });
});

// POST /api/loans/request { amount, termMonths, purpose }
router.post('/request', requireAuth, async (req, res) => {
  const amount = Number(req.body && req.body.amount);
  const termMonths = Number(req.body && req.body.termMonths);
  const purpose = (req.body && req.body.purpose) || '';

  if (!amount || amount <= 0 || !termMonths || termMonths <= 0) {
    return res.status(400).json({ error: 'amount and termMonths must be positive numbers' });
  }

  const loan = await store.withTransaction(async (draft) => {
    const record = {
      id: newId('loan'),
      userId: req.user.id,
      amount,
      termMonths,
      purpose,
      interestRate: interestRateFor(amount),
      status: 'pending',
      createdAt: now(),
      decidedAt: null,
      decidedBy: null
    };
    draft.loans.push(record);
    logEventInDraft(draft, { type: 'loan.requested', userId: req.user.id, details: { loanId: record.id, amount, termMonths } });
    return record;
  });

  res.status(201).json({ loan });
});

// PATCH /api/loans/:id/decision  (admin) { decision: 'approve' | 'reject', creditAccountId? }
router.patch('/:id/decision', requireAdmin, async (req, res) => {
  const { decision, creditAccountId } = req.body || {};
  if (!['approve', 'reject'].includes(decision)) {
    return res.status(400).json({ error: "decision must be 'approve' or 'reject'" });
  }

  try {
    const loan = await store.withTransaction(async (draft) => {
      const record = draft.loans.find((l) => l.id === req.params.id);
      if (!record) throw { status: 404, message: 'Loan not found' };
      if (record.status !== 'pending') throw { status: 400, message: 'Loan already decided' };

      record.status = decision === 'approve' ? 'approved' : 'rejected';
      record.decidedAt = now();
      record.decidedBy = 'admin';

      if (decision === 'approve') {
        const account = creditAccountId
          ? draft.accounts.find((a) => a.id === creditAccountId && a.userId === record.userId)
          : draft.accounts.find((a) => a.userId === record.userId);
        if (!account) throw { status: 404, message: 'No account found to credit for this borrower' };

        account.balance += record.amount;
        draft.transactions.push({
          id: require('../utils/helpers').newId('txn'),
          accountId: account.id,
          type: 'loan_disbursement',
          amount: record.amount,
          balanceAfter: account.balance,
          description: 'Loan disbursement for loan ' + record.id,
          createdAt: now()
        });
      }

      logEventInDraft(draft, { type: 'loan.' + record.status, userId: record.userId, details: { loanId: record.id } });
      return record;
    });
    res.json({ loan });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || e });
  }
});

module.exports = router;
