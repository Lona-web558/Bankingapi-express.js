const express = require('express');
const router = express.Router();

const store = require('./store');
const { logEventInDraft } = require('./eventLogger');
const { requireAdmin } = require('./auth');
const transferQueue = require('./transferQueue');

// GET /api/admin/events
router.get('/events', requireAdmin, (req, res) => {
  const events = store.getAll('events').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ events });
});

// GET /api/admin/fraud-flags
router.get('/fraud-flags', requireAdmin, (req, res) => {
  const flags = store.getAll('fraudFlags').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ flags });
});

// PATCH /api/admin/fraud-flags/:id/release — clear a flag and re-queue its transfer
router.patch('/fraud-flags/:id/release', requireAdmin, async (req, res) => {
  try {
    const result = await store.withTransaction(async (draft) => {
      const flag = draft.fraudFlags.find((f) => f.id === req.params.id);
      if (!flag) throw { status: 404, message: 'Flag not found' };
      flag.resolved = true;
      flag.resolvedAt = new Date().toISOString();

      let transfer = null;
      if (flag.transferId) {
        transfer = draft.transfers.find((t) => t.id === flag.transferId);
        if (transfer && transfer.status === 'held_for_review') {
          transfer.status = 'queued';
          transfer.fraudReasons = null;
        }
      }
      logEventInDraft(draft, { type: 'fraud.released', userId: flag.userId, details: { flagId: flag.id } });
      return { flag, transfer };
    });

    if (result.transfer) transferQueue.enqueueTransfer(result.transfer.id);
    res.json(result);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || e });
  }
});

module.exports = router;
