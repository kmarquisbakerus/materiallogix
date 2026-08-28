const STORE = 'mlx:activity:v2';
const rail = document.getElementById('activityRail');
const terminal = new Set(['complete', 'failed', 'cancelled']);
let jobs = read();

if (rail) {
  const toggle = document.querySelector('.activity-toggle') || node('button', 'btn sm activity-toggle', 'Jobs');
  toggle.type = 'button'; toggle.setAttribute('aria-controls', rail.id); toggle.setAttribute('aria-expanded', 'false');
  rail.classList.toggle('dock-left', localStorage.getItem('mlx:jobs-dock') === 'left');
  const overlay = () => matchMedia('(max-width: 1280px)').matches;
  const close = () => { rail.classList.remove('open'); rail.classList.add('closed'); toggle.setAttribute('aria-expanded', 'false'); };
  toggle.onclick = () => {
    const open = rail.classList.contains('closed') || (overlay() && !rail.classList.contains('open'));
    rail.classList.toggle('closed', !open);
    rail.classList.toggle('open', open && overlay());
    toggle.setAttribute('aria-expanded', String(open));
  };
  if (!toggle.isConnected) document.querySelector('header.topbar .spacer')?.after(toggle);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
}

function read() { try { const v = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
function status(value) { const s = String(value || 'queued').toLowerCase(); return ['ready','completed','succeeded','success'].includes(s) ? 'complete' : ['error','failure'].includes(s) ? 'failed' : s === 'canceled' ? 'cancelled' : s; }
function progress(s, value) { if (Number.isFinite(value)) return Math.max(0, Math.min(100, Number(value))); return ({ queued:8, submitting:16, uploading:28, processing:54, generating:62, upscaling:66, downloading:88, complete:100, failed:100, cancelled:100 })[s] ?? 28; }
function persist() { jobs = jobs.sort((a,b) => new Date(b.updatedAt)-new Date(a.updatedAt)).slice(0,48); try { localStorage.setItem(STORE, JSON.stringify(jobs)); } catch {} paint(); }
function start(data={}) { const now = new Date().toISOString(); const id = String(data.id || crypto.randomUUID()); const old = jobs.find(j => j.id === id); const s = status(data.status); const next = { id, title:String(data.title || data.kind || 'Render job'), kind:String(data.kind || 'render'), location:data.location === 'cloud' ? 'cloud' : 'local', provider:String(data.provider || ''), credits:Number(data.credits || 0), units:Number(data.units || 0), cancellable:Boolean(data.cancellable ?? old?.cancellable), status:s, progress:progress(s,data.progress), detail:String(data.detail || ''), createdAt:old?.createdAt || now, updatedAt:now }; old ? Object.assign(old,next) : jobs.unshift(next); persist(); return id; }
function update(id, patch={}) { const job=jobs.find(j=>j.id===String(id)); if(!job) return start({id,...patch}); if(patch.status) patch.status=status(patch.status); Object.assign(job,patch,{updatedAt:new Date().toISOString()}); job.progress=progress(job.status,patch.progress ?? job.progress); if(terminal.has(job.status)) job.progress=100; persist(); return job.id; }
function node(tag, cls='', value) { const n=document.createElement(tag); n.className=cls; if(value!==undefined) n.textContent=String(value); return n; }
function monthlyUsage() { const key='cros:usage:'+new Date().toISOString().slice(0,7); try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } }
function paint() {
  if(!rail) return;
  const active=jobs.filter(j=>!terminal.has(j.status)); const usage=monthlyUsage();
  const head=node('div','activity-head'); head.append(node('h2','','Jobs'),node('span','spacer')); const move=node('button','btn sm activity-move',rail.classList.contains('dock-left')?'Move right':'Move left'); move.type='button'; move.onclick=()=>{const left=rail.classList.toggle('dock-left');localStorage.setItem('mlx:jobs-dock',left?'left':'right');paint();}; const close=node('button','btn sm activity-close','Close'); close.type='button'; close.onclick=()=>{rail.classList.remove('open');rail.classList.add('closed');document.querySelector('.activity-toggle')?.setAttribute('aria-expanded','false');}; const clear=node('button','btn sm','Clear finished'); clear.type='button'; clear.onclick=()=>{jobs=jobs.filter(j=>!terminal.has(j.status));persist();}; head.append(move,close,clear);
  const summary=node('div','activity-summary');
  for(const [label,value] of [['Running',active.length],['Local',active.filter(j=>j.location==='local').length],['Cloud',active.filter(j=>j.location==='cloud').length]]) { const box=node('div'); box.append(node('span','',label),node('b','',value)); summary.append(box); }
  const list=node('div','activity-list');
  if(!jobs.length) list.append(node('div','activity-empty','No active jobs. Photo, video, and voice operations appear here automatically with execution location, progress, and usage.'));
  for(const job of jobs) { const item=node('article',`activity-job ${job.status}`); const row=node('div','row'); row.append(node('i','activity-dot'),node('strong','',job.title),node('span','kind',job.location)); if(job.cancellable&&!terminal.has(job.status)){const cancel=node('button','btn sm job-cancel','Stop');cancel.type='button';cancel.setAttribute('aria-label',`Stop ${job.title}`);cancel.onclick=()=>{cancel.disabled=true;update(job.id,{status:'processing',detail:'Stopping safely…'});window.dispatchEvent(new CustomEvent('materiallogix:cancel-job',{detail:{id:job.id}}));};row.append(cancel);} const meta=[job.provider,job.status,job.credits?`${job.credits} credits`:'',job.units?`${job.units} units`:'',job.detail].filter(Boolean).join(' · '); const bar=node('div','activity-progress'); const fill=node('i'); fill.style.width=`${progress(job.status,job.progress)}%`; bar.append(fill); item.append(row,node('p','',meta || job.kind),bar); list.append(item); }
  const usagePanel=node('details','activity-usage');
  usagePanel.append(node('summary','','Usage this month'));
  const usageBody=node('div','activity-usage-body');
  const usageGrid=node('div','activity-summary');
  for(const [label,value] of [['Clean exports',usage.exports || 0],['Bonus units',usage.bonus || 0]]) { const box=node('div'); box.append(node('span','',label),node('b','',value)); usageGrid.append(box); }
  const usageLink=node('a','btn sm','Open usage & wallet'); usageLink.href='usage.html';
  usageBody.append(usageGrid,node('p','activity-usage-note','Account-verified cloud usage, credits, wallet refills, and automatic top-up controls are on the Usage page.'),usageLink);
  usagePanel.append(usageBody);
  rail.replaceChildren(head,summary,list,usagePanel);
}
function urlOf(input){ return typeof input==='string'?input:input instanceof URL?input.href:input?.url||''; }
function headerOf(input,init,name){try{return new Headers(init.headers||(input instanceof Request?input.headers:undefined)).get(name)||'';}catch{return '';}}
const originalFetch=typeof window.fetch==='function'?window.fetch.bind(window):null;
if(originalFetch) window.fetch=async function trackedFetch(input,init={}) { const url=urlOf(input), method=String(init.method || (input instanceof Request?input.method:'GET')).toUpperCase(); let id='',category='';
  if(method==='POST' && /\/prompt(?:\?|$)/.test(url)) category='comfy';
  else if(method==='POST' && /:8189\/(upscale|tts|video\/)/.test(url) && !/\/video\/cancel(?:\?|$)/.test(url)){category='bridge'; const title=url.includes('/tts')?'Voice render':url.includes('/video/')?'Video job':'Photo upscale'; const suppliedId=headerOf(input,init,'X-MaterialLogix-Job-Id'); id=start({id:suppliedId||undefined,title,location:'local',status:'processing',detail:'Your computer',cancellable:Boolean(suppliedId&&url.includes('/video/'))});}
  else if(method==='POST' && /\/v1\/render\/submit/.test(url)) category='cloud';
  try { const response=await originalFetch(input,init), clone=response.clone();
    if(category==='comfy'&&response.ok) clone.json().then(d=>d?.prompt_id&&start({id:d.prompt_id,title:'Photo generation',location:'local',status:'generating',detail:'ComfyUI'})).catch(()=>{});
    if(category==='bridge') update(id,response.ok?{status:'complete',detail:'Returned to project'}:{status:'failed',detail:`Engine error ${response.status}`});
    if(category==='cloud') clone.json().then(d=>d?.id&&start({id:d.id,title:`${d.model||'Cloud'} render`,location:'cloud',provider:d.provider,credits:d.credits,units:d.units,status:d.status||'processing'})).catch(()=>{});
    const history=url.match(/\/history\/([^/?#]+)/); if(method==='GET'&&history&&response.ok) clone.json().then(d=>{const jid=decodeURIComponent(history[1]),entry=d?.[jid]; if(entry?.status?.status_str==='error')update(jid,{status:'failed'}); else if(entry&&Object.values(entry.outputs||{}).some(o=>o?.images?.length))update(jid,{status:'complete',detail:'Added to project'}); else update(jid,{status:'generating'});}).catch(()=>{});
    return response;
  } catch(error) { if(id) update(id,{status:error?.name==='AbortError'?'cancelled':'failed',detail:error?.name==='AbortError'?'Stopped locally':error?.message||'Request failed'}); throw error; }
};
window.MaterialLogixActivity={start,update,jobs:()=>[...jobs]};
window.addEventListener('materiallogix:job',e=>{const d=e.detail||{}; d.id&&jobs.some(j=>j.id===d.id)?update(d.id,d):start(d);});
paint();
window.addEventListener('materiallogix:cancel-ready',()=>jobs.filter(job=>job.cancellable&&job.location==='local'&&!terminal.has(job.status)).forEach(job=>window.dispatchEvent(new CustomEvent('materiallogix:cancel-job',{detail:{id:job.id,recovery:true}}))));
