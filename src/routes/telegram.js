'use strict';
// Telegram Bot webhook — handles Stars checkout (pre_checkout + successful_payment).
// This route is PUBLIC (Telegram calls it) but is protected by a secret token
// header that you set when registering the webhook (setWebhook secret_token).
const router = require('express').Router();
const { tx } = require('../db');
const tg = require('../tg');
const config = require('../config');

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

function verify(req) {
  if (!WEBHOOK_SECRET) return true; // no secret configured (dev)
  return req.get('x-telegram-bot-api-secret-token') === WEBHOOK_SECRET;
}

// parse "jt:<uid>:<pack>:<ts>"
function parsePayload(s) {
  const m = /^jt:(\d+):([a-z]+):(\d+)$/.exec(String(s || ''));
  if (!m) return null;
  return { uid: Number(m[1]), pack: m[2] };
}

// credit an in-app Star pack, idempotent on the Telegram charge id
async function creditPayment({ uid, pack, sp, chargeId, providerId }) {
  const packs = config.toMap(await config.get('packs'));
  const p = packs[pack];
  if (!p) return;
  await tx(async (c) => {
    // ON CONFLICT DO NOTHING => webhook retries won't double-credit
    const ins = await c.query(
      `INSERT INTO payments(user_id,pack,stars_paid,stars_credited,telegram_charge_id,provider_charge_id,status)
       VALUES($1,$2,$3,$4,$5,$6,'paid')
       ON CONFLICT (telegram_charge_id) DO NOTHING RETURNING id`,
      [uid, pack, sp || p.stars, p.credit, chargeId, providerId || null]);
    if (!ins.rows[0]) return; // already processed
    await c.query('UPDATE users SET stars=stars+$1 WHERE id=$2', [p.credit, uid]);
    await c.query('INSERT INTO transactions(user_id,currency,amount,reason) VALUES($1,$2,$3,$4)',
      [uid, 'stars', p.credit, 'stars_pack:' + pack]);
    await c.query('INSERT INTO notifications(user_id,title,body) VALUES($1,$2,$3)',
      [uid, 'Stars added ⭐', `+${p.credit} Stars from your ${p.name} pack.`]);
  });
}

// POST /api/telegram/webhook
router.post('/webhook', async (req, res) => {
  if (!verify(req)) return res.status(401).json({ error: 'bad_secret' });
  const u = req.body || {};
  // Always ack fast so Telegram doesn't retry.
  res.json({ ok: true });

  try {
    // 1) Pre-checkout: must answer within 10s or the payment fails.
    if (u.pre_checkout_query) {
      const q = u.pre_checkout_query;
      const info = parsePayload(q.invoice_payload);
      const packs = config.toMap(await config.get('packs'));
      const okPack = info && packs[info.pack];
      await tg.answerPreCheckoutQuery(q.id, !!okPack, okPack ? undefined : 'This item is no longer available.');
      return;
    }
    // 2) Successful payment: credit the pack.
    const msg = u.message || u.edited_message;
    if (msg && msg.successful_payment) {
      const sp = msg.successful_payment;
      const info = parsePayload(sp.invoice_payload);
      if (info) {
        await creditPayment({
          uid: info.uid,
          pack: info.pack,
          sp: sp.total_amount,
          chargeId: sp.telegram_payment_charge_id,
          providerId: sp.provider_payment_charge_id,
        });
      }
    }
  } catch (e) {
    console.error('[tg webhook]', e.message);
  }
});

module.exports = router;
