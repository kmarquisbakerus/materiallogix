// Shared navigation and fail-closed production access boundary. Authentication
// decisions belong to the same-origin server/edge, never downloadable JavaScript.

import { apiUrl } from './api-root.js';

async function enforceAccessBoundary() {
  const params = new URLSearchParams(location.search);
  const local = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  const demo = params.get('demo') === '1';
  if (local || demo) {
    document.documentElement.dataset.accessMode = demo ? 'demo' : 'local';
    return;
  }

  let authenticated = false;
  try {
    const response = await fetch(apiUrl('/api/session'), {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    if (response.ok) {
      const session = await response.json();
      authenticated = session?.authenticated === true;
    }
  } catch { /* Fail closed. */ }
  if (authenticated) {
    document.documentElement.dataset.accessMode = 'authenticated';
    return;
  }

  // The site is public: an unauthenticated visitor lands straight in the
  // free lane. Paid capability stays gated where it always was - at export
  // authorization and entitlements - never at the front door.
  document.documentElement.dataset.accessMode = 'demo';
}

await enforceAccessBoundary();

const select = document.querySelector('#studioServiceSelect');
if (select) {
  const here = location.pathname.toLowerCase();
  select.value = here.endsWith('/voice.html') || here.endsWith('/voice') ? 'voice' : 'review';
  select.addEventListener('change', () => {
    const query = location.search || '';
    const hash = location.hash || '';
    const target = select.value === 'voice' ? `voice.html${query}${hash}` : `index.html${query}${hash}`;
    location.href = target;
  });
}

await import('./privacy.js');
