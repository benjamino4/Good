'use strict';
const router = require('express').Router();
const { query, tx } = require('../db');
const { verifyInitData, signToken, BOT_TOKEN } = require('../auth');

function genRef(name) {
  return 'TRIBE-' + String(name || 'KIN').split(' ')[0].toUpperCase().slice(0,6)
    + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

// Upsert a user from a telegram profile (or dev profile) and return {token, user}
async function loginUser({ telegram_id, username, name, photo_url, ref }) {
  return tx(async (c) => {
    let u;
    if (telegram_id) {
      const r = await c.query('SELECT * FROM users WHERE telegram_id=$1', [telegram_id]);
      u = r.rows[0];
    }
    if (!u) {
      const referrer = ref
        ? (await c.query('SELECT id FROM users WHERE ref_code=$1', [ref])).rows[0]
        : null;
      const ins = await c.query(
        `INSERT INTO users(telegram_id, username, name, photo_url, ref_code, referred_by, stars)
         VALUES($1,$2,$3,$4,$5,$6,50) RETURNING *`,
        [telegram_id || null, username || null, name || 'New Kin', photo_url || null,
         genRef(name), referrer ? referrer.id : null]);
      u = ins.rows[0];
      // reward the referrer
      if (referrer) {
        await c.query('UPDATE users SET ember = ember + 300 WHERE id=$1', [referrer.id]);
        await c.query(`INSERT INTO transactions(user_id,currency,amount,reason) VALUES($1,'ember',300,'referral')`, [referrer.id]);
        await c.query(`INSERT INTO notifications(user_id,title,body) VALUES($1,'New kin joined!','+300 Ember for your call.')`, [referrer.id]);
      }
    }
    return { token: signToken(u.id), user: u };
  });
}

// POST /api/auth/telegram  { initData, ref? }
router.post('/telegram', async (req, res, next) => {
  try {
    const { initData, ref } = req.body || {};
    const tgUser = verifyInitData(initData);
    if (!tgUser) return res.status(401).json({ error: 'invalid_init_data' });
    const out = await loginUser({
      telegram_id: tgUser.id,
      username: tgUser.username ? '@' + tgUser.username : null,
      name: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || 'Kin',
      photo_url: tgUser.photo_url, ref,
    });
    res.json(out);
  } catch (e) { next(e); }
});

// POST /api/auth/dev  { name?, ref? }  — only when no BOT_TOKEN is configured
router.post('/dev', async (req, res, next) => {
  try {
    if (BOT_TOKEN) return res.status(403).json({ error: 'dev_login_disabled' });
    const { name, ref } = req.body || {};
    const out = await loginUser({
      telegram_id: null,
      name: name || 'Ben Daniel',
      username: '@' + (name || 'bendaniel').toLowerCase().replace(/[^a-z]/g,''),
      ref,
    });
    res.json(out);
  } catch (e) { next(e); }
});

module.exports = router;
