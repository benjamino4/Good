/* ============================================================
   JUST TRIBES — full-stack front-end
   Talks to the Express API on the same origin (/api/*).
   No demo mode: if the API is unreachable the app shows a
   connection screen with a Retry button.
   ============================================================ */
const API = (location.origin && location.origin.startsWith('http')) ? location.origin + '/api' : '/api';
let TOKEN = localStorage.getItem('jt_token') || null;

/* Telegram */
let TG = null;
try { if (window.Telegram && Telegram.WebApp) { TG = Telegram.WebApp; TG.ready(); TG.expand(); } } catch(e){}

/* client-side display catalogs (keys MUST match server).
   These are DEFAULTS — loadConfig() overwrites them from /api/config so
   whatever an admin edits in the panel is reflected here live. Kept as
   `let` (not `const`) so they can be rebuilt. Also which relics are
   "starter" (free/equipped) is admin-driven via STARTER_RELICS. */
let STORE_META = {
  torch:{e:'🕯️',d:'+10% Ember 24h',name:'Torch'}, totem:{e:'🐺',d:'Tribe +5% Loyalty',name:'Totem'},
  charm:{e:'🔮',d:'Streak shield x1',name:'Charm'}, horn:{e:'📣',d:'Double War Cry reach',name:'Horn'},
};
let RELIC_META = {
  firestone:{e:'🔥',d:'+8% Ember',name:'Firestone'}, boneidol:{e:'🦴',d:'+5% streak Ember',name:'Bone Idol'},
  sundisc:{e:'☀️',d:'+12% daily quest',name:'Sun Disc'}, moonshard:{e:'🌙',d:'Night x2 Ember',name:'Moon Shard'},
};
let UP_META = {
  hearth:{d:'Raise Hearth level',name:'Hearth Level'}, emberwell:{d:'Passive +50 Ember/day',name:'Ember Well'},
  watchtower:{d:'See rival tribe stats',name:'Watchtower'}, forge:{d:'Relic slots 2 → 3',name:'Great Forge'},
};
let STARTER_RELICS = ['firestone','boneidol'];
const STAGES = ['Village','Town','Dynasty','Empire','Kingdom'];

/* game config hydrated from /api/config (admin-editable) */
let CFG = null;

/* app state (hydrated from API) */
const S = { me:null, tribe:null, quests:[], inventory:[], notifs:[], rankTab:'tribes' };
const fmt = n => Number(n||0).toLocaleString('en-US');

/* ---------- API helper ---------- */
async function api(path, opts={}) {
  const headers = Object.assign({ 'Content-Type':'application/json' }, opts.headers||{});
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  const res = await fetch(API + path, Object.assign({}, opts, { headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined }));
  if (!res.ok) { const e = await res.json().catch(()=>({error:res.statusText})); throw new Error(e.error||'err'); }
  return res.json();
}

async function authenticate() {
  // try telegram initData first, then dev login
  const ref = (TG && TG.initDataUnsafe && TG.initDataUnsafe.start_param) || null;
  try {
    if (TG && TG.initData) {
      const r = await api('/auth/telegram', { method:'POST', body:{ initData:TG.initData, ref } });
      TOKEN = r.token; localStorage.setItem('jt_token', TOKEN); return true;
    }
  } catch(e){ /* fall through to dev */ }
  try {
    const r = await api('/auth/dev', { method:'POST', body:{ ref } });
    TOKEN = r.token; localStorage.setItem('jt_token', TOKEN); return true;
  } catch(e){ return false; }
}

/* ---------- UI helpers ---------- */
let toastT;
function toast(msg){
  const t=document.getElementById('toast'); document.getElementById('toastMsg').textContent=msg;
  t.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),2400);
  try{ TG&&TG.HapticFeedback&&TG.HapticFeedback.notificationOccurred('success'); }catch(e){}
}
function openModal(html){ document.getElementById('modalSheet').innerHTML=html; document.getElementById('modal').classList.add('show'); }
function closeModal(){ document.getElementById('modal').classList.remove('show'); }
function bump(el){ if(!el)return; el.classList.remove('burst'); void el.offsetWidth; el.classList.add('burst'); }

/* ---------- navigation ---------- */
const MAIN = ['fire','tribe','ranks','lands','sky','more'];
function go(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const el = document.getElementById('screen-'+id); if(el) el.classList.add('active');
  const navId = MAIN.includes(id) ? id : 'more';
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.nav===navId));
  window.scrollTo(0,0);
}

/* ---------- SVG art ---------- */
function campfireSVG(){
  return `<svg width="150" height="120" viewBox="0 0 150 120">
    <ellipse cx="75" cy="108" rx="48" ry="9" fill="rgba(224,138,66,.15)"/>
    <g stroke="#5a4632" stroke-width="7" stroke-linecap="round">
      <line x1="40" y1="104" x2="110" y2="96"/><line x1="110" y1="104" x2="40" y2="96"/>
      <line x1="55" y1="108" x2="95" y2="92"/></g>
    <path class="flame" d="M75 30 C92 52 92 66 84 78 C102 74 96 44 75 22 C54 44 48 74 66 78 C58 66 58 52 75 30Z" fill="#e0842f"/>
    <path class="flame b" d="M75 46 C86 60 86 72 80 82 C93 78 88 58 75 42 C62 58 57 78 70 82 C64 72 64 60 75 46Z" fill="#ffce6b"/>
    <circle cx="75" cy="78" r="6" fill="#fff2cf"/></svg>`;
}
function seedEmbers(){
  const f=document.getElementById('emberField'); if(!f) return; f.innerHTML='';
  for(let i=0;i<18;i++){ const s=document.createElement('i');
    s.style.left=(15+Math.random()*70)+'%';
    s.style.setProperty('--dx',(Math.random()*40-20)+'px');
    s.style.animationDuration=(2.4+Math.random()*2.6)+'s';
    s.style.animationDelay=(Math.random()*3)+'s';
    s.style.width=s.style.height=(3+Math.random()*3)+'px'; f.appendChild(s); }
}
function seedStars(){
  const f=document.getElementById('starField'); if(!f) return; let h='';
  for(let i=0;i<40;i++){ const x=Math.random()*100,y=Math.random()*100,r=Math.random()*1.6+.4;
    h+=`<span class="twinkle" style="position:absolute;left:${x}%;top:${y}%;width:${r*2}px;height:${r*2}px;border-radius:50%;background:#cfe6ff;box-shadow:0 0 6px #8fd0ff;animation-delay:${Math.random()*3}s"></span>`; }
  f.innerHTML=h;
}
function settlementSVG(stage){
  const sky=['#141a24','#161d2a','#1a2030','#201a2c','#241a22'][stage];
  const glow=['#e0842f','#e0a042','#c98a4a','#a98bff','#ffce6b'][stage];
  let b='';
  if(stage===0){ b=`<path d='M40 150 l30 -34 30 34Z' fill='#6b4a2f'/><rect x='45' y='150' width='50' height='30' fill='#4a3220'/><path d='M120 155 l24 -26 24 26Z' fill='#6b4a2f'/><rect x='124' y='155' width='40' height='25' fill='#4a3220'/><path d='M200 150 l28 -30 28 30Z' fill='#6b4a2f'/><rect x='206' y='150' width='44' height='30' fill='#4a3220'/>`; }
  else if(stage===1){ b=`<rect x='30' y='120' width='240' height='60' fill='#3a2c1e'/><rect x='55' y='95' width='40' height='55' fill='#5a4128'/><path d='M55 95 l20 -20 20 20Z' fill='#7a5a34'/><rect x='130' y='85' width='45' height='65' fill='#5a4128'/><path d='M130 85 l22 -22 23 22Z' fill='#7a5a34'/><rect x='200' y='100' width='42' height='50' fill='#5a4128'/><path d='M200 100 l21 -20 21 20Z' fill='#7a5a34'/>`; }
  else if(stage===2){ b=`<rect x='120' y='70' width='60' height='90' fill='#5a4030'/><path d='M108 70 l42 -26 42 26Z' fill='#8a5a3a'/><path d='M114 96 h72 l-10 -12 h-52Z' fill='#7a4a30'/><rect x='60' y='120' width='40' height='40' fill='#4a3626'/><rect x='200' y='120' width='40' height='40' fill='#4a3626'/><path d='M55 120 l25 -16 25 16Z' fill='#7a5a34'/><path d='M195 120 l25 -16 25 16Z' fill='#7a5a34'/>`; }
  else if(stage===3){ b=`<rect x='40' y='110' width='220' height='70' fill='#2e2438'/><rect x='70' y='60' width='34' height='100' fill='#43335c'/><path d='M70 60 l17 -30 17 30Z' fill='#7c4dff'/><rect x='133' y='40' width='34' height='120' fill='#43335c'/><path d='M133 40 l17 -34 17 34Z' fill='#a98bff'/><rect x='196' y='60' width='34' height='100' fill='#43335c'/><path d='M196 60 l17 -30 17 30Z' fill='#7c4dff'/>`; }
  else { b=`<rect x='30' y='110' width='240' height='70' fill='#3a2e20'/><rect x='40' y='70' width='40' height='90' fill='#5a4530'/><rect x='120' y='50' width='60' height='110' fill='#6a5236'/><rect x='220' y='70' width='40' height='90' fill='#5a4530'/><path d='M120 50 l30 -30 30 30Z' fill='#ffce6b'/><path d='M40 70 l20 -22 20 22Z' fill='#e0a042'/><path d='M220 70 l20 -22 20 22Z' fill='#e0a042'/><rect x='140' y='110' width='20' height='50' fill='#2a2016'/>`; }
  return `<svg viewBox='0 0 300 180' width='100%' style='display:block'><defs><radialGradient id='g${stage}' cx='50%' cy='30%' r='70%'><stop offset='0%' stop-color='${glow}' stop-opacity='.35'/><stop offset='100%' stop-color='${sky}' stop-opacity='0'/></radialGradient></defs><rect width='300' height='180' fill='${sky}'/><rect width='300' height='180' fill='url(#g${stage})'/><circle cx='245' cy='40' r='16' fill='${glow}' opacity='.8'/>${b}<rect y='170' width='300' height='10' fill='rgba(0,0,0,.35)'/></svg>`;
}

/* ============================================================
   DATA LOADING
   ============================================================ */

/* Pull admin-editable game config from /api/config and rebuild the
   client catalogs + branding so panel edits show up live. Falls back
   to the built-in defaults if the endpoint is unreachable. */
async function loadConfig(){
  try{ CFG = await api('/config'); }catch(e){ CFG = null; return; }
  applyConfig();
}
function applyConfig(){
  if(!CFG) return;
  // ---- branding (name / tagline / rules) ----
  const b = CFG.branding || {};
  if(b.name){
    document.title = b.name;
    document.querySelectorAll('[data-brand-name]').forEach(e=>e.textContent=b.name);
    const fireTitle=document.querySelector('#screen-fire h1'); if(fireTitle) fireTitle.textContent=b.name;
  }
  if(b.tagline){
    const t=document.querySelector('#screen-fire h1 + p'); if(t) t.textContent=b.tagline;
  }
  const rulesEl=document.getElementById('rulesBody');
  if(rulesEl){ rulesEl.textContent = b.rules || ''; }
  // ---- store catalog ----
  if(Array.isArray(CFG.store)){
    STORE_META={}; STORE_PRICE={};
    CFG.store.forEach(it=>{ STORE_META[it.key]={e:it.emoji,d:it.desc,name:it.name}; STORE_PRICE[it.key]=it.price; });
  }
  // ---- relics ----
  if(Array.isArray(CFG.relics)){
    RELIC_META={}; RELIC_PRICE={}; STARTER_RELICS=[];
    CFG.relics.forEach(it=>{ RELIC_META[it.key]={e:it.emoji,d:it.desc,name:it.name}; RELIC_PRICE[it.key]=it.price;
      if(it.starter) STARTER_RELICS.push(it.key); });
  }
  // ---- upgrades ----
  if(Array.isArray(CFG.upgrades)){
    UP_META={}; UP_COST={};
    CFG.upgrades.forEach(it=>{ UP_META[it.key]={d:it.desc,name:it.name}; UP_COST[it.key]=[it.cur,it.cost]; });
  }
  // ---- star packs ----
  if(Array.isArray(CFG.packs) && CFG.packs.length){ PACKS=CFG.packs; }
}

async function loadAll(){
  const me = await api('/me');
  S.me = me.user; S.inventory = me.inventory; S.me.referrals = me.referrals;
  S.tribeStanding = me.tribe;
  const q = await api('/game/quests'); S.quests = q.quests;
  if (S.me.tribe_id){ const t = await api('/tribes/'+S.me.tribe_id); S.tribe = t; }
  const n = await api('/me/notifications'); S.notifs = n.notifications;
  renderAll();
}

function renderAll(){
  renderHeader(); renderFire(); renderTribeScreen(); renderSky();
  renderRelics(); renderUpgrades(); renderSettlement(); renderReferral(); renderWallet();
  switchRank(S.rankTab);
}

/* ---------- header / currency ---------- */
function renderHeader(){
  const u=S.me; if(!u) return;
  document.getElementById('emberVal').textContent=fmt(u.ember);
  document.getElementById('loyalVal').textContent=fmt(u.loyalty);
  document.getElementById('starVal').textContent=fmt(u.stars);
  const nameEl=document.querySelector('header .font-extrabold'); if(nameEl) nameEl.textContent=u.name;
  const roleEl=document.querySelector('header .glow-ember'); if(roleEl) roleEl.textContent=(u.role||'Kin').toUpperCase();
  const tribeEl=document.querySelector('header .text-\\[11px\\] span:last-child');
  const unread=S.notifs.filter(x=>!x.read).length;
  const dot=document.getElementById('notifDot'); if(dot){ dot.textContent=unread; dot.style.display=unread?'flex':'none'; }
}

/* ---------- FIRE ---------- */
function renderFire(){
  const u=S.me; if(!u) return;
  document.getElementById('streakVal').textContent=u.streak;
  const today=new Date().toISOString().slice(0,10);
  const checked=u.last_checkin && String(u.last_checkin).slice(0,10)===today;
  const b=document.getElementById('checkinBtn');
  if(checked){ b.textContent='✅ Fire fed today'; b.classList.add('opacity-70'); }
  // standing
  const stand=document.querySelector('#screen-fire .glow-ember'); // first glow-ember in standing card
  document.querySelectorAll('#screen-fire .text-lg.font-black .glow-ember').forEach(e=>e.textContent=u.role);
  const hn=document.getElementById('hearthNote');
  if(hn && S.tribe) hn.textContent='“'+S.tribe.tribe.cave_wall+'”';
  renderQuests();
}
function renderQuests(){
  const done=S.quests.filter(q=>q.done).length;
  document.getElementById('questCount').textContent=done+'/'+S.quests.length+' done';
  document.getElementById('questList').innerHTML=S.quests.map(q=>`
    <div class="nb rounded-2xl p-3 flex items-center justify-between">
      <div class="flex items-center gap-3"><span class="text-xl">${q.done?'✅':'🔥'}</span>
        <div><div class="text-[13px] font-semibold ${q.done?'line-through text-[#8b95a4]':''}">${q.name}</div>
        <div class="text-[11px] glow-ember font-bold">+${q.reward} Ember</div></div></div>
      ${q.done?'<span class="text-[11px] text-[#8b95a4]">Done</span>':`<button class="btn btn-ember px-3 py-1.5 text-[12px]" onclick="doQuest('${q.key}')">Do</button>`}
    </div>`).join('');
}

/* ---------- TRIBE ---------- */
function renderTribeScreen(){
  if(!S.tribe){ return; }
  const t=S.tribe.tribe;
  const nameEl=document.querySelector('#screen-tribe .text-xl.font-black');
  if(nameEl) nameEl.childNodes[0].nodeValue=t.name+' ';
  document.querySelector('#screen-tribe .chip').textContent='Lv.'+t.level;
  document.getElementById('memberCount').textContent=`${t.members} / ${t.member_limit} members · Avg Loyalty ${fmt(t.avg_loyalty)}`;
  document.getElementById('caveWall').textContent='“'+t.cave_wall+'”';
  const hp=document.querySelector('#screen-tribe .glow-loyal'); if(hp) hp.textContent=fmt(t.hearth_pool);
  // figures
  document.getElementById('figureList').innerHTML=S.tribe.figures.map(f=>`
    <div class="nb rounded-2xl p-3 flex items-center justify-between">
      <div class="flex items-center gap-3"><span class="text-2xl">${f.role==='Chief'?'👑':f.role==='Head'?'🪣':'🧓'}</span>
        <div><div class="text-[14px] font-bold">${f.name}</div><div class="text-[11px] text-[#8b95a4]">${f.username||''}</div></div></div>
      <div class="text-right"><span class="chip px-2 py-[2px] text-[11px] glow-loyal font-bold">${f.role}</span>
        <div class="text-[10px] mt-1 ${f.online?'text-emerald-400':'text-[#8b95a4]'}">${f.online?'● Online':'○ Offline'}</div></div>
    </div>`).join('') || '<div class="text-[12px] text-[#8b95a4]">No key figures yet.</div>';
  // contributors
  document.getElementById('contribList').innerHTML=S.tribe.contributors.map((c,i)=>`
    <div class="nb rounded-2xl p-3 flex items-center justify-between">
      <div class="flex items-center gap-3"><span class="w-7 h-7 rounded-lg chip flex items-center justify-center text-[12px] font-black ${i<3?'glow-ember':''}">${i+1}</span>
        <div><div class="text-[13px] font-semibold">${c.name}</div><div class="text-[11px] text-[#8b95a4]">${c.username||''}</div></div></div>
      <div class="text-[13px] font-black glow-ember">${fmt(c.pts)}</div></div>`).join('');
  // roster
  document.getElementById('rosterList').innerHTML=S.tribe.roster.map(r=>`
    <div class="nb rounded-xl p-2.5 flex items-center justify-between">
      <div class="flex items-center gap-2"><span class="w-7 h-7 rounded-full chip flex items-center justify-center">🧑</span>
        <span class="text-[13px] font-semibold">${r.name}</span></div>
      <div class="flex items-center gap-2"><span class="text-[11px] text-[#8b95a4]">${r.role}</span>
        <span class="w-2 h-2 rounded-full ${r.online?'bg-emerald-400':'bg-[#3a4350]'}"></span></div></div>`).join('');
}

/* ---------- RANKS ---------- */
async function switchRank(tab){
  S.rankTab=tab;
  document.getElementById('rkTribesBtn').className='btn py-2 px-4 text-[12px] flex-1 '+(tab==='tribes'?'btn-ember':'btn-ghost');
  document.getElementById('rkKinBtn').className='btn py-2 px-4 text-[12px] flex-1 '+(tab==='kin'?'btn-ember':'btn-ghost');
  document.getElementById('rankSubtitle').textContent=tab==='tribes'
    ? 'WORLD LEADERBOARD · TRIBES BY AVG LOYALTY' : 'KIN LEADERBOARD · MEMBERS BY EMBER';
  const el=document.getElementById('rankList'); el.innerHTML='<div class="text-[12px] text-[#8b95a4] p-4">Loading…</div>';
  try{
    if(tab==='tribes'){
      const r=await api('/leaderboard/tribes');
      if(r.myRank) document.getElementById('myTribeRank').textContent='#'+r.myRank;
      el.innerHTML=r.tribes.map((t,i)=>`
        <div class="nb ${String(t.id)===String(r.myTribeId)?'nb-ember':''} rounded-2xl p-3 flex items-center justify-between">
          <div class="flex items-center gap-3"><span class="w-8 h-8 rounded-lg chip flex items-center justify-center text-[13px] font-black ${i<3?'glow-ember':''}">${i+1}</span>
            <div><div class="text-[14px] font-bold">${t.name}</div><div class="text-[11px] text-[#8b95a4]">${t.members} members · ${STAGES[t.settlement]}</div></div></div>
          <div class="text-right"><div class="text-[14px] font-black glow-loyal">${fmt(t.avg_loyalty)}</div><div class="text-[10px] text-[#8b95a4]">avg loyalty</div></div></div>`).join('');
    } else {
      const r=await api('/leaderboard/kin');
      el.innerHTML=r.kin.map((k,i)=>`
        <div class="nb ${k.me?'nb-ember':''} rounded-2xl p-3 flex items-center justify-between">
          <div class="flex items-center gap-3"><span class="w-8 h-8 rounded-lg chip flex items-center justify-center text-[13px] font-black ${i<3?'glow-ember':''}">${i+1}</span>
            <span class="text-[14px] font-bold">${k.name}${k.me?' (you)':''}</span></div>
          <div class="text-[14px] font-black glow-ember">${fmt(k.ember)}</div></div>`).join('');
    }
  }catch(e){ el.innerHTML='<div class="text-[12px] text-[#8b95a4] p-4">Could not load leaderboard.</div>'; }
}

/* ---------- SKY / STORE ---------- */
function owns(key){ return S.inventory.some(i=>i.item_key===key); }
let STORE_PRICE={torch:60,totem:120,charm:90,horn:75};
let RELIC_PRICE={firestone:0,boneidol:0,sundisc:140,moonshard:180};
function renderSky(){
  renderStarPacks();
  document.getElementById('storeGrid').innerHTML=Object.entries(STORE_META).map(([k,m])=>`
    <div class="nb nb-star rounded-2xl p-3 flex flex-col">
      <div class="text-3xl">${m.e}</div>
      <div class="text-[13px] font-bold mt-1">${m.name||k[0].toUpperCase()+k.slice(1)}</div>
      <div class="text-[11px] text-[#8b95a4] flex-1">${m.d}</div>
      ${owns(k)?'<span class="chip px-2 py-1 text-[11px] glow-star font-bold mt-2 text-center">Owned</span>'
        :`<button class="btn btn-star w-full py-2 mt-2 text-[12px]" onclick="buyStore('${k}')">⭐ ${STORE_PRICE[k]}</button>`}
    </div>`).join('');
}
/* ---------- RELICS ---------- */
function renderRelics(){
  document.getElementById('relicGrid').innerHTML=Object.entries(RELIC_META).map(([k,m])=>{
    const own=owns(k)||STARTER_RELICS.includes(k);
    return `<div class="nb ${own?'nb-ember':''} rounded-2xl p-3 flex flex-col text-center">
      <div class="text-4xl">${m.e}</div>
      <div class="text-[13px] font-bold mt-1">${m.name||k[0].toUpperCase()+k.slice(1)}</div>
      <div class="text-[11px] text-[#8b95a4] flex-1">${m.d}</div>
      ${own?'<span class="chip px-2 py-1 text-[11px] glow-ember font-bold mt-2">Equipped</span>'
        :`<button class="btn btn-star w-full py-2 mt-2 text-[12px]" onclick="buyRelic('${k}')">⭐ ${RELIC_PRICE[k]}</button>`}</div>`;
  }).join('');
}
/* ---------- UPGRADES ---------- */
let UP_COST={hearth:['loyalty',6000],emberwell:['loyalty',3200],watchtower:['stars',80],forge:['stars',200]};
function renderUpgrades(){
  const t=S.tribe&&S.tribe.tribe;
  document.getElementById('memLimit').textContent=t?t.member_limit:25;
  document.getElementById('upgradeList').innerHTML=Object.entries(UP_META).map(([k,m])=>{
    const [cur,cost]=UP_COST[k];
    return `<div class="nb rounded-2xl p-3 flex items-center justify-between">
      <div><div class="text-[14px] font-bold">${k[0].toUpperCase()+k.slice(1)}</div><div class="text-[11px] text-[#8b95a4]">${m.d}</div></div>
      <button class="btn ${cur==='stars'?'btn-star':'btn-loyal'} px-3 py-2 text-[12px]" onclick="buyUpgrade('${k}')">
        ${cur==='stars'?'⭐':'🛡️'} ${fmt(cost)}</button></div>`;
  }).join('');
}
/* ---------- SETTLEMENT (lands) ---------- */
function renderSettlement(){
  const stage=S.tribe?S.tribe.tribe.settlement:0;
  document.getElementById('settleName').textContent=STAGES[stage];
  document.getElementById('settleArt').innerHTML=settlementSVG(stage);
  const next=stage<4?STAGES[stage+1]:'Max';
  document.getElementById('settleProg').textContent=STAGES[stage]+(stage<4?(' → '+next):' · Legendary');
  document.getElementById('settleFill').style.width=((stage+1)/5*100)+'%';
  document.getElementById('stageStrip').innerHTML=STAGES.map((s,i)=>`
    <div class="nb ${i===stage?'nb-loyal':''} rounded-xl p-1 text-center ${i<=stage?'':'opacity-40'}">
      <div class="rounded-md overflow-hidden">${settlementSVG(i)}</div>
      <div class="text-[9px] font-bold mt-1">${s}</div></div>`).join('');
}
/* ---------- REFERRAL ---------- */
function renderReferral(){
  const u=S.me; if(!u) return;
  document.getElementById('refCode').textContent=u.ref_code||'TRIBE-XXXX';
  const stats=document.querySelectorAll('#screen-referral .grid .font-black');
  if(stats[0]) stats[0].textContent=u.referrals||0;
}
/* ---------- WALLET / CLAIM (TON Connect) ---------- */
let TC = null;                 // TonConnectUI instance (null in demo / file://)
const shortAddr = a => a ? (a.length > 14 ? a.slice(0,6)+'\u2026'+a.slice(-4) : a) : '';

function initTon(){
  try{
    if(location.origin && location.origin.startsWith('http') && window.TON_CONNECT_UI){
      TC = new TON_CONNECT_UI.TonConnectUI({ manifestUrl: location.origin + '/tonconnect-manifest.json' });
      TC.onStatusChange(async (w)=>{
        if(w && w.account){
          const addr = w.account.address;
          const proof = (w.connectItems && w.connectItems.tonProof) || null;
          if(S.me) S.me.wallet_address = addr;
          try{ await api('/me/wallet',{method:'POST',body:{address:addr, ton_proof:proof}}); }catch(e){}
          renderWallet(); toast('\ud83d\udd17 TON wallet connected');
        } else {
          if(S.me) S.me.wallet_address = null;
          renderWallet();
        }
      });
    }
  }catch(e){ console.warn('TON init failed', e); }
}

async function renderWallet(){
  const u=S.me; if(!u) return;
  const st=document.getElementById('walletState');
  let alloc='\u2014', claimed=false;
  try{ const c=await api('/me/claim'); alloc=fmt(c.allocation)+' $JUST'; claimed=!!c.claimed_at; }
  catch(e){ /* leave alloc as — */ }
  document.getElementById('allocVal').textContent=alloc;
  const list=document.getElementById('walletList');
  if(u.wallet_address){
    st.innerHTML=`<div class="nb nb-ember rounded-xl p-3 text-[13px]">\u2705 TON wallet connected<br>
        <span class="text-[11px] text-[#8b95a4] break-all">${shortAddr(u.wallet_address)}</span></div>
      <button class="btn btn-ember w-full py-3 mt-3 text-sm" onclick="claimAllocation()" ${claimed?'disabled style="opacity:.55"':''}>
        ${claimed?'\u2705 Allocation claimed':'Claim '+alloc}</button>
      <button class="text-[12px] text-[#8b95a4] w-full mt-2" onclick="disconnectWallet()">Disconnect wallet</button>`;
    list.innerHTML='';
  } else {
    st.innerHTML='<div class="text-[12px] text-[#8b95a4]">No wallet connected</div>';
    list.innerHTML=`<button class="btn btn-star w-full py-3 text-sm" onclick="connectWallet()">\ud83d\udc8e Connect TON Wallet</button>
      <p class="text-[11px] text-[#8b95a4] text-center mt-2">Tonkeeper \u00b7 TON Space \u00b7 MyTonWallet \u00b7 Wallet in Telegram</p>`;
  }
}

/* ============================================================
   INTERACTIONS (call the API, then refresh state)
   ============================================================ */
async function doCheckin(){
  try{
    const r=await api('/game/checkin',{method:'POST'});
    if(r.already){ toast('Already fed the fire today'); return; }
    await refreshMe(); renderHeader(); renderFire(); bump(document.getElementById('emberVal'));
    toast('🔥 +'+r.ember+' Ember · streak '+r.streak);
  }catch(e){ toast('Check-in failed'); }
}
async function doQuest(key){
  try{ const r=await api('/game/quests/'+key,{method:'POST'});
    if(r.already){ toast('Already done'); return; }
    await refreshMe(); const q=await api('/game/quests'); S.quests=q.quests;
    renderHeader(); renderQuests(); bump(document.getElementById('emberVal'));
    toast('✅ Quest done +'+r.reward+' Ember');
  }catch(e){ toast('Quest failed'); }
}
async function buyStore(key){
  try{ await api('/game/store/'+key,{method:'POST'}); await refreshMe(); renderHeader(); renderSky();
    bump(document.getElementById('starVal')); toast('🛒 Purchased'); }
  catch(e){ toast(e.message==='not_enough_stars'?'Not enough Stars':'Purchase failed'); }
}
async function buyRelic(key){
  try{ await api('/game/relics/'+key,{method:'POST'}); await refreshMe(); renderHeader(); renderRelics();
    bump(document.getElementById('starVal')); toast('🏺 Relic equipped'); }
  catch(e){ toast(e.message==='not_enough_stars'?'Not enough Stars':'Failed'); }
}
async function buyUpgrade(key){
  try{ await api('/game/upgrades/'+key,{method:'POST'}); await refreshMe();
    if(S.me.tribe_id){ S.tribe=await api('/tribes/'+S.me.tribe_id); }
    renderHeader(); renderUpgrades(); renderTribeScreen(); toast('🏗️ Upgraded!'); }
  catch(e){ toast(e.message==='insufficient'?'Not enough resources':'Failed'); }
}
async function buyLand(){
  try{ const r=await api('/game/land',{method:'POST'}); await refreshMe();
    if(S.me.tribe_id){ S.tribe=await api('/tribes/'+S.me.tribe_id); }
    renderHeader(); renderUpgrades(); toast('🗺️ Land expanded! Limit '+r.member_limit); }
  catch(e){ toast(e.message==='not_enough_stars'?'Not enough Stars':'Failed'); }
}
async function upgradeSettlement(){
  try{ const r=await api('/game/settlement/upgrade',{method:'POST'});
    S.tribe=await api('/tribes/'+S.me.tribe_id); renderSettlement(); renderTribeScreen();
    toast('🏗️ Grown into a '+STAGES[r.settlement]+'!'); }
  catch(e){ toast(e.message==='hearth_low'?'Hearth pool too low':e.message==='max_stage'?'Already a Kingdom!':'Failed'); }
}
async function connectWallet(){
  if(TC){ try{ await TC.openModal(); }catch(e){ toast('Connect cancelled'); } return; }
  const addr='EQ'+Math.random().toString(36).slice(2,10)+'9fx2';
  S.me.wallet_address=addr;
  try{ await api('/me/wallet',{method:'POST',body:{address:addr}}); }catch(e){}
  renderWallet(); toast('\ud83d\udd17 Wallet connected');
}
async function disconnectWallet(){
  if(TC){ try{ await TC.disconnect(); }catch(e){} }
  S.me.wallet_address=null;
  try{ await api('/me/wallet/disconnect',{method:'POST'}); }catch(e){}
  renderWallet(); toast('Wallet disconnected');
}
async function claimAllocation(){
  try{ const r=await api('/me/claim',{method:'POST'});
    await refreshMe(); renderWallet();
    toast(r.already?'Already claimed':'\ud83d\udc8e '+fmt(r.allocation)+' $JUST queued to your wallet!'); }
  catch(e){ toast(e.message==='no_wallet'?'Connect a wallet first':'Claim failed'); }
}

