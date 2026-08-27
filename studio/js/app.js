import {
  SURFACE_GROUPS, SURFACE_BY_ID, ASSET_STATUSES, STATUS_BY_ID,
  ASSET_ROLES, QA_CHECKS, QA_BY_ID, QA_PRESETS, PRESET_BY_ID, FIX_PRESETS, SURFACE_PRESETS, REJECTION_REASONS,
  newProject, newAsset, newPlacement
} from './model.js';
import * as store from './store.js';
import {
  defaultCrop, clampCrop, zoomCrop, panCrop, snapToRatio, renderCrop, loadImage, grabVideoFrame
} from './crop.js';
import {
  analyzeAsset, assetIssues, placementIssues, preflight, smartCrop, captureCoverage, captureCoverageBody
} from './analyze.js';
import { buildPackage, decisionsMarkdown, approvedPairs, slug } from './export.js';
import { buildClientPage, applyClientVerdict } from './clientpage.js';
import { snapshot, snapshotProject, popUndo, log, logMarkdown } from './history.js';
import { downloadBlob, makeZip, readStoreZip } from './zip.js';
import { activeLicense, activate, deactivate, covers } from './license.js';
import { detectComfy, listCheckpoints, generateOne, listUpscaleModels, upscaleOne, detectBridge, upscaleViaBridge } from './generate.js';
import { probeDevice, deviceSummary } from './device.js';
import { analyzeGeometry } from './geometry.js';

const $ = sel => document.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : String(k));
  return n;
};

const state = {
  projects: [], project: null, assets: [],
  mode: 'review',
  index: 0,
  activeSurface: null,
  view: 'placement',          // 'placement' | 'source' | 'compare'
  compareWith: null,
  loupe: false,
  loupeZoom: 1,
  filters: { status: '', role: '', kind: '', surface: '', issues: '', rating: 0, q: '' },
  reviewer: localStorage.getItem('cros:reviewer') || 'reviewer',
  decoded: new Map(),         // assetId -> { source, w, h, url }
  busy: false
};

// ---------------------------------------------------------------------------
// small helpers

function toast(msg, bad = false) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = el('div', { className: 'toast' + (bad ? ' bad' : ''), textContent: msg, role: 'status' });
  t.setAttribute('aria-live', bad ? 'assertive' : 'polite');
  document.body.append(t);
  setTimeout(() => t.remove(), bad ? 7000 : 2600);
}

/** Wraps long jobs so the tab-close guard and the cursor both know. */
async function busy(fn) {
  state.busy = true;
  document.body.style.cursor = 'progress';
  try { return await fn(); }
  finally { state.busy = false; document.body.style.cursor = ''; }
}

function dialog(title, body, buttons) {
  $('#dlgTitle').textContent = title;
  $('#dlgBody').replaceChildren(body);
  $('#dlgFoot').replaceChildren(...buttons.filter(Boolean));
  const d = $('#dlg');
  if (!d.open) d.showModal();
  return d;
}
const closeDialog = () => { const d = $('#dlg'); d.close(); d.classList.remove('feedback-popover'); };
const btn = (label, cls = 'btn', onclick) => {
  const b = el('button', { className: cls, type: 'button' }, label);
  if (onclick) b.onclick = onclick;
  return b;
};
/** Names a control whose visible label is a glyph. */
const aria = (node, label) => { node.setAttribute('aria-label', label); node.title = label; return node; };

let saveTimer = null;
function touchAsset(asset) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.saveAsset(asset), 220);
}
function touchProject() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.saveProject(state.project), 220);
}

/** Every state change to an asset goes through here: undo + audit for free. */
function mutate(asset, label, fn) {
  snapshot(asset, label);
  fn();
  log(asset, label, state.reviewer);
  touchAsset(asset);
}

const activeSurfaces = () => (state.project?.surfaces || []).map(id => SURFACE_BY_ID[id]).filter(Boolean);

function ensurePlacement(asset, surfaceId) {
  if (!asset.placements[surfaceId]) {
    const p = newPlacement();
    const s = SURFACE_BY_ID[surfaceId];
    if (s && asset.width && asset.height) p.crop = defaultCrop(asset.width, asset.height, s);
    asset.placements[surfaceId] = p;
  }
  return asset.placements[surfaceId];
}

function issueCount(asset) {
  if (!asset.auto) return { block: 0, warn: 0 };
  let block = 0, warn = 0;
  const bump = list => { for (const i of list) { if (i.level === 'block') block++; else if (i.level === 'warn') warn++; } };
  bump(assetIssues(asset, state.assets, state.project));
  for (const sid of Object.keys(asset.placements || {})) {
    if (asset.placements[sid].decision === 'pending') continue;
    bump(placementIssues(asset, sid, state.project));
  }
  return { block, warn };
}

function visibleAssets() {
  const f = state.filters;
  return state.assets.filter(a => {
    if (f.status && a.status !== f.status) return false;
    if (f.role && a.role !== f.role) return false;
    if (f.kind && a.kind !== f.kind) return false;
    if (f.surface && a.placements?.[f.surface]?.decision !== 'approved') return false;
    if (f.rating && (a.rating || 0) < f.rating) return false;
    if (f.issues) {
      const c = issueCount(a);
      if (f.issues === 'block' && !c.block) return false;
      if (f.issues === 'any' && !c.block && !c.warn) return false;
      if (f.issues === 'clean' && (c.block || c.warn)) return false;
    }
    if (f.q) {
      const hay = `${a.filename} ${a.notes} ${a.altText} ${a.labels.campaign} ${a.labels.audience} ${a.labels.lane}`.toLowerCase();
      if (!hay.includes(f.q.toLowerCase())) return false;
    }
    return true;
  });
}

const currentAsset = () => visibleAssets()[state.index] || null;

function qaChecksForAsset(asset) {
  const presetId = asset.kind === 'video' ? 'video' : state.project.qaPreset;
  const ids = PRESET_BY_ID[presetId]?.checks || QA_CHECKS.map(c => c.id);
  return QA_CHECKS.filter(c => ids.includes(c.id));
}

// ---------------------------------------------------------------------------
// decode + analysis

const DECODE_CACHE = 5;

async function decode(asset) {
  const hit = state.decoded.get(asset.id);
  if (hit) return hit;
  const url = await store.objectUrl(asset.id);
  if (!url) return null;
  let d;
  try {
    if (asset.kind === 'video') {
      // Frame zero is usually a fade-in or a black slate, which makes every
      // measurement meaningless. Default the poster to 30% in, then let the
      // reviewer scrub it.
      let t = asset.video.posterTime;
      let frame = await grabVideoFrame(url, t ?? 0);
      if (t == null) {
        t = frame.duration > 1 ? +(frame.duration * 0.3).toFixed(2) : 0;
        if (t > 0) frame = await grabVideoFrame(url, t);
        asset.video.posterTime = t;
        await store.saveAsset(asset);
      }
      d = { source: frame.canvas, w: frame.width, h: frame.height, url, duration: frame.duration };
    } else {
      const img = await loadImage(url);
      d = { source: img, w: img.naturalWidth, h: img.naturalHeight, url };
    }
  } catch {
    return null;
  }
  if (!asset.width && d.w) {
    asset.width = d.w; asset.height = d.h;
    if (d.duration) asset.duration = d.duration;
    await store.saveAsset(asset);
  }
  state.decoded.set(asset.id, d);
  if (state.decoded.size > DECODE_CACHE) state.decoded.delete(state.decoded.keys().next().value);
  return d;
}

async function runAnalysis(asset, { quiet = false } = {}) {
  const d = await decode(asset);
  if (!d) { if (!quiet) toast(`Could not decode ${asset.filename}.`, true); return null; }
  const blob = await store.getBlob(asset.id);
  asset.auto = await analyzeAsset(d.source, d.w, d.h, blob);
  if (asset.kind === 'video' && (d.duration || asset.duration) > 0) {
    const duration = d.duration || asset.duration;
    const url = await store.objectUrl(asset.id);
    const count = Math.min(9, Math.max(5, Math.ceil(duration / 4)));
    const samples = [];
    for (let i = 0; i < count; i++) {
      const time = duration * ((i + 0.5) / count);
      const frame = await grabVideoFrame(url, time);
      const result = await analyzeAsset(frame.canvas, frame.width, frame.height, null);
      samples.push({
        time: +time.toFixed(2), hash: result.hash, sharpness: result.sharpness,
        blown: result.exposure.blown, crushed: result.exposure.crushed,
        meanLuma: result.exposure.meanLuma
      });
    }
    asset.temporal = {
      version: 1,
      sampledAt: new Date().toISOString(),
      duration: +duration.toFixed(2),
      samples,
      sharpnessMin: Math.min(...samples.map(s => s.sharpness)),
      blownMax: Math.max(...samples.map(s => s.blown)),
      crushedMax: Math.max(...samples.map(s => s.crushed)),
      lumaRange: Math.max(...samples.map(s => s.meanLuma)) - Math.min(...samples.map(s => s.meanLuma))
    };
  }
  // Geometry is the one networked extra (MediaPipe from CDN). Null offline.
  asset.geometry = await analyzeGeometry(d.source, d.w, d.h);
  await store.saveAsset(asset);
  return asset.auto;
}

async function analyzeAll() {
  const pending = state.assets.filter(a => !a.auto);
  if (!pending.length) return toast('Every asset has already been analysed.');
  const bar = el('i');
  const status = el('p', {}, `Analysing ${pending.length} asset(s)…`);
  dialog('Automated checks', el('div', {}, status, el('div', { className: 'progress' }, bar)),
    [btn('Close', 'btn', closeDialog)]);
  await busy(async () => {
    let n = 0;
    for (const a of pending) {
      status.textContent = `Analysing ${++n} / ${pending.length} — ${a.filename}`;
      bar.style.width = `${(n / pending.length) * 100}%`;
      await runAnalysis(a, { quiet: true });
    }
  });
  status.textContent = `Done. ${pending.length} asset(s) analysed.`;
  render();
}

// ---------------------------------------------------------------------------
// import

async function probe(file, url) {
  try {
    if (file.type.startsWith('video')) {
      const { width, height, duration } = await grabVideoFrame(url, 0);
      return { width, height, duration };
    }
    const img = await loadImage(url);
    return { width: img.naturalWidth, height: img.naturalHeight, duration: 0 };
  } catch {
    return { width: 0, height: 0, duration: 0 };
  }
}

