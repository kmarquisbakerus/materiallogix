import { apiUrl } from './api-root.js';
import { downloadBlob } from './download.js';

const API = apiUrl('/api/privacy/preferences');
const DIAGNOSTIC_API = apiUrl('/api/diagnostics/event');
const PRIVACY_EXPORT_API = apiUrl('/api/privacy/export');
const PRIVACY_REQUEST_API = apiUrl('/api/privacy/request');
const APP_VERSION = '0.1.0';

const PROFILE_FIELDS = [
  ['broadRegion', 'Broad region', [
    ['us_northeast', 'United States — Northeast'], ['us_midwest', 'United States — Midwest'],
    ['us_south', 'United States — South'], ['us_west', 'United States — West'],
    ['canada', 'Canada'], ['latin_america_caribbean', 'Latin America / Caribbean'],
    ['europe', 'Europe'], ['africa_middle_east', 'Africa / Middle East'],
    ['asia_pacific', 'Asia / Pacific'], ['prefer_not_to_say', 'Prefer not to say']
  ]],
  ['professionalRole', 'Professional role', [
    ['creator', 'Creator'], ['photographer', 'Photographer'], ['video_editor', 'Video editor'],
    ['voice_audio', 'Voice / audio professional'], ['designer', 'Designer'],
    ['marketing_brand', 'Marketing / brand'], ['agency_studio', 'Agency / studio'],
    ['business_owner', 'Business owner'], ['educator_student', 'Educator / student'],
    ['other', 'Other'], ['prefer_not_to_say', 'Prefer not to say']
  ]],
  ['industry', 'Industry', [
    ['creative_media', 'Creative / media'], ['fashion_beauty', 'Fashion / beauty'],
    ['retail_ecommerce', 'Retail / ecommerce'], ['entertainment', 'Entertainment'],
    ['marketing_advertising', 'Marketing / advertising'], ['education', 'Education'],
    ['nonprofit_public', 'Nonprofit / public sector'], ['technology', 'Technology'],
    ['professional_services', 'Professional services'], ['other', 'Other'],
    ['prefer_not_to_say', 'Prefer not to say']
  ]],
  ['organizationSize', 'Organization size', [
    ['solo', 'Just me'], ['2_10', '2–10 people'], ['11_50', '11–50 people'],
    ['51_250', '51–250 people'], ['251_plus', '251+ people'],
    ['prefer_not_to_say', 'Prefer not to say']
  ]],
  ['primaryUse', 'Primary use', [
    ['photo', 'Photo'], ['video', 'Video'], ['voice', 'Voice'], ['campaigns', 'Complete campaigns'],
    ['client_review', 'Client review / approval'], ['mixed', 'A mix of everything'],
    ['other', 'Other'], ['prefer_not_to_say', 'Prefer not to say']
  ]],
  ['experienceLevel', 'Creative experience', [
    ['new', 'New'], ['growing', 'Growing'], ['experienced', 'Experienced'],
    ['expert', 'Expert'], ['prefer_not_to_say', 'Prefer not to say']
  ]]
];

const make = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'className') node.className = value;
    else if (key === 'textContent') node.textContent = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child != null) node.append(child.nodeType ? child : document.createTextNode(String(child)));
  return node;
};

function osFamily() {
  const platform = `${navigator.userAgentData?.platform || navigator.platform || ''} ${navigator.userAgent || ''}`.toLowerCase();
  if (platform.includes('win')) return 'windows';
  if (platform.includes('mac')) return 'macos';
  if (platform.includes('linux') || platform.includes('android')) return 'linux';
  return 'other';
}

async function requestPreferences(method = 'GET', body) {
  const response = await fetch(API, {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'privacy_unavailable');
  return response.json();
}

async function privacyAccountRequest(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'privacy_request_unavailable');
  return response.json();
}

export async function reportDiagnostic(event) {
  if (document.documentElement.dataset.accessMode !== 'authenticated') return false;
  try {
    const response = await fetch(DIAGNOSTIC_API, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify({
        eventName: event.eventName,
        product: event.product || 'studio',
        resultStatus: event.resultStatus || null,
        appVersion: APP_VERSION,
        osFamily: osFamily(),
        processor: event.processor || 'unknown',
        durationBucket: event.durationBucket || 'unknown',
        inputSizeBucket: event.inputSizeBucket || 'unknown',
        errorCode: event.errorCode || null
      })
    });
    return response.ok;
  } catch {
    return false;
  }
}

function choiceRow(id, title, copy) {
  const input = make('input', { id, type: 'checkbox' });
  const label = make('label', { className: 'privacy-choice', htmlFor: id },
    input,
    make('span', {}, make('b', { textContent: title }), make('small', { textContent: copy }))
  );
  return { input, label };
}

