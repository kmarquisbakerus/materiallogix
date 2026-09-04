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

The plan prices are the published ones and are not in question: $5 Voice
Starter, $15 Single Studio, $25 Single Studio Pro, $29 Full Studio, $39 Pro
Studio. What follows is the export price and the cloud charge, which are.

**A cloud job is a surcharge on a deliverable, not a second price for one.**
Pricing it as a second retail price got the shape wrong in both directions: it
made a cloud image cost more than the photo it delivered, and it billed a
ten-minute script ten times over for a cost that does not grow with length.

A cloud job's cost is dominated by pod spin-up - about $0.26 whatever it does.
Only video has compute that scales with output: about 185 GPU-minutes per
output minute, against roughly 0.1 for a minute of synthesised speech. So:

| Charged | Basis | Rate | Pod cost |
| --- | --- | --- | --- |
| Cloud photo | per job | $0.50 | ~$0.26 |
| Cloud voice render | per job, any script length | $0.50 | ~$0.27 |
| Cloud voice conditioning | per job | $1.00 | ~$0.40 |
| Cloud video | per output minute | $2.00 | $1.31 measured |

The surcharge only has to cover the GPU. The product's margin lives in the
deliverable price the customer already paid; asking the surcharge to carry it
too is what produced a $5.99 cloud minute and a $3.99 cloud photo.

That separation also closes a hole. A plan unit earns about three cents, and a
cloud job costs twenty-six, so a cloud render billed against monthly units
would lose money on every job. Units buy the file; credit buys the cloud.

What that means for a customer:

| | No plan, all in | With a plan |
| --- | --- | --- |
| One photo, local | $2.99 | 1 unit |
| One photo, in the cloud | $3.49 | 1 unit + $0.50 credit |
| Ten-minute script, local | $29.90 | 10 units |
| Ten-minute script, in the cloud | $30.40 | 10 units + $0.50 credit |
| One video minute, local | $4.99 | 4 units |
| One video minute, in the cloud | $6.99 | 4 units + $2.00 credit |

The $20 included credit now buys **40 cloud photos, or 40 cloud voice renders
of any length, or ten minutes of cloud video** - where the previous rates gave
it 3m20s of video and five photos.

### The old ladder

`RENDER_PRICES` is the whole ladder, and everything reads it:

| | On the customer's machine | In the cloud |
| --- | --- | --- |
| One clean photo | **$2.99** | **$3.99** |
| One clean minute of audio | **$2.99** | **$3.99** |
| One clean minute of video | **$4.99** | **$5.99** |

Two rules hold it together, both tested:

1. **Cloud costs more than local**, for the same deliverable. A cloud image was
   $0.10 against a $2.99 photo export, which paid a customer to route work
   through our GPUs.
2. **Nobody without a plan pays less than somebody with one.** The no-plan price
   and the rate a plan's wallet is charged are the same number; a plan only ever
   does better, through its included credit and the Pro top-up discount. A
   cheaper no-plan price would pay customers to cancel.

Every product can be sent to the cloud, so every product carries both prices.
Cloud voice has two jobs, not one:

| Cloud voice job | Price | Why |
| --- | --- | --- |
| Render a script | **$3.99** / output minute | so a long script does not tie up the customer's machine |
| Condition a voice profile | **$4.99** / profile | the heavy one - a fine-tune over up to thirty minutes of reference audio |

**Conditioning is included for the profiles a plan already bought** - one run
each per paid period. A customer who paid for five voice clones should not be
charged five more times to make them usable. Beyond that allowance it is a
wallet job like any other.

Neither voice cost is measured. Both are derived from the one cloud measurement
that exists ($1.31 per 4K output minute, about a fifth of it fixed pod
lifecycle) on the reasoning that synthesis is a far lighter job than 4K video
and conditioning a heavier one. `CLOUD_VOICE.costsConfirmed` is `false` and both
lanes are `available: false`: built and priced, switched on by the server when
the endpoints exist, the same way the sign-in providers wait on their developer
accounts.

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

Two walls are real now.

