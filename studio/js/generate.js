// Tier-1 generation: ComfyUI running on the user's own GPU.
//
// ComfyUI is free, open source, and serves a small HTTP API on localhost.
// Nothing here touches a paid service or leaves the machine. Tier 2 (bring
// your own provider key) and tier 3 (managed, billed) are Phase 2.

// Where do the engines live? If this page came from localhost or a LAN
// address, the serving computer owns the GPU (phone-over-Wi-Fi case). If it
// came from the public site (materiallogix.com), the engines run on the
// CUSTOMER'S own machine — so default to 127.0.0.1 there, overridable via
// the Engine address setting.
const isPrivateHost = h => /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.endsWith('.local');
const HOST = (typeof location !== 'undefined' && isPrivateHost(location.hostname))
  ? location.hostname
  : '127.0.0.1';
const DEFAULT_BASE = `http://${HOST}:8188`;

/** Fetch with the bridge PIN when set; prompts once if the bridge asks. */
export async function bridgeFetch(url, opts = {}) {
  const withPin = pin => fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), ...(pin ? { 'X-Bridge-Pin': pin } : {}) }
  });
  let res = await withPin(localStorage.getItem('cros:bridgePin') || '');
  if (res.status === 403) {
    const j = await res.clone().json().catch(() => ({}));
    if (j.pinRequired) {
      const pin = prompt('Enter the Wi-Fi PIN shown in the bridge console on your computer:');
      if (pin) {
        localStorage.setItem('cros:bridgePin', pin.trim());
        res = await withPin(pin.trim());
      }
    }
  }
  return res;
}

async function getJson(base, path, timeout = 2500) {
  const res = await fetch(base + path, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

/** Is a local ComfyUI running, and on what hardware? */
export async function detectComfy(base = DEFAULT_BASE) {
  try {
    const stats = await getJson(base, '/system_stats');
    const dev = stats.devices?.[0];
    return {
      ok: true,
      base,
      device: dev?.name || 'GPU',
      vramGB: dev?.vram_total ? +(dev.vram_total / 1073741824).toFixed(1) : null
    };
  } catch {
    return { ok: false, base };
  }
}

/** Models the local install actually has. The app never assumes a filename. */
export async function listCheckpoints(base = DEFAULT_BASE) {
  const info = await getJson(base, '/object_info/CheckpointLoaderSimple');
  return info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
}

/**
 * A minimal, standard txt2img graph. Pure function so the suite can verify
 * that prompts, sizes, and wiring land where they should without a GPU.
 */
export function buildTxt2Img({ ckpt, prompt, negative = '', width = 1024, height = 1024, steps = 22, cfg = 6.5, seed }) {
  if (!ckpt) throw new Error('No checkpoint model selected.');
  if (!prompt?.trim()) throw new Error('Prompt is empty.');
  const s = seed ?? Math.floor(Math.random() * 2 ** 32);
  return {
    seed: s,
    graph: {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['1', 1] } },
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

/** Which upscale models the local install has (e.g. RealESRGAN_x4plus.pth). */
export async function listUpscaleModels(base = DEFAULT_BASE) {
  const info = await getJson(base, '/object_info/UpscaleModelLoader');
  return info?.UpscaleModelLoader?.input?.required?.model_name?.[0] || [];
}

/** Push a source image into ComfyUI's input folder; returns its server name. */
export async function uploadImage(blob, filename, base = DEFAULT_BASE) {
  const fd = new FormData();
  fd.append('image', blob, filename);
  const res = await fetch(base + '/upload/image', { method: 'POST', body: fd });
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
export async function generateOne(opts, onStatus = () => {}, base = DEFAULT_BASE) {
  const { seed, graph } = buildTxt2Img(opts);
  const out = await runGraph(graph, onStatus, base);
  return { ...out, seed };
}

/** Shared submit-and-poll loop for any workflow graph. */
export async function runGraph(graph, onStatus = () => {}, base = DEFAULT_BASE) {
  onStatus('queued');
  const res = await fetch(base + '/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: 'creative-review-os' })
  });
  if (!res.ok) throw new Error(`ComfyUI rejected the job (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const { prompt_id } = await res.json();

  // Poll history until the job lands. Local jobs run seconds to minutes.
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500));
    onStatus('generating');
    const hist = await getJson(base, `/history/${prompt_id}`, 5000).catch(() => null);
    const entry = hist?.[prompt_id];
    if (entry?.status?.status_str === 'error') {
      throw new Error('Generation failed inside ComfyUI — check its console.');
    }
    const img = entry && Object.values(entry.outputs || {}).flatMap(o => o.images || [])[0];
    if (img) {
      onStatus('downloading');
      const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
      const imgRes = await fetch(`${base}/view?${q}`);
      if (!imgRes.ok) throw new Error('Generated, but the image could not be fetched.');
      return { blob: await imgRes.blob(), filename: img.filename };
    }
  }
  throw new Error('Timed out waiting for the local GPU.');
}

// --- the local bridge (engine.py): zero-setup Real-ESRGAN -------------------

const BRIDGE = `http://${HOST}:8189`;

export async function detectBridge(base = BRIDGE) {
  try {
    const res = await fetch(base + '/health', { signal: AbortSignal.timeout(1500) });
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
  return { blob: await res.blob() };
}
