/**
 * Published-site integrity gate.
 *
 * The site sells from two places at once: index.html publishes the prices a
 * customer reads, and studio/js/pricing.js is the catalogue the checkout button
 * turns into a Stripe SKU. Nothing used to hold them together, and they drifted
 * a whole price revision apart while both were live. Everything below is an
 * invariant that, when broken, is visible to a paying customer.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL, URL as NodeURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const fail = (message) => failures.push(message);
const read = (relative) => readFileSync(join(root, relative), "utf8");

const { PRODUCTS, TERMS, price, PAY_PER_EXPORT } = await import(pathToFileURL(join(root, "studio/js/pricing.js")).href);
const { PRICING } = await import(pathToFileURL(join(root, "studio/js/pricing-catalog.js")).href);

// --- 1. The two shipped catalogues must agree with each other ---------------

const catalogTotals = {
  voice_starter: { monthly: PRICING.voiceStarter.monthly.totalCents },
  single_photo: Object.fromEntries(Object.entries(PRICING.single.products.photo).map(([term, entry]) => [term, entry.totalCents])),
  single_video: Object.fromEntries(Object.entries(PRICING.single.products.video).map(([term, entry]) => [term, entry.totalCents])),
  single_voice: Object.fromEntries(Object.entries(PRICING.single.products.voice).map(([term, entry]) => [term, entry.totalCents])),
  full: Object.fromEntries(TERMS.map((term) => [term.id, PRICING.full[term.id]?.totalCents]).filter(([, cents]) => cents !== undefined))
};

for (const product of PRODUCTS) {
  const catalog = catalogTotals[product.id];
  if (!catalog) {
    fail(`pricing-catalog.js has no entry for the sellable product ${product.id}.`);
    continue;
  }
  for (const term of TERMS) {
    const dollars = product.totals[term.id];
    const cents = catalog[term.id];
    if (dollars === undefined && cents === undefined) continue;
    if (dollars === undefined || cents === undefined) {
      fail(`${product.id} is offered on ${term.id} in one catalogue and not the other.`);
      continue;
    }
    if (Math.round(dollars * 100) !== cents) {
      fail(`${product.id} ${term.id}: pricing.js says $${dollars}, pricing-catalog.js says ${cents} cents.`);
    }
  }
}

if (Math.round(PAY_PER_EXPORT.price * 100) !== PRICING.export.totalCents) {
  fail(`Pay-per-export: pricing.js says $${PAY_PER_EXPORT.price}, pricing-catalog.js says ${PRICING.export.totalCents} cents.`);
}

// price() must refuse a term the product is not sold on, or a truthy record
// with an undefined total lets a customer open a checkout for a missing SKU.
for (const product of PRODUCTS) {
  for (const term of TERMS) {
    const quoted = price(product.id, term.id);
    if (product.totals[term.id] === undefined && quoted !== null) {
      fail(`price("${product.id}", "${term.id}") must return null for a term this product is not sold on.`);
    }
    if (product.totals[term.id] !== undefined && quoted?.total !== product.totals[term.id]) {
      fail(`price("${product.id}", "${term.id}") does not quote the catalogue total.`);
    }
  }
}

// --- 2. Published page prices must match the catalogue ----------------------

const indexHtml = read("index.html");
const TERM_CLASS = { monthly: "price-monthly", quarterly: "price-quarterly", yearly: "price-yearly" };
// The page card a catalogue product is published under. A product with no card
// is unbuyable from the site; a card with no product cannot be sold at all.
const CARD_FOR_PRODUCT = {
  voice_starter: "Voice Starter",
  single_photo: "Single Studio",
  single_video: "Single Studio",
  single_voice: "Single Studio",
  full: "Full Studio"
};

const cards = new Map();
for (const match of indexHtml.matchAll(/<article class="plan[^"]*">([\s\S]*?)<\/article>/g)) {
  const body = match[1];
  const name = body.match(/<h3>([^<]+)<\/h3>/)?.[1]?.trim();
  if (name) cards.set(name, body);
}
if (!cards.size) fail("No pricing cards were found in index.html; the price gate cannot run.");

const publishedPrice = (body, termId) => {
  const node = body.match(new RegExp(`<div class="price[^"]*${TERM_CLASS[termId]}[^"]*">\\s*\\$([0-9]+(?:\\.[0-9]{2})?)`));
  if (node) return Number(node[1]);
  const plain = body.match(/<div class="price">\s*\$([0-9]+(?:\.[0-9]{2})?)/);
  return plain ? Number(plain[1]) : null;
};

for (const product of PRODUCTS) {
  const cardName = CARD_FOR_PRODUCT[product.id];
  const body = cards.get(cardName);
  if (!body) {
    fail(`${product.id} is sellable but no "${cardName}" card is published on index.html.`);
    continue;
  }
  for (const term of TERMS) {
    const expected = product.totals[term.id];
    if (expected === undefined) continue;
    const published = publishedPrice(body, term.id);
    if (published === null) {
      fail(`"${cardName}" publishes no ${term.id} price for ${product.id}.`);
    } else if (published !== expected) {
      fail(`"${cardName}" publishes $${published} for ${term.id} but the catalogue charges $${expected}.`);
    }
  }
}

// Every card that is not backed by a sellable product must say it cannot be
// bought, so the page never advertises a tier the licence service cannot issue.
const sellableCards = new Set(Object.values(CARD_FOR_PRODUCT));
for (const [name, body] of cards) {
  if (name === "Free Preview" || sellableCards.has(name)) continue;
  if (!/not yet available to buy online/i.test(body)) {
    fail(`"${name}" has no catalogue product and does not tell the customer it cannot be bought yet.`);
  }
}

const publishedExport = [...indexHtml.matchAll(/(?:Exports?|exports) from \$([0-9]+\.[0-9]{2})/g)].map((match) => Number(match[1]));
if (!publishedExport.length) fail("index.html no longer publishes a pay-per-export price.");
for (const amount of publishedExport) {
  if (amount !== PAY_PER_EXPORT.price) fail(`index.html publishes exports from $${amount} but the catalogue charges $${PAY_PER_EXPORT.price}.`);
}

// --- 3. The service worker's shell must resolve to files that exist ---------

const swSource = read("studio/sw.js");
const shellBlock = swSource.match(/const SHELL = \[([\s\S]*?)\];/)?.[1];
if (!shellBlock) {
  fail("studio/sw.js no longer declares a SHELL list; its precache cannot be verified.");
} else {
  for (const entry of shellBlock.matchAll(/'([^']+)'/g)) {
    const specifier = entry[1];
    const resolved = new NodeURL(specifier, "https://materiallogix.com/studio/sw.js").pathname;
    const target = join(root, resolved.endsWith("/") ? `${resolved}index.html` : resolved);
    if (!existsSync(target)) fail(`studio/sw.js precaches ${specifier}, which resolves to ${resolved} and does not exist.`);
  }
}

// --- 4. No internal link or asset reference may 404 -------------------------

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root }).toString("utf8").split("\0").filter(Boolean);
const htmlFiles = tracked.filter((path) => path.endsWith(".html"));
const ATTRIBUTE = /(?:href|src|action|poster)\s*=\s*"([^"]+)"/g;
for (const file of htmlFiles) {
  const html = read(file);
  const base = dirname(file);
  for (const match of html.matchAll(ATTRIBUTE)) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("data:") || raw.startsWith("mailto:") || raw.startsWith("tel:") || /^(?:https?:)?\/\//i.test(raw)) continue;
    const clean = raw.split("#")[0].split("?")[0];
    if (!clean) continue;
    const relative = clean.startsWith("/") ? clean.slice(1) : join(base, clean);
    const target = join(root, relative);
    if (existsSync(target) || existsSync(join(target, "index.html"))) continue;
    fail(`${file} links to ${raw}, which does not exist.`);
  }
}

// --- 5. Robots, sitemap and redirects must agree on the canonical homepage --

const redirects = read("_redirects");
for (const line of redirects.split("\n")) {
  const [from, to] = line.trim().split(/\s+/);
  if (!from || from.startsWith("#")) continue;
  if ((from === "/" || from === "/index.html") && to?.startsWith("/studio")) {
    fail(`_redirects sends ${from} to ${to}, but robots.txt disallows /studio/ and sitemap.xml publishes the homepage as canonical.`);
  }
}
if (!read("sitemap.xml").includes("<loc>https://materiallogix.com/</loc>")) {
  fail("sitemap.xml no longer publishes the homepage as a canonical URL.");
}

if (failures.length) {
  console.error(`[site] FAIL (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`[site] PASS: catalogues agree, ${cards.size} published tiers reconcile, service-worker shell resolves, ${htmlFiles.length} pages have no broken internal links.`);
