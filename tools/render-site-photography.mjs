#!/usr/bin/env node
// Render the four photographs used on librasidetechnologies.com through
// MaterialLogix Studio's own generation engine.
//
// This script does not reimplement any part of the pipeline. It imports
// studio/js/generate.js from the materiallogix checkout and calls the same
// functions the Studio UI calls, so what lands in media/ is Studio output
// rather than an approximation of it.
//
// It is loopback-only by consequence, not by choice: generate.js refuses any
// engine address that is not on this machine, and the model weights live
// beside the engine. It therefore has to run on a machine with ComfyUI up on
// 127.0.0.1:8188 and at least one checkpoint installed.
//
//   node tools/render-site-photography.mjs --dry-run
//   node tools/render-site-photography.mjs --preset draft
//   node tools/render-site-photography.mjs --only gown --preset full
//
// Run with --help for the full flag list.

import { execFile } from 'node:child_process';
import { mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));

// --- the four shots --------------------------------------------------------
//
// Filenames match what company-site/index.html already references, so a
// finished render drops in with no markup change. Sizes are the intrinsic
// width/height the markup declares.
//
// `prompt` is the subject only. Studio appends NATURAL_PHOTO_GUIDANCE,
// NATURAL_PHOTO_AVOID and the rest itself -- see the note above renderShot.

const SHOTS = [
  {
    key: 'hero',
    file: 'hero-collaboration.webp',
    width: 1290,
    height: 1100,
    prompt:
      'Three creative professionals working together over printed page layouts on a large table in a daylit studio. '
      + 'A Black woman in the foreground leads the work, drawing on a layout with a pencil. '
      + 'Natural window light from the left, warm neutral room, muted clothing. '
      + 'Documentary framing, nobody looking at the camera.',
    negative:
      'laptop screens, phone screens, visible hardware branding, logos on devices, '
      + 'posed smiling at camera, stock-photo styling'
  },
  {
    key: 'portrait',
    file: 'studio-portrait.webp',
    width: 860,
    height: 832,
    prompt:
      'A Black woman working intently at a desk in a warm, daylit studio, a colleague out of focus behind her. '
      + 'Shallow depth of field, soft window light, calm and unposed. '
      + 'Editorial portrait, three-quarter view, eyes on her work.',
    negative:
      'screens facing camera, visible hardware branding, posed smiling at camera, harsh flash'
  },
  {
    key: 'maker',
    file: 'fashion-maker.webp',
    width: 1216,
    height: 832,
    prompt:
      'A Black woman garment maker working fabric on a cutting table in a daylit apparel studio, '
      + 'finished pieces on a rail behind her. Hands on the cloth, natural window light, muted workwear.',
    negative: 'screens, visible hardware branding, posed smiling at camera'
  },
  {
    key: 'gown',
    file: 'fashion-gown.webp',
    width: 1440,
    height: 900,
    // Not on the site yet. The MaterialLogix Fashion card still carries
    // fashion-maker.webp; see the drop-in checklist this script prints.
    isNew: true,
    prompt:
      'A floor-length evening gown in deep bronze silk satin presented on a rich brown dress form in a dark studio. '
      + 'Trumpet silhouette: draped asymmetric bodice, nipped waist, close through hip and thigh, '
      + 'breaking below the knee into a full sweep with a short train pooling on the floor. '
      + 'Single shoulder strap, hand-finished seams, fine bias-cut drape. '
      + 'Museum presentation on a slim brass stand against a near-black ground, '
      + 'one soft key light from the upper left, a cool rim light from the right, deep falloff into shadow.',
    negative:
      'human model, face, head, arms, hands, mannequin head, shop window, price tag, hanger, '
      + 'clutter, text, logo, watermark, busy background, flat even lighting'
  }
];

const STYLE_INTENT = 'natural';
const DEFAULT_BASE = 'http://127.0.0.1:8188';

// --- flags -----------------------------------------------------------------

const USAGE = `Render the librasidetechnologies.com photography through MaterialLogix Studio.

Usage
  node tools/render-site-photography.mjs [options]

Options
  --studio <path>     materiallogix checkout holding studio/js/generate.js.
                      Defaults to this script's repository, then $MATERIALLOGIX_STUDIO.
  --preset <name>     draft (12 steps, fits 768px) or full (22 steps, native size).
                      Default: full.
  --only <key>        Render one shot: ${SHOTS.map(s => s.key).join(', ')}.
                      Repeatable, or comma-separated.
  --ckpt <name>       Checkpoint filename. Default: the first one the engine reports.
  --out <dir>         Where to write. Default: <studio>/company-site/media.
  --seed <n>          Fixed seed, for a reproducible re-render. Default: random per shot.
  --base <url>        Engine address. Must stay on this machine. Default: ${DEFAULT_BASE}.
  --timeout <min>     Per-shot wait before giving up. Default: 30.
  --quality <n>       cwebp quality, 82-86 as the site standard. Default: 84.
  --keep-png          Keep the intermediate PNG next to the WebP.
  --dry-run           Print the compiled prompts and settings; render nothing.
  --list              List the shots and exit.
  -h, --help          This text.
`;