The Enhance dialog listed every upscale model the engine had installed and
preselected the 4x one for everybody, under a line of text claiming "licensed
Photo plans unlock 4x" - a sentence where a gate belonged. It now offers only
the model the licence's lane names, and says so when the device does not have
it. `upscaleModelsForLane()` is `laneFor()`'s first caller.

The free lane declared `maxWords: 60` and nothing applied it, so an unlicensed
preview would read a script of any length. `scriptAllowance()` now stops the
render and says how many words to trim. A preview that is not short is not a
preview - it is the product, stamped.

Two more gates named a single plan instead of reading the lane, and both let
the free tier out-rank a paying one:

- **Composite voice packs.** The upload handler asked
  `plan === 'voice_starter'`. A free preview has no plan at all, so it sailed
  past the check and could build multi-source packs a paying Starter customer
  could not. `allowsMultiSourceVoicePack()` reads the lane now.
- **Personal voice profiles.** The count was compared against the same named
  plan, so a free preview could keep any number while Starter was held to one.
  `voiceProfileLimit()` reads the declared `personalClones` table, and free
  gets none - "one approved personal voice profile" is Starter's headline
  benefit, and it is not a benefit if it is also free.

The upgrade message also offered "Voice Studio", which is the name of the page,
not a plan anybody can buy. It names the real plans now, and a test fails the
build if any upgrade sentence names something `PRODUCTS` does not sell.

Every tier keeps a preview; only the free one is short. **Voice Starter is a
basic paid tier, not a preview**: it is covered for voice, renders unstamped,
reads any length, and spends its 30 monthly minutes like any other allowance.
It draws the free lane for Photo and Video because it did not buy them.

The rest of the Pro lane still cannot be walled, because it does not exist:

| Pro entitlement | Read by | Blocked on |
| --- | --- | --- |
| `voice.maxWords` | `scriptAllowance` | - shipped |
| `voice.multiTake` | `allowsMultiSourceVoicePack` | - shipped |
| `personalClones` | `voiceProfileLimit` | - shipped |
| `upscale.model` | `upscaleModelsForLane` | - shipped |
| `motionEngine: 'pro'` | nothing | the Pro Motion Engine is not shipped |
| `voice.quality: 'premium'` | nothing | premium voice models are not shipped |
| `cloudUpscaleIncluded` | nothing | the cloud lane is disabled |
| `walletDiscount` | `walletTopUpCents` | - shipped |

A Pro licence today therefore renders exactly like its standard tier. Do not
sell the Pro plans until the engines behind those first three rows exist.

## Metering

The unit policy has always said four units to a minute of video. The campaign
export authorized `quantity: pairs.length` - one unit per placement, whatever
its length - so **a ten-minute cut billed the same as a still**. Duration is the
whole point of the video unit, and it never reached the meter.

`exportUnits()` and `unitsForDeliveries()` are the policy in code now: a photo
crop is one unit, a voice minute is one, a video minute is four, and each
approved placement renders its own file and pays for its own length. The
contact sheet and the client review page still bill per placement, which is
correct - they are one photo artifact each.

## The catalogue Stripe has to carry

`stripeCatalogue()` generates every SKU the client can send to
`/api/checkout/session` from the same declarations the site renders, so the
payment processor and the page a customer read cannot disagree. 29 SKUs: 26
subscription rows (`<plan>_<term>`), three one-time exports, and the
customer-chosen wallet top-up with its range.

Building it found a live defect. `price()` returned an object with an undefined
total for a term a plan is not sold on, and an object is truthy - so the
checkout button stayed enabled on Voice Starter's yearly tab and would have
sent Stripe a `voice_starter_yearly` SKU that does not exist. It returns `null`
now, and a test fails the build if a SKU the client can send is missing from the
catalogue or priced differently in it.

Cloud jobs are deliberately absent from the catalogue: they meter against the
prepaid wallet, and the only Stripe product behind them is the top-up.

## Watermarks

Three products, three protections. Two of them worked; the third did not exist.

| | Unlicensed output | Applied by |
| --- | --- | --- |
| Photo | export blocked at the paywall; proof packages carry a full-frame diagonal watermark and a 960px cap | `applyProofWatermark` in `crop.js`, called from `export.js` |
| Audio | spoken preview mark at the start, the middle and the end, so no crop removes all three | `stampPreview` in `voice.js`, called from `voice.html` |
| Video | **nothing** - the local renderer returned a clean MP4 to anybody | now `deliveryRulesFor` |

