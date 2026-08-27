// Campaign package builder: renders approved crops, writes the decision
// record, and zips the lot.

import { SURFACE_BY_ID, QA_BY_ID, STATUS_BY_ID, PRESET_BY_ID, PROVIDERS } from './model.js';
import { renderCrop, canvasToBytes, loadImage, grabVideoFrame, defaultCrop, yieldToLoop, applyProofWatermark, proofSurface } from './crop.js';
import { objectUrl, getBlob } from './store.js';
import { makeZip } from './zip.js';

export const slug = s => (s || '')
  .toLowerCase()
  .replace(/\.[a-z0-9]+$/, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 48) || 'asset';

const csvCell = v => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function approvedPairs(assets) {
  const out = [];
  for (const asset of assets) {
    for (const [surfaceId, p] of Object.entries(asset.placements || {})) {
      if (p.decision === 'approved' && SURFACE_BY_ID[surfaceId]) {
        out.push({ asset, surface: SURFACE_BY_ID[surfaceId], placement: p });
      }
    }
  }
  return out;
}

function exportName(project, asset, surface) {
  const brand = slug(project.brief.brand || project.name);
  const campaign = slug(asset.labels.campaign || project.brief.campaignGoal || 'campaign');
  return `${brand}_${campaign}_${surface.id}_${slug(asset.filename)}_${surface.w}x${surface.h}`;
}

// --- documents -------------------------------------------------------------

export function decisionsJson(project, assets) {
  return JSON.stringify({
    schema: 'creative-review-os/decisions@1',
    exportedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      brief: project.brief,
      surfaces: project.surfaces,
      qaPreset: project.qaPreset,
      providers: Object.fromEntries(
        PROVIDERS.map(p => [p.id, project.providers?.[p.id]?.enabled ? 'enabled (no key stored)' : 'off'])
      )
    },
    assets: assets.map(a => ({
      id: a.id,
      filename: a.filename,
      kind: a.kind,
      role: a.role,
      status: a.status,
      source: a.source,
      dimensions: a.width && a.height ? `${a.width}x${a.height}` : null,
      duration: a.duration || null,
      labels: a.labels,
      altText: a.altText,
      provenance: a.provenance,
      notes: a.notes,
      qa: a.qa,
      fixes: a.fixes || [],
      video: a.kind === 'video' ? a.video : undefined,
      placements: Object.fromEntries(
        Object.entries(a.placements || {}).map(([id, p]) => [id, {
          decision: p.decision,
          note: p.note,
          fill: p.fill,
          crop: p.crop,
          surface: SURFACE_BY_ID[id]
            ? { label: SURFACE_BY_ID[id].label, w: SURFACE_BY_ID[id].w, h: SURFACE_BY_ID[id].h }
            : null,
          exportName: SURFACE_BY_ID[id] && p.decision === 'approved'
            ? exportName(project, a, SURFACE_BY_ID[id])
            : null
        }])
      )
    }))
  }, null, 2);
}

