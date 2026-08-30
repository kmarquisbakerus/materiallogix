// Shared navigation and fail-closed production access boundary. Authentication
// decisions belong to the same-origin server/edge, never downloadable JavaScript.

import { apiUrl } from './api-root.js';
import { APP_VERSION, MINIMUM_COMPATIBLE, versionBehind } from './app-version.js';

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

// Installed copies check the live stamp once per boot. The hosted app is
// always current, so it skips.
async function checkForUpdates() {
  if (location.hostname === 'materiallogix.com') return;
  let stamp;
  try {
    const response = await fetch('https://materiallogix.com/studio/version.json', {
      cache: 'no-store', signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) return;
    stamp = await response.json();
  } catch { return; }
  // A fetched value never reaches innerHTML: only strict semver is trusted,
  // and the bar is built from text nodes.
  const semver = /^\d+\.\d+\.\d+$/;
  if (!semver.test(stamp?.version || '') || !versionBehind(APP_VERSION, stamp.version)) return;
  const blocking = semver.test(stamp?.minimum || '') && versionBehind(APP_VERSION, stamp.minimum);
  const bar = document.createElement('div');
  bar.id = 'mlUpdateBar';
  bar.setAttribute('role', blocking ? 'alertdialog' : 'status');
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;gap:14px;align-items:center;justify-content:center;padding:12px 18px;background:#171512;color:#f4efe4;border-top:1px solid #d6b26e;font:500 13px/1.4 Inter,sans-serif';
  const message = document.createElement('span');
  message.textContent = blocking
    ? 'This copy is too old to work correctly. Update to continue.'
    : `A newer Studio (${stamp.version}) is available.`;
  const link = document.createElement('a');
  link.href = 'https://materiallogix.com/#access';
  link.textContent = 'Get the update';
  link.style.cssText = 'color:#171512;background:#d6b26e;padding:7px 14px;border-radius:9px;text-decoration:none;font-weight:600';
  bar.append(message, link);
  if (!blocking) {
    const later = document.createElement('button');
    later.textContent = 'Later';
    later.style.cssText = 'background:none;border:1px solid #4a4438;color:#a69c86;padding:7px 12px;border-radius:9px;cursor:pointer';
    later.onclick = () => bar.remove();
    bar.append(later);
  } else {
    document.querySelector('#app')?.setAttribute('inert', '');
  }
  document.body.append(bar);
}
checkForUpdates();

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
