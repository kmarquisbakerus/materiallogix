// Placement surfaces, QA checklist presets, and the status vocabulary.
// Everything the reviewer sees is driven from these tables.

export const SURFACE_GROUPS = [
  {
    id: 'website',
    label: 'Website',
    surfaces: [
      { id: 'web-hero-desktop', label: 'Hero (desktop)', w: 1920, h: 1080, note: 'Text overlays the left third. Keep faces right of center.' },
      { id: 'web-hero-mobile', label: 'Hero (mobile)', w: 828, h: 1104 },
      { id: 'web-card', label: 'Section card', w: 1200, h: 900 },
      { id: 'web-banner', label: 'Wide banner', w: 2400, h: 800, note: 'Very wide. Only works on open compositions.' }
    ]
  },
  {
    id: 'app',
    label: 'App',
    surfaces: [
      { id: 'app-onboarding', label: 'Onboarding screen', w: 1170, h: 2532 },
      { id: 'app-card', label: 'In-app card', w: 1080, h: 720 },
      { id: 'appstore-shot', label: 'App store screenshot', w: 1284, h: 2778, note: 'Device frame and caption are added later.' }
    ]
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    surfaces: [
      { id: 'tiktok-feed', label: 'In-feed', w: 1080, h: 1920, safeTop: 0.10, safeBottom: 0.22, safeRight: 0.16, note: 'Right rail and caption block eat the frame.' }
    ]
  },
  {
    id: 'instagram',
    label: 'Instagram',
    surfaces: [
      { id: 'ig-reels', label: 'Reels', w: 1080, h: 1920, safeTop: 0.09, safeBottom: 0.20, safeRight: 0.14 },
      { id: 'ig-feed-portrait', label: 'Feed portrait', w: 1080, h: 1350 },
      { id: 'ig-feed-square', label: 'Feed square', w: 1080, h: 1080 },
      { id: 'ig-story', label: 'Story', w: 1080, h: 1920, safeTop: 0.13, safeBottom: 0.13 }
    ]
  },
  {
    id: 'meta',
    label: 'Meta ads',
    surfaces: [
      { id: 'meta-feed', label: 'Feed 4:5', w: 1200, h: 1500 },
      { id: 'meta-square', label: 'Feed 1:1', w: 1200, h: 1200 },
      { id: 'meta-story', label: 'Story / Reels ad', w: 1080, h: 1920, safeTop: 0.14, safeBottom: 0.20 }
    ]
  },
  {
    id: 'google',
    label: 'Google Display',
    surfaces: [
      { id: 'gd-responsive-landscape', label: 'Responsive landscape 1.91:1', w: 1200, h: 628, note: 'Keep the image free of overlaid logos, buttons, and repeated headline text.' },
      { id: 'gd-responsive-vertical', label: 'Responsive vertical 9:16', w: 900, h: 1600, note: 'Google may crop or recombine this asset. Keep the subject clear and central.' },
      { id: 'gd-leaderboard', label: 'Leaderboard', w: 728, h: 90, note: 'Extreme crop. Usually needs its own composition.' },
      { id: 'gd-mpu', label: 'Medium rectangle', w: 300, h: 250 },
      { id: 'gd-halfpage', label: 'Half page', w: 300, h: 600 },
      { id: 'gd-large-square', label: 'Large square', w: 1200, h: 1200 }
    ]
  },
  {
    id: 'email',
    label: 'Email',
    surfaces: [
      { id: 'email-header', label: 'Header', w: 1200, h: 600 },
      { id: 'email-inline', label: 'Inline block', w: 1200, h: 800 }
    ]
  }
];

export const SURFACES = SURFACE_GROUPS.flatMap(g =>
  g.surfaces.map(s => ({ ...s, group: g.id, groupLabel: g.label, ratio: s.w / s.h }))
);

export const SURFACE_BY_ID = Object.fromEntries(SURFACES.map(s => [s.id, s]));

// ---------------------------------------------------------------------------

export const ASSET_STATUSES = [
  { id: 'unreviewed', label: 'Awaiting review', hint: 'Editorial review has not started.' },
  { id: 'approved', label: 'Approved', hint: 'Cleared for at least one delivery placement.' },
  { id: 'needs-retouch', label: 'Retouch required', hint: 'Retain the source and complete the listed refinements.' },
  { id: 'needs-new-generation', label: 'New result required', hint: 'Create or capture a materially different replacement.' },
  { id: 'reference-only', label: 'Reference only', hint: 'Approved as production input, not for final delivery.' },
  { id: 'rejected', label: 'Rejected', hint: 'Retained in project history to prevent accidental reuse.' }
];

export const STATUS_BY_ID = Object.fromEntries(ASSET_STATUSES.map(s => [s.id, s]));

