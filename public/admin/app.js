/* ============================================================
   JUST TRIBES — Admin panel front-end
   Logs in with username/password (env ADMIN_USER/ADMIN_PASS),
   gets an admin JWT, then edits every game config key plus
   stats / users / audit log. All visuals are code-drawn (no images).
   ============================================================ */
const API = (location.origin && location.origin.startsWith('http')) ? location.origin + '/api' : '/api';
let ATOKEN = localStorage.getItem('jt_admin_token') || null;
let TG = null;
try { if (window.Telegram && Telegram.WebApp) { TG = Telegram.WebApp; TG.ready(); TG.expand(); } } catch(e){}

let CONFIG = null;      // { config, defaults, keys }
let CURRENT = 'branding';

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function num(v,d){ const n=Number(v); return Number.isFinite(n)?n:(d||0); }
let toastT;
function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),2200); }

async function apiA(path, opts={}){
  const headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
  if (ATOKEN) headers.Authorization = 'Bearer ' + ATOKEN;
  const res = await fetch(API + path, Object.assign({}, opts, { headers, body: opts.body?JSON.stringify(opts.body):undefined }));
  if (res.status === 401 || res.status === 403){ if(ATOKEN){ logout(); } }
  if (!res.ok){ const e = await res.json().catch(()=>({error:res.statusText})); throw new Error(e.error||'err'); }
  return res.json();
}

/* ---------- login ---------- */
async function boot(){
  try{ const s = await apiA('/admin/status'); if(!s.enabled) $('loginDisabled').classList.remove('hide'); }catch(e){}
  if (ATOKEN){ // try to resume
    try{ await loadConfig(); showPanel(); return; }catch(e){ ATOKEN=null; localStorage.removeItem('jt_admin_token'); }
  }
  $('login').classList.remove('hide');
  ['u','p'].forEach(id=>$(id).addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); }));
}

async function doLogin(){
  const username = $('u').value.trim();
  const password = $('p').value;
  if(!username || !password){ toast('Enter username & password'); return; }
  try{
    const body = { username, password };
    if (TG && TG.initData) body.initData = TG.initData;   // admin-bot launch context
    const r = await apiA('/admin/login', { method:'POST', body });
    ATOKEN = r.token; localStorage.setItem('jt_admin_token', ATOKEN);
    await loadConfig(); showPanel(); toast('Welcome, '+r.username);
  }catch(e){
    toast(e.message==='bad_credentials'?'Wrong username or password'
        : e.message==='admin_disabled'?'Admin not configured on server'
        : e.message==='bad_admin_initdata'?'Admin bot verification failed'
        : 'Login failed');
  }
}
function logout(){ ATOKEN=null; localStorage.removeItem('jt_admin_token'); $('panel').classList.add('hide'); $('login').classList.remove('hide'); }

async function loadConfig(){ CONFIG = await apiA('/admin/config'); }

function showPanel(){
  $('login').classList.add('hide'); $('panel').classList.remove('hide');
  const tabs = [
    ['branding','🏷️ Branding'],['economy','⚙️ Economy'],['store','🏪 Store'],
    ['relics','🏺 Relics'],['upgrades','🏗️ Upgrades'],['quests','🔥 Quests'],
    ['packs','⭐ Star Packs'],['stats','📊 Stats'],['users','🧑 Users'],['log','📜 Log'],
  ];
  $('tabs').innerHTML = tabs.map(([k,label])=>`<div class="tab ${k===CURRENT?'active':''}" onclick="selectTab('${k}')">${label}</div>`).join('');
  render();
}
function selectTab(k){ CURRENT=k; document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  [...document.querySelectorAll('.tab')].forEach(t=>{ if(t.getAttribute('onclick').includes("'"+k+"'")) t.classList.add('active'); });
  render();
}

/* ---------- render dispatch ---------- */
function render(){
  if(['stats','users','log'].includes(CURRENT)) return renderTool(CURRENT);
  renderConfig(CURRENT);
}

/* ============================================================
   CONFIG EDITORS
   ============================================================ */
function cfg(k){ return (CONFIG && CONFIG.config && CONFIG.config[k]) || (CONFIG && CONFIG.defaults[k]); }