async function importFiles(fileList) {
  const files = [...fileList].filter(f => /^(image|video)\//.test(f.type));
  if (!files.length) return toast('No images or video in that drop.', true);

  const bar = el('i');
  const status = el('p', {}, `Importing ${files.length} file(s)…`);
  dialog('Import', el('div', {}, status, el('div', { className: 'progress' }, bar)), [btn('Close', 'btn', closeDialog)]);

  await busy(async () => {
    let n = 0;
    for (const file of files) {
      status.textContent = `Importing ${++n} / ${files.length} — ${file.name}`;
      bar.style.width = `${(n / files.length) * 100}%`;
      const asset = newAsset(state.project.id, file);
      await store.addAsset(asset, file);
      const url = await store.objectUrl(asset.id);
      Object.assign(asset, await probe(file, url));
      log(asset, `imported (${file.type || 'unknown type'}, ${(file.size / 1048576).toFixed(1)} MB)`, state.reviewer);
      await store.saveAsset(asset);
      state.assets.push(asset);
      await runAnalysis(asset, { quiet: true });
    }
  });
  state.assets = await store.listAssets(state.project.id);
  closeDialog();
  render();
  toast(`Imported and analysed ${files.length} file(s).`);
}

// ---------------------------------------------------------------------------
// sidebar

function panel(title, open, ...body) {
  return el('details', { className: 'panel', open },
    el('summary', {}, title), el('div', { className: 'panel-body' }, ...body));
}

function briefField(key, label, multiline = false) {
  const input = multiline
    ? el('textarea', { value: state.project.brief[key] || '' })
    : el('input', { type: 'text', value: state.project.brief[key] || '' });
  input.oninput = () => { state.project.brief[key] = input.value; touchProject(); };
  return el('label', { className: 'field' }, el('span', {}, label), input);
}

// --- generation panel: local GPU now, BYO key and managed tiers later ------

let comfyStatus = null;   // cached detection result for this session

function generatePanel() {
  const wrap = el('div', {});

  // Tier 0 - this device (phone or laptop browser). Staged rollout.
  const device = el('div', { style: 'margin-bottom:16px' });
  wrap.append(el('h4', { className: 'eyebrow', style: 'margin:0 0 8px' }, 'This device'), device);
  probeDevice().then(d => {
    const lines = [el('p', { className: 'hint' }, deviceSummary(d))];
    if (d.verdict === 'draft-capable') {
      lines.push(el('p', { className: 'hint' },
        'This device can run draft-quality generation in stages \u2014 slower, and it saves progress between slices so you can come back later. That light mode ships next; until then, the fast lane below uses a computer you own.'));
    } else if (d.verdict === 'weak-gpu') {
      lines.push(el('p', { className: 'hint' },
        'WebGPU is here but the memory budget is too small for generation without killing the tab. Use a computer you own as the engine below \u2014 this screen still does the full review job.'));
    } else {
      lines.push(el('p', { className: 'hint' },
        'This browser cannot generate on-device. Reviewing, cropping, and approving all work here; point the engine below at a computer you own for generation.'));
    }
    device.replaceChildren(...lines);
  });

  // Tier 1 - a GPU you own (this computer, or one on your Wi-Fi).
  const local = el('div', { style: 'margin-bottom:16px' });
  wrap.append(el('h4', { className: 'eyebrow', style: 'margin:0 0 8px' }, 'Your computer\u2019s GPU \u2014 free'), local);

  const renderLocal = async (force = false) => {
    const savedBase = localStorage.getItem('cros:comfyBase') || `http://${location.hostname}:8188`;
    if (!comfyStatus || force) {
      local.replaceChildren(el('p', { className: 'hint' }, 'Looking for the generation engine\u2026'));
      comfyStatus = await detectComfy(savedBase);
    }
    if (!comfyStatus.ok) {
      const baseInput = el('input', { type: 'text', value: savedBase, placeholder: 'http://127.0.0.1:8188' });
      baseInput.onchange = () => localStorage.setItem('cros:comfyBase', baseInput.value.trim() || 'http://127.0.0.1:8188');
      local.replaceChildren(
        el('p', { className: 'hint' },
          'No generation engine answered. ComfyUI is the free, open-source engine that runs on a GPU you own \u2014 nothing is billed.'),
        el('p', { className: 'hint' },
          'On this computer: install it from comfy.org, start it, press Retry. From a phone: put your computer\u2019s Wi-Fi address here (e.g. http://192.168.1.20:8188) and start ComfyUI with --listen --enable-cors-header \u2014 the phone becomes a remote control for that GPU.'),
        el('label', { className: 'field' }, el('span', {}, 'Engine address'), baseInput),
        btn('Retry detection', 'btn sm', () => renderLocal(true)));
      return;
    }
    let ckpts = [];
    try { ckpts = await listCheckpoints(comfyStatus.base); } catch { /* handled below */ }
    const head = el('p', { className: 'hint' },
      `Connected \u2014 ${comfyStatus.device}${comfyStatus.vramGB ? ` (${comfyStatus.vramGB} GB VRAM)` : ''}.`);
    if (!ckpts.length) {
      local.replaceChildren(head,
        el('p', { className: 'hint' }, 'No model checkpoints installed yet. Put one in ComfyUI\u2019s models/checkpoints folder and Retry.'),
        btn('Retry', 'btn sm', () => renderLocal(true)));
      return;
    }
    const ckptSel = el('select', {});
    for (const c of ckpts) ckptSel.append(el('option', { value: c }, c));
    const promptBox = el('textarea', { placeholder: 'What to generate. Wording from the brief helps.', rows: 3 });
    const negBox = el('input', { type: 'text', placeholder: 'Avoid (optional)', value: state.project.brief.mustAvoid || '' });
    const sizeSel = el('select', {});
    for (const [v, label] of [['1024x1024', 'Square 1024'], ['832x1216', 'Portrait 832\u00d71216'], ['1216x832', 'Wide 1216\u00d7832']]) {
      sizeSel.append(el('option', { value: v }, label));
    }
    const countSel = el('select', {});
    for (const n of [1, 2, 4]) countSel.append(el('option', { value: String(n) }, `${n} image${n > 1 ? 's' : ''}`));
    const status = el('p', { className: 'hint', style: 'margin:8px 0 0' }, '');
    const go = btn('Generate on this GPU', 'btn primary', async () => {
      const [w, h] = sizeSel.value.split('x').map(Number);
      const count = Number(countSel.value);
      go.disabled = true;
      try {
        await busy(async () => {
          for (let i = 0; i < count; i++) {
            status.textContent = `Image ${i + 1} of ${count} \u2014 queued\u2026`;
            const { blob, seed } = await generateOne({
              ckpt: ckptSel.value,
              prompt: promptBox.value,
              negative: negBox.value,
              width: w, height: h
            }, phase => { status.textContent = `Image ${i + 1} of ${count} \u2014 ${phase}\u2026`; }, comfyStatus.base);
            const file = new File([blob], `gen_${seed}_${i + 1}.png`, { type: 'image/png' });
            const asset = newAsset(state.project.id, file);
            asset.source = 'generated-local';
            asset.provenance = `AI-generated locally (ComfyUI, ${ckptSel.value}, seed ${seed}). Prompt: ${promptBox.value.slice(0, 300)}`;
            await store.addAsset(asset, file);
            const url = await store.objectUrl(asset.id);
            Object.assign(asset, await probe(file, url));
            log(asset, 'generated on local GPU', state.reviewer);
            await store.saveAsset(asset);
            state.assets.push(asset);
            await runAnalysis(asset, { quiet: true });
          }
        });
        state.assets = await store.listAssets(state.project.id);
        status.textContent = `Done \u2014 ${count} candidate(s) added to the library, provenance recorded.`;
        render();
        toast(`Generated ${count} candidate(s) on the local GPU.`);
      } catch (err) {
        status.textContent = 'Failed: ' + err.message;
      } finally {
        go.disabled = false;
      }
    });
    local.replaceChildren(head,
      el('label', { className: 'field' }, el('span', {}, 'Model'), ckptSel),
      el('label', { className: 'field' }, el('span', {}, 'Prompt'), promptBox),
      el('label', { className: 'field' }, el('span', {}, 'Avoid'), negBox),
      el('div', { style: 'display:flex;gap:8px' },
        el('label', { className: 'field', style: 'flex:1' }, el('span', {}, 'Size'), sizeSel),
        el('label', { className: 'field', style: 'flex:1' }, el('span', {}, 'Count'), countSel)),
      go, status);
  };
  renderLocal();

  // Cloud credentials never belong in browser storage.
  wrap.append(el('h4', { className: 'eyebrow', style: 'margin:16px 0 8px' }, 'Cloud workflow'));
  wrap.append(el('p', { className: 'hint', style: 'margin-bottom:0' },
    'Cloud workflow stays unavailable until the account service can verify the user, entitlement, prepaid balance, and exact packaged job. Provider keys are accepted only by that server and are never entered or stored here.'));

  return wrap;
}

/** Pull the bundled demo assets so a first-run stranger has something real
 *  to judge in ninety seconds. Files come from /samples on the server. */
async function loadDemo() {
  const names = ['upscale-qa.png'];
  const files = [];
  for (const n of names) {
    try {
      const r = await fetch('samples/' + n);
      if (!r.ok) continue;
      const b = await r.blob();
      files.push(new File([b], n, { type: b.type || 'image/png' }));
    } catch { /* skip */ }
  }
  if (!files.length) return toast('The product-made QA proof could not be loaded.', true);
  if (!state.project.brief.campaignGoal) {
    state.project.brief.brand = state.project.brief.brand || 'Demo';
    state.project.brief.campaignGoal = 'Demo \u2014 app launch, paid social and web hero';
    await store.saveProject(state.project);
  }
  await importFiles(files);
}

function renderSidebar() {
  const p = state.project;
  const bar = $('#sidebar');
  if (!p) return bar.replaceChildren();

  const addBtn = btn('Add files', 'btn', () => $('#fileInput').click());
  const analyzeBtn = btn('Run checks on all', 'btn sm', analyzeAll);
  const storageLine = el('p', { className: 'hint', style: 'margin-top:4px' }, 'Checking storage…');
  store.usage().then(u => {
    if (!u || !u.quota) { storageLine.textContent = 'Browser storage use is not reportable here.'; return; }
    const pct = u.used / u.quota;
    storageLine.textContent =
      `${(u.used / 1073741824).toFixed(2)} GB of ${(u.quota / 1073741824).toFixed(1)} GB browser storage used (${Math.round(pct * 100)}%).`;
    if (pct > 0.8) {
      storageLine.style.color = 'var(--warn)';
      storageLine.textContent += ' Back up and prune before importing more — the browser evicts without warning.';
    }
  });

  const demoBtn = btn('Load demo assets', 'btn sm', loadDemo);
  const library = panel('Library', true,
    el('div', { style: 'display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap' }, addBtn, analyzeBtn, demoBtn),
    el('div', { className: 'dropzone' }, 'or drop images and video anywhere'),
    el('p', { className: 'hint', style: 'margin-top:12px;margin-bottom:0' },
      `${state.assets.length} asset(s) · ${state.assets.filter(a => a.auto).length} analysed`),
    storageLine
  );

  const brief = panel('Brand brief', false,
    briefField('brand', 'Brand'),
    briefField('campaignGoal', 'Campaign goal'),
    briefField('audience', 'Audience'),
    briefField('tone', 'Tone'),
    briefField('mustHave', 'Must have', true),
    briefField('mustAvoid', 'Must avoid', true),
    briefField('brandRules', 'Brand rules — include #hex colours', true),
    briefField('rejectedStyles', 'Rejected styles (memory)', true),
    brandOverlayControls()
  );

  const surfBody = SURFACE_GROUPS.map(g => el('div', { className: 'surface-group' },
    el('h4', {}, g.label),
    ...g.surfaces.map(s => {
      const cb = el('input', { type: 'checkbox', checked: p.surfaces.includes(s.id) });
      cb.onchange = () => {
        snapshotProject(p, 'surface list');
        p.surfaces = cb.checked ? [...p.surfaces, s.id] : p.surfaces.filter(x => x !== s.id);
        if (!p.surfaces.includes(state.activeSurface)) state.activeSurface = p.surfaces[0] || null;
        store.saveProject(p).then(render);
      };
      return el('label', { className: 'surface-row' }, cb, s.label, el('span', { className: 'dim' }, `${s.w}×${s.h}`));
    })));
  const surfaces = panel(`Surfaces · ${p.surfaces.length}`, false,
    el('p', { className: 'hint' }, 'Each surface carries its own approval, its own crop, and its own safe zones.'),
    ...surfBody);

  const presetSel = el('select', {});
  for (const pr of QA_PRESETS) presetSel.append(el('option', { value: pr.id, selected: pr.id === p.qaPreset }, `${pr.label} · ${pr.checks.length} checks`));
  presetSel.onchange = () => { p.qaPreset = presetSel.value; store.saveProject(p).then(render); };
  const qa = panel('QA checklist', false,
    el('p', { className: 'hint' }, 'Video always uses the video preset regardless of this setting.'),
    el('label', { className: 'field' }, el('span', {}, 'Preset'), presetSel),
    el('p', { className: 'hint' }, (PRESET_BY_ID[p.qaPreset]?.checks || []).map(id => QA_BY_ID[id]?.label).join(' · ')));

  const providers = panel('Generate', false, generatePanel());

  const who = el('input', { type: 'text', value: state.reviewer });
  who.oninput = () => { state.reviewer = who.value || 'reviewer'; localStorage.setItem('cros:reviewer', state.reviewer); };

  const licBox = el('div', { style: 'margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--hair-soft)' });
  activeLicense().then(lic => {
    if (lic) {
      licBox.append(
        el('p', { className: 'hint', style: 'margin-bottom:6px' },
          lic.plan === 'lite'
            ? `Licensed \u2014 lite (${lic.email}). ${liteRemaining(lic)} of 20 export units left this month.`
            : `Licensed \u2014 ${lic.plan} (${lic.email}). Clean exports unlocked.`),
        btn('Deactivate on this device', 'btn sm', () => { deactivate(); render(); }));
    } else {
      const input = el('input', { type: 'text', placeholder: 'ML1.\u2026 license key' });
      const msg = el('p', { className: 'hint', style: 'margin:6px 0 0' },
        'Free plan: proof exports and previews. A key from the pricing page unlocks clean exports.');
      licBox.append(input, el('div', { style: 'height:6px' }),
        btn('Activate', 'btn sm', async () => {
          const lic = await activate(input.value);
          if (lic) { toast(`Licensed: ${lic.plan}.`); render(); }
          else msg.textContent = 'That key did not verify \u2014 check for missing characters.';
        }), msg);
    }
  });

  const deliver = panel('Deliver', false,
    licBox,
    el('p', { className: 'hint' }, 'Everything below is generated locally. Nothing is uploaded.'),
    btn('Proof package (watermarked)', 'btn', () => doExport({ proof: true })),
    el('div', { style: 'height:14px' }),
    (() => {
      const box = el('div', {});
      box.append(el('p', { className: 'hint', style: 'margin-bottom:6px' }, 'Your phone (no app store needed):'));
      const line = el('p', { className: 'hint', style: 'font-family:var(--mono);font-size:11px' }, 'looking for the bridge…');
      box.append(line);
      detectBridge().then(b => {
        if (b.ok && b.lan?.length) {
          // First address is the real Wi-Fi interface; the rest are virtual adapters.
          line.textContent = `http://${b.lan[0]}:${location.port || 80}/`;
          box.append(el('p', { className: 'hint' },
            'Open that address in the phone’s browser on this Wi-Fi, then Add to Home Screen — it installs like an app and renders on this computer. Serve with run.ps1 -Lan.'));
        } else {
          line.textContent = 'Start the bridge (python engine.py) to see this computer’s Wi-Fi address.';
        }
      });
      return box;
    })(),
    el('div', { style: 'height:6px' }),
    btn('Client review page', 'btn', exportClientPage),
    el('div', { style: 'height:6px' }),
    btn('Import client decisions', 'btn', () => $('#verdictInput').click()),
    el('div', { style: 'height:6px' }),
    btn('Contact sheet (PNG)', 'btn', exportContactSheet),
    el('div', { style: 'height:6px' }),
    btn('Decision summary', 'btn', showSummary),
    el('div', { style: 'height:14px' }),
    el('label', { className: 'field' }, el('span', {}, 'Reviewer name (audit trail)'), who));

  const backup = panel('Project', false,
    el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
      btn('Rename', 'btn sm', renameProject),
      btn('Save recovery file', 'btn sm', backupProject),
      btn('Restore file', 'btn sm', () => $('#recoveryInput').click()),
      btn('Delete', 'btn sm', deleteProjectFlow)),
    el('p', { className: 'hint', style: 'margin-top:12px' },
      `Created ${new Date(p.createdAt).toLocaleDateString()}. Changes auto-save locally. A recovery file includes the project, decisions, and original media.`));

  bar.replaceChildren(brief, library, surfaces, qa, providers, deliver, backup);
}