export function decisionsMarkdown(project, assets) {
  const L = [];
  const date = new Date().toISOString().slice(0, 10);
  L.push(`# ${project.name} — decision report`, '');
  L.push(`**Exported:** ${date}`);
  L.push(`**QA preset:** ${PRESET_BY_ID[project.qaPreset]?.label || project.qaPreset}`);
  L.push(`**Surfaces in scope:** ${project.surfaces.map(id => SURFACE_BY_ID[id]?.label || id).join(', ') || 'none'}`, '');

  const b = project.brief;
  if (Object.values(b).some(Boolean)) {
    L.push('## Brief', '');
    const rows = [
      ['Brand', b.brand], ['Campaign goal', b.campaignGoal], ['Audience', b.audience],
      ['Tone', b.tone], ['Must have', b.mustHave], ['Must avoid', b.mustAvoid],
      ['Brand rules', b.brandRules], ['Rejected styles', b.rejectedStyles]
    ].filter(([, v]) => v);
    for (const [k, v] of rows) L.push(`- **${k}:** ${v}`);
    L.push('');
  }

  const counts = {};
  for (const a of assets) counts[a.status] = (counts[a.status] || 0) + 1;
  L.push('## Summary', '');
  L.push('| Status | Count |', '| --- | ---: |');
  for (const [k, v] of Object.entries(counts)) L.push(`| ${STATUS_BY_ID[k]?.label || k} | ${v} |`);
  L.push(`| **Approved placements** | **${approvedPairs(assets).length}** |`, '');

  const shipped = assets.filter(a => Object.values(a.placements || {}).some(p => p.decision === 'approved'));
  if (shipped.length) {
    L.push('## Approved assets', '');
    for (const a of shipped) {
      L.push(`### ${a.filename}`, '');
      L.push(`- Status: ${STATUS_BY_ID[a.status]?.label || a.status}`);
      if (a.altText) L.push(`- Alt text: ${a.altText}`);
      if (a.provenance) L.push(`- Provenance: ${a.provenance}`);
      if (a.notes) L.push(`- Notes: ${a.notes}`);
      L.push('', '| Placement | Decision | Fill | Note |', '| --- | --- | --- | --- |');
      for (const [id, p] of Object.entries(a.placements)) {
        const s = SURFACE_BY_ID[id];
        if (!s) continue;
        L.push(`| ${s.groupLabel} · ${s.label} (${s.w}×${s.h}) | ${p.decision} | ${p.fill} | ${p.note || ''} |`);
      }
      const failed = Object.entries(a.qa || {}).filter(([, v]) => v === 'fail');
      if (failed.length) {
        L.push('', `- QA flags: ${failed.map(([k]) => QA_BY_ID[k]?.label || k).join(', ')}`);
      }
      L.push('');
    }
  }

  const dead = assets.filter(a => ['rejected', 'needs-new-generation', 'needs-retouch'].includes(a.status));
  if (dead.length) {
    L.push('## Not shipping', '');
    L.push('| Asset | Status | Reason |', '| --- | --- | --- |');
    for (const a of dead) {
      const failed = Object.entries(a.qa || {}).filter(([, v]) => v === 'fail')
        .map(([k]) => QA_BY_ID[k]?.label || k).join('; ');
      L.push(`| ${a.filename} | ${STATUS_BY_ID[a.status]?.label || a.status} | ${a.notes || failed || ''} |`);
    }
    L.push('');
  }

  return L.join('\n');
}

export function filenameMapCsv(project, assets) {
  const rows = [['source_file', 'surface', 'group', 'width', 'height', 'fill', 'export_file', 'alt_text']];
  for (const { asset, surface, placement } of approvedPairs(assets)) {
    const ext = asset.kind === 'video' ? '(video: source + crop metadata)' : '.jpg';
    rows.push([
      asset.filename, surface.label, surface.groupLabel, surface.w, surface.h,
      placement.fill, exportName(project, asset, surface) + ext, asset.altText
    ]);
  }
  return rows.map(r => r.map(csvCell).join(',')).join('\n');
}

export function altTextMarkdown(project, assets) {
  const L = [`# ${project.name} — alt text`, ''];
  const withAlt = assets.filter(a => Object.values(a.placements || {}).some(p => p.decision === 'approved'));
  if (!withAlt.length) L.push('_No approved assets._');
  for (const a of withAlt) {
    L.push(`- **${a.filename}** — ${a.altText || '⚠️ MISSING — write before launch'}`);
  }
  return L.join('\n');
}

export function retouchListMarkdown(project, assets) {
  const withFixes = assets.filter(a => (a.fixes || []).length);
  const L = [`# ${project.name} — retouch list`, '',
    'Everything a reviewer marked for fixing, per asset. Work through it top to bottom.', ''];
  if (!withFixes.length) L.push('_Nothing marked for retouch._');
  for (const a of withFixes) {
    L.push(`## ${a.filename}`, '');
    for (const f of a.fixes) L.push(`- [ ] ${f.label}${f.note ? ` — ${f.note}` : ''}`);
    if (a.notes) L.push('', `> Reviewer notes: ${a.notes}`);
    L.push('');
  }
  return L.join('\n');
}

export function rejectedRecord(assets) {
  const dead = assets.filter(a => ['rejected', 'needs-new-generation', 'rejected-example'].includes(a.status) || a.role === 'rejected-example');
  const L = ['# Rejected record', '',
    'Kept so these are not reused by mistake, and so the next generation round',
    'has a concrete list of what did not work.', ''];
  if (!dead.length) L.push('_Nothing rejected yet._');
  for (const a of dead) {
    const failed = Object.entries(a.qa || {}).filter(([, v]) => v === 'fail')
      .map(([k]) => QA_BY_ID[k]?.label || k);
    L.push(`## ${a.filename}`);
    L.push(`- Status: ${STATUS_BY_ID[a.status]?.label || a.status}`);
    if (failed.length) L.push(`- Failed checks: ${failed.join(', ')}`);
    if (a.kind === 'video' && a.video.looksAI) L.push('- Flagged: reads as AI');
    if (a.kind === 'video' && a.video.recast) L.push('- Requested: recast / replace talent');
    if (a.notes) L.push(`- Notes: ${a.notes}`);
    L.push('');
  }
  return L.join('\n');
}

