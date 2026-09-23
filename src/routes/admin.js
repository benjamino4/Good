'use strict';
// ============================================================
//  Admin panel API \u2014 launched as its own Telegram mini app
//  by a SEPARATE admin bot, protected by username/password
//  (set via ADMIN_USER / ADMIN_PASS env vars).
//  Gives full customization: branding, rules, store prices,
//  quests, relics, upgrades, Star packs, economy + user tools.
// ============================================================
const router = require('express').Router();
const { query } = require('../db');
const {
  checkAdminCreds, signAdminToken, requireAdmin,
  verifyAdminInitData, ADMIN_ENABLED,
} = require('../auth');
const config = require('../config');

// ---- public: is admin configured? ----
router.get('/status', (req, res) => {
  res.json({ enabled: ADMIN_ENABLED });
});

// ---- login: username + password (optionally also admin-bot initData) ----
// POST /api/admin/login { username, password, initData? }
router.post('/login', async (req, res) => {
  const { username, password, initData } = req.body || {};
  if (!ADMIN_ENABLED) return res.status(403).json({ error: 'admin_disabled' });

  // If the panel is opened from the admin bot, initData (when present) must verify.
  if (initData) {
    const who = verifyAdminInitData(initData);
    if (!who) return res.status(401).json({ error: 'bad_admin_initdata' });
  }
  if (!checkAdminCreds(username, password))
    return res.status(401).json({ error: 'bad_credentials' });

  const token = signAdminToken(username);
  await logAction(username, 'login', {});
  res.json({ token, username });
});

// everything below requires a valid admin token
router.use(requireAdmin);

async function logAction(actor, action, detail) {
  try {
    await query('INSERT INTO admin_log(actor,action,detail) VALUES($1,$2,$3)',
      [actor, action, JSON.stringify(detail || {})]);
  } catch (e) { /* non-fatal */ }
}

// GET /api/admin/config \u2014 full editable config + factory defaults
router.get('/config', async (req, res, next) => {
  try {
    const all = await config.loadAll(true);
    res.json({ config: all, defaults: config.DEFAULTS, keys: config.KEYS });
  } catch (e) { next(e); }
});

// ---- lightweight validation per config key ----
function validate(key, value) {
  const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
  if (key === 'branding') {
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('bad_value');
    return {
      name: String(value.name || 'JUST TRIBES').slice(0, 60),
      tagline: String(value.tagline || '').slice(0, 160),
      rules: String(value.rules || '').slice(0, 4000),
    };
  }
  if (key === 'economy') {
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('bad_value');
    return {
      checkin_ember: num(value.checkin_ember, 120),
      tithe: Math.max(0, Math.min(1, num(value.tithe, 0.2))),
      streak_bonus_per_day: num(value.streak_bonus_per_day, 5),
      streak_bonus_cap: num(value.streak_bonus_cap, 100),
      land_cost_stars: num(value.land_cost_stars, 150),
      land_member_step: num(value.land_member_step, 5),
      settlement_cost_loyalty: num(value.settlement_cost_loyalty, 6000),
      referral_reward_ember: num(value.referral_reward_ember, 300),
      signup_stars: num(value.signup_stars, 50),
    };
  }
  if (!Array.isArray(value)) throw new Error('bad_value');
  const cleanKey = (s, i) => String(s || ('item' + i)).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) || ('item' + i);
  if (key === 'store' || key === 'relics') {
    return value.map((it, i) => ({
      key: cleanKey(it.key, i),
      name: String(it.name || 'Item').slice(0, 40),
      emoji: String(it.emoji || '\u2B50').slice(0, 8),
      desc: String(it.desc || '').slice(0, 80),
      price: num(it.price, 0),
      ...(key === 'relics' ? { starter: !!it.starter } : {}),
    }));
  }
  if (key === 'upgrades') {
    return value.map((it, i) => ({
      key: cleanKey(it.key, i),
      name: String(it.name || 'Upgrade').slice(0, 40),
      desc: String(it.desc || '').slice(0, 80),
      cur: it.cur === 'stars' ? 'stars' : 'loyalty',
      cost: num(it.cost, 0),
    }));
  }
  if (key === 'quests') {
    return value.map((it, i) => ({
      key: cleanKey(it.key, i),
      name: String(it.name || 'Quest').slice(0, 60),
      reward: num(it.reward, 0),
    }));
  }
  if (key === 'packs') {
    return value.map((it, i) => ({
      key: cleanKey(it.key, i),
      name: String(it.name || 'Pack').slice(0, 30),
      emoji: String(it.emoji || '\u2728').slice(0, 8),
      stars: Math.max(1, num(it.stars, 50)),   // Telegram Stars (XTR) charged
      credit: Math.max(1, num(it.credit, 50)), // in-app Stars granted
      tag: String(it.tag || '').slice(0, 12),
    }));
  }
  throw new Error('unknown_config_key');
}