function renameProject() {
  const input = el('input', { type: 'text', value: state.project.name });
  dialog('Rename project', el('label', { className: 'field' }, el('span', {}, 'Name'), input), [
    btn('Cancel', 'btn', closeDialog),
    btn('Save', 'btn primary', () => {
      state.project.name = input.value.trim() || state.project.name;
      store.saveProject(state.project).then(() => { closeDialog(); boot(state.project.id); });
    })
  ]);
}

function deleteProjectFlow() {
  dialog('Delete project',
    el('p', {}, `Delete "${state.project.name}" and its ${state.assets.length} asset(s)? Back up first — this cannot be undone.`),
    [btn('Cancel', 'btn', closeDialog),
     btn('Delete', 'btn primary', async () => {
       await store.deleteProject(state.project.id);
       closeDialog(); boot();
     })]);
}

async function backupProject() {
  const cleanProject = {
    ...state.project,
    providers: Object.fromEntries(Object.entries(state.project.providers || {})
      .map(([id, v]) => [id, { enabled: !!v.enabled }]))   // keys never leave the browser
  };
  const manifest = JSON.stringify({
    schema: 'materiallogix/recovery@2',
    exportedAt: new Date().toISOString(),
    project: cleanProject,
    assets: state.assets
  }, null, 2);
  const entries = [{ name: 'project.json', data: manifest }];
  await busy(async () => {
    for (const asset of state.assets) {
      const blob = await store.getBlob(asset.id);
      if (blob) entries.push({ name: `media/${asset.id}`, data: new Uint8Array(await blob.arrayBuffer()) });
    }
  });
  downloadBlob(makeZip(entries), `${slug(state.project.name)}-recovery.zip`);
  toast(`Recovery file saved with ${entries.length - 1} media file(s).`);
}

async function restoreProject(file) {
  try {
    const entries = await readStoreZip(file);
    const raw = entries.get('project.json');
    if (!raw) throw new Error('project.json is missing.');
    const backup = JSON.parse(new TextDecoder().decode(raw));
    if (backup.schema !== 'materiallogix/recovery@2' || !backup.project || !Array.isArray(backup.assets)) {
      throw new Error('This is not a MaterialLogix recovery file.');
    }
    const projectId = crypto.randomUUID();
    const idMap = new Map(backup.assets.map(a => [a.id, crypto.randomUUID()]));
    const project = { ...backup.project, id: projectId, name: `${backup.project.name} (recovered)`, providers: {} };
    if (project.brandOverlay?.assetId) project.brandOverlay.assetId = idMap.get(project.brandOverlay.assetId) || '';
    await busy(async () => {
      await store.saveProject(project);
      for (const original of backup.assets) {
        const bytes = entries.get(`media/${original.id}`);
        if (!bytes) throw new Error(`Media missing for ${original.filename}.`);
        const asset = { ...original, id: idMap.get(original.id), projectId };
        const media = new File([bytes], asset.filename, { type: asset.mime || 'application/octet-stream' });
        await store.addAsset(asset, media);
      }
    });
    await boot(projectId);
    toast(`Recovered ${backup.assets.length} media file(s) and all project decisions.`);
  } catch (error) {
    toast(`Recovery failed: ${error.message}`, true);
  }
}

// ---------------------------------------------------------------------------
// board

function renderBoard() {
  const f = state.filters;
  const mk = (key, label, options) => {
    const s = el('select', {});
    s.append(el('option', { value: '' }, label));
    for (const o of options) s.append(el('option', { value: o.id, selected: f[key] === o.id }, o.label));
    s.onchange = () => { f[key] = s.value; state.index = 0; render(); };
    return s;
  };
  const search = el('input', { type: 'text', placeholder: 'Search files, notes, labels', value: f.q });
  search.oninput = () => { f.q = search.value; renderBoardList(); };

  const toolbar = el('div', { className: 'toolbar' },
    mk('status', 'Any status', ASSET_STATUSES),
    mk('role', 'Any role', ASSET_ROLES),
    mk('kind', 'Stills and video', [{ id: 'image', label: 'Stills' }, { id: 'video', label: 'Video' }]),
    mk('surface', 'Any surface', activeSurfaces().map(s => ({ id: s.id, label: `Approved · ${s.label}` }))),
    (() => {
      const sel = el('select', {});
      sel.append(el('option', { value: '0' }, 'Any rating'));
      for (const n of [1, 2, 3, 4, 5]) sel.append(el('option', { value: String(n), selected: f.rating === n }, '★'.repeat(n) + ' and up'));
      sel.onchange = () => { f.rating = Number(sel.value); state.index = 0; render(); };
      return sel;
    })(),
    mk('issues', 'Any check state', [
      { id: 'block', label: 'Blocking issues' }, { id: 'any', label: 'Any issue' }, { id: 'clean', label: 'Clean' }]),
    search,
    btn('Clear', 'btn sm', () => { state.filters = { status: '', role: '', kind: '', surface: '', issues: '', rating: 0, q: '' }; render(); }),
    el('div', { className: 'spacer' }),
    el('span', { className: 'note' }, 'Click a card to review it'));

  $('#main').replaceChildren(toolbar, el('div', { className: 'board' }));
  renderBoardList();
}

function renderBoardList() {
  const list = $('.board');
  if (!list) return;
  const assets = visibleAssets();
  if (!assets.length) {
    list.replaceChildren(el('div', { className: 'empty' },
      el('h2', {}, 'Nothing matches'),
      el('p', {}, 'Loosen the filters, or add files from the Library panel.')));
    return;
  }
  const grid = el('div', { className: 'grid' });
  list.replaceChildren(grid);

  for (const a of assets) {
    const thumb = el('div', { className: 'thumb' });
    const c = issueCount(a);
    const card = el('div', { className: 'card' }, thumb,
      el('div', { className: 'meta' },
        el('div', { className: 'name', title: a.filename }, a.filename),
        el('div', { className: 'sub' },
          el('span', { className: 'chip ' + a.status }, STATUS_BY_ID[a.status]?.label || a.status),
          (a.rating ? el('span', { style: 'color:var(--gold)' }, '★'.repeat(a.rating)) : null),
          el('span', {}, a.kind === 'video' ? 'video' : a.width ? `${a.width}×${a.height}` : '—'),
          c.block ? el('span', { style: 'color:var(--bad)' }, `${c.block} blocking`) : null,
          !c.block && c.warn ? el('span', { style: 'color:var(--warn)' }, `${c.warn} warn`) : null),
        el('div', { className: 'pmatrix' },
          ...activeSurfaces().map(s => el('span', {
            className: 'pdot ' + (a.placements?.[s.id]?.decision || 'pending'),
            title: `${s.label}: ${a.placements?.[s.id]?.decision || 'pending'}`
          }, s.label)))));
    card.onclick = () => { state.index = assets.indexOf(a); state.mode = 'review'; render(); };
    grid.append(card);
    store.objectUrl(a.id).then(url => {
      if (!url) return;
      thumb.append(a.kind === 'video'
        ? el('video', { src: url, muted: true, preload: 'metadata' })
        : el('img', { src: url, loading: 'lazy', alt: a.filename }));
    });
  }
}

// ---------------------------------------------------------------------------
// stage painting

const PREVIEW_MAX = 1000;
const previewSurface = s => {
  const k = Math.min(1, PREVIEW_MAX / Math.max(s.w, s.h));
  return { ...s, w: Math.max(1, Math.round(s.w * k)), h: Math.max(1, Math.round(s.h * k)) };
};

function safeOverlay(surface) {
  if (!(surface.safeTop || surface.safeBottom || surface.safeRight || surface.safeLeft)) return null;
  const wrap = el('div', { className: 'safe' });
  const band = (style, label) => {
    const d = el('div', { className: 'band', style });
    d.append(el('span', { className: 'lbl' }, label));
    return d;
  };
  if (surface.safeTop) wrap.append(band(`left:0;right:0;top:0;height:${surface.safeTop * 100}%`, 'chrome'));
  if (surface.safeBottom) wrap.append(band(`left:0;right:0;bottom:0;height:${surface.safeBottom * 100}%`, 'caption'));
  if (surface.safeRight) wrap.append(band(`top:${(surface.safeTop || 0) * 100}%;bottom:${(surface.safeBottom || 0) * 100}%;right:0;width:${surface.safeRight * 100}%`, 'rail'));
  if (surface.safeLeft) wrap.append(band(`top:0;bottom:0;left:0;width:${surface.safeLeft * 100}%`, 'ui'));
  return wrap;
}

async function paintStage() {
  const viewport = $('#viewport');
  if (!viewport) return;
  const asset = currentAsset();
  if (!asset) return;
  const surface = SURFACE_BY_ID[state.activeSurface];
  const d = await decode(asset);
  if (!d) {
    viewport.replaceChildren(el('div', { className: 'empty' },
      el('h2', {}, 'Cannot decode'),
      el('p', {}, `${asset.filename} could not be read by this browser. Convert it and re-import.`)));
    return;
  }

  if (state.view === 'source' || !surface) {
    const wrap = el('div', { className: 'srcwrap' });
    wrap.append(el('img', { src: d.url, alt: asset.filename, draggable: false }));
    if (surface) {
      const p = ensurePlacement(asset, surface.id);
      const rect = el('div', {
        className: 'croprect',
        style: `left:${p.crop.x * 100}%;top:${p.crop.y * 100}%;width:${p.crop.w * 100}%;height:${p.crop.h * 100}%`
      }, ...['tl', 'tr', 'bl', 'br'].map(c => el('div', { className: 'corner ' + c })));
      wrap.append(rect);
      attachSourceDrag(wrap, rect, asset, surface);
    }
    viewport.replaceChildren(wrap);
    attachLoupe(wrap, d, () => ({ x: 0, y: 0, w: 1, h: 1 }));
    return;
  }

  const p = ensurePlacement(asset, surface.id);
  const ps = previewSurface(surface);
  const canvas = renderCrop(d.source, d.w, d.h, p.crop, ps, p.fill);
  const frame = el('div', { className: 'frame grab' }, canvas);
  if (state.thirds) frame.append(el('div', { className: 'thirds' }));
  const safe = safeOverlay(surface);
  if (safe) frame.append(safe);
  viewport.replaceChildren(frame);
  attachPlacementDrag(frame, asset, surface);
  attachLoupe(frame, d, () => p.crop);
}

function attachPlacementDrag(frame, asset, surface) {
  const p = asset.placements[surface.id];
  let drag = null;
  frame.onpointerdown = e => {
    if (state.loupe) return;
    drag = { x: e.clientX, y: e.clientY, crop: { ...p.crop } };
    frame.setPointerCapture(e.pointerId);
  };
  frame.onpointermove = e => {
    if (!drag) return;
    const r = frame.getBoundingClientRect();
    p.crop = panCrop(drag.crop,
      -((e.clientX - drag.x) / r.width) * drag.crop.w,
      -((e.clientY - drag.y) / r.height) * drag.crop.h);
    paintStage();
  };
  frame.onpointerup = frame.onpointercancel = () => {
    if (!drag) return;
    drag = null;
    log(asset, `reframed ${surface.label}`, state.reviewer);
    touchAsset(asset);
    renderIssuesOnly();
  };
  frame.onwheel = e => {
    if (state.loupe) return;
    e.preventDefault();
    p.crop = zoomCrop(p.crop, e.deltaY < 0 ? 1.08 : 1 / 1.08);
    touchAsset(asset);
    paintStage();
    renderIssuesOnly();
  };
}