export function teamNotes(project, assets) {
  const pairs = approvedPairs(assets);
  const bySurface = {};
  for (const p of pairs) (bySurface[p.surface.id] ||= []).push(p);
  const missingAlt = pairs.filter(p => !p.asset.altText).length;
  const videos = pairs.filter(p => p.asset.kind === 'video');

  const L = [`# ${project.name} — notes for the team`, '',
    '## What is in this package', '',
    '- `approved/` — rendered crops, one folder per placement, ready to upload.',
    '- `decisions.json` — machine-readable record of every decision and crop.',
    '- `DECISIONS.md` — the same record for humans.',
    '- `filename-map.csv` — source file → export file, for the trafficker.',
    '- `crops.json` — normalized crop rectangles, re-renderable at any size.',
    '- `alt-text.md` — accessibility copy.',
    '- `rejected/REJECTED_RECORD.md` — what did not pass and why.',
    '- `PREFLIGHT.md` — every automated check that fired, and what it wanted.',
    '- `AUDIT.md` — who decided what, and when.', ''];

  L.push('## Placement coverage', '');
  if (!project.surfaces.length) L.push('_No surfaces selected in the project._');
  for (const id of project.surfaces) {
    const s = SURFACE_BY_ID[id];
    if (!s) continue;
    const n = bySurface[id]?.length || 0;
    L.push(`- ${s.groupLabel} · ${s.label} — ${n} approved${n === 0 ? '  ⚠️ gap' : ''}`);
  }
  L.push('');

  L.push('## Before launch', '');
  if (missingAlt) L.push(`- ⚠️ ${missingAlt} approved placement(s) have no alt text.`);
  if (videos.length) {
    L.push(`- ${videos.length} video placement(s) ship as source file plus crop and trim notes.`,
      '  This build does not re-encode video — hand `video/VIDEO_NOTES.md` to the editor.');
  }
  L.push('- Re-check platform policy against live ad rules before spending.',
    '- Confirm model releases and licences for every approved asset.', '');
  return L.join('\n');
}

export function cropsJson(project, assets) {
  return JSON.stringify({
    schema: 'creative-review-os/crops@1',
    note: 'Crop rectangles are fractions of the source image (x, y, w, h in 0..1).',
    crops: approvedPairs(assets).map(({ asset, surface, placement }) => ({
      sourceFile: asset.filename,
      assetId: asset.id,
      sourceSize: { w: asset.width, h: asset.height },
      surface: { id: surface.id, label: surface.label, w: surface.w, h: surface.h },
      crop: placement.crop,
      fill: placement.fill,
      pixelRect: asset.width && asset.height ? {
        x: Math.round(placement.crop.x * asset.width),
        y: Math.round(placement.crop.y * asset.height),
        w: Math.round(placement.crop.w * asset.width),
        h: Math.round(placement.crop.h * asset.height)
      } : null,
      exportName: exportName(project, asset, surface)
    }))
  }, null, 2);
}

export function videoNotes(project, assets) {
  const vids = assets.filter(a => a.kind === 'video' && Object.values(a.placements || {}).some(p => p.decision === 'approved'));
  const L = ['# Video notes for the editor', '',
    'Crops and trims below are decisions, not renders. Apply them in the edit.', ''];
  if (!vids.length) L.push('_No approved video._');
  for (const a of vids) {
    L.push(`## ${a.filename}`, '');
    if (a.video.hook) L.push(`- Hook: ${a.video.hook}`);
    if (a.video.trimStart || a.video.trimEnd) L.push(`- Trim: ${a.video.trimStart || '0:00'} → ${a.video.trimEnd || 'end'}`);
    if (a.video.believability) L.push(`- Believability: ${a.video.believability}/5`);
    if (a.video.cropNote) L.push(`- Crop note: ${a.video.cropNote}`);
    const comments = [...(a.video.comments || [])].sort((x, y) => x.t - y.t);
    if (comments.length) {
      L.push('', '### Timestamped comments', '');
      for (const c of comments) {
        const mm = Math.floor(c.t / 60), ss = (c.t % 60).toFixed(1).padStart(4, '0');
        L.push(`- \`${mm}:${ss}\` ${c.text}${c.who ? ` (${c.who})` : ''}`);
      }
    }
    for (const [id, p] of Object.entries(a.placements)) {
      if (p.decision !== 'approved') continue;
      const s = SURFACE_BY_ID[id];
      if (!s) continue;
      const r = a.width && a.height ? ` — source rect ${Math.round(p.crop.x * a.width)},${Math.round(p.crop.y * a.height)} ${Math.round(p.crop.w * a.width)}×${Math.round(p.crop.h * a.height)}` : '';
      L.push(`- ${s.label} (${s.w}×${s.h}, ${p.fill})${r}`);
    }
    L.push('');
  }
  return L.join('\n');
}

