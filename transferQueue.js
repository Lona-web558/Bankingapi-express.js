const store = require('./store');
const { newId, now, BANK_INFO } = require('./helpers');
const { logEventInDraft } = require('./eventLogger');
const fraud = require('./fraudDetection');

// Simple in-memory FIFO queue of transfer IDs waiting to be settled.
const pending = [];
let workerRunning = false;

function enqueueTransfer(transferId) {
  pending.push(transferId);
}

async function processOne(transferId) {
  await store.withTransaction(async (draft) => {
    const transfer = draft.transfers.find((t) => t.id === transferId);
    if (!transfer || transfer.status !== 'queued') return; // already handled

    const fromAccount = draft.accounts.find((a) => a.id === transfer.fromAccountId);
    const toAccount = draft.accounts.find((a) => a.accountNumber === transfer.toAccountNumber);

    if (!fromAccount) {
      transfer.status = 'failed';
      transfer.failReason = 'Source account not found';
      logEventInDraft(draft, { type: 'transfer.failed', userId: transfer.userId, details: { transferId: transferId, reason: transfer.failReason } });
      return;
    }
    if (transfer.toSwiftBic && transfer.toSwiftBic !== BANK_INFO.swiftBic) {
      transfer.status = 'failed';
      transfer.failReason = 'External bank transfers are not settled in this demo (no correspondent network) — destination SWIFT/BIC ' + transfer.toSwiftBic + ' is not this bank';
      logEventInDraft(draft, { type: 'transfer.failed', userId: transfer.userId, details: { transferId: transferId, reason: transfer.failReason } });
      return;
    }
    if (!toAccount) {
      transfer.status = 'failed';
      transfer.failReason = 'Destination account number not found';
      logEventInDraft(draft, { type: 'transfer.failed', userId: transfer.userId, details: { transferId: transferId, reason: transfer.failReason } });
      return;
    }
    if (fromAccount.balance < transfer.amount) {
      transfer.status = 'failed';
      transfer.failReason = 'Insufficient funds at settlement time';
      logEventInDraft(draft, { type: 'transfer.failed', userId: transfer.userId, details: { transferId: transferId, reason: transfer.failReason } });
      return;
    }

    const evaluation = fraud.evaluateTransfer({
      amount: transfer.amount,
      fromBalance: fromAccount.balance,
      fromAccountId: fromAccount.id,
      existingTransfers: draft.transfers.filter((t) => t.id !== transferId)
    });

    if (evaluation.flagged) {
      transfer.status = 'held_for_review';
      transfer.fraudReasons = evaluation.reasons;
      for (const reason of evaluation.reasons) {
        draft.fraudFlags.push({
          id: newId('flag'),
          transferId: transferId,
          userId: transfer.userId,
          rule: reason.rule,
          message: reason.message,
          createdAt: now(),
          resolved: false
        });
      }
      logEventInDraft(draft, {
        type: 'transfer.held_for_review',
        userId: transfer.userId,
        details: { transferId: transferId, reasons: evaluation.reasons.map(function (r) { return r.rule; }) }
      });
      return;
    }

    // Settle: debit sender, credit recipient (atomic — same transaction draft).
    fromAccount.balance -= transfer.amount;
    toAccount.balance += transfer.amount;

    draft.transactions.push({
      id: newId('txn'),
      accountId: fromAccount.id,
      type: 'transfer_out',
      amount: -transfer.amount,
      balanceAfter: fromAccount.balance,
      description: transfer.description || ('Transfer to ' + toAccount.accountNumber),
      createdAt: now(),
      relatedTransferId: transferId
    });
    draft.transactions.push({
      id: newId('txn'),
      accountId: toAccount.id,
      type: 'transfer_in',
      amount: transfer.amount,
      balanceAfter: toAccount.balance,
      description: transfer.description || ('Transfer from ' + fromAccount.accountNumber),
      createdAt: now(),
      relatedTransferId: transferId
    });

    transfer.status = 'completed';
    transfer.completedAt = now();

    logEventInDraft(draft, {
      type: 'transfer.completed',
      userId: transfer.userId,
      details: { transferId: transferId, amount: transfer.amount, to: toAccount.accountNumber }
    });
  });
}

async function workerTick() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    while (pending.length > 0) {
      const id = pending.shift();
      try {
        await processOne(id);
      } catch (e) {
        console.error('[transferQueue] failed to process', id, e.message);
      }
    }
  } finally {
    workerRunning = false;
  }
}

function startWorker(intervalMs) {
  setInterval(workerTick, intervalMs || 2000);
  // Re-queue anything left "queued" from a previous run (e.g. after restart).
  var all = store.getAll('transfers');
  for (var i = 0; i < all.length; i++) {
    if (all[i].status === 'queued') enqueueTransfer(all[i].id);
  }
}

module.exports = { enqueueTransfer: enqueueTransfer, startWorker: startWorker, workerTick: workerTick };
