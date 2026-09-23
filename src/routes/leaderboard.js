'use strict';
const router = require('express').Router();
const { query } = require('../db');
const { requireAuth } = require('../auth');

router.use(requireAuth);

// GET /api/leaderboard/tribes  — world ranking by average loyalty per member
router.get('/tribes', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT id,name,level,settlement,members,avg_loyalty
       FROM tribe_standings WHERE members > 0
       ORDER BY avg_loyalty DESC, members ASC LIMIT 100`);
    // find caller's tribe rank
    let myRank = null;
    if (req.user.tribe_id) {
      const idx = r.rows.findIndex(t => String(t.id) === String(req.user.tribe_id));
      myRank = idx >= 0 ? idx + 1 : null;
    }
    res.json({ tribes: r.rows, myRank, myTribeId: req.user.tribe_id });
  } catch (e) { next(e); }
});

// GET /api/leaderboard/kin  — members by ember (within your tribe, else global)
router.get('/kin', async (req, res, next) => {
  try {
    const scope = req.query.scope === 'global' || !req.user.tribe_id;
    const r = scope
      ? await query('SELECT id,name,ember FROM users ORDER BY ember DESC LIMIT 100')
      : await query('SELECT id,name,ember FROM users WHERE tribe_id=$1 ORDER BY ember DESC LIMIT 100', [req.user.tribe_id]);
    res.json({ kin: r.rows.map(k => ({ ...k, ember: Number(k.ember), me: k.id === req.user.id })) });
  } catch (e) { next(e); }
});

module.exports = router;