// PUT /api/admin/config/:key
router.put('/config/:key', async (req, res, next) => {
  try {
    const key = req.params.key;
    if (!config.KEYS.includes(key)) return res.status(404).json({ error: 'unknown_config_key' });
    let value;
    try { value = validate(key, req.body.value); }
    catch (e) { return res.status(400).json({ error: e.message }); }
    await config.set(key, value);
    await logAction(req.admin.username, 'update_config', { key });
    res.json({ ok: true, key, value });
  } catch (e) { next(e); }
});

// POST /api/admin/config/:key/reset \u2014 restore factory default
router.post('/config/:key/reset', async (req, res, next) => {
  try {
    const key = req.params.key;
    if (!config.KEYS.includes(key)) return res.status(404).json({ error: 'unknown_config_key' });
    const value = config.DEFAULTS[key];
    await config.set(key, value);
    await logAction(req.admin.username, 'reset_config', { key });
    res.json({ ok: true, key, value });
  } catch (e) { next(e); }
});

// GET /api/admin/stats \u2014 dashboard numbers
router.get('/stats', async (req, res, next) => {
  try {
    const users   = await query('SELECT COUNT(*)::int n FROM users');
    const tribes  = await query('SELECT COUNT(*)::int n FROM tribes');
    const active  = await query("SELECT COUNT(*)::int n FROM users WHERE last_checkin >= CURRENT_DATE - INTERVAL '1 day'");
    const pays    = await query("SELECT COALESCE(SUM(stars_paid),0)::bigint xtr, COALESCE(SUM(stars_credited),0)::bigint credited, COUNT(*)::int n FROM payments WHERE status='paid'");
    const wallets = await query('SELECT COUNT(*)::int n FROM users WHERE wallet_address IS NOT NULL');
    res.json({
      users: users.rows[0].n,
      tribes: tribes.rows[0].n,
      active_today: active.rows[0].n,
      wallets: wallets.rows[0].n,
      payments: { count: pays.rows[0].n, xtr: Number(pays.rows[0].xtr), stars_credited: Number(pays.rows[0].credited) },
    });
  } catch (e) { next(e); }
});

// GET /api/admin/users?limit=
router.get('/users', async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const r = await query(
      `SELECT u.id, u.name, u.username, u.role, u.ember, u.loyalty, u.stars, u.streak,
              u.wallet_address, u.telegram_id, t.name AS tribe
       FROM users u LEFT JOIN tribes t ON t.id=u.tribe_id
       ORDER BY u.ember DESC LIMIT $1`, [limit]);
    res.json({ users: r.rows });
  } catch (e) { next(e); }
});

// POST /api/admin/users/:id/grant  { currency, amount }
router.post('/users/:id/grant', async (req, res, next) => {
  try {
    const cur = ['ember', 'loyalty', 'stars'].includes(req.body.currency) ? req.body.currency : null;
    const amount = Math.trunc(Number(req.body.amount) || 0);
    if (!cur) return res.status(400).json({ error: 'bad_currency' });
    const id = Number(req.params.id);
    const r = await query(`UPDATE users SET ${cur}=GREATEST(0, ${cur}+$1) WHERE id=$2 RETURNING id, ${cur}`, [amount, id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'no_user' });
    await query('INSERT INTO transactions(user_id,currency,amount,reason) VALUES($1,$2,$3,$4)',
      [id, cur, amount, 'admin_grant']);
    await logAction(req.admin.username, 'grant', { id, cur, amount });
    res.json({ ok: true, user: r.rows[0] });
  } catch (e) { next(e); }
});

// GET /api/admin/log \u2014 recent admin actions
router.get('/log', async (req, res, next) => {
  try {
    const r = await query('SELECT actor, action, detail, created_at FROM admin_log ORDER BY id DESC LIMIT 50');
    res.json({ log: r.rows });
  } catch (e) { next(e); }
});

module.exports = router;
