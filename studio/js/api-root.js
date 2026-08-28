export const API_ORIGIN = typeof location !== 'undefined' && location.hostname === 'studio.materiallogix.com'
  ? '' : 'https://studio.materiallogix.com';

export function apiUrl(path) {
  const normalized = String(path || '').startsWith('/api/')
    ? String(path)
    : `/api/${String(path || '').replace(/^\/+/, '')}`;
  return `${API_ORIGIN}${normalized}`;
}
