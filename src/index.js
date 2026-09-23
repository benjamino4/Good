'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());

const origins = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());
app.use(cors({ origin: origins.includes('*') ? true : origins }));

// ---- API routes ----
app.use('/api/auth', require('./routes/auth'));
app.use('/api/me', require('./routes/me'));
app.use('/api/tribes', require('./routes/tribes'));
app.use('/api/game', require('./routes/game'));
app.use('/api/leaderboard', require('./routes/leaderboard'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/telegram', require('./routes/telegram'));
app.use('/api/config', require('./routes/config'));
app.use('/api/admin', require('./routes/admin'));

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ---- TON Connect manifest (generated from PUBLIC_URL) ----
// The front-end points TonConnectUI at this URL. Icon is a code-drawn SVG.
app.get('/tonconnect-manifest.json', (req, res) => {
  const base = (process.env.PUBLIC_URL || (req.protocol + '://' + req.get('host'))).replace(/\/$/, '');
  res.json({
    url: base,
    name: 'JUST TRIBES',
    iconUrl: base + '/icon.svg',
    termsOfUseUrl: base + '/',
    privacyPolicyUrl: base + '/',
  });
});

// ---- serve the frontend ----
// Flat repo layout: /public sits next to /src at the repo root.
const pub = path.join(__dirname, '..', 'public');
app.use(express.static(pub));
// admin mini app lives at /admin (its own login + panel)
app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin', 'index.html')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (req.path.startsWith('/admin')) return res.sendFile(path.join(pub, 'admin', 'index.html'));
  res.sendFile(path.join(pub, 'index.html'));
});

// ---- error handler ----
app.use((err, req, res, next) => {
  console.error('[err]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'server_error' });
});

const PORT = process.env.PORT || 8080;
if (require.main === module) {
  (async () => {
    // Auto-initialise the database on boot so a fresh deploy works with no
    // shell access (e.g. deploying from a phone). This only CREATEs missing
    // tables (schema.sql is fully IF NOT EXISTS) and inserts default config
    // with ON CONFLICT DO NOTHING — it never deletes or overwrites data.
    // Set MIGRATE_ON_BOOT=false to disable.
    if (process.env.DATABASE_URL && process.env.MIGRATE_ON_BOOT !== 'false') {
      try {
        await require('./migrate').ensureSchema();
        console.log('[boot] database schema ready');
      } catch (e) {
        console.error('[boot] schema init failed:', e.message);
      }
    }
    app.listen(PORT, () => console.log(`JUST TRIBES server on :${PORT}`));
  })();
}
module.exports = app;
