// Tier-1 generation: ComfyUI running on the user's own GPU.
//
// ComfyUI is free, open source, and serves a small HTTP API on localhost.
// Nothing here touches a paid service or leaves the machine. Tier 2 (bring
// your own provider key) and tier 3 (managed, billed) are Phase 2.

// Direct ComfyUI media traffic is loopback-only. Phone-over-Wi-Fi uses the
// Material Logic bridge, which requires the access token shown by engine.py.
const isLoopbackHost = h => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
// A private address must be a literal dotted quad: a DNS name that merely
// starts with a private prefix (10.attacker.example) must never pass.
const isPrivateIpv4 = h => /^\d{1,3}(\.\d{1,3}){3}$/.test(h)
  && h.split('.').every(octet => Number(octet) <= 255)
  && /^(127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
const BRIDGE_HOST = (typeof location !== 'undefined' && isPrivateIpv4(location.hostname)) ? location.hostname : '127.0.0.1';
const DEFAULT_BASE = 'http://127.0.0.1:8188';

export const NATURAL_PHOTO_GUIDANCE = [
  'photographic naturalism',
  'believable skin texture and tonal variation when people are present',
  'physically plausible anatomy, posture, gaze, and expression',
  'realistic fabric weave, seams, weight, drape, and material response',
  'coherent environmental lighting, contact shadows, and reflections'
].join(', ');

export const HUMAN_SCENE_GUIDANCE = [
  'natural task-focused body language rather than mannequin posing',
  'independent believable gaze and attention between people',
  'complete anatomically credible hands or hands naturally outside the frame',
  'relaxed facial muscles and a natural closed mouth unless another expression is requested',
  'candid environmental composition unless a posed or centered portrait is requested'
].join(', ');

export const NATURAL_PHOTO_AVOID = [
  'waxy or plastic skin',
  'airbrushed skin without pores',
  'synthetic fabric texture',
  'melted seams or repeated textile patterns',
  'broken fingers or anatomy',
  'rigid mannequin posture',
  'forced group attention',
  'inconsistent lighting or reflections',
  'halos or generative artifacts',
  'garbled text, invented logos, or spurious watermarks',
  'cloned or duplicated faces',
  'cut-out subject edges or plastic-looking bokeh'
].join(', ');

const HUMAN_TERMS = /\b(person|people|human|humans|woman|women|man|men|girl|girls|boy|boys|child|children|kid|kids|baby|babies|toddler|teen|teenager|teenagers|adult|adults|elderly|senior|seniors|gentleman|lady|guy|guys|folks|someone|somebody|he|she|him|her|his|model|models|creator|artist|artists|designer|designers|team|colleague|colleagues|coworker|staff|crew|worker|workers|friends?|family|couple|pair|group|crowd|audience|face|faces|portrait|selfie|hands?|body|bodies|figure|silhouette|chef|barista|bartender|waiter|waitress|nurse|doctor|dancer|athlete|runner|cyclist|skater|musician|singer|student|teacher|customer|client|guest|shopper|passenger|player|stylist|photographer|engineer|farmer|builder|mechanic)\b/i;
const DIRECTIVES = {
  camera: /\b(look(?:ing)? (?:at|into) (?:the )?camera|eye contact|direct gaze|camera-facing)\b/i,
  composition: /\b(centered|symmetrical|rule of thirds)\b/i,
  framing: /\b(close[- ]?up|wide shot|full[- ]body|headshot|overhead|top[- ]down|low angle|high angle|macro|crop(?:ped)?)\b/i,
  optics: /\b(\d{2,3}\s?mm|wide[- ]angle|telephoto|bokeh|depth of field|f\/\d|shallow focus|deep focus|fisheye|tilt[- ]shift)\b/i,
  medium: /\b(grain|grainy|film|analog|35mm|polaroid|clean|pristine|no grain)\b/i,
  pose: /\b(posed|formal portrait|studio portrait|headshot|fashion pose)\b/i,
  expression: /\b(smile|smiling|laugh|laughing|open mouth|speaking|talking|shouting|singing|serious|neutral expression|frown|frowning|crying|angry|surprised)\b/i,
  handsHidden: /\b(hands? (?:hidden|concealed|outside|out of) (?:the )?frame|no hands?|hands? not visible)\b/i
};

// Optical and medium character. Absence of these is a strong synthetic tell.
export const CAMERA_GUIDANCE = 'natural lens perspective with believable depth of field and focus falloff';
export const MEDIUM_GUIDANCE = 'subtle sensor grain and natural highlight roll-off rather than a perfectly clean digital render';

const avoidRules = [
  [/\b(waxy|plastic) skin\b/i, 'waxy or plastic skin'],
  [/\bairbrushed skin\b/i, 'airbrushed skin without pores'],
  [/\bsynthetic fabric\b/i, 'synthetic fabric texture'],
  [/\b(melted seams?|repeated textile patterns?)\b/i, 'melted seams or repeated textile patterns'],
  [/\b(broken fingers?|broken anatomy|extra fingers?|missing fingers?)\b/i, 'broken fingers or anatomy'],
  [/\b(rigid|mannequin) posture\b/i, 'rigid mannequin posture'],
  [/\bforced group attention\b/i, 'forced group attention'],
  [/\b(inconsistent lighting|inconsistent reflections?)\b/i, 'inconsistent lighting or reflections'],
  [/\b(halos?|generative artifacts?)\b/i, 'halos or generative artifacts'],
  [/\b(text|lettering|logos?|watermarks?|signage?)\b/i, 'garbled text, invented logos, or spurious watermarks'],
  [/\b(clones?|duplicate faces?|twins?|identical)\b/i, 'cloned or duplicated faces'],
  [/\b(bokeh|cut[- ]?out)\b/i, 'cut-out subject edges or plastic-looking bokeh']
];

/**
 * Compile customer direction without replacing it. Explicit creative choices
 * win; Material Logic adds only the photographic details the customer did not
 * specify. The returned rules are safe provenance, not provider instructions.
 */
export function compilePhotoPrompt(prompt, negative = '', styleIntent = 'natural') {
  const requested = String(prompt || '').trim();
  const avoided = String(negative || '').trim();
  if (!requested) throw new Error('Prompt is empty.');
  if (!['natural', 'stylized', 'film'].includes(styleIntent)) throw new Error('Unknown Photo style intent.');
  if (styleIntent === 'stylized') return {
    prompt: requested,
    negative: avoided,
    styleIntent,
    appliedRules: [],
    explicitOverrides: ['stylized']
  };

  const humanScene = HUMAN_TERMS.test(requested);
  const explicitOverrides = Object.entries(DIRECTIVES)
    .filter(([, expression]) => expression.test(requested))
    .map(([name]) => name);
  const additions = [NATURAL_PHOTO_GUIDANCE];
  const appliedRules = ['photographic-integrity'];
  if (!explicitOverrides.includes('optics')) { additions.push(CAMERA_GUIDANCE); appliedRules.push('optical-plausibility'); }
  if (styleIntent === 'film' && !explicitOverrides.includes('medium')) { additions.push(MEDIUM_GUIDANCE); appliedRules.push('capture-medium'); }
  if (humanScene) {
    const humanRules = [];
    if (!explicitOverrides.includes('composition') && !explicitOverrides.includes('pose') && !explicitOverrides.includes('framing')) humanRules.push('candid environmental composition');
    if (!explicitOverrides.includes('camera')) humanRules.push('independent believable gaze and attention between people');
    if (!explicitOverrides.includes('pose')) humanRules.push('natural task-focused body language rather than mannequin posing');
    if (!explicitOverrides.includes('handsHidden')) humanRules.push('complete anatomically credible hands or hands naturally outside the frame');
    if (!explicitOverrides.includes('expression')) humanRules.push('relaxed facial muscles and a natural closed mouth');
    additions.push(humanRules.join(', '));
    appliedRules.push('human-scene-integrity');
  }

  const protectedAvoid = avoidRules
    .filter(([explicitChoice]) => !explicitChoice.test(requested))
    .map(([, phrase]) => phrase)
    .join(', ');
  return {
    prompt: [requested, ...additions.filter(Boolean)].join(', '),
    negative: [avoided, protectedAvoid].filter(Boolean).join(', '),
    styleIntent,
    appliedRules,
    explicitOverrides
  };
}

/** Natural photographic behavior is the default; only an explicit stylized choice bypasses it. */
export function applyPhotoStyleDefaults(prompt, negative = '', styleIntent = 'natural') {
  const compiled = compilePhotoPrompt(prompt, negative, styleIntent);
  return { prompt: compiled.prompt, negative: compiled.negative, styleIntent: compiled.styleIntent };
}

export function assertLocalEngineUrl(value, { allowPrivateLan = false } = {}) {
  let url;
  try { url = new URL(String(value)); } catch { throw new Error('Invalid local engine address.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsafe local engine address.');
  if (!isLoopbackHost(url.hostname) && !(allowPrivateLan && isPrivateIpv4(url.hostname))) {
    throw new Error('The engine address must stay on this computer or an approved private-network bridge.');
  }
  return url;
}

const localBase = base => assertLocalEngineUrl(base).href.replace(/\/$/, '');

/** Fetch with the bridge token when set; prompts once if the bridge asks. */
export async function bridgeFetch(url, opts = {}) {
  const safeUrl = assertLocalEngineUrl(url, { allowPrivateLan: true }).href;
  const withPin = pin => fetch(safeUrl, {
    ...opts,
    headers: { ...(opts.headers || {}), ...(pin ? { 'X-Bridge-Pin': pin } : {}) }
  });
  let res = await withPin(localStorage.getItem('cros:bridgePin') || '');
  if (res.status === 403) {
    const j = await res.clone().json().catch(() => ({}));
    if (j.pinRequired) {
      const pin = prompt('Enter the Wi-Fi access token shown in the bridge console (or scan the code):');
      if (pin) {
        localStorage.setItem('cros:bridgePin', pin.trim());
        res = await withPin(pin.trim());
      }
    }
  }
  return res;
}

async function getJson(base, path, timeout = 2500) {
  const res = await fetch(localBase(base) + path, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

/** Is a local engine running, and on what hardware? */
export async function detectComfy(base = DEFAULT_BASE) {
  try {
    const stats = await getJson(base, '/system_stats');
    const dev = stats.devices?.[0];
    const type = String(dev?.type || '').toLowerCase();
    const cpuOnly = type === 'cpu';
    return {
      ok: true,
      base,
      cpuOnly,
      deviceType: type || null,
      device: dev?.name || (cpuOnly ? 'Processor' : 'GPU'),
      vramGB: dev?.vram_total ? +(dev.vram_total / 1073741824).toFixed(1) : null
    };
  } catch {
    return { ok: false, base };
  }
}

// Speed lanes for a machine with no graphics card. Same engine, same models,
// fewer steps and a smaller canvas, then enlarge.
// Best quality is the same picture a graphics card would make, only slower.
// Faster is smaller, and every label says so.
export const CPU_PRESETS = Object.freeze({
  draft: { label: 'Faster', steps: 12, maxSide: 768 },
  full: { label: 'Best quality', steps: 22, maxSide: null }
});

/** Fit a requested size into a preset without breaking the 64px grid. */
export function cpuJobSettings(preset, width, height) {
  const p = CPU_PRESETS[preset] || CPU_PRESETS.draft;
  if (!p.maxSide) return { width, height, steps: p.steps };
  const longest = Math.max(width, height);
  const scale = longest > p.maxSide ? p.maxSide / longest : 1;
  const fit = v => Math.max(512, Math.round(v * scale / 64) * 64);
  return { width: fit(width), height: fit(height), steps: p.steps };
}

const PACE_KEY = 'cros:cpuSecondsPerStepPixel';

/** Remember how fast this machine actually was. */
export function recordCpuPace(seconds, steps, width, height) {
  const work = steps * width * height;
  if (!(seconds > 0) || !(work > 0)) return;
  try { localStorage.setItem(PACE_KEY, String(seconds / work)); } catch { /* private mode */ }
}

/**
 * How long one job should take without a graphics card. Measured once, then
 * reused. Before the first run it is a range, not a promise.
 */
export function estimateCpuSeconds(steps, width, height, cores = 4) {
  const work = steps * width * height;
  let rate = 0;
  try { rate = Number(localStorage.getItem(PACE_KEY)) || 0; } catch { /* private mode */ }
  if (rate > 0) return { seconds: Math.round(work * rate), measured: true };
  // Starting point only: a 1024 square at 22 steps runs roughly ten seconds a
  // step on eight cores. Replaced by the real number after the first render.
  const perCore = 7.6e-5;
  return { seconds: Math.round(work * perCore / Math.max(2, cores)), measured: false };
}

/** Plain wording for a wait, never a bare number of seconds. */
export function waitLabel(seconds) {
  if (seconds < 90) return 'about a minute';
  const minutes = Math.round(seconds / 60);
  if (minutes < 10) return `about ${minutes} minutes`;
  return `${Math.round(minutes / 5) * 5} minutes or so`;
}

/** Models the local install actually has. The app never assumes a filename. */
export async function listCheckpoints(base = DEFAULT_BASE) {
  const info = await getJson(base, '/object_info/CheckpointLoaderSimple');
  return info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
}

/**
 * Validate the standard ComfyUI nodes and typed sockets required by the
 * Material Logic separate-source/separate-mask inpainting graph.
 */
export function validateInpaintObjectInfo(info = {}) {
  const missing = [];
  const requireNode = name => {
    const node = info?.[name];
    if (!node) missing.push(name);
    return node;
  };
  const checkpoint = requireNode('CheckpointLoaderSimple');
  const load = requireNode('LoadImage');
  const encode = requireNode('VAEEncodeForInpaint');
  requireNode('CLIPTextEncode'); requireNode('KSampler');
  requireNode('VAEDecode'); requireNode('SaveImage');
  const loadOutputs = Array.isArray(load?.output) ? load.output : [];
  if (load && (!loadOutputs.includes('IMAGE') || !loadOutputs.includes('MASK'))) missing.push('LoadImage:IMAGE+MASK');
  const required = encode?.input?.required || {};
  for (const [socket, type] of [['pixels', 'IMAGE'], ['vae', 'VAE'], ['mask', 'MASK'], ['grow_mask_by', 'INT']]) {
    if (encode && required?.[socket]?.[0] !== type) missing.push(`VAEEncodeForInpaint:${socket}:${type}`);
  }
  const checkpoints = checkpoint?.input?.required?.ckpt_name?.[0];
  const models = Array.isArray(checkpoints) ? checkpoints.filter(value => typeof value === 'string') : [];
  const inpaintModels = models.filter(name => /inpaint/i.test(name));
  return {
    compatibleNodes: missing.length === 0,
    compatibleModel: inpaintModels.length > 0,
    executable: missing.length === 0 && inpaintModels.length > 0,
    missing, models, inpaintModels
  };
}

/** Inspect one local engine without assuming a checkpoint filename. */
export async function inspectInpaintCompatibility(base = DEFAULT_BASE) {
  const info = await getJson(base, '/object_info', 10000);
  return { base, ...validateInpaintObjectInfo(info) };
}

/**
 * A minimal, standard txt2img graph. Pure function so the suite can verify
 * that prompts, sizes, and wiring land where they should without a GPU.
 */
export function buildTxt2Img({ ckpt, prompt, negative = '', styleIntent = 'natural', width = 1024, height = 1024, steps = 22, cfg = 6.5, seed }) {
  if (!ckpt) throw new Error('No checkpoint model selected.');
  if (String(prompt || '').length > 1000 || String(negative || '').length > 1000) throw new Error('Prompt text is too long.');
  const styled = applyPhotoStyleDefaults(prompt, negative, styleIntent);
  const s = seed ?? Math.floor(Math.random() * 2 ** 32);
  return {
    seed: s,
    styleIntent: styled.styleIntent,
    graph: {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: styled.prompt, clip: ['1', 1] } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: styled.negative, clip: ['1', 1] } },
      '4': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
      '5': {
        class_type: 'KSampler',
        inputs: {
          model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0],
          seed: s, steps, cfg, sampler_name: 'euler', scheduler: 'normal', denoise: 1
        }
      },
      '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
      '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'cros' } }
    }
  };
}