function saveBar(k){
  return `<div style="display:flex;gap:8px;margin-top:14px">
    <button class="btn btn-ember" style="flex:1" onclick="saveConfig('${k}')">Save changes</button>
    <button class="btn btn-ghost" onclick="resetConfig('${k}')">Reset to default</button></div>`;
}
function shell(title, sub, inner, k){
  $('view').innerHTML = `<div class="card" style="padding:18px">
    <div style="font-weight:800;font-size:16px">${title}</div>
    <div class="mut" style="margin:2px 0 14px">${sub}</div>
    ${inner}${saveBar(k)}</div>`;
}

function renderConfig(k){
  if(k==='branding') return editBranding();
  if(k==='economy')  return editEconomy();
  return editCatalog(k);
}

/* ---- branding ---- */
function editBranding(){
  const b = cfg('branding')||{};
  shell('Branding & Rules','App name, tagline and the in-app Codex shown to players.',
    `<label>App name</label><input id="b_name" value="${esc(b.name)}" maxlength="60"/>
     <div style="height:10px"></div>
     <label>Tagline</label><input id="b_tag" value="${esc(b.tagline)}" maxlength="160"/>
     <div style="height:10px"></div>
     <label>Rules / Codex (one per line)</label>
     <textarea id="b_rules" rows="8">${esc(b.rules)}</textarea>`, 'branding');
}
function collectBranding(){ return { name:$('b_name').value, tagline:$('b_tag').value, rules:$('b_rules').value }; }

/* ---- economy ---- */
const ECON_FIELDS = [
  ['checkin_ember','Daily check-in Ember'],['tithe','Tithe to Hearth (0-1)'],
  ['streak_bonus_per_day','Streak bonus / day'],['streak_bonus_cap','Streak bonus cap'],
  ['land_cost_stars','Land expansion cost (Stars)'],['land_member_step','Members added per land buy'],
  ['settlement_cost_loyalty','Settlement upgrade cost (Loyalty)'],
  ['referral_reward_ember','Referral reward (Ember)'],['signup_stars','Sign-up bonus (Stars)'],
];
function editEconomy(){
  const e = cfg('economy')||{};
  const inner = `<div class="row">` + ECON_FIELDS.map(([f,label])=>
    `<div><label>${label}</label><input id="e_${f}" type="number" step="${f==='tithe'?'0.01':'1'}" value="${esc(e[f])}"/></div>`).join('') + `</div>`;
  shell('Economy','Tune the core game math. Changes apply to new actions immediately.', inner, 'economy');
}
function collectEconomy(){ const o={}; ECON_FIELDS.forEach(([f])=>{ o[f]=num($('e_'+f).value,0); }); return o; }