export const REJECTION_REASONS = [
  { id: 'reference-mismatch', label: 'Does not match the reference / identity' },
  { id: 'face-anatomy', label: 'Face, hands, body, or anatomy is wrong' },
  { id: 'artifacts-quality', label: 'Artifacts, blur, texture, or quality problem' },
  { id: 'composition', label: 'Wrong composition, crop, pose, or framing' },
  { id: 'style-brand', label: 'Wrong style, mood, color, or brand fit' },
  { id: 'text-logo', label: 'Text, logo, product, or packaging is wrong' },
  { id: 'sexual-content', label: 'Unwanted nudity, sexual, or pornographic content' },
  { id: 'violence-hate', label: 'Violence, hate, harassment, or disturbing content' },
  { id: 'rights-consent', label: 'Rights, consent, likeness, or provenance concern' },
  { id: 'other', label: 'Other' }
];

export const PLACEMENT_DECISIONS = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'revise', label: 'Revise' },
  { id: 'denied', label: 'Denied' }
];

export const ASSET_ROLES = [
  { id: 'candidate', label: 'Candidate' },
  { id: 'reference', label: 'Reference photo' },
  { id: 'product', label: 'Product / screenshot' },
  { id: 'logo', label: 'Logo / mark' },
  { id: 'rejected-example', label: 'Rejected example' }
];

// ---------------------------------------------------------------------------
// QA checklist. Presets pick subsets of this list.

export const QA_CHECKS = [
  { id: 'identity', label: 'Same-person identity', ask: 'Is this the same person as the reference, beyond doubt?', group: 'Human likeness' },
  { id: 'face', label: 'Face consistency', ask: 'Bone structure, expression, and age read consistently?', group: 'Human likeness' },
  { id: 'hair', label: 'Hair consistency', ask: 'Same cut, colour, hairline, and edge quality?', group: 'Human likeness' },
  { id: 'skin', label: 'Skin tone and texture', ask: 'Does skin retain natural tonal variation and appropriate fine detail?', group: 'Human likeness' },
  { id: 'naturalism', label: 'Editorial naturalism', ask: 'Do gaze, posture, expression, spacing, and group interaction feel directed yet believable?', group: 'Human likeness' },
  { id: 'hands', label: 'Hands, fingers, nails', ask: 'Correct count, joints, and nail shape?', group: 'Anatomy' },
  { id: 'teeth-eyes', label: 'Teeth and eyes', ask: 'Symmetrical catchlights, believable teeth, matching pupils?', group: 'Anatomy' },
  { id: 'body', label: 'Body physics', ask: 'Limbs, posture, and weight make physical sense?', group: 'Anatomy' },
  { id: 'wardrobe', label: 'Fabric and wardrobe', ask: 'Do weave, texture, sheen, weight, drape, seams, buttons, and straps look physically believable on zoom?', group: 'Detail' },
  { id: 'materials-light', label: 'Materials and environmental light', ask: 'Do surfaces, contact shadows, reflections, and light direction agree across the whole image?', group: 'Detail' },
  { id: 'jewelry', label: 'Jewelry and tattoos', ask: 'Consistent with the reference, not melted or duplicated?', group: 'Detail' },
  { id: 'background', label: 'Background integrity', ask: 'No warped text, repeated objects, or broken geometry?', group: 'Detail' },
  { id: 'crop-mobile', label: 'Mobile crop safety', ask: 'Survives a 9:16 crop with UI overlays?', group: 'Placement' },
  { id: 'crop-desktop', label: 'Desktop crop safety', ask: 'Survives a wide crop without losing the subject?', group: 'Placement' },
  { id: 'brand', label: 'Brand fit', ask: 'Matches the brand rules in the brief?', group: 'Placement' },
  { id: 'policy', label: 'Platform policy fit', ask: 'Passes Meta, TikTok, and Google ad policy?', group: 'Compliance' },
  { id: 'alt', label: 'Accessibility description', ask: 'Alt text written and accurate?', group: 'Compliance' },
  { id: 'rights', label: 'Rights and provenance', ask: 'Source, model release, and licence recorded?', group: 'Compliance' }
];

export const QA_BY_ID = Object.fromEntries(QA_CHECKS.map(c => [c.id, c]));

export const QA_PRESETS = [
  { id: 'human', label: 'Person in frame', checks: QA_CHECKS.map(c => c.id) },
  { id: 'product', label: 'Product / scene', checks: ['skin', 'naturalism', 'wardrobe', 'materials-light', 'background', 'crop-mobile', 'crop-desktop', 'brand', 'policy', 'alt', 'rights'] },
  { id: 'video', label: 'Video', checks: ['identity', 'face', 'hair', 'skin', 'naturalism', 'hands', 'body', 'wardrobe', 'materials-light', 'background', 'crop-mobile', 'brand', 'policy', 'alt', 'rights'] },
  { id: 'quick', label: 'Quick pass', checks: ['identity', 'skin', 'naturalism', 'hands', 'wardrobe', 'materials-light', 'crop-mobile', 'brand', 'policy'] }
];

export const PRESET_BY_ID = Object.fromEntries(QA_PRESETS.map(p => [p.id, p]));

// ---------------------------------------------------------------------------
// Retouch fix presets: the vocabulary of "make this photo right". Ticked fixes
// travel to the editor in the export package as explicit work orders.

