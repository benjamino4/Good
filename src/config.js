'use strict';
// ============================================================
//  Editable game configuration (admin-controlled).
//  Everything the admin panel can change lives here: branding,
//  rules, store, relics, upgrades, quests, Star packs, economy.
//  Values are stored in the `app_config` table (one row per key)
//  and cached in-memory. Call bust() after any write.
// ============================================================
const { query } = require('./db');

// ---- factory defaults (also used to seed a fresh database) ----
const DEFAULTS = {
  branding: {
    name: 'JUST TRIBES',
    tagline: 'Small tribes. Fierce hearts. Bigger tomorrow.',
    rules:
      '1. Feed the Fire every day to earn Ember \u2014 your personal, un-spendable proof of loyalty.\n' +
      '2. A share of your Ember tithes into your tribe\u2019s Hearth as Loyalty.\n' +
      '3. Tribes are ranked by AVERAGE Loyalty per member \u2014 not size, not wealth.\n' +
      '4. Spend Stars in the Sky store on relics, boosts and land.\n' +
      '5. Grow your settlement Village \u2192 Town \u2192 Dynasty \u2192 Empire \u2192 Kingdom.\n' +
      '6. The airdrop rewards consistency and community \u2014 show up, bring kin, rise together.'
  },
  economy: {
    checkin_ember: 120,
    tithe: 0.20,
    streak_bonus_per_day: 5,
    streak_bonus_cap: 100,
    land_cost_stars: 150,
    land_member_step: 5,
    settlement_cost_loyalty: 6000,
    referral_reward_ember: 300,
    signup_stars: 50
  },
  store: [
    { key: 'torch', name: 'Ember Torch',     emoji: '\uD83D\uDD6F\uFE0F', desc: '+10% Ember 24h',        price: 60  },
    { key: 'totem', name: 'Wolf Totem',      emoji: '\uD83D\uDC3A',       desc: 'Tribe +5% Loyalty',    price: 120 },
    { key: 'charm', name: 'Celestial Charm', emoji: '\uD83D\uDD2E',       desc: 'Streak shield x1',      price: 90  },
    { key: 'horn',  name: 'War Horn',        emoji: '\uD83D\uDCE3',       desc: 'Double War Cry reach',  price: 75  }
  ],
  relics: [
    { key: 'firestone', name: 'Firestone', emoji: '\uD83D\uDD25', desc: '+8% Ember',        price: 0,   starter: true  },
    { key: 'boneidol',  name: 'Bone Idol', emoji: '\uD83E\uDDB4', desc: '+5% streak Ember', price: 0,   starter: true  },
    { key: 'sundisc',   name: 'Sun Disc',  emoji: '\u2600\uFE0F',  desc: '+12% daily quest', price: 140, starter: false },
    { key: 'moonshard', name: 'Moon Shard',emoji: '\uD83C\uDF19', desc: 'Night x2 Ember',   price: 180, starter: false }
  ],
  upgrades: [
    { key: 'hearth',     name: 'Hearth Level', desc: 'Raise Hearth level',        cur: 'loyalty', cost: 6000 },
    { key: 'emberwell',  name: 'Ember Well',   desc: 'Passive +50 Ember/day',     cur: 'loyalty', cost: 3200 },
    { key: 'watchtower', name: 'Watchtower',   desc: 'See rival tribe stats',     cur: 'stars',   cost: 80   },
    { key: 'forge',      name: 'Great Forge',  desc: 'Relic slots 2 \u2192 3',     cur: 'stars',   cost: 200  }
  ],
  quests: [
    { key: 'checkin',  name: 'Feed the Fire',           reward: 120 },
    { key: 'warcry',   name: 'Send a War Cry',          reward: 80  },
    { key: 'starlore', name: 'Align a constellation',   reward: 150 }
  ],
  packs: [
    { key: 'spark',   name: 'Spark',   emoji: '\u2728',       stars: 50,  credit: 50,  tag: ''     },
    { key: 'flame',   name: 'Flame',   emoji: '\uD83D\uDD25', stars: 100, credit: 110, tag: '+10%' },
    { key: 'blaze',   name: 'Blaze',   emoji: '\u2604\uFE0F', stars: 250, credit: 300, tag: '+20%' },
    { key: 'inferno', name: 'Inferno', emoji: '\uD83C\uDF0B', stars: 500, credit: 650, tag: '+30%' }
  ]
};

const KEYS = Object.keys(DEFAULTS);

// ---- in-memory cache ----
let _cache = null;
let _loadedAt = 0;
const TTL = 15000; // ms

function defaults() { return JSON.parse(JSON.stringify(DEFAULTS)); }

// Load every config key from the DB, filling gaps with defaults.
async function loadAll(force = false) {
  if (!force && _cache && (Date.now() - _loadedAt) < TTL) return _cache;
  const out = defaults();
  try {
    const r = await query('SELECT key, value FROM app_config');
    for (const row of r.rows) {
      if (KEYS.includes(row.key)) out[row.key] = row.value;
    }
  } catch (e) {
    // table may not exist yet (pre-migrate) \u2014 fall back to defaults
  }
  _cache = out; _loadedAt = Date.now();
  return out;
}

async function get(key) {
  const all = await loadAll();
  return all[key];
}

// Persist one config key (admin only) and refresh the cache.
async function set(key, value) {
  if (!KEYS.includes(key)) throw new Error('unknown_config_key');
  await query(
    `INSERT INTO app_config(key, value, updated_at) VALUES($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]);
  bust();
  return value;
}

function bust() { _cache = null; _loadedAt = 0; }

// Convenience: turn an array catalog into a { key: item } map.
function toMap(arr) {
  const m = {};
  for (const it of (arr || [])) m[it.key] = it;
  return m;
}

module.exports = { DEFAULTS, KEYS, defaults, loadAll, get, set, bust, toMap };
