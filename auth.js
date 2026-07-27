const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, username }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  // Header is the normal path (curl/Postman/fetch). Query param exists so a
  // route like /api/auth/seed-demo-data can be triggered by just visiting
  // a URL in a browser, where custom headers aren't an option.
  const key = req.headers['x-admin-key'] || req.query.adminKey;
  const expected = process.env.ADMIN_KEY || 'dev-only-admin-key';
  if (!key || key !== expected) {
    return res.status(403).json({ error: 'Invalid admin key' });
  }
  next();
}

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '2h' });
}

module.exports = { requireAuth, requireAdmin, signToken, JWT_SECRET };
