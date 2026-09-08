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

// Every copy checks the live stamp once per boot, hosted included.
//
// "The hosted app is always current" is true of a fresh load and false of the
// thing customers actually do, which is leave the Studio open. A tab opened
// before a deploy keeps its old modules while the refreshed service worker
// serves new ones to any later dynamic import, so the page ends up running two
// versions at once with nothing on screen to say so.
const HOSTED = location.hostname === 'materiallogix.com';

async function checkForUpdates() {
  let stamp;
  try {
    // Hosted, the live stamp is this origin's own; installed, it has to come
    // from the site, because the copy on disk is the thing being checked.
    const response = await fetch(HOSTED ? '/studio/version.json' : 'https://materiallogix.com/studio/version.json', {
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
    ? 'This copy is too old to work correctly. Reload to continue.'
    : `A newer Studio (${stamp.version}) is available.`;
  // Hosted, the fix is a reload of this page; installed, it is a download.
  // Offering a download link to somebody already on the site sends them
  // looking for an installer they do not need.
  const action = document.createElement(HOSTED ? 'button' : 'a');
  action.textContent = HOSTED ? 'Reload' : 'Get the update';
  action.style.cssText = 'color:#171512;background:#d6b26e;padding:7px 14px;border-radius:9px;text-decoration:none;font-weight:600;border:0;cursor:pointer;font:inherit';
  if (HOSTED) action.onclick = () => location.reload();
  else action.href = 'https://materiallogix.com/#access';
  bar.append(message, action);
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

await import('./privacy.js');