/**
 * Normalize a rectangular selection expressed as percentages of the source.
 * Keeping this pure makes the exact pixels sent to the local engine testable.
 */
export function normalizeInpaintSelection(selection = {}) {
  const read = (key, fallback) => {
    const value = Number(selection[key] ?? fallback);
    if (!Number.isFinite(value)) throw new Error(`Selection ${key} must be a number.`);
    return value;
  };
  const x = Math.max(0, Math.min(99, read('x', 25)));
  const y = Math.max(0, Math.min(99, read('y', 25)));
  const width = Math.max(1, Math.min(100 - x, read('width', 50)));
  const height = Math.max(1, Math.min(100 - y, read('height', 50)));
  return { x, y, width, height };
}

/** Normalize a freehand path to source-relative coordinates without retaining pointer metadata. */
export function normalizeInpaintPath(points = [], limit = 2048) {
  if (!Array.isArray(points)) throw new Error('Selection path must be an array.');
  const clean = [];
  for (const point of points.slice(0, Math.max(3, Number(limit) || 2048))) {
    const x = Number(point?.x), y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const normalized = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    const prior = clean[clean.length - 1];
    if (!prior || Math.hypot(normalized.x - prior.x, normalized.y - prior.y) >= 0.001) clean.push(normalized);
  }
  return clean;
}

