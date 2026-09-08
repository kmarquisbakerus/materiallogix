/**
 * Published-site integrity gate.
 *
 * The site sells from two places at once: index.html publishes the prices a
 * customer reads, and studio/js/pricing.js is the catalogue the checkout button
 * turns into a Stripe SKU. Nothing used to hold them together, and they drifted
 * a whole price revision apart while both were live. Everything below is an
 * invariant that, when broken, is visible to a paying customer.
 *
 * The third catalogue this gate used to reconcile, studio/js/pricing-catalog.js,
 * no longer exists: it was imported by nothing and disagreed with both the page
 * and pricing.js, which is the drift this gate exists to catch rather than
 * codify. The page is now read through the `data-plan` / `data-term` attributes
 * on each published price, so the reconciliation runs in both directions - no
 * sellable plan may be missing from the page, and no price on the page may name
 * a plan the licence service cannot issue.
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

// --- 1. price() must quote the catalogue, and refuse everything else --------

// A truthy record with an undefined total lets a customer open a checkout for a
// SKU the licence service does not sell, so a term a product is not offered on
// has to come back null rather than incomplete.
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

// --- 2. Published page prices must match the catalogue, both ways ------------

const indexHtml = read("index.html");

// One card can publish more than one plan: Single Studio carries Standard and
// Pro behind a switch, and each price node names the plan and term it belongs
// to. `plan` is the family the page publishes; the catalogue splits a family
// into the Studios a customer picks between, and every member of a family is
// sold at the family price.
const published = new Map();
for (const match of indexHtml.matchAll(/<div class="price[^"]*"([^>]*)>\s*\$([0-9]+(?:\.[0-9]{2})?)/g)) {
  const attributes = match[1];
  const plan = attributes.match(/data-plan="([^"]+)"/)?.[1];
  const term = attributes.match(/data-term="([^"]+)"/)?.[1];
  if (!plan || !term) continue;
  published.set(`${plan}:${term}`, Number(match[2]));
}
if (!published.size) fail("No published price carries data-plan and data-term; the price gate cannot run.");

for (const product of PRODUCTS) {
  for (const term of TERMS) {
    const expected = product.totals[term.id];
    if (expected === undefined) continue;
    const shown = published.get(`${product.plan}:${term.id}`);
    if (shown === undefined) {
      fail(`${product.id} is sellable on ${term.id} but index.html publishes no ${term.id} price for the ${product.plan} plan.`);
    } else if (shown !== expected) {
      fail(`index.html publishes $${shown} for ${product.plan} ${term.id} but the catalogue charges $${expected}.`);
    }
  }
}

// The other direction: a price on the page that no product backs is a tier the
// customer can read and the licence service cannot issue.
for (const key of published.keys()) {
  const [plan, term] = key.split(":");
  if (!PRODUCTS.some((product) => product.plan === plan && product.totals[term] !== undefined)) {
    fail(`index.html publishes a ${term} price for "${plan}", which no sellable product offers on that term.`);
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

// Pages advanced mode serves this site through _worker.js, so `_redirects` no
// longer applies and has been removed; the routing table is the worker's. The
// executable proof is tests/worker.test.mjs, which drives the real handler.
// This is the static backstop: no branch may send the canonical homepage into
// the path robots.txt disallows.
if (existsSync(join(root, "_redirects"))) {
  for (const line of read("_redirects").split("\n")) {
    const [from, to] = line.trim().split(/\s+/);
    if (!from || from.startsWith("#")) continue;
    if ((from === "/" || from === "/index.html") && to?.startsWith("/studio")) {
      fail(`_redirects sends ${from} to ${to}, but robots.txt disallows /studio/ and sitemap.xml publishes the homepage as canonical.`);
    }
  }
}

// Asked of the real handler rather than of its source: which branch a path
// takes depends on the host, and the same `/ -> /studio/` line is correct for
// app.materiallogix.com and wrong for the canonical host.
// HTMLRewriter is a Workers runtime global; the homepage path reaches it, so
// the handler needs one to run at all. Nothing here inspects what it appends.
globalThis.HTMLRewriter = class {
  on(_selector, handlers) { this.handlers = handlers; return this; }
  transform(response) {
    this.handlers?.element?.({ append: () => {} });
    return response;
  }
};
const { default: worker } = await import(pathToFileURL(join(root, "_worker.js")).href);
const assets = {
  fetch: () => new Response("<html><body>site</body></html>", { status: 200, headers: { "Content-Type": "text/html" } })
};
for (const path of ["/", "/index.html"]) {
  const response = await worker.fetch(new Request(`https://materiallogix.com${path}`), { ASSETS: assets });
  if (response.status >= 300 && response.status < 400) {
    fail(`_worker.js redirects the canonical homepage ${path} to ${response.headers.get("location")}, but robots.txt disallows /studio/ and sitemap.xml publishes the homepage as canonical.`);
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
console.log(`[site] PASS: ${published.size} published prices reconcile with ${PRODUCTS.length} sellable products, service-worker shell resolves, ${htmlFiles.length} pages have no broken internal links.`);
