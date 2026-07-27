const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

const store = require('./store');
const { newId, newAccountNumber, now, BANK_INFO } = require('./helpers');
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

// POST /api/admin/seed-demo-data — creates the demo users/accounts/etc
// directly in the running app (real bcrypt hashes via bcryptjs, so login
// works immediately). Safe to call more than once: any username that
// already exists is left untouched rather than duplicated or overwritten.
// Guard: header `x-admin-key: <ADMIN_KEY env var, default dev-only-admin-key>`.
const SEED_USERS = [
  { username: 'thabo.mokoena', email: 'thabo.mokoena@example.com', pin: '4821' },
  { username: 'lindiwe.dlamini', email: 'lindiwe.dlamini@example.com', pin: '1193' },
  { username: 'sipho.ndlovu', email: 'sipho.ndlovu@example.com', pin: '7702' },
  { username: 'naledi.khumalo', email: 'naledi.khumalo@example.com', pin: '5540' },
  { username: 'kagiso.pretorius', email: 'kagiso.pretorius@example.com', pin: '2916' }
];
const SEED_PASSWORD = 'Password123!';
const SEED_BALANCES = {
  checking: [12450.32, 890.00, 54200.75, 6100.00, 2050.40],
  savings: [30000.00, 500.00, 120000.00, 18000.00, 4300.00]
};

router.post('/seed-demo-data', requireAdmin, async (req, res) => {
  try {
    const result = await store.withTransaction(async (draft) => {
      const created = [];
      const skipped = [];

      SEED_USERS.forEach((su, i) => {
        const exists = draft.users.find((u) => u.username === su.username || u.email === su.email);
        if (exists) { skipped.push(su.username); return; }

        const user = {
          id: newId('usr'),
          username: su.username,
          email: su.email,
          passwordHash: bcrypt.hashSync(SEED_PASSWORD, 10),
          pinHash: bcrypt.hashSync(su.pin, 10),
          pinFailedAttempts: 0,
          pinLockedUntil: null,
          createdAt: now()
        };
        draft.users.push(user);

        ['checking', 'savings'].forEach((type) => {
          draft.accounts.push({
            id: newId('acc'),
            userId: user.id,
            accountNumber: newAccountNumber(),
            type,
            currency: 'ZAR',
            balance: SEED_BALANCES[type][i],
            branchCode: BANK_INFO.branchCode,
            routingCode: BANK_INFO.routingCode,
            swiftBic: BANK_INFO.swiftBic,
            createdAt: now()
          });
        });

        draft.wallets.push({ id: newId('wal'), userId: user.id, balance: 0, currency: 'ZAR', createdAt: now() });

        logEventInDraft(draft, { type: 'user.seeded', userId: user.id, details: { username: su.username } });
        created.push(su.username);
      });

      return { created, skipped };
    });

    res.json({
      message: 'Seed complete. Demo users log in with password "' + SEED_PASSWORD + '".',
      created: result.created,
      alreadyExisted: result.skipped
    });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || e });
  }
});
module.exports = router;
