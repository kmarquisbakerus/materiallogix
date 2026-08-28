import { activeLicense, covers } from './license.js';
import { newProject } from './model.js';
import { listProjects, saveProject } from './store.js';

const PRODUCTS = [
  {
    id: 'photo',
    number: '01',
    title: 'Photo',
    kicker: 'Shape the image',
    copy: 'Create and refine still images with control over light, color, people, and detail.',
    image: 'studio-entry-photo.webp',
    position: 'center center',
    starters: [
      { id: 'portrait-finish', label: 'Portrait finish', goal: 'Finish and deliver a polished portrait.', surfaces: ['ig-feed-portrait', 'web-hero-mobile'], qaPreset: 'human' },
      { id: 'product-launch', label: 'Product launch', goal: 'Build a complete product launch image set.', surfaces: ['web-hero-desktop', 'web-hero-mobile', 'ig-feed-portrait', 'meta-feed'], qaPreset: 'product' },
      { id: 'social-campaign', label: 'Social campaign', goal: 'Create a coordinated social campaign.', surfaces: ['ig-feed-portrait', 'ig-reels', 'tiktok-feed', 'meta-feed', 'meta-story'], qaPreset: 'human' }
    ]
  },
  {
    id: 'video',
    number: '02',
    title: 'Video',
    kicker: 'Build the story',
    copy: 'Cut, refine, caption, scale, and deliver with the Material Logic Motion Engine.',
    image: 'studio-entry-video.webp',
    position: 'center center',
    starters: [
      { id: 'short-form-edit', label: 'Short-form edit', goal: 'Cut and finish a vertical short.', surfaces: ['ig-reels', 'tiktok-feed', 'meta-story'], qaPreset: 'video' },
      { id: 'campaign-cut', label: 'Campaign cut', goal: 'Build a polished campaign video.', surfaces: ['web-hero-desktop', 'ig-reels', 'meta-feed'], qaPreset: 'video' },
      { id: 'podcast-clips', label: 'Podcast clips', goal: 'Turn a conversation into shareable clips.', surfaces: ['ig-reels', 'tiktok-feed', 'meta-story'], qaPreset: 'video' }
    ]
  },
  {
    id: 'voice',
    number: '03',
    title: 'Voice',
    kicker: 'Direct the performance',
    copy: 'Shape a read with presence, pace, and personality.',
    image: 'studio-entry-voice.webp',
    position: 'center center',
    starters: [
      { id: 'voiceover', label: 'Voiceover', goal: 'Direct and finish a polished voiceover.', surfaces: [], qaPreset: 'human' },
      { id: 'podcast-read', label: 'Podcast read', goal: 'Create a natural podcast read.', surfaces: [], qaPreset: 'human' },
      { id: 'social-narration', label: 'Social narration', goal: 'Create concise narration for social video.', surfaces: ['ig-reels', 'tiktok-feed', 'meta-story'], qaPreset: 'human' }
    ]
  }
];

export const STUDIO_STARTERS = Object.freeze(Object.fromEntries(
  PRODUCTS.map(product => [product.id, product.starters.map(starter => ({ ...starter }))])
));

const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

export function entranceAccess(license, accessMode = 'local') {
  const plan = String(license?.plan || 'preview');
  const suspended = plan.startsWith('suspended:');
  const states = Object.fromEntries(PRODUCTS.map(({ id }) => {
    if (suspended) return [id, 'suspended'];
    if (!license) return [id, 'preview'];
    return [id, covers(license, id) ? 'included' : 'locked'];
  }));
  const selected = license?.selected_product || license?.selectedProduct || null;
  const label = suspended ? 'Reconnect your account'
    : plan === 'full' ? 'Full Studio'
      : plan === 'single' ? `${selected ? selected[0].toUpperCase() + selected.slice(1) : 'Single'} Studio`
        : plan === 'voice_starter' ? 'Voice Starter'
          : plan === 'payg' ? 'Pay per export'
            : accessMode === 'demo' ? 'Free Preview' : 'Studio Preview';
  const message = suspended
    ? 'Reconnect once to restore the products on your plan.'
    : plan === 'full' || plan === 'payg'
      ? 'Photo, Video, and Voice are ready when you are.'
      : plan === 'single' || plan === 'voice_starter'
        ? 'Your Studio is ready. Other products stay in view for whenever you want more.'
        : 'Explore every Studio. A plan unlocks clean delivery.';
  return { plan, label, message, states };
}

function stateCopy(state, product) {
  if (state === 'included') return { badge: 'Included in your plan', action: `Open ${product.title} Studio` };
  if (state === 'preview') return { badge: 'Free Preview', action: `Preview ${product.title} Studio` };
  if (state === 'suspended') return { badge: 'Reconnect account', action: 'Restore access' };
  return { badge: 'Not in your plan', action: 'See upgrade options' };
}

