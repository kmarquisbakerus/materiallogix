import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  MONTHLY_UNITS, VOICE_STARTER_LANE, LANES, CLOUD_SURCHARGE, PREMIUM_VOICE,
  deliveredPrice, stripeCatalogue, voiceProfileLimit, upscaleModelsForLane, scriptAllowance
} from '../studio/js/pricing.js';
import { ENABLED_VIDEO_ENGINES } from '../studio/js/video-engine.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(ROOT, file), 'utf8');

const site = read('index.html');
const terms = read('legal/terms.html');
const refunds = read('legal/refunds.html');
const privacy = read('legal/privacy.html');
const limitations = read('KNOWN_LIMITATIONS.md');

// Every module a customer's browser runs, minus the file where the price tables
// are declared. A field read only where it is written is not read at all.
function productSources() {
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const path = resolve(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== 'assets' && entry !== 'css') walk(path);
      } else if (/\.(js|html)$/.test(entry) && !path.endsWith('js/pricing.js')) {
        files.push(path);
      }
    }
  })(resolve(ROOT, 'studio'));
  return files.map(path => readFileSync(path, 'utf8')).join('\n');
}
const PRODUCT_CODE = productSources();

test('the terms state the Voice Starter allowance the code grants', () => {
  // The terms promised 60 finished minutes against MONTHLY_UNITS 30, on the
  // cheapest paid tier - the one most likely to be bought without reading.
  const minutes = /includes (\d+) finished local voice minutes/.exec(terms)?.[1];
  assert.ok(minutes, 'the terms no longer state a Voice Starter allowance');
  assert.equal(Number(minutes), MONTHLY_UNITS.voice_starter);
  assert.equal(Number(minutes), Number(/(\d+) finished voice minutes each month/.exec(site)?.[1]),
    'the terms and the card must state one number, not two');
});

test('nothing promises a marked audition while the Voice Starter lane is unstamped', () => {
  assert.equal(VOICE_STARTER_LANE.voice.stamped, false,
    'Voice Starter renders unstamped by design - if that changes, the promise can come back');
  for (const [name, doc] of [['legal/terms.html', terms], ['index.html', site]]) {
    assert.ok(!/audition/i.test(doc), `${name} still offers an audition the voice lane never marks`);
  }
});

test('the refund page states the threshold and enumerates no plans behind it', () => {
  const threshold = /any plan under \$(\d+)/.exec(refunds)?.[1];
  assert.ok(threshold, 'the refund page no longer states a threshold');
  const over = stripeCatalogue().filter(row => row.kind === 'subscription' && row.amountCents > Number(threshold) * 100);
  assert.ok(over.length > 2,
    `${over.length} SKUs are over $${threshold}; a hand-written list of them cannot stay true`);
  for (const stale of ['both annual terms', 'Full Studio', 'three-month term']) {
    assert.ok(!refunds.includes(stale),
      `the refund page names "${stale}" - the rule reads the same without a list, and a list goes stale`);
  }
});

test('"never use your allowance" is said only of the export that spends none', () => {
  // A proof package authorizes zero units. A voice take does not: it is
  // authorized as a clean export at one unit per minute, and never stamped.
  const claims = site.match(/[^<>]*never use your allowance[^<>]*/g) || [];
  assert.ok(claims.length >= 3, 'the site no longer makes the free-preview promise anywhere');
  for (const claim of claims) {
    assert.match(claim, /proof export/,
      `an unqualified allowance promise: "${claim.trim().slice(0, 80)}"`);
  }
  const voicePanel = /<ul class="incl pickpanel p-voice">[\s\S]*?<\/ul>/.exec(site)?.[0] || '';
  assert.ok(voicePanel, 'the Single Studio voice panel moved');
  assert.ok(!/never use your allowance/.test(voicePanel),
    'the voice panel has no proof lane, so it cannot promise a free one');
});

