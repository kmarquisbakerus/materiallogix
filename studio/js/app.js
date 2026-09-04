import {
  SURFACE_GROUPS, SURFACE_BY_ID, ASSET_STATUSES, STATUS_BY_ID,
  ASSET_ROLES, QA_CHECKS, QA_BY_ID, QA_PRESETS, PRESET_BY_ID, FIX_PRESETS, SURFACE_PRESETS, REJECTION_REASONS,
  newProject, newAsset, newPlacement
} from './model.js';
import * as store from './store.js';
import {
  defaultCrop, clampCrop, zoomCrop, panCrop, snapToRatio, renderCrop, loadImage, grabVideoFrame,
  adjustmentFrame, placementRect
} from './crop.js';
import {
  analyzeAsset, assetIssues, placementIssues, preflight, smartCrop, captureCoverage, captureCoverageBody, cornerSignature, captureFrameQuality
} from './analyze.js';
import { buildPackage, decisionsMarkdown, approvedPairs, slug } from './export.js';
import { buildClientPage, applyClientVerdict } from './clientpage.js';
import { snapshot, snapshotProject, popUndo, clearUndo, log, logMarkdown } from './history.js';
import { downloadBlob, makeZip, readStoreZip } from './zip.js';
import { activeLicense, activate, activationFailureReason, deactivate, covers } from './license.js';
import { assessInpaintMaskedBoundary, blendInpaintMaskedCandidate,
  bridgeFetch, detectComfy, listCheckpoints, inspectInpaintCompatibility, generateOne, normalizeInpaintSelection,
  normalizeInpaintPath, summarizeInpaintMask, inpaintOne, listUpscaleModels, upscaleOne, detectBridge,
  upscaleViaBridge, localUpscaleModelLabel, localUpscaleEngineLabel,
  CPU_PRESETS, cpuJobSettings, estimateCpuSeconds, recordCpuPace, waitLabel } from './generate.js';
import { probeDevice, deviceSummary } from './device.js';
import { featureEnabled } from './features.js';
import { enabledAccountProviders, providerStartUrl } from './account-providers.js';
import { guidanceFor, ensureGuardianAck } from './capture-guidance.js';
import { screenPrompt } from './prompt-guard.js';
import { wordBudgetForSeconds } from './voice.js';
import { paceTrace, paceTraceSvg, runPaceGuide, paceTarget } from './capture-pacer.js';
import { analyzeGeometry } from './geometry.js';
import { CURVE_IDENTITY, buildLuminanceLut, ensureEditState, pixelGridReview, pixelGridOverlay } from './editing.js';
import { authorizeOutbound, settleOutbound, settleOutboundBeforeDelivery, voidOutbound } from './billing-client.js';
import { readableServiceError } from './service-error.js';
import { count } from './plural.js';
import { DEFAULT_VIDEO_SPEC, deliveryFrame, resolveVideoTrim } from './video-plan.js';
import { COLOR_PIPELINE, colorExportDecision, decodeColorManagedBlob } from './color-management.js';
import { PRINT_PPI, PRINT_PRESETS, encodePrintJpeg, planPrint, printColorDecision, renderPrint } from './print.js';
import { normalizeSpinIndex, stepSpinIndex, spinIndexFromDrag, spinStepFromWheel, spinAngleLabel } from './spin-viewer.js';
import { makeInpaintJobSpec, createInpaintBenchmark } from './inpaint-foundation.js';
import { quoteCloudJob, recordExport, includedCloudCents, exportForProduct, exportPrice, plansCovering, planLabel,
  laneFor, upscaleModelsForLane, LANES, exportUnits, unitsForDeliveries, deliveryRulesFor, requiresWatermark } from './pricing.js';
import { cloudVideoAvailability, submitCloudVideoPackage, watchCloudVideoJob, downloadCloudVideo } from './cloud-video.js';
import { videoEngineForThisCustomer, rememberEnginePreference, EDITORIAL_PROVENANCE } from './video-engine.js';
import { PRO_VIDEO_ENGINE, STANDARD_VIDEO_ENGINE } from './model-licence.js';
import { isImportableMediaFile, isRadianceFile, isRawCameraFile, prepareRawCameraImport } from './raw.js';
import { pricingUrl } from './site-links.js';

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
  view: 'source',             // 'source' | 'placement' | 'compare'
  compareWith: null,
  reviewRailTab: 'edit',
  loupe: false,
  loupeZoom: 1,
  editTool: null,              // null | 'heal' | 'brush' — stage input routes to the armed retouch tool
  healSize: 1.2,               // spot radius as a percentage of the frame width
  brushSize: 4,                // selective brush radius as a percentage of the frame width
  filters: { status: '', role: '', kind: '', surface: '', issues: '', rating: 0, q: '' },
  reviewer: localStorage.getItem('cros:reviewer') || 'reviewer',
  decoded: new Map(),         // assetId -> { source, w, h, url }
  busy: false
};
const localVideoJobs = new Map();
const VALID_PLACEMENT_FILL = new Set(['crop', 'contain', 'blur']);

function normalizePlacementFill(placement) {
  if (!placement || typeof placement !== 'object') return;
  if (!VALID_PLACEMENT_FILL.has(placement.fill)) {
    placement.fill = 'contain';
  }
  if (!placement.crop || typeof placement.crop.x !== 'number' || typeof placement.crop.y !== 'number' ||
      typeof placement.crop.w !== 'number' || typeof placement.crop.h !== 'number') {
    placement.crop = { x: 0, y: 0, w: 1, h: 1 };
  }
}

// ---------------------------------------------------------------------------
// small helpers

/**
 * The one region that announces. A live region has to be in the document
 * BEFORE its text changes: a node inserted already holding its message is
 * frequently not announced at all, which is what every toast did - including
 * the ones that are the product's only report of a failure.
 */
function announcer() {
  let region = document.getElementById('a11yAnnouncer');
  if (!region) {
    region = el('div', { id: 'a11yAnnouncer', className: 'sr-only' });
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    document.body.append(region);
  }
  return region;
}

function toast(msg, bad = false) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = el('div', { className: 'toast' + (bad ? ' bad' : ''), textContent: msg, role: 'status' });
  document.body.append(t);
  // Clearing first makes the same message twice a second announcement rather
  // than a no-op, which matters when a retry fails the same way.
  const region = announcer();
  region.setAttribute('aria-live', bad ? 'assertive' : 'polite');
  region.textContent = '';
  setTimeout(() => { region.textContent = msg; }, 60);
  setTimeout(() => t.remove(), bad ? 7000 : 2600);
}

/** Wraps long jobs so the tab-close guard and the cursor both know. */
async function busy(fn) {
  state.busy = true;
  document.body.style.cursor = 'progress';
  try { return await fn(); }
  finally { state.busy = false; document.body.style.cursor = ''; }
}

// Every dialog in the Studio is the one `<dialog id="dlg">`, retitled. So
// `dialog()` used to overwrite whatever was on screen in place, and
// `closeDialog()` closed whatever was on screen whoever asked for it: an import
// finishing shut the shortcuts panel the customer had opened, and a job's own
// question could be overwritten before it was read. Two rules fix both without
// a second element. A dialog opened over another covers it and hands it back
// when it closes, so nothing on screen is destroyed; and closing is scoped to
// the dialog that asked, so a job finishing long after the customer moved on
// can only ever close its own.
const dialogStack = [];   // the last entry is the one on screen
let stackClosings = 0;    // element closes the stack asked for, so the close
                          // event can tell them from one it did not

function paintDialog() {
  const d = $('#dlg');
  const top = dialogStack.at(-1);
  // `close` is delivered in a later task, by which time the caller may already
  // have opened the next dialog — "Export anyway" does exactly that — so the
  // stack counts its own closes rather than reading the event as an outside one.
  if (!top) { d.className = ''; if (d.open) { stackClosings += 1; d.close(); } return; }
  $('#dlgTitle').textContent = top.title;
  $('#dlgBody').replaceChildren(top.body);
  $('#dlgFoot').replaceChildren(...top.buttons);
  // The skin belongs to the dialog, not to the element they share.
  d.className = top.className;
  if (!d.open) d.showModal();
}

/**
 * Opens a dialog and returns a handle whose `close()` closes that one dialog
 * and nothing else. Use the handle anywhere the close happens after an await —
 * by then the customer has had time to open something of their own.
 */
function dialog(title, body, buttons, { className = '', onDismiss = null } = {}) {
  const entry = { title, body, buttons: buttons.filter(Boolean), className, onDismiss };
  dialogStack.push(entry);
  paintDialog();
  return { close: () => dismissDialog(entry) };
}

/** Drops one dialog wherever it is stacked; repaints only if it was on screen. */
function dismissDialog(entry) {
  const index = dialogStack.indexOf(entry);
  if (index < 0) return;
  dialogStack.splice(index, 1);
  if (index === dialogStack.length) paintDialog();
  entry.onDismiss?.();
}

/** For a button inside a dialog: the one on screen is the one it belongs to. */
const closeDialog = () => dismissDialog(dialogStack.at(-1));
const btn = (label, cls = 'btn', onclick) => {
  const b = el('button', { className: cls, type: 'button' }, label);
  if (onclick) b.onclick = onclick;
  return b;
};
/** Names a control whose visible label is a glyph. */
const aria = (node, label) => { node.setAttribute('aria-label', label); node.title = label; return node; };

/** A toggle's state. The `on` class is a background tint, which is nothing at
 * all to a screen reader and very little to a colour-blind reviewer. */
const pressed = (node, on) => { node.classList.toggle('on', !!on); node.setAttribute('aria-pressed', String(!!on)); return node; };

/** Close a fragment so two messages read as two sentences, never a run-on. */
const sentence = text => {
  const trimmed = String(text ?? '').trim();
  return !trimmed || /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

// Why `colorExportDecision` refused a delivery, in the words pre-flight uses
// and the words the failed export uses — they have to be the same words, or
// the gate and the refusal read as two different products.
const COLOR_EXPORT_BLOCKS = Object.freeze({
  color_profile_unknown: {
    reason: 'its colour profile has not been read',
    message: 'The colour profile of this asset has not been read, so it cannot be delivered as sRGB.',
    fix: 'Run the automated checks on it. If they cannot read the file, convert it and re-import.'
  },
  hdr_tone_map_required: {
    reason: 'HDR colour was signalled and no accepted tone map was applied',
    message: 'HDR color signaling was detected, but no accepted tone map was applied.',
    fix: 'Convert through the approved HDR-to-sRGB delivery path before export.'
  },
  display_p3_conversion_unverified: {
    reason: 'the accepted Display P3 to sRGB conversion did not complete',
    message: 'Display P3 was detected, but this decode did not complete the accepted sRGB conversion.',
    fix: 'Re-open the source in a supported browser or convert it to embedded sRGB.'
  },
  adobe_rgb_bundling_license_and_fixture_required: {
    reason: 'its wide-gamut profile licence and conversion fixture are not accepted',
    message: 'This wide-gamut source cannot be delivered until the profile license and encoded conversion fixture are accepted.',
    fix: 'Convert to embedded sRGB through a verified color-managed workflow, then re-import.'
  },
  cmyk_conversion_unaccepted: {
    reason: 'no accepted conversion exists for its CMYK profile',
    message: 'A CMYK source profile was detected, but no accepted conversion is available.',
    fix: 'Convert to sRGB through a verified color-managed workflow, then re-import.'
  },
  embedded_profile_unclassified: {
    reason: 'its embedded colour profile could not be classified safely',
    message: 'The embedded color profile could not be classified safely.',
    fix: 'Convert to embedded sRGB through a verified color-managed workflow, then re-import.'
  }
});

// Codes only the delivery and billing paths raise. `service-error.js` covers
// transport and the shared API vocabulary; these are the ones it has never
// been given a sentence for.
const DELIVERY_CODES = Object.freeze({
  authorization_required: 'this download needs a connection so the usage can be confirmed',
  online_authorization_required: 'this download needs a connection so the usage can be confirmed',
  authorization_failed: 'the usage for this download could not be confirmed',
  billing_request_failed: 'the billing service did not answer',
  license_required: 'no licence is active on this computer',
  usage_already_settled: 'this usage was already finalized'
});

/**
 * A failure as a fragment that reads after "… was not downloaded: ".
 *
 * The moment a delivery fails is the moment a paying customer has one sentence
 * to go on, so no path to the screen may carry a raw code.
 */
function deliveryReason(error) {
  const raw = String(error?.message ?? error ?? '').trim();
  // Own keys only: a message of "constructor" must not resolve to one.
  if (Object.hasOwn(DELIVERY_CODES, raw)) return DELIVERY_CODES[raw];
  if (raw.startsWith('color_export_blocked:')) {
    // `color_export_blocked:<filename>:<reason>`, and a filename may itself
    // contain a colon, so the reason is taken from the end.
    const rest = raw.slice('color_export_blocked:'.length);
    const cut = rest.lastIndexOf(':');
    const filename = cut > 0 ? rest.slice(0, cut) : rest;
    const code = cut > 0 ? rest.slice(cut + 1) : '';
    const block = Object.hasOwn(COLOR_EXPORT_BLOCKS, code) ? COLOR_EXPORT_BLOCKS[code] : null;
    return `${filename} cannot be delivered because ${block ? block.reason : 'its colour could not be accepted'}`;
  }
  return readableServiceError(error);
}

const svgEl = (tag, attrs = {}, ...kids) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const kid of kids) node.append(kid);
  return node;
};

// --- keyboard focus across a re-render -------------------------------------
// `replaceChildren` destroys the node the customer is standing on and the
// browser drops focus to <body>: twelve tabs back to "Next →" after every
// press of "Next →". The rebuilt tree shares no nodes with the old one, so the
// control is found again by what it is rather than by identity.

const FOCUS_SCOPES = ['#main', '#sidebar'];
const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/** Enough of a control's identity to recognise its replacement. */
function focusSignature(node) {
  if (node.id) return `#${node.id}`;
  // Deliberately not the class list: a toggle changes class on activation, and
  // the whole point is to find the control again after it was toggled.
  const label = node.getAttribute('aria-label') || node.name || node.title
    || (node.textContent || '').trim().slice(0, 60);
  return [node.tagName, node.type || '', label].join('|');
}

const focusablesIn = scope => [...($(scope)?.querySelectorAll(FOCUSABLE) || [])];

function captureFocus() {
  const node = document.activeElement;
  if (!node || node === document.body || $('#dlg').open) return null;
  const scope = FOCUS_SCOPES.find(sel => node.closest(sel));
  if (!scope) return null;
  const signature = focusSignature(node);
  // Sliders and unlabelled fields all sign the same; the ordinal separates them.
  const nth = focusablesIn(scope).filter(n => focusSignature(n) === signature).indexOf(node);
  return { scope, signature, nth };
}

function restoreFocus(mark) {
  // Only ever put focus back where this render took it from: anything else on
  // screen already has it for a reason.
  const now = document.activeElement;
  if (!mark || (now && now !== document.body && now !== document.documentElement)) return;
  focusablesIn(mark.scope).filter(n => focusSignature(n) === mark.signature)[mark.nth]?.focus({ preventScroll: true });
}

const pendingSaves = new Map();
function scheduleSave(key, save) {
  clearTimeout(pendingSaves.get(key)?.timer);
  const timer = setTimeout(() => { pendingSaves.delete(key); save(); }, 220);
  pendingSaves.set(key, { timer, save });
}
function flushPendingSaves() {
  for (const [, entry] of pendingSaves) { clearTimeout(entry.timer); entry.save(); }
  pendingSaves.clear();
}
function touchAsset(asset) {
  scheduleSave(`asset:${asset.id}`, () => store.saveAsset(asset));
}
function touchProject() {
  scheduleSave('project', () => store.saveProject(state.project));
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPendingSaves(); });

/** Every state change to an asset goes through here: undo + audit for free. */
function mutate(asset, label, fn) {
  snapshot(asset, label);
  fn();
  log(asset, label, state.reviewer);
  touchAsset(asset);
}

const activeSurfaces = () => (state.project?.surfaces || []).map(id => SURFACE_BY_ID[id]).filter(Boolean);
/** Surfaces an asset can actually ship to: TikTok placements are video-only,
 * so stills must never see them in the stage, shortcuts, or auto-reframe. */
const surfacesForAsset = asset => activeSurfaces().filter(surface => asset?.kind === 'video' || surface.group !== 'tiktok');

function ensurePlacement(asset, surfaceId) {
  if (!asset.placements[surfaceId]) {
    const p = newPlacement();
    // A new placement starts with the complete source visible. Cropping is an
    // explicit choice so Photo and Video never look stretched on first open.
    p.crop = { x: 0, y: 0, w: 1, h: 1 };
    p.fill = 'contain';
    asset.placements[surfaceId] = p;
  } else {
    normalizePlacementFill(asset.placements[surfaceId]);
  }
  normalizePlacementFill(asset.placements[surfaceId]);
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

// Five decodes, but bounded by what they weigh rather than by how many there
// are: a decode is held as RGBA, so one 100 MP photograph is about 400 MB and
// five of them are two gigabytes. Counting entries made the ceiling depend
// entirely on the customer's camera.
const DECODE_CACHE = 5;
const DECODE_CACHE_BYTES = 512 * 1024 * 1024;
const decodedWeight = entry => (Number(entry?.w) || 0) * (Number(entry?.h) || 0) * 4;

/** Drop decodes until the cache is within both bounds, oldest first. */
function trimDecodeCache() {
  let held = 0;
  for (const entry of state.decoded.values()) held += decodedWeight(entry);
  while (state.decoded.size > DECODE_CACHE || (held > DECODE_CACHE_BYTES && state.decoded.size > 1)) {
    const oldest = state.decoded.keys().next().value;
    held -= decodedWeight(state.decoded.get(oldest));
    releaseDecoded(oldest);
  }
}

/** Forget one decode, and let go of the object URL it was holding. */
function releaseDecoded(assetId) {
  const entry = state.decoded.get(assetId);
  if (!entry) return;
  state.decoded.delete(assetId);
  // The bitmap is the expensive part and only the collector can free it, but
  // closing it tells the engine now rather than at the next collection.
  entry.source?.close?.();
}

/** Everything the current asset set no longer covers. */
function forgetDecodesOutside(assetIds) {
  const live = new Set(assetIds);
  for (const id of [...state.decoded.keys()]) if (!live.has(id)) releaseDecoded(id);
}

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
        // A poster time is seconds into the clip, so it has to be a finite
        // number: a container that reports no length gets frame zero.
        t = Number.isFinite(frame.duration) && frame.duration > 1 ? +(frame.duration * 0.3).toFixed(2) : 0;
        if (t > 0) frame = await grabVideoFrame(url, t);
        asset.video.posterTime = t;
        await store.saveAsset(asset);
      }
      d = { source: frame.canvas, w: frame.width, h: frame.height, url, duration: frame.duration };
    } else {
      const blob = await store.getBlob(asset.id);
      const managed = await decodeColorManagedBlob(blob);
      if (managed) d = { ...managed, url };
      else {
        const img = await loadImage(url);
        d = { source: img, w: img.naturalWidth, h: img.naturalHeight, url };
      }
    }
  } catch {
    return null;
  }
  let repaired = false;
  if (!asset.width && d.w) { asset.width = d.w; asset.height = d.h; repaired = true; }
  // A clip imported before its container's length could be read carries no
  // usable duration on its record, and trim, pricing and the plan all read it
  // from there. Decoding is the moment the real length is known.
  if (Number.isFinite(d.duration) && d.duration > 0 && !(asset.duration > 0)) {
    asset.duration = d.duration; repaired = true;
  }
  if (repaired) await store.saveAsset(asset);
  state.decoded.set(asset.id, d);
  trimDecodeCache();
  return d;
}