/** Privacy-safe bounds for lasso/brush selections; raw points never enter the job record. */
export function summarizeInpaintMask({ outline = [], strokes = [], brushPercent = 8 } = {}) {
  const polygon = normalizeInpaintPath(outline);
  const lines = Array.isArray(strokes) ? strokes.map(points => normalizeInpaintPath(points)).filter(points => points.length) : [];
  if (polygon.length && polygon.length < 3 && !lines.length) throw new Error('Finish drawing around the area to change.');
  const radius = Math.max(0.005, Math.min(0.25, Number(brushPercent) / 200 || 0.04));
  const samples = [...polygon, ...lines.flat()];
  if (!samples.length) throw new Error('Draw around the area to change first.');
  const brushPoints = new Set(lines.flat());
  let left = 1, top = 1, right = 0, bottom = 0;
  for (const point of samples) {
    const padding = brushPoints.has(point) ? radius : 0;
    left = Math.min(left, point.x - padding); top = Math.min(top, point.y - padding);
    right = Math.max(right, point.x + padding); bottom = Math.max(bottom, point.y + padding);
  }
  left = Math.max(0, left); top = Math.max(0, top); right = Math.min(1, right); bottom = Math.min(1, bottom);
  return {
    x: left * 100, y: top * 100,
    width: Math.max(0.1, (right - left) * 100), height: Math.max(0.1, (bottom - top) * 100),
    kind: polygon.length >= 3 && lines.length ? 'mixed' : polygon.length >= 3 ? 'lasso' : 'brush',
    pointCount: polygon.length + lines.reduce((sum, line) => sum + line.length, 0)
  };
}

