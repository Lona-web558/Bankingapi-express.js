/**
 * store.js
 * ---------------------------------------------------------------------------
 * Lightweight persistence layer + transaction manager.
 *
 * Data lives in memory (fast reads/writes for a demo) and is mirrored to
 * JSON files on disk for durability. Because there's no real database engine
 * underneath, ACID guarantees are implemented explicitly at this layer:
 *
 *   Atomicity   — every mutation happens through withTransaction(). Work is
 *                 done against a deep-cloned draft; if the callback throws,
 *                 the draft is discarded and nothing is written.
 *   Consistency — callers validate business rules (balances, statuses) inside
 *                 the callback; invalid states throw and are rolled back.
 *   Isolation   — a single-lane queue means only one transaction runs at a
 *                 time, so nothing ever reads a half-updated draft.
 *   Durability  — a committed transaction is written to disk synchronously
 *                 before the caller's promise resolves.
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const COLLECTIONS = [
  'users', 'accounts', 'wallets', 'transactions',
  'transfers', 'loans', 'otps', 'events', 'fraudFlags'
];

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// In-memory state: { users: [...], accounts: [...], ... }
const state = {};

function fileFor(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function loadAll() {
  for (const name of COLLECTIONS) {
    const file = fileFor(name);
    if (fs.existsSync(file)) {
      try {
        state[name] = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        console.error(`[store] failed to parse ${name}.json, starting empty`, e.message);
        state[name] = [];
      }
    } else {
      state[name] = [];
    }
  }
}

function persistAll() {
  for (const name of COLLECTIONS) {
    fs.writeFileSync(fileFor(name), JSON.stringify(state[name], null, 2));
  }
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

loadAll();

/**
 * A minimal FIFO async mutex. Ensures only one transaction body runs at a
 * time (Isolation) and that they commit/rollback in the order received.
 */
class Mutex {
  constructor() { this._locked = false; this._waiters = []; }
  acquire() {
    return new Promise((resolve) => {
      if (!this._locked) {
        this._locked = true;
        resolve();
      } else {
        this._waiters.push(resolve);
      }
    });
  }
  release() {
    const next = this._waiters.shift();
    if (next) next();
    else this._locked = false;
  }
}

const mutex = new Mutex();

/**
 * Run `fn` against a mutable draft of the whole store.
 * `fn` receives a `draft` object keyed by collection name (plain arrays it
 * can read/push/splice freely) and a `helpers` object with id/time utils.
 *
 * If `fn` resolves normally, the draft is committed to memory + disk.
 * If `fn` throws (or rejects), nothing changes.
 */
async function withTransaction(fn) {
  await mutex.acquire();
  const draft = {};
  for (const name of COLLECTIONS) draft[name] = clone(state[name]);
  try {
    const result = await fn(draft);
    // Commit: swap in the draft and persist synchronously (durability).
    for (const name of COLLECTIONS) state[name] = draft[name];
    persistAll();
    return result;
  } finally {
    mutex.release();
  }
}

/** Read-only snapshot helpers for GET routes (no transaction needed). */
function getAll(name) {
  return clone(state[name] || []);
}
function findById(name, id) {
  const row = (state[name] || []).find((r) => r.id === id);
  return row ? clone(row) : null;
}

module.exports = { withTransaction, getAll, findById, COLLECTIONS };
