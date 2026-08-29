import { extractEmbeddedPreview } from './raw-preview.js';

const RAW_EXTENSIONS = new Set([
  '3fr', 'arw', 'cr2', 'cr3', 'dcr', 'dng', 'erf', 'fff', 'iiq',
  'k25', 'kdc', 'mef', 'mos', 'mrw', 'nef', 'nrw', 'orf', 'pef',
  'raf', 'raw', 'rw2', 'rwl', 'sr2', 'srf', 'srw', 'x3f'
]);

export const RAW_ACCEPT_EXTENSIONS = [...RAW_EXTENSIONS].sort().map(ext => `.${ext}`);
export const RAW_ACCEPT_ATTRIBUTE = ['image/*', 'video/*', '.hdr', '.pic', '.rgbe', ...RAW_ACCEPT_EXTENSIONS].join(',');
export const RAW_MAX_BYTES = 200 * 1024 * 1024;
export const RAW_DECODE_TIMEOUT_MS = 30_000;
export const RAW_DECODER_PACKET = {
  schema: 'materiallogix.raw-decoder-packet.v1',
  status: 'not-installed',
  decoder: { name: 'LibRaw', version: '0.22.2' },
  color: { name: 'LCMS', version: '2.19.1' },
  runtime: 'offline-worker',
  artifacts: [
    { path: 'assets/raw/libraw.js', sha256: null },
    { path: 'assets/raw/libraw.wasm', sha256: null },
    { path: 'assets/raw/worker.js', sha256: null }
  ]
};

export function rawExtension(name = '') {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

export function isRawCameraFile(fileOrName) {
  const name = typeof fileOrName === 'string' ? fileOrName : fileOrName?.name;
  return RAW_EXTENSIONS.has(rawExtension(name));
}

export function isRadianceFile(fileOrName) {
  const name = typeof fileOrName === 'string' ? fileOrName : fileOrName?.name;
  return /\.(?:hdr|pic|rgbe)$/i.test(name || '');
}

export function isImportableMediaFile(file) {
  const type = file?.type || '';
  return /^(image|video)\//.test(type) || isRadianceFile(file) || isRawCameraFile(file);
}

export async function inspectRawHeader(file) {
  if (!isRawCameraFile(file)) return { accepted: false, code: 'not_raw_camera_file' };
  if (!file || typeof file.slice !== 'function') return { accepted: false, code: 'file_unreadable' };
  if (file.size > RAW_MAX_BYTES) return { accepted: false, code: 'raw_file_too_large', limitBytes: RAW_MAX_BYTES };
  if (file.size < 16) return { accepted: false, code: 'raw_file_too_small' };

  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const ascii = (offset, text) => [...text].every((ch, i) => head[offset + i] === ch.charCodeAt(0));
  const littleTiff = head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a && head[3] === 0x00;
  const bigTiff = head[0] === 0x4d && head[1] === 0x4d && head[2] === 0x00 && head[3] === 0x2a;
  const cr2 = littleTiff && head[8] === 0x43 && head[9] === 0x52;
  const cr3 = ascii(4, 'ftyp') && ascii(8, 'crx ');
  const raf = ascii(0, 'FUJIFILMCCD-RAW');
  const x3f = ascii(0, 'FOVb');

  let container = null;
  if (cr2) container = 'cr2-tiff';
  else if (littleTiff || bigTiff) container = 'tiff-raw';
  else if (cr3) container = 'cr3-bmff';
  else if (raf) container = 'raf-fujifilm';
  else if (x3f) container = 'x3f-foveon';

  if (!container) return { accepted: false, code: 'raw_container_unrecognized' };
  return {
    accepted: true,
    code: 'raw_header_accepted',
    container,
    byteOrder: littleTiff ? 'little' : bigTiff ? 'big' : 'n/a'
  };
}

function setupMessage(code) {
  if (code === 'raw_file_too_large') {
    return 'That camera RAW file is too large for the protected import limit. Convert a working copy or use a smaller source.';
  }
  if (code === 'raw_container_unrecognized' || code === 'raw_file_too_small') {
    return 'That camera RAW file could not be recognized. Studio left the original untouched.';
  }
  return 'Camera RAW import needs the verified offline decoder packet before Studio can open this file. The original was left untouched.';
}

function defaultWorkerFactory(workerUrl) {
  if (typeof Worker !== 'function') return null;
  return new Worker(workerUrl, { type: 'module' });
}

async function embeddedPreviewImport(file, inspection) {
  const preview = await extractEmbeddedPreview(file);
  if (!preview.ok) return null;
  const outputName = String(file.name || 'camera-raw').replace(/\.[^.]+$/, '') + '-camera-preview.jpg';
  return {
    ok: true,
    mode: 'embedded-preview',
    file: new File([preview.jpeg], outputName, { type: 'image/jpeg' }),
    width: preview.width,
    height: preview.height,
    inspection,
    provenance: {
      sourceFilename: file.name || '',
      sourceBytes: file.size || 0,
      decoder: { name: 'embedded-camera-preview', version: preview.source },
      color: { name: 'camera-rendered', version: 'as-shot' },
      worker: 'offline'
    }
  };
}

export async function prepareRawCameraImport(file, options = {}) {
  const inspection = await inspectRawHeader(file);
  if (!inspection.accepted) {
    return { ok: false, code: inspection.code, message: setupMessage(inspection.code), inspection };
  }

  const workerUrl = options.workerUrl || new URL('../assets/raw/worker.js', import.meta.url);
  const workerFactory = options.workerFactory || defaultWorkerFactory;
  const worker = workerFactory(workerUrl);
  if (!worker) {
    const preview = await embeddedPreviewImport(file, inspection);
    if (preview) return preview;
    return { ok: false, code: 'raw_decoder_unavailable', message: setupMessage('raw_decoder_unavailable'), inspection };
  }

  return new Promise(resolve => {
    const resolveWithFallback = failure => {
      embeddedPreviewImport(file, inspection)
        .catch(() => null)
        .then(preview => resolve(preview || failure));
    };
    const timer = setTimeout(() => {
      worker.terminate?.();
      resolveWithFallback({ ok: false, code: 'raw_decoder_timeout', message: setupMessage('raw_decoder_timeout'), inspection });
    }, options.timeoutMs || RAW_DECODE_TIMEOUT_MS);

    worker.onmessage = event => {
      clearTimeout(timer);
      worker.terminate?.();
      const data = event.data || {};
      if (!data.ok || !data.blob) {
        resolveWithFallback({
          ok: false,
          code: data.code || 'raw_decoder_unavailable',
          message: data.message || setupMessage(data.code),
          inspection
        });
        return;
      }
      const outputName = String(file.name || 'camera-raw').replace(/\.[^.]+$/, '') + '.png';
      resolve({
        ok: true,
        mode: 'decoded',
        file: new File([data.blob], outputName, { type: data.mime || 'image/png' }),
        width: data.width || 0,
        height: data.height || 0,
        inspection,
        provenance: {
          sourceFilename: file.name || '',
          sourceBytes: file.size || 0,
          decoder: RAW_DECODER_PACKET.decoder,
          color: RAW_DECODER_PACKET.color,
          worker: 'offline'
        }
      });
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate?.();
      resolveWithFallback({ ok: false, code: 'raw_decoder_unavailable', message: setupMessage('raw_decoder_unavailable'), inspection });
    };
    worker.postMessage({ type: 'decode-camera-raw', file, limits: { maxBytes: RAW_MAX_BYTES } });
  });
}
