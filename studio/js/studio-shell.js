import { newAsset } from './model.js';
import * as store from './store.js';
import { log } from './history.js';

const $ = selector => document.querySelector(selector);
const SUPPORTED = /\.(png|jpe?g|webp|svg)$/i;

function make(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function toast(message, bad = false) {
  document.querySelectorAll('.toast').forEach(node => node.remove());
  const node = make('div', {
    className: 'toast' + (bad ? ' bad' : ''),
    textContent: message,
    role: 'status'
  });
  node.setAttribute('aria-live', bad ? 'assertive' : 'polite');
  document.body.append(node);
  setTimeout(() => node.remove(), bad ? 7000 : 3200);
}

function closeDialog() {
  const dialog = $('#dlg');
  if (dialog?.open) dialog.close();
}

function openBrandAssetDialog() {
  const dialog = $('#dlg');
  if (!dialog) return $('#brandAssetInput')?.click();

  $('#dlgTitle').textContent = 'Import brand assets';
  $('#dlgBody').replaceChildren(
    make('p', {},
      'Add existing logos, wordmarks, symbols, icons, seals, packaging marks, or other visual brand references.'),
    make('p', { className: 'hint' },
      'PNG, JPG, WebP, and SVG are accepted. MaterialLogix preserves the artwork you supply. It does not generate, redraw, or redesign logos.'),
    make('p', { className: 'hint' },
      'Imported files are stored in this project as reference-only Logo / mark assets and remain on this device.')
  );

  const cancel = make('button', { className: 'btn', type: 'button', textContent: 'Cancel' });
  cancel.onclick = closeDialog;
  const choose = make('button', { className: 'btn primary', type: 'button', textContent: 'Choose files' });
  choose.onclick = () => {
    closeDialog();
    $('#brandAssetInput')?.click();
  };
  $('#dlgFoot').replaceChildren(cancel, choose);
  if (!dialog.open) dialog.showModal();
}

function imageDimensions(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const done = dimensions => {
      URL.revokeObjectURL(url);
      resolve(dimensions);
    };
    image.onload = () => done({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 });
    image.onerror = () => done({ width: 0, height: 0 });
    image.src = url;
  });
}

async function activeProjectId() {
  let projectId = localStorage.getItem('cros:project');
  if (projectId) return projectId;
  for (let attempt = 0; attempt < 20 && !projectId; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50));
    projectId = localStorage.getItem('cros:project');
  }
  return projectId;
}

async function importBrandAssets(fileList) {
  const files = [...fileList].filter(file =>
    (file.type.startsWith('image/') || SUPPORTED.test(file.name)) &&
    (SUPPORTED.test(file.name) || /^(image\/png|image\/jpeg|image\/webp|image\/svg\+xml)$/.test(file.type))
  );
  if (!files.length) {
    toast('Choose PNG, JPG, WebP, or SVG brand artwork.', true);
    return;
  }

  const projectId = await activeProjectId();
  if (!projectId) {
    toast('Open or create a project before importing brand assets.', true);
    return;
  }

  const reviewer = localStorage.getItem('cros:reviewer') || 'owner';
  try {
    for (const file of files) {
      const asset = newAsset(projectId, file);
      asset.role = 'logo';
      asset.status = 'reference-only';
      asset.source = 'brand-import';
      asset.labels.lane = 'brand-assets';
      asset.notes = 'Imported brand asset. Use the supplied artwork as-is.';
      asset.provenance = 'Original brand artwork supplied by the project owner. MaterialLogix imported this file and did not generate, redraw, or redesign it.';
      Object.assign(asset, await imageDimensions(file));
      log(asset, 'imported as supplied brand artwork (no logo generation)', reviewer);
      await store.addAsset(asset, file);
    }

    const url = new URL(location.href);
    url.searchParams.set('brandImported', String(files.length));
    location.replace(url.toString());
  } catch (error) {
    toast('Brand asset import failed: ' + error.message, true);
  }
}

function applyStudioServices() {
  const sidebar = $('#sidebar');
  if (!sidebar || sidebar.querySelector('[data-studio-services]')) return;
  const secondaryTools = sidebar.querySelector('[data-secondary-tools] > .panel-body');
  if (!secondaryTools) return;

  const body = make('div', { className: 'panel-body' },
    make('p', { className: 'hint' },
      'Move between the Review and Voice services, or bring the brand artwork this project must follow.'),
    make('a', {
      className: 'btn',
      href: 'voice.html',
      textContent: 'Open Voice Studio',
      style: 'display:block;text-align:center;text-decoration:none;margin-bottom:6px'
    }),
    (() => {
      const button = make('button', {
        className: 'btn',
        type: 'button',
        textContent: 'Import brand assets',
        style: 'width:100%'
      });
      button.onclick = openBrandAssetDialog;
      return button;
    })(),
    make('p', { className: 'hint', style: 'margin:10px 0 0' },
      'Import only: existing logos, marks, and visual brand references. MaterialLogix does not generate or redesign logos.')
  );
  const services = make('details', { className: 'panel' },
    make('summary', {}, 'Studio services'), body);
  services.dataset.studioServices = 'true';
  services.setAttribute('name', 'settings-more-tools');

  const firstTool = secondaryTools.querySelector(':scope > details.panel');
  if (firstTool) secondaryTools.insertBefore(services, firstTool);
  else secondaryTools.append(services);
}

function applyPositioningCopy() {
  applyStudioServices();
  const wizard = $('.wizard');
  if (wizard && !wizard.querySelector('[data-materiallogix-promise]')) {
    const promise = make('span', {
      className: 'eyebrow',
      textContent: 'Create with freedom. Finish with confidence.'
    });
    promise.dataset.materiallogixPromise = 'true';
    wizard.prepend(promise);

    const lead = wizard.querySelector('p.lead');
    if (lead) {
      lead.textContent = 'Set the direction. Review every placement. Deliver with confidence.';
    }
  }

  const emptyHeadings = [...document.querySelectorAll('.empty h2')];
  const directionHeading = emptyHeadings.find(node => node.textContent.trim() === 'Direction set — now the assets');
  const empty = directionHeading?.parentElement;
  if (empty && !empty.querySelector('[data-brand-import-note]')) {
    const note = make('p', { className: 'note' },
      'Use Brand assets above to import existing logos and marks exactly as supplied. MaterialLogix does not generate or redesign logos.');
    note.dataset.brandImportNote = 'true';
    empty.append(note);
  }
}

const brandInput = $('#brandAssetInput');
if (brandInput) {
  brandInput.onchange = event => {
    importBrandAssets(event.target.files);
    event.target.value = '';
  };
}

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.textContent.trim() === 'Activate' || button.textContent.includes('Deactivate')) {
    setTimeout(() => globalThis.refreshMaterialLogixLicense?.(), 100);
  }
}, true);

const imported = new URL(location.href).searchParams.get('brandImported');
if (imported) {
  const url = new URL(location.href);
  url.searchParams.delete('brandImported');
  history.replaceState(null, '', url);
  setTimeout(() => toast(`Imported ${imported} supplied brand asset${imported === '1' ? '' : 's'}. No logo was generated or redesigned.`), 200);
}

const shell = $('#app');
if (shell) {
  new MutationObserver(applyPositioningCopy).observe(shell, { childList: true, subtree: true });
}
applyPositioningCopy();
