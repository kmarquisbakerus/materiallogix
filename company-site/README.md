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
- Photography avoids third-party hardware branding in the frame.

## Boundaries

- No SideOf or MaterialLogix application source is imported.
- Product websites are linked only as independent destinations.
- Product accounts, customer data, deployments, and infrastructure stay separate.

## Public domains

- `https://librasidetechnologies.com`
- `https://www.librasidetechnologies.com`

## Deployment

`librasidetechnologies.com` is served by the `sideof` Cloudflare Worker. That
build copies this directory at a pinned commit and routes the apex host to it.
Changing a filename here requires updating both `scripts/copy-libraside-site.cjs`
and the `COMPANY_FILES` map in `workers/hostname-router.js` in the `sideof`
repository.

## Contact

`kevinbaker@librasidetechnologies.com`