/** Approximate inside distance to an arbitrary mask edge with a two-pass chamfer transform. */
export function inpaintMaskDistance(mask, width, height, maximum = 64) {
  const w = Number(width), h = Number(height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || mask?.length !== w * h) {
    throw new Error('Mask dimensions do not match.');
  }
  const cap = Math.max(1, Math.min(256, Number(maximum) || 64));
  const distance = new Float32Array(w * h);
  for (let i = 0; i < distance.length; i += 1) distance[i] = mask[i] > 0 ? cap : 0;
  const diagonal = Math.SQRT2;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = y * w + x;
    if (!distance[i]) continue;
    if (x) distance[i] = Math.min(distance[i], distance[i - 1] + 1);
    if (y) distance[i] = Math.min(distance[i], distance[i - w] + 1);
    if (x && y) distance[i] = Math.min(distance[i], distance[i - w - 1] + diagonal);
    if (x + 1 < w && y) distance[i] = Math.min(distance[i], distance[i - w + 1] + diagonal);
  }
  for (let y = h - 1; y >= 0; y -= 1) for (let x = w - 1; x >= 0; x -= 1) {
    const i = y * w + x;
    if (!distance[i]) continue;
    if (x + 1 < w) distance[i] = Math.min(distance[i], distance[i + 1] + 1);
    if (y + 1 < h) distance[i] = Math.min(distance[i], distance[i + w] + 1);
    if (x + 1 < w && y + 1 < h) distance[i] = Math.min(distance[i], distance[i + w + 1] + diagonal);
    if (x && y + 1 < h) distance[i] = Math.min(distance[i], distance[i + w - 1] + diagonal);
  }
  return distance;
}