async function runAnalysis(asset, { quiet = false } = {}) {
  const d = await decode(asset);
  if (!d) { if (!quiet) toast(`Could not decode ${asset.filename}.`, true); return null; }
  const blob = await store.getBlob(asset.id);
  asset.auto = await analyzeAsset(d.source, d.w, d.h, blob, d.colorTransform || null);
  const clipSeconds = d.duration || asset.duration;
  if (asset.kind === 'video' && Number.isFinite(clipSeconds) && clipSeconds > 0) {
    const duration = clipSeconds;
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
  asset.peopleReview = {
    status: asset.geometry ? 'complete' : 'manual-review-needed',
    faces: asset.geometry?.faces?.length || 0,
    hands: asset.geometry?.hands?.length || 0,
    bodies: asset.geometry?.poses?.length || (asset.geometry?.body ? 1 : 0),
    reviewedAt: new Date().toISOString()
  };
  await store.saveAsset(asset);
  return asset.auto;
}

async function analyzeAll() {
  const pending = state.assets.filter(a => !a.auto);
  // "Already analysed" is vacuously true of an empty library and reads as a
  // fault: nothing has been analysed, because there is nothing to analyse.
  if (!pending.length) return toast(state.assets.length
    ? 'Every asset has already been analysed.'
    : 'Nothing to check yet — import or generate a photo first.');
  const bar = el('i');
  const status = el('p', {}, `Analysing ${count(pending.length, 'asset')}…`);
  const progress = dialog('Automated checks', el('div', {}, status, el('div', { className: 'progress' }, bar)),
    [btn('Close', 'btn', closeDialog)]);
  try {
    await busy(async () => {
      let n = 0;
      for (const a of pending) {
        status.textContent = `Analysing ${++n} / ${pending.length} — ${a.filename}`;
        bar.style.width = `${(n / pending.length) * 100}%`;
        await runAnalysis(a, { quiet: true });
      }
    });
  } catch (error) {
    progress.close();
    render();
    toast(error?.message ? sentence(deliveryReason(error)) : 'Analysis stopped early. Already-analysed assets kept their results.', true);
    return;
  }
  status.textContent = `Done. ${count(pending.length, 'asset')} analysed.`;
  render();
}

// ---------------------------------------------------------------------------
// import

// `reason` is why nothing could be measured, so the import can say so instead
// of storing a row that renders a blank stage forever.
async function probe(file, url) {
  try {
    if (file.type.startsWith('video')) {
      const { width, height, duration } = await grabVideoFrame(url, 0);
      return { width, height, duration: Number.isFinite(duration) ? duration : 0, reason: '' };
    }
    const managed = await decodeColorManagedBlob(file);
    if (managed) return { width: managed.w, height: managed.h, duration: 0, reason: '' };
    const img = await loadImage(url);
    return { width: img.naturalWidth, height: img.naturalHeight, duration: 0, reason: '' };
  } catch (error) {
    return { width: 0, height: 0, duration: 0, reason: sentence(error?.message || 'this browser could not read it') };
  }
}

// A refusal has to name the gesture the customer actually made. One sentence
// served both the drop target and the file picker, so choosing a file through
// the picker was told there were no media files "in that drop".
const IMPORT_REFUSALS = Object.freeze({
  drop: 'No supported photo or video files in that drop.',
  picker: 'No supported photo or video files in that selection.'
});

async function importFiles(fileList, gesture = 'picker') {
  const files = [...fileList].filter(isImportableMediaFile);
  if (!files.length) return toast(IMPORT_REFUSALS[gesture] || IMPORT_REFUSALS.picker, true);

  const bar = el('i');
  const status = el('p', {}, `Importing ${count(files.length, 'file')}…`);
  const progress = dialog('Import', el('div', {}, status, el('div', { className: 'progress' }, bar)), [btn('Close', 'btn', closeDialog)]);

  let imported = 0, blocked = 0;
  try {
  await busy(async () => {
    let n = 0;
    let lastBlockedMessage = '';
    for (const sourceFile of files) {
      status.textContent = `Importing ${++n} / ${files.length} — ${sourceFile.name}`;
      bar.style.width = `${(n / files.length) * 100}%`;
      let file = sourceFile;
      let rawImport = null;
      if (isRawCameraFile(sourceFile)) {
        rawImport = await prepareRawCameraImport(sourceFile);
        if (!rawImport.ok) {
          blocked += 1;
          lastBlockedMessage = rawImport.message;
          status.textContent = rawImport.message;
          continue;
        }
        file = rawImport.file;
      }
      const asset = newAsset(state.project.id, file);
      if (!file.type && isRadianceFile(file)) asset.mime = 'image/vnd.radiance';
      if (rawImport?.ok) {
        asset.source = 'camera-raw-import';
        asset.rawImport = rawImport.provenance;
        asset.provenance = rawImport.mode === 'embedded-preview'
          ? 'Imported from the finished JPEG the camera stored inside this RAW file. Full RAW development unlocks once the verified offline decoder packet is installed.'
          : 'Camera RAW converted inside Studio from a verified offline decoder packet.';
      }
      await store.addAsset(asset, file);
      const url = await store.objectUrl(asset.id);
      const measured = rawImport?.ok && rawImport.width && rawImport.height
        ? { width: rawImport.width, height: rawImport.height, duration: 0, reason: '' }
        : await probe(file, url);
      // Nothing without pixels can be reviewed, cropped or exported. Keeping it
      // means a library row with a blank stage forever, so it is refused here,
      // with the reason, rather than stored and forgotten.
      //
      // This used to say `asset.kind === 'video'`, and a photograph past the
      // browser's decode ceiling took the other branch: stored at 0x0, never
      // analysed, reporting no issues because there were no pixels to find any
      // in - under a toast that said it had been imported and analysed.
      if (!(measured.width && measured.height)) {
        await store.deleteAsset(asset.id).catch(() => {});
        blocked += 1;
        // Advice that does not fit the file is worse than none: a 0-byte or
        // truncated file was being told to reduce its dimensions. Size is the
        // one thing that separates "too big for the browser" from "not really
        // a picture", so let it choose.
        const oversized = asset.kind === 'image' && sourceFile.size > 24 * 1024 * 1024;
        const why = measured.reason || (asset.kind === 'video'
          ? 'No frame could be decoded from it.'
          : 'The browser could not read any pixels from it.');
        const advice = asset.kind === 'video' ? 'Convert it and re-import.'
          : oversized ? 'Very large photographs can exceed the browser\u2019s limit \u2014 reduce its dimensions and re-import.'
            : 'Check it opens elsewhere, then re-import.';
        lastBlockedMessage = `${sourceFile.name} was not imported. ${why} ${advice}`;
        status.textContent = lastBlockedMessage;
        continue;
      }
      Object.assign(asset, { width: measured.width, height: measured.height, duration: measured.duration });
      const sourceLabel = rawImport?.ok ? `camera RAW from ${sourceFile.name}` : (file.type || 'unknown type');
      log(asset, `imported (${sourceLabel}, ${(sourceFile.size / 1048576).toFixed(1)} MB)`, state.reviewer);
      await store.saveAsset(asset);
      state.assets.push(asset);
      await runAnalysis(asset, { quiet: true });
      imported += 1;
    }
    if (!imported && blocked) {
      throw new Error(lastBlockedMessage || 'Camera RAW import needs setup before Studio can open that file.');
    }
  });
  } catch (error) {
    progress.close();
    state.assets = await store.listAssets(state.project.id).catch(() => state.assets);
    render();
    toast(error?.message ? sentence(deliveryReason(error)) : 'Import failed. Files already imported are safe in the library.', true);
    return;
  }
  state.assets = await store.listAssets(state.project.id);
  forgetDecodesOutside(state.assets.map(a => a.id));
  progress.close();
  render();
  toast(`Imported and analysed ${count(imported, 'file')}.${blocked ? ` ${count(blocked, 'file')} ${blocked === 1 ? 'was' : 'were'} blocked.` : ''}`);
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

function photoWorkflowSteps(active = 1) {
  return el('ol', { className: 'photo-flow', ariaLabel: 'Photo workflow' },
    ...['Create or open', 'Review', 'Edit', 'Quality check', 'Export'].map((label, index) =>
      el('li', { className: index + 1 === active ? 'active' : index + 1 < active ? 'complete' : '' },
        el('span', {}, String(index + 1)), label)));
}

// Held so the generation that finishes can close this dialog and only this
// dialog; the same panel also lives in the sidebar, where there is none to close.
let photoCreationDialog = null;

function openPhotoCreationDialog() {
  // From the start page, generation deserves the centre of the screen —
  // not a drawer. The dialog closes itself when the photos arrive.
  photoCreationDialog = dialog('Generate a photo', generatePanel(), [btn('Close', 'btn', closeDialog)],
    { className: 'generate-dialog' });
}

function openPhotoCreation() {
  const sidebar = $('#sidebar');
  sidebar.classList.remove('closed');
  sidebar.classList.add('open');
  $('#menuBtn').setAttribute('aria-expanded', 'true');
  const start = sidebar.querySelector('[data-photo-start]');
  if (start) start.open = true;
  const generation = sidebar.querySelector('[data-photo-generation]');
  if (generation) generation.open = true;
  requestAnimationFrame(() => generation?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

async function reviewPeople(asset) {
  if (!asset) return toast('Create or open a photo first.', true);
  await busy(() => runAnalysis(asset));
  state.reviewRailTab = 'review';
  localStorage.setItem(REVIEW_RAIL_OPEN_KEY, 'true');
  renderReview();
  const review = asset.peopleReview;
  toast(review.status === 'complete'
    ? `People review complete: ${review.faces} face${review.faces === 1 ? '' : 's'}, ${review.hands} hand${review.hands === 1 ? '' : 's'}, ${review.bodies} bod${review.bodies === 1 ? 'y' : 'ies'}.`
    : 'Automatic people review is unavailable; inspect faces, hands, and bodies manually.');
}

// --- generation panel: local GPU now, BYO key and managed tiers later ------

let comfyStatus = null;   // cached detection result for this session
// Owner-authorized local customer preview. Beta stays explicit because the real
// fixture still needs final human boundary acceptance; compatibility remains
// fail-closed and the original is always preserved.
const GENERATIVE_FILL_RELEASE = 'beta';

function generatePanel() {
  const wrap = el('div', {});

  const local = el('div', { style: 'margin-bottom:16px' });
  wrap.append(local);

  const renderLocal = async (force = false) => {
    const savedBase = localStorage.getItem('cros:comfyBase') || `http://${location.hostname}:8188`;
    if (!comfyStatus || force) {
      local.replaceChildren(el('p', { className: 'hint' }, 'Checking Photo creation\u2026'));
      comfyStatus = await detectComfy(savedBase);
    }
    if (!comfyStatus.ok) {
      const baseInput = el('input', { type: 'text', value: savedBase, placeholder: 'http://127.0.0.1:8188' });
      baseInput.onchange = () => localStorage.setItem('cros:comfyBase', baseInput.value.trim() || 'http://127.0.0.1:8188');
      const phoneConnection = el('details', { className: 'connection-details' },
        el('summary', {}, 'Phone connection'),
        el('p', { className: 'hint' }, 'Enter the Wi-Fi address shown by MaterialLogix to control Studio from your phone and run guided face, hand, and body scans.'),
        el('label', { className: 'field' }, el('span', {}, 'Wi-Fi address'), baseInput));
      const routes = el('div', {});
      local.replaceChildren(
        el('p', { className: 'hint' }, 'Photo creation needs setup before you can generate an image.'),
        routes,
        phoneConnection,
        btn('Try again', 'btn sm', () => renderLocal(true)));

      // Fastest first: another computer already running Studio, then this one.
      const [bridge, device] = await Promise.all([detectBridge(), probeDevice().catch(() => null)]);
      if (bridge.ok) {
        baseInput.value = bridge.base;
        localStorage.setItem('cros:comfyBase', bridge.base);
        routes.replaceChildren(
          el('p', { className: 'hint' }, 'MaterialLogix is running on another computer here. That one is fastest.'),
          btn('Use that computer', 'btn primary sm', () => renderLocal(true)));
        return;
      }
      const onMac = /mac/i.test(`${navigator.userAgentData?.platform || navigator.platform || ''} ${navigator.userAgent || ''}`);
      if (onMac && await featureEnabled('mac_byo_engine')) {
        routes.replaceChildren(macEngineSetup(() => renderLocal(true)));
        return;
      }
      const lines = ['Install MaterialLogix for Windows to create photos on this computer.'];
      if (device && device.verdict === 'draft-capable') {
        lines.push('Your graphics card works here. Renders come back in seconds.');
      } else if (device) {
        lines.push('No graphics card Studio can use. Photos render on the processor, a minute or two each.');
        lines.push(deviceSummary(device));
      }
      routes.replaceChildren(...lines.map(text => el('p', { className: 'hint' }, text)));
      return;
    }
    let ckpts = [];
    try { ckpts = await listCheckpoints(comfyStatus.base); } catch { /* handled below */ }
    const head = el('p', { className: 'hint' }, comfyStatus.cpuOnly
      ? `Photo creation is ready on ${comfyStatus.device}.`
      : 'Photo creation is ready.');
    if (!ckpts.length) {
      local.replaceChildren(head,
        el('p', { className: 'hint' }, 'Add a Photo quality pack, then try again.'),
        btn('Try again', 'btn sm', () => renderLocal(true)));
      return;
    }
    const unlicensed = !covers(await activeLicense(), 'photo');
    const ckptSel = el('select', {});
    for (const [index, c] of ckpts.entries()) ckptSel.append(el('option', { value: c }, `Studio quality ${index + 1}`));
    const promptBox = el('textarea', { placeholder: 'What to generate. Wording from the brief helps.', rows: 3 });
    const negBox = el('input', { type: 'text', placeholder: 'Avoid (optional)', value: state.project.brief.mustAvoid || '' });
    const styleSel = el('select', {},
      el('option', { value: 'natural' }, 'Photographic · believable by default'),
      el('option', { value: 'film' }, 'Film · adds grain and highlight roll-off'),
      el('option', { value: 'stylized' }, 'Stylized · follow my direction'));
    // Shape only. Pixels and timing live on one line below, so the list
    // stays short and nothing in it can go stale.
    const SIZES = [
      ['1024x1024', 'Social square'],
      ['832x1216', 'Phone portrait'],
      ['1216x832', 'Wide banner']
    ];
    const sizeSel = el('select', {});
    for (const [value, name] of SIZES) sizeSel.append(el('option', { value }, name));
    const countSel = el('select', {});
    for (const n of [1, 2, 4]) countSel.append(el('option', { value: String(n) }, `${n} image${n > 1 ? 's' : ''}`));
    const status = el('p', { className: 'hint', style: 'margin:8px 0 0' }, '');

    // No graphics card: same engine, but the customer picks speed over polish
    // and sees a real clock instead of a spinner.
    const speedSel = el('select', {});
    for (const [value, preset] of Object.entries(CPU_PRESETS)) {
      speedSel.append(el('option', { value }, preset.label));
    }
    const outputNote = el('p', { className: 'hint' }, '');
    const jobPlan = () => {
      const [w, h] = sizeSel.value.split('x').map(Number);
      if (!comfyStatus.cpuOnly) return { width: w, height: h, steps: undefined, seconds: 0 };
      const fit = cpuJobSettings(speedSel.value, w, h);
      const { seconds, measured } = estimateCpuSeconds(fit.steps, fit.width, fit.height, navigator.hardwareConcurrency || 4);
      return { ...fit, seconds, measured };
    };
    // One line, after both choices: what this makes and how long it takes.
    const refreshOutput = () => {
      const plan = jobPlan();
      const size = `${plan.width} \u00d7 ${plan.height}`;
      if (!comfyStatus.cpuOnly) { outputNote.textContent = `Makes ${size}.`; return; }
      outputNote.textContent = plan.measured
        ? `Makes ${size} in ${waitLabel(plan.seconds)}, measured on this computer.`
        : `Makes ${size} in roughly ${waitLabel(plan.seconds)}. Your first render sets the real number.`;
    };
    speedSel.onchange = refreshOutput;
    sizeSel.onchange = refreshOutput;
    refreshOutput();

    const go = btn('Generate photos', 'btn primary', async () => {
      const count = Number(countSel.value);
      // Every prompt is screened before any GPU time is spent on it.
      const screen = screenPrompt(promptBox.value, { recent: state.recentPrompts || [] });
      if (!screen.ok) { status.textContent = screen.reason; toast(screen.reason, true); return; }
      state.recentPrompts = [...(state.recentPrompts || []), screen.normalized].slice(-20);
      go.disabled = true;
      let ticker = null;
      let reserved = null;       // the image being created, until it settles
      try {
        await busy(async () => {
          for (let i = 0; i < count; i++) {
            const plan = jobPlan();
            const label = `Image ${i + 1} of ${count}`;
            status.textContent = `${label} \u2014 queued\u2026`;
            // Creating an image is a licensed Photo capability and a local
            // production job, metered exactly like enhancement and Generative
            // Fill. This was the one generative path that reserved nothing, so
            // a visitor with no licence at all generated without limit.
            const authorization = await authorizeOutbound({ product: 'photo', artifactKind: 'upload', quantity: 1 });
            if (!authorization.ok) throw new Error(authorization.reason || 'authorization_required');
            reserved = authorization.authorization.id;
            const startedAt = Date.now();
            const tick = () => {
              const elapsed = Math.round((Date.now() - startedAt) / 1000);
              const mins = Math.floor(elapsed / 60), secs = String(elapsed % 60).padStart(2, '0');
              status.textContent = comfyStatus.cpuOnly
                ? `${label} \u2014 creating\u2026 ${mins}:${secs} elapsed. It is safe to leave this open.`
                : `${label} \u2014 creating\u2026`;
            };
            const { blob, seed } = await generateOne({
              ckpt: ckptSel.value,
              prompt: promptBox.value,
              negative: negBox.value,
              styleIntent: styleSel.value,
              width: plan.width, height: plan.height, steps: plan.steps
            }, () => {
              if (!ticker) { tick(); ticker = setInterval(tick, 1000); }
            }, comfyStatus.base, comfyStatus.cpuOnly ? 45 : 10);
            if (ticker) { clearInterval(ticker); ticker = null; }
            if (comfyStatus.cpuOnly) {
              recordCpuPace((Date.now() - startedAt) / 1000, plan.steps, plan.width, plan.height);
              refreshSpeedNote();
            }
            await settleOutbound(reserved, await blobEvidenceHash(blob));
            reserved = null;
            const file = new File([blob], `gen_${seed}_${i + 1}.png`, { type: 'image/png' });
            const asset = newAsset(state.project.id, file);
            asset.source = 'generated-local';
            asset.provenance = `Created in MaterialLogix (seed ${seed}; ${styleSel.value} style intent; ${plan.width}\u00d7${plan.height} on ${comfyStatus.cpuOnly ? 'the processor' : comfyStatus.device}). Prompt: ${promptBox.value.slice(0, 300)}`;
            await store.addAsset(asset, file);
            const url = await store.objectUrl(asset.id);
            Object.assign(asset, await probe(file, url));
            log(asset, 'created in Studio', state.reviewer);
            await store.saveAsset(asset);
            state.assets.push(asset);
            await runAnalysis(asset, { quiet: true });
          }
        });
        state.assets = await store.listAssets(state.project.id);
        forgetDecodesOutside(state.assets.map(a => a.id));
        status.textContent = `Done \u2014 ${count} photo${count === 1 ? '' : 's'} added and checked.`;
        render();
        // Only the dialog this panel was opened in, and only if it is still up —
        // never whatever the customer opened while the render was running.
        photoCreationDialog?.close();
        toast(`Created ${count} candidate${count === 1 ? '' : 's'}.`);
      } catch (err) {
        const release = reserved ? await releaseUsage(reserved, 'render_failed') : null;
        status.textContent = `Failed: ${sentence(deliveryReason(err))}${release ? ` ${release.message}` : ''}`;
      } finally {
        if (ticker) clearInterval(ticker);
        go.disabled = false;
      }
    });
    local.replaceChildren(head,
      ...(unlicensed ? [el('p', { className: 'hint', style: 'color:var(--warn)' },
        'Photo creation runs on this computer and draws no cloud balance, but it is a licensed Photo capability. Activate a Photo Single Studio or Full Studio licence in Deliver.')] : []),
      el('label', { className: 'field' }, el('span', {}, 'Quality'), ckptSel),
      el('label', { className: 'field' }, el('span', {}, 'Describe your image'), promptBox),
      el('label', { className: 'field' }, el('span', {}, 'Look'), styleSel),
      el('p', { className: 'hint' }, 'Photographic keeps people and materials believable unless your direction asks for a stylized result.'),
      el('label', { className: 'field' }, el('span', {}, 'Avoid'), negBox),
      el('div', { style: 'display:flex;gap:8px' },
        el('label', { className: 'field', style: 'flex:1' }, el('span', {}, 'Size'), sizeSel),
        el('label', { className: 'field', style: 'flex:1' }, el('span', {}, 'Count'), countSel)),
      ...(comfyStatus.cpuOnly
        ? [el('label', { className: 'field' }, el('span', {}, 'Speed'), speedSel)]
        : []),
      outputNote,
      go, status);
  };
  renderLocal();

  return wrap;
}

// Set when the Mac packets are published.
const MAC_PACKET_URL = '';
const MAC_PACKET_LITE_URL = '';

// The signed Mac app is not out yet. The packet runs Studio from the Mac
// itself, which is what keeps every browser working.
function macEngineSetup(onConnected) {
  const command = 'python main.py --enable-cors-header ' + location.origin;
  const commandBox = el('code', { className: 'setup-command' }, command);
  const copy = btn('Copy command', 'btn sm', async () => {
    try {
      await navigator.clipboard.writeText(command);
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy command'; }, 2000);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(commandBox);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });
  if (!MAC_PACKET_URL) {
    return el('div', {},
      el('p', { className: 'hint' }, 'Studio runs on your Mac through ComfyUI.'),
      el('div', { className: 'setup-command-row' }, commandBox, copy),
      btn('Connect', 'btn primary sm', onConnected),
      el('details', { className: 'connection-details' },
        el('summary', {}, 'Setting this up'),
        el('ol', { className: 'setup-steps' },
          el('li', {}, 'Install ComfyUI for Apple silicon.'),
          el('li', {}, 'Start it with the command above.'),
          el('li', {}, 'Add a Photo quality pack, then connect.')),
        el('p', { className: 'hint' }, 'Runs on your graphics card. Nothing leaves the Mac.'),
        el('p', { className: 'hint' }, 'Chrome for now. Safari can block the connection.')));
  }
  return el('div', {},
    el('p', { className: 'hint' }, 'Download MaterialLogix for Mac.'),
    el('div', { className: 'setup-choice' },
      el('a', { className: 'btn primary sm', href: MAC_PACKET_URL }, 'With the engine'),
      el('a', { className: 'btn sm', href: MAC_PACKET_LITE_URL || MAC_PACKET_URL }, 'Without it')),
    el('details', { className: 'connection-details' },
      el('summary', {}, 'Which one'),
      el('p', { className: 'hint' }, 'The engine makes the photos. Without it Studio still reviews, edits, and exports.'),
      el('p', { className: 'hint' }, 'With the engine is one file and nothing else to install. Without it is a small file, and Studio fetches the engine the first time you create.'),
      el('p', { className: 'hint' }, 'Runs on your graphics card. Nothing leaves the Mac.')),
    btn('Connect', 'btn primary sm', onConnected));
}

function localToolsPanel() {
  const wrap = el('div', {});
  const status = el('div', {}, el('p', { className: 'hint' }, 'Checking this computer…'));
  wrap.append(status);

  const statusRow = (label, ready, detail = '') => el('p', {
    className: 'hint',
    style: 'display:flex;gap:8px;align-items:flex-start;margin:0 0 7px'
  },
  el('strong', { style: `min-width:58px;color:${ready ? 'var(--ok)' : 'var(--muted)'}` }, ready ? 'Ready' : 'Optional'),
  el('span', {}, label, detail ? ` · ${detail}` : ''));

  const refresh = async () => {
    const bridge = await detectBridge();
    if (!bridge.ok) {
      status.replaceChildren(
        el('p', { className: 'hint' }, 'Open MaterialLogix Studio on your computer to manage creative tools.'));
      return;
    }
    const video = bridge.video || {};
    const rows = [
      statusRow('Photo enhancement', !!bridge.upscale?.available),
      statusRow('Video editing and delivery', !!video.ffmpeg),
      statusRow('Automatic captions', !!video.whisper),
      statusRow('Smooth motion', !!video.rife),
      statusRow('House Voice', !!bridge.voice?.available),
    ];
    const missingVideoPack = !video.whisper || !video.rife;
    if (missingVideoPack) {
      rows.push(el('p', { className: 'hint', style: 'margin:10px 0' },
        'Add the optional Video pack for captions and smoother motion.'));
      rows.push(btn('Add captions + smooth motion', 'btn sm', () => {
        const consent = el('input', { type: 'checkbox' });
        const close = btn('Cancel', 'btn', closeDialog);
        const message = el('p', { className: 'hint', role: 'status' },
          'Nothing will render during setup. Keep Studio open while the verified files download and install.');
        const install = btn('Install Video tools', 'btn primary', async () => {
          if (!consent.checked) return;
          install.disabled = true;
          message.textContent = 'Downloading and verifying the Video pack…';
          try {
            const response = await bridgeFetch(`${bridge.base}/engines/video/install`, { method: 'POST' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || `setup ${response.status}`);
            message.textContent = 'Captions and smooth motion are ready on this computer.';
            await refresh();
            install.textContent = 'Installed';
            close.textContent = 'Close';
            toast('Video tools are ready.');
          } catch (error) {
            install.disabled = false;
            message.textContent = `Setup stopped safely: ${sentence(deliveryReason(error))}`;
          }
        });
        install.disabled = true;
        consent.onchange = () => { install.disabled = !consent.checked; };
        dialog('Add Video tools', el('div', {},
          el('p', {}, 'Adds automatic captions and smoother motion to Video Studio.'),
          el('p', { className: 'hint' }, 'Needs up to 588 MB to download and about 225 MB after installation.'),
          el('label', { className: 'checkline' }, consent,
            el('span', {}, 'Download and install the optional Video pack.')),
          message), [close, install]);
      }));
    } else {
      rows.push(el('p', { className: 'hint', style: 'margin:10px 0 0;color:var(--ok)' },
        'Creative tools are ready.'));
    }
    status.replaceChildren(...rows);
  };
  refresh();
  return wrap;
}

/** Load the product-made QA proof in both the packaged app and source checkout. */
async function loadDemo() {
  // One canonical location: the proof ships with the app's own assets in
  // every layout, so there is nothing to hunt for.
  const files = [];
  try {
    const r = await fetch('assets/upscale-qa.png');
    if (r.ok) {
      const b = await r.blob();
      files.push(new File([b], 'upscale-qa.png', { type: b.type || 'image/png' }));
    }
  } catch { /* handled below */ }
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

  bar.classList.remove('dock-right');
  localStorage.removeItem('mlx:settings-dock');
  const closeSidebar = btn('Close', 'btn sm', () => {
    bar.classList.remove('open');
    bar.classList.add('closed');
    $('#menuBtn').setAttribute('aria-expanded', 'false');
  });
  bar.setAttribute('aria-label', 'Create and project tools');
  const sidebarHead = el('div', { className: 'sidebar-head' },
    el('strong', {}, 'Create or open'), el('span', { className: 'spacer' }), closeSidebar);
  const projectStrip = el('div', { className: 'sidebar-project' },
    el('span', { className: 'eyebrow' }, 'Project'), $('#projectSelect'), $('#newProject'), $('#counters'));

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

  // Demo assets are a local convenience, not a shipped feature.
  const demoBtn = btn('Load demo assets', 'btn sm', loadDemo);
  demoBtn.hidden = /(^|\.)materiallogix\.com$/i.test(location.hostname);
  const generation = panel('Generate photo', !state.assets.length, generatePanel());
  generation.dataset.photoGeneration = 'true';
  const activeAsset = currentAsset();
  const reviewStatus = activeAsset?.peopleReview;
  const startActions = el('div', { className: 'photo-start-actions' },
    btn('Generate photo', 'btn primary', () => {
      generation.open = true;
      generation.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }),
    btn('Import photo or video', 'btn', () => $('#fileInput').click()));
  const startBody = [
    photoWorkflowSteps(state.assets.length ? (reviewStatus ? 3 : 2) : 1),
    startActions,
    // The people check is the product's one networked extra: `analyzeGeometry`
    // returns null when the vision models are unreachable, and `peopleReview`
    // records `manual-review-needed`. Promising it happens to every photo is a
    // statement the offline case does not keep, so say what is true of the
    // photos already in hand rather than of every photo there will ever be.
    el('p', { className: 'hint photo-flow-note' },
      reviewStatus?.status === 'manual-review-needed'
        ? 'Automatic people review is unavailable on this connection — check faces, hands, and bodies yourself before editing.'
        : 'New photos are checked for faces, hands, and bodies before editing, whenever the review models are reachable.')
  ];
  if (activeAsset) {
    startBody.push(btn(reviewStatus?.status === 'complete' ? 'Review again' : 'Review',
      'btn sm', () => reviewPeople(activeAsset)));
  }
  startBody.push(generation);
  const photoStart = panel(el('span', { className: 'panel-label' },
    el('span', {}, 'Create or open'), el('small', {}, 'Generate · import · review people')),
  !state.assets.length, ...startBody);
  photoStart.dataset.photoStart = 'true';

  const library = panel(el('span', { className: 'panel-label' },
    el('span', {}, 'Library'), el('small', {}, 'Add files · checks · demo assets')), false,
    el('div', { style: 'display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap' }, addBtn, analyzeBtn, demoBtn),
    el('div', { className: 'dropzone' }, 'or drop images and video anywhere'),
    el('p', { className: 'hint', style: 'margin-top:12px;margin-bottom:0' },
      `${count(state.assets.length, 'asset')} · ${state.assets.filter(a => a.auto).length} analysed`),
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
  const qa = panel('QA checklist · optional', false,
    el('p', { className: 'hint' }, 'Video always uses the video preset regardless of this setting.'),
    el('label', { className: 'field' }, el('span', {}, 'Preset'), presetSel),
    el('p', { className: 'hint' }, (PRESET_BY_ID[p.qaPreset]?.checks || []).map(id => QA_BY_ID[id]?.label).join(' · ')));

  const localTools = panel('Creative setup', false, localToolsPanel());

  const who = el('input', { type: 'text', value: state.reviewer });
  who.oninput = () => { state.reviewer = who.value || 'reviewer'; localStorage.setItem('cros:reviewer', state.reviewer); };

  const licBox = el('div', { style: 'margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--hair-soft)' });
  activeLicense().then(lic => {
    if (lic) {
      licBox.append(
        el('p', { className: 'hint', style: 'margin-bottom:6px' },
          `Licensed \u2014 ${planLabel(lic.plan)}${lic.selected_product ? ` / ${String(lic.selected_product).replace(/^./, c => c.toUpperCase())}` : ''} (${lic.email}). Clean exports require online authorization and verified remaining usage.`),
        // Deleting the project asks first; removing the licence did not, and
        // it is the less recoverable of the two - the key is gone from this
        // device and has to be found again to get back in.
        btn('Deactivate on this device', 'btn sm', () => dialog('Remove this licence from this device?',
          el('div', {},
            el('p', {}, `${planLabel(lic.plan)} (${lic.email}) will be removed from this browser. Your projects and files stay where they are.`),
            el('p', { className: 'hint' }, 'You will need the licence key again to download anything from this device.')),
          [btn('Keep it', 'btn', closeDialog),
            btn('Remove licence', 'btn primary', () => {
              deactivate();
              closeDialog();
              render();
              toast('Licence removed from this device. Your work is untouched.');
            })])));
    } else {
      const input = el('input', { type: 'text', placeholder: 'ML1.\u2026 license key' });
      const msg = el('p', { className: 'hint', style: 'margin:6px 0 0' },
        'Free preview lets you explore and review. Downloads require an active matching license and online usage confirmation.');
      licBox.append(input, el('div', { style: 'height:6px' }),
        btn('Activate', 'btn sm', async () => {
          const lic = await activate(input.value);
          if (lic) { toast(`Licensed: ${planLabel(lic.plan)}.`); render(); }
          else {
            const reason = activationFailureReason();
            msg.textContent = reason === 'online_verification_required' || reason === 'verification_unavailable'
              ? 'Connect to the internet so the license service can verify this key before first use.'
              : reason === 'invalid_or_legacy_key'
                ? 'That key is invalid or from an unsupported pre-release format.'
                : 'The license service could not verify this key as active.';
          }
        }), msg);
    }
    // Google and Apple stay hidden until the server enables their flag, so an
    // unapproved provider never shows a button that cannot complete.
    enabledAccountProviders().then(providers => {
      if (!providers.length) return;
      licBox.append(
        el('p', { className: 'hint', style: 'margin:12px 0 6px' }, 'Or sign in to your MaterialLogix account'),
        el('div', { className: 'account-providers' }, ...providers.map(provider =>
          btn(provider.label, 'btn sm', () => { location.assign(providerStartUrl(provider.id)); }))));
    });
  });

  const deliver = panel('Deliver', false,
    licBox,
    el('p', { className: 'hint' }, 'Choose the files you want to prepare.'),
    btn('Proof package (licensed, watermarked)', 'btn', () => doExport({ proof: true })),
    el('div', { style: 'height:6px' }),
    btn('Print-ready photo', 'btn', openPrintDelivery),
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
            'Open this address on your phone while both devices use the same Wi-Fi.'));
        } else {
          line.textContent = 'Open MaterialLogix Studio on your computer to show its Wi-Fi address.';
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

  const secondaryPanels = [brief, library, surfaces, qa, localTools, deliver, backup];
  for (const secondary of secondaryPanels) secondary.setAttribute('name', 'settings-more-tools');
  const moreTools = panel(el('span', { className: 'panel-label' },
    el('span', {}, 'Project tools'),
    el('small', {}, 'Brief · Library · Formats · QA · Deliver')),
  false,
  el('p', { className: 'hint panel-index' },
    'Open one labeled section at a time. QA is optional and stays out of the main workflow until you need it.'),
  ...secondaryPanels);
  moreTools.classList.add('panel-group');
  moreTools.dataset.secondaryTools = 'true';

  bar.replaceChildren(sidebarHead, projectStrip, photoStart, moreTools);
}

function renameProject() {
  const input = el('input', { type: 'text', value: state.project.name });
  const rename = dialog('Rename project', el('label', { className: 'field' }, el('span', {}, 'Name'), input), [
    btn('Cancel', 'btn', closeDialog),
    btn('Save', 'btn primary', () => {
      state.project.name = input.value.trim() || state.project.name;
      store.saveProject(state.project).then(() => { rename.close(); boot(state.project.id); });
    })
  ]);
}

function deleteProjectFlow() {
  const confirm = dialog('Delete project',
    el('p', {}, `Delete "${state.project.name}" and its ${count(state.assets.length, 'asset')}? Back up first — this cannot be undone.`),
    [btn('Cancel', 'btn', closeDialog),
     btn('Delete', 'btn primary', async () => {
       await store.deleteProject(state.project.id);
       confirm.close(); boot();
     })]);
}

// What the Studio made, as opposed to what the customer brought in. A raw
// camera import is still their own photograph; the rest is licensed output.
const DERIVED_SOURCES = new Set(['generated-local', 'generated-fill-local', 'enhanced-local', 'rendered-local']);

async function backupProject() {
  // A recovery file is the customer's own project and their own media, so it
  // is never paywalled. What the Studio produced for them is a licensed
  // deliverable: without a covering licence this zip was a clean,
  // full-resolution export of every generated frame, taken with no key at all.
  const lic = await activeLicense();
  const carried = state.assets.filter(asset =>
    !DERIVED_SOURCES.has(asset.source) || covers(lic, asset.kind === 'video' ? 'video' : 'photo'));
  const withheld = state.assets.length - carried.length;
  const cleanProject = {
    ...state.project,
    providers: Object.fromEntries(Object.entries(state.project.providers || {})
      .map(([id, v]) => [id, { enabled: !!v.enabled }]))   // keys never leave the browser
  };
  const manifest = JSON.stringify({
    schema: 'materiallogix/recovery@2',
    exportedAt: new Date().toISOString(),
    project: cleanProject,
    assets: carried
  }, null, 2);
  const entries = [{ name: 'project.json', data: manifest }];
  try {
    await busy(async () => {
      for (const asset of carried) {
        const blob = await store.getBlob(asset.id);
        if (blob) entries.push({ name: `media/${asset.id}`, data: new Uint8Array(await blob.arrayBuffer()) });
      }
    });
    downloadBlob(makeZip(entries), `${slug(state.project.name)}-recovery.zip`);
    toast(`Recovery file saved with ${count(entries.length - 1, 'media file')}.${withheld
      ? ` ${count(withheld, 'file')} created in Studio stayed out — activate a licence to include them.` : ''}`);
  } catch (error) {
    toast(error?.message ? sentence(deliveryReason(error)) : 'The recovery file could not be created. Nothing was saved.', true);
  }
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
    toast(`Recovered ${count(backup.assets.length, 'media file')} and all project decisions.`);
  } catch (error) {
    toast(`Recovery failed: ${sentence(deliveryReason(error))}`, true);
  }
}

// ---------------------------------------------------------------------------
// board

function renderBoard() {
  const f = state.filters;
  // The placeholder option reads as the label to anyone looking at the control
  // and as nothing at all to anyone listening to it: six filters in a row
  // announced as an unnamed combo box. The same word names it either way.
  const mk = (key, label, options) => {
    const s = el('select', { 'aria-label': label });
    s.append(el('option', { value: '' }, label));
    for (const o of options) s.append(el('option', { value: o.id, selected: f[key] === o.id }, o.label));
    s.onchange = () => { f[key] = s.value; state.index = 0; render(); };
    return s;
  };
  const search = el('input', { type: 'text', 'aria-label': 'Search files, notes, labels',
    placeholder: 'Search files, notes, labels', value: f.q });
  search.oninput = () => { f.q = search.value; renderBoardList(); };

  const toolbar = el('div', { className: 'toolbar' },
    mk('status', 'Any status', ASSET_STATUSES),
    mk('role', 'Any role', ASSET_ROLES),
    mk('kind', 'Stills and video', [{ id: 'image', label: 'Stills' }, { id: 'video', label: 'Video' }]),
    mk('surface', 'Any surface', activeSurfaces().map(s => ({ id: s.id, label: `Approved · ${s.label}` }))),
    (() => {
      // The rating filter is hand-rolled rather than built by `mk`, which is
      // how it kept its placeholder-only label after the other five were named.
      const sel = el('select', { 'aria-label': 'Any rating' });
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
    const wrap = el('div', {
      className: 'srcwrap', tabIndex: 0, role: 'group',
      ariaLabel: 'Full source preview. Drag to move the crop. Use arrow keys to nudge, plus and minus to zoom, and zero to reset.'
    });
    const scale = Math.min(1, PREVIEW_MAX / Math.max(d.w, d.h));
    const sourcePreview = renderCrop(d.source, d.w, d.h, { x: 0, y: 0, w: 1, h: 1 }, {
      w: Math.max(1, Math.round(d.w * scale)), h: Math.max(1, Math.round(d.h * scale))
    }, 'crop', null, ensureEditState(asset).adjustments);
    sourcePreview.setAttribute('role', 'img');
    sourcePreview.setAttribute('aria-label', `${asset.filename} edited source preview`);
    wrap.append(sourcePreview);
    if (surface) {
      const p = ensurePlacement(asset, surface.id);
      const rect = el('div', {
        className: 'croprect',
        style: `left:${p.crop.x * 100}%;top:${p.crop.y * 100}%;width:${p.crop.w * 100}%;height:${p.crop.h * 100}%`
      }, ...['tl', 'tr', 'bl', 'br'].map(c => el('div', { className: 'corner ' + c })));
      wrap.append(rect);
      attachSourceDrag(wrap, rect, asset, surface);
    }
    const edit = ensureEditState(asset);
    if (edit.pixelGrid.enabled) wrap.append(pixelGridOverlay(pixelGridReview(d.source, d.w, d.h, edit.pixelGrid.columns, edit.pixelGrid.sensitivity)));
    viewport.replaceChildren(wrap);
    attachLoupe(wrap, d, () => ({ x: 0, y: 0, w: 1, h: 1 }));
    if (asset.kind === 'image' && state.editTool) {
      attachEditTool(wrap, () => sourcePreview, asset, d,
        () => adjustmentFrame({ x: 0, y: 0, w: 1, h: 1 },
          { x: 0, y: 0, w: sourcePreview.width, h: sourcePreview.height }, edit.adjustments.rotate));
    }
    return;
  }

  const p = ensurePlacement(asset, surface.id);
  const ps = previewSurface(surface);
  const edit = ensureEditState(asset);
  const canvas = renderCrop(d.source, d.w, d.h, p.crop, ps, p.fill, null, edit.adjustments);
  const frame = el('div', {
    className: 'frame grab', tabIndex: 0, role: 'group',
    ariaLabel: `${surface.label} placement. Drag to reframe. Use arrow keys to nudge, plus and minus to zoom, and zero to reset.`
  }, canvas);
  if (edit.pixelGrid.enabled) frame.append(pixelGridOverlay(pixelGridReview(d.source, d.w, d.h, edit.pixelGrid.columns, edit.pixelGrid.sensitivity)));
  if (state.thirds) frame.append(el('div', { className: 'thirds' }));
  const safe = safeOverlay(surface);
  if (safe) frame.append(safe);
  viewport.replaceChildren(frame);
  // Repaint the crop into the live frame during drags: replacing the frame
  // itself would release the pointer capture and kill the drag mid-gesture.
  let stageCanvas = canvas;
  const repaintPlacement = () => {
    const next = renderCrop(d.source, d.w, d.h, p.crop, ps, p.fill, null, edit.adjustments);
    stageCanvas.replaceWith(next);
    stageCanvas = next;
  };
  attachPlacementDrag(frame, asset, surface, repaintPlacement);
  attachLoupe(frame, d, () => p.crop);
  if (asset.kind === 'image' && state.editTool) {
    attachEditTool(frame, () => stageCanvas, asset, d,
      () => adjustmentFrame(p.crop, placementRect(d.w, d.h, p.crop, ps, p.fill), edit.adjustments.rotate));
  }
}

function attachPlacementDrag(frame, asset, surface, repaint = paintStage) {
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
    repaint();
  };
  frame.onpointerup = frame.onpointercancel = () => {
    if (!drag) return;
    drag = null;
    log(asset, `reframed ${surface.label}`, state.reviewer);
    touchAsset(asset);
    renderIssuesOnly();
  };
  frame.onlostpointercapture = () => { drag = null; };
  frame.onwheel = e => {
    if (state.loupe) return;
    e.preventDefault();
    p.crop = zoomCrop(p.crop, e.deltaY < 0 ? 1.08 : 1 / 1.08);
    touchAsset(asset);
    repaint();
    renderIssuesOnly();
  };
  frame.onkeydown = e => {
    const step = e.shiftKey ? 0.06 : 0.018;
    let next = p.crop;
    if (e.key === 'ArrowLeft') next = panCrop(p.crop, -step * p.crop.w, 0);
    else if (e.key === 'ArrowRight') next = panCrop(p.crop, step * p.crop.w, 0);
    else if (e.key === 'ArrowUp') next = panCrop(p.crop, 0, -step * p.crop.h);
    else if (e.key === 'ArrowDown') next = panCrop(p.crop, 0, step * p.crop.h);
    else if (e.key === '+' || e.key === '=') next = zoomCrop(p.crop, 1.12);
    else if (e.key === '-' || e.key === '_') next = zoomCrop(p.crop, 1 / 1.12);
    else if (e.key === '0' || e.key === 'Home') next = asset.width
      ? defaultCrop(asset.width, asset.height, surface)
      : { x: 0, y: 0, w: 1, h: 1 };
    else return;
    e.preventDefault(); p.crop = next; touchAsset(asset); paintStage(); renderIssuesOnly();
  };
}

async function blobEvidenceHash(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function stableLocalVideoJobId(asset, options) {
  const material = new TextEncoder().encode(`${asset.id}\n${JSON.stringify(options)}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', material));
  const suffix = [...digest.slice(0, 18)].map(value => value.toString(16).padStart(2, '0')).join('');
  return `local-video-${suffix}`;
}

async function releaseUsage(authorizationId, reason = 'client_failure') {
  try {
    await voidOutbound(authorizationId, reason);
    return { confirmed: true, message: 'Reserved usage was returned.' };
  } catch (error) {
    if (error instanceof Error && error.message === 'usage_already_settled') {
      return { confirmed: false, settled: true, message: 'Usage was already finalized and remains visible in Usage.' };
    }
    return { confirmed: false, pending: true, message: 'Usage release is pending and will retry automatically; it is visible in Usage.' };
  }
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
  rect.onlostpointercapture = () => { drag = null; };

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
    handle.onlostpointercapture = () => { grab = null; };
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
  wrap.onkeydown = e => {
    const step = e.shiftKey ? 0.06 : 0.018;
    if (e.key === 'ArrowLeft') p.crop = panCrop(p.crop, -step * p.crop.w, 0);
    else if (e.key === 'ArrowRight') p.crop = panCrop(p.crop, step * p.crop.w, 0);
    else if (e.key === 'ArrowUp') p.crop = panCrop(p.crop, 0, -step * p.crop.h);
    else if (e.key === 'ArrowDown') p.crop = panCrop(p.crop, 0, step * p.crop.h);
    else if (e.key === '+' || e.key === '=') p.crop = zoomCrop(p.crop, 1.12);
    else if (e.key === '-' || e.key === '_') p.crop = zoomCrop(p.crop, 1 / 1.12);
    else if (e.key === '0' || e.key === 'Home') p.crop = asset.width
      ? defaultCrop(asset.width, asset.height, surface)
      : { x: 0, y: 0, w: 1, h: 1 };
    else return;
    e.preventDefault(); paint(); touchAsset(asset); renderIssuesOnly();
  };
}

// --- loupe: true 1:1 source pixels, the only way to judge hands and skin ---

/** Stage-side retouch input: while a tool is armed it owns the pointer, replacing drag and loupe. */
function attachEditTool(host, getCanvas, asset, decoded, frameFor) {
  host.classList.add('retouch');
  const edit = ensureEditState(asset);
  const sourcePoint = e => {
    const canvas = getCanvas();
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    return frameFor().unpoint(
      (e.clientX - box.left) * canvas.width / box.width,
      (e.clientY - box.top) * canvas.height / box.height);
  };
  // The champagne overlay marks the painted mask; the true grade lands on the next repaint.
  const paintOverlay = () => {
    if (state.editTool !== 'brush') return;
    const canvas = getCanvas();
    let overlay = host.querySelector('.retouch-overlay');
    if (!overlay) {
      overlay = el('canvas', { className: 'retouch-overlay' });
      host.append(overlay);
    }
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    const ctx = overlay.getContext('2d');
    ctx.fillStyle = 'rgba(201,168,106,0.32)';
    const frame = frameFor();
    for (const stamp of edit.adjustments.selective.strokes) {
      const [x, y] = frame.point(stamp.x, stamp.y);
      ctx.beginPath();
      ctx.arc(x, y, frame.radius(stamp.r), 0, 2 * Math.PI);
      ctx.fill();
    }
  };
  paintOverlay();
  let stroke = null;
  host.onpointerenter = null;
  host.onpointerdown = e => {
    const at = sourcePoint(e);
    if (!at) return;
    if (state.editTool === 'heal') return healAt(asset, decoded, at[0], at[1]);
    if (state.editTool !== 'brush') return;
    snapshot(asset, 'painted the selective brush');
    stroke = { last: at };
    host.setPointerCapture(e.pointerId);
    brushStamp(asset, at);
    paintOverlay();
  };
  host.onpointermove = e => {
    if (!stroke) return;
    const at = sourcePoint(e);
    if (!at) return;
    if (Math.hypot(at[0] - stroke.last[0], at[1] - stroke.last[1]) < (state.brushSize / 100) * 0.35) return;
    stroke.last = at;
    brushStamp(asset, at);
    paintOverlay();
  };
  host.onpointerup = host.onpointercancel = () => {
    if (!stroke) return;
    stroke = null;
    log(asset, 'painted the selective brush', state.reviewer);
    touchAsset(asset);
    renderReview();
  };
}

function brushStamp(asset, [nx, ny]) {
  if (nx < -0.02 || nx > 1.02 || ny < -0.02 || ny > 1.02) return;
  ensureEditState(asset).adjustments.selective.strokes.push({
    x: Math.min(1, Math.max(0, nx)),
    y: Math.min(1, Math.max(0, ny)),
    r: Math.max(0.002, Math.min(0.15, state.brushSize / 100))
  });
}

function healAt(asset, decoded, nx, ny) {
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
  const edit = ensureEditState(asset);
  const r = Math.max(0.004, Math.min(0.03, state.healSize / 100));
  const left = Math.min(Math.max(0, (nx - r) * 100), 99.9);
  const top = Math.min(Math.max(0, (ny - r) * 100), 99.9);
  // The inpaint contract bounds the repair before a pixel moves.
  let spec;
  try {
    spec = makeInpaintJobSpec({
      width: decoded.w, height: decoded.h, operation: 'remove', execution: 'local', selectionKind: 'brush',
      selection: { x: left, y: top, width: Math.min(2 * r * 100, 100 - left), height: Math.min(2 * r * 100, 100 - top) },
      maskCoverage: Math.PI * r * r * (decoded.w / decoded.h)
    });
  } catch (error) {
    toast(sentence(deliveryReason(error)), true);
    return;
  }
  mutate(asset, `healed a spot (${(spec.maskCoverage * 100).toFixed(2)}% of frame)`, () => {
    edit.adjustments.heals = [...edit.adjustments.heals, { x: nx, y: ny, r }];
  });
  renderReview();
}

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

/**
 * The loupe is a hover concept: `.loupe` is `display:none` below 900px in the
 * stylesheet, because a finger has no cursor to place it under. Anything that
 * can turn it on has to ask here first, or the control does nothing on the
 * viewport it is offered on and the stage stops answering drags as well.
 */
function loupeIsAvailable() { return !matchMedia('(max-width: 900px)').matches; }

function setLoupe(on) {
  state.loupe = loupeIsAvailable() && on;
  if (!state.loupe) removeLoupe();
}

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
      body.append(renderCrop(d.source, d.w, d.h, pl.crop, previewSurface(surface), pl.fill, null, ensureEditState(a).adjustments));
    } else {
      body.append(el('img', { src: d.url, alt: a.filename }));
    }
    return p;
  };
  host.replaceChildren(await pane(other, 'Reference'), await pane(asset, 'Candidate'));
}

// ---------------------------------------------------------------------------
// rail

// Blocking and warning used to differ only in the fill of a 5px dot, and the
// two colours are 1.09:1 apart in luminance — the distinction is pure hue, so
// it survives neither deuteranopia nor a screen reader. The word carries it.
const ISSUE_LEVELS = Object.freeze({ block: 'Blocking', warn: 'Warning', info: 'Note' });

/**
 * One issue, rendered one way.
 *
 * There were two of these. The severity word was added to this one and the
 * placement card kept its own copy, so half the issues in the product were
 * still a 5px dot whose colour was the only thing saying whether they blocked
 * a delivery - at 1.09:1 against its neighbour.
 */
function issueRow(i, style = '') {
  return el('div', { className: 'issue ' + i.level, ...(style ? { style } : {}) },
    el('span', { className: 'dot', 'aria-hidden': 'true' }),
    el('div', {},
      el('span', { className: 'where' }, `${ISSUE_LEVELS[i.level] || i.level} — `),
      i.surface ? el('span', { className: 'where' }, i.surface + ' — ') : null,
      el('span', { className: 'msg' }, i.message),
      i.fix ? el('span', { className: 'fix' }, i.fix) : null));
}

function issueList(items, emptyText) {
  if (!items.length) return el('p', { className: 'hint', style: 'margin:0' }, emptyText);
  return el('div', {}, ...items.map(i => issueRow(i)));
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
      a.skin ? el('small', {}, a.skin.ratio < 0.35 ? ' · detail review' : ' · detail retained') : null)));

  const sw = el('div', { className: 'swatches' }, ...a.palette.map(c => el('i', { style: `background:${c.hex}`, title: `${c.hex} · ${Math.round(c.pct * 100)}%` })));
  wrap.append(el('div', { style: 'font-size:11px;color:var(--faint);margin-bottom:4px' }, 'Dominant colour'), sw);

  const color = a.color || {};
  const colorDelivery = colorExportDecision(color);
  wrap.append(el('div', { className: 'metrics', style: 'margin-top:12px' },
    cell('Input profile', String(color.profile || 'unknown').replaceAll('-', ' '),
      el('small', {}, color.embedded ? ' · embedded' : ' · fallback')),
    cell('Working space', COLOR_PIPELINE.workingSpace),
    cell('Output transform', COLOR_PIPELINE.deliverySpace,
      el('small', {}, ` · ${COLOR_PIPELINE.renderingIntent}`)),
    cell('Clipping', `${(a.exposure.blown * 100).toFixed(1)}% high · ${(a.exposure.crushed * 100).toFixed(1)}% low`)));
  wrap.append(el('p', { className: 'hint', style: 'margin:8px 0 0' },
    !colorDelivery.allowed
      ? 'Color needs a verified sRGB conversion before export.'
      : color.conversion
        ? 'Color converted to sRGB for digital delivery.'
        : 'Color profile checked for digital delivery.'));

  const g = asset.geometry;
  wrap.append(el('p', { className: 'hint', style: 'margin:12px 0 0' },
    g
      ? (g.faces.length || g.hands.length
        ? `${g.faces.length} face${g.faces.length === 1 ? '' : 's'} and ${g.hands.length} hand${g.hands.length === 1 ? '' : 's'} found.`
        : 'No people found.')
      : 'People check unavailable; review manually.'));

  const prov = a.provenance;
  if (prov) {
    const bits = [];
    if (prov.c2pa || prov.contentCredentials) bits.push('Content Credentials present');
    if (prov.aiDigitalSource) bits.push('AI-origin label present');
    wrap.append(el('p', { className: 'hint', style: 'margin:12px 0 0' },
      bits.length ? bits.join(' · ') : 'No content credentials found.'));
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
    const b = pressed(el('button', { dataset: { d } }, d[0].toUpperCase() + d.slice(1)), p.decision === d);
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
    card.append(issueRow(i, 'border:0;padding:6px 0 0'));
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
        const label = v === 'na' ? 'N/A' : v === 'pass' ? 'Pass' : 'Fix';
        const description = v === 'na' ? 'Not applicable' : v === 'pass' ? 'Pass this check' : 'Needs work';
        const b = pressed(el('button', {
          title: description, ariaLabel: `${c.label}: ${description}`, dataset: { v }
        }, label), asset.qa[c.id] === v);
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
  const edit = ensureEditState(asset);
  const wrap = el('div', { className: 'block' });
  const bind = (key, label, placeholder = '') => {
    const i = el('input', { type: 'text', value: v[key] || '', placeholder });
    let captured = false;
    const capture = () => { if (!captured) { snapshot(asset, `changed ${label}`); captured = true; } };
    i.oninput = () => { capture(); v[key] = i.value; touchAsset(asset); };
    i.onchange = () => { log(asset, `${label} → ${i.value || 'cleared'}`, state.reviewer); captured = false; };
    return el('label', { className: 'field' }, el('span', {}, label), i);
  };
  wrap.append(
    bind('hook', 'Opening intent', 'Define the message or action for the first two seconds'),
    el('div', { style: 'display:flex;gap:8px' }, bind('trimStart', 'In point', '0:00'), bind('trimEnd', 'Out point', '0:08')),
    bind('cropNote', 'Reframing direction', 'For example: retain both hands in the vertical composition'));

  v.spec = v.spec || 'vertical'; v.speed = Number(v.speed || 1); v.fadeIn = Number(v.fadeIn || 0);
  v.fadeOut = Number(v.fadeOut || 0); v.rotate = Number(v.rotate || 0); v.volumeDb = Number(v.volumeDb || 0);
  v.audioEq = v.audioEq || 'flat';
  const select = (key, label, options) => {
    const input = el('select', {});
    for (const [value, text] of options) input.append(el('option', { value: String(value), selected: String(v[key]) === String(value) }, text));
    input.onchange = () => { mutate(asset, `${label} → ${input.options[input.selectedIndex].text}`, () => { v[key] = isNaN(Number(input.value)) ? input.value : Number(input.value); }); };
    return el('label', { className: 'field' }, el('span', {}, label), input);
  };
  wrap.append(el('div', { className: 'video-delivery-grid' },
    select('spec', 'Delivery frame', [['vertical', 'Vertical 9:16'], ['portrait', 'Portrait 4:5'], ['square', 'Square 1:1'], ['wide', 'Landscape 16:9']]),
    select('speed', 'Playback speed', [[0.5, '0.5×'], [0.75, '0.75×'], [1, 'Source speed'], [1.25, '1.25×'], [1.5, '1.5×'], [2, '2×']]),
    select('rotate', 'Orientation', [[0, 'Source orientation'], [90, '90° clockwise'], [180, '180°'], [270, '90° counterclockwise']]),
    select('audioEq', 'Audio profile', [['flat', 'Full range'], ['voice', 'Dialogue focus'], ['music', 'Music focus']])));
  if (edit.mode === 'advanced') {
    const number = (key, label, min, max, step) => {
      const input = el('input', { type: 'number', min, max, step, value: v[key] || 0 });
      input.onchange = () => { mutate(asset, `${label} → ${input.value}`, () => { v[key] = Math.min(max, Math.max(min, Number(input.value) || 0)); }); };
      return el('label', { className: 'field' }, el('span', {}, label), input);
    };
    const denoise = el('input', { type: 'checkbox', checked: !!v.denoise });
    denoise.onchange = () => { mutate(asset, `Audio cleanup ${denoise.checked ? 'on' : 'off'}`, () => { v.denoise = denoise.checked; }); };
    const captions = el('input', { type: 'checkbox', checked: !!v.burnCaptions });
    captions.onchange = () => { mutate(asset, `Automatic captions ${captions.checked ? 'on' : 'off'}`, () => { v.burnCaptions = captions.checked; }); };
    wrap.append(el('div', { className: 'video-delivery-grid' },
      number('fadeIn', 'Fade in (seconds)', 0, 10, .1), number('fadeOut', 'Fade out (seconds)', 0, 10, .1),
      number('volumeDb', 'Output gain (dB)', -24, 12, .5)),
      el('label', { className: 'toggle' }, denoise, 'Reduce consistent background noise'),
      el('label', { className: 'toggle' }, captions, 'Transcribe and burn captions'),
      el('details', { className: 'editor-control-group cloud-render-control' },
        el('summary', {}, 'Optional cloud render'),
        el('div', { className: 'editor-control-body' },
          el('p', { className: 'hint' },
            'Review the price before sending this video to the cloud.'),
          btn('Review cloud quote', 'btn sm', () => reviewCloudVideoRender(asset)))));
  }

  const stars = el('div', { className: 'stars' });
  for (let i = 1; i <= 5; i++) {
    const b = pressed(el('button', {}, '★'), i <= v.believability);
    b.setAttribute('aria-label', `Naturalism rating ${i} of 5`);
    b.onclick = () => { mutate(asset, `naturalism ${i}/5`, () => { v.believability = v.believability === i ? 0 : i; }); renderReview(); };
    stars.append(b);
  }
  wrap.append(el('label', { className: 'field' }, el('span', {}, 'Naturalism rating'), stars));

  const mkToggle = (key, label) => {
    const cb = el('input', { type: 'checkbox', checked: v[key] });
    cb.onchange = () => { mutate(asset, `${label}: ${cb.checked}`, () => { v[key] = cb.checked; }); };
    return el('label', { className: 'toggle' }, cb, label);
  };
  wrap.append(mkToggle('looksAI', 'Flag synthetic-looking motion or performance'), mkToggle('recast', 'Request a new performance or cast selection'));

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
      releaseDecoded(asset.id);
      await runAnalysis(asset);
      renderReview();
    };
    wrap.append(el('label', { className: 'field' },
      el('span', {}, 'Crop reference frame'), scrub, readout));
    if (asset.temporal?.samples?.length) {
      wrap.append(el('p', { className: 'hint' },
        `Temporal quality review sampled ${asset.temporal.samples.length} points across ${asset.temporal.duration.toFixed(1)}s. ` +
        `Lowest sharpness ${asset.temporal.sharpnessMin}; brightness swing ${asset.temporal.lumaRange}.`));
    }
  }

  if (asset.duration) {
    // Scripts written to fit beat scripts trimmed after: the same cadence
    // model that renders the voice sizes the copy for this exact cut.
    wrap.append(el('p', { className: 'hint' },
      `Voiceover fit: about ${wordBudgetForSeconds(asset.duration)} words fill these ${asset.duration.toFixed(0)} seconds at house pace.`));
  }
  wrap.append(el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
    btn('Review with timecoded notes', 'btn sm', () => playWithComments(asset)),
    btn('Create identity reference set', 'btn sm', () => extractIdentityPack(asset)),
    btn('Render video', 'btn primary sm', () => renderEditedVideo(asset))));
  return wrap;
}


function videoRenderPlan(asset, lane = LANES.paid, engine = null) {
  const v = asset.video;
  const trim = resolveVideoTrim({ trimStart: v.trimStart, trimEnd: v.trimEnd, duration: asset.duration, speed: v.speed || 1 });
  const frame = deliveryFrame(v.spec);
  const activePlacement = state.activeSurface ? ensurePlacement(asset, state.activeSurface) : null;
  const crop = snapToRatio(
    activePlacement?.crop || defaultCrop(asset.width, asset.height, frame),
    asset.width, asset.height, frame
  );
  return {
    outputSeconds: trim.outputSeconds,
    opts: {
      trimStart: trim.start, trimEnd: trim.end, spec: v.spec || DEFAULT_VIDEO_SPEC, speed: trim.speed,
      fadeIn: v.fadeIn || 0, fadeOut: v.fadeOut || 0, rotate: v.rotate || 0,
      volumeDb: v.volumeDb || 0, denoise: !!v.denoise, audioEq: v.audioEq || 'flat',
      burnCaptions: !!v.burnCaptions, crop, adjustments: ensureEditState(asset).adjustments,
      // The engine must mark an unlicensed render. Photo exports are stopped at
      // the paywall and voice previews are audibly stamped; video had nothing.
      delivery: deliveryRulesFor(lane, 'video'),
      // Which generative engine may serve this customer, decided by their
      // region rather than by whatever the renderer happens to have loaded.
      // `null` is the honest answer today - no model touches the pixels - and
      // it travels with the job so the renderer cannot substitute one.
      engine: engine?.engineId || null
    },
    provenance: engine?.provenance || EDITORIAL_PROVENANCE
  };
}

function cloudActivity(detail) {
  window.dispatchEvent(new CustomEvent('materiallogix:job', { detail: {
    title: 'Cloud video render', kind: 'video', location: 'cloud', ...detail
  } }));
}

function localVideoActivity(detail) {
  window.dispatchEvent(new CustomEvent('materiallogix:job', { detail: {
    title: 'Local video render', kind: 'video', location: 'local', cancellable: true, ...detail
  } }));
}

async function cancelLocalVideoJob(jobId) {
  const active = localVideoJobs.get(jobId);
  if (active) active.cancelRequested = true;
  localVideoActivity({ id: jobId, status: 'processing', progress: active?.progress || 54, detail: 'Stopping safely…' });
  let base = active?.base;
  if (!base) {
    const bridge = await detectBridge();
    base = bridge.ok ? bridge.base : null;
  }
  let confirmed = false;
  if (base) {
    for (let attempt = 0; attempt < 3 && !confirmed; attempt++) {
      try {
        const response = await bridgeFetch(`${base}/video/cancel?job=${encodeURIComponent(jobId)}`, { method: 'POST' });
        const result = await response.json().catch(() => ({}));
        confirmed = response.ok && result.cancelRequested === true;
      } catch { /* the original request still has its bounded engine timeout */ }
      if (!confirmed && attempt < 2) await new Promise(resolve => setTimeout(resolve, 80));
    }
  }
  active?.controller.abort();
  localVideoActivity({ id: jobId, status: confirmed || !active ? 'cancelled' : 'failed', progress: 100,
    detail: confirmed ? 'Stopped' : active ? 'Stop could not be confirmed' : 'Recovered after the previous session' });
  if (active) toast(confirmed ? 'Video render stopped.' : 'The video render could not be stopped.', !confirmed);
}

window.addEventListener('materiallogix:cancel-job', event => {
  const jobId = String(event.detail?.id || '');
  if (jobId) cancelLocalVideoJob(jobId).catch(error => {
    localVideoActivity({ id: jobId, status: 'failed', progress: 100,
      detail: `Stop failed safely · ${sentence(deliveryReason(error))}` });
  });
});
window.dispatchEvent(new Event('materiallogix:cancel-ready'));

/**
 * What the customer is told about the engine, and the switch when there is one.
 *
 * Three shapes, and the difference between them matters:
 *   - nothing generative is enabled: say what did produce the file;
 *   - the engine is fixed by their region: say which one and why, no control;
 *   - both engines are licensed where they are: give them the choice.
 *
 * The control is a convenience, not the enforcement. `resolveVideoEngine`
 * resolves the preference against the territory on every render, so a stored
 * preference for an engine that is not licensed where the customer is has no
 * effect even if this control is never drawn.
 */
function engineRow(engine) {
  if (!engine.generative) return el('p', { className: 'hint' }, engine.provenance);
  if (!engine.offered) {
    return el('p', { className: 'hint' }, engine.notice || engine.provenance);
  }
  const wrap = el('div', { className: 'engine-choice' },
    el('p', {}, el('b', {}, 'Motion engine')));
  const note = el('p', { className: 'hint' }, engine.notice);
  for (const [id, label] of [[PRO_VIDEO_ENGINE, 'Pro Motion Engine'], [STANDARD_VIDEO_ENGINE, 'Standard engine']]) {
    const input = el('input', { type: 'radio', name: 'ml-video-engine', value: id });
    input.checked = engine.engineId === id;
    input.onchange = () => {
      if (!input.checked) return;
      rememberEnginePreference(id);
      // Re-resolve rather than trusting the click: the answer shown must be the
      // answer the render will actually use.
      videoEngineForThisCustomer({ pro: true }).then(next => { note.textContent = next.notice; });
    };
    wrap.append(el('label', { className: 'checkline' }, input, el('span', {}, label)));
  }
  wrap.append(note);
  return wrap;
}

async function reviewCloudVideoRender(asset) {
  const availability = await cloudVideoAvailability();
  if (!availability.available) return dialog('Cloud render is not open yet', el('div', {},
    el('p', {}, 'Use this device to render your video for now.')),
  [btn('Close', 'btn', closeDialog), btn('Use local render', 'btn primary', () => { closeDialog(); renderEditedVideo(asset); })]);
  const lane = laneFor(await activeLicense(), 'video');
  // The engine gate applies to the cloud exactly as it does to this device.
  // Where our GPUs sit is not what the licence turns on - it turns on where the
  // customer is - so sending the job away cannot route around it.
  const engine = await videoEngineForThisCustomer({ pro: lane.motionEngine === 'pro' });
  if (engine.blocked) return toast(engine.notice, true);
  let plan;
  // The cloud render carries the same delivery rules as the local one, so a
  // licence cannot be bypassed by sending the job to our GPUs instead.
  try { plan = videoRenderPlan(asset, lane, engine); }
  catch (error) { return toast(sentence(deliveryReason(error)), true); }
  const quote = quoteCloudJob({ kind: 'video', durationSeconds: plan.outputSeconds });
  // What the licence includes is known here; what remains this period is the
  // server's to report, so the split is never guessed on this side.
  const includedCredit = includedCloudCents(globalThis.lic);
  const consent = el('input', { type: 'checkbox' });
  const continueButton = btn('Compile and send package', 'btn primary', async () => {
    if (!consent.checked) return;
    closeDialog();
    const activityId = `cloud-video-${crypto.randomUUID()}`;
    cloudActivity({ id: activityId, status: 'processing', progress: 1, detail: 'Preparing complete package', credits: quote.amountCents / 100 });
    try {
      const source = await store.getBlob(asset.id);
      const manifest = {
        schema: 'materiallogix.cloud-video-job.v1', createdAt: new Date().toISOString(),
        source: { filename: asset.filename, contentType: source.type || 'application/octet-stream',
          size: source.size, durationSeconds: asset.duration },
        outputSeconds: plan.outputSeconds, edit: plan.opts,
        engine: { id: plan.opts.engine, region: engine.country || null, provenance: plan.provenance },
        brandOverlay: state.project.brandOverlay || null
      };
      const result = await busy(() => submitCloudVideoPackage({ source, manifest,
        outputSeconds: plan.outputSeconds, expectedAmountCents: quote.amountCents,
        cloudProcessingConsent: true, retentionAccepted: true, operationId: activityId,
        onProgress: update => cloudActivity({ ...update, id: activityId }) }));
      cloudActivity({ id: activityId, status: 'queued', progress: 82, detail: 'Cloud render queued', credits: result.quote.amountCents / 100 });
      let notified = false;
      watchCloudVideoJob(result.jobId, update => {
        cloudActivity({ ...update, id: activityId });
        if (notified || update.status !== 'completed') {
          if (update.status === 'failed') toast('Cloud video render failed. Reserved wallet funds were returned.', true);
          return;
        }
        notified = true;
        dialog('Cloud render ready', el('div', {},
          el('p', {}, 'Your finished video is ready.'),
          el('p', { className: 'hint' }, 'The private cloud copy follows the temporary retention window shown when you submitted the package.')),
        [btn('Later', 'btn', closeDialog), btn('Download video', 'btn primary', () => { downloadCloudVideo(result.jobId); closeDialog(); })]);
      });
      toast('Complete package uploaded. Cloud rendering has started.');
    } catch (error) {
      cloudActivity({ id: activityId, status: 'failed', progress: 100, detail: sentence(deliveryReason(error)) });
      toast(`Cloud render was not started: ${sentence(deliveryReason(error))}`, true);
    }
  });
  continueButton.disabled = true;
  consent.onchange = () => { continueButton.disabled = !consent.checked; };
  dialog('Review cloud render', el('div', {},
    el('p', {}, `Estimated charge: $${(quote.amountCents / 100).toFixed(2)} for ${quote.billedSeconds} seconds.`),
    engineRow(engine),
    el('p', { className: 'hint' }, includedCredit
      ? `Your plan includes $${(includedCredit / 100).toFixed(2)} of cloud credit each period, spendable on photo, video or voice. It is used before your wallet; the server settles the actual amount.`
      : 'This job is paid from your prepaid wallet. The server settles the actual amount.'),
    el('label', { className: 'checkline' }, consent,
      el('span', {}, 'I agree to cloud processing and temporary private storage for this job. Input and output are scheduled for deletion within 24 hours.'))),
  [btn('Cancel', 'btn', closeDialog), btn('Use local render', 'btn', () => { closeDialog(); renderEditedVideo(asset); }), continueButton]);
}

// Every path below the first `await` in a render is reachable twice on a
// double-click, and the durable claim - the jobId in `localVideoJobs` - cannot
// be taken until several awaits have already run. So the door is held here,
// synchronously, before any of them.
const videoRendersStarting = new Set();

async function renderEditedVideo(asset) {
  if (videoRendersStarting.has(asset.id)) return toast('That render is already starting.');
  videoRendersStarting.add(asset.id);
  try {
    return await startVideoRender(asset);
  } finally {
    videoRendersStarting.delete(asset.id);
  }
}
async function startVideoRender(asset) {
  const bridge = await detectBridge();
  if (!bridge.ok || !bridge.video?.ffmpeg) return toast('Video tools are not ready on this device.', true);
  if (asset.video.burnCaptions && !bridge.video?.whisper) {
    return toast('Captions need the optional Video pack; add it or turn captions off.', true);
  }
  const lane = laneFor(await activeLicense(), 'video');
  // Which engine may serve this customer. Today no generative engine is
  // enabled, so this resolves to "none" and no region lookup is made; when one
  // is enabled it is the only route to it, and an unconfirmed region stops the
  // render rather than guessing in the direction that breaks the licence.
  const engine = await videoEngineForThisCustomer({ pro: lane.motionEngine === 'pro' });
  if (engine.blocked) return toast(engine.notice, true);
  let plan;
  try { plan = videoRenderPlan(asset, lane, engine); }
  catch (error) { return toast(sentence(deliveryReason(error)), true); }
  // An engine that cannot mark the file must not be handed an unmarked one.
  if (requiresWatermark(lane, 'video') && !bridge.video?.watermark) {
    return toast('This device cannot add the preview watermark that an unlicensed render requires. Activate a Video plan, or update the Video pack.', true);
  }
  const opts = { ...plan.opts, resume: true };
  // The same asset and the same settings are the same job. Two clicks on
  // Render video used to reserve twice, settle twice, render twice and add two
  // identical files, because the id was computed after the reservation and
  // nothing held the door. Claim it first: this is the one paid action in the
  // product a customer can trigger twice by double-clicking.
  const jobId = await stableLocalVideoJobId(asset, opts);
  if (localVideoJobs.has(jobId)) return toast('That render is already running.');
  const controller = new AbortController();
  localVideoJobs.set(jobId, { controller, base: bridge.base, cancelRequested: false, progress: 18 });

  // The cut this render delivers is what it costs. A flat unit charged an hour
  // of finished video the same as a minute, on the one local flow that really
  // does the work. The job id is also the idempotency key, the way the export
  // paths pass their evidence hash, so a retry the service does see cannot be
  // billed a second time.
  const authorization = await authorizeOutbound({ product: 'video', artifactKind: 'upload',
    quantity: exportUnits('video', { seconds: plan.outputSeconds }), operationId: jobId });
  if (!authorization.ok) {
    localVideoJobs.delete(jobId);
    return toast(`Online render authorization failed: ${sentence(deliveryReason(authorization.reason || 'authorization_required'))}`, true);
  }
  try {
    await busy(async () => {
      toast('Rendering video with the saved editorial settings…');
      const source = await store.getBlob(asset.id);
      localVideoActivity({ id: jobId, status: 'processing', progress: 18, detail: 'Checking saved render segments, then continuing locally' });
      const response = await bridgeFetch(`${bridge.base}/video/render?opts=${encodeURIComponent(JSON.stringify(opts))}`, {
        method: 'POST',
        headers: { 'Content-Type': source.type || 'video/mp4', 'X-MaterialLogix-Job-Id': jobId },
        body: source,
        signal: controller.signal
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `engine ${response.status}`);
      const reusedSegments = Math.max(0, Number(response.headers.get('X-MaterialLogix-Video-Reused-Segments')) || 0);
      if (reusedSegments) localVideoActivity({ id: jobId, status: 'processing', progress: 82,
        detail: `Recovered ${reusedSegments} completed segment${reusedSegments === 1 ? '' : 's'} · finalizing` });
      const blob = await response.blob();
      await settleOutbound(authorization.authorization.id, await blobEvidenceHash(blob));
      const file = new File([blob], asset.filename.replace(/\.[^.]+$/, '') + '-edited.mp4', { type: 'video/mp4' });
      const rendered = newAsset(state.project.id, file);
      rendered.source = 'rendered-local';
      // The terms promise the customer can always tell what produced a file.
      // That promise is only kept if the line says so even when the answer is
      // "no model at all".
      rendered.provenance = `Rendered locally from ${asset.filename} with the saved non-destructive edit settings. ${plan.provenance}`;
      rendered.engine = plan.opts.engine;
      await store.addAsset(rendered, file);
      const url = await store.objectUrl(rendered.id);
      Object.assign(rendered, await probe(file, url));
      log(rendered, `rendered from ${asset.filename}`, state.reviewer);
      await store.saveAsset(rendered);
      state.assets.push(rendered);
    });
    localVideoActivity({ id: jobId, status: 'complete', progress: 100, detail: 'Added to project' });
    render(); toast('Video render completed and added to the project.');
  } catch (error) {
    const cancelled = localVideoJobs.get(jobId)?.cancelRequested || error.name === 'AbortError';
    const release = await releaseUsage(authorization.authorization.id, cancelled ? 'user_cancelled' : 'render_failed');
    localVideoActivity({ id: jobId, status: cancelled ? 'cancelled' : 'failed', progress: 100,
      detail: cancelled ? `Stopped locally · ${release.message}` : `${sentence(deliveryReason(error))} ${release.message}` });
    if (!cancelled) toast(`Video render failed: ${sentence(deliveryReason(error))} ${release.message}`, true);
  } finally {
    localVideoJobs.delete(jobId);
  }
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
        'No notes yet. Pause at the relevant frame and add a timecoded review note.'));
    }
  };

  const input = el('input', { type: 'text', placeholder: 'Add a note at the current frame and press Enter' });
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

  const stopPlayback = () => { vid.pause(); vid.removeAttribute('src'); vid.load(); };
  dialog(asset.filename,
    el('div', {}, vid,
      el('div', { style: 'display:flex;gap:6px;margin-top:12px' }, input, btn('Add timecode', 'btn', add)),
      listBox),
    [btn('Close', 'btn', () => { stopPlayback(); renderReview(); closeDialog(); })],
    { onDismiss: stopPlayback });
  paint();
}

async function extractIdentityPack(asset) {
  if (!(await ensureGuardianAck())) return;
  const nameInput = el('input', { type: 'text', placeholder: 'Approved subject name or identifier' });
  const modeSel = el('select', {});
  modeSel.append(el('option', { value: 'face' }, 'Facial reference set — verified 180°'));
  modeSel.append(el('option', { value: 'body' }, 'Full-body reference set — verified 360°'));
  const countSel = el('select', {});
  for (const n of [8, 12, 16]) countSel.append(el('option', { value: String(n) }, `${n} frames`));
  const shootGuide = el('div', { className: 'spin-shoot-guide' });
  // Play the pace out loud so they can film to it on a phone.
  const guideDial = el('div', { className: 'pace-dial' });
  let stopGuide = null;
  const playGuide = btn('Play the pace', 'btn sm', () => {
    if (stopGuide) { stopGuide(); stopGuide = null; playGuide.textContent = 'Play the pace'; return; }
    playGuide.textContent = 'Stop';
    stopGuide = runPaceGuide({
      kind: modeSel.value,
      mount: guideDial,
      onDone: () => { stopGuide = null; playGuide.textContent = 'Play again'; }
    });
  });
  const paintShootGuide = () => {
    const guide = guidanceFor(modeSel.value);
    shootGuide.replaceChildren(
      el('strong', {}, guide.title),
      el('p', {}, guide.target),
      el('ol', {}, ...guide.steps.map(step => el('li', {}, step))),
      el('p', { className: 'hint' }, guide.graded));
  };
  modeSel.onchange = paintShootGuide;
  dialog('Create identity reference set',
    el('div', {},
      el('p', { className: 'hint' },
        'Creates evenly spaced reference frames from this video for one approved subject.'),
      shootGuide,
      el('div', { className: 'pace-row' }, guideDial,
        el('div', {}, playGuide,
          el('p', { className: 'hint' }, 'Turn with the ticks. The last few drop in pitch as you finish.'))),
      el('label', { className: 'field' }, el('span', {}, 'Subject'), nameInput),
      el('label', { className: 'field' }, el('span', {}, 'Capture type'), modeSel),
      el('label', { className: 'field' }, el('span', {}, 'Frames'), countSel)),
    [btn('Cancel', 'btn', closeDialog),
     btn('Create reference set', 'btn primary', async () => {
       const person = nameInput.value.trim() || 'unnamed';
       const count = Number(countSel.value);
       const captureMode = modeSel.value;
       const packId = crypto.randomUUID();
       closeDialog();
       let extracted = 0;
       await busy(async () => {
         const url = await store.objectUrl(asset.id);
         const probeFrame = await grabVideoFrame(url, 0);
         const duration = probeFrame.duration || asset.duration || 0;
         if (!duration) return toast('Could not read the video duration.', true);
         for (let i = 0; i < count; i++) {
           const t = duration * ((i + 0.5) / count);
           const { canvas } = await grabVideoFrame(url, t);
           const corners = cornerSignature(canvas);
           const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
           const file = new File([blob], `${slug(person)}_identity_${String(i + 1).padStart(2, '0')}.png`, { type: 'image/png' });
           const ref = newAsset(state.project.id, file);
           ref.role = 'reference';
           ref.status = 'reference-only';
           ref.labels.lane = person;
           ref.identityPackId = packId;
           ref.identityCaptureMode = captureMode;
           ref.width = canvas.width;
           ref.height = canvas.height;
           ref.provenance = `Identity frame ${i + 1}/${count} at ${t.toFixed(2)}s from ${asset.filename}`;
           ref.captureCorners = corners;
           log(ref, `extracted from ${asset.filename}`, state.reviewer);
           await store.addAsset(ref, file);
           await runAnalysis(ref, { quiet: true });
           extracted += 1;
         }
       });
       if (!extracted) return;
       state.assets = await store.listAssets(state.project.id);
       forgetDecodesOutside(state.assets.map(a => a.id));
       render();

       // Coverage check: did the turn actually sweep the angles?
       const packAssets = state.assets
         .filter(a => a.role === 'reference' && a.identityPackId === packId)
         .sort((a, b) => a.filename.localeCompare(b.filename));
       const packFrames = packAssets.map(a => a.geometry);
       if (packFrames.some(Boolean)) {
         const rep = captureMode === 'body'
           ? captureCoverageBody(packFrames)
           : captureCoverage(packFrames);
         rep.flags = [...rep.flags, ...captureFrameQuality(packAssets, captureMode)];
         const lines = el('div', {},
           el('p', {}, captureMode === 'body'
             ? `Coverage: ${rep.bodiesFound}/${rep.frames} frames tracked · ${rep.coveredBuckets}/8 angle zones of the full 360° · verdict: ${rep.verdict}.`
             : `Coverage: ${rep.facesFound}/${rep.frames} frames tracked · ${rep.yawSpreadDeg}° of head turn · verdict: ${rep.verdict}.`),
           rep.gaps.length ? el('p', { className: 'hint' }, 'Missing angles: ' + rep.gaps.join(', ')) : null,
           ...rep.flags.map(f => el('p', { className: 'hint', style: 'color:var(--warn)' }, f)),
           ...(() => {
             // Where the turn drifted, not just that it did.
             const trace = paceTrace(captureMode, rep);
             if (!trace.steps.length) return [];
             const bar = el('div', { className: 'pace-trace' });
             bar.innerHTML = paceTraceSvg(trace);
             return [el('p', { className: 'hint', style: 'margin:10px 0 2px' }, 'Turn speed'), bar,
               el('p', { className: 'hint' }, trace.advice)];
           })(),
           rep.verdict !== 'good' ? el('p', { className: 'hint' }, 'Re-shoot with a slower turn to fill the gaps — the pack works better the wider the sweep.') : null,
           el('p', { className: 'hint' }, 'Laptop controls: open the spin preview, then drag directly on the picture, use a two-finger trackpad scroll, or press the left and right arrow keys.'));
         dialog('Capture report — ' + person, lines, [
           btn('Close', 'btn', closeDialog),
           btn('Open easy spin preview', 'btn primary', () => openIdentitySpinPreview(person, packAssets, captureMode))
         ]);
       } else {
         dialog('Reference set created — ' + person, el('div', {},
           el('p', {}, `${extracted} frames were extracted successfully.`),
           el('p', { className: 'hint' }, 'Tracking was unavailable offline, so angle coverage is not verified. You can still inspect every frame with the easy spin preview.')),
         [btn('Close', 'btn', closeDialog),
          btn('Open easy spin preview', 'btn primary', () => openIdentitySpinPreview(person, packAssets, captureMode))]);
       }
     })]);
  paintShootGuide();
}

async function openIdentitySpinPreview(person, assets, mode = 'body') {
  const frames = (await Promise.all([...assets]
    .sort((a, b) => a.filename.localeCompare(b.filename))
    .map(async asset => ({ asset, url: await store.objectUrl(asset.id) })))).filter(frame => frame.url);
  if (frames.length < 2) return toast('This reference set needs at least two readable frames to spin.', true);

  let index = 0;
  let grab = null;
  let wheelTotal = 0;
  let autoplay = null;
  const picture = el('img', { src: frames[0].url, alt: `${person}, view 1 of ${frames.length}`, draggable: false });
  const stage = el('div', {
    className: 'spin-stage', tabIndex: 0, role: 'group',
    ariaLabel: `${person} interactive ${mode === 'face' ? '180 degree' : '360 degree'} reference viewer`
  }, picture,
  el('div', { className: 'spin-drag-cue', ariaHidden: 'true' }, '↔ Drag or swipe to turn'));
  const slider = el('input', { type: 'range', min: 0, max: frames.length - 1, step: 1, value: 0, ariaLabel: 'Spin view frame' });
  const readout = el('output', { className: 'spin-readout', ariaLive: 'polite' });
  const play = btn('Play turn', 'btn sm');

  const paint = next => {
    index = normalizeSpinIndex(next, frames.length);
    picture.src = frames[index].url;
    picture.alt = `${person}, view ${index + 1} of ${frames.length}`;
    slider.value = String(index);
    readout.textContent = `${index + 1} of ${frames.length} · ${spinAngleLabel(index, frames.length, mode)}`;
  };
  const stop = () => {
    if (autoplay) clearInterval(autoplay);
    autoplay = null;
    play.textContent = 'Play turn';
    play.setAttribute('aria-pressed', 'false');
  };
  const step = delta => { stop(); paint(stepSpinIndex(index, delta, frames.length)); stage.focus(); };
  play.onclick = () => {
    if (autoplay) return stop();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return toast('Automatic motion is off because reduced motion is enabled. Use drag, the slider, or arrow keys.');
    play.textContent = 'Pause turn'; play.setAttribute('aria-pressed', 'true');
    autoplay = setInterval(() => paint(index + 1), 180);
  };
  slider.oninput = () => { stop(); paint(Number(slider.value)); };
  stage.onpointerdown = event => {
    stop(); grab = { x: event.clientX, index }; stage.classList.add('dragging');
    stage.setPointerCapture(event.pointerId); stage.focus();
  };
  stage.onpointermove = event => {
    if (!grab) return;
    paint(spinIndexFromDrag(grab.index, event.clientX - grab.x, frames.length, 22));
  };
  stage.onpointerup = stage.onpointercancel = () => { grab = null; stage.classList.remove('dragging'); };
  stage.onlostpointercapture = () => { grab = null; stage.classList.remove('dragging'); };
  stage.onwheel = event => {
    event.preventDefault(); stop();
    wheelTotal += Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const delta = spinStepFromWheel(0, wheelTotal, 24);
    if (delta) { paint(index + delta); wheelTotal = 0; }
  };
  stage.onkeydown = event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    else if (event.key === 'Home') { event.preventDefault(); step(-index); }
    else if (event.key === ' ') { event.preventDefault(); play.click(); }
  };

  const controls = el('div', { className: 'spin-controls' },
    btn('← Turn left', 'btn spin-turn', () => step(-1)),
    el('label', { className: 'spin-slider' }, slider, readout),
    btn('Turn right →', 'btn spin-turn', () => step(1)));
  const body = el('div', { className: 'spin-viewer' },
    el('p', { className: 'spin-help' }, 'Drag or swipe the picture to turn it; a trackpad, the slider, and the arrow keys work too.'),
    stage, controls,
    el('div', { className: 'spin-actions' },
      btn('Front / reset', 'btn sm', () => { stop(); paint(0); stage.focus(); }), play));
  const close = () => { stop(); closeDialog(); };
  dialog(`${person} · easy spin preview`, body, [btn('Close', 'btn primary', close)], { onDismiss: stop });
  paint(0);
  requestAnimationFrame(() => stage.focus());
}

function metaBlock(asset) {
  const wrap = el('div', { className: 'block' });
  const stars = el('div', { className: 'stars', style: 'margin-bottom:10px' });
  for (let i = 1; i <= 5; i++) {
    const b = pressed(el('button', { type: 'button', title: `${i} star${i > 1 ? 's' : ''}` }, '★'), i <= (asset.rating || 0));
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
    const b = pressed(el('button', { title: s.hint, dataset: { s: s.id } }, s.label), asset.status === s.id);
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
  roleRow.append(el('label', { className: 'field', style: 'flex:1;margin-bottom:0' }, el('span', {}, 'Role'), roleSel));
  if (asset.kind === 'image') roleRow.append(btn('Upscale', 'btn sm', () => upscaleAsset(asset)));
  wrap.append(el('div', { style: 'margin-bottom:11px' }, roleRow));
  if (asset.kind === 'image' && asset.identityPackId) {
    const peers = state.assets.filter(item => item.role === 'reference' && item.identityPackId === asset.identityPackId);
    if (peers.length > 1) wrap.append(el('div', { style: 'margin-bottom:11px' },
      btn('Open easy spin preview', 'btn sm', () => openIdentitySpinPreview(
        asset.labels.lane || 'Reference set', peers, asset.identityCaptureMode || 'body'))));
  }

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
  ], { className: 'feedback-popover' });
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

const canvasBlob = (canvas, type = 'image/png') => new Promise((resolve, reject) =>
  canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The browser could not encode the image.')), type));

async function generativeFillDialog(asset) {
  if (asset.kind !== 'image') return toast('Generative Fill currently supports still images only.', true);
  const base = localStorage.getItem('cros:comfyBase') || `http://${location.hostname}:8188`;
  const engine = await detectComfy(base);
  if (!engine.ok) {
    return dialog('Generative Fill unavailable', el('div', {},
      el('p', {}, 'Generative Fill is not ready on this device.')),
    [btn('Close', 'btn primary', closeDialog)]);
  }
  let compatibility = null;
  try { compatibility = await inspectInpaintCompatibility(base); } catch { /* unavailable below */ }
  if (compatibility && !compatibility.compatibleNodes) {
    return dialog('Generative Fill unavailable', el('div', {},
      el('p', {}, 'This installation needs an update before it can use Generative Fill.')),
    [btn('Close', 'btn primary', closeDialog)]);
  }
  const checkpoints = compatibility?.inpaintModels || [];
  if (!checkpoints.length) {
    return dialog('Generative Fill unavailable', el('div', {},
      el('p', {}, 'Add the Generative Fill pack in Workspace, then try again.')),
    [btn('Close', 'btn primary', closeDialog)]);
  }

  const decoded = await decode(asset);
  if (!decoded) return toast('The selected image could not be decoded.', true);
  const mode = el('select', {},
    el('option', { value: 'add' }, 'Add inside selection'),
    el('option', { value: 'remove' }, 'Remove from selection'),
    el('option', { value: 'replace' }, 'Replace selection'));
  const model = el('select', {}, ...checkpoints.map((name, index) => el('option', { value: name }, `Fill quality ${index + 1}`)));
  const promptInput = el('textarea', { maxLength: 1000, placeholder: 'Describe what to add, remove, or replace…' });
  const negative = el('textarea', { maxLength: 1000, placeholder: 'Optional: details to avoid' });
  const styleIntent = el('select', {},
    el('option', { value: 'natural' }, 'Match believable photography'),
    el('option', { value: 'film' }, 'Add film character'),
    el('option', { value: 'stylized' }, 'Apply a stylized direction'));
  const defaults = { x: 25, y: 25, width: 50, height: 50 };
  const fields = {};
  const preview = el('canvas', { className: 'fill-mask-preview', width: 480, height: 300, tabIndex: 0,
    role: 'img', ariaLabel: 'Selection canvas. Draw around the area to change with a mouse, trackpad, pen, or touch.' });
  const selectionState = { tool: 'outline', outline: [], strokes: [], brushPercent: 8, drawing: false };
  const selectionStatus = el('p', { className: 'hint fill-selection-status', role: 'status' }, 'No area selected.');
  const imageRect = () => {
    const scale = Math.min(preview.width / decoded.w, preview.height / decoded.h);
    const width = decoded.w * scale, height = decoded.h * scale;
    return { x: (preview.width - width) / 2, y: (preview.height - height) / 2, width, height };
  };
  const drawSelection = (ctx, width, height, offsetX = 0, offsetY = 0) => {
    const path = normalizeInpaintPath(selectionState.outline);
    if (path.length >= 2) {
      ctx.beginPath(); ctx.moveTo(offsetX + path[0].x * width, offsetY + path[0].y * height);
      for (const point of path.slice(1)) ctx.lineTo(offsetX + point.x * width, offsetY + point.y * height);
      if (path.length >= 3) { ctx.closePath(); ctx.fill(); }
      ctx.stroke();
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, Math.min(width, height) * selectionState.brushPercent / 100);
    for (const stroke of selectionState.strokes) {
      const points = normalizeInpaintPath(stroke);
      if (!points.length) continue;
      ctx.beginPath(); ctx.moveTo(offsetX + points[0].x * width, offsetY + points[0].y * height);
      if (points.length === 1) ctx.lineTo(offsetX + points[0].x * width + 0.01, offsetY + points[0].y * height);
      else for (const point of points.slice(1)) ctx.lineTo(offsetX + point.x * width, offsetY + point.y * height);
      ctx.stroke();
    }
  };
  const paintPreview = () => {
    const ctx = preview.getContext('2d');
    ctx.clearRect(0, 0, preview.width, preview.height);
    const rect = imageRect();
    ctx.drawImage(decoded.source, rect.x, rect.y, rect.width, rect.height);
    ctx.save(); ctx.fillStyle = 'rgba(255, 184, 77, .30)'; ctx.strokeStyle = 'rgba(255, 184, 77, .68)'; ctx.lineWidth = 2;
    drawSelection(ctx, rect.width, rect.height, rect.x, rect.y); ctx.restore();
    try {
      const summary = summarizeInpaintMask(selectionState);
      preview.dataset.selectionKind = summary.kind; preview.dataset.selectionPoints = String(summary.pointCount);
      selectionStatus.textContent = `${summary.kind === 'lasso' ? 'Outline' : summary.kind === 'brush' ? 'Brush' : 'Mixed'} selection ready.`;
    } catch {
      preview.dataset.selectionKind = 'none'; preview.dataset.selectionPoints = '0'; selectionStatus.textContent = 'No area selected.';
    }
  };
  const pointFromEvent = event => {
    const box = preview.getBoundingClientRect(), image = imageRect();
    const x = (event.clientX - box.left) * preview.width / Math.max(1, box.width);
    const y = (event.clientY - box.top) * preview.height / Math.max(1, box.height);
    if (x < image.x || y < image.y || x > image.x + image.width || y > image.y + image.height) return null;
    return { x: (x - image.x) / image.width, y: (y - image.y) / image.height };
  };
  const appendPoint = point => {
    if (!point) return;
    const list = selectionState.tool === 'outline'
      ? selectionState.outline : selectionState.strokes[selectionState.strokes.length - 1];
    const prior = list[list.length - 1];
    if (!prior || Math.hypot(point.x - prior.x, point.y - prior.y) >= 0.003) list.push(point);
    paintPreview();
  };
  preview.onpointerdown = event => {
    const point = pointFromEvent(event); if (!point) return;
    event.preventDefault(); selectionState.drawing = true; preview.setPointerCapture(event.pointerId);
    if (selectionState.tool === 'outline') selectionState.outline = [];
    else selectionState.strokes.push([]);
    appendPoint(point);
  };
  preview.onpointermove = event => { if (selectionState.drawing) appendPoint(pointFromEvent(event)); };
  preview.onpointerup = preview.onpointercancel = event => {
    if (!selectionState.drawing) return;
    selectionState.drawing = false; preview.releasePointerCapture?.(event.pointerId); paintPreview();
  };
  const buildSelectionMask = (width, height) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; drawSelection(ctx, width, height);
    return canvas;
  };
  const buildEngineMask = selectionMask => {
    const canvas = document.createElement('canvas'); canvas.width = selectionMask.width; canvas.height = selectionMask.height;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(selectionMask, 0, 0); ctx.globalCompositeOperation = 'source-over';
    return canvas;
  };
  const measuredCoverage = selectionMask => {
    const pixels = selectionMask.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, selectionMask.width, selectionMask.height).data;
    let selected = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) selected += pixels[i] / 255;
    return selected / (selectionMask.width * selectionMask.height);
  };
  const outlineButton = btn('Outline', 'btn sm', () => {
    selectionState.tool = 'outline'; pressed(outlineButton, true); pressed(brushButton, false);
  });
  const brushButton = btn('Brush', 'btn sm', () => {
    selectionState.tool = 'brush'; pressed(brushButton, true); pressed(outlineButton, false);
  });
  pressed(outlineButton, true); pressed(brushButton, false);
  const selectionActions = el('div', { className: 'fill-selection-actions' }, outlineButton, brushButton,
    btn('Undo', 'btn sm', () => {
      if (selectionState.tool === 'brush' && selectionState.strokes.length) selectionState.strokes.pop();
      else selectionState.outline = [];
      paintPreview();
    }),
    btn('Clear', 'btn sm', () => { selectionState.outline = []; selectionState.strokes = []; paintPreview(); }));
  const brushSize = el('input', { type: 'range', min: 2, max: 24, step: 1, value: selectionState.brushPercent });
  const brushSizeOut = el('output', {}, `${selectionState.brushPercent}%`);
  brushSize.oninput = () => {
    selectionState.brushPercent = Number(brushSize.value); brushSizeOut.textContent = `${selectionState.brushPercent}%`; paintPreview();
  };
  const dimensions = el('div', { className: 'fill-selection-grid' });
  for (const [key, label] of [['x', 'Left %'], ['y', 'Top %'], ['width', 'Width %'], ['height', 'Height %']]) {
    const input = fields[key] = el('input', { type: 'number', min: key === 'x' || key === 'y' ? 0 : 1, max: 100, step: 1, value: defaults[key] });
    dimensions.append(el('label', { className: 'field' }, el('span', {}, label), input));
  }
  const applyBounds = btn('Use rectangle', 'btn sm', () => {
    const s = normalizeInpaintSelection(Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value])));
    const left = s.x / 100, top = s.y / 100, right = (s.x + s.width) / 100, bottom = (s.y + s.height) / 100;
    selectionState.outline = [{ x:left, y:top }, { x:right, y:top }, { x:right, y:bottom }, { x:left, y:bottom }];
    selectionState.strokes = []; paintPreview();
  });
  const denoise = el('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: 0.8 });
  const denoiseOut = el('output', {}, '0.80');
  denoise.oninput = () => { denoiseOut.textContent = Number(denoise.value).toFixed(2); };
  const status = el('p', { className: 'hint', role: 'status' }, 'The result will be added as a new candidate.');
  const body = el('div', {},
    el('p', { className: 'hint', style: 'color:var(--warn)' }, 'Beta: review edges, anatomy, fabric, skin, and lighting at 100% before approval.'),
    !covers(lic, 'photo') ? el('p', { className: 'hint', style: 'color:var(--warn)' },
      'Generative Fill runs on this computer and draws no cloud balance, but it is a licensed Photo capability. Activate a Photo Single Studio or Full Studio licence in Deliver.') : null,
    el('p', { className: 'hint' }, 'Draw around the area, then describe the change; your original stays unchanged.'),
    preview,
    el('h4', { className: 'editor-group-title' }, 'Selection'), selectionActions, selectionStatus,
    el('label', { className: 'editor-slider fill-brush-size' }, el('span', {}, 'Brush size'), brushSize, brushSizeOut),
    el('details', { className: 'editor-control-group fill-precise-selection' }, el('summary', {}, 'Precise rectangle'),
      el('div', { className: 'editor-control-body' }, dimensions, applyBounds)),
    el('label', { className: 'field' }, el('span', {}, 'Operation'), mode),
    el('label', { className: 'field' }, el('span', {}, 'Quality'), model),
    el('label', { className: 'field' }, el('span', {}, 'Describe the change'), promptInput),
    el('label', { className: 'field' }, el('span', {}, 'Look'), styleIntent),
    el('p', { className: 'hint' }, 'Believable skin, fabric, anatomy, materials, and environmental light remain the default unless you explicitly choose a stylized result.'),
    el('label', { className: 'field' }, el('span', {}, 'Avoid'), negative),
    el('label', { className: 'editor-slider fill-strength' }, el('span', {}, 'Blend strength'), denoise, denoiseOut), status);
  // Assigned by the `dialog()` call below; the handler only ever runs after it,
  // and it must close its own dialog, not whatever survived the render.
  let fillDialog = null;
  const run = btn('Create new candidate', 'btn primary', async () => {
    const requested = promptInput.value.trim();
    if (!requested) return toast('Describe the intended result first.', true);
    run.disabled = true;
    let fillBoundaryQuality = null;
    // Generative Fill is a local production job, metered exactly like Photo
    // enhancement: the licence is confirmed online and the operation is
    // recorded in Usage. Local work never draws from the cloud balance.
    const authorization = await authorizeOutbound({ product: 'photo', artifactKind: 'upload', quantity: 1 });
    if (!authorization.ok) {
      run.disabled = false;
      status.textContent = `Generative Fill authorization failed: ${sentence(deliveryReason(authorization.reason || 'authorization_required'))}`;
      return;
    }
    try {
      await busy(async () => {
        const source = document.createElement('canvas'); source.width = decoded.w; source.height = decoded.h;
        source.getContext('2d').drawImage(decoded.source, 0, 0, decoded.w, decoded.h);
        const shape = summarizeInpaintMask(selectionState);
        const selectionMask = buildSelectionMask(decoded.w, decoded.h);
        const coverage = measuredCoverage(selectionMask);
        if (coverage < 0.00001) throw new Error('Draw around the area to change first.');
        const jobSpec = makeInpaintJobSpec({ width: decoded.w, height: decoded.h, selection: shape,
          operation: mode.value, geometry: asset.geometry, execution: 'local', maskCoverage: coverage,
          selectionKind: shape.kind });
        const benchmark = createInpaintBenchmark(jobSpec);
        benchmark.phase('local_3d_mapping');
        const engineMask = buildEngineMask(selectionMask);
        benchmark.phase('mask_preparation');
        const operationPrompt = mode.value === 'remove'
          ? `remove ${requested}; reconstruct the selected area as a coherent continuation of the surrounding scene, matching structure, perspective, repeated patterns, texture, depth, and environmental light; no blur, smudge, or empty patch`
          : requested;
        const avoid = mode.value === 'remove' ? [negative.value.trim(), requested].filter(Boolean).join(', ') : negative.value.trim();
        const contextPixels = Math.max(8, Math.min(32, Math.round(Math.min(decoded.w, decoded.h) * 0.012)));
        const result = await inpaintOne(await canvasBlob(source), `fill-source-${asset.id}.png`,
          await canvasBlob(engineMask), `fill-mask-${asset.id}.png`, {
            ckpt: model.value, prompt: operationPrompt, negative: avoid,
            styleIntent: styleIntent.value,
            denoise: Number(denoise.value), growMaskBy: contextPixels
          }, () => { status.textContent = 'Creating candidate…'; }, base);
        benchmark.phase('inpainting_request');
        const blended = await blendInpaintMaskedCandidate(source, result.blob, selectionMask, 16);
        const boundaryQuality = await assessInpaintMaskedBoundary(source, blended, selectionMask);
        fillBoundaryQuality = boundaryQuality;
        await settleOutbound(authorization.authorization.id, await blobEvidenceHash(blended));
        const file = new File([blended], `fill_${mode.value}_${result.seed}.png`, { type: 'image/png' });
        const created = newAsset(state.project.id, file);
        created.source = 'generated-fill-local';
        created.inpaintJob = jobSpec;
        created.inpaintBoundaryQuality = boundaryQuality;
        if (boundaryQuality.status !== 'pass') created.labels = { ...created.labels, boundary_review: 'required' };
        created.provenance = `MaterialLogix Generative Fill Beta (${mode.value}; seed ${result.seed}; ${styleIntent.value} style intent; ${shape.kind} selection; coverage ${coverage.toFixed(6)}; bounds ${JSON.stringify({ x:shape.x, y:shape.y, width:shape.width, height:shape.height })}). Source asset ${asset.id}. Prompt: ${requested.slice(0, 300)}`;
        await store.addAsset(created, file);
        const url = await store.objectUrl(created.id);
        Object.assign(created, await probe(file, url));
        log(created, `Generative Fill ${mode.value}`, state.reviewer);
        await store.saveAsset(created); state.assets.push(created);
        await runAnalysis(created, { quiet: true });
        benchmark.phase('output_processing');
        created.inpaintBenchmark = benchmark.finish();
        await store.saveAsset(created);
        state.assets = await store.listAssets(state.project.id);
        forgetDecodesOutside(state.assets.map(a => a.id));
        state.index = Math.max(0, visibleAssets().findIndex(item => item.id === created.id));
      });
      fillDialog.close(); render(); toast(fillBoundaryQuality?.status === 'pass'
        ? 'Generative Fill Beta candidate created — automated boundary continuity passed; complete human review.'
        : 'Generative Fill Beta candidate created and flagged for boundary review.', fillBoundaryQuality?.status !== 'pass');
    } catch (err) {
      const release = await releaseUsage(authorization.authorization.id, 'render_failed');
      status.textContent = `Failed: ${sentence(deliveryReason(err))} ${release.message}`;
    }
    finally { run.disabled = false; }
  });
  fillDialog = dialog('Generative Fill Beta', body, [btn('Cancel', 'btn', closeDialog), run]);
  requestAnimationFrame(paintPreview);
}

function editingBlock(asset) {
  const edit = ensureEditState(asset);
  const wrap = el('div', { className: 'block editor-block' });
  const modes = el('div', { className: 'seg editor-mode', role: 'group', ariaLabel: 'Editing mode' });
  for (const [value, label] of [['guided', 'Guided'], ['advanced', 'Advanced']]) {
    const b = pressed(el('button', { type: 'button' }, label), edit.mode === value);
    b.onclick = () => {
      mutate(asset, `editor mode → ${label}`, () => { edit.mode = value; });
      renderReview();
    };
    modes.append(b);
  }
  if (asset.kind === 'image') {
    const fillButton = el('button', { type: 'button', className: 'editor-fill-tab' }, 'Generative Fill Beta');
    fillButton.dataset.release = GENERATIVE_FILL_RELEASE;
    fillButton.title = 'Beta feature; review every result before use.';
    fillButton.setAttribute('aria-haspopup', 'dialog');
    fillButton.onclick = () => generativeFillDialog(asset);
    modes.append(fillButton);
  }
  wrap.append(modes, el('p', { className: 'hint editor-explainer' },
    edit.mode === 'guided'
      ? 'Essential adjustments with balanced defaults and non-destructive control.'
      : 'Precision tone, color, detail, finishing, and spatial quality controls.'));

  const applyPreset = (label, values) => {
    mutate(asset, `applied ${label} edit preset`, () => {
      edit.adjustments = { ...edit.adjustments, ...values };
    });
    renderReview();
  };
  const presets = el('div', { className: 'editor-presets' },
    btn('Refined clarity', 'btn sm', () => applyPreset('Refined clarity', { exposure: 0.08, contrast: 8, vibrance: 10, sharpen: 8, blur: 0 })),
    btn('Warm editorial', 'btn sm', () => applyPreset('Warm editorial', { exposure: 0.04, contrast: 6, temperature: 12, tint: 2, vibrance: 6 })),
    btn('Neutral color match', 'btn sm', () => applyPreset('Neutral color match', { exposure: 0, contrast: 0, temperature: 0, tint: 0, saturation: 0, vibrance: 0 })),
    btn('Reset adjustments', 'btn sm', () => applyPreset('reset', { exposure: 0, contrast: 0, highlights: 0, shadows: 0, temperature: 0, tint: 0, saturation: 0, vibrance: 0, denoise: 0, blur: 0, sharpen: 0, grain: 0, vignette: 0, rotate: 0 }))
  );
  wrap.append(presets);

  const boundSlider = (target, key, label, min, max, step = 1) => {
    const value = target[key] ?? 0;
    const readout = el('output', {}, String(value));
    const input = el('input', { type: 'range', min, max, step, value });
    let captured = false;
    const capture = () => { if (!captured) { snapshot(asset, `adjusted ${label}`); captured = true; } };
    input.oninput = () => {
      capture();
      target[key] = Number(input.value);
      readout.textContent = input.value;
      touchAsset(asset);
      paintStage();
    };
    input.onchange = () => { log(asset, `${label} → ${input.value}`, state.reviewer); captured = false; };
    return el('label', { className: 'editor-slider' }, el('span', {}, label), input, readout);
  };
  const slider = (key, label, min, max, step = 1) => boundSlider(edit.adjustments, key, label, min, max, step);
  const controlGroup = (title, ...controls) => el('details', { className: 'editor-control-group', name: 'photo-editor-controls' },
    el('summary', {}, title), el('div', { className: 'editor-control-body' }, ...controls));

  const healTools = () => {
    const armed = state.editTool === 'heal';
    const toggle = btn(armed ? 'Spot heal · armed' : 'Spot heal', 'btn sm' + (armed ? ' on' : ''), () => {
      state.editTool = armed ? null : 'heal';
      renderReview();
    });
    toggle.setAttribute('aria-pressed', String(armed));
    const size = el('input', { type: 'range', min: 0.4, max: 3, step: 0.1, value: state.healSize });
    const sizeOut = el('output', {}, String(state.healSize));
    size.oninput = () => { state.healSize = Number(size.value); sizeOut.textContent = size.value; };
    const heals = edit.adjustments.heals || [];
    return el('div', { className: 'editor-tool' },
      el('div', { className: 'editor-tool-row' }, toggle,
        heals.length ? btn(`Clear spots (${heals.length})`, 'btn sm', () => {
          mutate(asset, 'cleared healed spots', () => { edit.adjustments.heals = []; });
          renderReview();
        }) : null),
      el('label', { className: 'editor-slider' }, el('span', {}, 'Spot size'), size, sizeOut),
      el('p', { className: 'hint' }, armed
        ? 'Click a blemish on the photo to blend it away.'
        : 'One click rebuilds a small spot from its surroundings.'));
  };

  const brushTools = () => {
    const armed = state.editTool === 'brush';
    const selective = edit.adjustments.selective;
    const toggle = btn(armed ? 'Paint mask · armed' : 'Paint mask', 'btn sm' + (armed ? ' on' : ''), () => {
      state.editTool = armed ? null : 'brush';
      renderReview();
    });
    toggle.setAttribute('aria-pressed', String(armed));
    const size = el('input', { type: 'range', min: 1, max: 8, step: 0.5, value: state.brushSize });
    const sizeOut = el('output', {}, String(state.brushSize));
    size.oninput = () => { state.brushSize = Number(size.value); sizeOut.textContent = size.value; };
    return el('div', { className: 'editor-tool' },
      el('div', { className: 'editor-tool-row' }, toggle,
        selective.strokes.length ? btn(`Clear mask (${selective.strokes.length})`, 'btn sm', () => {
          mutate(asset, 'cleared the selective mask', () => { selective.strokes = []; });
          renderReview();
        }) : null),
      el('label', { className: 'editor-slider' }, el('span', {}, 'Brush size'), size, sizeOut),
      boundSlider(selective, 'exposure', 'Exposure', -1, 1, 0.05),
      boundSlider(selective, 'temperature', 'Temperature', -100, 100),
      boundSlider(selective, 'saturation', 'Saturation', -100, 100),
      el('p', { className: 'hint' }, armed
        ? 'Paint on the photo; these adjustments apply only inside the mask.'
        : 'Paint a soft mask, then grade only what it covers.'));
  };

  const curveTools = () => {
    const W = 240, H = 150, PAD = 10;
    const toSvg = p => [PAD + (p.x / 255) * (W - 2 * PAD), H - PAD - (p.y / 255) * (H - 2 * PAD)];
    const svg = svgEl('svg', {
      viewBox: `0 0 ${W} ${H}`, class: 'curve-editor', role: 'img',
      'aria-label': 'Luminance curve. Drag one of the four points to shape tones.'
    });
    for (const f of [1 / 3, 2 / 3]) {
      svg.append(
        svgEl('line', { class: 'curve-grid', x1: PAD + f * (W - 2 * PAD), y1: PAD, x2: PAD + f * (W - 2 * PAD), y2: H - PAD }),
        svgEl('line', { class: 'curve-grid', x1: PAD, y1: PAD + f * (H - 2 * PAD), x2: W - PAD, y2: PAD + f * (H - 2 * PAD) }));
    }
    const [dx0, dy0] = toSvg({ x: 0, y: 0 });
    const [dx1, dy1] = toSvg({ x: 255, y: 255 });
    svg.append(svgEl('line', { class: 'curve-ref', x1: dx0, y1: dy0, x2: dx1, y2: dy1 }));
    const line = svgEl('polyline', { class: 'curve-line' });
    svg.append(line);
    const dots = edit.adjustments.curve.map(() => svgEl('circle', { class: 'curve-dot', r: 5.5 }));
    svg.append(...dots);
    const redraw = () => {
      const lut = buildLuminanceLut(edit.adjustments.curve);
      const points = [];
      for (let x = 0; x <= 255; x += 5) points.push(toSvg({ x, y: lut ? lut[x] : x }).join(','));
      line.setAttribute('points', points.join(' '));
      edit.adjustments.curve.forEach((p, i) => {
        const [cx, cy] = toSvg(p);
        dots[i].setAttribute('cx', cx);
        dots[i].setAttribute('cy', cy);
      });
    };
    redraw();
    let drag = -1;
    svg.onpointerdown = e => {
      const box = svg.getBoundingClientRect();
      const sx = (e.clientX - box.left) * W / box.width;
      const sy = (e.clientY - box.top) * H / box.height;
      let bestDist = 22;
      edit.adjustments.curve.forEach((p, i) => {
        const [cx, cy] = toSvg(p);
        const dist = Math.hypot(cx - sx, cy - sy);
        if (dist < bestDist) { drag = i; bestDist = dist; }
      });
      if (drag < 0) return;
      snapshot(asset, 'shaped the luminance curve');
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    svg.onpointermove = e => {
      if (drag < 0) return;
      const box = svg.getBoundingClientRect();
      const x = (((e.clientX - box.left) * W / box.width) - PAD) / (W - 2 * PAD) * 255;
      const y = (H - PAD - ((e.clientY - box.top) * H / box.height)) / (H - 2 * PAD) * 255;
      const curve = edit.adjustments.curve;
      const p = curve[drag];
      p.y = Math.max(0, Math.min(255, y));
      // End points hold the black and white anchors; inner points stay ordered.
      if (drag > 0 && drag < curve.length - 1) {
        p.x = Math.max(curve[drag - 1].x + 6, Math.min(curve[drag + 1].x - 6, x));
      }
      redraw();
      touchAsset(asset);
      paintStage();
    };
    svg.onpointerup = svg.onpointercancel = () => {
      if (drag < 0) return;
      drag = -1;
      log(asset, 'shaped the luminance curve', state.reviewer);
      touchAsset(asset);
    };
    return el('div', { className: 'editor-tool' }, svg,
      el('div', { className: 'editor-tool-row' }, btn('Reset curve', 'btn sm', () => {
        mutate(asset, 'reset the luminance curve', () => {
          edit.adjustments.curve = CURVE_IDENTITY.map(p => ({ ...p }));
        });
        renderReview();
      })),
      el('p', { className: 'hint' }, 'One luminance curve, four points, applied with every other adjustment.'));
  };

  if (edit.mode === 'guided') {
    wrap.append(
      slider('rotate', 'Straighten', -15, 15, 0.1),
      slider('exposure', 'Light', -1, 1, 0.05), slider('contrast', 'Contrast', -50, 50),
      slider('temperature', 'Warmth', -50, 50), slider('vibrance', 'Color', -50, 50),
      slider('denoise', 'Noise cleanup', 0, 100));
    if (asset.kind === 'image') wrap.append(healTools());
  } else {
    wrap.append(
      controlGroup('Geometry',
        slider('rotate', 'Straighten', -15, 15, 0.1)));
    if (asset.kind === 'image') wrap.append(
      controlGroup('Repair', healTools()),
      controlGroup('Selective brush', brushTools()));
    wrap.append(
      controlGroup('Tone',
        slider('exposure', 'Exposure', -2, 2, 0.05), slider('contrast', 'Contrast', -100, 100),
        slider('highlights', 'Highlights', -100, 100), slider('shadows', 'Shadows', -100, 100)),
      controlGroup('Color',
        slider('temperature', 'Temperature', -100, 100), slider('tint', 'Tint', -100, 100),
        slider('saturation', 'Saturation', -100, 100), slider('vibrance', 'Vibrance', -100, 100)),
      controlGroup('Detail and finishing',
        slider('denoise', 'Noise reduction', 0, 100), slider('sharpen', 'Sharpening', 0, 100),
        slider('blur', 'Optical blur', 0, 20, 0.25),
        slider('grain', 'Film grain', 0, 100), slider('vignette', 'Vignette', 0, 100)));
    if (asset.kind === 'image') wrap.append(controlGroup('Curves', curveTools()));
  }

  const gridToggle = el('input', { type: 'checkbox', checked: edit.pixelGrid.enabled });
  gridToggle.onchange = () => {
    mutate(asset, `Pixel Grid Review ${gridToggle.checked ? 'enabled' : 'disabled'}`, () => { edit.pixelGrid.enabled = gridToggle.checked; });
    renderReview();
  };
  const diagnostic = el('div', { className: 'pixel-review-controls' },
    el('label', { className: 'toggle' }, gridToggle, 'Edge Check'),
    el('p', { className: 'hint' }, 'Finds sudden changes in color or texture.'));
  if (edit.mode === 'advanced') {
    const columns = el('input', { type: 'range', min: 6, max: 32, step: 1, value: edit.pixelGrid.columns });
    const sensitivity = el('input', { type: 'range', min: 0, max: 100, step: 1, value: edit.pixelGrid.sensitivity });
    const bind = (input, output, key) => {
      let captured = false;
      input.oninput = () => {
        if (!captured) { snapshot(asset, `adjusted spatial continuity ${key}`); captured = true; }
        edit.pixelGrid[key] = Number(input.value); output.textContent = input.value;
        touchAsset(asset); if (edit.pixelGrid.enabled) paintStage();
      };
      input.onchange = () => { log(asset, `Spatial continuity ${key} → ${input.value}`, state.reviewer); captured = false; };
    };
    const columnsOut = el('output', {}, String(edit.pixelGrid.columns));
    const sensitivityOut = el('output', {}, String(edit.pixelGrid.sensitivity));
    bind(columns, columnsOut, 'columns'); bind(sensitivity, sensitivityOut, 'sensitivity');
    diagnostic.append(
      el('label', { className: 'editor-slider' }, el('span', {}, 'Region density'), columns, columnsOut),
      el('label', { className: 'editor-slider' }, el('span', {}, 'Sensitivity'), sensitivity, sensitivityOut));
  }
  wrap.append(diagnostic);
  return wrap;
}

const REVIEW_RAIL_OPEN_KEY = 'mlx:review-tools-open';
const REVIEW_RAIL_WIDTH_KEY = 'mlx:review-tools-width';
const REVIEW_RAIL_DEFAULT_WIDTH = 372;
const REVIEW_RAIL_MIN_WIDTH = 280;
const REVIEW_RAIL_MAX_WIDTH = 560;

function reviewRailIsOpen() {
  const saved = localStorage.getItem(REVIEW_RAIL_OPEN_KEY);
  if (saved !== null) return saved !== 'false';
  return !matchMedia('(max-width: 900px)').matches;
}

function reviewRailWidth() {
  const raw = localStorage.getItem(REVIEW_RAIL_WIDTH_KEY);
  if (raw === null) return REVIEW_RAIL_DEFAULT_WIDTH;
  const saved = Number(raw);
  return Number.isFinite(saved)
    ? Math.max(REVIEW_RAIL_MIN_WIDTH, Math.min(REVIEW_RAIL_MAX_WIDTH, saved))
    : REVIEW_RAIL_DEFAULT_WIDTH;
}

function setReviewRailOpen(open) {
  localStorage.setItem(REVIEW_RAIL_OPEN_KEY, String(open));
  renderReview();
}

function attachReviewRailResize(rail, handle) {
  const applyWidth = value => {
    const available = Math.max(REVIEW_RAIL_MIN_WIDTH, Math.min(REVIEW_RAIL_MAX_WIDTH, innerWidth - 420));
    const width = Math.max(REVIEW_RAIL_MIN_WIDTH, Math.min(available, Math.round(value)));
    rail.style.setProperty('--review-rail-width', `${width}px`);
    handle.setAttribute('aria-valuenow', String(width));
    handle.setAttribute('aria-valuetext', `${width} pixels wide`);
    localStorage.setItem(REVIEW_RAIL_WIDTH_KEY, String(width));
  };
  applyWidth(reviewRailWidth());
  handle.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Home') return applyWidth(REVIEW_RAIL_DEFAULT_WIDTH);
    const step = event.shiftKey ? 48 : 16;
    applyWidth(rail.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? step : -step));
  };
  handle.ondblclick = () => applyWidth(REVIEW_RAIL_DEFAULT_WIDTH);
  handle.onpointerdown = event => {
    if (matchMedia('(max-width: 900px)').matches) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = rail.getBoundingClientRect().width;
    handle.setPointerCapture(event.pointerId);
    rail.classList.add('resizing');
    handle.onpointermove = move => applyWidth(startWidth + startX - move.clientX);
    handle.onpointerup = handle.onpointercancel = finish => {
      if (handle.hasPointerCapture(finish.pointerId)) handle.releasePointerCapture(finish.pointerId);
      handle.onpointermove = null;
      handle.onpointerup = null;
      handle.onpointercancel = null;
      rail.classList.remove('resizing');
    };
  };
}

function renderRail(asset) {
  const rail = el('aside', { className: 'rail', id: 'rail', ariaLabel: 'Review tools' });
  const resizeHandle = el('div', {
    className: 'rail-resizer', role: 'separator', tabIndex: 0,
    ariaLabel: 'Resize Review tools', ariaOrientation: 'vertical',
    ariaValueMin: REVIEW_RAIL_MIN_WIDTH, ariaValueMax: REVIEW_RAIL_MAX_WIDTH
  });
  attachReviewRailResize(rail, resizeHandle);
  const railHeader = el('div', { className: 'rail-header' },
    el('strong', {}, 'Review tools'),
    el('span', { className: 'spacer' }),
    btn('Close', 'btn sm rail-close', () => setReviewRailOpen(false)));
  const surfaces = surfacesForAsset(asset);
  const subsection = (title, detail, body, { open = false, badge = null, name = 'review-subsection' } = {}) => el('details', {
    className: 'rail-subsection', name, open
  }, el('summary', {},
    el('span', { className: 'rail-section-label' }, el('span', {}, title), el('small', {}, detail)),
    badge), body);

  const auto = assetIssues(asset, state.assets, state.project);
  const perPlacement = Object.keys(asset.placements || {})
    .filter(sid => asset.placements[sid].decision !== 'pending')
    .flatMap(sid => placementIssues(asset, sid, state.project).map(i => ({ ...i, surface: SURFACE_BY_ID[sid]?.label })));
  const all = [...auto, ...perPlacement].sort((a, b) => ({ block: 0, warn: 1, info: 2 })[a.level] - ({ block: 0, warn: 1, info: 2 })[b.level]);

  let placementBody;
  if (!surfaces.length) {
    placementBody = el('div', { className: 'block' }, el('p', { className: 'hint' }, 'Choose placements in Workspace.'));
  } else {
    placementBody = el('div', { className: 'block' });
    const categoryFor = surface => ['instagram', 'tiktok'].includes(surface.group)
      ? ['social', 'Social media']
      : ['meta', 'google'].includes(surface.group)
        ? ['ads', 'Paid ads']
        : [surface.group, surface.groupLabel];
    const categories = new Map();
    for (const surface of surfaces) {
      const [categoryId, categoryLabel] = categoryFor(surface);
      if (!categories.has(categoryId)) categories.set(categoryId, { label: categoryLabel, platforms: new Map() });
      const platforms = categories.get(categoryId).platforms;
      if (!platforms.has(surface.group)) platforms.set(surface.group, { label: surface.groupLabel, surfaces: [] });
      platforms.get(surface.group).surfaces.push(surface);
    }
    for (const [categoryId, category] of categories) {
      const categoryCount = [...category.platforms.values()].reduce((count, platform) => count + platform.surfaces.length, 0);
      const categoryBody = el('div', { className: 'placement-group-body' });
      for (const [platformId, platform] of category.platforms) {
        const cards = el('div', { className: 'placement-platform-body' });
        for (const surface of platform.surfaces) cards.append(placementCard(asset, surface));
        categoryBody.append(el('details', { className: 'placement-platform', name: `placement-${categoryId}` },
          el('summary', {}, el('span', {}, platform.label), el('small', {}, `${platform.surfaces.length} format${platform.surfaces.length === 1 ? '' : 's'}`)),
          cards));
      }
      placementBody.append(el('details', { className: 'placement-group', name: 'placement-category' },
        el('summary', {}, el('span', {}, category.label), el('small', {}, `${categoryCount} format${categoryCount === 1 ? '' : 's'}`)),
        categoryBody));
    }
    placementBody.append(el('div', { style: 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap' },
      btn('Approve all', 'btn sm', () => {
        mutate(asset, 'approved every surface', () => {
          for (const s of surfaces) ensurePlacement(asset, s.id).decision = 'approved';
          syncStatusFromPlacements(asset);
        });
        renderReview(); renderCounters();
      }),
      btn('Reject all', 'btn sm', () => {
        mutate(asset, 'denied every surface', () => {
          for (const s of surfaces) ensurePlacement(asset, s.id).decision = 'denied';
          syncStatusFromPlacements(asset);
        });
        renderReview(); renderCounters();
      }),
      btn('Auto-reframe all', 'btn sm', () => reframeAll(asset))));
  }
  const editPanel = el('div', { className: 'rail-tab-content' }, editingBlock(asset));
  if (asset.kind === 'video') editPanel.append(subsection('Video production', 'Timing, sound, and rendering', videoBlock(asset), { open: true, name: 'edit-subsection' }));

  const reviewPanel = el('div', { className: 'rail-tab-content' },
    subsection('Automated checks', 'Items to review',
      el('div', { className: 'block', id: 'issueBlock' }, issueList(all, 'Nothing flagged. Human review still required.')),
      { open: true, badge: all.some(i => i.level === 'block') ? el('span', { className: 'chip rejected' }, 'blocking') : null }),
    subsection('QA checklist', 'Optional review checklist', qaBlock(asset)));

  const fixesPanel = el('div', { className: 'rail-tab-content' }, fixBlock(asset));
  const deliverPanel = el('div', { className: 'rail-tab-content' }, placementBody);
  const detailsPanel = el('div', { className: 'rail-tab-content' },
    subsection('Measurements', 'Resolution, color, and detail', metricsBlock(asset), { open: true, name: 'details-subsection' }),
    subsection('Asset details', 'Rating, role, and notes', metaBlock(asset), { name: 'details-subsection' }),
    subsection('Activity', 'Saved project history', logBlock(asset), { name: 'details-subsection' }));

  const definitions = [
    ['edit', 'Edit', editPanel],
    ['review', 'Review', reviewPanel],
    ['fixes', 'Fixes', fixesPanel],
    ['deliver', 'Deliver', deliverPanel],
    ['details', 'Details', detailsPanel]
  ];
  const tabList = el('div', { className: 'rail-tabs', role: 'tablist', ariaLabel: 'Studio workflow' });
  const tabs = [];
  const panels = [];
  const activate = index => {
    tabs.forEach((tab, tabIndex) => {
      const selected = tabIndex === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[tabIndex].hidden = !selected;
    });
  };
  definitions.forEach(([id, label, content], index) => {
    const tabId = `review-tab-${id}`;
    const panelId = `review-panel-${id}`;
    const tab = el('button', { id: tabId, type: 'button', role: 'tab' }, label);
    tab.setAttribute('aria-controls', panelId);
    tab.onclick = () => { state.reviewRailTab = id; activate(index); };
    tab.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      state.reviewRailTab = definitions[next][0];
      activate(next); tabs[next].focus();
    };
    const panel = el('section', { id: panelId, className: 'rail-tab-panel', role: 'tabpanel' }, content);
    panel.setAttribute('aria-labelledby', tabId);
    tabs.push(tab); panels.push(panel); tabList.append(tab);
  });
  const requestedTab = definitions.findIndex(([id]) => id === state.reviewRailTab);
  activate(requestedTab >= 0 ? requestedTab : 0);
  rail.append(resizeHandle, railHeader, tabList, ...panels);
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
    for (const s of surfacesForAsset(asset)) {
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
    el('div', { className: 'wizard-field-row' },
      (() => { const f = field('brand', 'Brand', 'Your brand'); f.style.flex = '1'; return f; })(),
      (() => { const f = field('audience', 'Audience', 'Who has to stop scrolling'); f.style.flex = '1'; return f; })()),
    field('tone', 'Tone', 'e.g. warm, editorial, quietly confident'));

  card.append(el('label', { className: 'field' }, el('span', {}, 'Where will it run?')));
  const presets = el('div', { className: 'presets' });
  const paint = () => {
    for (const btnEl of presets.children) {
      const pr = SURFACE_PRESETS.find(x => x.id === btnEl.dataset.id);
      pressed(btnEl, pr.surfaces.every(id => state.project.surfaces.includes(id)));
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
  // Prefer the local bridge: Real-ESRGAN on supported GPUs, with explicit CPU
  // recovery. A connected ComfyUI remains the secondary local engine.
  const bridge = await detectBridge();
  let engine = null, models = [];
  if (bridge.ok && bridge.upscale?.available) {
    models = bridge.upscale.models;
  } else {
    const savedBase = localStorage.getItem('cros:comfyBase') || `http://${location.hostname}:8188`;
    engine = await detectComfy(savedBase);
    if (!engine.ok) {
      return toast('Photo enhancement is not ready on this device.', true);
    }
    try { models = await listUpscaleModels(engine.base); } catch { /* handled */ }
    if (!models.length) {
      return toast('Add the Photo enhancement pack in Workspace, then try again.', true);
    }
  }
  // The licence decides which models are on the menu. The dialog used to list
  // everything installed and preselect 4x for everyone, with a line of text
  // claiming a plan was required - a sentence where a gate belonged.
  const lane = laneFor(lic, 'photo');
  const entitled = upscaleModelsForLane(lane, models);
  if (!entitled.length) {
    return toast(covers(lic, 'photo')
      ? 'This device does not have the enhancement model your plan uses. Add the Photo enhancement pack in Workspace.'
      : `Free preview enhances at ${lane.upscale.factor}, and that model is not installed on this device.`, true);
  }
  const pick = el('select', {});
  for (const [index, m] of entitled.entries()) pick.append(el('option', {
    value: m,
    selected: index === 0
  }, `Enhancement quality ${index + 1}`));
  dialog('Enhance photo',
    el('div', {},
      el('p', { className: 'hint' },
        'Choose the final size; MaterialLogix will add a linked copy and check it automatically.'),
      !covers(lic, 'photo') ? el('p', { className: 'hint', style: 'color:var(--warn)' },
        `Free preview enhances at ${LANES.free.upscale.factor}; licensed Photo plans unlock ${LANES.paid.upscale.factor}.`) : null,
      el('label', { className: 'field' }, el('span', {}, 'Quality'), pick)),
    [btn('Cancel', 'btn', closeDialog),
     btn('Upscale', 'btn primary', async () => {
       const model = pick.value;
       closeDialog();
       const authorization = await authorizeOutbound({ product: 'photo', artifactKind: 'upload', quantity: 1 });
       if (!authorization.ok) return toast(`Online upscale authorization failed: ${sentence(deliveryReason(authorization.reason || 'authorization_required'))}`, true);
       let completedEngine = '';
       try {
         await busy(async () => {
           toast('Enhancing photo\u2026');
           const blob = await store.getBlob(asset.id);
           const out = engine
             ? await upscaleOne(blob, asset.filename, model, () => {}, engine.base)
             : await upscaleViaBridge(blob, model);
           completedEngine = engine ? 'the ComfyUI engine' : localUpscaleEngineLabel(out.engine);
           await settleOutbound(authorization.authorization.id, await blobEvidenceHash(out.blob));
           const file = new File([out.blob], asset.filename.replace(/(\.[a-z0-9]+)?$/i, '_up$1'), { type: out.blob.type || 'image/png' });
           const up = newAsset(state.project.id, file);
           up.source = 'enhanced-local';
           up.labels = { ...asset.labels };
           up.altText = asset.altText;
           up.provenance = `Upscaled from ${asset.filename} with ${model} on ${completedEngine}. ` + (asset.provenance || '');
           await store.addAsset(up, file);
           const url = await store.objectUrl(up.id);
           Object.assign(up, await probe(file, url));
           log(up, 'enhanced photo', state.reviewer);
           await store.saveAsset(up);
           state.assets.push(up);
           await runAnalysis(up, { quiet: true });
         });
         state.assets = await store.listAssets(state.project.id);
         forgetDecodesOutside(state.assets.map(a => a.id));
         render();
         toast('Enhanced photo added to Library.');
       } catch (err) {
         const release = await releaseUsage(authorization.authorization.id, 'render_failed');
         toast(`Upscale failed: ${sentence(deliveryReason(err))} ${release.message}`, true);
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
    const bEl = pressed(el('button', { type: 'button' }, f.label), has(f.id));
    bEl.onclick = () => {
      mutate(asset, `${has(f.id) ? 'cleared fix' : 'marked fix'}: ${f.label}`, () => {
        if (has(f.id)) asset.fixes = asset.fixes.filter(x => x.id !== f.id);
        else asset.fixes.push({ id: f.id, label: f.label, consentRequired: !!f.consentRequired });
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
      `${count(asset.fixes.length, 'fix', 'fixes')} \u2014 saved with the asset and exported as a precise RETOUCH_LIST.md work order. Appearance changes remain previews until the pictured person approves them.`));
  }
  return wrap;
}

function renderReview() {
  const focus = captureFocus();
  renderReviewBody();
  restoreFocus(focus);
}

function renderReviewBody() {
  const main = $('#main');
  const assets = visibleAssets();

  // The start page carries no workspace chrome: Export, Jobs, Create, and
  // More only mean something once a photo exists.
  document.body.classList.toggle('start-page', !state.assets.length);
  if (!state.assets.length) {
    // The entry stamps which Studio was chosen; the start page honors it so
    // Video never greets you as Photo.
    let startProduct = 'photo';
    try { if (sessionStorage.getItem('mlx:start-product') === 'video') startProduct = 'video'; } catch { /* unavailable */ }
    if (startProduct === 'video') {
      main.replaceChildren(el('div', { className: 'empty photo-start-view' },
        el('span', { className: 'eyebrow' }, 'Video Studio'),
        el('h2', {}, 'Bring in a video'),
        el('p', {}, 'Import footage, then Studio checks the frames before you cut, refine, and deliver.'),
        el('div', { className: 'photo-start-actions' },
          btn('Import video', 'btn primary', () => {
            const input = $('#fileInput');
            const previous = input.accept;
            input.accept = 'video/*';
            input.addEventListener('cancel', () => { input.accept = previous; }, { once: true });
            input.addEventListener('change', () => { input.accept = previous; }, { once: true });
            input.click();
          }),
          btn('Switch to Photo', 'btn', () => {
            try { sessionStorage.setItem('mlx:start-product', 'photo'); } catch { /* unavailable */ }
            renderReview();
          })),
        photoWorkflowSteps(1)));
      return;
    }
    main.replaceChildren(el('div', { className: 'empty photo-start-view' },
      el('span', { className: 'eyebrow' }, 'Photo Studio'),
      el('h2', {}, 'Create or open a photo'),
      el('p', {}, 'Generate something new or bring in a photo, then Studio checks people before you edit.'),
      el('div', { className: 'photo-start-actions' },
        btn('Generate photo', 'btn primary', openPhotoCreationDialog),
        btn('Import photo or video', 'btn', () => $('#fileInput').click())),
      photoWorkflowSteps(1)));
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
  const surfaces = asset ? surfacesForAsset(asset) : activeSurfaces();
  if (!surfaces.find(s => s.id === state.activeSurface)) state.activeSurface = surfaces[0]?.id || null;
  const surface = SURFACE_BY_ID[state.activeSurface];

  const head = el('div', { className: 'stage-head' },
    btn('← Previous', 'btn sm', () => { state.index = (state.index - 1 + assets.length) % assets.length; renderReview(); }),
    btn('Next →', 'btn sm', () => { state.index = (state.index + 1) % assets.length; renderReview(); }),
    el('span', { className: 'idx' }, `${state.index + 1} / ${assets.length}`),
    el('span', { className: 'chip ' + asset.status }, STATUS_BY_ID[asset.status]?.label || asset.status),
    el('div', { className: 'spacer' }),
    (() => {
      const seg = el('div', { className: 'seg' });
      for (const [v, label] of [['source', 'Full source'], ['placement', 'Placement'], ['compare', 'Compare']]) {
        const b = pressed(el('button', {}, label), state.view === v);
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

  const rail = renderRail(asset);
  const railOpen = reviewRailIsOpen();
  rail.hidden = !railOpen;
  const railToggle = btn('Review tools', 'btn sm review-rail-toggle', () => setReviewRailOpen(true));
  railToggle.hidden = railOpen;
  railToggle.setAttribute('aria-controls', 'rail');
  railToggle.setAttribute('aria-expanded', String(railOpen));
  main.replaceChildren(el('div', { className: 'review' }, stageBody, railToggle, rail));
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
    const b = pressed(el('button', {}, label), p.fill === v);
    b.onclick = () => {
      mutate(asset, `${surface.label} fill → ${label}`, () => {
        p.fill = v;
        p.crop = v === 'crop' && asset.width && asset.height
          ? defaultCrop(asset.width, asset.height, surface)
          : { x: 0, y: 0, w: 1, h: 1 };
      });
      renderReview();
    };
    fills.append(b);
  }
  // Offered only where it can draw: below 900px the stylesheet hides `.loupe`
  // outright, so on a phone the toggle turned on something invisible and then
  // took the drag handlers with it.
  const loupeBtn = loupeIsAvailable() ? pressed(btn('Loupe', 'btn sm', () => {
    setLoupe(!state.loupe);
    renderReview();
  }), state.loupe) : null;
  const thirdsBtn = pressed(btn('Thirds', 'btn sm', () => { state.thirds = !state.thirds; renderReview(); }), state.thirds);
  const zoomOutBtn = btn('Zoom out', 'btn sm', () => { p.crop = zoomCrop(p.crop, 1 / 1.15); touchAsset(asset); paintStage(); renderIssuesOnly(); });
  const zoomInBtn = btn('Zoom in', 'btn sm', () => { p.crop = zoomCrop(p.crop, 1.15); touchAsset(asset); paintStage(); renderIssuesOnly(); });
  const resetBtn = btn('Reset view', 'btn sm', () => {
    p.crop = asset.width ? defaultCrop(asset.width, asset.height, surface) : { x: 0, y: 0, w: 1, h: 1 };
    touchAsset(asset); paintStage(); renderIssuesOnly();
  });
  const autoBtn = btn('Auto-reframe', 'btn sm', () => {
    if (!asset.auto?.energy) return toast('Run automated checks first.', true);
    mutate(asset, `auto-reframed ${surface.label}`, () => {
      p.crop = smartCrop(asset.auto.energy, asset.width, asset.height, surface, defaultCrop(asset.width, asset.height, surface), asset.geometry?.faces || []);
    });
    renderReview();
  });
  const viewMenu = el('details', { className: 'stage-tool-menu' },
    el('summary', { className: 'btn sm' }, 'View options'),
    el('div', { className: 'stage-tool-menu-body' }, fills, loupeBtn, thirdsBtn));

  tools.append(
    el('span', { className: 'note' }, `${surface.groupLabel} · ${surface.label}`),
    resetBtn, zoomOutBtn, zoomInBtn, autoBtn, viewMenu,
    el('div', { className: 'spacer' }),
    el('span', { className: 'note direct-help' }, 'Grab picture to move · trackpad scroll to zoom · arrows nudge · 0 resets'),
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

/**
 * Pre-flight, plus the refusal it could not see on its own.
 *
 * `buildPackage` stops on `colorExportDecision`, which asks a different
 * question from the colour issues `assetIssues` raises: an asset that was never
 * analysed has no profile at all, so pre-flight reported it as a note and the
 * export then refused it. A gate that green-lights an export the next step
 * refuses is worse than no gate.
 */
function preflightResult() {
  const result = preflight(state.project, state.assets);
  const alreadyBlocked = new Set(result.items.filter(i => i.level === 'block').map(i => i.assetId));
  const refusals = [];
  const seen = new Set();
  for (const { asset } of approvedPairs(state.assets)) {
    if (seen.has(asset.id) || alreadyBlocked.has(asset.id)) continue;
    seen.add(asset.id);
    const decision = colorExportDecision(asset.auto?.color || {});
    if (decision.allowed) continue;
    const block = Object.hasOwn(COLOR_EXPORT_BLOCKS, decision.reason) ? COLOR_EXPORT_BLOCKS[decision.reason] : null;
    refusals.push({
      level: 'block',
      code: `color-export-${String(decision.reason).replaceAll('_', '-')}`,
      message: block?.message || `This asset cannot be delivered as sRGB: ${readableServiceError(decision.reason)}.`,
      fix: block?.fix || 'Convert it and re-import.',
      asset: asset.filename,
      assetId: asset.id
    });
  }
  // Blocking reads first, the way preflight() already orders its own items.
  return {
    items: [...refusals, ...result.items],
    blocks: result.blocks + refusals.length,
    warns: result.warns,
    refusals
  };
}

function preflightDialog(onProceed) {
  const result = preflightResult();
  const body = el('div', {});
  body.append(el('p', { className: 'hint' },
    result.blocks
      ? `${count(result.blocks, 'blocking issue')} and ${count(result.warns, 'warning')}. Blocking issues are the ones that get an ad rejected or a client angry.`
      : `No blocking issues. ${count(result.warns, 'warning')} to look at.`));
  if (result.refusals.length) {
    body.append(el('p', { className: 'hint' },
      `${count(result.refusals.length, 'asset')} cannot be delivered until the colour is accepted. This is the one thing "Export anyway" cannot get past — the export itself refuses it.`));
  }
  body.append(issueList(result.items.slice(0, 60), 'Everything checks out.'));
  if (result.items.length > 60) body.append(el('p', { className: 'hint' }, `…and ${result.items.length - 60} more, all listed in the package.`));

  const override = el('input', { type: 'checkbox' });
  const proceed = btn(result.blocks ? 'Export anyway' : 'Export package', 'btn primary', () => { closeDialog(); onProceed(); });
  proceed.disabled = result.blocks > 0;
  override.onchange = () => { proceed.disabled = result.refusals.length > 0 || (result.blocks > 0 && !override.checked); };

  dialog('Pre-flight', body, [
    result.blocks ? el('label', { className: 'toggle' }, override, 'I accept the blocking issues') : null,
    el('div', { className: 'spacer' }),
    btn('Cancel', 'btn', closeDialog),
    proceed
  ]);
}

async function openPrintDelivery() {
  const asset = currentAsset();
  if (!asset || asset.kind !== 'image') return toast('Select a photo first.', true);
  const decoded = await decode(asset);
  if (!decoded) return toast('That photo could not be prepared.', true);
  if (!asset.auto?.color) await runAnalysis(asset, { quiet: true });

  const preset = el('select', {});
  for (const option of PRINT_PRESETS) preset.append(el('option', {
    value: option.id, selected: option.id === '8x10'
  }, option.label));
  const orientation = el('select', {},
    el('option', { value: 'portrait' }, 'Portrait'),
    el('option', { value: 'landscape' }, 'Landscape'));
  const fit = el('select', {},
    el('option', { value: 'crop' }, 'Fill · centered crop'),
    el('option', { value: 'contain' }, 'Fit · white border'));
  const bleed = el('input', { type: 'checkbox' });
  const summary = el('div', { className: 'block', ariaLive: 'polite' });
  const status = el('p', { className: 'hint', role: 'status', ariaLive: 'polite' });
  const download = btn('Download print JPEG', 'btn primary');
  let currentPlan = null;

  const update = () => {
    currentPlan = planPrint({
      presetId: preset.value, orientation: orientation.value, fit: fit.value,
      bleed: bleed.checked, sourceWidth: decoded.w, sourceHeight: decoded.h, ppi: PRINT_PPI
    });
    const color = printColorDecision(asset.auto?.color || {});
    const qualityText = currentPlan.quality === 'ready'
      ? 'Ready at 300 PPI.'
      : currentPlan.quality === 'review'
        ? `Review recommended at ${currentPlan.effectivePpi} effective PPI.`
        : `Source is too small at ${currentPlan.effectivePpi} effective PPI.`;
    // `el()` drops a null child; replaceChildren stringifies one, and the word
    // "null" was rendering in the dialog on every allowed photo.
    summary.replaceChildren(...[
      el('p', {}, `${currentPlan.pixelWidth} × ${currentPlan.pixelHeight} px · ${currentPlan.ppi} PPI · sRGB JPEG`),
      el('p', { className: 'hint', style: 'margin-top:6px' },
        `${qualityText}${currentPlan.bleedInches ? ' Includes 0.125 in bleed.' : ''}`),
      !color.allowed ? el('p', { style: 'color:var(--bad);margin-top:6px' },
        'This photo needs an accepted sRGB conversion before print delivery.') : null
    ].filter(Boolean));
    download.disabled = !currentPlan.canExport || !color.allowed;
    // Name the blocker that actually applies; the summary above already says
    // which one it is, and two different explanations read as a fault.
    status.textContent = !color.allowed
      ? 'Prepare an accepted sRGB conversion before this photo can be printed.'
      : !currentPlan.canExport
        ? 'This photo does not have the detail for that print size. Choose a smaller size.'
        : '';
  };

  for (const control of [preset, orientation, fit, bleed]) control.onchange = update;
  download.onclick = async () => {
    const lic = await activeLicense();
    if (!covers(lic, 'photo')) {
      return dialog('A Photo license is required to download',
        el('p', {}, 'Activate Photo Single Studio or Full Studio in Deliver, then reconnect for usage confirmation.'),
        [btn('Close', 'btn primary', closeDialog)]);
    }
    download.disabled = true;
    status.style.color = '';
    status.textContent = 'Preparing your print…';
    let authorizationId = null;
    try {
      const canvas = await busy(() => renderPrint(decoded.source, decoded.w, decoded.h,
        currentPlan, ensureEditState(asset).adjustments));
      const bytes = encodePrintJpeg(canvas, currentPlan.ppi);
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      const evidenceHash = await blobEvidenceHash(blob);
      const authorization = await authorizeOutbound({
        product: 'photo', artifactKind: 'clean_export', quantity: 1, operationId: evidenceHash
      });
      if (!authorization.ok) throw new Error(authorization.reason || 'authorization_required');
      authorizationId = authorization.authorization.id;
      const stem = slug(String(asset.filename || 'photo').replace(/\.[^.]+$/, ''));
      const suffix = `${currentPlan.presetId}-${currentPlan.orientation}-${currentPlan.ppi}ppi`;
      await settleOutboundBeforeDelivery(authorizationId, evidenceHash,
        () => downloadBlob(blob, `${stem}-${suffix}.jpg`));
      recordExport(1);
      status.textContent = `Downloaded ${currentPlan.pixelWidth} × ${currentPlan.pixelHeight} px at ${currentPlan.ppi} PPI.`;
    } catch (error) {
      const release = authorizationId ? await releaseUsage(authorizationId, 'print_export_failed') : null;
      status.textContent = `Print was not downloaded: ${sentence(deliveryReason(error))}${release ? ` ${release.message}` : ''}`;
      status.style.color = 'var(--bad)';
    } finally {
      download.disabled = !currentPlan?.canExport || !printColorDecision(asset.auto?.color || {}).allowed;
    }
  };

  const body = el('div', {},
    el('p', { className: 'hint' }, 'Choose the finished size; MaterialLogix preserves the photo proportions.'),
    el('label', { className: 'field' }, el('span', {}, 'Print size'), preset),
    el('label', { className: 'field' }, el('span', {}, 'Orientation'), orientation),
    el('label', { className: 'field' }, el('span', {}, 'Framing'), fit),
    el('label', { className: 'toggle' }, bleed, 'Add 0.125 in bleed'),
    summary, status);
  update();
  dialog('Print-ready photo', body, [btn('Cancel', 'btn', closeDialog), download]);
}

/**
 * The download paywall. Every path that puts a file in the customer's hands
 * asks the same question, so they ask it here and get one answer: the client
 * review page and the contact sheet used to ask nobody, and a Voice Starter
 * downloaded both.
 */
async function licensedToDeliver(product) {
  if (covers(await activeLicense(), product)) return true;
  // Name every plan that covers this Studio, and the single export that does
  // not need a plan at all, rather than a fixed two.
  const singleExport = exportForProduct(product);
  const quote = singleExport ? exportPrice(singleExport.id) : null;
  dialog('A matching license is required to download',
    el('div', {},
      el('p', {}, 'Free preview lets you edit, compare, and review inside MaterialLogix. It does not create downloadable files.'),
      el('p', { className: 'hint', style: 'margin-top:10px' },
        `Activate ${plansCovering(product).join(', ')} in Deliver, then reconnect for usage confirmation.`),
      quote ? el('p', { className: 'hint', style: 'margin-top:6px' },
        `Or buy this one on its own: ${quote.label.toLowerCase()} costs $${quote.total.toFixed(2)}, no plan.`) : null),
    [btn('Close', 'btn', closeDialog),
     btn('See plans and single exports', 'btn primary', () => { closeDialog(); location.assign(pricingUrl()); })]);
  return false;
}

async function doExport(exportOpts = {}) {
  if (!state.project) return;
  if (!approvedPairs(state.assets).length) return toast('Nothing approved yet \u2014 approve at least one placement.', true);
  const product = state.assets.some(asset => asset.kind === 'video') ? 'video' : 'photo';
  if (!await licensedToDeliver(product)) return;
  preflightDialog(async () => {
    const pairs = approvedPairs(state.assets);
    let authorizationId = null;
    const bar = el('i');
    const status = el('p', {}, `Rendering ${count(pairs.length, 'placement')}…`);
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
      const evidenceHash = await blobEvidenceHash(blob);
      // Bill what the zip carries: one rendered still per approved placement. A
      // video placement gets a poster frame and the customer's own file back
      // unmodified, never a cut, so four units a source minute took 240 — a
      // quarter of a Full Studio month — for one ten-minute upload approved on
      // six surfaces.
      const deliveries = pairs.map(() => ({ kind: 'photo' }));
      // A proof spends nothing. It is stamped across the frame and capped at
      // 960px, which every plan card sells as free, so it reserves and settles
      // at zero; the local ledger below already skipped it.
      const authorization = await authorizeOutbound({
        product,
        artifactKind: exportOpts.proof ? 'proof_export' : 'clean_export',
        quantity: exportOpts.proof ? 0 : unitsForDeliveries(deliveries),
        operationId: evidenceHash
      });
      if (!authorization.ok) throw new Error(authorization.reason || 'authorization_required');
      authorizationId = authorization.authorization.id;
      await settleOutboundBeforeDelivery(authorizationId, evidenceHash, () => downloadBlob(blob, filename));
      if (!exportOpts.proof) recordExport(pairs.length);
      status.textContent = `Done — ${count(stats.placements, 'placement')}, ${count(stats.files, 'file')}, ${(blob.size / 1048576).toFixed(1)} MB.`;
      if (stats.failures.length) {
        status.after(el('p', { style: 'color:var(--warn)' }, `${count(stats.failures.length, 'render')} failed. See EXPORT_WARNINGS.txt inside the zip.`));
      }
    } catch (err) {
      const release = authorizationId ? await releaseUsage(authorizationId, 'export_failed') : null;
      status.textContent = `Export was not downloaded: ${sentence(deliveryReason(err))}${release ? ` ${release.message}` : ''}`;
      status.style.color = 'var(--bad)';
    }
  });
}

function preflightMarkdown() {
  const r = preflightResult();
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
  if (!await licensedToDeliver('photo')) return;
  const bar = el('i');
  const status = el('p', {}, 'Building…');
  dialog('Client review page', el('div', {}, status, el('div', { className: 'progress' }, bar),
    el('p', { className: 'hint' }, 'One HTML file with the images embedded. Email it. The client approves in their own browser and sends back a small JSON file you import here. No hosting, no accounts.')),
    [btn('Close', 'btn', closeDialog)]);
  let authorization = null;
  try {
    const html = await busy(() => buildClientPage(state.project, state.assets, (n, total, name) => {
      status.textContent = `Embedding ${n} / ${total} — ${name}`;
      bar.style.width = `${(n / total) * 100}%`;
    }));
    const blob = new Blob([html], { type: 'text/html' });
    const evidenceHash = await blobEvidenceHash(blob);
    authorization = await authorizeOutbound({ product: 'photo', artifactKind: 'client_review', quantity: pairs.length, operationId: evidenceHash });
    if (!authorization.ok) throw new Error(authorization.reason || 'online_authorization_required');
    await settleOutboundBeforeDelivery(authorization.authorization.id, evidenceHash,
      () => downloadBlob(blob, `${slug(state.project.name)}-client-review.html`));
    status.textContent = `Done — ${(blob.size / 1048576).toFixed(1)} MB, ${count(pairs.length, 'placement')}.`;
  } catch (err) {
    const release = authorization?.ok ? await releaseUsage(authorization.authorization.id, 'export_failed') : null;
    status.textContent = `Not downloaded: ${sentence(deliveryReason(err))}${release ? ` ${release.message}` : ''}`;
    status.style.color = 'var(--bad)';
  }
}

async function importVerdict(file) {
  try {
    const json = JSON.parse(await file.text());
    const { applied, missing, changed } = applyClientVerdict(json, state.assets);
    for (const a of changed) { log(a, `client decisions imported`, 'client'); await store.saveAsset(a); }
    render();
    toast(`Applied ${count(applied, 'client decision')}${missing ? `, ${missing} skipped (asset not in this project)` : ''}.`);
  } catch (err) {
    toast(`Could not read that file: ${sentence(deliveryReason(err))}`, true);
  }
}

async function exportContactSheet() {
  const pairs = approvedPairs(state.assets);
  if (!pairs.length) return toast('Nothing approved yet.', true);
  if (!await licensedToDeliver('photo')) return;
  const colorBlock = pairs.map(pair => ({ asset: pair.asset, decision: colorExportDecision(pair.asset.auto?.color || {}) }))
    .find(entry => !entry.decision.allowed);
  if (colorBlock) return toast(`${colorBlock.asset.filename} needs an accepted color conversion before export.`, true);
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
    const shot = renderCrop(d.source, d.w, d.h, placement.crop, thumbSurface, placement.fill, null, ensureEditState(asset).adjustments);
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
  canvas.toBlob(async b => {
    if (!b) return toast('Contact sheet rendering failed before authorization.', true);
    const evidenceHash = await blobEvidenceHash(b);
    const authorization = await authorizeOutbound({ product: 'photo', artifactKind: 'contact_sheet', quantity: pairs.length, operationId: evidenceHash });
    if (!authorization.ok) return toast(`Online export authorization failed: ${sentence(deliveryReason(authorization.reason || 'authorization_required'))}`, true);
    try {
      await settleOutboundBeforeDelivery(authorization.authorization.id, evidenceHash,
        () => downloadBlob(b, `${slug(state.project.name)}-contact-sheet.png`));
      toast('Contact sheet saved.');
    } catch (error) {
      const release = await releaseUsage(authorization.authorization.id, 'export_failed');
      toast(`Contact sheet was not downloaded: ${sentence(deliveryReason(error))} ${release.message}`, true);
    }
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
  const focus = captureFocus();
  renderSidebar();
  renderCounters();
  document.querySelectorAll('#modeSeg button').forEach(b => pressed(b, b.dataset.mode === state.mode));
  if (state.mode === 'board') renderBoard(); else renderReview();
  restoreFocus(focus);
}

/** Editing works best on the dark surface: the workspace defaults to dark
 * until the person picks a theme themselves, which then always wins. */
function applyWorkspaceTheme() {
  try {
    if (localStorage.getItem('cros:themePinned')) return;
    document.documentElement.dataset.theme = 'dark';
    localStorage.setItem('cros:theme', 'dark');
  } catch { /* storage unavailable */ }
}

async function boot(selectId) {
  clearUndo();
  if (location.hash === '#workspace') applyWorkspaceTheme();
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
  forgetDecodesOutside(state.assets.map(a => a.id));
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
    const creation = dialog('New project', el('label', { className: 'field' }, el('span', {}, 'Project name'), input), [
      btn('Cancel', 'btn', closeDialog),
      btn('Create', 'btn primary', async () => {
        const p = newProject(input.value.trim() || 'Untitled project');
        await store.saveProject(p);
        creation.close(); boot(p.id);
      })
    ]);
  };
  document.querySelectorAll('#modeSeg button').forEach(b => {
    b.onclick = () => {
      state.mode = b.dataset.mode;
      document.querySelector('.topbar-more')?.removeAttribute('open');
      render();
    };
  });
  const settingsButton = $('#menuBtn');
  const settingsPanel = $('#sidebar');
  settingsButton.textContent = 'Create';
  settingsButton.setAttribute('aria-label', 'Create or open');
  settingsPanel.classList.remove('open');
  settingsPanel.classList.add('closed');
  settingsButton.setAttribute('aria-expanded', 'false');
  settingsButton.onclick = e => {
    e.stopPropagation();
    const open = settingsPanel.classList.contains('closed');
    settingsPanel.classList.toggle('closed', !open);
    settingsPanel.classList.toggle('open', open);
    settingsButton.setAttribute('aria-expanded', String(open));
  };
  $('#main').addEventListener('pointerdown', () => {
    settingsPanel.classList.remove('open');
    settingsPanel.classList.add('closed');
    settingsButton.setAttribute('aria-expanded', 'false');
  });

  $('#themeBtn').onclick = () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('cros:theme', next);
    localStorage.setItem('cros:themePinned', '1');
  };

  $('#exportBtn').onclick = () => doExport();
  $('#exportMoreBtn').onclick = () => { document.querySelector('.topbar-more')?.removeAttribute('open'); doExport(); };
  $('#helpBtn').onclick = showHelp;
  // Escape dismisses the dialog on screen, not the element every dialog shares:
  // if it was covering another the element stays open and repaints with the one
  // underneath, so the stack decides what closes rather than the browser.
  $('#dlg').addEventListener('cancel', event => { event.preventDefault(); dismissDialog(dialogStack.at(-1)); });
  // Anything that closes the element itself — a stray close() from outside, or
  // Escape where the browser will not let the cancel be prevented — takes every
  // dialog that was on it, and each of them still has to stop what it started.
  $('#dlg').addEventListener('close', () => {
    if (stackClosings > 0) { stackClosings -= 1; return; }
    for (const entry of dialogStack.splice(0, dialogStack.length)) entry.onDismiss?.();
  });
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
    if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files, 'drop');
  });

  window.addEventListener('keydown', e => {
    // A modal owns every key while it is open, Escape first of all. This guard
    // used to sit below the sidebar branch, so Escape collapsed the panel
    // behind the dialog and called preventDefault() on the dialog's own cancel
    // — the dismiss gesture silently failed on the most-used path.
    if ($('#dlg').open) return;
    if (e.key === 'Escape' && !settingsPanel.classList.contains('closed')) {
      settingsPanel.classList.remove('open');
      settingsPanel.classList.add('closed');
      settingsButton.setAttribute('aria-expanded', 'false');
      settingsButton.focus();
      e.preventDefault();
      return;
    }
    if (e.target.matches('input, textarea, select')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); return undo(); }
    const asset = currentAsset();
    const assets = visibleAssets();
    const surfaces = asset ? surfacesForAsset(asset) : activeSurfaces();

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
      case 'l':
        if (!loupeIsAvailable()) { toast('The loupe needs a wider window — it puts 1:1 source pixels under the pointer.'); break; }
        setLoupe(!state.loupe); renderReview(); break;
      case 't': state.thirds = !state.thirds; renderReview(); break;
      case 'g': if (asset) reframeAll(asset); break;
      case 'b': state.mode = state.mode === 'board' ? 'review' : 'board'; render(); break;
      case '?': case '/': showHelp(); break;
      default: return;
    }
    e.preventDefault();
  });

  window.addEventListener('beforeunload', e => {
    flushPendingSaves();
    if (state.busy) { e.preventDefault(); e.returnValue = ''; }
  });
}

// Automation hook for the smoke suite. Off unless ?dev is in the URL, so it
// never exists in a normal session.
if (['localhost', '127.0.0.1', '::1'].includes(location.hostname) && new URLSearchParams(location.search).has('dev')) {
  window.__cros = {
    state, render, importFiles, runAnalysis, reframeAll, decidePlacement,
    preflight: () => preflightResult(),
    issueCount, visibleAssets, ensurePlacement, generativeFillDialog, backupProject
  };
}

wire();
// Stand the live region up before anything can need it, so even the first
// message lands in a region that was already in the accessibility tree.
announcer();
boot().catch(error => {
  console.error(error);
  const viewport = $('#viewport') || document.body;
  viewport.replaceChildren(el('div', { className: 'empty' },
    el('h2', {}, 'Studio could not start'),
    el('p', {}, 'The local project store could not be opened. Close other Studio tabs, leave private browsing, or free some disk space, then reload.')));
});