function attachSourceDrag(wrap, rect, asset, surface) {
  const p = asset.placements[surface.id];
  let drag = null;
  rect.onpointerdown = e => {
    if (state.loupe) return;
    drag = { x: e.clientX, y: e.clientY, crop: { ...p.crop } };
    rect.setPointerCapture(e.pointerId);
    e.stopPropagation();
  };
  rect.onpointermove = e => {
    if (!drag) return;
    const r = wrap.getBoundingClientRect();
    p.crop = clampCrop({
      ...drag.crop,
      x: drag.crop.x + (e.clientX - drag.x) / r.width,
      y: drag.crop.y + (e.clientY - drag.y) / r.height
    });
    rect.style.left = p.crop.x * 100 + '%';
    rect.style.top = p.crop.y * 100 + '%';
  };
  rect.onpointerup = rect.onpointercancel = () => {
    if (!drag) return;
    drag = null;
    log(asset, `reframed ${surface.label}`, state.reviewer);
    touchAsset(asset);
    renderIssuesOnly();
  };

  // Corner handles resize the window; the result is snapped straight back to
  // the placement's aspect ratio so an export can never come out distorted.
  const paint = () => Object.assign(rect.style, {
    left: p.crop.x * 100 + '%', top: p.crop.y * 100 + '%',
    width: p.crop.w * 100 + '%', height: p.crop.h * 100 + '%'
  });
  for (const handle of rect.querySelectorAll('.corner')) {
    const corner = [...handle.classList].find(c => c !== 'corner');
    let grab = null;
    handle.onpointerdown = e => {
      if (state.loupe) return;
      grab = { x: e.clientX, y: e.clientY, crop: { ...p.crop } };
      handle.setPointerCapture(e.pointerId);
      e.stopPropagation();
    };
    handle.onpointermove = e => {
      if (!grab) return;
      const r = wrap.getBoundingClientRect();
      const dx = (e.clientX - grab.x) / r.width;
      const dy = (e.clientY - grab.y) / r.height;
      const c = { ...grab.crop };
      if (corner.includes('l')) { c.x = grab.crop.x + dx; c.w = grab.crop.w - dx; }
      else { c.w = grab.crop.w + dx; }
      if (corner.startsWith('t')) { c.y = grab.crop.y + dy; c.h = grab.crop.h - dy; }
      else { c.h = grab.crop.h + dy; }
      p.crop = snapToRatio(clampCrop(c), asset.width || 1, asset.height || 1, surface);
      paint();
      e.stopPropagation();
    };
    handle.onpointerup = handle.onpointercancel = () => {
      if (!grab) return;
      grab = null;
      log(asset, `resized crop for ${surface.label}`, state.reviewer);
      touchAsset(asset);
      renderIssuesOnly();
    };
  }

  wrap.onwheel = e => {
    if (state.loupe) return;
    e.preventDefault();
    p.crop = zoomCrop(p.crop, e.deltaY < 0 ? 1.08 : 1 / 1.08);
    Object.assign(rect.style, {
      left: p.crop.x * 100 + '%', top: p.crop.y * 100 + '%',
      width: p.crop.w * 100 + '%', height: p.crop.h * 100 + '%'
    });
    touchAsset(asset);
    renderIssuesOnly();
  };
}

// --- loupe: true 1:1 source pixels, the only way to judge hands and skin ---

function attachLoupe(host, decoded, cropFn) {
  host.onpointerenter = host.onpointermove = e => {
    if (!state.loupe) return removeLoupe();
    const r = host.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return removeLoupe();
    const crop = cropFn();
    drawLoupe(decoded, (crop.x + fx * crop.w) * decoded.w, (crop.y + fy * crop.h) * decoded.h, e.clientX, e.clientY);
  };
  host.onpointerleave = removeLoupe;
}

function removeLoupe() { document.querySelector('.loupe')?.remove(); }

function drawLoupe(decoded, sx, sy, clientX, clientY) {
  const SIZE = 260;
  let node = document.querySelector('.loupe');
  if (!node) {
    node = el('div', { className: 'loupe' },
      el('canvas', { width: SIZE, height: SIZE }),
      el('span', { className: 'mag' }, ''));
    document.body.append(node);
  }
  const zoom = state.loupeZoom;
  const span = SIZE / zoom;
  const ctx = node.querySelector('canvas').getContext('2d');
  ctx.imageSmoothingEnabled = zoom < 2;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(decoded.source, sx - span / 2, sy - span / 2, span, span, 0, 0, SIZE, SIZE);
  ctx.strokeStyle = 'rgba(201,168,106,.5)';
  ctx.beginPath();
  ctx.moveTo(SIZE / 2, SIZE / 2 - 8); ctx.lineTo(SIZE / 2, SIZE / 2 + 8);
  ctx.moveTo(SIZE / 2 - 8, SIZE / 2); ctx.lineTo(SIZE / 2 + 8, SIZE / 2);
  ctx.stroke();
  node.querySelector('.mag').textContent = `${zoom * 100}% · source pixels`;
  node.style.left = `${Math.min(window.innerWidth - 150, Math.max(150, clientX + 190))}px`;
  node.style.top = `${Math.min(window.innerHeight - 150, Math.max(150, clientY))}px`;
}

// ---------------------------------------------------------------------------
// compare

async function paintCompare() {
  const host = $('#comparePanes');
  if (!host) return;
  const asset = currentAsset();
  const other = state.assets.find(a => a.id === state.compareWith);
  const surface = SURFACE_BY_ID[state.activeSurface];

  const pane = async (a, label) => {
    const body = el('div', { className: 'body' });
    const p = el('div', { className: 'pane' },
      el('header', {},
        el('span', { className: 'eyebrow' }, label),
        el('span', { className: 'nm' }, a ? a.filename : 'nothing selected')),
      body);
    if (!a) { body.append(el('p', { className: 'note' }, 'Pick an asset to compare.')); return p; }
    const d = await decode(a);
    if (!d) { body.append(el('p', { className: 'note' }, 'Cannot decode.')); return p; }
    if (surface) {
      const pl = ensurePlacement(a, surface.id);
      body.append(renderCrop(d.source, d.w, d.h, pl.crop, previewSurface(surface), pl.fill));
    } else {
      body.append(el('img', { src: d.url, alt: a.filename }));
    }
    return p;
  };
  host.replaceChildren(await pane(other, 'Reference'), await pane(asset, 'Candidate'));
}

// ---------------------------------------------------------------------------
// rail

function issueList(items, emptyText) {
  if (!items.length) return el('p', { className: 'hint', style: 'margin:0' }, emptyText);
  return el('div', {}, ...items.map(i => el('div', { className: 'issue ' + i.level },
    el('span', { className: 'dot' }),
    el('div', {},
      i.surface ? el('span', { className: 'where' }, i.surface + ' — ') : null,
      el('span', { className: 'msg' }, i.message),
      i.fix ? el('span', { className: 'fix' }, i.fix) : null))));
}

function metricsBlock(asset) {
  const a = asset.auto;
  const wrap = el('div', { className: 'block' });
  if (!a) {
    wrap.append(el('p', { className: 'hint' }, 'Not analysed yet.'),
      btn('Run checks on this asset', 'btn sm', async () => { await runAnalysis(asset); renderReview(); }));
    return wrap;
  }
  const cell = (k, v, extra) => el('div', {}, el('div', { className: 'k' }, k), el('div', { className: 'v' }, v, extra || null));
  const sharpLabel = a.sharpness < 40 ? 'soft' : a.sharpness < 150 ? 'adequate' : 'crisp';
  wrap.append(el('div', { className: 'metrics' },
    cell('Resolution', `${a.megapixels} MP`, el('small', {}, ` · ${a.width}×${a.height}`)),
    cell('Sharpness', String(a.sharpness), el('small', {}, ` · ${sharpLabel}`)),
    cell('Blown highlights', `${(a.exposure.blown * 100).toFixed(1)}%`),
    cell('Skin detail', a.skin ? `${Math.round(a.skin.ratio * 100)}%` : '—',
      a.skin ? el('small', {}, a.skin.ratio < 0.35 ? ' · waxy' : ' · textured') : null)));

  const sw = el('div', { className: 'swatches' }, ...a.palette.map(c => el('i', { style: `background:${c.hex}`, title: `${c.hex} · ${Math.round(c.pct * 100)}%` })));
  wrap.append(el('div', { style: 'font-size:11px;color:var(--faint);margin-bottom:4px' }, 'Dominant colour'), sw);

  const g = asset.geometry;
  wrap.append(el('p', { className: 'hint', style: 'margin:12px 0 0' },
    g ? `Geometry — ${g.faces.length} face(s), ${g.hands.length} hand(s) detected (MediaPipe, on this machine).`
      : 'Geometry — face/hand detection unavailable (offline or blocked). Heuristics still apply.'));

  const prov = a.provenance;
  if (prov) {
    const bits = [];
    if (prov.c2pa || prov.contentCredentials) bits.push('Content Credentials present');
    if (prov.aiDigitalSource) bits.push('declares AI origin');
    if (prov.tool) bits.push(`tool: ${prov.tool}`);
    wrap.append(el('p', { className: 'hint', style: 'margin:12px 0 0' },
      'Embedded provenance — ' + (bits.length ? bits.join(' · ') : 'none found in file metadata')));
  }
  wrap.append(el('div', { style: 'margin-top:12px' },
    btn('Re-run checks', 'btn sm', async () => { await runAnalysis(asset); renderReview(); })));
  return wrap;
}

function placementCard(asset, surface) {
  const p = ensurePlacement(asset, surface.id);
  const card = el('div', { className: 'placement' + (surface.id === state.activeSurface ? ' active' : '') });
  card.onclick = e => {
    if (e.target.closest('button, input, textarea')) return;
    state.activeSurface = surface.id;
    renderReview();
  };
  card.append(el('div', { className: 'top' },
    el('span', { className: 'nm' }, surface.label),
    el('span', { className: 'chip' }, surface.groupLabel),
    el('span', { className: 'sz' }, `${surface.w}×${surface.h}`)));

  const decide = el('div', { className: 'decide' });
  for (const d of ['approved', 'revise', 'denied']) {
    const b = el('button', { className: p.decision === d ? 'on' : '', dataset: { d } }, d[0].toUpperCase() + d.slice(1));
    b.onclick = () => decidePlacement(asset, surface.id, d);
    decide.append(b);
  }
  card.append(decide);

  const note = el('input', { className: 'pnote', type: 'text', placeholder: 'Note for this placement', value: p.note });
  note.oninput = () => { p.note = note.value; touchAsset(asset); };
  card.append(note);

  if (p.client) {
    card.append(el('div', { className: 'client' },
      `Client: ${p.client.verdict === 'approved' ? 'approved' : 'requested a change'}${p.client.note ? ` — ${p.client.note}` : ''}`));
  }

  const issues = placementIssues(asset, surface.id, state.project);
  for (const i of issues.filter(x => x.level !== 'info')) {
    card.append(el('div', { className: 'issue ' + i.level, style: 'border:0;padding:6px 0 0' },
      el('span', { className: 'dot' }), el('div', {}, el('span', { className: 'msg' }, i.message))));
  }
  return card;
}

function decidePlacement(asset, surfaceId, decision) {
  mutate(asset, `${decision} · ${SURFACE_BY_ID[surfaceId]?.label || surfaceId}`, () => {
    const p = ensurePlacement(asset, surfaceId);
    p.decision = p.decision === decision ? 'pending' : decision;
    syncStatusFromPlacements(asset);
  });
  renderReview();
  renderCounters();
}

function syncStatusFromPlacements(asset) {
  const decisions = Object.values(asset.placements || {}).map(p => p.decision).filter(d => d !== 'pending');
  if (!decisions.length) return;
  if (decisions.includes('approved') && ['unreviewed', 'rejected'].includes(asset.status)) asset.status = 'approved';
  else if (decisions.every(d => d === 'denied') && asset.status === 'approved') asset.status = 'rejected';
}

function qaBlock(asset) {
  const wrap = el('div', { className: 'block' });
  const checks = qaChecksForAsset(asset);
  const failed = checks.filter(c => asset.qa[c.id] === 'fail').length;
  const answered = checks.filter(c => asset.qa[c.id]).length;

  wrap.append(el('div', { style: 'display:flex;align-items:center;gap:9px;margin:2px 0 6px' },
    el('span', { style: 'font-size:11.5px;color:var(--muted)' }, `${answered} of ${checks.length} answered`),
    failed ? el('span', { className: 'chip rejected' }, `${failed} failed`) : null,
    (() => {
      const b = btn('Pass remaining', 'btn sm', () => {
        mutate(asset, 'passed remaining QA checks', () => {
          for (const c of checks) if (!asset.qa[c.id]) asset.qa[c.id] = 'pass';
        });
        renderReview();
      });
      b.style.marginLeft = 'auto';
      return b;
    })()));

  for (const g of [...new Set(checks.map(c => c.group))]) {
    const box = el('div', { className: 'qa-group' }, el('h5', {}, g));
    for (const c of checks.filter(x => x.group === g)) {
      const tri = el('div', { className: 'tri' });
      for (const v of ['pass', 'fail', 'na']) {
        const b = el('button', { className: asset.qa[c.id] === v ? 'on' : '', title: v, dataset: { v } },
          v === 'na' ? '–' : v === 'pass' ? '✓' : '✕');
        b.onclick = () => {
          mutate(asset, `${c.label}: ${asset.qa[c.id] === v ? 'cleared' : v}`, () => {
            if (asset.qa[c.id] === v) delete asset.qa[c.id]; else asset.qa[c.id] = v;
          });
          renderReview();
        };
        tri.append(b);
      }
      box.append(el('div', { className: 'qa-row' },
        el('div', {}, el('div', { className: 'lab' }, c.label), el('div', { className: 'ask' }, c.ask)), tri));
    }
    wrap.append(box);
  }
  return wrap;
}