/** Compose only selected pixels. Unselected source bytes are copied exactly. */
export function composeInpaintMaskedPixels(source, generated, mask, width, height, featherPx = 16) {
  const w = Number(width), h = Number(height), pixels = w * h;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 ||
      source?.length !== pixels * 4 || generated?.length !== pixels * 4 || mask?.length !== pixels) {
    throw new Error('Masked inpaint pixel buffers do not match.');
  }
  const feather = Math.max(1, Math.min(64, Number(featherPx) || 16));
  const distance = inpaintMaskDistance(mask, w, h, feather * 2);
  const offsets = [0, 0, 0]; let samples = 0;
  for (let i = 0; i < pixels; i += 1) {
    if (!mask[i] || distance[i] > feather) continue;
    const offset = i * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      offsets[channel] += Math.max(-48, Math.min(48, source[offset + channel] - generated[offset + channel]));
    }
    samples += 1;
  }
  if (samples) for (let channel = 0; channel < 3; channel += 1) offsets[channel] /= samples;
  const result = new Uint8ClampedArray(source);
  for (let i = 0; i < pixels; i += 1) {
    const maskAlpha = Number(mask[i] || 0) / 255;
    if (!maskAlpha) continue;
    const t = Math.max(0, Math.min(1, distance[i] / feather));
    const inside = t * t * (3 - 2 * t);
    const alpha = maskAlpha * inside;
    const boundaryWeight = t < 1 ? Math.cos(t * Math.PI / 2) : 0;
    const offset = i * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const harmonized = Math.max(0, Math.min(255, generated[offset + channel] + offsets[channel] * boundaryWeight));
      result[offset + channel] = Math.round(source[offset + channel] * (1 - alpha) + harmonized * alpha);
    }
    result[offset + 3] = source[offset + 3];
  }
  return result;
}

/** Smoothly blends a generated candidate into a rectangular selection. */
export function selectionFeatherAlpha(x, y, width, height, featherPx = 16) {
  const feather = Math.max(1, Number(featherPx) || 1);
  const distance = Math.max(0, Math.min(x + 0.5, y + 0.5, width - x - 0.5, height - y - 0.5));
  const t = Math.max(0, Math.min(1, distance / feather));
  return t * t * (3 - 2 * t);
}

/**
 * Estimate a deliberately bounded colour correction from the selection edge.
 * The clamp prevents an unrelated generated object from recolouring the edit;
 * this is context harmonisation, not a replacement for model-side inpainting.
 */
export function estimateInpaintBoundaryOffsets(source, generated, width, height, samplePx = 16) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('Invalid inpaint pixel dimensions.');
  if (!source?.length || source.length !== generated?.length || source.length !== width * height * 4) throw new Error('Inpaint pixel buffers do not match.');
  const sample = Math.max(1, Math.min(Number(samplePx) || 16, Math.floor(Math.min(width, height) / 4) || 1));
  const totals = [0, 0, 0]; let count = 0;
  for (let py = 0; py < height; py += 1) for (let px = 0; px < width; px += 1) {
    const distance = Math.max(0, Math.min(px + 0.5, py + 0.5, width - px - 0.5, height - py - 0.5));
    if (distance > sample) continue;
    const offset = (py * width + px) * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      totals[channel] += Math.max(-48, Math.min(48, source[offset + channel] - generated[offset + channel]));
    }
    count += 1;
  }
  return totals.map(total => count ? total / count : 0);
}

