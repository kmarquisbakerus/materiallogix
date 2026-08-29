// Embedded camera preview extraction. Cameras write a finished JPEG render of
// every shot inside the RAW container; this engine locates the largest one and
// returns it without touching the mosaic data. Studio can therefore open
// camera files immediately, while full RAW development stays behind the
// verified offline decoder packet. Every read here is a bounded local slice.

const MAX_PREVIEW_BYTES = 48 * 1024 * 1024;
const MAX_IFDS = 64;
const MAX_SUBIFD_DEPTH = 2;

async function bytesAt(file, offset, length) {
  if (!Number.isFinite(offset) || !Number.isFinite(length)) return null;
  if (offset < 0 || length <= 0 || offset + length > file.size) return null;
  return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
}

/** Width and height from a JPEG's start-of-frame segment. */
export function jpegDimensions(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  for (let hops = 0; hops < 128 && at + 4 <= bytes.length; hops += 1) {
    if (bytes[at] !== 0xff) { at += 1; continue; }
    const marker = bytes[at + 1];
    if (marker === 0xff) { at += 1; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (at + 9 > bytes.length) return null;
      return {
        height: (bytes[at + 5] << 8) | bytes[at + 6],
        width: (bytes[at + 7] << 8) | bytes[at + 8]
      };
    }
    at += 2 + length;
  }
  return null;
}

function entryValue(view, entryOffset, little) {
  const type = view.getUint16(entryOffset + 2, little);
  const count = view.getUint32(entryOffset + 4, little);
  if (count === 1 && (type === 3 || type === 4)) {
    return type === 3 ? view.getUint16(entryOffset + 8, little) : view.getUint32(entryOffset + 8, little);
  }
  return null;
}

async function collectTiffCandidates(file, little) {
  const header = await bytesAt(file, 0, 8);
  if (!header) return [];
  const view = new DataView(header.buffer);
  const queue = [{ offset: view.getUint32(4, little), depth: 0 }];
  const seen = new Set();
  const candidates = [];

  while (queue.length && seen.size < MAX_IFDS) {
    const { offset, depth } = queue.shift();
    if (!offset || seen.has(offset)) continue;
    seen.add(offset);

    const countBytes = await bytesAt(file, offset, 2);
    if (!countBytes) continue;
    const entryCount = new DataView(countBytes.buffer).getUint16(0, little);
    if (!entryCount || entryCount > 512) continue;
    const table = await bytesAt(file, offset + 2, entryCount * 12 + 4);
    if (!table) continue;
    const tableView = new DataView(table.buffer);

    let jpegOffset = null, jpegLength = null;
    let stripOffset = null, stripLength = null, compression = null;
    for (let index = 0; index < entryCount; index += 1) {
      const at = index * 12;
      const tag = tableView.getUint16(at, little);
      if (tag === 0x0201) jpegOffset = entryValue(tableView, at, little);
      else if (tag === 0x0202) jpegLength = entryValue(tableView, at, little);
      else if (tag === 0x0111) stripOffset = entryValue(tableView, at, little);
      else if (tag === 0x0117) stripLength = entryValue(tableView, at, little);
      else if (tag === 0x0103) compression = entryValue(tableView, at, little);
      else if (tag === 0x014a && depth < MAX_SUBIFD_DEPTH) {
        const count = tableView.getUint32(at + 4, little);
        if (count === 1) queue.push({ offset: tableView.getUint32(at + 8, little), depth: depth + 1 });
        else if (count > 1 && count <= 8) {
          const list = await bytesAt(file, tableView.getUint32(at + 8, little), count * 4);
          if (list) {
            const listView = new DataView(list.buffer);
            for (let sub = 0; sub < count; sub += 1) queue.push({ offset: listView.getUint32(sub * 4, little), depth: depth + 1 });
          }
        }
      }
    }
    if (jpegOffset !== null && jpegLength !== null) candidates.push({ offset: jpegOffset, length: jpegLength });
    if (stripOffset !== null && stripLength !== null && (compression === 6 || compression === 7)) {
      candidates.push({ offset: stripOffset, length: stripLength });
    }
    const next = tableView.getUint32(entryCount * 12, little);
    if (next) queue.push({ offset: next, depth });
  }
  return candidates;
}

async function validateCandidate(file, candidate) {
  if (candidate.length < 128 || candidate.length > MAX_PREVIEW_BYTES) return null;
  const start = await bytesAt(file, candidate.offset, 3);
  if (!start || start[0] !== 0xff || start[1] !== 0xd8 || start[2] !== 0xff) return null;
  const jpeg = await bytesAt(file, candidate.offset, candidate.length);
  if (!jpeg) return null;
  let end = jpeg.length;
  while (end > 2 && jpeg[end - 1] === 0) end -= 1;   // some writers zero-pad
  if (jpeg[end - 2] !== 0xff || jpeg[end - 1] !== 0xd9) return null;
  const size = jpegDimensions(jpeg);
  if (!size || size.width < 16 || size.height < 16) return null;
  return { jpeg, ...size };
}

/**
 * Locate and return the largest embedded JPEG preview in a camera RAW file.
 * Supports TIFF-family containers (DNG, CR2, NEF, ARW, ORF, RW2 and kin) and
 * Fujifilm RAF. Returns { ok, jpeg, width, height, source } or { ok: false, code }.
 */
export async function extractEmbeddedPreview(file) {
  const head = await bytesAt(file, 0, 96);
  if (!head) return { ok: false, code: 'preview_unreadable' };

  const littleTiff = head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a && head[3] === 0x00;
  const bigTiff = head[0] === 0x4d && head[1] === 0x4d && head[2] === 0x00 && head[3] === 0x2a;
  if (littleTiff || bigTiff) {
    const candidates = await collectTiffCandidates(file, littleTiff);
    candidates.sort((a, b) => b.length - a.length);
    for (const candidate of candidates.slice(0, 6)) {
      const validated = await validateCandidate(file, candidate);
      if (validated) return { ok: true, source: 'tiff-ifd', ...validated };
    }
    return { ok: false, code: 'preview_not_found' };
  }

  const raf = [...'FUJIFILMCCD-RAW'].every((ch, index) => head[index] === ch.charCodeAt(0));
  if (raf && head.length >= 92) {
    const view = new DataView(head.buffer);
    const candidate = { offset: view.getUint32(84, false), length: view.getUint32(88, false) };
    const validated = await validateCandidate(file, candidate);
    if (validated) return { ok: true, source: 'raf-header', ...validated };
    return { ok: false, code: 'preview_not_found' };
  }

  return { ok: false, code: 'preview_unsupported_container' };
}