export function starterProjectSpec(productId, starterId) {
  const product = PRODUCTS.find(item => item.id === productId);
  const starter = product?.starters.find(item => item.id === starterId);
  if (!product || !starter) throw new Error('Unknown Studio starter.');
  return {
    name: starter.label,
    product: product.id,
    starterId: starter.id,
    brief: { campaignGoal: starter.goal },
    surfaces: [...starter.surfaces],
    qaPreset: starter.qaPreset
  };
}

export function makeStarterProject(productId, starterId) {
  const spec = starterProjectSpec(productId, starterId);
  const project = newProject(spec.name);
  project.brief.campaignGoal = spec.brief.campaignGoal;
  project.surfaces = spec.surfaces;
  project.qaPreset = spec.qaPreset;
  project.starter = {
    product: spec.product,
    id: spec.starterId,
    label: spec.name,
    version: 1
  };
  return project;
}

export function entranceLinks(pathname, href) {
  const hostedStudio = /\/studio(?:\/|$)/.test(pathname);
  return {
    pricing: new URL(hostedStudio ? '../#pricing' : 'site/index.html#pricing', href).href,
    mediaBase: new URL(hostedStudio ? '../media/' : 'site/media/', href).href
  };
}

function currentEntranceLinks() {
  return entranceLinks(location.pathname, location.href);
}

function pricingUrl() {
  return currentEntranceLinks().pricing;
}

function preserveDemo(path) {
  const target = new URL(path, location.href);
  if (new URLSearchParams(location.search).get('demo') === '1') target.searchParams.set('demo', '1');
  return target.href;
}

function workspaceUrl() {
  const target = new URL(location.href);
  target.hash = 'workspace';
  target.searchParams.delete('entry');
  return target.href;
}

function openProject(projectId, product = 'photo') {
  localStorage.setItem('cros:project', projectId);
  if (product === 'voice') {
    const target = new URL(preserveDemo('voice.html'));
    target.searchParams.set('project', projectId);
    location.assign(target.href);
    return;
  }
  history.replaceState(null, '', workspaceUrl());
  location.reload();
}

async function createStarter(product, starter) {
  const project = makeStarterProject(product.id, starter.id);
  await saveProject(project);
  openProject(project.id, product.id);
}

function enterWorkspace(kind) {
  closeEntrance({ focus: false });
  history.replaceState(null, '', `${location.pathname}${location.search}#workspace`);
  if (kind === 'voice') {
    location.assign(preserveDemo('voice.html'));
    return;
  }
  if (kind === 'video') {
    const input = document.querySelector('#fileInput');
    if (input) {
      const previous = input.accept;
      input.accept = 'video/*';
      input.addEventListener('cancel', () => { input.accept = previous; }, { once: true });
      input.addEventListener('change', () => { input.accept = previous; }, { once: true });
      input.click();
    }
    return;
  }
  const menu = document.querySelector('#menuBtn');
  const openCreate = () => {
    if (menu && menu.getAttribute('aria-expanded') !== 'true') menu.click();
  };
  openCreate();
  // The workspace may finish one last responsive render as the inert entrance
  // closes. Re-check once so that render cannot swallow the requested start.
  setTimeout(openCreate, 80);
}

function actionFor(product, state) {
  if (state === 'locked' || state === 'suspended') {
    if (state === 'suspended') {
      return () => {
        closeEntrance({ focus: false });
        const menu = document.querySelector('#menuBtn');
        if (menu && menu.getAttribute('aria-expanded') !== 'true') menu.click();
      };
    }
    return () => location.assign(pricingUrl());
  }
  return () => enterWorkspace(product.id);
}

function starterList(product, state) {
  const wrap = make('div', 'studio-entry-card__starters');
  const label = state === 'locked' ? 'Available with this Studio'
    : state === 'suspended' ? 'Available after reconnecting' : 'Start with';
  wrap.append(make('p', 'studio-entry-card__starter-label', label));
  const list = make('div', 'studio-entry-card__starter-list');
  for (const starter of product.starters) {
    const button = make('button', 'studio-entry-card__starter', starter.label);
    button.type = 'button';
    button.dataset.starter = starter.id;
    button.setAttribute('aria-label', `${starter.label} in ${product.title} Studio`);
    if (state === 'locked' || state === 'suspended') {
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
    } else {
      button.addEventListener('click', () => createStarter(product, starter));
    }
    list.append(button);
  }
  wrap.append(list);
  return wrap;
}

