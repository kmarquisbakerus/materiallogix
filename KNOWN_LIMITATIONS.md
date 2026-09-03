# MaterialLogix Release Limitations

The current public deployment is a product website and explicit browser demo,
not the finished paid cloud service. The authoritative, detailed release register
is maintained with the private application source.

Current public release blockers:

- account sessions, device activation, server-side licenses, checkout, prepaid
  balances, cloud authorization, and cloud workers are not deployed;
- production Studio access intentionally fails closed without `/api/session`;
- the Windows download is not yet a signed installer with a trusted updater;
- the custom domain certificate/DNS configuration is not production-ready;
- full local video engines and twelve finished house-voice models are incomplete;
- the demo is local browser software, with browser codec/storage constraints;
- analysis signals assist human review and do not guarantee creative, factual,
  legal, identity, anatomy, consent, or rights correctness.

Cloud charging and production account claims must remain unavailable until the
zero-trust backend and release acceptance tests are complete.

## Built, and waiting on an external approval

These are implemented and tested in the client. Each one stays invisible until
the server turns its flag on, so none of them can be reached early and none of
them needs a release to switch on.

| Capability | Server flag | Waiting on |
| --- | --- | --- |
| Google sign-in | `google_sign_in` | Google developer account approval |
| Apple sign-in | `apple_sign_in` | Apple developer account approval |
| Bring-your-own engine on macOS | `mac_byo_engine` | packaged macOS engine |

Flags are read from `/api/session` and toggled from Operations. A flag the
server does not send is off: an unreachable or unauthenticated session shows
none of these. Turning a sign-in flag on also requires its
`/api/auth/<provider>/start` route to be live; the client sends a same-origin
`return_to` path and accepts nothing else.

Cloud inpainting stays disabled in the same fail-closed way, but it is not on
this list: it needs a provider contract and accepted cost fixtures, not an
account approval.

## Prices

The published site is the single source of truth. `studio/js/pricing.js` now
matches it exactly, and a test fails the build if the two ever disagree again -
on a plan, a term price, the pay-per-export price, the wallet range, the Voice
Starter allowance, or the premium voice rate.

Two of the six advertised plans, Single Studio Pro and Pro Studio, sell the Pro
Motion Engine, five personal voice clones, and premium voice minutes. Those
capabilities are declared and entitled - a Pro licence resolves to the Pro lane
and unlocks the Studios it paid for - but the Pro Motion Engine and the premium
voice models are not shipped yet, so a Pro licence currently delivers the same
renders as its standard tier. Do not sell the Pro plans until both ship.

## Client contracts the billing service must honour

The billing API lives outside this repository, so these names are a contract
rather than an implementation:

| Client call | What it sends | Why it matters |
| --- | --- | --- |
| `POST /api/checkout/session` | `sku` of `export_image`, `export_audio` or `export_video` | The Free Preview card sells all three; a SKU the service does not know is a checkout that fails after the customer clicked. |
| `POST /api/checkout/session` | `sku` of `<plan>_<term>`, e.g. `single_pro_photo_yearly` | The two Pro tiers are now buyable from the site. |
| `POST /api/billing/portal` | the active licence key | Usage offers **Manage billing**; a subscription needs a way out as well as a way in. |
| `GET /api/usage` | — | `license.plan` is rendered through `planLabel()`, so the service may keep sending plan ids. |

Included cloud credit is declared in `CLOUD_CREDIT.includedCents` and spends on
any cloud job. The client never decides what remains this period - it shows what
the plan includes and lets the server settle the actual amount.

## Response headers

The deployment is Cloudflare Pages advanced mode: `_worker.js` handles every
request and serves static assets through `env.ASSETS`, so `_headers` and
`_redirects` are never consulted. Both files have been removed - the redirect
rules they held are in the Worker, and one of them (`/` to `/studio/`)
contradicted the Worker and would have made pricing and every checkout button
unreachable if it were ever honoured.

Security headers are set in the Worker and covered by `tests/worker.test.mjs`:
CSP (`object-src`, `base-uri`, `form-action`, `frame-ancestors`),
`Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy` and HSTS.

`script-src` and `connect-src` are deliberately absent. The Studio boots from an
inline theme script, and it talks to a local engine bridge on the customer's own
network, whose address is not known ahead of time. Adding either directive
without first moving the inline script to a file and routing bridge traffic
through a known origin would break the product on the customer's machine.