/* ---- list-based catalogs (store / relics / upgrades / quests / packs) ---- */
const CAT_SUB = {
  store:'In-app items bought with Stars. Emoji is the icon (no images).',
  relics:'Ember boosters. Mark “Starter” to give it free/equipped from the start.',
  upgrades:'Tribe upgrades. Choose whether they cost Loyalty or Stars.',
  quests:'Daily quests and their Ember reward. Keys must match server logic (checkin, warcry, starlore).',
  packs:'Telegram Stars top-up packs. “Stars” = XTR charged, “Credit” = in-app Stars granted.',
};
function fieldsFor(key){
  if(key==='store'||key==='relics') return [['key','Key'],['name','Name'],['emoji','Emoji'],['desc','Description'],['price','Price ⭐']].concat(key==='relics'?[['starter','Starter']]:[]);
  if(key==='upgrades') return [['key','Key'],['name','Name'],['desc','Description'],['cur','Currency'],['cost','Cost']];
  if(key==='quests')   return [['key','Key'],['name','Name'],['reward','Reward Ember']];
  if(key==='packs')    return [['key','Key'],['name','Name'],['emoji','Emoji'],['stars','Stars (XTR)'],['credit','Credit'],['tag','Tag']];
  return [];
}
function itemRow(key, it, i){
  const flds = fieldsFor(key);
  const cells = flds.map(([f,label])=>{
    const id = `c_${i}_${f}`;
    if(f==='cur'){
      return `<div><label>${label}</label><select id="${id}">
        <option value="loyalty" ${it.cur==='loyalty'?'selected':''}>Loyalty</option>
        <option value="stars" ${it.cur==='stars'?'selected':''}>Stars</option></select></div>`;
    }
    if(f==='starter'){
      return `<div><label>${label}</label><select id="${id}">
        <option value="1" ${it.starter?'selected':''}>Yes</option>
        <option value="0" ${!it.starter?'selected':''}>No</option></select></div>`;
    }
    const numeric = ['price','cost','reward','stars','credit'].includes(f);
    return `<div><label>${label}</label><input id="${id}" ${numeric?'type="number"':''} value="${esc(it[f])}"/></div>`;
  }).join('');
  return `<div class="item" data-idx="${i}">
    <div class="row">${cells}</div>
    <button class="btn btn-danger" style="margin-top:8px;font-size:12px;padding:6px 10px" onclick="removeItem(${i})">Remove</button>
  </div>`;
}
let CAT_LIST = [];
function editCatalog(key){
  CAT_LIST = JSON.parse(JSON.stringify(cfg(key)||[]));
  const title = { store:'Store', relics:'Relics', upgrades:'Upgrades', quests:'Quests', packs:'Star Packs' }[key];
  const rows = CAT_LIST.map((it,i)=>itemRow(key,it,i)).join('') || '<div class="mut">No items yet — add one.</div>';
  const inner = `<div id="catList">${rows}</div>
    <button class="btn btn-ghost" style="margin-top:6px" onclick="addItem('${key}')">+ Add item</button>`;
  shell(title, CAT_SUB[key]||'', inner, key);
}
function blankItem(key){
  if(key==='store'||key==='relics') return {key:'',name:'',emoji:'⭐',desc:'',price:0,starter:false};
  if(key==='upgrades') return {key:'',name:'',desc:'',cur:'loyalty',cost:0};
  if(key==='quests')   return {key:'',name:'',reward:0};
  if(key==='packs')    return {key:'',name:'',emoji:'✨',stars:50,credit:50,tag:''};
  return {};
}
function addItem(key){ CAT_LIST = collectCatalog(key); CAT_LIST.push(blankItem(key)); reflowCatalog(key); }
function removeItem(i){ CAT_LIST = collectCatalog(CURRENT); CAT_LIST.splice(i,1); reflowCatalog(CURRENT); }
function reflowCatalog(key){
  const rows = CAT_LIST.map((it,i)=>itemRow(key,it,i)).join('') || '<div class="mut">No items yet — add one.</div>';
  $('catList').innerHTML = rows;
}
function collectCatalog(key){
  const flds = fieldsFor(key);
  const out = [];
  document.querySelectorAll('#catList .item').forEach((row)=>{
    const i = row.getAttribute('data-idx');
    const it = {};
    flds.forEach(([f])=>{
      const el = $(`c_${i}_${f}`); if(!el) return;
      if(f==='starter'){ it.starter = el.value==='1'; }
      else if(['price','cost','reward','stars','credit'].includes(f)){ it[f]=num(el.value,0); }
      else { it[f]=el.value; }
    });
    out.push(it);
  });
  return out;
}

/* ---------- save / reset ---------- */
function collect(k){
  if(k==='branding') return collectBranding();
  if(k==='economy')  return collectEconomy();
  return collectCatalog(k);
}
async function saveConfig(k){
  try{
    const value = collect(k);
    const r = await apiA('/admin/config/'+k, { method:'PUT', body:{ value } });
    CONFIG.config[k] = r.value;
    toast('Saved ✓'); render();
  }catch(e){ toast('Save failed: '+e.message); }
}
async function resetConfig(k){
  try{
    const r = await apiA('/admin/config/'+k+'/reset', { method:'POST' });
    CONFIG.config[k] = r.value;
    toast('Reset to default'); render();
  }catch(e){ toast('Reset failed'); }
}

/* ============================================================
   TOOLS: stats / users / log
   ============================================================ */