function videoBlock(asset) {
  const v = asset.video;
  const wrap = el('div', { className: 'block' });
  const bind = (key, label, placeholder = '') => {
    const i = el('input', { type: 'text', value: v[key] || '', placeholder });
    i.oninput = () => { v[key] = i.value; touchAsset(asset); };
    return el('label', { className: 'field' }, el('span', {}, label), i);
  };
  wrap.append(
    bind('hook', 'Hook note', 'What must land in the first two seconds'),
    el('div', { style: 'display:flex;gap:8px' }, bind('trimStart', 'Trim start', '0:00'), bind('trimEnd', 'Trim end', '0:08')),
    bind('cropNote', 'Crop note', 'e.g. reframe to keep both hands in 9:16'));

  const stars = el('div', { className: 'stars' });
  for (let i = 1; i <= 5; i++) {
    const b = el('button', { className: i <= v.believability ? 'on' : '' }, '★');
    b.onclick = () => { mutate(asset, `believability ${i}/5`, () => { v.believability = v.believability === i ? 0 : i; }); renderReview(); };
    stars.append(b);
  }
  wrap.append(el('label', { className: 'field' }, el('span', {}, 'Believability'), stars));

  const mkToggle = (key, label) => {
    const cb = el('input', { type: 'checkbox', checked: v[key] });
    cb.onchange = () => { mutate(asset, `${label}: ${cb.checked}`, () => { v[key] = cb.checked; }); };
    return el('label', { className: 'toggle' }, cb, label);
  };
  wrap.append(mkToggle('looksAI', 'Reads as AI — reject'), mkToggle('recast', 'Request creator / cast replacement'));

  // The poster remains the crop reference; automated QA also samples the full
  // timeline so soft, blown, or black sections do not hide between stills.
  if (asset.duration > 0) {
    const scrub = el('input', {
      type: 'range', min: 0, max: asset.duration.toFixed(2), step: 0.05,
      value: v.posterTime ?? 0
    });
    const readout = el('span', { style: 'font:400 11px var(--mono);color:var(--faint)' },
      `${(v.posterTime ?? 0).toFixed(2)}s of ${asset.duration.toFixed(1)}s`);
    scrub.oninput = () => { readout.textContent = `${Number(scrub.value).toFixed(2)}s of ${asset.duration.toFixed(1)}s`; };
    scrub.onchange = async () => {
      mutate(asset, `poster frame → ${Number(scrub.value).toFixed(2)}s`, () => { v.posterTime = Number(scrub.value); });
      state.decoded.delete(asset.id);
      await runAnalysis(asset);
      renderReview();
    };
    wrap.append(el('label', { className: 'field' },
      el('span', {}, 'Crop reference frame'), scrub, readout));
    if (asset.temporal?.samples?.length) {
      wrap.append(el('p', { className: 'hint' },
        `Motion QA sampled ${asset.temporal.samples.length} points across ${asset.temporal.duration.toFixed(1)}s. ` +
        `Lowest sharpness ${asset.temporal.sharpnessMin}; brightness swing ${asset.temporal.lumaRange}.`));
    }
  }

  wrap.append(el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
    btn('Play + comment', 'btn sm', () => playWithComments(asset)),
    btn('Extract identity pack', 'btn sm', () => extractIdentityPack(asset))));
  return wrap;
}

/**
 * Turn a 360° turntable video (face or full body) into a set of reference
 * frames. The pack becomes the ground truth that every generated candidate is
 * compared against — and in Phase 2 it is exactly the training set a per-person
 * LoRA fine-tune wants.
 */
/**
 * Frame-anchored video comments: every note is pinned to a timestamp, the list
 * seeks the player, and the lot exports into VIDEO_NOTES.md for the editor.
 */
