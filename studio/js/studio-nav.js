// Shared navigation and fail-closed production access boundary. Authentication
// decisions belong to the same-origin server/edge, never downloadable JavaScript.

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
    const response = await fetch('/api/session', {
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

  const style = document.createElement('style');
  style.textContent = `
    #mlPreviewGate{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:radial-gradient(900px 500px at 50% -10%,rgba(201,168,106,.12),transparent 62%),rgba(6,6,7,.94);backdrop-filter:blur(28px) saturate(1.18);-webkit-backdrop-filter:blur(28px) saturate(1.18);font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#eeebe4}
    #mlPreviewGate .gate-card{width:min(430px,100%);padding:34px;border:1px solid rgba(255,255,255,.09);border-radius:20px;background:rgba(20,20,22,.76);box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 28px 90px rgba(0,0,0,.55);backdrop-filter:blur(24px) saturate(1.25);-webkit-backdrop-filter:blur(24px) saturate(1.25)}
    #mlPreviewGate .eyebrow{margin-bottom:10px;font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:#8a7444}
    #mlPreviewGate h1{margin:0 0 8px;font:300 30px/1.08 Fraunces,Georgia,serif;letter-spacing:-.02em}
    #mlPreviewGate p{margin:0 0 22px;color:#8b857c;font-size:13px;line-height:1.55}
    #mlPreviewGate a{display:block;margin-top:18px;padding:12px 14px;border:1px solid rgba(255,255,255,.25);border-radius:11px;background:linear-gradient(180deg,#d8b878,#c9a86a 55%,#b8955a);color:#16120a;font:500 14px/1 Inter,sans-serif;text-align:center;text-decoration:none}
  `;
  document.head.append(style);

  const gate = document.createElement('div');
  gate.id = 'mlPreviewGate';
  gate.innerHTML = `<div class="gate-card"><div class="eyebrow">Sign in to continue</div><h1>Choose your Studio.</h1><p>Secure sign-in is available on the published product. This public preview does not collect sign-in details; use it to choose Photo, Video, or Voice.</p><a href="${new URL('./?demo=1', location.href).href}">View Free Preview</a></div>`;
  document.body.append(gate);

  const app = document.querySelector('#app');
  if (app) app.setAttribute('aria-hidden', 'true');

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
