const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crcStep(crc, bytes) {
  let value = crc;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return value;
}

async function crc32Blob(blob, onProgress = () => {}) {
  const reader = blob.stream().getReader();
  let crc = 0xffffffff;
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    crc = crcStep(crc, value);
    read += value.byteLength;
    onProgress(read, blob.size);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function localHeader(name, size, crc, at) {
  const nameBytes = encoder.encode(name);
  const header = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, at.time, true);
  view.setUint16(12, at.date, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, nameBytes.length, true);
  header.set(nameBytes, 30);
  return header;
}

function centralHeader(name, size, crc, offset, at) {
  const nameBytes = encoder.encode(name);
  const header = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, at.time, true);
  view.setUint16(14, at.date, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint32(42, offset, true);
  header.set(nameBytes, 46);
  return header;
}

function safeFilename(value) {
  return String(value || 'source-video').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 180) || 'source-video';
}

/** Build one uncompressed job ZIP without copying the source video into JS memory. */
export async function buildCloudVideoPackage(source, manifest, onProgress = () => {}) {
  if (!(source instanceof Blob) || source.size < 1 || source.size > 0x7fffffff - 1024 * 1024) throw new Error('The cloud source must be between 1 byte and just under 2 GB.');
  const manifestBytes = encoder.encode(JSON.stringify(manifest, null, 2));
  const manifestBlob = new Blob([manifestBytes], { type: 'application/json' });
  const at = dosDateTime();
  const sourceName = `source/${safeFilename(source.name)}`;
  const entries = [
    { name: 'job.json', blob: manifestBlob, crc: (crcStep(0xffffffff, manifestBytes) ^ 0xffffffff) >>> 0 },
    { name: sourceName, blob: source, crc: await crc32Blob(source, onProgress) }
  ];
  const body = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const local = localHeader(entry.name, entry.blob.size, entry.crc, at);
    body.push(local, entry.blob);
    central.push(centralHeader(entry.name, entry.blob.size, entry.crc, offset, at));
    offset += local.byteLength + entry.blob.size;
  }
  const centralSize = central.reduce((total, value) => total + value.byteLength, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return new Blob([...body, ...central, end], { type: 'application/zip' });
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  const response = await fetch(path, { ...options, headers, credentials: 'include', cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `cloud_${response.status}`);
  return payload;
}

export async function cloudVideoAvailability() {
  try {
    const session = await api('/api/session');
    return { authenticated: session.authenticated === true, available: session.cloudAvailable === true };
  } catch {
    return { authenticated: false, available: false };
  }
}

export async function submitCloudVideoPackage({ source, manifest, outputSeconds, expectedAmountCents,
  cloudProcessingConsent, retentionAccepted, operationId = crypto.randomUUID(), onProgress = () => {} }) {
  if (cloudProcessingConsent !== true || retentionAccepted !== true) throw new Error('Cloud processing and temporary-retention consent are required.');
  onProgress({ status: 'packaging', progress: 1, detail: 'Checking the complete package' });
  const packageBlob = await buildCloudVideoPackage(source, manifest, (read, total) => {
    onProgress({ status: 'packaging', progress: Math.max(1, Math.round(read / total * 12)), detail: 'Checking the complete package' });
  });
  const quoted = await api('/api/cloud/video/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationId },
    body: JSON.stringify({ outputSeconds, totalBytes: packageBlob.size, contentType: 'application/zip',
      cloudProcessingConsent: true, retentionAccepted: true })
  });
  if (Number.isInteger(expectedAmountCents) && quoted.job.quote.amountCents !== expectedAmountCents) {
    throw new Error('The server quote changed. Review the updated amount before uploading.');
  }
  const jobId = quoted.job.id;
  const { partSizeBytes, totalParts, partUrlTemplate } = quoted.upload;
  const parts = [];
  for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
    const start = (partNumber - 1) * partSizeBytes;
    const end = Math.min(packageBlob.size, start + partSizeBytes);
    const response = await api(partUrlTemplate.replace('{partNumber}', String(partNumber)), {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: packageBlob.slice(start, end)
    });
    parts.push({ partNumber: response.partNumber, etag: response.etag });
    onProgress({ id: jobId, status: 'uploading', progress: 12 + Math.round(partNumber / totalParts * 68),
      detail: `Uploading package ${partNumber} of ${totalParts}`, credits: quoted.job.quote.amountCents / 100 });
  }
  await api(quoted.upload.completeUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parts }) });
  const submitted = await api(`/api/cloud/video/jobs/${encodeURIComponent(jobId)}/submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ executionTimeoutSeconds: 1800 })
  });
  onProgress({ id: jobId, status: submitted.job.status, progress: 82, detail: 'Cloud render queued', credits: quoted.job.quote.amountCents / 100 });
  return { jobId, quote: quoted.job.quote };
}

export function watchCloudVideoJob(jobId, onProgress = () => {}, intervalMs = 3000) {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const result = await api(`/api/cloud/video/jobs/${encodeURIComponent(jobId)}`);
      const status = result.job.status;
      const progress = status === 'completed' ? 100 : status === 'running' ? 90 : status === 'queued' ? 84 : 82;
      onProgress({ id: jobId, status, progress, detail: status === 'completed' ? 'Ready to download' : 'Cloud processing' });
      if (['completed', 'failed', 'canceled'].includes(status)) return;
    } catch (error) {
      onProgress({ id: jobId, status: 'failed', progress: 100, detail: error.message });
      return;
    }
    setTimeout(tick, intervalMs);
  };
  tick();
  return () => { stopped = true; };
}

export function downloadCloudVideo(jobId) {
  const link = document.createElement('a');
  link.href = `/api/cloud/video/jobs/${encodeURIComponent(jobId)}/output`;
  link.download = '';
  document.body.append(link);
  link.click();
  link.remove();
}