async function playWithComments(asset) {
  const url = await store.objectUrl(asset.id);
  asset.video.comments = asset.video.comments || [];
  const vid = el('video', { src: url, controls: true, autoplay: true, style: 'width:100%' });
  const listBox = el('div', { style: 'margin-top:12px;max-height:60vh;overflow-y:auto' });

  const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}.${Math.floor((t % 1) * 10)}`;
  const paint = () => {
    listBox.replaceChildren(...[...asset.video.comments].sort((a, b) => a.t - b.t).map(c => {
      const row = el('div', { className: 'fixrow' });
      const seek = el('button', { className: 'btn sm', type: 'button', style: 'font-family:var(--mono);font-size:10.5px' }, fmt(c.t));
      seek.onclick = () => { vid.currentTime = c.t; vid.play(); };
      const x = el('button', { className: 'x', type: 'button', title: 'Remove' }, '\u00d7');
      x.onclick = () => {
        mutate(asset, `removed comment at ${fmt(c.t)}`, () => {
          asset.video.comments = asset.video.comments.filter(y => y !== c);
        });
        paint();
      };
      row.append(seek, el('span', { style: 'flex:1' }, c.text), x);
      return row;
    }));
    if (!asset.video.comments.length) {
      listBox.append(el('p', { className: 'hint', style: 'margin:0' },
        'No comments yet. Pause where something needs saying and add one \u2014 it pins to that frame.'));
    }
  };

  const input = el('input', { type: 'text', placeholder: 'Comment at the current frame \u2014 Enter to pin' });
  const add = () => {
    const text = input.value.trim();
    if (!text) return;
    const t = vid.currentTime || 0;
    mutate(asset, `comment at ${fmt(t)}: ${text.slice(0, 60)}`, () => {
      asset.video.comments.push({ t: +t.toFixed(2), text, who: state.reviewer, at: new Date().toISOString() });
    });
    input.value = '';
    paint();
  };
  input.onkeydown = e => { if (e.key === 'Enter') { add(); e.stopPropagation(); } };

  dialog(asset.filename,
    el('div', {}, vid,
      el('div', { style: 'display:flex;gap:6px;margin-top:12px' }, input, btn('Pin', 'btn', add)),
      listBox),
    [btn('Close', 'btn', () => { renderReview(); closeDialog(); })]);
  paint();
}

async function extractIdentityPack(asset) {
  const nameInput = el('input', { type: 'text', placeholder: 'Person or character name' });
  const modeSel = el('select', {});
  modeSel.append(el('option', { value: 'face' }, 'Face pack — verified 180°'));
  modeSel.append(el('option', { value: 'body' }, 'Full body — verified 360°'));
  const countSel = el('select', {});
  for (const n of [8, 12, 16]) countSel.append(el('option', { value: String(n) }, `${n} frames`));
  dialog('Extract identity pack',
    el('div', {},
      el('p', { className: 'hint' },
        'Grabs evenly spaced frames from this video and files them as reference photos for one person.'),
      el('p', { className: 'hint' },
        'How to shoot it: even light, chin level, one person in frame. Face pack — turn the head slowly half-way to the left (about 8 seconds), back through centre, then half-way right. Full body — one slow full turn, arms slightly out, about 20 seconds. After extraction the tracker reports which angles you actually covered.'),
      el('label', { className: 'field' }, el('span', {}, 'Who is this'), nameInput),
      el('label', { className: 'field' }, el('span', {}, 'Capture type'), modeSel),
      el('label', { className: 'field' }, el('span', {}, 'Frames'), countSel)),
    [btn('Cancel', 'btn', closeDialog),
     btn('Extract', 'btn primary', async () => {
       const person = nameInput.value.trim() || 'unnamed';
       const count = Number(countSel.value);
       closeDialog();
       await busy(async () => {
         const url = await store.objectUrl(asset.id);
         const probeFrame = await grabVideoFrame(url, 0);
         const duration = probeFrame.duration || asset.duration || 0;
         if (!duration) return toast('Could not read the video duration.', true);
         for (let i = 0; i < count; i++) {
           const t = duration * ((i + 0.5) / count);
           const { canvas } = await grabVideoFrame(url, t);
           const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
           const file = new File([blob], `${slug(person)}_identity_${String(i + 1).padStart(2, '0')}.png`, { type: 'image/png' });
           const ref = newAsset(state.project.id, file);
           ref.role = 'reference';
           ref.status = 'reference-only';
           ref.labels.lane = person;
           ref.width = canvas.width;
           ref.height = canvas.height;
           ref.provenance = `Identity frame ${i + 1}/${count} at ${t.toFixed(2)}s from ${asset.filename}`;
           log(ref, `extracted from ${asset.filename}`, state.reviewer);
           await store.addAsset(ref, file);
           await runAnalysis(ref, { quiet: true });
         }
       });
       state.assets = await store.listAssets(state.project.id);
       render();

       // Coverage check: did the turn actually sweep the angles?
       const packFrames = state.assets
         .filter(a => a.role === 'reference' && a.labels.lane === person && a.provenance.includes(asset.filename))
         .sort((a, b) => a.filename.localeCompare(b.filename))
         .map(a => a.geometry);
       if (packFrames.some(Boolean)) {
         const rep = modeSel.value === 'body'
           ? captureCoverageBody(packFrames)
           : captureCoverage(packFrames);
         const lines = el('div', {},
           el('p', {}, modeSel.value === 'body'
             ? `Coverage: ${rep.bodiesFound}/${rep.frames} frames tracked · ${rep.coveredBuckets}/8 angle zones of the full 360° · verdict: ${rep.verdict}.`
             : `Coverage: ${rep.facesFound}/${rep.frames} frames tracked · ${rep.yawSpreadDeg}° of head turn · verdict: ${rep.verdict}.`),
           rep.gaps.length ? el('p', { className: 'hint' }, 'Missing angles: ' + rep.gaps.join(', ')) : null,
           ...rep.flags.map(f => el('p', { className: 'hint', style: 'color:var(--warn)' }, f)),
           rep.verdict !== 'good' ? el('p', { className: 'hint' }, 'Re-shoot with a slower turn to fill the gaps — the pack works better the wider the sweep.') : null);
         dialog('Capture report — ' + person, lines, [btn('Close', 'btn', closeDialog)]);
       } else {
         toast(`Identity pack for "${person}": ${count} frames extracted. Face tracking unavailable (offline) — coverage not verified.`);
       }
     })]);
}

function metaBlock(asset) {
  const wrap = el('div', { className: 'block' });
  const stars = el('div', { className: 'stars', style: 'margin-bottom:10px' });
  for (let i = 1; i <= 5; i++) {
    const b = el('button', { className: i <= (asset.rating || 0) ? 'on' : '', type: 'button', title: `${i} star${i > 1 ? 's' : ''}` }, '★');
    b.onclick = () => {
      mutate(asset, `rated ${asset.rating === i ? 0 : i}/5`, () => {
        asset.rating = asset.rating === i ? 0 : i;
      });
      renderReview();
    };
    stars.append(b);
  }
  wrap.append(el('label', { className: 'field' }, el('span', {}, 'Rating'), stars));

  const statuses = el('div', { className: 'statusrow' });
  for (const s of ASSET_STATUSES) {
    const b = el('button', { className: asset.status === s.id ? 'on' : '', title: s.hint, dataset: { s: s.id } }, s.label);
    b.onclick = () => {
      if (s.id === 'rejected' || s.id === 'needs-new-generation') return rejectionDialog(asset, s);
      mutate(asset, `status → ${s.label}`, () => { asset.status = s.id; });
      renderReview(); renderCounters();
    };
    statuses.append(b);
  }
  wrap.append(el('div', { style: 'margin-bottom:14px' }, statuses));

  const roleSel = el('select', {});
  for (const r of ASSET_ROLES) roleSel.append(el('option', { value: r.id, selected: asset.role === r.id }, r.label));
  const roleRow = el('div', { style: 'display:flex;gap:6px;align-items:flex-end' });
  roleSel.onchange = () => { mutate(asset, `role → ${roleSel.value}`, () => { asset.role = roleSel.value; }); };
  roleRow.append(
    (() => { const f = el('label', { className: 'field', style: 'flex:1;margin-bottom:0' }, el('span', {}, 'Role'), roleSel); return f; })(),
    asset.kind === 'image' ? btn('Upscale', 'btn sm', () => upscaleAsset(asset)) : null);
  wrap.append(el('div', { style: 'margin-bottom:11px' }, roleRow));

  const text = (key, label, placeholder = '', multi = false, obj = asset) => {
    const i = multi ? el('textarea', { value: obj[key] || '', placeholder })
                    : el('input', { type: 'text', value: obj[key] || '', placeholder });
    i.oninput = () => { obj[key] = i.value; touchAsset(asset); };
    return el('label', { className: 'field' }, el('span', {}, label), i);
  };
  wrap.append(
    el('div', { style: 'display:flex;gap:8px' }, text('campaign', 'Campaign', '', false, asset.labels), text('lane', 'Side / lane', '', false, asset.labels)),
    text('audience', 'Audience', '', false, asset.labels),
    text('altText', 'Alt text', 'Describe the image for screen readers', true),
    text('provenance', 'Rights and provenance', 'Model, source, licence, release', true),
    text('notes', 'Reviewer notes', 'Why this passed or failed', true));
  return wrap;
}

function brandOverlayControls() {
  const config = state.project.brandOverlay ||= { assetId: '', position: 'bottom-right', widthPct: 18, marginPct: 4, opacity: 1 };
  const logos = state.assets.filter(a => a.role === 'logo');
  const logo = el('select', {}, el('option', { value: '' }, 'No logo overlay'));
  for (const asset of logos) logo.append(el('option', { value: asset.id, selected: asset.id === config.assetId }, asset.filename));
  const position = el('select', {});
  for (const id of ['top-left','top-right','bottom-left','bottom-right','center']) position.append(el('option', { value:id, selected:id===config.position }, id.replace('-', ' ')));
  const width = el('input', { type:'number', min:5, max:60, value:config.widthPct || 18 });
  const opacity = el('input', { type:'number', min:0.1, max:1, step:0.1, value:config.opacity ?? 1 });
  const save = () => { Object.assign(config, { assetId:logo.value, position:position.value, widthPct:Number(width.value), opacity:Number(opacity.value) }); touchProject(); };
  logo.onchange=position.onchange=width.oninput=opacity.oninput=save;
  return el('div', { className:'brand-overlay-controls' },
    el('p', { className:'hint', style:'margin:12px 0 8px' }, 'Apply supplied artwork as-is to exported photos and video render instructions.'),
    el('label', { className:'field' }, el('span', {}, 'Logo overlay'), logo),
    el('div', { style:'display:grid;grid-template-columns:1fr 72px 72px;gap:6px' },
      el('label', { className:'field' }, el('span', {}, 'Position'), position),
      el('label', { className:'field' }, el('span', {}, 'Width %'), width),
      el('label', { className:'field' }, el('span', {}, 'Opacity'), opacity)));
}

function rejectionDialog(asset, targetStatus) {
  const current = asset.rejectionFeedback || { reasons: [], note: '', shareForImprovement: false };
  const reasonInputs = REJECTION_REASONS.map(reason => {
    const input = el('input', { type: 'checkbox', value: reason.id, checked: current.reasons.includes(reason.id) });
    return el('label', { className: 'checkline' }, input, el('span', {}, reason.label));
  });
  const note = el('textarea', { placeholder: 'What should be different next time?', value: current.note || '' });
  const share = el('input', { type: 'checkbox', checked: !!current.shareForImprovement });
  const body = el('div', {},
    el('p', { className: 'hint' }, 'Choose every reason that applies. This feedback becomes project memory and travels with the audit record.'),
    el('div', { className: 'reason-grid' }, ...reasonInputs),
    el('label', { className: 'field', style: 'margin-top:14px' }, el('span', {}, 'Optional note'), note),
    el('label', { className: 'checkline' }, share, el('span', {}, 'Allow anonymized ratings and reason codes to improve MaterialLogix. Media is never included without a separate upload confirmation.')));
  dialog('Why are you declining this result?', body, [
    btn('Cancel', 'btn', closeDialog),
    btn('Save rejection', 'btn primary', () => {
      const reasons = reasonInputs.filter(label => label.querySelector('input').checked).map(label => label.querySelector('input').value);
      if (!reasons.length) return toast('Choose at least one reason.', true);
      mutate(asset, `status → ${targetStatus.label}`, () => {
        asset.status = targetStatus.id;
        asset.rejectionFeedback = { reasons, note: note.value.trim(), shareForImprovement: share.checked, recordedAt: new Date().toISOString() };
      });
      closeDialog(); renderReview(); renderCounters();
      toast('Thanks — this helps the next result.');
    })
  ]);
  $('#dlg').classList.add('feedback-popover');
}

function logBlock(asset) {
  const wrap = el('div', { className: 'block' });
  const entries = [...(asset.log || [])].reverse().slice(0, 24);
  if (!entries.length) return wrap.appendChild(el('p', { className: 'hint', style: 'margin:0' }, 'No actions recorded yet.')), wrap;
  wrap.append(el('ul', { className: 'log' }, ...entries.map(e =>
    el('li', {}, el('time', {}, new Date(e.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })),
      el('span', {}, `${e.what}`)))));
  return wrap;
}

function renderRail(asset) {
  const rail = el('div', { className: 'rail', id: 'rail' });
  const surfaces = activeSurfaces();

  const auto = assetIssues(asset, state.assets, state.project);
  const perPlacement = Object.keys(asset.placements || {})
    .filter(sid => asset.placements[sid].decision !== 'pending')
    .flatMap(sid => placementIssues(asset, sid, state.project).map(i => ({ ...i, surface: SURFACE_BY_ID[sid]?.label })));
  const all = [...auto, ...perPlacement].sort((a, b) => ({ block: 0, warn: 1, info: 2 })[a.level] - ({ block: 0, warn: 1, info: 2 })[b.level]);

  rail.append(el('h3', {}, 'Automated checks',
    all.some(i => i.level === 'block') ? el('span', { className: 'chip rejected' }, 'blocking') : null));
  rail.append(el('div', { className: 'block', id: 'issueBlock' }, issueList(all, 'Nothing flagged. Human review still required.')));

  rail.append(el('h3', {}, 'Measurements'));
  rail.append(metricsBlock(asset));

  rail.append(el('h3', {}, 'Placements', el('span', { className: 'count' }, String(surfaces.length))));
  if (!surfaces.length) {
    rail.append(el('div', { className: 'block' }, el('p', { className: 'hint' }, 'No surfaces selected. Choose them in the Surfaces panel.')));
  } else {
    const box = el('div', { className: 'block' });
    for (const s of surfaces) box.append(placementCard(asset, s));
    box.append(el('div', { style: 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap' },
      btn('Approve all', 'btn sm', () => {
        mutate(asset, 'approved every surface', () => {
          for (const s of surfaces) ensurePlacement(asset, s.id).decision = 'approved';
          syncStatusFromPlacements(asset);
        });
        renderReview(); renderCounters();
      }),
      btn('Deny all', 'btn sm', () => {
        mutate(asset, 'denied every surface', () => {
          for (const s of surfaces) ensurePlacement(asset, s.id).decision = 'denied';
          syncStatusFromPlacements(asset);
        });
        renderReview(); renderCounters();
      }),
      btn('Auto-reframe all', 'btn sm', () => reframeAll(asset))));
    rail.append(box);
  }

  rail.append(el('h3', {}, `QA — ${asset.kind === 'video' ? 'Video' : PRESET_BY_ID[state.project.qaPreset]?.label}`));
  rail.append(qaBlock(asset));

  rail.append(el('h3', {}, 'Fix list',
    (asset.fixes || []).length ? el('span', { className: 'chip needs-retouch' }, String(asset.fixes.length)) : null));
  rail.append(fixBlock(asset));

  if (asset.kind === 'video') {
    rail.append(el('h3', {}, 'Video review'));
    rail.append(videoBlock(asset));
  }

  rail.append(el('h3', {}, 'Asset'));
  rail.append(metaBlock(asset));
  rail.append(el('h3', {}, 'Audit trail'));
  rail.append(logBlock(asset));
  return rail;
}

/** Repaint only the automated-checks block — cheap enough to run after a drag. */
function renderIssuesOnly() {
  const asset = currentAsset();
  const host = $('#issueBlock');
  if (!asset || !host) return;
  const auto = assetIssues(asset, state.assets, state.project);
  const per = Object.keys(asset.placements || {})
    .filter(sid => asset.placements[sid].decision !== 'pending')
    .flatMap(sid => placementIssues(asset, sid, state.project).map(i => ({ ...i, surface: SURFACE_BY_ID[sid]?.label })));
  const all = [...auto, ...per].sort((a, b) => ({ block: 0, warn: 1, info: 2 })[a.level] - ({ block: 0, warn: 1, info: 2 })[b.level]);
  host.replaceChildren(issueList(all, 'Nothing flagged. Human review still required.'));
}

function reframeAll(asset) {
  if (!asset.auto?.energy) return toast('Run automated checks first — reframing uses the energy map.', true);
  mutate(asset, 'auto-reframed every surface', () => {
    for (const s of activeSurfaces()) {
      const p = ensurePlacement(asset, s.id);
      const base = defaultCrop(asset.width, asset.height, s);
      p.crop = smartCrop(asset.auto.energy, asset.width, asset.height, s, base, asset.geometry?.faces || []);
    }
  });
  renderReview();
  toast('Reframed every surface around the subject.');
}

// ---------------------------------------------------------------------------
// review shell

/**
 * First run: the campaign's direction comes before any pixel. Everything asked
 * here is what every later check reads from \u2014 goal, brand, audience, surfaces.
 */
function directionWizard() {
  const b = state.project.brief;
  const card = el('div', { className: 'wizard' });
  card.append(
    el('h2', {}, 'Where is this campaign going?'),
    el('p', { className: 'lead' },
      'Set the direction first \u2014 every crop, check, and approval downstream is judged against it. Thirty seconds now saves a re-review later.'));

  const field = (key, label, placeholder, multi = false) => {
    const i = multi ? el('textarea', { value: b[key] || '', placeholder, rows: 2 })
                    : el('input', { type: 'text', value: b[key] || '', placeholder });
    i.oninput = () => { b[key] = i.value; touchProject(); };
    return el('label', { className: 'field' }, el('span', {}, label), i);
  };
  card.append(
    field('campaignGoal', 'What is this campaign for?', 'e.g. App launch \u2014 paid social and website hero'),
    el('div', { style: 'display:flex;gap:10px' },
      (() => { const f = field('brand', 'Brand', 'Your brand'); f.style.flex = '1'; return f; })(),
      (() => { const f = field('audience', 'Audience', 'Who has to stop scrolling'); f.style.flex = '1'; return f; })()),
    field('tone', 'Tone', 'e.g. warm, editorial, quietly confident'));

  card.append(el('label', { className: 'field' }, el('span', {}, 'Where will it run?')));
  const presets = el('div', { className: 'presets' });
  const paint = () => {
    for (const btnEl of presets.children) {
      const pr = SURFACE_PRESETS.find(x => x.id === btnEl.dataset.id);
      btnEl.classList.toggle('on', pr.surfaces.every(id => state.project.surfaces.includes(id)));
    }
  };
  for (const pr of SURFACE_PRESETS) {
    const bEl = el('button', { type: 'button', dataset: { id: pr.id } }, `${pr.label} \u00b7 ${pr.surfaces.length}`);
    bEl.onclick = () => {
      const all = pr.surfaces.every(id => state.project.surfaces.includes(id));
      state.project.surfaces = all
        ? state.project.surfaces.filter(id => !pr.surfaces.includes(id))
        : [...new Set([...state.project.surfaces, ...pr.surfaces])];
      touchProject(); paint();
    };
    presets.append(bEl);
  }
  paint();
  card.append(presets,
    el('p', { className: 'lead', style: 'margin:0 0 4px;font-size:11.5px' },
      'Fine-tune individual placements any time in the Surfaces panel.'));

  const start = btn('Set direction and add assets', 'btn primary', async () => {
    if (!b.campaignGoal.trim()) b.campaignGoal = 'Untitled campaign';
    await store.saveProject(state.project);
    render();
    $('#fileInput').click();
  });
  card.append(el('div', { className: 'foot' }, start,
    el('span', { className: 'note' }, 'Everything stays on this machine.')));
  return card;
}

/**
 * The 2K\u21924K move: push a still through the engine's upscale model
 * (Real-ESRGAN and friends), then re-measure the result like any other asset.
 */
async function upscaleAsset(asset) {
  // Prefer the zero-setup bridge (engine.py + the bundled Real-ESRGAN binary);
  // fall back to a connected ComfyUI's upscale models.
  const bridge = await detectBridge();
  let engine = null, models = [];
  if (bridge.ok && bridge.upscale?.available) {
    models = bridge.upscale.models;
  } else {
    const savedBase = localStorage.getItem('cros:comfyBase') || `http://${location.hostname}:8188`;
    engine = await detectComfy(savedBase);
    if (!engine.ok) {
      return toast('No engine found. Start the bridge (python engine.py) or link ComfyUI in the Generate panel \u2014 upscaling runs on your own GPU.', true);
    }
    try { models = await listUpscaleModels(engine.base); } catch { /* handled */ }
    if (!models.length) {
      return toast('Engine found, but no upscale model installed. Drop RealESRGAN_x4plus.pth into ComfyUI\u2019s models/upscale_models folder.', true);
    }
  }
  const pick = el('select', {});
  for (const m of models) pick.append(el('option', { value: m, selected: /x4plus$/.test(m) }, m));
  dialog('Upscale on your GPU',
    el('div', {},
      el('p', { className: 'hint' },
        `${asset.filename} \u00b7 ${asset.width}\u00d7${asset.height}. The result imports as a new linked asset, runs the same checks, and records provenance.`),
      !covers(lic, 'review') ? el('p', { className: 'hint', style: 'color:var(--warn)' },
        'Free preview lane: 2× model. A license unlocks the full 4× lane.') : null,
      el('label', { className: 'field' }, el('span', {}, 'Upscale model'), pick)),
    [btn('Cancel', 'btn', closeDialog),
     btn('Upscale', 'btn primary', async () => {
       const model = pick.value;
       closeDialog();
       try {
         await busy(async () => {
           toast('Upscaling on the engine\u2026');
           const blob = await store.getBlob(asset.id);
           const out = engine
             ? await upscaleOne(blob, asset.filename, model, () => {}, engine.base)
             : await upscaleViaBridge(blob, model);
           const file = new File([out.blob], asset.filename.replace(/(\.[a-z0-9]+)?$/i, '_up$1'), { type: out.blob.type || 'image/png' });
           const up = newAsset(state.project.id, file);
           up.labels = { ...asset.labels };
           up.altText = asset.altText;
           up.provenance = `Upscaled from ${asset.filename} with ${model} on ${engine ? 'the ComfyUI engine' : 'the local Real-ESRGAN bridge'}. ` + (asset.provenance || '');
           await store.addAsset(up, file);
           const url = await store.objectUrl(up.id);
           Object.assign(up, await probe(file, url));
           log(up, `upscaled from ${asset.filename} (${model})`, state.reviewer);
           await store.saveAsset(up);
           state.assets.push(up);
           await runAnalysis(up, { quiet: true });
         });
         state.assets = await store.listAssets(state.project.id);
         render();
         toast('Upscaled and re-measured \u2014 the new asset is in the library.');
       } catch (err) {
         toast('Upscale failed: ' + err.message, true);
       }
     })]);
}

