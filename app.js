(function () {
  'use strict';

  const state = {
    token: localStorage.getItem('bk_token') || null,
    user: JSON.parse(localStorage.getItem('bk_user') || 'null'),
    adminKey: localStorage.getItem('bk_admin_key') || '',
    accounts: [],
    lastOtpId: null
  };

  // ---------- API helper ----------
  async function api(path, { method = 'GET', body, admin = false } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
    if (admin) headers['X-Admin-Key'] = state.adminKey;

    const res = await fetch('/api' + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || ('Request failed (' + res.status + ')'));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function fmtMoney(n) {
    return 'R ' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtDate(s) {
    return new Date(s).toLocaleString();
  }
  function statusBadge(status) {
    return '<span class="badge-status status-' + status + '">' + status + '</span>';
  }
  function showMsg(el, text, ok) {
    el.innerHTML = '<span class="' + (ok ? 'msg-ok' : 'msg-err') + '">' + text + '</span>';
  }

  // ---------- Auth ----------
  const authPanel = document.getElementById('authPanel');
  const appPanel = document.getElementById('appPanel');
  const sessionUser = document.getElementById('sessionUser');
  const logoutBtn = document.getElementById('logoutBtn');

  document.querySelectorAll('[data-authtab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-authtab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.authtab;
      document.getElementById('loginForm').classList.toggle('d-none', tab !== 'login');
      document.getElementById('registerForm').classList.toggle('d-none', tab !== 'register');
    });
  });

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const authMsg = document.getElementById('authMsg');
    try {
      const data = await api('/auth/login', { method: 'POST', body: { username: fd.get('username'), password: fd.get('password') } });
      setSession(data.token, data.user);
    } catch (err) {
      showMsg(authMsg, err.message, false);
    }
  });

  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const authMsg = document.getElementById('authMsg');
    try {
      await api('/auth/register', {
        method: 'POST',
        body: { username: fd.get('username'), email: fd.get('email'), password: fd.get('password'), pin: fd.get('pin') }
      });
      showMsg(authMsg, 'Registered! You can now log in.', true);
      document.querySelector('[data-authtab="login"]').click();
    } catch (err) {
      showMsg(authMsg, err.message, false);
    }
  });

  logoutBtn.addEventListener('click', () => {
    state.token = null;
    state.user = null;
    localStorage.removeItem('bk_token');
    localStorage.removeItem('bk_user');
    authPanel.classList.remove('d-none');
    appPanel.classList.add('d-none');
    sessionUser.classList.add('d-none');
    logoutBtn.classList.add('d-none');
  });

  function setSession(token, user) {
    state.token = token;
    state.user = user;
    localStorage.setItem('bk_token', token);
    localStorage.setItem('bk_user', JSON.stringify(user));
    authPanel.classList.add('d-none');
    appPanel.classList.remove('d-none');
    sessionUser.textContent = '● ' + user.username;
    sessionUser.classList.remove('d-none');
    logoutBtn.classList.remove('d-none');
    refreshAll();
  }

  // ---------- Tabs ----------
  document.querySelectorAll('#mainTabs [data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#mainTabs [data-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-pane').forEach((p) => p.classList.add('d-none'));
      document.getElementById('tab-' + btn.dataset.tab).classList.remove('d-none');
    });
  });

  // ---------- Accounts & Wallet ----------
  async function loadAccounts() {
    const data = await api('/accounts');
    state.accounts = data.accounts;
    const list = document.getElementById('accountsList');
    list.innerHTML = state.accounts.map((a) => (
      '<div class="list-group-item d-flex justify-content-between align-items-center">' +
        '<div><div class="mono">' + a.accountNumber + '</div><div class="small text-muted">' + a.type + ' · ' + a.currency + '</div></div>' +
        '<div class="mono">' + fmtMoney(a.balance) + '</div>' +
      '</div>'
    )).join('') || '<p class="text-muted small">No accounts yet.</p>';

    const opts = state.accounts.map((a) => '<option value="' + a.id + '">' + a.accountNumber + ' (' + a.type + ') — ' + fmtMoney(a.balance) + '</option>').join('');
    ['txnAccountSelect', 'transferFromSelect', 'statementAccountSelect'].forEach((id) => {
      const sel = document.getElementById(id);
      const prev = sel.value;
      sel.innerHTML = opts;
      if (prev) sel.value = prev;
    });

    if (state.accounts[0]) loadTransactions(document.getElementById('txnAccountSelect').value || state.accounts[0].id);
  }

  async function loadWallet() {
    try {
      const data = await api('/wallets/me');
      document.getElementById('walletBalance').textContent = fmtMoney(data.wallet.balance);
    } catch (e) {
      document.getElementById('walletBalance').textContent = '—';
    }
  }

  document.getElementById('openAccountBtn').addEventListener('click', async () => {
    const type = document.getElementById('newAccountType').value;
    await api('/accounts', { method: 'POST', body: { type } });
    loadAccounts();
  });

  document.getElementById('txnAccountSelect').addEventListener('change', (e) => loadTransactions(e.target.value));

  async function loadTransactions(accountId) {
    if (!accountId) return;
    const data = await api('/transactions/' + accountId);
    const list = document.getElementById('txnList');
    list.innerHTML = data.transactions.slice(0, 10).map((t) => (
      '<div class="d-flex justify-content-between border-bottom border-secondary-subtle py-1">' +
        '<span>' + t.type + ' <span class="text-muted">' + fmtDate(t.createdAt) + '</span></span>' +
        '<span class="mono">' + (t.amount >= 0 ? '+' : '') + fmtMoney(t.amount) + '</span>' +
      '</div>'
    )).join('') || '<p class="text-muted">No transactions yet.</p>';
  }

  document.getElementById('txnForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const msg = document.getElementById('txnMsg');
    try {
      await api('/transactions', { method: 'POST', body: { accountId: fd.get('accountId'), type: fd.get('type'), amount: Number(fd.get('amount')) } });
      showMsg(msg, 'Done.', true);
      e.target.reset();
      loadAccounts();
    } catch (err) {
      showMsg(msg, err.message, false);
    }
  });

  document.getElementById('topupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const msg = document.getElementById('walletMsg');
    try {
      await api('/wallets/topup', { method: 'POST', body: { amount: Number(fd.get('amount')) } });
      showMsg(msg, 'Wallet topped up.', true);
      e.target.reset();
      loadWallet();
    } catch (err) {
      showMsg(msg, err.message, false);
    }
  });

  // ---------- Transfers ----------
  document.getElementById('transferForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const msg = document.getElementById('transferMsg');
    try {
      const data = await api('/transfers', {
        method: 'POST',
        body: {
          fromAccountId: fd.get('fromAccountId'),
          toAccountNumber: fd.get('toAccountNumber'),
          amount: Number(fd.get('amount')),
          description: fd.get('description')
        }
      });
      showMsg(msg, 'Transfer ' + data.transfer.id + ' queued.', true);
      e.target.reset();
      setTimeout(loadTransfers, 2500); // give the worker a moment to settle it
    } catch (err) {
      showMsg(msg, err.message, false);
    }
  });

  document.getElementById('refreshTransfersBtn').addEventListener('click', loadTransfers);

  async function loadTransfers() {
    const data = await api('/transfers');
    const list = document.getElementById('transferList');
    list.innerHTML = data.transfers.map((t) => (
      '<div class="border-bottom border-secondary-subtle py-2">' +
        '<div class="d-flex justify-content-between"><span class="mono">' + t.id + '</span>' + statusBadge(t.status) + '</div>' +
        '<div class="text-muted">to ' + t.toAccountNumber + ' · ' + fmtMoney(t.amount) + ' · ' + fmtDate(t.createdAt) + '</div>' +
        (t.failReason ? '<div class="msg-err">' + t.failReason + '</div>' : '') +
      '</div>'
    )).join('') || '<p class="text-muted">No transfers yet.</p>';
  }

  // ---------- Loans ----------
  document.getElementById('loanForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const msg = document.getElementById('loanMsg');
    try {
      await api('/loans/request', {
        method: 'POST',
        body: { amount: Number(fd.get('amount')), termMonths: Number(fd.get('termMonths')), purpose: fd.get('purpose') }
      });
      showMsg(msg, 'Loan requested.', true);
      e.target.reset();
      loadLoans();
    } catch (err) {
      showMsg(msg, err.message, false);
    }
  });

  async function loadLoans() {
    const data = await api('/loans');
    const list = document.getElementById('loanList');
    list.innerHTML = data.loans.map((l) => (
      '<div class="border-bottom border-secondary-subtle py-2">' +
        '<div class="d-flex justify-content-between"><span class="mono">' + l.id + '</span>' + statusBadge(l.status) + '</div>' +
        '<div class="text-muted">' + fmtMoney(l.amount) + ' over ' + l.termMonths + 'mo @ ' + l.interestRate + '% · ' + fmtDate(l.createdAt) + '</div>' +
      '</div>'
    )).join('') || '<p class="text-muted">No loans yet.</p>';
  }

  // ---------- Statements ----------
  document.getElementById('statementForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const out = document.getElementById('statementOutput');
    const params = new URLSearchParams();
    if (fd.get('from')) params.set('from', fd.get('from'));
    if (fd.get('to')) params.set('to', fd.get('to'));
    try {
      const data = await api('/statements/' + fd.get('accountId') + '?' + params.toString());
      out.innerHTML =
        '<div class="d-flex justify-content-between mb-2"><span>Opening: <span class="mono">' + fmtMoney(data.openingBalance) + '</span></span>' +
        '<span>Closing: <span class="mono">' + fmtMoney(data.closingBalance) + '</span></span></div>' +
        '<div class="small text-muted mb-2">' + data.transactionCount + ' transactions between ' + fmtDate(data.period.from) + ' and ' + fmtDate(data.period.to) + '</div>' +
        data.transactions.map((t) => (
          '<div class="d-flex justify-content-between border-bottom border-secondary-subtle py-1">' +
            '<span>' + t.type + ' <span class="text-muted">' + fmtDate(t.createdAt) + '</span></span>' +
            '<span class="mono">' + (t.amount >= 0 ? '+' : '') + fmtMoney(t.amount) + '</span>' +
          '</div>'
        )).join('');
    } catch (err) {
      out.innerHTML = '<span class="msg-err">' + err.message + '</span>';
    }
  });

  // ---------- Security: PIN + OTP ----------
  document.getElementById('pinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const msg = document.getElementById('pinMsg');
    try {
      await api('/auth/verify-pin', { method: 'POST', body: { pin: fd.get('pin') } });
      showMsg(msg, 'PIN verified.', true);
      e.target.reset();
    } catch (err) {
      showMsg(msg, err.message + (err.data && err.data.attemptsRemaining !== undefined ? ' (' + err.data.attemptsRemaining + ' attempts left)' : ''), false);
    }
  });

  document.getElementById('requestOtpBtn').addEventListener('click', async () => {
    const purpose = document.getElementById('otpPurpose').value;
    const msg = document.getElementById('otpMsg');
    try {
      const data = await api('/auth/otp/request', { method: 'POST', body: { purpose } });
      state.lastOtpId = data.otpId;
      showMsg(msg, 'Code generated: ' + data.demoCode + ' (expires ' + fmtDate(data.expiresAt) + ')', true);
    } catch (err) {
      showMsg(msg, err.message, false);
    }
  });

  document.getElementById('otpForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const msg = document.getElementById('otpMsg');
    if (!state.lastOtpId) return showMsg(msg, 'Request a code first.', false);
    try {
      await api('/auth/otp/verify', { method: 'POST', body: { otpId: state.lastOtpId, code: fd.get('code') } });
      showMsg(msg, 'OTP verified.', true);
      e.target.reset();
    } catch (err) {
      showMsg(msg, err.message, false);
    }
  });

  // ---------- Admin ----------
  document.getElementById('saveAdminKeyBtn').addEventListener('click', () => {
    state.adminKey = document.getElementById('adminKeyInput').value;
    localStorage.setItem('bk_admin_key', state.adminKey);
  });
  document.getElementById('adminKeyInput').value = state.adminKey;

  document.getElementById('refreshEventsBtn').addEventListener('click', loadEvents);
  document.getElementById('refreshFlagsBtn').addEventListener('click', loadFlags);

  async function loadEvents() {
    const list = document.getElementById('eventList');
    try {
      const data = await api('/admin/events', { admin: true });
      list.innerHTML = data.events.map((ev) => (
        '<div class="border-bottom border-secondary-subtle py-1"><span class="mono">' + ev.type + '</span> ' +
        '<span class="text-muted">' + fmtDate(ev.createdAt) + '</span><br>' +
        '<span class="small">' + JSON.stringify(ev.details) + '</span></div>'
      )).join('') || '<p class="text-muted">No events yet.</p>';
    } catch (err) {
      list.innerHTML = '<span class="msg-err">' + err.message + '</span>';
    }
  }

  async function loadFlags() {
    const list = document.getElementById('flagList');
    try {
      const data = await api('/admin/fraud-flags', { admin: true });
      list.innerHTML = data.flags.map((f) => (
        '<div class="border-bottom border-secondary-subtle py-2">' +
          '<div class="d-flex justify-content-between"><span class="mono">' + f.rule + '</span>' +
          (f.resolved ? '<span class="badge-status status-completed">resolved</span>' : '<span class="badge-status status-held_for_review">open</span>') + '</div>' +
          '<div class="text-muted small">' + f.message + '</div>' +
          (!f.resolved ? '<button class="btn btn-sm btn-outline-accent mt-1" data-release="' + f.id + '">Release</button>' : '') +
        '</div>'
      )).join('') || '<p class="text-muted">No fraud flags.</p>';

      list.querySelectorAll('[data-release]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await api('/admin/fraud-flags/' + btn.dataset.release + '/release', { method: 'PATCH', admin: true });
          loadFlags();
        });
      });
    } catch (err) {
      list.innerHTML = '<span class="msg-err">' + err.message + '</span>';
    }
  }

  document.getElementById('loanDecisionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const msg = document.getElementById('loanDecisionMsg');
    try {
      await api('/loans/' + fd.get('loanId') + '/decision', { method: 'PATCH', admin: true, body: { decision: fd.get('decision') } });
      showMsg(msg, 'Decision recorded.', true);
      e.target.reset();
    } catch (err) {
      showMsg(msg, err.message, false);
    }
  });

  // ---------- Bootstrapping ----------
  function refreshAll() {
    loadAccounts();
    loadWallet();
    loadTransfers();
    loadLoans();
  }

  if (state.token && state.user) {
    authPanel.classList.add('d-none');
    appPanel.classList.remove('d-none');
    sessionUser.textContent = '● ' + state.user.username;
    sessionUser.classList.remove('d-none');
    logoutBtn.classList.remove('d-none');
    refreshAll();
  }
})();
