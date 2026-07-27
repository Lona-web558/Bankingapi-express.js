/**
 * seed.js
 * -----------------------------------------------------------------------
 * Generates fake demo data for every collection store.js persists to disk
 * (data/users.json, data/accounts.json, ...), using the exact shape each
 * route file already produces — see authroutes.js (users/accounts/wallets),
 * transactions.js, transfers.js, loans.js, eventLogger.js, fraudDetection.js.
 *
 * Run with:
 *   npm install        (only needed once, for bcryptjs)
 *   node seed.js
 *
 * This OVERWRITES whatever is currently in data/*.json — back those up
 * first if you have real data you care about. Demo login for every seeded
 * user is password "Password123!" (see the printed usernames at the end).
 * -----------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let bcrypt;
try {
  bcrypt = require('bcryptjs');
} catch (e) {
  console.warn(
    '[seed] bcryptjs is not installed, so passwordHash/pinHash below will be ' +
    'PLACEHOLDER strings (bcrypt-shaped, but not real bcrypt) — fine for ' +
    'browsing the JSON, but logging in as these users will fail until you ' +
    'run `npm install` and re-run `node seed.js`.'
  );
}

function hash(value) {
  if (bcrypt) return bcrypt.hashSync(String(value), 10);
  return '$2a$10$PLACEHOLDER' + crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 22);
}

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}
function newAccountNumber() {
  return String(Math.floor(1000000000 + Math.random() * 8999999999));
}
// Must match BANK_INFO in helpers.js.
const BANK_INFO = { branchCode: '198765', routingCode: '198765', swiftBic: 'GFBKZAJJXXX' };

function iso(daysAgo, hour) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour === undefined ? 9 : hour, 0, 0, 0);
  return d.toISOString();
}

const DATA_DIR = path.join(__dirname);
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------------------------------------------------------------- users --
const seedUsers = [
  { username: 'thabo.mokoena', email: 'thabo.mokoena@example.com', pin: '4821' },
  { username: 'lindiwe.dlamini', email: 'lindiwe.dlamini@example.com', pin: '1193' },
  { username: 'sipho.ndlovu', email: 'sipho.ndlovu@example.com', pin: '7702' }
];
const users = seedUsers.map((u, i) => ({
  id: newId('usr'),
  username: u.username,
  email: u.email,
  passwordHash: hash('Password123!'),
  pinHash: hash(u.pin),
  pinFailedAttempts: 0,
  pinLockedUntil: null,
  createdAt: iso(120 - i * 10, 8)
}));

// ------------------------------------------------------------- accounts --
// Two accounts per user: checking + savings.
const balances = { checking: [12450.32, 890.00, 54200.75], savings: [30000.00, 500.00, 120000.00] };
const accounts = [];
users.forEach((u, i) => {
  ['checking', 'savings'].forEach((type) => {
    accounts.push({
      id: newId('acc'),
      userId: u.id,
      accountNumber: newAccountNumber(),
      type,
      currency: 'ZAR',
      balance: balances[type][i],
      branchCode: BANK_INFO.branchCode,
      routingCode: BANK_INFO.routingCode,
      swiftBic: BANK_INFO.swiftBic,
      createdAt: iso(119 - i * 10, 8)
    });
  });
});
const checkingByUser = (i) => accounts[i * 2];
const savingsByUser = (i) => accounts[i * 2 + 1];

// -------------------------------------------------------------- wallets --
const walletBalances = [325.50, 40.00, 1200.00];
const wallets = users.map((u, i) => ({
  id: newId('wal'),
  userId: u.id,
  balance: walletBalances[i],
  currency: 'ZAR',
  createdAt: iso(120 - i * 10, 8)
}));

// --------------------------------------------------------- transactions --
const transactions = [];
users.forEach((u, i) => {
  const acc = checkingByUser(i);
  const seedTxns = [
    { type: 'deposit', amount: 5000, description: 'Salary deposit', daysAgo: 25 },
    { type: 'withdraw', amount: 850.50, description: 'Groceries', daysAgo: 20 },
    { type: 'withdraw', amount: 1200, description: 'Rent contribution', daysAgo: 15 },
    { type: 'deposit', amount: 300, description: 'Refund', daysAgo: 5 }
  ];
  const net = seedTxns.reduce((s, t) => s + (t.type === 'deposit' ? t.amount : -t.amount), 0);
  let running = acc.balance - net;
  seedTxns.forEach((t) => {
    running += t.type === 'deposit' ? t.amount : -t.amount;
    transactions.push({
      id: newId('txn'),
      accountId: acc.id,
      type: t.type,
      amount: t.type === 'withdraw' ? -t.amount : t.amount,
      balanceAfter: Math.round(running * 100) / 100,
      description: t.description,
      createdAt: iso(t.daysAgo)
    });
  });
});

// ------------------------------------------------------------ transfers --
const transfers = [
  {
    id: newId('trf'),
    userId: users[0].id,
    fromAccountId: checkingByUser(0).id,
    toAccountNumber: checkingByUser(2).accountNumber,
    toBranchCode: null,
    toRoutingCode: null,
    toSwiftBic: null,
    amount: 750,
    description: 'Split for the trip',
    status: 'completed',
    createdAt: iso(10)
  },
  {
    id: newId('trf'),
    userId: users[1].id,
    fromAccountId: savingsByUser(1).id,
    toAccountNumber: '4021558800',
    toBranchCode: '632005',
    toRoutingCode: '632005',
    toSwiftBic: 'FIRNZAJJXXX',
    amount: 2200,
    description: 'Invoice #114 payment',
    status: 'queued',
    createdAt: iso(2)
  },
  {
    id: newId('trf'),
    userId: users[2].id,
    fromAccountId: checkingByUser(2).id,
    toAccountNumber: '5590012234',
    toBranchCode: null,
    toRoutingCode: null,
    toSwiftBic: 'CHASUS33XXX',
    amount: 15000,
    description: 'Overseas supplier payment',
    status: 'failed',
    failReason: 'External bank transfers are not settled in this demo (no correspondent network) \u2014 destination SWIFT/BIC CHASUS33XXX is not this bank',
    createdAt: iso(1)
  }
];

// ---------------------------------------------------------------- loans --
const loans = [
  { id: newId('loan'), userId: users[0].id, amount: 15000, termMonths: 12, purpose: 'Home renovation', interestRate: 14.5, status: 'approved', createdAt: iso(60), decidedAt: iso(58), decidedBy: 'admin' },
  { id: newId('loan'), userId: users[1].id, amount: 3000, termMonths: 6, purpose: 'Medical expense', interestRate: 8.5, status: 'pending', createdAt: iso(3), decidedAt: null, decidedBy: null },
  { id: newId('loan'), userId: users[2].id, amount: 60000, termMonths: 24, purpose: 'Business expansion', interestRate: 18.0, status: 'rejected', createdAt: iso(40), decidedAt: iso(39), decidedBy: 'admin' }
];

// ----------------------------------------------------------------- otps --
const otps = [
  { id: newId('otp'), userId: users[0].id, code: '482913', purpose: 'transfer', expiresAt: iso(-1), used: true, createdAt: iso(10) }
];

// --------------------------------------------------------------- events --
const events = [
  { id: newId('evt'), type: 'user.registered', userId: users[0].id, details: { username: users[0].username }, createdAt: iso(120) },
  { id: newId('evt'), type: 'transfer.completed', userId: users[0].id, details: { transferId: transfers[0].id }, createdAt: iso(10) },
  { id: newId('evt'), type: 'transfer.failed', userId: users[2].id, details: { transferId: transfers[2].id, reason: transfers[2].failReason }, createdAt: iso(1) }
];

// ----------------------------------------------------------- fraudFlags --
const fraudFlags = [
  { id: newId('flag'), transferId: null, transactionId: null, userId: users[2].id, rule: 'large_withdrawal', message: 'Withdrawal of 35000 exceeds the large-withdrawal threshold of 30000', createdAt: iso(7), resolved: false }
];

const collections = { users, accounts, wallets, transactions, transfers, loans, otps, events, fraudFlags };
for (const [name, rows] of Object.entries(collections)) {
  fs.writeFileSync(path.join(DATA_DIR, name + '.json'), JSON.stringify(rows, null, 2));
  console.log('[seed] wrote ' + rows.length + ' ' + name);
}

console.log('\nDemo users (all use password "Password123!"):');
users.forEach((u) => console.log('  ' + u.username));