The free lane had always declared its video export as "proof only (visual +
audible watermark, 720p)". That was a sentence in a config object, and nothing
read it. `videoRenderPlan` built its options without consulting a licence at
all, and `renderEditedVideo` had no `covers()` check, so an unlicensed customer
could render a finished, unmarked, full-resolution video.

The lane's export descriptors are structured instructions now, not prose, and
the render plan carries them to the engine. Both callers - the local render and
the cloud render - pass the lane, so the licence cannot be bypassed by sending
the job to our GPUs instead. An unknown or suspended lane resolves to the
strictest rules, never the loosest.

**Contract for the local bridge and the cloud worker.** `opts.delivery` arrives
on every video render:

```
{ clean: false, watermark: { visual: true, audible: true }, maxHeight: 720 }
```

An engine that cannot honour it must fail the job rather than return an
unmarked file. The client refuses to start a marked render against a bridge
that does not report `video.watermark`, so an old Video pack cannot be used to
launder a clean render - but the engine must enforce it too, because the client
is not the security boundary.

The audible mark matters as much as the visual one: a visual-only watermark is
removed by cropping, and an audio-only one by muting. Video needs both.

## The video engine is licensed by territory

The Tencent Hunyuan Community License grants rights "for the Territory only",
and §1(l) defines the Territory as "the worldwide territory, excluding the
territory of the European Union, United Kingdom and South Korea". Commercial
use inside it is free and unconditional up to 100 million MAU (§4); Tencent
claims no rights in the outputs (§6(d)); outputs may not be used to improve any
other AI model (§5(b)).

**The clause that decides the shape of the control is §5(c):**

> You must not use, reproduce, modify, distribute, or display the Tencent
> Hunyuan Works, Output or results of the Tencent Hunyuan Works outside the
> Territory. Any such use outside the Territory is unlicensed and unauthorized
> under this Agreement.

It restricts the **Output**, not only the model. Rendering in Ohio and showing
the result to somebody in Dublin is "display ... outside the Territory".

So the gate is on **where the customer is**, not where the servers are. A
US-only server estate does not make an EU delivery licensed, and the licence
says nothing about server location - we grepped it for `server`,
`infrastructur`, `locat`, `resid`, `data cent` and `deploy` and found no such
clause. Keeping the fleet in the Americas is sound for other reasons; it is not
what satisfies this licence.

An excluded customer is **served, not refused**. `model-licence.js` routes the
27 EU member states, GB and KR to **Wan 2.2**, which is Apache-2.0 with no
territorial condition, no user ceiling and no registration. They get a working
product rendered by a different model, and the notice says so rather than
failing silently.

Two edges the tests hold:

- **Under-blocking**: an unknown or malformed region is refused, never guessed.
  ISO 3166-1 reserves `AA`, `ZZ`, `QM`-`QZ` and `XA`-`XZ` for private use, so
  they name no country and can never clear the check.
- **Over-blocking**: the licence says "European Union", so Norway, Iceland,
  Liechtenstein and Switzerland are outside the exclusion as drafted. Refusing
  them would be its own harm.

**US export control is not the binding constraint here.** Downloading published
open-weight models into the US is an import, and ECCN 4E091 does not control
weights published under 15 CFR §734.7. The 2025 AI Diffusion Rule that most
compliance memos cite was rescinded by BIS in May 2025. Self-hosting on our own
infrastructure is the mitigation for the deemed-export risk, not the problem.
The live regulatory watch item is the Commerce ICTS framework (15 CFR Part 791),
which has not yet been applied to general-purpose AI models but is the hook that
would be used. Customer procurement policy is likelier to bite before regulation
does. None of this is legal advice, and the DOJ bulk sensitive data rule (28 CFR
Part 202) is worth counsel's eye if we handle video of identifiable people at
scale.

**Do not detect this by text-searching licences for "European Union".** The
LTX-2.x Community License contains the phrase in a consumer-protection savings
clause and would false-positive.
