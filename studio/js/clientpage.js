// Builds a single self-contained HTML file the founder can email to a client.
// No server, no account, no upload: images are embedded, decisions are made in
// the client's own browser, and they send back one small JSON file.

import { renderCrop, loadImage, grabVideoFrame, defaultCrop } from './crop.js';
import { objectUrl } from './store.js';
import { approvedPairs } from './export.js';

const CLIENT_MAX = 1500;   // longest edge of embedded previews

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const jsonForScript = obj => JSON.stringify(obj).replace(/</g, '\\u003c');

function previewSize(surface) {
  const scale = Math.min(1, CLIENT_MAX / Math.max(surface.w, surface.h));
  return { ...surface, w: Math.round(surface.w * scale), h: Math.round(surface.h * scale) };
}

const toDataUrl = canvas => canvas.toDataURL('image/jpeg', 0.78);

export async function buildClientPage(project, assets, onProgress = () => {}) {
  const pairs = approvedPairs(assets);
  const sources = new Map();
  const items = [];
  const scratch = document.createElement('canvas');

  let n = 0;
  for (const { asset, surface, placement } of pairs) {
    onProgress(++n, pairs.length, asset.filename);
    let src = sources.get(asset.id);
    if (!src) {
      const url = await objectUrl(asset.id);
      if (!url) continue;
      src = asset.kind === 'video'
        ? await grabVideoFrame(url, 0).then(r => ({ source: r.canvas, w: r.width, h: r.height }))
        : await loadImage(url).then(img => ({ source: img, w: img.naturalWidth, h: img.naturalHeight }));
      sources.set(asset.id, src);
    }
    const crop = placement.crop || defaultCrop(src.w, src.h, surface);
    const canvas = renderCrop(src.source, src.w, src.h, crop, previewSize(surface), placement.fill || 'crop', scratch);
    items.push({
      id: `${asset.id}:${surface.id}`,
      assetId: asset.id,
      surfaceId: surface.id,
      file: asset.filename,
      kind: asset.kind,
      surface: `${surface.groupLabel} · ${surface.label}`,
      spec: `${surface.w} × ${surface.h}`,
      alt: asset.altText || '',
      note: placement.note || '',
      image: toDataUrl(canvas)
    });
  }

  scratch.width = scratch.height = 0;

  const payload = {
    schema: 'creative-review-os/client-review@1',
    project: { id: project.id, name: project.name, brand: project.brief.brand, goal: project.brief.campaignGoal },
    builtAt: new Date().toISOString(),
    items: items.map(({ image, ...rest }) => rest)
  };

  const cards = items.map(it => `
    <article class="item" data-id="${esc(it.id)}">
      <div class="shot"><img src="${it.image}" alt="${esc(it.alt || it.file)}" loading="lazy"></div>
      <div class="side">
        <p class="eyebrow">${esc(it.surface)}</p>
        <h2>${esc(it.file)}</h2>
        <p class="spec">${esc(it.spec)}${it.kind === 'video' ? ' · still from video' : ''}</p>
        ${it.note ? `<p class="prenote">Reviewer note — ${esc(it.note)}</p>` : ''}
        ${it.alt ? `<p class="alt">Alt text — ${esc(it.alt)}</p>` : ''}
        <div class="verdict">
          <button data-v="approved">Approve</button>
          <button data-v="changes">Request change</button>
        </div>
        <textarea placeholder="Anything you want changed?" rows="3"></textarea>
      </div>
    </article>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(project.name)} — review</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
<style>
:root{--ink:#0c0c0d;--paper:#f6f3ee;--line:#ddd6cb;--muted:#8a8378;--gold:#a8895f;--ok:#4f6b52;--warn:#9a6b3f}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:400 15px/1.55 Inter,-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
header{padding:64px 40px 40px;border-bottom:1px solid var(--line)}
header .mark{font:300 11px/1 Inter;letter-spacing:.32em;text-transform:uppercase;color:var(--gold)}
header h1{font:300 clamp(30px,5vw,52px)/1.06 Fraunces,Georgia,serif;margin:18px 0 10px;letter-spacing:-.02em}
header p{margin:0;color:var(--muted);max-width:62ch}
main{max-width:1180px;margin:0 auto;padding:0 40px}
.item{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,1fr);gap:44px;padding:56px 0;border-bottom:1px solid var(--line);align-items:start}
.shot{background:#0c0c0d;display:flex;align-items:center;justify-content:center;overflow:hidden}
.shot img{display:block;max-width:100%;max-height:70vh}
.eyebrow{font:400 10px/1 Inter;letter-spacing:.24em;text-transform:uppercase;color:var(--gold);margin:0 0 12px}
.side h2{font:300 20px/1.3 Fraunces,Georgia,serif;margin:0 0 6px;word-break:break-word}
.spec{margin:0 0 18px;color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}
.prenote,.alt{font-size:13px;color:var(--muted);border-left:1px solid var(--line);padding-left:12px;margin:0 0 12px}
.verdict{display:flex;gap:8px;margin:20px 0 12px}
.verdict button{flex:1;padding:11px 12px;border:1px solid var(--line);background:transparent;font:400 13px Inter;letter-spacing:.02em;cursor:pointer;transition:.15s}
.verdict button:hover{border-color:var(--ink)}
.verdict button.on[data-v=approved]{background:var(--ok);border-color:var(--ok);color:#fff}
.verdict button.on[data-v=changes]{background:var(--warn);border-color:var(--warn);color:#fff}
textarea{width:100%;padding:10px;border:1px solid var(--line);background:transparent;font:inherit;font-size:13px;resize:vertical}
textarea:focus,.verdict button:focus-visible{outline:1px solid var(--gold);outline-offset:1px}
footer{position:sticky;bottom:0;background:rgba(246,243,238,.94);backdrop-filter:blur(8px);border-top:1px solid var(--line);padding:16px 40px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}
footer .count{color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}
footer button{margin-left:auto;padding:11px 22px;background:var(--ink);color:var(--paper);border:0;font:400 13px Inter;letter-spacing:.04em;cursor:pointer}
footer button:disabled{opacity:.35;cursor:not-allowed}
.done{padding:60px 40px;color:var(--muted)}
@media(max-width:820px){.item{grid-template-columns:1fr;gap:22px;padding:38px 0}header{padding:40px 22px 28px}main{padding:0 22px}footer{padding:14px 22px}}
</style></head>
<body>
<header>
  <p class="mark">${esc(project.brief.brand || 'Creative review')}</p>
  <h1>${esc(project.name)}</h1>
  <p>${esc(project.brief.campaignGoal || 'Approve each placement, or ask for a change. Nothing you do here leaves your computer until you send the file back.')}</p>
</header>
<main>
${cards || '<p class="done">Nothing was approved for client review yet.</p>'}
</main>
<footer>
  <span class="count" id="count"></span>
  <button id="send" disabled>Download my decisions</button>
</footer>
<script type="application/json" id="payload">${jsonForScript(payload)}</script>
<script>
(function(){
  var payload = JSON.parse(document.getElementById('payload').textContent);
  var key = 'crosClient:' + payload.project.id;
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch(e) {}

  function persist(){ try { localStorage.setItem(key, JSON.stringify(saved)); } catch(e) {} }

  function refresh(){
    var total = payload.items.length;
    var done = Object.keys(saved).filter(function(k){ return saved[k] && saved[k].verdict; }).length;
    document.getElementById('count').textContent = done + ' of ' + total + ' reviewed';
    document.getElementById('send').disabled = done === 0;
  }

  document.querySelectorAll('.item').forEach(function(item){
    var id = item.dataset.id;
    var rec = saved[id] || (saved[id] = { verdict: '', note: '' });
    var ta = item.querySelector('textarea');
    ta.value = rec.note || '';
    ta.addEventListener('input', function(){ rec.note = ta.value; persist(); });
    item.querySelectorAll('.verdict button').forEach(function(b){
      if (rec.verdict === b.dataset.v) b.classList.add('on');
      b.addEventListener('click', function(){
        rec.verdict = rec.verdict === b.dataset.v ? '' : b.dataset.v;
        item.querySelectorAll('.verdict button').forEach(function(x){
          x.classList.toggle('on', x.dataset.v === rec.verdict);
        });
        persist(); refresh();
      });
    });
  });

  document.getElementById('send').addEventListener('click', function(){
    var out = {
      schema: 'creative-review-os/client-verdict@1',
      projectId: payload.project.id,
      projectName: payload.project.name,
      respondedAt: new Date().toISOString(),
      decisions: payload.items.map(function(it){
        var r = saved[it.id] || {};
        return { assetId: it.assetId, surfaceId: it.surfaceId, file: it.file,
                 surface: it.surface, verdict: r.verdict || 'no answer', note: r.note || '' };
      })
    };
    var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'client-decisions-' + (payload.project.name || 'review').replace(/[^a-z0-9]+/gi,'-').toLowerCase() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
  });

  refresh();
})();
</script>
</body></html>`;
}

/** Merge a returned client-verdict file back into the project. */
export function applyClientVerdict(json, assets) {
  if (json?.schema !== 'creative-review-os/client-verdict@1') {
    throw new Error('Not a client decision file from this tool.');
  }
  const byId = Object.fromEntries(assets.map(a => [a.id, a]));
  let applied = 0, missing = 0;
  const changed = new Set();
  for (const d of json.decisions || []) {
    const asset = byId[d.assetId];
    if (!asset || !asset.placements?.[d.surfaceId]) { missing++; continue; }
    if (!d.verdict || d.verdict === 'no answer') continue;
    const p = asset.placements[d.surfaceId];
    p.client = { verdict: d.verdict, note: d.note || '', at: json.respondedAt };
    if (d.verdict === 'changes') p.decision = 'revise';
    applied++;
    changed.add(asset);
  }
  return { applied, missing, changed: [...changed] };
}