/** Preserve the source outside the selection and harmonise only its inner edge. */
export async function blendInpaintCandidate(sourceCanvas, generatedBlob, selection, featherPx = 16) {
  const s = normalizeInpaintSelection(selection);
  const width = sourceCanvas.width, height = sourceCanvas.height;
  const x = Math.round(width * s.x / 100), y = Math.round(height * s.y / 100);
  const w = Math.max(1, Math.min(width - x, Math.round(width * s.width / 100)));
  const h = Math.max(1, Math.min(height - y, Math.round(height * s.height / 100)));
  const generated = await createImageBitmap(generatedBlob);
  try {
    const result = document.createElement('canvas'); result.width = width; result.height = height;
    const resultContext = result.getContext('2d', { willReadFrequently: true });
    resultContext.drawImage(sourceCanvas, 0, 0);
    const layer = document.createElement('canvas'); layer.width = width; layer.height = height;
    const layerContext = layer.getContext('2d', { willReadFrequently: true });
    layerContext.drawImage(generated, 0, 0, width, height);
    const sourcePixels = resultContext.getImageData(x, y, w, h);
    const generatedPixels = layerContext.getImageData(x, y, w, h);
    const feather = Math.max(1, Math.min(Number(featherPx) || 16, Math.floor(Math.min(w, h) / 4)));
    const boundaryOffsets = estimateInpaintBoundaryOffsets(sourcePixels.data, generatedPixels.data, w, h, feather);
    for (let py = 0; py < h; py += 1) for (let px = 0; px < w; px += 1) {
      const distance = Math.max(0, Math.min(px + 0.5, py + 0.5, w - px - 0.5, h - py - 0.5));
      const alpha = selectionFeatherAlpha(px, py, w, h, feather);
      const matchT = Math.max(0, Math.min(1, distance / (feather * 1.75)));
      const boundaryWeight = matchT < 1 ? Math.cos(matchT * Math.PI / 2) : 0;
      const offset = (py * w + px) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const harmonized = Math.max(0, Math.min(255,
          generatedPixels.data[offset + channel] + boundaryOffsets[channel] * boundaryWeight));
        sourcePixels.data[offset + channel] = Math.round(
          sourcePixels.data[offset + channel] * (1 - alpha) + harmonized * alpha
        );
      }
    }
    resultContext.putImageData(sourcePixels, x, y);
    return new Promise((resolve, reject) => result.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('The browser could not blend the inpainting result.')), 'image/png'
    ));
  } finally {
    generated.close?.();
  }
}

/** Blend an arbitrary lasso/brush mask while leaving every unselected pixel untouched. */
export async function blendInpaintMaskedCandidate(sourceCanvas, generatedBlob, selectionMask, featherPx = 16) {
  const width = sourceCanvas.width, height = sourceCanvas.height;
  if (!width || !height || selectionMask?.width !== width || selectionMask?.height !== height) {
    throw new Error('Selection mask does not match the source.');
  }
  const generated = await createImageBitmap(generatedBlob);
  try {
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    const sourcePixels = sourceContext.getImageData(0, 0, width, height);
    const generatedCanvas = document.createElement('canvas'); generatedCanvas.width = width; generatedCanvas.height = height;
    const generatedContext = generatedCanvas.getContext('2d', { willReadFrequently: true });
    generatedContext.drawImage(generated, 0, 0, width, height);
    const generatedPixels = generatedContext.getImageData(0, 0, width, height);
    const maskRgba = selectionMask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
    const mask = new Uint8ClampedArray(width * height);
    for (let i = 0; i < mask.length; i += 1) mask[i] = maskRgba[i * 4 + 3];
    const composed = composeInpaintMaskedPixels(sourcePixels.data, generatedPixels.data, mask, width, height, featherPx);
    sourcePixels.data.set(composed);
    const result = document.createElement('canvas'); result.width = width; result.height = height;
    result.getContext('2d').putImageData(sourcePixels, 0, 0);
    return new Promise((resolve, reject) => result.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('The browser could not blend the masked result.')), 'image/png'
    ));
  } finally {
    generated.close?.();
  }
}

/** Measure continuity only along the selected side of an arbitrary mask boundary. */
export async function assessInpaintMaskedBoundary(sourceCanvas, candidateBlob, selectionMask, edgePx = 3) {
  const width = sourceCanvas.width, height = sourceCanvas.height;
  if (!width || !height || selectionMask?.width !== width || selectionMask?.height !== height) {
    throw new Error('Selection mask does not match the source.');
  }
  const candidate = await createImageBitmap(candidateBlob);
  try {
    const candidateCanvas = document.createElement('canvas'); candidateCanvas.width = width; candidateCanvas.height = height;
    const candidateContext = candidateCanvas.getContext('2d', { willReadFrequently: true });
    candidateContext.drawImage(candidate, 0, 0, width, height);
    const source = sourceCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
    const actual = candidateContext.getImageData(0, 0, width, height).data;
    const rgba = selectionMask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
    const mask = new Uint8ClampedArray(width * height);
    for (let i = 0; i < mask.length; i += 1) mask[i] = rgba[i * 4 + 3];
    const edge = Math.max(1, Math.min(16, Math.floor(Number(edgePx) || 3)));
    const distance = inpaintMaskDistance(mask, width, height, edge + 1);
    let difference = 0, maximum = 0, samples = 0;
    for (let i = 0; i < mask.length; i += 1) {
      if (!mask[i] || distance[i] > edge) continue;
      const offset = i * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const delta = Math.abs(actual[offset + channel] - source[offset + channel]);
        difference += delta; maximum = Math.max(maximum, delta); samples += 1;
      }
    }
    const mean = samples ? difference / samples : 255;
    return {
      schema: 'materiallogix.inpaint-boundary-quality.v1',
      status: mean <= 12 && maximum <= 64 ? 'pass' : 'review',
      meanAbsoluteDifference: Number(mean.toFixed(3)), maxChannelDifference: maximum, samples,
      thresholds: { meanAbsoluteDifference: 12, maxChannelDifference: 64 },
      scope: 'inside-freehand-mask-boundary'
    };
  } finally {
    candidate.close?.();
  }
}