// --- the package -----------------------------------------------------------

export async function buildPackage(project, assets, onProgress = () => {}, extraDocs = {}, opts = {}) {
  const entries = [];
  const pairs = approvedPairs(assets);
  const proof = !!opts.proof;
  const root = `${slug(project.name)}_${proof ? 'PROOF' : 'package'}_${new Date().toISOString().slice(0, 10)}`;
  const add = (name, data) => entries.push({ name: `${root}/${name}`, data });

  add('00_NOTES_FOR_TEAM.md', teamNotes(project, assets));
  add('DECISIONS.md', decisionsMarkdown(project, assets));
  add('decisions.json', decisionsJson(project, assets));
  add('crops.json', cropsJson(project, assets));
  add('filename-map.csv', filenameMapCsv(project, assets));
  add('alt-text.md', altTextMarkdown(project, assets));
  add('rejected/REJECTED_RECORD.md', rejectedRecord(assets));
  if (assets.some(a => (a.fixes || []).length)) add('RETOUCH_LIST.md', retouchListMarkdown(project, assets));
  for (const [name, body] of Object.entries(extraDocs)) add(name, body);

  // Cache decoded sources so an asset approved for six surfaces decodes once.
  const sources = new Map();
  async function sourceFor(asset) {
    if (sources.has(asset.id)) return sources.get(asset.id);
    const url = await objectUrl(asset.id);
    let entry;
    if (asset.kind === 'video') {
      const { canvas, width, height } = await grabVideoFrame(url, Number(asset.video.posterTime) || 0);
      entry = { source: canvas, w: width, h: height };
    } else {
      const img = await loadImage(url);
      entry = { source: img, w: img.naturalWidth, h: img.naturalHeight };
    }
    sources.set(asset.id, entry);
    return entry;
  }

  let done = 0;
  const failures = [];
  const scratch = document.createElement('canvas');
  for (const { asset, surface, placement } of pairs) {
    onProgress(++done, pairs.length, asset.filename);
    // Yield only when there is a UI to repaint. In a hidden tab the yield still
    // costs ~50ms a call and buys nothing, which is 1.2s wasted on a 25-item run.
    if (!document.hidden) await yieldToLoop();
    try {
      const { source, w, h } = await sourceFor(asset);
      const crop = placement.crop || defaultCrop(w, h, surface);
      const target = proof ? proofSurface(surface) : surface;
      const canvas = renderCrop(source, w, h, crop, target, placement.fill || 'crop', scratch);
      if (proof) applyProofWatermark(canvas, 'MATERIALLOGIX STUDIO · PROOF — NOT FOR PRODUCTION — DO NOT COPY');
      const bytes = canvasToBytes(canvas, 'image/jpeg', proof ? 0.8 : 0.92);
      const dir = asset.kind === 'video' ? 'video/reference-frames' : `approved/${surface.id}`;
      add(`${dir}/${exportName(project, asset, surface)}${proof ? '_PROOF' : ''}.jpg`, bytes);
    } catch (err) {
      failures.push(`${asset.filename} → ${surface.label}: ${err.message}`);
    }
  }

  // Approved videos ship as their original file plus editor notes.
  const videoAssets = proof ? [] : [...new Set(pairs.filter(p => p.asset.kind === 'video').map(p => p.asset))];
  if (videoAssets.length) {
    add('video/VIDEO_NOTES.md', videoNotes(project, assets));
    for (const a of videoAssets) {
      const blob = await getBlob(a.id);
      if (blob) add(`video/source/${a.filename}`, new Uint8Array(await blob.arrayBuffer()));
    }
  }

  scratch.width = scratch.height = 0;   // release the backing texture

  if (failures.length) add('EXPORT_WARNINGS.txt', failures.join('\n'));

  return {
    blob: makeZip(entries),
    filename: `${root}.zip`,
    stats: { placements: pairs.length, files: entries.length, failures }
  };
}
