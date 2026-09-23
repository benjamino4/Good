'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { query } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

/**
 * Verify Telegram Web App initData string per official spec:
 * secret = HMAC_SHA256(bot_token, key='WebAppData')
 * hash   = HMAC_SHA256(data_check_string, key=secret)
 * Returns the parsed `user` object on success, or null on failure.
 */
function verifyInitData(initData) {
  if (!BOT_TOKEN) return null;                  // no token -> caller may allow dev login
  if (!initData) { console.warn('[auth] initData empty'); return null; }
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) { console.warn('[auth] initData has no hash'); return null; }
  params.delete('hash');
  // Newer Telegram clients add a `signature` field (Ed25519, for 3rd-party
  // validation). It is NOT part of the HMAC data-check-string, so remove it
  // too or the hash will never match.
  params.delete('signature');
  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (calc !== hash) {
    console.warn('[auth] initData hash mismatch — the TELEGRAM_BOT_TOKEN likely does not match the bot that opened this mini app');
    return null;
  }
  try { return JSON.parse(params.get('user') || 'null'); }
  catch { return null; }
}

function signToken(userId) {
  return jwt.sign({ uid: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

// ---- admin panel auth (separate bot + username/password) ----
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || (JWT_SECRET + ':admin');
const ADMIN_JWT_EXPIRES = process.env.ADMIN_JWT_EXPIRES || '12h';
const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASS = process.env.ADMIN_PASS || '';
const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN || '';

// constant-time string compare
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Validate admin credentials against the env-provided user/pass.
function checkAdminCreds(username, password) {
  if (!ADMIN_USER || !ADMIN_PASS) return false; // admin disabled until configured
  return safeEqual(username || '', ADMIN_USER) && safeEqual(password || '', ADMIN_PASS);
}

function signAdminToken(username) {
  return jwt.sign({ admin: true, u: username }, ADMIN_JWT_SECRET, { expiresIn: ADMIN_JWT_EXPIRES });
}

// Express middleware: requires a valid admin Bearer token.
function requireAdmin(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'no_token' });
    const p = jwt.verify(token, ADMIN_JWT_SECRET);
    if (!p || !p.admin) return res.status(403).json({ error: 'not_admin' });
    req.admin = { username: p.u };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'bad_token' });
  }
}

// Verify initData that came from the ADMIN bot (optional 2nd factor).
function verifyAdminInitData(initData) {
  if (!ADMIN_BOT_TOKEN) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(ADMIN_BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  if (calc !== hash) return null;
  try { return JSON.parse(params.get('user') || 'null'); } catch { return null; }
}

// Express middleware: requires a valid Bearer token, loads req.user
async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'no_token' });
    const { uid } = jwt.verify(token, JWT_SECRET);
    const r = await query('SELECT * FROM users WHERE id=$1', [uid]);
    if (!r.rows[0]) return res.status(401).json({ error: 'no_user' });
    req.user = r.rows[0];
    next();
  } catch (e) {
    return res.status(401).json({ error: 'bad_token' });
  }
}

module.exports = {
  verifyInitData, signToken, requireAuth, BOT_TOKEN, JWT_SECRET,
  checkAdminCreds, signAdminToken, requireAdmin, verifyAdminInitData,
  ADMIN_ENABLED: !!(ADMIN_USER && ADMIN_PASS), ADMIN_BOT_TOKEN,
};
