'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool, query } = require('./db');
const appConfig = require('./config');

// Apply the (fully idempotent) schema.sql. Safe to run on every boot.
async function applySchema() {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await query(schema);
}

// Run schema + default config without ever touching existing data.
// Used by the server on startup so a fresh DB self-initialises.
async function ensureSchema() {
  await applySchema();
  await seedConfig();
}

async function main() {
  const doSeed = process.argv.includes('--seed');
  console.log('Applying schema...');
  await applySchema();
  console.log('Schema applied.');

  // seed default game config (idempotent: keeps any admin edits)
  console.log('Seeding default config...');
  await seedConfig();

  if (doSeed) {
    console.log('Seeding demo data...');
    await seed();
    console.log('Seed complete.');
  }
  await pool.end();
}

// Insert factory-default config rows without clobbering existing admin edits.
async function seedConfig() {
  for (const key of appConfig.KEYS) {
    await query(
      `INSERT INTO app_config(key, value) VALUES($1, $2)
       ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(appConfig.DEFAULTS[key])]);
  }
}

async function seed() {
  // wipe (dev only)
  await query('TRUNCATE notifications, quests_done, inventory, transactions, users, tribes RESTART IDENTITY CASCADE');

  const tribes = [
    ['Emberwolves', 'The fire never sleeps.', 3, 9],
    ['Stonekin', 'Carved to last.', 3, 12],
    ['Nightspear', 'Silent. Sudden.', 2, 7],
    ['Ashborn', 'From ash, we rise.', 3, 14],
    ['Frostfang', 'Cold hearts, warm hearth.', 2, 10],
    ['Shadowborn', 'Hunt as one. Feast as one. Rise as one.', 3, 18],
  ];
  const tribeIds = {};
  for (const [name, wall, lvl] of tribes) {
    const r = await query(
      'INSERT INTO tribes(name, cave_wall, level, settlement, member_limit) VALUES($1,$2,$3,$4,25) RETURNING id',
      [name, wall, lvl, Math.min(lvl - 1, 4)]);
    tribeIds[name] = r.rows[0].id;
  }

  const roles = ['Chief','Head','Elder','Hunter','Hunter','Kin','Kin','Toddler'];
  const names = ['Ben Daniel','Ayla Storm','Torvald','Koro','Mira','Sena','Otto','Vale','Runa'];
  let idx = 0;
  for (const name of names) {
    const uname = '@' + name.toLowerCase().replace(/[^a-z]/g,'') ;
    const ember = 1200 + Math.floor(Math.random()*3000);
    const loyalty = 300 + Math.floor(Math.random()*400);
    await query(
      `INSERT INTO users(name, username, role, ember, loyalty, stars, streak, tribe_id, ref_code)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [name, uname, roles[idx % roles.length], ember, loyalty,
       Math.floor(Math.random()*300), Math.floor(Math.random()*10),
       tribeIds['Shadowborn'], 'TRIBE-'+name.split(' ')[0].toUpperCase()+'-'+Math.random().toString(36).slice(2,6).toUpperCase()]);
    idx++;
  }
  // spread a few members across other tribes for realistic averages
  for (const t of ['Emberwolves','Stonekin','Nightspear','Ashborn','Frostfang']) {
    for (let i=0;i<4;i++){
      await query(
        `INSERT INTO users(name, role, ember, loyalty, stars, tribe_id, ref_code)
         VALUES($1,'Hunter',$2,$3,0,$4,$5)`,
        [t+' Kin '+i, 800+Math.floor(Math.random()*2000), 400+Math.floor(Math.random()*300),
         tribeIds[t], t.slice(0,3).toUpperCase()+'-'+Math.random().toString(36).slice(2,7).toUpperCase()]);
    }
  }
  await query(`INSERT INTO notifications(user_id,title,body) VALUES
    (1,'You are now a Chief!','Lead the Shadowborn wisely.'),
    (1,'Your tribe reached Lv.3','The Hearth burns brighter.'),
    (1,'War Cry answered by 6 kin','The hunt begins.')`);
}

module.exports = { applySchema, seedConfig, ensureSchema, seed };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
