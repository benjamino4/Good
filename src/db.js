'use strict';
const { Pool } = require('pg');

// Decide whether SSL is needed (Aiven requires it) BEFORE we strip the
// sslmode flag off the connection string.
const raw = process.env.DATABASE_URL || '';
const useSSL = (process.env.PGSSLMODE || '').toLowerCase() === 'require'
  || /sslmode=(require|verify-ca|verify-full|prefer)/i.test(raw)
  || /aivencloud\.com/i.test(raw);

// Remove any `sslmode=...` from the URL so pg-connection-string does not emit
// its "treated as verify-full" security warning. We control SSL explicitly via
// the `ssl` option below instead.
function stripSslMode(url) {
  if (!url) return url;
  return url
    .replace(/([?&])sslmode=[^&]*&?/i, '$1')
    .replace(/[?&]$/, '');
}

const pool = new Pool({
  connectionString: stripSslMode(raw),
  // Managed Postgres (Aiven) presents a valid cert; rejectUnauthorized:false
  // is the simplest robust setting and avoids CA-bundling headaches.
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => console.error('[pg] idle client error', err.message));

async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}

// simple transaction helper
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx };
