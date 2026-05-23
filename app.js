// Panini WC 2026 Tracker (Firebase Auth + Firestore + Fast OCR)
import { firebaseConfig } from './firebase-config.js';

// Firebase modular SDK via ESM browser modules
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// --- App version ---
const APP_VERSION = 'v1.2.0';

// --- Teams ---
const TEAMS = [
  {code:'MEX',name:'Mexico',flag:'🇲🇽',group:'A'},{code:'KOR',name:'South Korea',flag:'🇰🇷',group:'A'},{code:'RSA',name:'South Africa',flag:'🇿🇦',group:'A'},{code:'CZE',name:'Czechia',flag:'🇨🇿',group:'A'},
  {code:'CAN',name:'Canada',flag:'🇨🇦',group:'B'},{code:'SUI',name:'Switzerland',flag:'🇨🇭',group:'B'},{code:'QAT',name:'Qatar',flag:'🇶🇦',group:'B'},{code:'BIH',name:'Bosnia & Herzegovina',flag:'🇧🇦',group:'B'},
  {code:'BRA',name:'Brazil',flag:'🇧🇷',group:'C'},{code:'MAR',name:'Morocco',flag:'🇲🇦',group:'C'},{code:'SCO',name:'Scotland',flag:'🏴',group:'C'},{code:'HAI',name:'Haiti',flag:'🇭🇹',group:'C'},
  {code:'USA',name:'United States',flag:'🇺🇸',group:'D'},{code:'PAR',name:'Paraguay',flag:'🇵🇾',group:'D'},{code:'AUS',name:'Australia',flag:'🇦🇺',group:'D'},{code:'TUR',name:'Türkiye',flag:'🇹🇷',group:'D'},
  {code:'GER',name:'Germany',flag:'🇩🇪',group:'E'},{code:'ECU',name:'Ecuador',flag:'🇪🇨',group:'E'},{code:'CIV',name:"Côte d'Ivoire",flag:'🇨🇮',group:'E'},{code:'CUW',name:'Curaçao',flag:'🇨🇼',group:'E'},
  {code:'NED',name:'Netherlands',flag:'🇳🇱',group:'F'},{code:'JPN',name:'Japan',flag:'🇯🇵',group:'F'},{code:'TUN',name:'Tunisia',flag:'🇹🇳',group:'F'},{code:'SWE',name:'Sweden',flag:'🇸🇪',group:'F'},
  {code:'BEL',name:'Belgium',flag:'🇧🇪',group:'G'},{code:'IRN',name:'Iran',flag:'🇮🇷',group:'G'},{code:'EGY',name:'Egypt',flag:'🇪🇬',group:'G'},{code:'NZL',name:'New Zealand',flag:'🇳🇿',group:'G'},
  {code:'ESP',name:'Spain',flag:'🇪🇸',group:'H'},{code:'URU',name:'Uruguay',flag:'🇺🇾',group:'H'},{code:'KSA',name:'Saudi Arabia',flag:'🇸🇦',group:'H'},{code:'CPV',name:'Cape Verde',flag:'🇨🇻',group:'H'},
  {code:'FRA',name:'France',flag:'🇫🇷',group:'I'},{code:'SEN',name:'Senegal',flag:'🇸🇳',group:'I'},{code:'NOR',name:'Norway',flag:'🇳🇴',group:'I'},{code:'IRQ',name:'Iraq',flag:'🇮🇶',group:'I'},
  {code:'ARG',name:'Argentina',flag:'🇦🇷',group:'J'},{code:'ALG',name:'Algeria',flag:'🇩🇿',group:'J'},{code:'AUT',name:'Austria',flag:'🇦🇹',group:'J'},{code:'JOR',name:'Jordan',flag:'🇯🇴',group:'J'},
  {code:'POR',name:'Portugal',flag:'🇵🇹',group:'K'},{code:'COL',name:'Colombia',flag:'🇨🇴',group:'K'},{code:'UZB',name:'Uzbekistan',flag:'🇺🇿',group:'K'},{code:'COD',name:'DR Congo',flag:'🇨🇩',group:'K'},
  {code:'ENG',name:'England',flag:'🏴',group:'L'},{code:'CRO',name:'Croatia',flag:'🇭🇷',group:'L'},{code:'GHA',name:'Ghana',flag:'🇬🇭',group:'L'},{code:'PAN',name:'Panama',flag:'🇵🇦',group:'L'},
  {code:'FWC',name:'Special / Intro / Museum',flag:'🏆',group:'S'}
];
const TEAM_BY_CODE = Object.fromEntries(TEAMS.map(t=>[t.code,t]));
const VALID_CODES = new Set(TEAMS.map(t=>t.code));
const VALID_LIST = TEAMS.map(t=>t.code);
const TOTAL_STICKERS = 980;

// --- Firebase init ---
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

// --- PWA install + SW ---
let deferredPrompt=null;
window.addEventListener('beforeinstallprompt',(e)=>{e.preventDefault();deferredPrompt=e;document.getElementById('installBanner').classList.add('show');});
window.promptInstall = async function(){
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt=null;
  document.getElementById('installBanner').classList.remove('show');
};
if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{})); }

// --- App state ---
let collection = {}; // key -> count
let currentUser = null;
let cloudSaving = false;
let cloudSaveTimer = null;

// OCR engine state
let selectedCode=null;
let currentDetailCode=null;
let cameraStream=null;
let cropMode='tight';
let worker=null;
let workerReady=false;
let ocrBusy=false;
let autoOn=true;
let stableHits=0;
let lastKey=null;
let rafId=null;
let scanning=false;
let scanEveryMs=900; // slower but stable
let lastScanTs=0;
let prevSig=null;
let scanTick=0;

function nowISO(){ return new Date().toISOString(); }

function updateAppVersion(){
  const el = document.getElementById('appVersion');
  if(el) el.textContent = APP_VERSION;
}

// Local cache (for offline)
function loadLocalCache(){
  try{
    const raw = localStorage.getItem('panini_local_cache') || '{}';
    const obj = JSON.parse(raw);
    return obj && typeof obj==='object' ? obj : {};
  }catch(e){ return {}; }
}
function saveLocalCache(){
  const payload = { updatedAt: nowISO(), collection };
  localStorage.setItem('panini_local_cache', JSON.stringify(payload));
}

function setCloudStatus(msg){
  const el = document.getElementById('cloudStatus');
  if(el) el.textContent = msg;
}

// --- Auth overlay helpers ---
function showAuth(show){
  document.getElementById('authOverlay').classList.toggle('show', !!show);
}
function setAuthError(msg){
  document.getElementById('authError').textContent = msg || '';
}

window.authLogin = async function(){
  setAuthError('');
  const email = (document.getElementById('authEmail').value||'').trim();
  const password = document.getElementById('authPassword').value||'';
  try{ await signInWithEmailAndPassword(auth, email, password); }
  catch(e){ setAuthError(e.message || String(e)); }
};

window.authSignup = async function(){
  setAuthError('');
  const email = (document.getElementById('authEmail').value||'').trim();
  const password = document.getElementById('authPassword').value||'';
  try{ await createUserWithEmailAndPassword(auth, email, password); }
  catch(e){ setAuthError(e.message || String(e)); }
};

window.authResetPassword = async function(){
  setAuthError('');
  const email = (document.getElementById('authEmail').value||'').trim();
  if(!email){ setAuthError('Enter your email first.'); return; }
  try{ await sendPasswordResetEmail(auth, email); setAuthError('Password reset email sent.'); }
  catch(e){ setAuthError(e.message || String(e)); }
};

async function doLogout(){ await signOut(auth); }

function updateUserPill(){
  const pill = document.getElementById('userPill');
  if(!currentUser){ pill.style.display='none'; pill.innerHTML=''; return; }
  pill.style.display='inline-flex';
  const email = currentUser.email || 'user';
  pill.innerHTML = `✅ ${email} <button id="logoutBtn">Logout</button>`;
  document.getElementById('logoutBtn').onclick = ()=>doLogout();
}

// --- Cloud I/O ---
async function loadFromCloud(uid){
  setCloudStatus('Cloud: loading…');
  try{
    const ref = doc(db, 'users', uid);
    const snap = await getDoc(ref);
    if(snap.exists()){
      const data = snap.data();
      if(data && data.collection && typeof data.collection==='object') collection = data.collection;
    } else {
      await setDoc(ref, { collection: {}, updatedAt: nowISO() }, { merge: true });
      collection = {};
    }
    saveLocalCache();
    setCloudStatus('Cloud: synced');
  } catch(e){
    const local = loadLocalCache();
    if(local.collection) collection = local.collection;
    setCloudStatus('Cloud: failed (using local cache)');
  }
}

function scheduleSaveToCloud(){
  saveLocalCache();
  if(!currentUser) return;
  if(cloudSaveTimer) clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(()=>saveToCloud(), 1200);
}

async function saveToCloud(){
  if(!currentUser || cloudSaving) return;
  cloudSaving = true;
  setCloudStatus('Cloud: saving…');
  try{
    const ref = doc(db, 'users', currentUser.uid);
    await setDoc(ref, { collection, updatedAt: nowISO() }, { merge: true });
    setCloudStatus('Cloud: synced');
  } catch(e){
    setCloudStatus('Cloud: save failed (will retry)');
  } finally {
    cloudSaving = false;
  }
}

onAuthStateChanged(auth, async (user)=>{
  currentUser = user || null;
  updateUserPill();
  if(!currentUser){
    showAuth(true);
    setCloudStatus('Cloud: not connected');
    const local = loadLocalCache();
    if(local.collection) collection = local.collection;
    initUI();
    return;
  }
  showAuth(false);
  await loadFromCloud(currentUser.uid);
  initUI();
});

// --- UI wiring ---
window.switchTab = function(pageId, tabEl){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
  tabEl.classList.add('active');
  if(pageId==='pageScan') startCamera(); else stopCamera();
  if(pageId==='pageCollection') renderCollection();
  if(pageId==='pageStats') renderStats();
};

// --- Export / Import ---
function csvEsc(v){
  const s = String(v ?? '');
  return (s.includes(',')||s.includes('"')||s.includes('
')) ? '"'+s.replace(/"/g,'""')+'"' : s;
}
function downloadBlob(content, filename, type){
  const blob=new Blob([content],{type});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=filename;
  a.click();
}

window.exportCollectionJSON = function(){
  const payload = { updatedAt: nowISO(), uid: currentUser?.uid || null, collection };
  downloadBlob(JSON.stringify(payload, null, 2), 'panini_wc2026_collection.json', 'application/json');
};
window.exportMissingTXT = function(){
  let lines=['PANINI WC 2026 — MISSING LIST','Generated: '+new Date().toLocaleString(),''];
  TEAMS.forEach(t=>{
    const missing=[];
    for(let i=1;i<=20;i++) if(!(collection[t.code+'-'+i])) missing.push(i);
    if(missing.length) lines.push(`${t.flag} ${t.name} (${t.code}): `+missing.map(n=>t.code+n).join(', '));
  });
  const totalOwned = TEAMS.reduce((s,t)=>s+getTeamOwned(t.code),0);
  lines.push('',`Total missing: ${TOTAL_STICKERS-totalOwned} / ${TOTAL_STICKERS}`);
  downloadBlob(lines.join('
'), 'panini_wc2026_missing.txt', 'text/plain');
};
window.exportCollectionCSV = function(){
  const rows=[['code','number','team','count','duplicates']];
  for(const t of TEAMS){
    for(let i=1;i<=20;i++){
      const key=t.code+'-'+i;
      const count=collection[key]||0;
      if(count>0) rows.push([t.code,i,t.name,count,Math.max(0,count-1)]);
    }
  }
  const csv = rows.map(r=>r.map(csvEsc).join(',')).join('
');
  downloadBlob(csv, 'panini_wc2026_collection.csv', 'text/csv');
};
window.exportMissingCSV = function(){
  const rows=[['code','number','team','status']];
  for(const t of TEAMS){
    for(let i=1;i<=20;i++){
      const key=t.code+'-'+i;
      if(!(collection[key])) rows.push([t.code,i,t.name,'missing']);
    }
  }
  const csv = rows.map(r=>r.map(csvEsc).join(',')).join('
');
  downloadBlob(csv, 'panini_wc2026_missing.csv', 'text/csv');
};
window.importCollection = function(event){
  const file=event.target.files[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=(e)=>{
    try{
      const data=JSON.parse(e.target.result);
      if(data && typeof data==='object'){
        collection = data.collection ? data.collection : data;
        scheduleSaveToCloud();
        initUI();
        alert('✅ Imported!');
      }
    } catch(err){ alert('❌ Invalid JSON'); }
  };
  reader.readAsText(file);
  event.target.value='';
};
window.resetCollection = function(){
  if(!confirm('⚠️ Delete your entire collection?')) return;
  if(!confirm('⚠️ Really sure? This cannot be undone.')) return;
  collection={};
  scheduleSaveToCloud();
  initUI();
};

// --- Header progress ---
function getTeamOwned(code){ let c=0; for(let i=1;i<=20;i++) if((collection[code+'-'+i]||0)>0) c++; return c; }
function getTeamDuplicates(code){ let d=0; for(let i=1;i<=20;i++){ const c=(collection[code+'-'+i]||0); if(c>1) d += (c-1); } return d; }
function updateHeader(){
  const totalOwned = TEAMS.reduce((s,t)=>s+getTeamOwned(t.code),0);
  const pct=Math.round(totalOwned/TOTAL_STICKERS*100);
  document.getElementById('headerProgress').style.width=pct+'%';
  document.getElementById('headerProgressText').textContent=`${totalOwned} / ${TOTAL_STICKERS} stickers (${pct}%)`;
}

// --- Manual entry ---
const countrySearch=document.getElementById('countrySearch');
const countryList=document.getElementById('countryList');
countrySearch.addEventListener('input', function(){
  const q=this.value.toLowerCase();
  if(!q){ countryList.classList.remove('show'); return; }
  const matches=TEAMS.filter(t=>t.name.toLowerCase().includes(q)||t.code.toLowerCase().includes(q));
  if(!matches.length){ countryList.classList.remove('show'); return; }
  countryList.innerHTML=matches.map(t=>
    `<div class="country-item" onclick="selectTeam('${t.code}')">${t.flag} <span>${t.name}</span> <span class="code">${t.code}</span></div>`
  ).join('');
  countryList.classList.add('show');
});
countrySearch.addEventListener('focus', function(){ if(this.value) this.dispatchEvent(new Event('input')); });
document.addEventListener('click', function(e){ if(!e.target.closest('.manual')) countryList.classList.remove('show'); });

window.selectTeam = function(code){
  selectedCode=code;
  const team=TEAM_BY_CODE[code];
  countrySearch.value=team.flag+' '+team.name+' ('+team.code+')';
  countryList.classList.remove('show');
  const st=document.getElementById('selectedTeam');
  st.textContent=team.flag+' '+team.name+' — tap a number';
  st.classList.add('show');
  updateNumberGrid();
};

function updateNumberGrid(){
  const grid=document.getElementById('numberGrid');
  if(!selectedCode){
    grid.innerHTML='<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:20px;font-size:13px;font-weight:1000">Select a team first ↑</div>';
    return;
  }
  let html='';
  for(let i=1;i<=20;i++){
    const key=selectedCode+'-'+i;
    const owned=(collection[key]||0)>0;
    html += `<div class="num-btn ${owned?'owned':''}" onclick="addSticker('${selectedCode}',${i})">${i}</div>`;
  }
  grid.innerHTML=html;
}

// --- Add/remove sticker ---
window.addSticker = function(code,num){
  const key=code+'-'+num;
  collection[key]=(collection[key]||0)+1;
  scheduleSaveToCloud();
  showFeedback(code,num,(collection[key]===1),collection[key]);
  updateNumberGrid();
  updateHeader();
};
function removeSticker(code,num){
  const key=code+'-'+num;
  if(collection[key]){ collection[key]--; if(collection[key]<=0) delete collection[key]; scheduleSaveToCloud(); }
}

function showFeedback(code,num,isNew,count){
  const team=TEAM_BY_CODE[code];
  const overlay=document.getElementById('feedbackOverlay');
  const card=document.getElementById('feedbackCard');
  const emoji=document.getElementById('feedbackEmoji');
  const title=document.getElementById('feedbackTitle');
  const sub=document.getElementById('feedbackSub');
  card.className='feedback-card '+(isNew?'new-card':'dup-card');
  emoji.textContent=isNew?'🆕':'⚠️';
  title.textContent=isNew?'NEW STICKER!':('DUPLICATE (x'+count+')');
  title.style.color=isNew?'var(--green)':'var(--orange)';
  sub.textContent=(team?team.flag+' '+team.name:code)+' #'+num;
  overlay.classList.add('show');
  setTimeout(()=>overlay.classList.remove('show'), 1200);
}

// --- Collection page ---
function renderCollection(filter){
  const filterBar=document.getElementById('filterBar');
  const groups=['All','A','B','C','D','E','F','G','H','I','J','K','L','S'];
  filterBar.innerHTML = groups.map(g=>
    `<div class="filter-btn ${(!filter && g==='All')||(filter===g)?'active':''}" onclick="renderCollection('${g==='All'?'':g}')">${g==='S'?'🏆 Special':(g==='All'?'All':'Group '+g)}</div>`
  ).join('');

  const grid=document.getElementById('teamGrid');
  const filtered=filter?TEAMS.filter(t=>t.group===filter):TEAMS;
  grid.innerHTML = filtered.map(t=>{
    const owned=getTeamOwned(t.code);
    const pct=Math.round(owned/20*100);
    const complete=owned===20;
    const color=complete?'var(--green)':pct>50?'var(--blue)':pct>0?'var(--orange)':'#e0e0e0';
    return `<div class="team-card ${complete?'complete':''}" onclick="openDetail('${t.code}')">
      <div class="team-top">
        <div class="team-flag">${t.flag}</div>
        <div style="flex:1">
          <div class="team-name">${t.name}</div>
          <div class="team-code">${t.code} · ${t.group==='S'?'Special':'Group '+t.group}</div>
        </div>
      </div>
      <div class="team-progress">
        <div class="team-progress-bar"><div class="team-progress-fill" style="width:${pct}%;background:${color}"></div></div>
        <div class="team-progress-text">${owned}/20 ${complete?'✓':''}</div>
      </div>
    </div>`;
  }).join('');
}
window.renderCollection = renderCollection;

// --- Detail modal ---
window.openDetail = function(code){
  currentDetailCode=code;
  const team=TEAM_BY_CODE[code];
  document.getElementById('detailFlag').textContent=team.flag;
  document.getElementById('detailName').textContent=team.name;
  document.getElementById('detailGroup').textContent=team.group==='S'?'Special Stickers':('Group '+team.group+' · '+team.code);
  renderDetailStickers();
  document.getElementById('detailModal').classList.add('show');
};
window.closeDetail = function(){
  document.getElementById('detailModal').classList.remove('show');
  currentDetailCode=null;
  renderCollection();
};
function renderDetailStickers(){
  const code=currentDetailCode; if(!code) return;
  const owned=getTeamOwned(code);
  const missing=20-owned;
  const dups=getTeamDuplicates(code);
  const pct=Math.round(owned/20*100);
  document.getElementById('detailOwned').textContent=owned;
  document.getElementById('detailMissing').textContent=missing;
  document.getElementById('detailDups').textContent=dups;
  document.getElementById('detailProgressFill').style.width=pct+'%';
  const grid=document.getElementById('detailStickerGrid');
  let html='';
  for(let i=1;i<=20;i++){
    const key=code+'-'+i;
    const c=(collection[key]||0);
    const owned=(c>0);
    html += `<div class="sticker-cell ${owned?'owned':'missing'}" onclick="toggleDetailSticker('${code}',${i})">
      <div class="sticker-num">${i}</div>
      ${c>1?`<div class="sticker-dup">x${c}</div>`:''}
      <div style="font-size:9px;margin-top:2px;font-weight:1100">${owned?'✓':'—'}</div>
    </div>`;
  }
  grid.innerHTML=html;
}
window.toggleDetailSticker = function(code,num){
  const key=code+'-'+num;
  if((collection[key]||0)>0) removeSticker(code,num); else window.addSticker(code,num);
  renderDetailStickers();
  updateHeader();
};

// --- Stats ---
function renderStats(){
  let totalOwned=0, totalDups=0, teamsComplete=0;
  TEAMS.forEach(t=>{
    const owned=getTeamOwned(t.code);
    if(owned===20) teamsComplete++;
    totalOwned += owned;
    totalDups += getTeamDuplicates(t.code);
  });
  const pct=Math.round(totalOwned/TOTAL_STICKERS*100);
  document.getElementById('statPercent').innerHTML = pct + '<span>%</span>';
  document.getElementById('statOwned').textContent=totalOwned;
  document.getElementById('statMissing').textContent=TOTAL_STICKERS-totalOwned;
  document.getElementById('statDuplicates').textContent=totalDups;
  document.getElementById('statTeamsComplete').textContent=teamsComplete;
  document.getElementById('statProgressFill').style.width=pct+'%';
  document.getElementById('completionBanner').classList.toggle('show', totalOwned===TOTAL_STICKERS);
}
window.renderStats = renderStats;

// --- OCR scanning ---
window.updateStability = function(){
  const n = parseInt(document.getElementById('stability').value,10);
  document.getElementById('stabilityLabel').textContent = n + ' hits';
  document.getElementById('autoHint').textContent = 'stabilize ' + n + ' hits';
};
window.updateStability();
window.setCropMode = function(v){ cropMode=v; document.getElementById('cropLabel').textContent = v[0].toUpperCase()+v.slice(1); };

async function initWorker(){
  if(workerReady) return;
  worker = await Tesseract.createWorker('eng');
  await worker.setParameters({
    tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    tessedit_pageseg_mode:'6',
    load_system_dawg:'0',
    load_freq_dawg:'0'
  });
  workerReady=true;
}

async function startCamera(){
  if(cameraStream) return;
  const status=document.getElementById('scanStatus');
  try{
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:'environment', width:{ideal:1280}, height:{ideal:960} }, audio:false });
    document.getElementById('cameraFeed').srcObject = cameraStream;
    status.textContent='Loading OCR… (first time only)';
    await initWorker();
    status.textContent='Ready. Keep the code inside the gold box.';
    setTimeout(()=>startAutoLoop(), 800);
  }catch(e){
    status.textContent='⚠️ Camera not available. Use HTTPS and allow camera permission.';
  }
}
function stopCamera(){
  stopAutoLoop();
  if(cameraStream){ cameraStream.getTracks().forEach(t=>t.stop()); cameraStream=null; }
  const v=document.getElementById('cameraFeed'); if(v) v.srcObject=null;
}

window.toggleTorch = async function(){
  const sw=document.getElementById('torchSwitch');
  if(!cameraStream) return;
  const track=cameraStream.getVideoTracks()[0];
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  if(!caps.torch){ document.getElementById('torchHint').textContent='not supported'; return; }
  const turningOn=!sw.classList.contains('on');
  try{
    await track.applyConstraints({advanced:[{torch: turningOn}]});
    sw.classList.toggle('on', turningOn);
    document.getElementById('torchState').textContent=turningOn?'ON':'OFF';
  }catch(e){ document.getElementById('torchHint').textContent='failed'; }
};

window.toggleAuto = function(){
  autoOn=!autoOn;
  document.getElementById('autoSwitch').classList.toggle('on', autoOn);
  document.getElementById('autoState').textContent=autoOn?'ON':'OFF';
  if(autoOn){ stableHits=0; lastKey=null; startAutoLoop(); }
  else { stopAutoLoop(); document.getElementById('scanStatus').textContent='Auto-scan OFF. Use manual entry.'; }
};

function computeCrop(vw,vh){
  let x0,y0,w,h;
  if(cropMode==='tight'){ x0=Math.floor(vw*0.62); y0=Math.floor(vh*0.02); w=Math.floor(vw*0.34); h=Math.floor(vh*0.22); }
  else if(cropMode==='normal'){ x0=Math.floor(vw*0.55); y0=0; w=Math.floor(vw*0.42); h=Math.floor(vh*0.28); }
  else { x0=Math.floor(vw*0.45); y0=0; w=Math.floor(vw*0.55); h=Math.floor(vh*0.36); }
  return {x0,y0,w,h};
}

function downsampleSignature(ctx,w,h){
  const tw=18, th=10;
  const img=ctx.getImageData(0,0,w,h).data;
  let sig=new Array(tw*th);
  for(let yy=0; yy<th; yy++){
    for(let xx=0; xx<tw; xx++){
      const sx=Math.floor((xx+0.5)*w/tw);
      const sy=Math.floor((yy+0.5)*h/th);
      const idx=(sy*w+sx)*4;
      sig[yy*tw+xx]=0.299*img[idx]+0.587*img[idx+1]+0.114*img[idx+2];
    }
  }
  return sig;
}
function diffSig(a,b){ if(!a||!b) return 999; let s=0; for(let i=0;i<a.length;i++) s+=Math.abs(a[i]-b[i]); return s/a.length; }

function preprocessBinary(ctx,w,h){
  const img=ctx.getImageData(0,0,w,h);
  const d=img.data;
  const contrast=1.45;
  const thresh=140;
  for(let i=0;i<d.length;i+=4){
    let v=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
    v=(v-128)*contrast+128;
    v=v>thresh?255:0;
    d[i]=d[i+1]=d[i+2]=v;
  }
  ctx.putImageData(img,0,0);
}

function bestCodeGuess(code){
  if(VALID_CODES.has(code)) return code;
  const swaps={ 'O':['S','Q','D'], 'S':['O','5'], 'B':['8'], 'I':['1','L'], 'Z':['2'], 'G':['C'], 'C':['G','O'], 'U':['V'], 'V':['U'] };
  const cand=new Set([code]);
  for(let i=0;i<3;i++){ const ch=code[i]; for(const a of (swaps[ch]||[])) cand.add(code.slice(0,i)+a+code.slice(i+1)); }
  for(const c of cand){ if(VALID_CODES.has(c)) return c; }
  let best=code, bestScore=999;
  for(const v of VALID_LIST){ let score=0; for(let i=0;i<3;i++) if(code[i]!==v[i]) score++; if(score<bestScore){bestScore=score; best=v;} if(bestScore===1) break; }
  return bestScore<=1?best:code;
}

function extractCandidate(text){
  const cleaned = (text||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const m = cleaned.match(/([A-Z]{3})(\d{1,2})/);
  if(!m) return null;
  const code = bestCodeGuess(m[1]);
  const num = parseInt(m[2],10);
  if(!(num>=1 && num<=20)) return null;
  return {code,num,raw:cleaned};
}

async function ocrCrop(){
  if(!workerReady || ocrBusy) return null;
  const video=document.getElementById('cameraFeed');
  if(!video || !video.videoWidth) return null;

  const vw=video.videoWidth, vh=video.videoHeight;
  const canvas=document.getElementById('scanCanvas');
  canvas.width=vw; canvas.height=vh;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(video,0,0);

  const {x0,y0,w,h}=computeCrop(vw,vh);
  const cropCanvas=document.getElementById('cropCanvas');
  const targetW=520;
  const scale=targetW/w;
  cropCanvas.width=targetW;
  cropCanvas.height=Math.max(140, Math.floor(h*scale));
  const cctx=cropCanvas.getContext('2d',{willReadFrequently:true});
  cctx.imageSmoothingEnabled=true;
  cctx.drawImage(canvas,x0,y0,w,h,0,0,cropCanvas.width,cropCanvas.height);

  const sig=downsampleSignature(cctx,cropCanvas.width,cropCanvas.height);
  const motion=diffSig(sig, prevSig);
  prevSig=sig;
  if(motion>25) return {skipped:true,motion};

  preprocessBinary(cctx,cropCanvas.width,cropCanvas.height);

  ocrBusy=true;
  try{
    const res=await worker.recognize(cropCanvas);
    const txt=res.data?.text||'';
    const conf=typeof res.data?.confidence==='number'?res.data.confidence:0;
    return {text:txt,confidence:conf};
  } finally { ocrBusy=false; }
}

function startAutoLoop(){
  if(!autoOn || scanning) return;
  scanning=true;
  stableHits=0; lastKey=null; lastScanTs=0;
  const status=document.getElementById('scanStatus');
  const debug=document.getElementById('debugLine');

  const loop=async (ts)=>{
    if(!scanning) return;
    if(ts-lastScanTs<scanEveryMs){ rafId=requestAnimationFrame(loop); return; }
    lastScanTs=ts;

    if(document.getElementById('confirmModal').classList.contains('show') ||
       document.getElementById('feedbackOverlay').classList.contains('show') ||
       document.getElementById('authOverlay').classList.contains('show') ||
       cloudSaving){ rafId=requestAnimationFrame(loop); return; }

    try{
      scanTick++;
      if(scanTick % 2 === 1){ rafId=requestAnimationFrame(loop); return; }
      const out=await ocrCrop();
      if(out?.skipped){
        status.textContent='Hold steady… (motion detected)';
        debug.textContent='';
        stableHits=0; lastKey=null;
      } else if(out?.text){
        const cand=extractCandidate(out.text);
        debug.textContent='OCR: '+(cand?cand.raw.slice(0,18):out.text.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,18))+' · '+Math.round(out.confidence)+'%';
        if(cand){
          const key=cand.code+'-'+cand.num;
          status.textContent=`Detected: ${cand.code} ${cand.num} (stabilizing…)`;
          if(key===lastKey) stableHits++; else {stableHits=1; lastKey=key;}
          const need=parseInt(document.getElementById('stability').value,10);
          if(stableHits>=need){ stableHits=0; lastKey=null; showConfirm(cand.code,cand.num,out.confidence); }
        } else {
          status.textContent='Searching… keep code inside gold box.';
          stableHits=0; lastKey=null;
        }
      }
    } catch(e){ status.textContent='OCR busy…'; }

    rafId=requestAnimationFrame(loop);
  };
  rafId=requestAnimationFrame(loop);
}
function stopAutoLoop(){ scanning=false; if(rafId) cancelAnimationFrame(rafId); rafId=null; }

function showConfirm(code,num,confidence){
  const modal=document.getElementById('confirmModal');
  const sel=document.getElementById('confirmCountry');
  sel.innerHTML=TEAMS.map(t=>`<option value="${t.code}" ${t.code===code?'selected':''}>${t.flag} ${t.code}</option>`).join('');
  document.getElementById('confirmNumber').value=num;
  document.getElementById('confirmDetected').textContent=code+' '+num;
  document.getElementById('confirmConfidence').textContent='OCR confidence: '+Math.round(confidence||0)+'%';
  modal.classList.add('show');
}
window.closeConfirm = function(){ document.getElementById('confirmModal').classList.remove('show'); };
window.confirmSticker = function(){
  const code=document.getElementById('confirmCountry').value;
  const num=parseInt(document.getElementById('confirmNumber').value,10);
  if(code && num>=1 && num<=20){ window.addSticker(code,num); window.closeConfirm(); }
};

function initUI(){
  updateAppVersion();
  document.getElementById('confirmCountry').innerHTML = TEAMS.map(t=>`<option value="${t.code}">${t.flag} ${t.code}</option>`).join('');
  updateHeader();
  renderCollection();
  updateNumberGrid();
  renderStats();
  if(currentUser) startCamera(); else stopCamera();
}

(function bootstrap(){
  const local = loadLocalCache();
  if(local.collection) collection = local.collection;
  initUI();
})();