/**
 * Measure the actual edited pixels along the inside of the selection boundary.
 * This catches hard rectangular discontinuities before a candidate is treated
 * as ordinary review work. It is a continuity signal, not an anatomy or
 * realism verdict; human review remains required in Beta.
 */
export async function assessInpaintBoundary(sourceCanvas, candidateBlob, selection, edgePx = 3) {
  const s = normalizeInpaintSelection(selection);
  const width = sourceCanvas.width, height = sourceCanvas.height;
  const x = Math.round(width * s.x / 100), y = Math.round(height * s.y / 100);
  const w = Math.max(1, Math.min(width - x, Math.round(width * s.width / 100)));
  const h = Math.max(1, Math.min(height - y, Math.round(height * s.height / 100)));
  const edge = Math.max(1, Math.min(Math.floor(Number(edgePx) || 3), Math.floor(Math.min(w, h) / 4) || 1));
  const candidate = await createImageBitmap(candidateBlob);
  try {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(candidate, 0, 0, width, height);
    const source = sourceCanvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, w, h).data;
    const actual = context.getImageData(x, y, w, h).data;
    let difference = 0, maximum = 0, samples = 0;
    for (let py = 0; py < h; py += 1) for (let px = 0; px < w; px += 1) {
      const distance = Math.min(px, py, w - px - 1, h - py - 1);
      if (distance >= edge) continue;
      const offset = (py * w + px) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const delta = Math.abs(actual[offset + channel] - source[offset + channel]);
        difference += delta; maximum = Math.max(maximum, delta); samples += 1;
      }
    }
    const mean = samples ? difference / samples : 255;
    return {
      schema: 'materiallogix.inpaint-boundary-quality.v1',
      status: mean <= 12 && maximum <= 64 ? 'pass' : 'review',
      meanAbsoluteDifference: Number(mean.toFixed(3)),
      maxChannelDifference: maximum,
      samples,
      thresholds: { meanAbsoluteDifference: 12, maxChannelDifference: 64 },
      scope: 'inner-selection-boundary-only'
    };
  } finally {
    candidate.close?.();
  }
}

/** Standard ComfyUI inpainting graph with independent source and mask files. */
export function buildInpaint({ imageName, maskName, ckpt, prompt, negative = '', styleIntent = 'natural', seed, denoise = 0.78, growMaskBy = 8 }) {
  if (!imageName) throw new Error('No source image uploaded.');
  if (!maskName) throw new Error('No selection mask uploaded.');
  if (!ckpt) throw new Error('No inpainting checkpoint selected.');
  if (String(prompt || '').length > 1000 || String(negative || '').length > 1000) throw new Error('Prompt text is too long.');
  const styled = applyPhotoStyleDefaults(prompt, negative, styleIntent);
  const strength = Number(denoise);
  if (!Number.isFinite(strength) || strength < 0.1 || strength > 1) throw new Error('Denoise must be between 0.1 and 1.');
  const grow = Number(growMaskBy);
  if (!Number.isInteger(grow) || grow < 0 || grow > 64) throw new Error('Mask growth must be an integer from 0 to 64.');
  const s = seed ?? Math.floor(Math.random() * 2 ** 32);
  if (!Number.isSafeInteger(s) || s < 0) throw new Error('Seed must be a non-negative safe integer.');
  return {
    seed: s,
    styleIntent: styled.styleIntent,
    graph: {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
      '2': { class_type: 'LoadImage', inputs: { image: imageName } },
      '3': { class_type: 'LoadImage', inputs: { image: maskName } },
      '4': { class_type: 'CLIPTextEncode', inputs: { text: styled.prompt, clip: ['1', 1] } },
      '5': { class_type: 'CLIPTextEncode', inputs: { text: styled.negative, clip: ['1', 1] } },
      '6': {
        class_type: 'VAEEncodeForInpaint',
        inputs: { pixels: ['2', 0], mask: ['3', 1], vae: ['1', 2], grow_mask_by: grow }
      },
      '7': {
        class_type: 'KSampler',
        inputs: {
          model: ['1', 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['6', 0],
          seed: s, steps: 24, cfg: 6.5, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: strength
        }
      },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['1', 2] } },
      '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'materiallogix_fill' } }
    }
  };
}

/** Upload the source and mask separately, then run local inpainting. */
export async function inpaintOne(sourceBlob, sourceFilename, maskBlob, maskFilename, opts, onStatus = () => {}, base = DEFAULT_BASE) {
  onStatus('uploading source');
  const imageName = await uploadImage(sourceBlob, sourceFilename, base);
  onStatus('uploading selection');
  const maskName = await uploadImage(maskBlob, maskFilename, base);
  const { seed, graph } = buildInpaint({ ...opts, imageName, maskName });
  const out = await runGraph(graph, onStatus, base);
  return { ...out, seed };
}

/** Which upscale models the local install has (e.g. RealESRGAN_x4plus.pth). */
export async function listUpscaleModels(base = DEFAULT_BASE) {
  const info = await getJson(base, '/object_info/UpscaleModelLoader');
  return info?.UpscaleModelLoader?.input?.required?.model_name?.[0] || [];
}

