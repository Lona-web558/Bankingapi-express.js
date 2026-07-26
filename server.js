require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./authroutes');
const accountRoutes = require('./accounts');
const walletRoutes = require('./wallets');
const transactionRoutes = require('./transactions');
const transferRoutes = require('./transfers');
const loanRoutes = require('./loans');
const statementRoutes = require('./statements');
const adminRoutes = require('./admin');
const transferQueue = require('./transferQueue');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Lightweight request log for the terminal (separate from the persisted
// event log, which records business events, not raw HTTP traffic).
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/wallets', walletRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/transfers', transferRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/statements', statementRoutes);
app.use('/api/admin', adminRoutes);

// 404 for unknown API routes
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Fallback to the SPA shell for any other route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

transferQueue.startWorker(2000);

app.listen(PORT, () => {
  console.log(`Banking API listening on http://localhost:${PORT}`);
});