// What Pro sells, and the identifier a product module has to read for the sale
// to be honest. `personalClones` is read through `voiceProfileLimit`, which is
// why the predicate is a list of names rather than the field itself.
const PRO_CLAIMS = [
  { claim: 'Pro Motion Engine', kept: () => ENABLED_VIDEO_ENGINES.length > 0 },
  { claim: 'premium natural voice', readers: ['includedMinutes'] },
  { claim: 'Extra voice from $4.99/hour', readers: ['extraPricePerHour'] },
  { claim: 'upscaling on every cloud job', readers: ['cloudUpscaleIncluded', 'freeUpscalePlans'] },
  { claim: 'off any wallet top-up', readers: ['walletTopUpCents'] },
  { claim: 'personal voice clones', readers: ['voiceProfileLimit'], sellable: true }
];

test('a Pro card sells only what a Pro licence delivers today', () => {
  // The exposure was not the $10 delta. It was four headline features declared
  // in a table and read by nothing, sold at a premium on two plan cards.
  const note = /id="engine-note"[\s\S]{0,420}?<\/p>/.exec(site)?.[0] || '';
  assert.ok(note, 'the footnote that explains the engine mark is gone');
  const unavailable = site.match(/<li><b>Not in this release<\/b>[\s\S]*?<\/li>/g) || [];
  assert.equal(unavailable.length, 2, 'both Pro cards must carry the not-yet-available block');
  // What is left once the disclosure and the footnote are removed is what the
  // page sells outright.
  let sold = site.replace(note, '');
  for (const block of unavailable) sold = sold.replace(block, '');

  for (const entry of PRO_CLAIMS) {
    const kept = entry.kept ? entry.kept()
      : entry.readers.some(name => PRODUCT_CODE.includes(name));
    if (entry.sellable) {
      assert.ok(kept, `${entry.claim} is on the card as delivered and nothing reads it`);
      assert.ok(sold.includes(entry.claim), `the card dropped ${entry.claim}, the one Pro benefit that is real`);
    } else {
      assert.ok(!kept, `${entry.claim} now has a reader - move it out of "Not in this release"`);
      assert.ok(!sold.includes(entry.claim),
        `"${entry.claim}" is sold outright and no product module delivers it`);
    }
  }
});

test('the Pro lane differs from the paid lane only where the cards say it does', () => {
  // `LANES.pro` spreads `LANES.paid`, so the upscale model and the script
  // allowance are the same object for both. They were counted as Pro
  // differentiators for a while, which is how two tiers looked walled.
  assert.deepEqual(upscaleModelsForLane(LANES.pro), upscaleModelsForLane(LANES.paid),
    'the upscale model separates free from paid, not standard from Pro');
  assert.deepEqual(scriptAllowance(LANES.pro), scriptAllowance(LANES.paid),
    'the script allowance is Infinity on both paid lanes');
  assert.equal(PREMIUM_VOICE.personalClones.single_pro, voiceProfileLimit({ plan: 'single_pro', selected_product: 'voice' }));
  assert.ok(voiceProfileLimit({ plan: 'pro' }) > voiceProfileLimit({ plan: 'full' }),
    'the voice-profile cap is the whole delta a Pro licence buys');
});