/** The "make this photo right" checklist. Feeds RETOUCH_LIST.md in the export. */
function fixBlock(asset) {
  const wrap = el('div', { className: 'block' });
  asset.fixes = asset.fixes || [];
  const has = id => asset.fixes.some(f => f.id === id);

  const grid = el('div', { className: 'fixgrid' });
  for (const f of FIX_PRESETS) {
    const bEl = el('button', { className: has(f.id) ? 'on' : '', type: 'button' }, f.label);
    bEl.onclick = () => {
      mutate(asset, `${has(f.id) ? 'cleared fix' : 'marked fix'}: ${f.label}`, () => {
        if (has(f.id)) asset.fixes = asset.fixes.filter(x => x.id !== f.id);
        else asset.fixes.push({ id: f.id, label: f.label });
        if (asset.fixes.length && asset.status === 'unreviewed') asset.status = 'needs-retouch';
      });
      renderReview(); renderCounters();
    };
    grid.append(bEl);
  }
  wrap.append(grid);

  const custom = el('input', { type: 'text', placeholder: 'Anything else to fix \u2014 type and press Enter' });
  custom.onkeydown = e => {
    if (e.key !== 'Enter' || !custom.value.trim()) return;
    mutate(asset, `marked fix: ${custom.value.trim()}`, () => {
      asset.fixes.push({ id: null, label: custom.value.trim() });
      if (asset.status === 'unreviewed') asset.status = 'needs-retouch';
    });
    renderReview(); renderCounters();
  };
  wrap.append(el('label', { className: 'field' }, custom));

  for (const f of asset.fixes.filter(x => x.id === null)) {
    const row = el('div', { className: 'fixrow' }, f.label);
    const x = el('button', { className: 'x', type: 'button', title: 'Remove' }, '\u00d7');
    x.onclick = () => {
      mutate(asset, `cleared fix: ${f.label}`, () => {
        asset.fixes = asset.fixes.filter(y => y !== f);
      });
      renderReview();
    };
    row.append(x);
    wrap.append(row);
  }
  if (asset.fixes.length) {
    wrap.append(el('p', { className: 'hint', style: 'margin:10px 0 0' },
      `${asset.fixes.length} fix(es) \u2014 exports as RETOUCH_LIST.md for the editor, and queues for the in-app retouch pass when it ships.`));
  }
  return wrap;
}

function renderReview() {
  const main = $('#main');
  const assets = visibleAssets();

  if (!state.assets.length) {
    if (!state.project.brief.campaignGoal) {
      main.replaceChildren(el('div', { className: 'empty' }, directionWizard()));
    } else {
      main.replaceChildren(el('div', { className: 'empty' },
        el('h2', {}, 'Direction set \u2014 now the assets'),
        el('p', {}, `${state.project.brief.campaignGoal}. Drop stills or video anywhere on this window, or generate candidates from the Generate panel. Files stay on this machine.`),
        btn('Add files', 'btn primary', () => $('#fileInput').click())));
    }
    return;
  }
  if (!assets.length) {
    main.replaceChildren(el('div', { className: 'empty' },
      el('h2', {}, 'No asset matches the filters'),
      el('p', {}, 'Open the board to change them.'),
      btn('Open board', 'btn', () => { state.mode = 'board'; render(); })));
    return;
  }

  state.index = Math.min(state.index, assets.length - 1);
  const asset = assets[state.index];
  const surfaces = activeSurfaces();
  if (!surfaces.find(s => s.id === state.activeSurface)) state.activeSurface = surfaces[0]?.id || null;
  const surface = SURFACE_BY_ID[state.activeSurface];

  const head = el('div', { className: 'stage-head' },
    aria(btn('←', 'btn sm', () => { state.index = (state.index - 1 + assets.length) % assets.length; renderReview(); }), 'Previous asset'),
    aria(btn('→', 'btn sm', () => { state.index = (state.index + 1) % assets.length; renderReview(); }), 'Next asset'),
    el('span', { className: 'idx' }, `${state.index + 1} / ${assets.length}`),
    el('span', { className: 'title' }, asset.filename),
    el('span', { className: 'dims' }, asset.width ? `${asset.width}×${asset.height}` : '—'),
    el('span', { className: 'chip ' + asset.status }, STATUS_BY_ID[asset.status]?.label || asset.status),
    el('div', { className: 'spacer' }),
    (() => {
      const seg = el('div', { className: 'seg' });
      for (const [v, label] of [['placement', 'Placement'], ['source', 'Full source'], ['compare', 'Compare']]) {
        const b = el('button', { className: state.view === v ? 'on' : '' }, label);
        b.onclick = () => { state.view = v; renderReview(); };
        seg.append(b);
      }
      return seg;
    })());

  let stageBody;
  if (state.view === 'compare') {
    const pick = el('select', { style: 'width:auto;min-width:180px' });
    pick.append(el('option', { value: '' }, 'Compare with…'));
    for (const a of state.assets) {
      if (a.id === asset.id) continue;
      pick.append(el('option', { value: a.id, selected: a.id === state.compareWith },
        `${a.role === 'reference' ? '★ ' : ''}${a.filename}`));
    }
    pick.onchange = () => { state.compareWith = pick.value; paintCompare(); };
    stageBody = el('div', { className: 'stage' },
      head,
      el('div', { className: 'compare', id: 'comparePanes' }),
      el('div', { className: 'stage-tools' },
        el('span', { className: 'note' }, 'Identity check — reference on the left, candidate on the right, both at this placement crop.'),
        el('div', { className: 'spacer' }), pick));
    setTimeout(paintCompare, 0);
  } else {
    stageBody = el('div', { className: 'stage' }, head, el('div', { className: 'viewport', id: 'viewport' }), stageTools(asset, surface, surfaces));
  }

  main.replaceChildren(el('div', { className: 'review' }, stageBody, renderRail(asset)));
  if (state.view !== 'compare') paintStage();
}

function stageTools(asset, surface, surfaces) {
  const tools = el('div', { className: 'stage-tools' });
  if (!surface) {
    tools.append(el('span', { className: 'note' }, 'Select at least one surface in the sidebar to crop and approve.'));
    return tools;
  }
  const p = ensurePlacement(asset, surface.id);
  const fills = el('div', { className: 'seg' });
  for (const [v, label] of [['crop', 'Crop'], ['blur', 'Blur fill'], ['contain', 'Letterbox']]) {
    const b = el('button', { className: p.fill === v ? 'on' : '' }, label);
    b.onclick = () => { mutate(asset, `${surface.label} fill → ${label}`, () => { p.fill = v; }); renderReview(); };
    fills.append(b);
  }
  const loupeBtn = btn('Loupe', 'btn sm' + (state.loupe ? ' on' : ''), () => {
    state.loupe = !state.loupe;
    if (!state.loupe) removeLoupe();
    renderReview();
  });
  const thirdsBtn = btn('Thirds', 'btn sm' + (state.thirds ? ' on' : ''), () => { state.thirds = !state.thirds; renderReview(); });

  tools.append(
    el('span', { className: 'note' }, `${surface.groupLabel} · ${surface.label}`),
    aria(btn('−', 'btn sm', () => { p.crop = zoomCrop(p.crop, 1 / 1.15); touchAsset(asset); paintStage(); renderIssuesOnly(); }), 'Zoom out'),
    aria(btn('+', 'btn sm', () => { p.crop = zoomCrop(p.crop, 1.15); touchAsset(asset); paintStage(); renderIssuesOnly(); }), 'Zoom in'),
    btn('Reset', 'btn sm', () => {
      p.crop = asset.width ? defaultCrop(asset.width, asset.height, surface) : { x: 0, y: 0, w: 1, h: 1 };
      touchAsset(asset); paintStage(); renderIssuesOnly();
    }),
    btn('Auto-reframe', 'btn sm', () => {
      if (!asset.auto?.energy) return toast('Run automated checks first.', true);
      mutate(asset, `auto-reframed ${surface.label}`, () => {
        p.crop = smartCrop(asset.auto.energy, asset.width, asset.height, surface, defaultCrop(asset.width, asset.height, surface), asset.geometry?.faces || []);
      });
      renderReview();
    }),
    fills, loupeBtn, thirdsBtn,
    el('div', { className: 'spacer' }),
    el('span', { className: 'note' }, surface.note || 'Drag to reframe · scroll to zoom'),
    el('span', { className: 'kbd' }, 'A R D'),
    el('span', { className: 'kbd' }, '?'));
  return tools;
}

// ---------------------------------------------------------------------------
// counters, preflight, exports

function renderCounters() {
  const surfaces = activeSurfaces();
  const pairs = approvedPairs(state.assets);
  const covered = new Set(pairs.map(p => p.surface.id));
  const gaps = surfaces.filter(s => !covered.has(s.id)).length;
  const unreviewed = state.assets.filter(a => a.status === 'unreviewed').length;
  const blocks = state.assets.reduce((n, a) => n + issueCount(a).block, 0);
  const cell = (k, v, flag) => el('span', { className: flag ? 'flag' : '' },
    el('span', { className: 'k' }, k), el('b', {}, String(v)));
  $('#counters').replaceChildren(
    cell('Assets', state.assets.length),
    cell('Unreviewed', unreviewed),
    cell('Approved', pairs.length),
    cell('Gaps', gaps, gaps > 0),
    cell('Blocking', blocks, blocks > 0));
}

function preflightDialog(onProceed) {
  const result = preflight(state.project, state.assets);
  const body = el('div', {});
  body.append(el('p', { className: 'hint' },
    result.blocks
      ? `${result.blocks} blocking issue(s) and ${result.warns} warning(s). Blocking issues are the ones that get an ad rejected or a client angry.`
      : `No blocking issues. ${result.warns} warning(s) to look at.`));
  body.append(issueList(result.items.slice(0, 60), 'Everything checks out.'));
  if (result.items.length > 60) body.append(el('p', { className: 'hint' }, `…and ${result.items.length - 60} more, all listed in the package.`));

  const override = el('input', { type: 'checkbox' });
  const proceed = btn(result.blocks ? 'Export anyway' : 'Export package', 'btn primary', () => { closeDialog(); onProceed(); });
  proceed.disabled = result.blocks > 0;
  override.onchange = () => { proceed.disabled = result.blocks > 0 && !override.checked; };

  dialog('Pre-flight', body, [
    result.blocks ? el('label', { className: 'toggle' }, override, 'I accept the blocking issues') : null,
    el('div', { className: 'spacer' }),
    btn('Cancel', 'btn', closeDialog),
    proceed
  ]);
}