function parseArgs(argv) {
  const opts = {
    studio: null, preset: 'full', only: [], ckpt: null, out: null, seed: null,
    base: DEFAULT_BASE, timeout: 30, quality: 84,
    keepPng: false, dryRun: false, list: false, help: false
  };
  const needsValue = new Set(['--studio', '--preset', '--only', '--ckpt', '--out', '--seed', '--base', '--timeout', '--quality']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (needsValue.has(arg) && i + 1 >= argv.length) throw new Error(`${arg} needs a value.`);
    switch (arg) {
      case '--studio': opts.studio = argv[++i]; break;
      case '--preset': opts.preset = argv[++i]; break;
      case '--only': opts.only.push(...argv[++i].split(',').map(s => s.trim()).filter(Boolean)); break;
      case '--ckpt': opts.ckpt = argv[++i]; break;
      case '--out': opts.out = argv[++i]; break;
      case '--seed': opts.seed = Number(argv[++i]); break;
      case '--base': opts.base = argv[++i]; break;
      case '--timeout': opts.timeout = Number(argv[++i]); break;
      case '--quality': opts.quality = Number(argv[++i]); break;
      case '--keep-png': opts.keepPng = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--list': opts.list = true; break;
      case '-h': case '--help': opts.help = true; break;
      default: throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!['draft', 'full'].includes(opts.preset)) throw new Error(`--preset must be draft or full, not "${opts.preset}".`);
  if (opts.seed !== null && !Number.isInteger(opts.seed)) throw new Error('--seed must be a whole number.');
  if (!Number.isFinite(opts.timeout) || opts.timeout <= 0) throw new Error('--timeout must be a positive number of minutes.');
  if (!Number.isFinite(opts.quality) || opts.quality < 1 || opts.quality > 100) throw new Error('--quality must be between 1 and 100.');
  const known = new Set(SHOTS.map(s => s.key));
  const unknown = opts.only.filter(k => !known.has(k));
  if (unknown.length) throw new Error(`Unknown shot: ${unknown.join(', ')}. Known: ${[...known].join(', ')}.`);
  return opts;
}

// --- locating the engine module -------------------------------------------

const REL = 'studio/js/generate.js';

async function exists(p) {
  try { await access(p, constants.R_OK); return true; } catch { return false; }
}

/** Resolve one path to studio/js/generate.js, or null. */
async function probe(dir) {
  // Accept the checkout root, or a direct path to generate.js itself.
  if (dir.endsWith('.js')) {
    return (await exists(dir)) ? { root: dirname(dirname(dirname(dir))), module: dir } : null;
  }
  const file = resolve(dir, REL);
  return (await exists(file)) ? { root: dir, module: file } : null;
}

/**
 * Find the materiallogix checkout that holds studio/js/generate.js.
 *
 * An explicit --studio (or $MATERIALLOGIX_STUDIO) is taken at its word: if it
 * does not hold the engine we stop rather than quietly rendering from some
 * other checkout, because which checkout produced a picture is exactly the
 * thing this site needs to be able to state.
 */
async function resolveStudio(explicit) {
  for (const [flag, value] of [['--studio', explicit], ['$MATERIALLOGIX_STUDIO', process.env.MATERIALLOGIX_STUDIO]]) {
    if (!value) continue;
    const given = resolve(process.cwd(), value);
    const hit = await probe(given);
    if (hit) return hit;
    throw new Error(
      `${flag} is ${given}\nbut ${REL} is not there. Point it at the materiallogix checkout root.`
    );
  }

  // Nothing specified: walk up from this script (tools/ sits at the root),
  // then try the working directory.
  const tried = [];
  const candidates = [];
  for (let dir = HERE, i = 0; i < 6; i++) {
    candidates.push(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  candidates.push(process.cwd());
  for (const dir of candidates) {
    const file = resolve(dir, REL);
    if (tried.includes(file)) continue;
    tried.push(file);
    const hit = await probe(dir);
    if (hit) return hit;
  }
  throw new Error(
    `Could not find ${REL}.\nLooked in:\n  ${tried.join('\n  ')}\n`
    + 'Pass --studio /path/to/materiallogix (the checkout root).'
  );
}

// --- rendering -------------------------------------------------------------

/**
 * One shot, start to finish.
 *
 * Note on the prompt: generateOne -> buildTxt2Img -> applyPhotoStyleDefaults
 * already calls compilePhotoPrompt internally, so the RAW subject goes to the
 * engine and Studio compiles it exactly once. Compiling here first and passing
 * the result in would append the guidance twice -- and for the gown the
 * doubled text crosses buildTxt2Img's 1000-character guard and throws. We call
 * compilePhotoPrompt only to show the operator what the engine will send.
 */
async function renderShot(engine, shot, ckpt, opts, outDir) {
  const { compilePhotoPrompt, cpuJobSettings, generateOne } = engine;

  const compiled = compilePhotoPrompt(shot.prompt, shot.negative, STYLE_INTENT);
  const job = cpuJobSettings(opts.preset, shot.width, shot.height);

  console.log(`\n=== ${shot.key} -> ${shot.file} ===`);
  console.log(`  target        ${shot.width}x${shot.height}${shot.isNew ? '  (new file, not on the site yet)' : ''}`);
  console.log(`  render        ${job.width}x${job.height} @ ${job.steps} steps  [${opts.preset}]`);
  console.log(`  applied rules ${compiled.appliedRules.join(', ') || '(none)'}`);
  if (compiled.explicitOverrides.length) console.log(`  your wording wins on: ${compiled.explicitOverrides.join(', ')}`);
  if (job.width !== shot.width || job.height !== shot.height) {
    console.log(`  note          ${opts.preset} renders below the size the markup declares;`);
    console.log('                use --preset full for the file that ships.');
  }
  // The gown must contain no person at all. Studio used to class it as a human
  // scene -- "silhouette" and the "hand" in "hand-finished" both read as human
  // terms -- and add face and hands guidance that fought the negative. That is
  // fixed in HUMAN_TERMS; this stays as a tripwire in case it regresses.
  if (shot.key === 'gown' && compiled.appliedRules.includes('human-scene-integrity')) {
    console.log('  warning       Studio classed this as a human scene and added face/hands');
    console.log('                guidance. Check takes for an invented face, head, or hands.');
  }
  console.log(`  prompt sent   ${compiled.prompt}`);
  console.log(`  negative sent ${compiled.negative}`);

  if (opts.dryRun) return { shot, skipped: 'dry-run' };

  const started = Date.now();
  let last = '';
  const onStatus = state => {
    if (state === last) return;
    last = state;
    process.stdout.write(`  ${state}...\n`);
  };

  const result = await generateOne(
    {
      ckpt,
      prompt: shot.prompt,
      negative: shot.negative,
      styleIntent: STYLE_INTENT,
      width: job.width,
      height: job.height,
      steps: job.steps,
      ...(opts.seed === null ? {} : { seed: opts.seed })
    },
    onStatus,
    opts.base,
    opts.timeout
  );

  const seconds = Math.round((Date.now() - started) / 1000);
  const pngPath = resolve(outDir, shot.file.replace(/\.webp$/, '.png'));
  const webpPath = resolve(outDir, shot.file);
  await writeFile(pngPath, Buffer.from(await result.blob.arrayBuffer()));

  const encoded = await toWebp(pngPath, webpPath, opts.quality);
  if (encoded.ok && !opts.keepPng) {
    await rm(pngPath, { force: true }).catch(() => {});
  }

  console.log(`  done in ${seconds}s  seed ${result.seed}`);
  console.log(`  ${encoded.ok ? webpPath : pngPath}${encoded.ok ? '' : '  (PNG kept: ' + encoded.reason + ')'}`);

  return {
    shot,
    seconds,
    seed: result.seed,
    ckpt,
    engineFilename: result.filename,
    rendered: { ...job },
    target: { width: shot.width, height: shot.height },
    appliedRules: compiled.appliedRules,
    explicitOverrides: compiled.explicitOverrides,
    path: encoded.ok ? webpPath : pngPath,
    encoded: encoded.ok
  };
}

/** Encode to WebP at the site's quality band. Falls back to keeping the PNG. */
async function toWebp(pngPath, webpPath, quality) {
  try {
    await execFileAsync('cwebp', ['-q', String(quality), '-m', '6', pngPath, '-o', webpPath]);
    return { ok: true };
  } catch (err) {
    const reason = err?.code === 'ENOENT'
      ? 'cwebp is not installed (brew install webp / apt install webp)'
      : String(err?.stderr || err?.message || err).split('\n')[0];
    return { ok: false, reason };
  }
}

// --- main ------------------------------------------------------------------

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err.message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (opts.help) { console.log(USAGE); return; }
  if (opts.list) {
    for (const s of SHOTS) console.log(`${s.key.padEnd(9)} ${s.file.padEnd(26)} ${s.width}x${s.height}${s.isNew ? '  (new)' : ''}`);
    return;
  }

  const { root, module: modulePath } = await resolveStudio(opts.studio);
  const engine = await import(pathToFileURL(modulePath).href);
  console.log(`Studio engine   ${modulePath}`);

  const outDir = opts.out
    ? resolve(process.cwd(), opts.out)
    : resolve(root, 'company-site/media');
  await mkdir(outDir, { recursive: true });
  console.log(`Output          ${outDir}`);

  const selected = opts.only.length ? SHOTS.filter(s => opts.only.includes(s.key)) : SHOTS;

  let ckpt = opts.ckpt;
  if (!opts.dryRun) {
    const status = await engine.detectComfy(opts.base);
    if (!status.ok) {
      console.error(
        `\nNo local engine answering on ${opts.base}.\n`
        + 'Start ComfyUI on this machine, then run again. This cannot be done from a\n'
        + 'hosted agent: the engine is loopback-only and the weights live beside it.'
      );
      process.exitCode = 1;
      return;
    }
    console.log(`Engine          ${status.device}${status.vramGB ? ` (${status.vramGB} GB)` : ''}${status.cpuOnly ? ' -- no graphics card' : ''}`);
    if (status.cpuOnly && opts.preset === 'full') {
      console.log('                full preset on a processor is slow; --preset draft is the faster lane.');
    }

    const installed = await engine.listCheckpoints(opts.base);
    if (!installed.length) {
      console.error('\nThe engine has no checkpoint installed. Install one in ComfyUI first.');
      process.exitCode = 1;
      return;
    }
    if (ckpt && !installed.includes(ckpt)) {
      console.error(`\nCheckpoint "${ckpt}" is not installed. Available:\n  ${installed.join('\n  ')}`);
      process.exitCode = 1;
      return;
    }
    ckpt = ckpt || installed[0];
    console.log(`Checkpoint      ${ckpt}${opts.ckpt ? '' : '  (first installed; override with --ckpt)'}`);
  }

  const done = [];
  const failed = [];
  for (const shot of selected) {
    try {
      const record = await renderShot(engine, shot, ckpt, opts, outDir);
      if (!record.skipped) done.push(record);
    } catch (err) {
      failed.push({ key: shot.key, message: err?.message || String(err) });
      console.error(`  FAILED: ${err?.message || err}`);
    }
  }

  if (opts.dryRun) {
    console.log('\nDry run: nothing was rendered.');
    return;
  }

  // Provenance, written down rather than assumed from a filename. The site's
  // own imagery rules require knowing where a picture came from.
  if (done.length) {
    const manifestPath = resolve(outDir, 'render-provenance.json');
    let previous = {};
    try { previous = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { /* first run */ }
    const manifest = {
      ...previous,
      generator: 'MaterialLogix Studio (studio/js/generate.js)',
      engine: opts.base,
      styleIntent: STYLE_INTENT,
      shots: {
        ...(previous.shots || {}),
        ...Object.fromEntries(done.map(r => [r.shot.file, {
          key: r.shot.key,
          renderedAt: new Date().toISOString(),
          checkpoint: r.ckpt,
          seed: r.seed,
          preset: opts.preset,
          rendered: r.rendered,
          target: r.target,
          prompt: r.shot.prompt,
          negative: r.shot.negative,
          appliedRules: r.appliedRules,
          explicitOverrides: r.explicitOverrides,
          seconds: r.seconds
        }]))
      }
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`\nProvenance      ${manifestPath}`);
  }

  console.log(`\nRendered ${done.length}/${selected.length}.`);
  if (failed.length) {
    console.log('Failed:');
    for (const f of failed) console.log(`  ${f.key}: ${f.message}`);
  }

  const gown = done.find(r => r.shot.key === 'gown');
  if (gown && gown.encoded) {
    console.log(`
fashion-gown.webp is new, so it needs wiring before it will serve:
  1. company-site/index.html -- point the MaterialLogix Fashion card's <img>
     at ./media/fashion-gown.webp and rewrite the alt text for the gown.
  2. In the sideof repository, add media/fashion-gown.webp to the asset list in
     scripts/copy-libraside-site.cjs and to the COMPANY_FILES map in
     workers/hostname-router.js. That map is an allowlist: a path missing from
     it returns 404 however correctly the file was built.`);
  }
  if (done.some(r => !r.encoded)) {
    console.log('\nSome shots kept their PNG because cwebp was unavailable. Install webp and');
    console.log('encode with: cwebp -q 84 -m 6 in.png -o out.webp');
  }
  if (failed.length) process.exitCode = 1;
}

main().catch(err => {
  console.error(`\n${err?.message || err}`);
  process.exitCode = 1;
});