test('the release register quotes the cloud video price the code charges', () => {
  assert.ok(!/\$5\.99/.test(limitations),
    'the pre-correction cloud minute is back; the surcharge is $2 on top of the $4.99 deliverable');
  const cloudMinute = deliveredPrice('video', { units: 1, cloud: true }).totalCents / 100;
  const ladder = /\| One clean minute of video \| \*\*\$([0-9.]+)\*\* \| \*\*\$([0-9.]+)\*\* \|/.exec(limitations);
  assert.ok(ladder, 'the ladder table moved');
  assert.equal(Number(ladder[1]), deliveredPrice('video', { units: 1 }).totalCents / 100);
  assert.equal(Number(ladder[2]), cloudMinute);
  assert.equal(Number(/\| One video minute, in the cloud \| \$([0-9.]+) \|/.exec(limitations)?.[1]), cloudMinute);
  assert.equal(Number(/sells for \*\*\$([0-9.]+)\*\* with no plan/.exec(limitations)?.[1]),
    deliveredPrice('video', { units: 1 }).totalCents / 100);
  assert.equal(Number(/GPUs and sells for \*\*\$([0-9.]+)\*\*/.exec(limitations)?.[1]), cloudMinute);
  assert.equal(Number(/\| Cloud video \| per output minute \| \$(\d+) \|/.exec(limitations)?.[1]),
    CLOUD_SURCHARGE.video.price);

  const catalogue = stripeCatalogue();
  const counted = /(\d+) SKUs: (\d+)\s*\nsubscription rows/.exec(limitations);
  assert.ok(counted, 'the catalogue paragraph moved');
  assert.equal(Number(counted[1]), catalogue.length);
  assert.equal(Number(counted[2]), catalogue.filter(row => row.kind === 'subscription').length);
});

test('the pages a regulator opens first say something', () => {
  // The terms are numbered clauses, and clauses get renumbered when one is
  // inserted. These match the heading rather than the number it happens to
  // carry, so adding a section moves the numbers without moving the promise.
  for (const heading of ['Who provides this service', 'Accessibility', 'Disputes']) {
    assert.match(terms, new RegExp(`<h2>\\d+\\. ${heading}</h2>`),
      `legal/terms.html is missing a "${heading}" section`);
  }
  assert.match(terms, /at least 18 years old/, 'the age rule is gone');
  assert.match(terms, /do not knowingly accept an account or a payment from anyone younger/,
    'the age rule states no consequence');
  assert.match(terms, /laws of the District of Columbia/, 'the governing law is gone');
  // The savings clause, in the words the published terms use for it. A District
  // of Columbia choice of law with no such clause is unenforceable against a
  // consumer who has mandatory protection at home.
  assert.match(terms, /protection of the mandatory law, or the right to bring proceedings in the courts, of the country where you live/,
    'a District of Columbia choice of law with no savings clause is unenforceable against an EU consumer');
  assert.match(terms, /WCAG 2\.2 Level AA/, 'the accessibility statement claims no standard');

  for (const heading of ['<h2>How long we keep things</h2>', '<h2>If there is a security incident</h2>',
    '<h2>The European Union and the United Kingdom</h2>']) {
    assert.ok(privacy.includes(heading), `legal/privacy.html is missing ${heading}`);
  }
  assert.match(privacy, /within 72 hours/, 'the breach clause names no deadline');
  // A representative must be established in the territory it covers, so
  // neither can be appointed from the United States. The lawful position is
  // not to offer the service there, and the page has to say so plainly rather
  // than leave a reader guessing why no representative is named.
  assert.match(privacy, /Article 27/, 'the reason no representative is named has gone');
  assert.match(privacy, /do not offer MaterialLogix Studio in the European Union or the United Kingdom/,
    'the page must say the service is not offered there');
  assert.match(privacy, /established in the territory it covers/,
    'the page must say why a US company cannot appoint one');
  // And the page must not have quietly become unreachable to the people it is
  // written for: the Worker closes the Studio there, never the policy.
  const worker = read('_worker.js');
  assert.match(worker, /SERVICE_PATHS/, 'the geofence is gone');
  assert.ok(!/\/legal\//.test(String(/const SERVICE_PATHS = [^;]+;/.exec(worker)?.[0] || '')),
    'the geofence must not close the legal pages');
});

test('every blank left for outside counsel is visibly a blank', () => {
  for (const [name, doc] of [['legal/terms.html', terms], ['legal/privacy.html', privacy],
    ['legal/refunds.html', refunds], ['index.html', site]]) {
    for (const marker of doc.match(/\[TO BE COMPLETED[^\]]*\]?/g) || []) {
      assert.match(marker, /^\[TO BE COMPLETED: .+\]$/,
        `${name} has a placeholder that does not say what is missing: ${marker.slice(0, 60)}`);
    }
    assert.ok(!/\[TBD\]|\[\.\.\.\]|TODO/.test(doc), `${name} hides a blank behind something a reader would miss`);
  }
});