async function doExport(exportOpts = {}) {
  if (!state.project) return;
  if (!approvedPairs(state.assets).length) return toast('Nothing approved yet \u2014 approve at least one placement.', true);
  if (!exportOpts.proof) {
    const lic = await activeLicense();
    if (!covers(lic, 'review')) {
      return dialog('Clean export is a licensed feature',
        el('div', {},
          el('p', {}, 'The free plan exports proof packages \u2014 full-frame watermark, capped resolution \u2014 which are perfect for internal review and client sign-off.'),
          el('p', { className: 'hint', style: 'margin-top:10px' },
            'A Review or Complete license unlocks clean, full-resolution packages. Enter your key in the Deliver panel, or get one from the pricing page.')),
        [btn('Export a proof instead', 'btn', () => { closeDialog(); doExport({ proof: true }); }),
         btn('Close', 'btn primary', closeDialog)]);
    }
  }
  preflightDialog(async () => {
    const pairs = approvedPairs(state.assets);
    const bar = el('i');
    const status = el('p', {}, `Rendering ${pairs.length} placement(s)…`);
    dialog(exportOpts.proof ? 'Export proof package — watermarked, 960px' : 'Export campaign package',
      el('div', {}, status, el('div', { className: 'progress' }, bar),
        exportOpts.proof ? el('p', { className: 'hint' }, 'Proofs carry a full-frame watermark and capped resolution — safe to send before payment clears. The licensed export renders clean.') : null),
      [btn('Close', 'btn', closeDialog)]);
    try {
      const extra = {
        'AUDIT.md': logMarkdown(state.assets),
        'PREFLIGHT.md': preflightMarkdown()
      };
      const { blob, filename, stats } = await busy(() =>
        buildPackage(state.project, state.assets, (done, total, name) => {
          status.textContent = `Rendering ${done} / ${total} — ${name}`;
          bar.style.width = `${(done / total) * 100}%`;
        }, extra, exportOpts));
      downloadBlob(blob, filename);
      status.textContent = `Done — ${stats.placements} placement(s), ${stats.files} files, ${(blob.size / 1048576).toFixed(1)} MB.`;
      if (stats.failures.length) {
        status.after(el('p', { style: 'color:var(--warn)' }, `${stats.failures.length} render(s) failed. See EXPORT_WARNINGS.txt inside the zip.`));
      }
    } catch (err) {
      status.textContent = 'Export failed: ' + err.message;
      status.style.color = 'var(--bad)';
    }
  });
}

function preflightMarkdown() {
  const r = preflight(state.project, state.assets);
  const L = ['# Pre-flight report', '', `Generated ${new Date().toLocaleString()}.`, '',
    `- Blocking: ${r.blocks}`, `- Warnings: ${r.warns}`, ''];
  if (!r.items.length) L.push('_Nothing flagged._');
  for (const i of r.items) {
    L.push(`- **${i.level.toUpperCase()}** — ${i.asset || 'project'}${i.surface ? ` · ${i.surface}` : ''} — ${i.message}${i.fix ? ` _(${i.fix})_` : ''}`);
  }
  return L.join('\n');
}

async function exportClientPage() {
  const pairs = approvedPairs(state.assets);
  if (!pairs.length) return toast('Approve something first — the client page shows approved placements.', true);
  const bar = el('i');
  const status = el('p', {}, 'Building…');
  dialog('Client review page', el('div', {}, status, el('div', { className: 'progress' }, bar),
    el('p', { className: 'hint' }, 'One HTML file with the images embedded. Email it. The client approves in their own browser and sends back a small JSON file you import here. No hosting, no accounts.')),
    [btn('Close', 'btn', closeDialog)]);
  try {
    const html = await busy(() => buildClientPage(state.project, state.assets, (n, total, name) => {
      status.textContent = `Embedding ${n} / ${total} — ${name}`;
      bar.style.width = `${(n / total) * 100}%`;
    }));
    const blob = new Blob([html], { type: 'text/html' });
    downloadBlob(blob, `${slug(state.project.name)}-client-review.html`);
    status.textContent = `Done — ${(blob.size / 1048576).toFixed(1)} MB, ${pairs.length} placement(s).`;
  } catch (err) {
    status.textContent = 'Failed: ' + err.message;
    status.style.color = 'var(--bad)';
  }
}

async function importVerdict(file) {
  try {
    const json = JSON.parse(await file.text());
    const { applied, missing, changed } = applyClientVerdict(json, state.assets);
    for (const a of changed) { log(a, `client decisions imported`, 'client'); await store.saveAsset(a); }
    render();
    toast(`Applied ${applied} client decision(s)${missing ? `, ${missing} skipped (asset not in this project)` : ''}.`);
  } catch (err) {
    toast('Could not read that file: ' + err.message, true);
  }
}

async function exportContactSheet() {
  const pairs = approvedPairs(state.assets);
  if (!pairs.length) return toast('Nothing approved yet.', true);
  const COLS = 4, CELL = 420, PAD = 24, LABEL = 46;
  const rows = Math.ceil(pairs.length / COLS);
  const canvas = el('canvas', { width: COLS * CELL + PAD * (COLS + 1), height: rows * (CELL + LABEL) + PAD * (rows + 1) + 90 });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0a0a0b'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#eeebe4';
  ctx.font = '300 34px Georgia, serif';
  ctx.fillText(state.project.name, PAD, 52);
  ctx.fillStyle = '#8b857c';
  ctx.font = '400 14px sans-serif';
  ctx.fillText(`${pairs.length} approved placements · ${new Date().toLocaleDateString()}`, PAD, 76);

  for (let i = 0; i < pairs.length; i++) {
    const { asset, surface, placement } = pairs[i];
    const d = await decode(asset);
    if (!d) continue;
    const col = i % COLS, row = Math.floor(i / COLS);
    const x = PAD + col * (CELL + PAD);
    const y = 90 + PAD + row * (CELL + LABEL + PAD);
    const thumbSurface = { ...surface, w: CELL, h: Math.round(CELL * (surface.h / surface.w)) };
    const shot = renderCrop(d.source, d.w, d.h, placement.crop, thumbSurface, placement.fill);
    const drawH = Math.min(CELL, thumbSurface.h);
    const drawW = Math.round(drawH * (surface.w / surface.h));
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, CELL, CELL);
    ctx.drawImage(shot, x + (CELL - drawW) / 2, y + (CELL - drawH) / 2, drawW, drawH);
    ctx.fillStyle = '#c9a86a';
    ctx.font = '400 11px sans-serif';
    ctx.fillText(`${surface.groupLabel} · ${surface.label}`.slice(0, 46), x, y + CELL + 18);
    ctx.fillStyle = '#8b857c';
    ctx.fillText(`${asset.filename}`.slice(0, 52), x, y + CELL + 34);
  }
  canvas.toBlob(b => {
    downloadBlob(b, `${slug(state.project.name)}-contact-sheet.png`);
    toast('Contact sheet saved.');
  }, 'image/png');
}

function showSummary() {
  const md = decisionsMarkdown(state.project, state.assets);
  dialog('Decision summary', el('pre', { className: 'report', textContent: md }), [
    btn('Close', 'btn', closeDialog),
    btn('Copy markdown', 'btn primary', () => navigator.clipboard.writeText(md).then(() => toast('Copied.')))
  ]);
}

function showHelp() {
  const keys = [
    ['← →', 'Previous / next asset'],
    ['A R D', 'Approve, revise, or deny the active placement'],
    ['1 – 9', 'Jump to that placement'],
    ['F', 'Toggle full-source view'],
    ['C', 'Toggle compare view'],
    ['L', 'Toggle the loupe (1:1 source pixels)'],
    ['T', 'Toggle thirds grid'],
    ['G', 'Auto-reframe the active placement'],
    ['B', 'Toggle board'],
    ['Ctrl+Z', 'Undo the last decision'],
    ['?', 'This list']
  ];
  const grid = el('div', { className: 'keyhelp' });
  for (const [k, v] of keys) grid.append(el('span', { className: 'kbd' }, k), el('span', {}, v));
  dialog('Keyboard', grid, [btn('Close', 'btn', closeDialog)]);
}

function undo() {
  const entry = popUndo();
  if (!entry) return toast('Nothing to undo.');
  if (entry.kind === 'asset') {
    const i = state.assets.findIndex(a => a.id === entry.id);
    if (i >= 0) { state.assets[i] = entry.data; store.saveAsset(entry.data); }
  } else {
    state.project = entry.data;
    store.saveProject(entry.data);
  }
  render();
  toast(`Undid: ${entry.label}`);
}

// ---------------------------------------------------------------------------

function render() {
  renderSidebar();
  renderCounters();
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode));
  if (state.mode === 'board') renderBoard(); else renderReview();
}

async function boot(selectId) {
  state.projects = await store.listProjects();
  if (!state.projects.length) {
    const p = newProject('First campaign');
    p.brief.brand = '';
    p.brief.campaignGoal = '';
    await store.saveProject(p);
    state.projects = [p];
  }
  const wanted = selectId || localStorage.getItem('cros:project');
  state.project = state.projects.find(p => p.id === wanted) || state.projects[0];
  // Remove credentials saved by the retired provider placeholder. Cloud keys
  // belong only in the future server-side secret store.
  if (Object.values(state.project.providers || {}).some(v => v?.key)) {
    state.project.providers = {};
    await store.saveProject(state.project);
  }
  localStorage.setItem('cros:project', state.project.id);
  state.assets = await store.listAssets(state.project.id);
  state.index = 0;
  state.decoded.clear();
  state.activeSurface = state.project.surfaces[0] || null;

  $('#projectSelect').replaceChildren(...state.projects.map(p =>
    el('option', { value: p.id, selected: p.id === state.project.id }, p.name)));
  render();
}

function wire() {
  $('#projectSelect').onchange = e => boot(e.target.value);
  $('#newProject').onclick = () => {
    const input = el('input', { type: 'text', placeholder: 'Campaign or client name' });
    dialog('New project', el('label', { className: 'field' }, el('span', {}, 'Project name'), input), [
      btn('Cancel', 'btn', closeDialog),
      btn('Create', 'btn primary', async () => {
        const p = newProject(input.value.trim() || 'Untitled project');
        await store.saveProject(p);
        closeDialog(); boot(p.id);
      })
    ]);
  };
  document.querySelectorAll('#modeSeg button').forEach(b => {
    b.onclick = () => { state.mode = b.dataset.mode; render(); };
  });
  $('#menuBtn').onclick = e => { e.stopPropagation(); $('#sidebar').classList.toggle('open'); };
  $('#main').addEventListener('pointerdown', () => $('#sidebar').classList.remove('open'));

  $('#themeBtn').onclick = () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('cros:theme', next);
  };

  $('#exportBtn').onclick = doExport;
  $('#helpBtn').onclick = showHelp;
  $('#fileInput').onchange = e => { importFiles(e.target.files); e.target.value = ''; };
  $('#recoveryInput').onchange = e => { const f = e.target.files?.[0]; if (f) restoreProject(f); e.target.value = ''; };
  $('#verdictInput').onchange = e => { if (e.target.files[0]) importVerdict(e.target.files[0]); e.target.value = ''; };

  let dragDepth = 0;
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('dragenter', e => {
    e.preventDefault();
    if (++dragDepth === 1) document.querySelector('.dropzone')?.classList.add('hot');
  });
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; document.querySelector('.dropzone')?.classList.remove('hot'); }
  });
  window.addEventListener('drop', e => {
    e.preventDefault(); dragDepth = 0;
    document.querySelector('.dropzone')?.classList.remove('hot');
    if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files);
  });

  window.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); return undo(); }
    if ($('#dlg').open) return;
    const asset = currentAsset();
    const assets = visibleAssets();
    const surfaces = activeSurfaces();

    if (e.shiftKey && /^[!@#$%]$/.test(e.key)) {
      const n = '!@#$%'.indexOf(e.key) + 1;
      if (asset) {
        mutate(asset, `rated ${asset.rating === n ? 0 : n}/5`, () => { asset.rating = asset.rating === n ? 0 : n; });
        renderReview();
      }
      e.preventDefault();
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      const s = surfaces[Number(e.key) - 1];
      if (s) { state.activeSurface = s.id; renderReview(); e.preventDefault(); }
      return;
    }
    switch (e.key.toLowerCase()) {
      case 'arrowright': if (assets.length) { state.index = (state.index + 1) % assets.length; renderReview(); } break;
      case 'arrowleft': if (assets.length) { state.index = (state.index - 1 + assets.length) % assets.length; renderReview(); } break;
      case 'a': if (asset && state.activeSurface) decidePlacement(asset, state.activeSurface, 'approved'); break;
      case 'r': if (asset && state.activeSurface) decidePlacement(asset, state.activeSurface, 'revise'); break;
      case 'd': if (asset && state.activeSurface) decidePlacement(asset, state.activeSurface, 'denied'); break;
      case 'f': state.view = state.view === 'source' ? 'placement' : 'source'; renderReview(); break;
      case 'c': state.view = state.view === 'compare' ? 'placement' : 'compare'; renderReview(); break;
      case 'l': state.loupe = !state.loupe; if (!state.loupe) removeLoupe(); renderReview(); break;
      case 't': state.thirds = !state.thirds; renderReview(); break;
      case 'g': if (asset) reframeAll(asset); break;
      case 'b': state.mode = state.mode === 'board' ? 'review' : 'board'; render(); break;
      case '?': case '/': showHelp(); break;
      default: return;
    }
    e.preventDefault();
  });

  window.addEventListener('beforeunload', e => {
    if (state.busy) { e.preventDefault(); e.returnValue = ''; }
  });
}

// Automation hook for the smoke suite. Off unless ?dev is in the URL, so it
// never exists in a normal session.
if (['localhost', '127.0.0.1', '::1'].includes(location.hostname) && new URLSearchParams(location.search).has('dev')) {
  window.__cros = {
    state, render, importFiles, runAnalysis, reframeAll, decidePlacement,
    preflight: () => preflight(state.project, state.assets),
    issueCount, visibleAssets, ensurePlacement
  };
}

wire();
boot();
