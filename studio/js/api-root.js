export const API_ORIGIN = typeof location !== 'undefined' && location.hostname === 'studio.materiallogix.com'
  ? '' : typeof location !== 'undefined' && ['materiallogix.com', 'www.materiallogix.com'].includes(location.hostname)
    ? '' : 'https://materiallogix.com';

export function apiUrl(path) {
  const normalized = String(path || '').startsWith('/api/')
    ? String(path)
    : `/api/${String(path || '').replace(/^\/+/, '')}`;
  return `${API_ORIGIN}${normalized}`;
}
