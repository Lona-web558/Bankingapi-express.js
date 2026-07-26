# Banking API

A full-stack banking simulator: Node.js + Express backend, HTML5 + CSS3 +
Bootstrap 5 frontend, vanilla JavaScript for the client logic.

## Features

- **User accounts** — register/login, one checking account opened by default
- **Wallets** — separate top-up-able balance per user
- **Transactions** — deposits and withdrawals on any account
- **Transfers** — queued and settled asynchronously by a background worker
- **Loan requests** — tiered interest rate, admin approve/reject with disbursement
- **Statements** — opening/closing balance + transaction history for a date range
- **PIN verification** — 4–6 digit PIN set at registration, lockout after 5 failed attempts
- **OTP authentication** — 6-digit one-time codes, 5-minute expiry (demo mode: the
  code is returned in the response since no SMS/email gateway is wired up)

### Advanced

- **ACID transactions** — every mutation runs through a single-lane transaction
  manager (`db/store.js`) that clones state, applies changes, and only commits
  to memory + disk if the whole operation succeeds. Errors roll back cleanly.
- **Event logging** — every meaningful action (registration, login, PIN/OTP
  checks, transfers, loans, fraud flags) is appended to a persisted event log.
- **Fraud detection rules** — transfers are checked for high value, balance
  drain, and velocity (3+ transfers from the same account in 5 minutes);
  flagged transfers are held for admin review instead of settling.
- **Queue processing** — transfers are accepted immediately (`202`) and queued;
  a background worker polls every 2 seconds and settles them, so the UI shows
  `queued → completed` (or `held_for_review` / `failed`) in near real time.

## Setup

```bash
npm install
cp .env.example .env    # then edit JWT_SECRET and ADMIN_KEY
npm start
```

Open `http://localhost:4000`.

There's no external database — data is stored as JSON files under
`db/data/` (created automatically on first run). That's fine for a demo or
portfolio project; swap `db/store.js` for a real database if you outgrow it.

## API reference

All endpoints are under `/api`. Authenticated routes need
`Authorization: Bearer <token>` from `/auth/login`. Admin routes need
`X-Admin-Key: <ADMIN_KEY>`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/register` | — | `{username,email,password,pin}` |
| POST | `/auth/login` | — | `{username,password}` → `{token,user}` |
| POST | `/auth/verify-pin` | user | `{pin}` |
| POST | `/auth/otp/request` | user | `{purpose}` → `{otpId, demoCode}` |
| POST | `/auth/otp/verify` | user | `{otpId, code}` |
| GET/POST | `/accounts` | user | list / open account `{type}` |
| GET | `/accounts/:id` | user | |
| GET | `/wallets/me` | user | |
| POST | `/wallets/topup` | user | `{amount}` |
| GET | `/transactions/:accountId` | user | optional `?from&to` |
| POST | `/transactions` | user | `{accountId,type,amount,description}` |
| GET/POST | `/transfers` | user | list / queue `{fromAccountId,toAccountNumber,amount,description}` |
| GET | `/transfers/:id` | user | |
| GET/POST | `/loans` , `/loans/request` | user | |
| PATCH | `/loans/:id/decision` | admin | `{decision:'approve'|'reject', creditAccountId?}` |
| GET | `/statements/:accountId` | user | `?from&to` |
| GET | `/admin/events` | admin | |
| GET | `/admin/fraud-flags` | admin | |
| PATCH | `/admin/fraud-flags/:id/release` | admin | re-queues the held transfer |

## Notes

- The full flow (register → login → deposit → transfer → queue settlement →
  fraud hold → admin release → loan request/approval → statement → PIN/OTP)
  was exercised end-to-end during development, so the logic in `db/store.js`,
  the routes, and the queue worker is verified. Run `npm install` on your own
  machine (this build environment has no npm registry access) before
  deploying — that's the one step that couldn't be tested here.
- The dark gold/cyan terminal theme, JetBrains Mono + Space Grotesk fonts
  match the rest of your app portfolio.
