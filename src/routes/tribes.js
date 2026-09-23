'use strict';
const router = require('express').Router();
const { query, tx } = require('../db');
const { requireAuth } = require('../auth');

router.use(requireAuth);

// GET /api/tribes/:id  — full tribe view: standings + figures + contributors + roster
router.get('/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const t = await query('SELECT * FROM tribe_standings WHERE id=$1', [id]);
    if (!t.rows[0]) return res.status(404).json({ error:'no_tribe' });
    const hearth = await query('SELECT hearth_pool FROM tribes WHERE id=$1', [id]);
    const members = await query(
      `SELECT id,name,username,role,ember,loyalty,
         (last_checkin >= CURRENT_DATE - INTERVAL '1 day') AS online
       FROM users WHERE tribe_id=$1 ORDER BY ember DESC`, [id]);
    const rows = members.rows;
    const figures = rows.filter(m => ['Chief','Head','Elder'].includes(m.role)).slice(0,5);
    const contributors = rows.slice(0, 5).map(m => ({ ...m, pts: Number(m.ember) }));
    res.json({
      tribe: { ...t.rows[0], hearth_pool: Number(hearth.rows[0].hearth_pool) },
      figures, contributors, roster: rows,
    });
  } catch (e) { next(e); }
});

// POST /api/tribes  { name }  — found a new band (creator becomes Chief)
router.post('/', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 40);
    if (!name) return res.status(400).json({ error:'name_required' });
    const out = await tx(async (c) => {
      const exists = await c.query('SELECT 1 FROM tribes WHERE lower(name)=lower($1)', [name]);
      if (exists.rows[0]) return { error:'name_taken', status:409 };
      const t = await c.query('INSERT INTO tribes(name, created_by) VALUES($1,$2) RETURNING *', [name, req.user.id]);
      await c.query(`UPDATE users SET tribe_id=$1, role='Chief' WHERE id=$2`, [t.rows[0].id, req.user.id]);
      return { ok:true, tribe: t.rows[0] };
    });
    if (out.error) return res.status(out.status).json({ error:out.error });
    res.json(out);
  } catch (e) { next(e); }
});

// POST /api/tribes/:id/join
router.post('/:id/join', async (req, res, next) => {
  try {
    const out = await tx(async (c) => {
      const t = await c.query('SELECT * FROM tribes WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (!t.rows[0]) return { error:'no_tribe', status:404 };
      const cnt = await c.query('SELECT COUNT(*)::int n FROM users WHERE tribe_id=$1', [req.params.id]);
      if (cnt.rows[0].n >= t.rows[0].member_limit) return { error:'tribe_full', status:400 };
      await c.query(`UPDATE users SET tribe_id=$1, role='Kin' WHERE id=$2`, [req.params.id, req.user.id]);
      return { ok:true };
    });
    if (out.error) return res.status(out.status).json({ error:out.error });
    res.json(out);
  } catch (e) { next(e); }
});

// POST /api/tribes/leave
router.post('/leave', async (req, res, next) => {
  try {
    await query(`UPDATE users SET tribe_id=NULL, role='Toddler' WHERE id=$1`, [req.user.id]);
    res.json({ ok:true });
  } catch (e) { next(e); }
});

// PUT /api/tribes/:id/cavewall  { text }  — Chief/Head only
router.put('/:id/cavewall', async (req, res, next) => {
  try {
    if (!['Chief','Head'].includes(req.user.role) || String(req.user.tribe_id) !== req.params.id)
      return res.status(403).json({ error:'not_allowed' });
    const text = String(req.body.text || '').trim().slice(0, 160) || 'Hunt as one.';
    await query('UPDATE tribes SET cave_wall=$1 WHERE id=$2', [text, req.params.id]);
    res.json({ ok:true, cave_wall: text });
  } catch (e) { next(e); }
});

// POST /api/tribes/:id/warcry  — notify all members
router.post('/:id/warcry', async (req, res, next) => {
  try {
    await query(`INSERT INTO notifications(tribe_id,title,body) VALUES($1,$2,$3)`,
      [req.params.id, '\uD83D\uDCE3 War Cry!', (req.user.name||'A chief')+' calls the tribe to the hunt.']);
    res.json({ ok:true });
  } catch (e) { next(e); }
});

module.exports = router;