function productCard(product, state) {
  const words = stateCopy(state, product);
  const card = make('article', `studio-entry-card is-${state}`);
  card.dataset.product = product.id;
  card.style.setProperty('--entry-image', `url("${new URL(product.image, currentEntranceLinks().mediaBase).href}")`);
  card.style.setProperty('--entry-position', product.position);

  const media = make('div', 'studio-entry-card__media');
  media.setAttribute('role', 'img');
  media.setAttribute('aria-label', `${product.title} creator at work`);
  const wash = make('div', 'studio-entry-card__wash');
  const content = make('div', 'studio-entry-card__content');
  const top = make('div', 'studio-entry-card__top');
  top.append(make('span', 'studio-entry-card__number', product.number), make('span', 'studio-entry-card__badge', words.badge));
  const kicker = make('p', 'studio-entry-card__kicker', product.kicker);
  const title = make('h2', '', product.title);
  const copy = make('p', 'studio-entry-card__copy', product.copy);
  const button = make('button', 'studio-entry-card__action', words.action);
  button.type = 'button';
  button.setAttribute('aria-label', words.action.includes(product.title) ? words.action : `${words.action}: ${product.title}`);
  button.addEventListener('click', actionFor(product, state));
  content.append(top, kicker, title, copy, starterList(product, state), button);
  card.append(media, wash, content);
  return card;
}

async function recentProjects() {
  try {
    return (await listProjects()).slice(0, 3);
  } catch {
    return [];
  }
}

let lastFocus = null;

export function closeEntrance({ focus = true } = {}) {
  const entry = document.querySelector('#studioEntry');
  if (!entry) return;
  entry.remove();
  const app = document.querySelector('#app');
  if (app) {
    app.inert = false;
    app.removeAttribute('aria-hidden');
  }
  document.documentElement.classList.remove('studio-entry-open');
  if (focus) (lastFocus || document.querySelector('#menuBtn'))?.focus();
}

export async function openEntrance() {
  if (document.querySelector('#studioEntry')) return;
  lastFocus = document.activeElement;
  const app = document.querySelector('#app');
  if (app) {
    app.inert = true;
    app.setAttribute('aria-hidden', 'true');
  }

  const license = globalThis.lic || await activeLicense();
  const access = entranceAccess(license, document.documentElement.dataset.accessMode || 'local');
  const entry = make('section', 'studio-entry');
  entry.id = 'studioEntry';
  entry.setAttribute('aria-labelledby', 'studioEntryTitle');
  entry.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeEntrance();
  });

  const head = make('header', 'studio-entry__head');
  const brand = make('div', 'studio-entry__brand');
  brand.innerHTML = '<span>Material</span><em>Logix</em><small>Studio</small>';
  const plan = make('span', 'studio-entry__plan', access.label);
  head.append(brand, plan);

  const intro = make('div', 'studio-entry__intro');
  intro.append(make('p', 'studio-entry__eyebrow', 'Start a project'));
  const title = make('h1', '', 'Make something worth sharing.');
  title.id = 'studioEntryTitle';
  intro.append(title, make('p', 'studio-entry__message', access.message));

  const products = make('div', 'studio-entry__products');
  products.setAttribute('aria-label', 'Choose Photo, Video, or Voice');
  products.append(...PRODUCTS.map(product => productCard(product, access.states[product.id])));

  const footer = make('footer', 'studio-entry__footer');
  const recents = make('div', 'studio-entry__recent');
  const existing = await recentProjects();
  if (existing.length) {
    recents.append(make('span', '', 'Recent'));
    for (const project of existing) {
      const button = make('button', '', project.name);
      button.type = 'button';
      button.addEventListener('click', () => openProject(project.id, project.starter?.product || 'photo'));
      recents.append(button);
    }
  } else {
    recents.append(make('span', '', 'Choose a starting point. Your work stays editable.'));
  }
  footer.append(recents);
  const continueButton = make('button', 'studio-entry__continue', 'Continue to workspace');
  continueButton.type = 'button';
  continueButton.addEventListener('click', () => closeEntrance());
  footer.append(continueButton);

  entry.append(head, intro, products, footer);
  document.body.append(entry);
  document.documentElement.classList.add('studio-entry-open');
  requestAnimationFrame(() => entry.querySelector('.studio-entry-card__starter:not(:disabled), .studio-entry-card__action')?.focus({ preventScroll: true }));
}

if (typeof document !== 'undefined') {
  document.querySelector('.topbar .brand')?.addEventListener('click', event => {
    event.preventDefault();
    history.replaceState(null, '', `${location.pathname}${location.search}#studio-entry`);
    openEntrance();
  });

  addEventListener('hashchange', () => {
    if (location.hash === '#studio-entry') openEntrance();
  });

  if (location.hash !== '#workspace' && new URLSearchParams(location.search).get('entry') !== '0') {
    openEntrance();
  }
}