/** Push a source image into ComfyUI's input folder; returns its server name. */
export async function uploadImage(blob, filename, base = DEFAULT_BASE) {
  const fd = new FormData();
  fd.append('image', blob, filename);
  const res = await fetch(localBase(base) + '/upload/image', { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Engine refused the upload (${res.status}).`);
  const j = await res.json();
  return j.name || filename;
}

/**
 * Model-based upscale graph (Real-ESRGAN and friends run as ComfyUI upscale
 * models). Pure function: the suite verifies the wiring without a GPU.
 */
export function buildUpscale({ imageName, model }) {
  if (!imageName) throw new Error('No source image.');
  if (!model) throw new Error('No upscale model installed on the engine.');
  return {
    graph: {
      '1': { class_type: 'LoadImage', inputs: { image: imageName } },
      '2': { class_type: 'UpscaleModelLoader', inputs: { model_name: model } },
      '3': { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['2', 0], image: ['1', 0] } },
      '4': { class_type: 'SaveImage', inputs: { images: ['3', 0], filename_prefix: 'cros_up' } }
    }
  };
}

/** Upload, upscale, and return the enlarged image. */
export async function upscaleOne(blob, filename, model, onStatus = () => {}, base = DEFAULT_BASE) {
  onStatus('uploading');
  const imageName = await uploadImage(blob, filename, base);
  const { graph } = buildUpscale({ imageName, model });
  return runGraph(graph, onStatus, base);
}

/** Submit one job and wait for its image. Returns { blob, seed, filename }. */
export async function generateOne(opts, onStatus = () => {}, base = DEFAULT_BASE, timeoutMinutes = 10) {
  const { seed, graph } = buildTxt2Img(opts);
  const out = await runGraph(graph, onStatus, base, timeoutMinutes);
  return { ...out, seed };
}

/** Shared submit-and-poll loop for any workflow graph. */
export async function runGraph(graph, onStatus = () => {}, base = DEFAULT_BASE, timeoutMinutes = 10) {
  base = localBase(base);
  onStatus('queued');
  const res = await fetch(base + '/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: 'creative-review-os' })
  });
  if (!res.ok) throw new Error(`The local engine rejected the job (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const { prompt_id } = await res.json();

  // Poll history until the job lands. Local jobs run seconds to minutes.
  const deadline = Date.now() + Math.max(10, timeoutMinutes) * 60 * 1000;
  let unreachable = 0;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500));
    onStatus('generating');
    const hist = await getJson(base, `/history/${prompt_id}`, 5000).catch(() => null);
    if (!hist) {
      if (++unreachable >= 8) throw new Error('The local engine stopped responding mid-job. Check that it is still running, then try again.');
      continue;
    }
    unreachable = 0;
    const entry = hist[prompt_id];
    if (entry?.status?.status_str === 'error') {
      throw new Error('The local engine could not finish the job. Check its window for the reason.');
    }
    const img = entry && Object.values(entry.outputs || {}).flatMap(o => o.images || [])[0];
    if (img) {
      onStatus('downloading');
      const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
      const imgRes = await fetch(`${base}/view?${q}`);
      if (!imgRes.ok) throw new Error('Generated, but the image could not be fetched.');
      return { blob: await imgRes.blob(), filename: img.filename };
    }
    if (entry?.status?.completed) {
      throw new Error('The job finished without producing an image — it may have been interrupted in the engine.');
    }
  }
  throw new Error('The engine is still working past the time limit. Try a smaller size or the faster setting.');
}

// --- the local bridge (engine.py): zero-setup Real-ESRGAN -------------------

const BRIDGE = `http://${BRIDGE_HOST}:8189`;

export async function detectBridge(base = BRIDGE) {
  try {
    const res = await bridgeFetch(`${base}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { ok: false, base };
    const j = await res.json();
    return { ok: true, base, upscale: j.upscale, voice: j.voice, video: j.video, lan: j.lan || [] };
  } catch {
    return { ok: false, base };
  }
}

export async function upscaleViaBridge(blob, model, onStatus = () => {}, base = BRIDGE) {
  onStatus('upscaling');
  const res = await bridgeFetch(`${base}/upscale?model=${encodeURIComponent(model)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: blob
  });
  if (!res.ok) {
    let msg = `bridge error ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* keep */ }
    throw new Error(msg);
  }
  return {
    blob: await res.blob(),
    engine: res.headers.get('X-MaterialLogix-Upscale-Engine') || 'local-upscale-engine'
  };
}

export function localUpscaleModelLabel(model) {
  if (model === 'cpu-lanczos-x2') return 'CPU recovery · Lanczos 2× (non-AI)';
  if (model === 'cpu-lanczos-x4') return 'CPU recovery · Lanczos 4× (non-AI)';
  return `${model} · AI detail restoration`;
}

export function localUpscaleEngineLabel(engine) {
  if (engine === 'realesrgan-ncnn-vulkan') return 'local Real-ESRGAN GPU engine';
  if (engine === 'ffmpeg-lanczos-cpu') return 'local CPU Lanczos scaler (non-AI)';
  if (engine === 'ffmpeg-lanczos-cpu-fallback') return 'local CPU Lanczos recovery after GPU failure (non-AI)';
  return 'local image engine';
}