function profileControl(key, label, options) {
  const select = make('select', { id: `privacy-${key}`, ariaLabel: label },
    make('option', { value: '', textContent: 'Not answered' }),
    ...options.map(([value, textContent]) => make('option', { value, textContent }))
  );
  return { key, select, row: make('label', { className: 'privacy-profile-field' }, make('span', { textContent: label }), select) };
}

function installPrivacyDialog(initial) {
  const existing = document.querySelector('#materiallogixPrivacy');
  if (existing) existing.remove();

  const diagnostics = choiceRow(
    'privacyDiagnostics',
    'Share optional product diagnostics',
    'Technical result only: product area, app version, broad OS and processor lane, duration/size buckets, and a controlled error code. Never media, prompts, scripts, filenames, project names, voice recordings, or exact hardware identifiers.'
  );
  const research = choiceRow(
    'privacyResearch',
    'Join product research',
    'Share the optional broad profile below so we can understand which workflows and audiences need improvement.'
  );
  const commercial = choiceRow(
    'privacyCommercial',
    'Allow grouped commercial insights',
    'MaterialLogix may include data you chose to share in grouped, de-identified market trends that may be sold or licensed. We do not sell personal information, account-level records, or raw diagnostic events.'
  );
  const profileControls = PROFILE_FIELDS.map(args => profileControl(...args));
  const profile = make('div', { className: 'privacy-profile' },
    make('p', { className: 'privacy-section-title', textContent: 'Optional product-research profile' }),
    make('p', { className: 'hint', textContent: 'No exact age, address, precise location, race, ethnicity, religion, health, disability, sexual orientation, financial details, or biometric information is requested.' }),
    make('div', { className: 'privacy-profile-grid' }, ...profileControls.map(item => item.row))
  );
  const status = make('p', { className: 'privacy-status', role: 'status', ariaLive: 'polite' });
  const gpcNote = make('div', {
    className: 'privacy-gpc',
    hidden: !initial.globalPrivacyControl,
    textContent: 'Your browser sent Global Privacy Control. Grouped commercial-insights permission is off and cannot be enabled while that signal is active.'
  });
  const dialog = make('dialog', { id: 'materiallogixPrivacy', className: 'privacy-dialog' },
    make('form', { method: 'dialog' },
      make('header', {},
        make('div', { className: 'eyebrow', textContent: initial.configured ? 'Privacy choices' : 'One quick choice' }),
        make('h2', { textContent: 'Your work stays yours.' }),
        make('p', { textContent: 'Your account works whether you share optional information or not. Every optional choice starts off.' })
      ),
      make('div', { className: 'privacy-body' },
        make('section', { className: 'privacy-required' },
          make('p', { className: 'privacy-section-title', textContent: 'Required to run your account' }),
          make('p', { textContent: 'We keep account authentication, license and billing records, activated-device status, security events, and cloud-job usage needed to deliver and charge for the service. Local media and project files are not included.' })
        ),
        diagnostics.label,
        research.label,
        commercial.label,
        gpcNote,
        profile,
        make('p', { className: 'privacy-fine' },
          'Change or withdraw these choices any time. Turning diagnostics off deletes the account-linked raw diagnostic history we can locate. ',
          make('a', { href: 'https://materiallogix.com/legal/privacy.html', target: '_blank', rel: 'noopener', textContent: 'Read the privacy policy' }),
          '.'
        ),
        status
      ),
      make('footer', {},
        ...(initial.configured ? [
          make('button', { className: 'btn', type: 'button', id: 'privacyExport', textContent: 'Download my data' }),
          make('button', { className: 'btn', type: 'button', id: 'privacyDelete', textContent: 'Request deletion' })
        ] : []),
        make('button', { className: 'btn', type: 'button', id: 'privacyRequiredOnly', textContent: 'Use required data only' }),
        make('span', { className: 'spacer' }),
        ...(initial.configured ? [make('button', { className: 'btn', type: 'button', id: 'privacyCancel', textContent: 'Cancel' })] : []),
        make('button', { className: 'btn primary', type: 'button', id: 'privacySave', textContent: 'Save choices' })
      )
    )
  );
  document.body.append(dialog);

  diagnostics.input.checked = !!initial.optionalDiagnostics;
  research.input.checked = !!initial.productResearch;
  commercial.input.checked = !!initial.commercialInsights;
  commercial.input.disabled = !!initial.globalPrivacyControl;
  for (const { key, select } of profileControls) select.value = initial.profile?.[key] || '';

  const sync = () => {
    profile.hidden = !research.input.checked;
    const hasSharedSource = diagnostics.input.checked || research.input.checked;
    commercial.input.disabled = !!initial.globalPrivacyControl || !hasSharedSource;
    if (!hasSharedSource || initial.globalPrivacyControl) commercial.input.checked = false;
  };
  diagnostics.input.addEventListener('change', sync);
  research.input.addEventListener('change', sync);
  sync();

  async function save(requiredOnly = false) {
    status.textContent = 'Saving…';
    dialog.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try {
      const saved = await requestPreferences('POST', {
        optionalDiagnostics: requiredOnly ? false : diagnostics.input.checked,
        productResearch: requiredOnly ? false : research.input.checked,
        commercialInsights: requiredOnly ? false : commercial.input.checked,
        source: initial.configured ? 'settings' : 'signup',
        profile: Object.fromEntries(profileControls.map(({ key, select }) => [key, requiredOnly ? null : select.value || null]))
      });
      status.textContent = 'Saved. Thank you.';
      setTimeout(() => dialog.close(), 350);
      if (saved.optionalDiagnostics) {
        reportDiagnostic({ eventName: 'app_started', product: location.pathname.toLowerCase().includes('voice') ? 'voice' : 'studio', resultStatus: 'success' });
      }
    } catch {
      status.textContent = 'We could not save this choice. Nothing optional was enabled. Try again.';
      dialog.querySelectorAll('button').forEach(button => { button.disabled = false; });
    }
  }

  dialog.querySelector('#privacyRequiredOnly').onclick = () => save(true);
  dialog.querySelector('#privacySave').onclick = () => save(false);
  const cancel = dialog.querySelector('#privacyCancel');
  if (cancel) cancel.onclick = () => dialog.close();
  const exportButton = dialog.querySelector('#privacyExport');
  if (exportButton) exportButton.onclick = async () => {
    status.textContent = 'Preparing your account data…';
    exportButton.disabled = true;
    try {
      const accountData = await privacyAccountRequest(PRIVACY_EXPORT_API);
      downloadBlob(new Blob([JSON.stringify(accountData, null, 2)], { type: 'application/json' }),
        `materiallogix-account-data-${new Date().toISOString().slice(0, 10)}.json`);
      status.textContent = 'Your account data download is ready.';
    } catch {
      status.textContent = 'We could not prepare your account data. Try again.';
    } finally {
      exportButton.disabled = false;
    }
  };
  const deletionButton = dialog.querySelector('#privacyDelete');
  if (deletionButton) deletionButton.onclick = async () => {
    const confirmed = window.confirm('Request deletion of your MaterialLogix account? Optional diagnostics and profile data will be removed now. Billing, licensing, fraud-prevention, and security records may be retained when legally required.');
    if (!confirmed) return;
    status.textContent = 'Submitting your deletion request…';
    deletionButton.disabled = true;
    try {
      await privacyAccountRequest(PRIVACY_REQUEST_API, 'POST', { requestType: 'deletion', confirm: true });
      status.textContent = 'Deletion request received. Optional diagnostics and profile data have been withdrawn.';
    } catch {
      status.textContent = 'We could not submit the deletion request. Try again.';
      deletionButton.disabled = false;
    }
  };
  return dialog;
}

