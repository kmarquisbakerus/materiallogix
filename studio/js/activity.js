const STORE = 'mlx:activity:v2';
const rail = document.getElementById('activityRail');
const terminal = new Set(['complete', 'failed', 'cancelled']);
let jobs = read();

function read() { try { const v = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
function status(value) { const s = String(value || 'queued').toLowerCase(); return ['ready','completed','succeeded','success'].includes(s) ? 'complete' : ['error','failure'].includes(s) ? 'failed' : s; }
function progress(s, value) { if (Number.isFinite(value)) return Math.max(0, Math.min(100, Number(value))); return ({ queued:8, submitting:16, uploading:28, processing:54, generating:62, upscaling:66, downloading:88, complete:100, failed:100, cancelled:100 })[s] ?? 28; }
function persist() { jobs = jobs.sort((a,b) => new Date(b.updatedAt)-new Date(a.updatedAt)).slice(0,48); try { localStorage.setItem(STORE, JSON.stringify(jobs)); } catch {} paint(); }
function start(data={}) { const now = new Date().toISOString(); const id = String(data.id || crypto.randomUUID()); const old = jobs.find(j => j.id === id); const s = status(data.status); const next = { id, title:String(data.title || data.kind || 'Render job'), kind:String(data.kind || 'render'), location:data.location === 'cloud' ? 'cloud' : 'local', provider:String(data.provider || ''), credits:Number(data.credits || 0), units:Number(data.units || 0), status:s, progress:progress(s,data.progress), detail:String(data.detail || ''), createdAt:old?.createdAt || now, updatedAt:now }; old ? Object.assign(old,next) : jobs.unshift(next); persist(); return id; }
function update(id, patch={}) { const job=jobs.find(j=>j.id===String(id)); if(!job) return start({id,...patch}); if(patch.status) patch.status=status(patch.status); Object.assign(job,patch,{updatedAt:new Date().toISOString()}); job.progress=progress(job.status,patch.progress ?? job.progress); if(terminal.has(job.status)) job.progress=100; persist(); return job.id; }
function node(tag, cls='', value) { const n=document.createElement(tag); n.className=cls; if(value!==undefined) n.textContent=String(value); return n; }
function monthlyUsage() { const key='cros:usage:'+new Date().toISOString().slice(0,7); try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } }
function paint() {
  if(!rail) return;
  const active=jobs.filter(j=>!terminal.has(j.status)); const usage=monthlyUsage();
  const head=node('div','activity-head'); head.append(node('h2','','Jobs & usage'),node('span','spacer')); const clear=node('button','btn sm','Clear finished'); clear.type='button'; clear.onclick=()=>{jobs=jobs.filter(j=>!terminal.has(j.status));persist();}; head.append(clear);
  const summary=node('div','activity-summary');
  for(const [label,value] of [['Running',active.length],['Local',active.filter(j=>j.location==='local').length],['Cloud',active.filter(j=>j.location==='cloud').length],['Units this month',usage.exports || 0]]) { const box=node('div'); box.append(node('span','',label),node('b','',value)); summary.append(box); }
  const list=document.createDocumentFragment();
  if(!jobs.length) list.append(node('div','activity-empty','Nothing is running. Photo, video, and voice work will appear here automatically.'));
  for(const job of jobs) { const item=node('article',`activity-job ${job.status}`); const row=node('div','row'); row.append(node('i','activity-dot'),node('strong','',job.title),node('span','kind',job.location)); const meta=[job.provider,job.status,job.credits?`${job.credits} credits`:'',job.units?`${job.units} units`:'',job.detail].filter(Boolean).join(' · '); const bar=node('div','activity-progress'); const fill=node('i'); fill.style.width=`${progress(job.status,job.progress)}%`; bar.append(fill); item.append(row,node('p','',meta || job.kind),bar); list.append(item); }
  rail.replaceChildren(head,summary,list);
}
function urlOf(input){ return typeof input==='string'?input:input instanceof URL?input.href:input?.url||''; }
const originalFetch=window.fetch.bind(window);
window.fetch=async function trackedFetch(input,init={}) { const url=urlOf(input), method=String(init.method || (input instanceof Request?input.method:'GET')).toUpperCase(); let id='',category='';
  if(method==='POST' && /\/prompt(?:\?|$)/.test(url)) category='comfy';
  else if(method==='POST' && /:8189\/(upscale|tts|video\/)/.test(url)){category='bridge'; const title=url.includes('/tts')?'Voice render':url.includes('/video/')?'Video job':'Photo upscale'; id=start({title,location:'local',status:'processing',detail:'Your computer'});}
  else if(method==='POST' && /\/v1\/render\/submit/.test(url)) category='cloud';
  try { const response=await originalFetch(input,init), clone=response.clone();
    if(category==='comfy'&&response.ok) clone.json().then(d=>d?.prompt_id&&start({id:d.prompt_id,title:'Photo generation',location:'local',status:'generating',detail:'ComfyUI'})).catch(()=>{});
    if(category==='bridge') update(id,response.ok?{status:'complete',detail:'Returned to project'}:{status:'failed',detail:`Engine error ${response.status}`});
    if(category==='cloud') clone.json().then(d=>d?.id&&start({id:d.id,title:`${d.model||'Cloud'} render`,location:'cloud',provider:d.provider,credits:d.credits,units:d.units,status:d.status||'processing'})).catch(()=>{});
    const history=url.match(/\/history\/([^/?#]+)/); if(method==='GET'&&history&&response.ok) clone.json().then(d=>{const jid=decodeURIComponent(history[1]),entry=d?.[jid]; if(entry?.status?.status_str==='error')update(jid,{status:'failed'}); else if(entry&&Object.values(entry.outputs||{}).some(o=>o?.images?.length))update(jid,{status:'complete',detail:'Added to project'}); else update(jid,{status:'generating'});}).catch(()=>{});
    return response;
  } catch(error) { if(id) update(id,{status:'failed',detail:error?.message||'Request failed'}); throw error; }
};
window.MaterialLogixActivity={start,update,jobs:()=>[...jobs]};
window.addEventListener('materiallogix:job',e=>{const d=e.detail||{}; d.id&&jobs.some(j=>j.id===d.id)?update(d.id,d):start(d);});
paint();
