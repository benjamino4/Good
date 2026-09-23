'use strict';
const router = require('express').Router();
const { query, tx } = require('../db');
const { requireAuth } = require('../auth');
const config = require('../config');

router.use(requireAuth);

async function ledger(c, uid, currency, amount, reason) {
  await c.query('INSERT INTO transactions(user_id,currency,amount,reason) VALUES($1,$2,$3,$4)',
    [uid, currency, amount, reason]);
}

// POST /api/game/checkin  \u2014 daily, streak, ember + loyalty tithe to hearth
router.post('/checkin', async (req, res, next) => {
  try {
    const econ = await config.get('economy');
    const out = await tx(async (c) => {
      const r = await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [req.user.id]);
      const u = r.rows[0];
      const today = new Date().toISOString().slice(0,10);
      if (u.last_checkin && u.last_checkin.toISOString().slice(0,10) === today)
        return { already: true, streak: u.streak };
      const yest = new Date(Date.now() - 864e5).toISOString().slice(0,10);
      const cont = u.last_checkin && u.last_checkin.toISOString().slice(0,10) === yest;
      const streak = cont ? u.streak + 1 : 1;
      const bonus = Math.min(streak * econ.streak_bonus_per_day, econ.streak_bonus_cap);
      const ember = econ.checkin_ember + bonus;
      const tithe = Math.round(ember * econ.tithe);
      await c.query('UPDATE users SET ember=ember+$1, loyalty=loyalty+$2, streak=$3, last_checkin=CURRENT_DATE WHERE id=$4',
        [ember, tithe, streak, u.id]);
      await ledger(c, u.id, 'ember', ember, 'checkin');
      await ledger(c, u.id, 'loyalty', tithe, 'tithe');
      if (u.tribe_id) await c.query('UPDATE tribes SET hearth_pool=hearth_pool+$1 WHERE id=$2', [tithe, u.tribe_id]);
      await c.query(`INSERT INTO quests_done(user_id,quest_key) VALUES($1,'checkin') ON CONFLICT DO NOTHING`, [u.id]);
      return { already:false, streak, ember, tithe };
    });
    res.json(out);
  } catch (e) { next(e); }
});

// GET /api/game/quests  \u2014 today's quest state (from editable config)
router.get('/quests', async (req, res, next) => {
  try {
    const quests = await config.get('quests');
    const r = await query(`SELECT quest_key FROM quests_done WHERE user_id=$1 AND day=CURRENT_DATE`, [req.user.id]);
    const done = new Set(r.rows.map(x => x.quest_key));
    res.json({ quests: quests.map(q => ({ ...q, done: done.has(q.key) })) });
  } catch (e) { next(e); }
});

// POST /api/game/quests/:key  \u2014 complete a quest
router.post('/quests/:key', async (req, res, next) => {
  try {
    const quests = config.toMap(await config.get('quests'));
    const q = quests[req.params.key];
    if (!q) return res.status(404).json({ error:'unknown_quest' });
    const out = await tx(async (c) => {
      const ins = await c.query(`INSERT INTO quests_done(user_id,quest_key) VALUES($1,$2)
        ON CONFLICT DO NOTHING RETURNING id`, [req.user.id, req.params.key]);
      if (!ins.rows[0]) return { already:true };
      await c.query('UPDATE users SET ember=ember+$1 WHERE id=$2', [q.reward, req.user.id]);
      await ledger(c, req.user.id, 'ember', q.reward, 'quest:'+req.params.key);
      return { already:false, reward:q.reward };
    });
    res.json(out);
  } catch (e) { next(e); }
});

// generic purchase helper (store / relic) \u2014 prices come from config
async function purchase(uid, catalog, key, type) {
  const item = catalog[key];
  if (!item) return { error:'unknown_item', status:404 };
  return tx(async (c) => {
    const r = await c.query('SELECT stars FROM users WHERE id=$1 FOR UPDATE', [uid]);
    if (Number(r.rows[0].stars) < item.price) return { error:'not_enough_stars', status:400 };
    const owned = await c.query('SELECT 1 FROM inventory WHERE user_id=$1 AND item_key=$2', [uid, key]);
    if (owned.rows[0]) return { error:'already_owned', status:400 };
    if (item.price > 0) {
      await c.query('UPDATE users SET stars=stars-$1 WHERE id=$2', [item.price, uid]);
      await ledger(c, uid, 'stars', -item.price, type+':'+key);
    }
    await c.query('INSERT INTO inventory(user_id,item_key,item_type) VALUES($1,$2,$3)', [uid, key, type]);
    return { ok:true, item:item.name, spent:item.price };
  });
}