async function renderTool(k){
  $('view').innerHTML = '<div class="card" style="padding:18px"><div class="mut">Loading…</div></div>';
  if(k==='stats') return renderStats();
  if(k==='users') return renderUsers();
  if(k==='log')   return renderLog();
}
async function renderStats(){
  try{
    const s = await apiA('/admin/stats');
    $('view').innerHTML = `<div class="card" style="padding:18px">
      <div style="font-weight:800;font-size:16px;margin-bottom:14px">Overview</div>
      <div class="row">
        <div class="stat"><div class="n glow">${s.users}</div><div class="mut">Players</div></div>
        <div class="stat"><div class="n glow">${s.tribes}</div><div class="mut">Tribes</div></div>
        <div class="stat"><div class="n glow">${s.active_today}</div><div class="mut">Active today</div></div>
        <div class="stat"><div class="n glow">${s.wallets}</div><div class="mut">Wallets linked</div></div>
      </div>
      <div style="height:12px"></div>
      <div class="row">
        <div class="stat"><div class="n glow">${s.payments.count}</div><div class="mut">Paid orders</div></div>
        <div class="stat"><div class="n glow">${s.payments.xtr}</div><div class="mut">Telegram Stars (XTR)</div></div>
        <div class="stat"><div class="n glow">${s.payments.stars_credited}</div><div class="mut">In-app Stars sold</div></div>
      </div></div>`;
  }catch(e){ $('view').innerHTML='<div class="card" style="padding:18px"><div class="mut">Could not load stats. Is the database connected?</div></div>'; }
}
async function renderUsers(){
  try{
    const r = await apiA('/admin/users?limit=100');
    const rows = r.users.map(u=>`<tr>
      <td>${u.id}</td><td>${esc(u.name)}</td><td class="mut">${esc(u.username||'')}</td>
      <td>${esc(u.tribe||'—')}</td><td>${esc(u.role)}</td>
      <td class="glow">${u.ember}</td><td>${u.loyalty}</td><td>${u.stars}</td>
      <td><button class="btn btn-ghost" style="padding:5px 9px;font-size:11px" onclick="grantModal(${u.id},'${esc(u.name).replace(/'/g,"")}')">Grant</button></td>
    </tr>`).join('');
    $('view').innerHTML = `<div class="card" style="padding:14px;overflow-x:auto">
      <div style="font-weight:800;font-size:16px;margin-bottom:10px">Players (top 100 by Ember)</div>
      <table><thead><tr><th>ID</th><th>Name</th><th>@</th><th>Tribe</th><th>Role</th><th>Ember</th><th>Loyalty</th><th>Stars</th><th></th></tr></thead>
      <tbody>${rows||'<tr><td colspan=9 class="mut">No players yet.</td></tr>'}</tbody></table></div>`;
  }catch(e){ $('view').innerHTML='<div class="card" style="padding:18px"><div class="mut">Could not load users. Is the database connected?</div></div>'; }
}
function grantModal(id,name){
  const cur = prompt('Grant to '+name+' — currency? (ember / loyalty / stars)','stars');
  if(!cur) return;
  if(!['ember','loyalty','stars'].includes(cur)){ toast('Currency must be ember, loyalty or stars'); return; }
  const amt = prompt('Amount (use a negative number to deduct):','100');
  if(amt===null) return;
  grant(id, cur, num(amt,0));
}
async function grant(id, currency, amount){
  try{ const r = await apiA('/admin/users/'+id+'/grant',{ method:'POST', body:{ currency, amount } });
    toast('Updated — '+currency+' now '+r.user[currency]); renderUsers(); }
  catch(e){ toast('Grant failed: '+e.message); }
}
async function renderLog(){
  try{
    const r = await apiA('/admin/log');
    const rows = r.log.map(l=>`<tr>
      <td class="mut">${new Date(l.created_at).toLocaleString()}</td>
      <td>${esc(l.actor)}</td><td class="glow">${esc(l.action)}</td>
      <td class="mut">${esc(JSON.stringify(l.detail))}</td></tr>`).join('');
    $('view').innerHTML = `<div class="card" style="padding:14px;overflow-x:auto">
      <div style="font-weight:800;font-size:16px;margin-bottom:10px">Admin activity log</div>
      <table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead>
      <tbody>${rows||'<tr><td colspan=4 class="mut">No actions logged yet.</td></tr>'}</tbody></table></div>`;
  }catch(e){ $('view').innerHTML='<div class="card" style="padding:18px"><div class="mut">Could not load log.</div></div>'; }
}

document.addEventListener('DOMContentLoaded', boot);
