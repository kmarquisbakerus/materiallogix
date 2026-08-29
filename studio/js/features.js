// Server-controlled switches. Read once per load, off whenever unknown.
import { apiUrl } from './api-root.js';

let pending = null;
let flags = null;

async function load() {
  try {
    const res = await fetch(apiUrl('/api/session'), { credentials: 'include' });
    if (!res.ok) return {};
    const body = await res.json();
    return body && typeof body.features === 'object' && body.features ? body.features : {};
  } catch {
    return {};
  }
}

/** Every flag the server allows this viewer to see. */
export async function features() {
  if (flags) return flags;
  pending = pending || load().then(value => { flags = value; return flags; });
  return pending;
}

/** One flag. Off unless the server says otherwise. */
export async function featureEnabled(key) {
  return (await features())[key] === true;
}

/** Test seam. */
export function resetFeatures() { flags = null; pending = null; }
