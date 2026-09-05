# LibraSide Technologies

Self-contained source for the LIBRASIDE TECHNOLOGIES LLC corporate website
(`librasidetechnologies.com`).

The site is written for four readers at once: a prospective board or executive
team, a customer arriving from one of the products, a grant reviewer, and an
investor running diligence. It introduces the parent company, presents the
portfolio with honest status labels, states the operating standard, and shows
how the company is governed.

## Content rules this site follows

- **House voice (BRAND-02 §4.4).** Short, direct, warm, exact. No superlatives,
  no "revolutionary" or "all-in-one" language, no exclamation marks.
- **Approved lines only.** The parent line is "We build tools that let people
  finish." Product lines are the approved SideOf and Studio lines. Do not
  invent new locked lines here.
- **Status is dated.** Every availability claim carries its as-of date and the
  boundary that goes with it. A target is labelled as a target.
- **No financing ask.** Grants and other non-dilutive sources are the only
  external-capital path currently authorised, so the site offers a controlled
  diligence path and does not solicit investment.
- **Founder name.** Public surfaces use "Kevin Baker". The full legal name is
  used only in executed corporate records, not on the website.
- **Legal entity.** The filed name is `LIBRASIDE TECHNOLOGIES LLC`. Use it
  exactly; do not introduce spacing or comma variants.
- **Quiet endorsement (BRAND-01 §3.2).** The parent leads here. On the product
  sites the product leads and the parent appears in the footer.

## Imagery rules

- Every device screen shown on this site is a real capture of a shipped build,
  captioned as such. No mockups, no rendered stand-ins, no stock screens.
- Products without a shippable interface get a typographic panel, not a
  screenshot of an unfinished build.
- Photography is produced in MaterialLogix Studio and centres Black subjects.
- Provenance is recorded, not inferred. A picture counts as Studio output only
  when there is a render record for it: checkpoint, seed, size, and the prompt
  it was compiled from. `tools/render-site-photography.mjs` writes that record
  to `media/render-provenance.json` as it renders.
- Photography avoids third-party hardware branding in the frame.
- SideOf consumer campaign photography does not appear here. The parent site
  shows the SideOf product, not its lifestyle marketing.

### Outstanding: the site photography

The four photographs this site uses are rendered by
`tools/render-site-photography.mjs`, which imports Studio's own
`studio/js/generate.js` and drives the same engine the Studio UI drives. It has
to run on a machine with ComfyUI up on `127.0.0.1:8188`: the engine refuses any
address that is not on the local machine, and the model weights sit beside it.
Neither CI nor a hosted agent can do it.

The renderer lives beside the site rather than in the application repository,
so it travels with the pictures it makes. Point `--studio` at a MaterialLogix
checkout to give it an engine; from inside one it finds it on its own.

`hero-collaboration.webp`, `studio-portrait.webp` and `fashion-maker.webp` are
in the repository but carry no render record, so they are placeholders until
they are re-rendered and recorded. Their provenance was read off their
filenames rather than verified; do not describe them as Studio output until
`media/render-provenance.json` covers them.

`fashion-gown.webp` does not exist yet, so the Fashion card still carries
`fashion-maker.webp`. Once the gown is rendered, point the card's `<img>` at
it, rewrite the `alt` text, and add the filename to
`scripts/copy-libraside-site.cjs` and the `COMPANY_FILES` map in
`workers/hostname-router.js` in the `sideof` repository. The prompt and what a
usable take looks like are kept in `docs/fashion-gown-render.md`.

## Boundaries

- No SideOf or MaterialLogix application source is imported.
- Product websites are linked only as independent destinations.
- Product accounts, customer data, deployments, and infrastructure stay separate.

## Public domains

- `https://librasidetechnologies.com`
- `https://www.librasidetechnologies.com`

## Deployment

This directory is self-contained: page, styles, script, media, docs and the
renderer that produces its photography. Nothing outside it is needed to build
the site, which is what lets it move.

Today `librasidetechnologies.com` is served by the `sideof` Cloudflare Worker,
which copies this directory from the `company/libraside-technologies` branch of
the `materiallogix` repository at a pinned commit. That is two application
repositories serving one corporate website, and it is why the site drifted from
what is on `main`: the pin is old, and the deploy gate still asserts filenames
and copy this directory no longer has.

The intended arrangement is the `libraside-technologies-site` Worker serving
this site from a repository of its own, with MaterialLogix keeping
`materiallogix.com` and the Studio application. Until that repository exists,
changing a filename here requires updating both `scripts/copy-libraside-site.cjs`
and the `COMPANY_FILES` map in `workers/hostname-router.js` in the `sideof`
repository.

## Contact

`kevinbaker@librasidetechnologies.com`
