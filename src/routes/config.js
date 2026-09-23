'use strict';
// Public, read-only game configuration for the front-end.
// No auth required \u2014 exposes only non-sensitive, display-facing values
// (branding, catalogs, prices). Admins edit these via /api/admin/config.
const router = require('express').Router();
const config = require('../config');

// GET /api/config
router.get('/', async (req, res, next) => {
  try {
    const all = await config.loadAll();
    const econ = all.economy || {};
    res.json({
      branding: all.branding,
      store: all.store,
      relics: all.relics,
      upgrades: all.upgrades,
      quests: all.quests,
      packs: all.packs,
      economy: {
        land_cost_stars: econ.land_cost_stars,
        land_member_step: econ.land_member_step,
        settlement_cost_loyalty: econ.settlement_cost_loyalty,
      },
    });
  } catch (e) { next(e); }
});

module.exports = router;