async function initializePrivacy() {
  if (document.documentElement.dataset.accessMode !== 'authenticated') return;
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;
  const button = make('button', { className: 'btn sm privacy-button', type: 'button', textContent: 'Privacy', ariaLabel: 'Privacy and diagnostic sharing choices' });
  const primary = topbar.querySelector('.primary');
  const reviewLink = [...topbar.querySelectorAll('a')].find(link => link.textContent.trim() === 'Review app');
  topbar.insertBefore(button, primary || reviewLink || null);
  let preferences;
  try {
    preferences = await requestPreferences();
  } catch {
    button.disabled = true;
    button.title = 'Privacy controls are temporarily unavailable; no optional sharing is active.';
    return;
  }
  const open = async () => {
    try { preferences = await requestPreferences(); } catch { /* Keep the last safe state. */ }
    installPrivacyDialog(preferences).showModal();
  };
  button.onclick = open;
  if (!preferences.configured || !preferences.current) setTimeout(open, 250);
  if (preferences.optionalDiagnostics && preferences.current) {
    const sessionKey = 'materiallogix:diagnostic-app-started';
    if (!sessionStorage.getItem(sessionKey)) {
      sessionStorage.setItem(sessionKey, '1');
      reportDiagnostic({ eventName: 'app_started', product: location.pathname.toLowerCase().includes('voice') ? 'voice' : 'studio', resultStatus: 'success' });
    }
    addEventListener('error', () => reportDiagnostic({ eventName: 'crash_reported', product: 'studio', resultStatus: 'failed', errorCode: 'uncaught_error' }), { once: true });
    addEventListener('unhandledrejection', () => reportDiagnostic({ eventName: 'crash_reported', product: 'studio', resultStatus: 'failed', errorCode: 'unhandled_rejection' }), { once: true });
  }
}

initializePrivacy();
