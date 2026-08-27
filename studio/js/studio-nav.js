// Shared MaterialLogix Studio product navigation and temporary preview gate.
// This gate is intentionally lightweight preview access, not production auth.

const PREVIEW_USER = 'admin';
const PREVIEW_PASS = 'ABCD09876';
const PREVIEW_KEY = 'materiallogix:preview-unlocked';

function installPreviewGate() {
  if (sessionStorage.getItem(PREVIEW_KEY) === '1') return;

  const style = document.createElement('style');
  style.textContent = `
    #mlPreviewGate{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:radial-gradient(900px 500px at 50% -10%,rgba(201,168,106,.12),transparent 62%),rgba(6,6,7,.94);backdrop-filter:blur(28px) saturate(1.18);-webkit-backdrop-filter:blur(28px) saturate(1.18);font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#eeebe4}
    #mlPreviewGate .gate-card{width:min(430px,100%);padding:34px;border:1px solid rgba(255,255,255,.09);border-radius:20px;background:rgba(20,20,22,.76);box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 28px 90px rgba(0,0,0,.55);backdrop-filter:blur(24px) saturate(1.25);-webkit-backdrop-filter:blur(24px) saturate(1.25)}
    #mlPreviewGate .eyebrow{margin-bottom:10px;font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:#8a7444}
    #mlPreviewGate h1{margin:0 0 8px;font:300 30px/1.08 Fraunces,Georgia,serif;letter-spacing:-.02em}
    #mlPreviewGate p{margin:0 0 22px;color:#8b857c;font-size:13px;line-height:1.55}
    #mlPreviewGate label{display:block;margin:12px 0 5px;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#8b857c}
    #mlPreviewGate input{width:100%;padding:12px 13px;border:1px solid rgba(255,255,255,.09);border-radius:11px;background:rgba(255,255,255,.035);color:#eeebe4;outline:none;font:400 14px/1.2 Inter,sans-serif}
    #mlPreviewGate input:focus{border-color:rgba(201,168,106,.65);box-shadow:0 0 0 3px rgba(201,168,106,.08)}
    #mlPreviewGate button{width:100%;margin-top:18px;padding:12px 14px;border:1px solid rgba(255,255,255,.25);border-radius:11px;background:linear-gradient(180deg,#d8b878,#c9a86a 55%,#b8955a);color:#16120a;font:500 14px/1 Inter,sans-serif;cursor:pointer}
    #mlPreviewGate .err{min-height:18px;margin:10px 0 0;color:#d38a83;font-size:12px}
  `;
  document.head.append(style);

  const gate = document.createElement('div');
  gate.id = 'mlPreviewGate';
  gate.innerHTML = `<form class="gate-card" autocomplete="off"><div class="eyebrow">Private preview</div><h1>MaterialLogix Studio</h1><p>Enter the preview credentials to open the current Studio build.</p><label for="mlPreviewUser">Username</label><input id="mlPreviewUser" name="username" autocomplete="username" autofocus><label for="mlPreviewPass">Password</label><input id="mlPreviewPass" name="password" type="password" autocomplete="current-password"><button type="submit">Open Studio</button><div class="err" role="alert" aria-live="polite"></div></form>`;
  document.body.append(gate);

  const app = document.querySelector('#app');
  if (app) app.setAttribute('aria-hidden', 'true');

  gate.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    const user = gate.querySelector('#mlPreviewUser').value;
    const pass = gate.querySelector('#mlPreviewPass').value;
    if (user === PREVIEW_USER && pass === PREVIEW_PASS) {
      sessionStorage.setItem(PREVIEW_KEY, '1');
      if (app) app.removeAttribute('aria-hidden');
      gate.remove();
      style.remove();
      return;
    }
    gate.querySelector('.err').textContent = 'Incorrect username or password.';
    gate.querySelector('#mlPreviewPass').value = '';
    gate.querySelector('#mlPreviewPass').focus();
  });
}

installPreviewGate();

const select = document.querySelector('#studioServiceSelect');
if (select) {
  const host = location.hostname.toLowerCase();
  const here = location.pathname.toLowerCase();
  const familyHost = host.endsWith('.materiallogix.com');
  select.value = host === 'voice.materiallogix.com' || here.endsWith('/voice.html') || here.endsWith('/voice') ? 'voice' : 'review';

  select.addEventListener('change', () => {
    const query = location.search || '';
    const hash = location.hash || '';
    if (familyHost) {
      location.href = (select.value === 'voice' ? 'https://voice.materiallogix.com' : 'https://studio.materiallogix.com') + query + hash;
      return;
    }
    location.href = select.value === 'voice' ? `voice.html${query}${hash}` : `index.html${query}${hash}`;
  });
}