/* ---------- STARS TOP-UP (Telegram Stars) ---------- */
let PACKS=[];
const DEFAULT_PACKS=[
  {key:'spark',name:'Spark',emoji:'\u2728',stars:50,credit:50,tag:''},
  {key:'flame',name:'Flame',emoji:'\ud83d\udd25',stars:100,credit:110,tag:'+10%'},
  {key:'blaze',name:'Blaze',emoji:'\u2604\ufe0f',stars:250,credit:300,tag:'+20%'},
  {key:'inferno',name:'Inferno',emoji:'\ud83c\udf0b',stars:500,credit:650,tag:'+30%'},
];
async function loadPacks(){
  try{ const r=await api('/payments/packs'); PACKS=r.packs; }catch(e){ PACKS=DEFAULT_PACKS; }
}
function renderStarPacks(){
  const el=document.getElementById('starPacks'); if(!el) return;
  if(!PACKS.length) PACKS=DEFAULT_PACKS;
  el.innerHTML=PACKS.map(p=>`
    <div class="nb nb-star rounded-2xl p-3 flex flex-col text-center relative">
      ${p.tag?`<span class="chip px-2 py-[1px] text-[10px] glow-star font-bold absolute top-2 right-2">${p.tag}</span>`:''}
      <div class="text-3xl">${p.emoji||'\u2b50'}</div>
      <div class="text-[13px] font-bold mt-1">${p.name}</div>
      <div class="text-[11px] text-[#8b95a4] flex-1">+${fmt(p.credit)} Stars</div>
      <button class="btn btn-star w-full py-2 mt-2 text-[12px]" onclick="topUpStars('${p.key}')">\u2b50 ${p.stars}</button>
    </div>`).join('');
}
async function topUpStars(key){
  try{
    const r=await api('/payments/invoice',{method:'POST',body:{pack:key}});
    if(r.link && TG && TG.openInvoice){
      TG.openInvoice(r.link, (status)=>{
        if(status==='paid'){
          // successful_payment is credited by the bot webhook; refresh shortly after
          setTimeout(async ()=>{ try{ await refreshMe(); renderHeader(); renderSky();
            bump(document.getElementById('starVal')); }catch(e){} toast('\u2b50 Stars added!'); }, 1600);
        } else if(status==='failed'){ toast('Payment failed'); }
        else if(status==='cancelled'){ toast('Payment cancelled'); }
      });
    } else if(r.dev){
      const d=await api('/payments/dev-credit',{method:'POST',body:{pack:key}});
      await refreshMe(); renderHeader(); renderSky(); bump(document.getElementById('starVal'));
      toast('\u2b50 +'+fmt(d.credited)+' Stars (dev)');
    } else { toast('Cannot open payment on this device'); }
  }catch(e){ toast('Payment error'); }
}
async function refreshMe(){ const me=await api('/me'); S.me=me.user; S.inventory=me.inventory; S.me.referrals=me.referrals; }

function copyRef(){ const c=document.getElementById('refCode').textContent.trim();
  navigator.clipboard&&navigator.clipboard.writeText(c).catch(()=>{}); toast('📋 Copied '+c); }