test('the draft contract wording is in the repository and out of the site', () => {
  // Counsel's 15 clauses were written into a scratchpad that dies with the
  // session. They belong in the repository — and nowhere near the deploy
  // package, because a draft published beside the real terms is worse than no
  // draft at all.
  const draft = read('legal/drafts/CONTRACT_WORDING.md');
  assert.ok(draft.length > 4000, 'the draft is a stub');
  const clauses = draft.match(/^\*\*\d+\. /gm) || [];
  assert.equal(clauses.length, 15, `${clauses.length} clauses; counsel drafted 15`);
  assert.match(draft, /is not in force\s*\n?and is not published/,
    'the draft must say plainly that it is a draft');
  // Bracketed questions, not invented answers.
  assert.ok((draft.match(/\[[^\]]{3,}\]/g) || []).length >= 8,
    'the facts counsel could not source must stay visibly open');

  // The packaging step excludes it, and the Worker refuses it. Both, because
  // one lock is not enough for something that publishes.
  const workflow = read('.github/workflows/package-cloudflare-upload.yml');
  assert.match(workflow, /not_site_dirs = \('legal\/drafts\/',\)/,
    'the deploy package would ship the draft');
  assert.match(workflow, /if rel\.startswith\(not_site_dirs\):\s*\n\s*return False/);
  const worker = read('_worker.js');
  const notTheSite = new RegExp(worker.match(/const NOT_THE_SITE = \/(.+)\/i;/)[1], 'i');
  assert.ok(notTheSite.test('/legal/drafts/CONTRACT_WORDING.md'),
    'the Worker would serve the draft');
});

test('a subject can be told what consent was taken, and have it erased', () => {
  // The consent records are held on the device and nowhere else, so an export
  // that asks only the server hands back everything except the records a
  // subject is most likely to be asking for — and a deletion that erases the
  // server leaves them in place, which is not deletion. Driven end to end:
  // 2 recorded, 2 exported (Ada, Grace), 2 erased, 0 remaining.
  const privacy = read('studio/js/privacy.js');
  assert.match(privacy, /import \{ allConsents, forgetConsents \} from '\.\/store\.js';/,
    'the rights paths must reach the store that holds the records');
  assert.match(privacy, /consentRecordsOnThisDevice: consents \?\? 'could not be read'/,
    'the export must carry the device records');
  assert.match(privacy, /erased \+= await forgetConsents\(subject\)/,
    'deletion must erase them, not only ask the server');
  // A silently incomplete export is worse than one that refuses.
  assert.match(privacy, /consent records on this device could not be read/,
    'a failure to read the records must be reported to the subject');
  // And the customer is told before confirming that local records go too.
  assert.match(privacy, /consent records held on this device will be erased/,
    'the confirmation must say what it erases');
});

test('the retention ceiling is one number, and the customer reads it before agreeing', () => {
  // The consent line and the Privacy Policy have to state the same window, or
  // the customer agrees to one thing and is owed another. It was 24 hours in
  // both — a figure an R2 lifecycle rule cannot hold, because Cloudflare
  // deletes "within 24 hours of the expiration value", so a 24-hour rule runs
  // to roughly 48.
  const consent = read('studio/js/app.js');
  const privacy = read('legal/privacy.html');
  assert.match(consent, /never held longer than 7 days/,
    'the line the customer ticks must state the ceiling');
  assert.match(privacy, /never held longer than 7 days/,
    'the policy must state the same ceiling');
  assert.ok(!/deletion within 24 hours|within 24 hours of it finishing/.test(consent + privacy),
    'a 24-hour promise is back, and it cannot be kept');
  // Deleting when the job ends is the mechanism; the ceiling is the backstop.
  assert.match(privacy, /deleted when the job completes/);
  assert.match(consent, /deleted when the job finishes/);
});
