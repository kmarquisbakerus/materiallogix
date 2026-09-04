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

### The price ladder

`RENDER_PRICES` is the whole ladder, and everything reads it:

| | On the customer's machine | In the cloud |
| --- | --- | --- |
| One clean photo | **$2.99** | **$3.99** |
| One clean minute of audio | **$2.99** | no cloud voice endpoint |
| One clean minute of video | **$4.99** | **$5.99** |

Two rules hold it together, both tested:

1. **Cloud costs more than local**, for the same deliverable. A cloud image was
   $0.10 against a $2.99 photo export, which paid a customer to route work
   through our GPUs.
2. **Nobody without a plan pays less than somebody with one.** The no-plan price
   and the rate a plan's wallet is charged are the same number; a plan only ever
   does better, through its included credit and the Pro top-up discount. A
   cheaper no-plan price would pay customers to cancel.

Voice has no cloud price because it has no cloud endpoint - voice runs entirely
on the customer's machine. `voiceRender` is declared `available: false` with a
null price, `quoteCloudJob` refuses it, and the wallet no longer offers minutes
of it. Included credit therefore spends on photo and video only, and the site
says so.

### A video minute has two prices, because it has two costs

A minute finished on the customer's own machine costs us nothing to serve, and
sells for **$4.99** with no plan. A minute rendered in the cloud runs on our
GPUs and sells for **$5.99**.

Price and metering are now separate. A video minute still spends **four units**
of a plan's monthly allowance, because it is four times the work of an image -
but it is priced on its own rather than at four units of list, which is where
the previous $11.96 came from.

The only measured cost in the model is `MEASURED_VIDEO_COST`: **$1.31 per
output minute** for native 4K on a community RTX 4090 pool at $0.34/hr, which
leaves 78% at $5.99. That figure is extrapolated from **a single ten-second
run** and the sixty-second checkpoint has never been run. Roughly a fifth of the
cost is fixed pod lifecycle, so longer jobs should come in cheaper per minute
and this is the pessimistic case. `productionEnabled` stays `false` until a
production-length fixture confirms it, and a test fails the build if that flag
is opened while `productionLengthConfirmed` is still false.

**Consequence to decide before launch:** the included $20 cloud credit bought
6m 40s of video at the old $3.00/min. At $5.99 it buys **3m 20s**, or 5 cloud
photos where it used to buy 200. The site
promises "$20 of cloud credit each paid period" and that is still exactly what
it grants - but if the intent was a number of *minutes* rather than a number of
*dollars*, the credit has to rise with the rate.

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

## Pro is priced, and mostly not walled

`laneFor()` and `LANES` describe what each tier renders through. Until now
nothing called them: the lanes were declared and never applied, so every tier
rendered identically and the difference existed only in the price.

One wall is real now. The Enhance dialog listed every upscale model the engine
had installed and preselected the 4x one for everybody, under a line of text
claiming "licensed Photo plans unlock 4x" - a sentence where a gate belonged.
It now offers only the model the licence's lane names, and says so when the
device does not have it. `upscaleModelsForLane()` is `laneFor()`'s first caller.

The rest of the Pro lane still cannot be walled, because it does not exist:

| Pro entitlement | Read by | Blocked on |
| --- | --- | --- |
| `motionEngine: 'pro'` | nothing | the Pro Motion Engine is not shipped |
| `voice.quality: 'premium'` | nothing | premium voice models are not shipped |
| `cloudUpscaleIncluded` | nothing | the cloud lane is disabled |
| `walletDiscount` | `walletTopUpCents` | - shipped |

A Pro licence today therefore renders exactly like its standard tier. Do not
sell the Pro plans until the engines behind those first three rows exist.
