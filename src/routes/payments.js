'use strict';
// Telegram Stars payments \u2014 buy in-app Star packs with real Telegram Stars (XTR).
// Pack catalog is editable by the admin panel (config key: 'packs').
const router = require('express').Router();
const { tx } = require('../db');
const { requireAuth } = require('../auth');
const tg = require('../tg');
const config = require('../config');

router.use(requireAuth);

const DEV_PAYMENTS = process.env.ALLOW_DEV_PAYMENTS === '1' || !tg.BOT_TOKEN;

async function packsMap() { return config.toMap(await config.get('packs')); }

// GET /api/payments/packs
router.get('/packs', async (req, res, next) => {
  try {
    const packs = await config.get('packs');
    res.json({
      packs,
      // tells the client whether to use openInvoice (real) or the dev credit path
      provider: tg.BOT_TOKEN ? 'telegram_stars' : 'dev',
      dev: DEV_PAYMENTS,
    });
  } catch (e) { next(e); }
});

// POST /api/payments/invoice  { pack }  -> { link } | { dev:true }
router.post('/invoice', async (req, res, next) => {
  try {
    const key = String(req.body.pack || '');
    const p = (await packsMap())[key];
    if (!p) return res.status(404).json({ error: 'unknown_pack' });

    if (!tg.BOT_TOKEN) return res.json({ dev: true });

    const payload = `jt:${req.user.id}:${key}:${Date.now()}`;
    const link = await tg.createStarsInvoiceLink({
      title: `${p.name} \u2014 ${p.credit} Stars`,
      description: `Get ${p.credit} in-app Stars for JUST TRIBES.`,
      payload,
      stars: p.stars,
    });
    res.json({ link });
  } catch (e) { next(e); }
});

// POST /api/payments/dev-credit  { pack }  \u2014 local testing without a bot/webhook.
router.post('/dev-credit', async (req, res, next) => {
  try {
    if (!DEV_PAYMENTS) return res.status(403).json({ error: 'dev_payments_disabled' });
    const key = String(req.body.pack || '');
    const p = (await packsMap())[key];
    if (!p) return res.status(404).json({ error: 'unknown_pack' });
    const chargeId = 'dev_' + req.user.id + '_' + Date.now();
    const out = await tx(async (c) => {
      await c.query(
        `INSERT INTO payments(user_id,pack,stars_paid,stars_credited,telegram_charge_id,status)
         VALUES($1,$2,$3,$4,$5,'paid')`,
        [req.user.id, key, p.stars, p.credit, chargeId]);
      await c.query('UPDATE users SET stars=stars+$1 WHERE id=$2', [p.credit, req.user.id]);
      await c.query('INSERT INTO transactions(user_id,currency,amount,reason) VALUES($1,$2,$3,$4)',
        [req.user.id, 'stars', p.credit, 'stars_pack:' + key + ':dev']);
      return { ok: true, credited: p.credit };
    });
    res.json(out);
  } catch (e) { next(e); }
});

module.exports = router;