export const FIX_PRESETS = [
  { id: 'skin-even', label: 'Balance skin texture' },
  { id: 'skin-shine', label: 'Refine specular highlights' },
  { id: 'blemish-temporary', label: 'Remove a temporary blemish' },
  { id: 'makeup-natural', label: 'Apply a natural makeup direction — specify palette below' },
  { id: 'makeup-glam', label: 'Apply a full-glam makeup direction — specify finish below' },
  { id: 'cheek-fullness', label: 'Adjust cheek fullness — pictured person’s consent required', consentRequired: true },
  { id: 'hands', label: 'Correct hand and finger anatomy' },
  { id: 'teeth', label: 'Refine dental detail' },
  { id: 'eyes', label: 'Refine eye alignment and catchlights' },
  { id: 'hair-edges', label: 'Refine hair edges' },
  { id: 'garment', label: 'Refine garment drape and seams' },
  { id: 'jewelry', label: 'Refine jewelry and accessories' },
  { id: 'bg-clean', label: 'Remove background distractions' },
  { id: 'bg-text', label: 'Correct distorted background text' },
  { id: 'color-brand', label: 'Match the approved brand color grade' },
  { id: 'extend', label: 'Extend the composition' }
];

// Quick surface bundles for the first-run wizard.
export const SURFACE_PRESETS = [
  { id: 'paid-social', label: 'Paid social', surfaces: ['ig-feed-portrait', 'ig-reels', 'tiktok-feed', 'meta-feed', 'meta-story'] },
  { id: 'web-app', label: 'Website + app', surfaces: ['web-hero-desktop', 'web-hero-mobile', 'web-card', 'app-onboarding', 'appstore-shot'] },
  { id: 'display-email', label: 'Display + email', surfaces: ['gd-large-square', 'gd-mpu', 'gd-halfpage', 'email-header', 'email-inline'] },
  { id: 'launch', label: 'Full launch', surfaces: ['web-hero-desktop', 'web-hero-mobile', 'ig-feed-portrait', 'ig-reels', 'tiktok-feed', 'meta-feed', 'meta-story', 'gd-large-square', 'email-header'] }
];

// ---------------------------------------------------------------------------
// Generation providers. Placeholders only: nothing is called in this build.

export const PROVIDERS = [
  { id: 'image-renderer', label: 'Image renderer', kind: 'Images', env: 'IMAGE_RENDERER_KEY' },
  { id: 'image-refiner', label: 'Image refiner', kind: 'Images', env: 'IMAGE_REFINER_KEY' },
  { id: 'motion-renderer', label: 'Motion renderer', kind: 'Video', env: 'MOTION_RENDERER_KEY' },
  { id: 'motion-refiner', label: 'Motion refiner', kind: 'Video', env: 'MOTION_REFINER_KEY' },
  { id: 'copy-review', label: 'Copy review', kind: 'Brief and QA text', env: 'COPY_REVIEW_KEY' }
];

// ---------------------------------------------------------------------------

export function newProject(name) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: name || 'Untitled project',
    createdAt: now,
    updatedAt: now,
    brief: {
      brand: '', campaignGoal: '', audience: '', tone: '',
      mustHave: '', mustAvoid: '', brandRules: '', rejectedStyles: ''
    },
    surfaces: ['web-hero-desktop', 'web-hero-mobile', 'ig-feed-portrait', 'tiktok-feed', 'meta-feed'],
    qaPreset: 'human',
    brandOverlay: { assetId: '', position: 'bottom-right', widthPct: 18, marginPct: 4, opacity: 1 },
    providers: {}
  };
}

export function newAsset(projectId, file) {
  const kind = (file.type || '').startsWith('video') ? 'video' : 'image';
  return {
    id: crypto.randomUUID(),
    projectId,
    filename: file.name,
    mime: file.type || (kind === 'video' ? 'video/mp4' : 'image/jpeg'),
    kind,
    bytes: file.size,
    addedAt: new Date().toISOString(),
    role: 'candidate',
    status: 'unreviewed',
    rating: 0,
    source: 'upload',
    labels: { campaign: '', audience: '', lane: '' },
    notes: '',
    altText: '',
    provenance: '',
    qa: {},
    fixes: [],
    rejectionFeedback: { reasons: [], note: '', shareForImprovement: false, recordedAt: '' },
    placements: {},
    edit: {
      mode: 'guided',
      adjustments: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, temperature: 0, tint: 0, saturation: 0, vibrance: 0, denoise: 0, blur: 0, sharpen: 0, grain: 0, vignette: 0 },
      pixelGrid: { enabled: false, columns: 12, sensitivity: 55 }
    },
    video: { trimStart: '', trimEnd: '', hook: '', believability: 0, looksAI: false, recast: false, cropNote: '', posterTime: null, comments: [] },
    width: 0,
    height: 0,
    duration: 0
  };
}

// A placement decision record. `crop` is stored in normalized 0..1 source
// coordinates so it survives any later re-export at a different pixel size.
export function newPlacement() {
  return {
    decision: 'pending',
    note: '',
    crop: { x: 0, y: 0, w: 1, h: 1 },
    fill: 'crop' // 'crop' | 'blur' | 'contain'
  };
}
