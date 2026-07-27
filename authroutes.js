const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

const store = require('./store');
const { newId, newAccountNumber, newOtpCode, now, BANK_INFO } = require('./helpers');
const { logEventInDraft, logEvent } = require('./eventLogger');
const { requireAuth, requireAdmin, signToken } = require('./auth');

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PIN_ATTEMPTS = 5;

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, email, password, pin } = req.body || {};
  if (!username || !email || !password || !pin) {
    return res.status(400).json({ error: 'username, email, password and pin are all required' });
  }
  if (!/^\d{4,6}$/.test(String(pin))) {
    return res.status(400).json({ error: 'pin must be 4-6 digits' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters' });
  }

  try {
    const result = await store.withTransaction(async (draft) => {
      const exists = draft.users.find((u) => u.username === username || u.email === email);
      if (exists) throw new Error('Username or email already registered');

      const user = {
        id: newId('usr'),
        username,
        email,
        passwordHash: bcrypt.hashSync(password, 10),
        pinHash: bcrypt.hashSync(String(pin), 10),
        pinFailedAttempts: 0,
        pinLockedUntil: null,
        createdAt: now()
      };
      draft.users.push(user);

      const account = {
        id: newId('acc'),
        userId: user.id,
        accountNumber: newAccountNumber(),
        type: 'checking',
        currency: 'ZAR',
        balance: 0,
        branchCode: BANK_INFO.branchCode,
        routingCode: BANK_INFO.routingCode,
        swiftBic: BANK_INFO.swiftBic,
        createdAt: now()
      };
      draft.accounts.push(account);

      const wallet = {
        id: newId('wal'),
        userId: user.id,
        balance: 0,
        currency: 'ZAR',
        createdAt: now()
      };
      draft.wallets.push(wallet);

      logEventInDraft(draft, { type: 'user.registered', userId: user.id, details: { username } });

      return { user, account, wallet };
    });

    res.status(201).json({
      message: 'Registered successfully',
      user: { id: result.user.id, username: result.user.username, email: result.user.email },
      account: {
        id: result.account.id,
        accountNumber: result.account.accountNumber,
        balance: result.account.balance,
        branchCode: result.account.branchCode,
        routingCode: result.account.routingCode,
        swiftBic: result.account.swiftBic
      },
      wallet: { id: result.wallet.id, balance: result.wallet.balance }
    });
  } catch (e) {
    res.status(409).json({ error: e.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password are required' });

  const user = store.getAll('users').find((u) => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    await logEvent('user.login_failed', user ? user.id : null, { username });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = signToken(user);
  await logEvent('user.login_success', user.id, { username });
  res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
});

// POST /api/auth/verify-pin  (auth required)
router.post('/verify-pin', requireAuth, async (req, res) => {
  const { pin } = req.body || {};
  if (!pin) return res.status(400).json({ error: 'pin is required' });

  try {
    const result = await store.withTransaction(async (draft) => {
      const user = draft.users.find((u) => u.id === req.user.id);
      if (!user) throw { status: 404, message: 'User not found' };

      if (user.pinLockedUntil && new Date(user.pinLockedUntil) > new Date()) {
        throw { status: 423, message: 'PIN locked due to too many failed attempts. Try again later.' };
      }

      const ok = bcrypt.compareSync(String(pin), user.pinHash);
      if (!ok) {
        user.pinFailedAttempts = (user.pinFailedAttempts || 0) + 1;
        if (user.pinFailedAttempts >= MAX_PIN_ATTEMPTS) {
          user.pinLockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        }
        logEventInDraft(draft, { type: 'pin.verify_failed', userId: user.id, details: { attempts: user.pinFailedAttempts } });
        throw { status: 401, message: 'Incorrect PIN', attemptsRemaining: Math.max(0, MAX_PIN_ATTEMPTS - user.pinFailedAttempts) };
      }

      user.pinFailedAttempts = 0;
      user.pinLockedUntil = null;
      logEventInDraft(draft, { type: 'pin.verify_success', userId: user.id, details: {} });
      return true;
    });
    res.json({ verified: result });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || e, attemptsRemaining: e.attemptsRemaining });
  }
});

// POST /api/auth/otp/request  (auth required) { purpose: 'transfer' | 'login' | 'loan' | ... }
router.post('/otp/request', requireAuth, async (req, res) => {
  const purpose = (req.body && req.body.purpose) || 'general';
  const code = newOtpCode();

  const otp = await store.withTransaction(async (draft) => {
    const record = {
      id: newId('otp'),
      userId: req.user.id,
      code,
      purpose,
      expiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString(),
      used: false,
      createdAt: now()
    };
    draft.otps.push(record);
    logEventInDraft(draft, { type: 'otp.requested', userId: req.user.id, details: { purpose } });
    return record;
  });

  // No SMS/email provider is wired up, so the code is returned directly here
  // in "demo mode" — swap this for a real SMS/email send in production and
  // stop returning `code` in the response.
  res.json({
    message: 'OTP generated (demo mode — no SMS/email gateway configured)',
    otpId: otp.id,
    demoCode: otp.code,
    expiresAt: otp.expiresAt
  });
});

// POST /api/auth/otp/verify  (auth required) { otpId, code }
router.post('/otp/verify', requireAuth, async (req, res) => {
  const { otpId, code } = req.body || {};
  if (!otpId || !code) return res.status(400).json({ error: 'otpId and code are required' });

  try {
    const result = await store.withTransaction(async (draft) => {
      const record = draft.otps.find((o) => o.id === otpId && o.userId === req.user.id);
      if (!record) throw { status: 404, message: 'OTP not found' };
      if (record.used) throw { status: 400, message: 'OTP already used' };
      if (new Date(record.expiresAt) < new Date()) throw { status: 400, message: 'OTP expired' };
      if (record.code !== String(code)) {
        logEventInDraft(draft, { type: 'otp.verify_failed', userId: req.user.id, details: { otpId } });
        throw { status: 401, message: 'Incorrect OTP code' };
      }
      record.used = true;
      logEventInDraft(draft, { type: 'otp.verify_success', userId: req.user.id, details: { otpId, purpose: record.purpose } });
      return true;
    });
    res.json({ verified: result });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || e });
  }
});

// GET/POST /api/auth/seed-demo-data — creates the demo users/accounts/etc
// directly in the running app (real bcrypt hashes via bcryptjs, so login
// works immediately). Safe to call more than once: any username that
// already exists is left untouched rather than duplicated or overwritten.
// Guard: visit /api/auth/seed-demo-data?adminKey=<ADMIN_KEY env var,
// default dev-only-admin-key> in a browser, or POST with an
// `x-admin-key: <same value>` header.
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

async function seedDemoData(req, res) {
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
}

// GET so it can be triggered by just visiting the URL in a browser (with
// ?adminKey=... in the querystring); POST kept for curl/Postman/fetch calls
// using the x-admin-key header instead.
router.get('/seed-demo-data', requireAdmin, seedDemoData);
router.post('/seed-demo-data', requireAdmin, seedDemoData);

module.exports = router;