// POST /api/game/store/:key
router.post('/store/:key', async (req, res, next) => {
  try {
    const store = config.toMap(await config.get('store'));
    const o = await purchase(req.user.id, store, req.params.key, 'store');
    if (o.error) return res.status(o.status).json({ error:o.error }); res.json(o);
  } catch (e) { next(e); }
});
// POST /api/game/relics/:key
router.post('/relics/:key', async (req, res, next) => {
  try {
    const relics = config.toMap(await config.get('relics'));
    const o = await purchase(req.user.id, relics, req.params.key, 'relic');
    if (o.error) return res.status(o.status).json({ error:o.error }); res.json(o);
  } catch (e) { next(e); }
});

// POST /api/game/upgrades/:key  \u2014 spend loyalty or stars
router.post('/upgrades/:key', async (req, res, next) => {
  try {
    const upgrades = config.toMap(await config.get('upgrades'));
    const up = upgrades[req.params.key];
    if (!up) return res.status(404).json({ error:'unknown_upgrade' });
    const cur = (up.cur === 'stars') ? 'stars' : 'loyalty';
    const out = await tx(async (c) => {
      const r = await c.query('SELECT loyalty, stars, tribe_id FROM users WHERE id=$1 FOR UPDATE', [req.user.id]);
      const bal = Number(r.rows[0][cur]);
      if (bal < up.cost) return { error:'insufficient', status:400 };
      await c.query(`UPDATE users SET ${cur}=${cur}-$1 WHERE id=$2`, [up.cost, req.user.id]);
      await ledger(c, req.user.id, cur, -up.cost, 'upgrade:'+req.params.key);
      if (req.params.key === 'hearth' && r.rows[0].tribe_id)
        await c.query('UPDATE tribes SET level=level+1 WHERE id=$1', [r.rows[0].tribe_id]);
      await c.query('INSERT INTO inventory(user_id,item_key,item_type) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [req.user.id, req.params.key, 'upgrade']);
      return { ok:true, upgrade:up.name };
    });
    if (out.error) return res.status(out.status).json({ error:out.error });
    res.json(out);
  } catch (e) { next(e); }
});

// POST /api/game/settlement/upgrade  \u2014 spend Loyalty from tribe hearth to grow settlement
router.post('/settlement/upgrade', async (req, res, next) => {
  try {
    if (!req.user.tribe_id) return res.status(400).json({ error:'no_tribe' });
    const econ = await config.get('economy');
    const cost = econ.settlement_cost_loyalty;
    const out = await tx(async (c) => {
      const r = await c.query('SELECT * FROM tribes WHERE id=$1 FOR UPDATE', [req.user.tribe_id]);
      const t = r.rows[0];
      if (t.settlement >= 4) return { error:'max_stage', status:400 };
      if (Number(t.hearth_pool) < cost) return { error:'hearth_low', status:400 };
      await c.query('UPDATE tribes SET settlement=settlement+1, hearth_pool=hearth_pool-$1 WHERE id=$2', [cost, t.id]);
      return { ok:true, settlement: t.settlement + 1 };
    });
    if (out.error) return res.status(out.status).json({ error:out.error });
    res.json(out);
  } catch (e) { next(e); }
});

// POST /api/game/land  \u2014 spend Stars to raise tribe member limit
router.post('/land', async (req, res, next) => {
  try {
    if (!req.user.tribe_id) return res.status(400).json({ error:'no_tribe' });
    const econ = await config.get('economy');
    const cost = econ.land_cost_stars, step = econ.land_member_step;
    const out = await tx(async (c) => {
      const r = await c.query('SELECT stars FROM users WHERE id=$1 FOR UPDATE', [req.user.id]);
      if (Number(r.rows[0].stars) < cost) return { error:'not_enough_stars', status:400 };
      await c.query('UPDATE users SET stars=stars-$1 WHERE id=$2', [cost, req.user.id]);
      await ledger(c, req.user.id, 'stars', -cost, 'land_expansion');
      const t = await c.query('UPDATE tribes SET member_limit=member_limit+$1 WHERE id=$2 RETURNING member_limit', [step, req.user.tribe_id]);
      return { ok:true, member_limit: t.rows[0].member_limit };
    });
    if (out.error) return res.status(out.status).json({ error:out.error });
    res.json(out);
  } catch (e) { next(e); }
});

module.exports = router;