/* ---------- cave wall edit ---------- */
function editCaveWall(){
  const cur=(S.tribe?S.tribe.tribe.cave_wall:'').replace(/"/g,'');
  openModal(`<div class="nb rounded-t-3xl p-5"><div class="w-10 h-1 rounded-full bg-[#2a333f] mx-auto mb-3"></div>
    <h3 class="font-bold text-lg mb-1">Carve the Cave Wall</h3>
    <p class="text-[12px] text-[#8b95a4] mb-3">Chief &amp; Head may carve. Use the old tongue.</p>
    <textarea id="cwInput" rows="3" class="w-full bg-[#0b0e13] border border-[#242c37] rounded-xl p-3 text-[14px] carve">${cur}</textarea>
    <div class="grid grid-cols-2 gap-2 mt-3"><button class="btn btn-ghost py-2.5" onclick="closeModal()">Cancel</button>
      <button class="btn btn-ember py-2.5" onclick="saveCaveWall()">Carve it</button></div></div>`);
}
async function saveCaveWall(){
  const v=document.getElementById('cwInput').value.trim()||'Hunt as one.';
  try{ await api('/tribes/'+S.me.tribe_id+'/cavewall',{method:'PUT',body:{text:v}});
    S.tribe.tribe.cave_wall=v; document.getElementById('caveWall').textContent='“'+v+'”';
    closeModal(); toast('🪨 Cave wall carved'); }
  catch(e){ closeModal(); toast(e.message==='not_allowed'?'Only Chief/Head can carve':'Failed'); }
}
async function warCry(){
  try{ await api('/tribes/'+S.me.tribe_id+'/warcry',{method:'POST'}); toast('\ud83d\udce3 War Cry sent to all kin!'); }
  catch(e){ toast('Failed'); }
}

/* ---------- clan modal ---------- */
function openClanModal(){
  openModal(`<div class="nb rounded-t-3xl p-5"><div class="w-10 h-1 rounded-full bg-[#2a333f] mx-auto mb-3"></div>
    <h3 class="font-bold text-lg mb-3">Your Band</h3>
    <button class="nb nb-ember rounded-2xl p-4 w-full text-left mb-2" onclick="closeModal();go('tribe')">
      <div class="font-bold">🔥 Stay with your tribe</div><div class="text-[12px] text-[#8b95a4]">View the Hearth</div></button>
    <button class="nb rounded-2xl p-4 w-full text-left mb-2" onclick="closeModal();go('ranks')">
      <div class="font-bold">🤝 Join another Tribe</div><div class="text-[12px] text-[#8b95a4]">Browse the leaderboard</div></button>
    <button class="nb rounded-2xl p-4 w-full text-left" onclick="foundBand()">
      <div class="font-bold">🏕️ Found a new Band</div><div class="text-[12px] text-[#8b95a4]">Start small · stay fierce</div></button></div>`);
}
function foundBand(){
  openModal(`<div class="nb rounded-t-3xl p-5"><div class="w-10 h-1 rounded-full bg-[#2a333f] mx-auto mb-3"></div>
    <h3 class="font-bold text-lg mb-2">Found a Band</h3>
    <input id="bandName" placeholder="Tribe name" class="w-full bg-[#0b0e13] border border-[#242c37] rounded-xl p-3 text-[14px] mb-3"/>
    <div class="grid grid-cols-2 gap-2"><button class="btn btn-ghost py-2.5" onclick="closeModal()">Cancel</button>
      <button class="btn btn-ember py-2.5" onclick="createBand()">Found it</button></div></div>`);
}
async function createBand(){
  const name=document.getElementById('bandName').value.trim();
  if(!name){ toast('Name required'); return; }
  try{ const r=await api('/tribes',{method:'POST',body:{name}});
    await refreshMe(); S.tribe=await api('/tribes/'+S.me.tribe_id);
    closeModal(); renderAll(); go('tribe'); toast('🏕️ '+name+' founded! You are Chief.'); }
  catch(e){ toast(e.message==='name_taken'?'Name already taken':'Failed'); }
}

/* ---------- notifications ---------- */
async function openNotifications(){
  try{ await api('/me/notifications/read',{method:'POST'}); }catch(e){}
  S.notifs.forEach(n=>n.read=true); renderHeader();
  const items=S.notifs.length?S.notifs.map(n=>`<div class="stone p-3 mb-2">
      <div class="carve text-[14px]">${n.title}</div>
      <div class="text-[11px] text-[#8f8168] mt-1">${n.body||''}</div></div>`).join('')
    :'<div class="text-[12px] text-[#8b95a4]">No tablets yet.</div>';
  openModal(`<div class="nb rounded-t-3xl p-5"><div class="w-10 h-1 rounded-full bg-[#2a333f] mx-auto mb-3"></div>
    <h3 class="font-bold text-lg mb-1">🪨 Stone Tablets</h3>
    <p class="text-[12px] text-[#8b95a4] mb-3">Word carried from the Hearth.</p>${items}
    <button class="btn btn-ghost w-full py-2.5 mt-1" onclick="closeModal()">Close</button></div>`);
}

/* ============================================================
   BOOT
   ============================================================ */
let BOOTING=false;
async function boot(){
  if(BOOTING) return; BOOTING=true;
  hideConnError();
  document.getElementById('campfire').innerHTML=campfireSVG();
  seedEmbers(); seedStars(); go('fire');
  initTon();
  await loadConfig();
  const ok=await authenticate();
  if(!ok){ BOOTING=false; showConnError('We couldn’t reach the Hearth. Open this from Telegram, or tap Retry.'); return; }
  try{ await loadPacks(); await loadAll(); }
  catch(e){ BOOTING=false; showConnError('The Hearth is cold right now — server error. Tap Retry.'); return; }
  // wire warcry button (first btn-loyal in tribe header)
  const wc=document.querySelector('#screen-tribe .btn-loyal'); if(wc) wc.setAttribute('onclick','warCry()');
  BOOTING=false;
}

/* ---------- connection screen (replaces old demo fallback) ---------- */
function showConnError(msg){
  let o=document.getElementById('connError');
  if(!o){
    o=document.createElement('div'); o.id='connError'; o.className='conn-error';
    o.innerHTML=`<div class="conn-card">
      <div class="conn-fire">${campfireSVG()}</div>
      <h2>The fire flickers…</h2>
      <p id="connMsg"></p>
      <button class="btn btn-ember conn-retry" onclick="boot()">↻ Retry connection</button>
    </div>`;
    document.body.appendChild(o);
  }
  const m=document.getElementById('connMsg'); if(m) m.textContent=msg||'Connection lost.';
  o.classList.add('show');
}
function hideConnError(){ const o=document.getElementById('connError'); if(o) o.classList.remove('show'); }

document.addEventListener('DOMContentLoaded', boot);
