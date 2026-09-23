'use strict';
const router = require('express').Router();
const { query } = require('../db');
const { requireAuth } = require('../auth');

router.use(requireAuth);

function publicUser(u) {
  return {
    id: u.id, name: u.name, username: u.username, role: u.role,
    ember: Number(u.ember), loyalty: Number(u.loyalty), stars: Number(u.stars),
    streak: u.streak, last_checkin: u.last_checkin, tribe_id: u.tribe_id,
    wallet_address: u.wallet_address, ref_code: u.ref_code,
    claimed_at: u.claimed_at, claimed_amount: u.claimed_amount != null ? Number(u.claimed_amount) : null,
  };
}

// GET /api/me  — full dashboard bundle
router.get('/', async (req, res, next) => {
  try {
    const u = req.user;
    const inv = await query('SELECT item_key, item_type FROM inventory WHERE user_id=$1', [u.id]);
    const refs = await query('SELECT COUNT(*)::int AS n FROM users WHERE referred_by=$1', [u.id]);
    let tribe = null;
    if (u.tribe_id) {
      const t = await query('SELECT * FROM tribe_standings WHERE id=$1', [u.tribe_id]);
      tribe = t.rows[0] || null;
    }
    res.json({
      user: publicUser(u),
      inventory: inv.rows,
      referrals: refs.rows[0].n,
      tribe,
    });
  } catch (e) { next(e); }
});

// GET /api/me/notifications
router.get('/notifications', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT id,title,body,read,created_at FROM notifications
       WHERE user_id=$1 OR tribe_id=$2 ORDER BY created_at DESC LIMIT 30`,
      [req.user.id, req.user.tribe_id]);
    res.json({ notifications: r.rows });
  } catch (e) { next(e); }
});

// POST /api/me/notifications/read  — mark all read
router.post('/notifications/read', async (req, res, next) => {
  try {
    await query('UPDATE notifications SET read=true WHERE user_id=$1', [req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/me/wallet  { address, ton_proof? }  — save the connected TON wallet
router.post('/wallet', async (req, res, next) => {
  try {
    const addr = String(req.body.address || '').slice(0, 120);
    if (!addr) return res.status(400).json({ error: 'address_required' });
    // NOTE: for production you should verify req.body.ton_proof against the
    // TON Connect proof spec before trusting ownership of `addr`. We store the
    // address as-is here; the proof is accepted but not cryptographically
    // verified in this reference build.
    await query('UPDATE users SET wallet_address=$1 WHERE id=$2', [addr, req.user.id]);
    res.json({ ok: true, wallet_address: addr });
  } catch (e) { next(e); }
});

// POST /api/me/wallet/disconnect  — forget the wallet
router.post('/wallet/disconnect', async (req, res, next) => {
  try {
    await query('UPDATE users SET wallet_address=NULL WHERE id=$1', [req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// GET /api/me/claim  — estimate current allocation
router.get('/claim', async (req, res, next) => {
  try {
    // allocation formula: driven by personal ember (loyalty & consistency), NOT wealth
    const alloc = Math.round(Number(req.user.ember) * 0.35 + req.user.streak * 40);
    res.json({
      allocation: alloc,
      connected: !!req.user.wallet_address,
      claimed_at: req.user.claimed_at || null,
      claimed_amount: req.user.claimed_amount != null ? Number(req.user.claimed_amount) : null,
    });
  } catch (e) { next(e); }
});

// POST /api/me/claim  — claim the airdrop allocation to the connected TON wallet.
// Records the claim server-side (idempotent). Actual on-chain distribution is
// performed off this endpoint by your airdrop/token contract using the recorded
// (wallet_address, claimed_amount) pairs.
router.post('/claim', async (req, res, next) => {
  try {
    const u = req.user;
    if (!u.wallet_address) return res.status(400).json({ error: 'no_wallet' });
    if (u.claimed_at) {
      return res.json({ ok: true, already: true, allocation: Number(u.claimed_amount || 0),
        wallet_address: u.wallet_address });
    }
    const alloc = Math.round(Number(u.ember) * 0.35 + u.streak * 40);
    await query('UPDATE users SET claimed_at=now(), claimed_amount=$1 WHERE id=$2 AND claimed_at IS NULL',
      [alloc, u.id]);
    await query('INSERT INTO transactions(user_id,currency,amount,reason) VALUES($1,$2,$3,$4)',
      [u.id, 'airdrop', alloc, 'claim:' + u.wallet_address]);
    await query('INSERT INTO notifications(user_id,title,body) VALUES($1,$2,$3)',
      [u.id, 'Airdrop claimed 💎', `${alloc} $JUST queued to ${u.wallet_address}.`]);
    res.json({ ok: true, allocation: alloc, wallet_address: u.wallet_address });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.publicUser = publicUser;
