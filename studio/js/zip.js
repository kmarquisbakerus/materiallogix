// Minimal ZIP writer (STORE only, no compression, no dependencies).
// Enough to package already-compressed media plus a few small text files.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

const encoder = new TextEncoder();

/**
 * @param {Array<{name: string, data: Uint8Array|string, date?: Date}>} entries
 * @returns {Blob}
 */
const ZIP32_LIMIT = 0xfff00000; // just under 4 GiB: this writer has no ZIP64 records

export function makeZip(entries) {
  const now = new Date();
  const chunks = [];
  const central = [];
  let offset = 0;
  let totalBytes = 0;
  for (const entry of entries) {
    totalBytes += typeof entry.data === 'string' ? entry.data.length : entry.data.byteLength;
    if (totalBytes > ZIP32_LIMIT) {
      throw new Error('This archive would exceed 4 GB, which this recovery format cannot store safely. Split the project or remove large media before exporting.');
    }
  }

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const { time, date } = dosDateTime(entry.date || now);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);      // version needed
    lv.setUint16(6, 0x0800, true);  // UTF-8 filename flag
    lv.setUint16(8, 0, true);       // method: store
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    chunks.push(local, data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);      // version made by
    cv.setUint16(6, 20, true);      // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, end], { type: 'application/zip' });
}

/** Read archives produced by makeZip. Only uncompressed STORE entries are
 * accepted; encrypted, compressed, oversized, and unsafe paths are rejected. */
export async function readStoreZip(blob) {
  if (!(blob instanceof Blob) || blob.size > 8 * 1024 * 1024 * 1024) throw new Error('Recovery file is too large.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map();
  let offset = 0;
  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    if (entries.size >= 5000 || offset + 30 > bytes.length) throw new Error('Invalid recovery archive.');
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if ((flags & 1) || method !== 0) throw new Error('Unsupported recovery archive.');
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const end = dataStart + size;
    if (end > bytes.length) throw new Error('Truncated recovery archive.');
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)).replace(/\\/g, '/');
    if (!name || name.startsWith('/') || name.includes('../') || name.includes('\0')) throw new Error('Unsafe recovery path.');
    entries.set(name, bytes.slice(dataStart, end));
    offset = end;
  }
  if (!entries.size) throw new Error('No recovery entries found.');
  return entries;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
