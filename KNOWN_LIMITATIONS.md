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
| Cloud photo | per job | $1 | ~$0.26 |
| Cloud voice render | per job, any script length | $1 | ~$0.27 |
| Cloud voice conditioning | per job | $2 | ~$0.40 |
| Cloud video | per output minute | $2 | $1.31 measured |

Whole dollars, deliberately. A surcharge is the one charge a customer meets
after they have already decided to buy, and loose change on top of a price reads
as a surprise fee however small it is.

The surcharge only has to cover the GPU. The product's margin lives in the
deliverable price the customer already paid; asking the surcharge to carry it
too is what produced the old ladder below, where a cloud minute was a flat
second retail price instead of the $4.99 deliverable plus the $2 the GPU
actually costs.

That separation also closes a hole. A plan unit earns about three cents, and a
cloud job costs twenty-six, so a cloud render billed against monthly units
would lose money on every job. Units buy the file; credit buys the cloud.

What that means for a customer:

| | No plan, all in | With a plan |
| --- | --- | --- |
| One photo, local | $2.99 | 1 unit |
| One photo, in the cloud | $3.99 | 1 unit + $1 credit |
| Ten-minute script, local | $29.90 | 10 units |
| Ten-minute script, in the cloud | $30.90 | 10 units + $1 credit |
| One video minute, local | $4.99 | 4 units |
| One video minute, in the cloud | $6.99 | 4 units + $2 credit |

The $20 included credit buys **20 cloud photos, or 20 cloud voice renders of
any length, or ten minutes of cloud video**.

### We are not the expensive option, and should stop pricing as if we might be

Measured against the market, in-plan, per finished unit:

| | Us, in plan | Nearest competitor |
| --- | --- | --- |
| Video minute | **$0.12** | Kling Ultra $4.99 · Runway Pro $8.96 · Veo 3.1 $24.00 |
| Voice minute | **$0.03** | ElevenLabs Creator $0.182 · Resemble $0.03 |
| Photo | **$0.03** | Midjourney Basic $0.05 list |
| Voice entry tier | **$5/mo, 30 min** | ElevenLabs Starter $6/mo, ~30 min |

We are 40x to 200x under the market per video minute and 5-6x under it per
voice minute, because local rendering costs us nothing and the allowances pass
that straight to the customer. That is the wedge, and it is deliberate.

It also means the cloud surcharge is the wrong thing to discount. It is the
only charge attached to a cost we actually pay, on the only lane whose cost
scales. Cutting it would give away margin we do not need to give away, on a
price list already far below everybody else's.

Competitor figures came from third-party pricing aggregators: direct fetches to
vendor pricing pages were blocked from the build environment, so **not one of
them is primary-source verified**. Confirm before quoting externally.

### The old ladder

`RENDER_PRICES` is the whole ladder, and everything reads it:

| | On the customer's machine | In the cloud |
| --- | --- | --- |
| One clean photo | **$2.99** | **$3.99** |
| One clean minute of audio | **$2.99** | **$3.99** |
| One clean minute of video | **$4.99** | **$6.99** |

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
GPUs and sells for **$6.99** - the same $4.99 deliverable plus the $2
surcharge.

Price and metering are now separate. A video minute still spends **four units**
of a plan's monthly allowance, because it is four times the work of an image -
but it is priced on its own rather than at four units of list, which is where
the previous $11.96 came from.

The only measured cost in the model is `MEASURED_VIDEO_COST`: **$1.31 per
output minute** for native 4K on a community RTX 4090 pool at $0.34/hr, which
leaves 35% on the $2 surcharge and 81% on the $6.99 a no-plan cloud minute
costs. That figure is extrapolated from **a single ten-second
run** and the sixty-second checkpoint has never been run. Roughly a fifth of the
cost is fixed pod lifecycle, so longer jobs should come in cheaper per minute
and this is the pessimistic case. `productionEnabled` stays `false` until a
production-length fixture confirms it, and a test fails the build if that flag
is opened while `productionLengthConfirmed` is still false.

**Consequence to decide before launch:** the included $20 cloud credit bought
6m 40s of video at the old $3.00/min. At the $2 surcharge it buys **10
minutes**, or 20 cloud photos. The site
promises "$20 of cloud credit each paid period" and that is still exactly what
it grants - but if the intent was a number of *minutes* rather than a number of
*dollars*, the credit has to rise with the rate.

Two of the six advertised plans, Single Studio Pro and Pro Studio, were sold on
the Pro Motion Engine, premium voice minutes, free cloud upscaling and a 20%
wallet discount. Not one of the four is switched on, and the entire delta a Pro
licence delivers today is the voice-profile cap: five personal clones instead
of one. The two Pro panels in `index.html` now say exactly that - the clone
count under "Pro adds today", the other four under "Not in this release", each
with the sentence that until they ship a Pro licence renders as its standard
tier does. Prices are unchanged, so the cards carry a disclosure rather than a
withdrawal; withdrawing the six `single_pro_*` and `pro_*` rows from
`stripeCatalogue()` is the only change that removes the exposure outright, and
it is a `pricing.js` change, not a copy change.

## Client contracts the billing service must honour

The billing API lives outside this repository, so these names are a contract
rather than an implementation:

| Client call | What it sends | Why it matters |
| --- | --- | --- |
| `POST /api/checkout/session` | `sku` of `export_image`, `export_audio` or `export_video` | The Free Preview card sells all three; a SKU the service does not know is a checkout that fails after the customer clicked. |
| `POST /api/checkout/session` | `sku` of `<plan>_<term>`, e.g. `single_pro_photo_yearly` | The two Pro tiers are now buyable from the site. |
| `POST /api/billing/portal` | the active licence key | Usage offers **Manage billing**; a subscription needs a way out as well as a way in. |
| `GET /api/usage` | — | `license.plan` is rendered through `planLabel()`, so the service may keep sending plan ids. |
| `GET /api/checkout/result?session_id=&claim=` | the pair Stripe returned in the success URL | Returns `{ licenseKey }` once the webhook has been processed, or a non-2xx with `{ error }` while it has not. This is the only thing that turns a payment into a licence. |
| `POST /api/license/check` | the licence key | May return `assertion`: a `MLA1.<payload>.<sig>` token signed with the licence signing key, binding `lid` and `okAt`. Without it the offline grace window rests on an unsigned local record that anyone can recompute in devtools; with it, a forged `okAt` is ignored. The client verifies and prefers it already. |

### The operations console

`_worker.js` serves `/studio/admin*` only to a Cloudflare Access session whose
JWT verifies against the team's published keys, with the audience and expiry
checked. That needs two Worker environment variables:

| Variable | Value |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | e.g. `yourteam.cloudflareaccess.com` |
| `ACCESS_AUD` | the Access application's audience tag |

**Unconfigured, the console returns 404 to everyone, including the team.** That
is deliberate: the first version of this gate checked only that a header was
present, so `Cf-Access-Jwt-Assertion: anything` returned 200, and a check that
looks like authentication and is not is worse than none. Set both before
expecting the console to open.

### The Stripe success URL

The billing service, not this repository, decides where Stripe returns the
customer. `checkout-result.js` is therefore loaded on the marketing homepage
(lazily, only when a claim is present) and on every Studio page - Studio,
Voice, Usage and Operations - so any of those landing spots redeems the claim.
**If the service is configured to return to a path not on that list, the
customer pays and is never licensed.** Confirm the configured `success_url`
before release.

It is loaded last on each page on purpose: the module has a top-level `await`,
so an earlier position would hold the whole page on a fulfilment lookup. The
lookup carries a ten second timeout for the same reason. When the webhook
trails the redirect the claim is held in `sessionStorage` and redeemed on the
next visit; the journey suite drives both halves of that.

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
| `personalClones` | `voiceProfileLimit`, then `voice.html` | - shipped, and the only thing a Pro tier gives that its standard tier does not |
| `motionEngine: 'pro'` | `video-engine.js`, on every render | the Pro Motion Engine is not shipped - the gate runs and records "no generative engine" |
| `voice.quality: 'premium'` | nothing | premium voice models are not shipped |
| `includedMinutes`, `extraPricePerHour` | nothing | premium voice models are not shipped |
| `cloudUpscaleIncluded`, `freeUpscalePlans` | nothing | the cloud lane is disabled, and `quoteCloudJob` is never passed a licence |
| `walletDiscount` | `walletTopUpCents`, which no product module calls | the refill flow posts the undiscounted amount |

`voice.maxWords`, `voice.multiTake` and `upscale.model` were in this table and
do not belong in it. `LANES.pro` spreads `LANES.paid` and overrides none of the
three, so `scriptAllowance`, `allowsMultiSourceVoicePack` and
`upscaleModelsForLane` return the same answer for both. They separate free from
paid, not standard from Pro, and counting them here is how two tiers came to
look walled when only one field was.

A Pro licence today therefore renders exactly like its standard tier, and both
Pro cards now say so in the card itself. Until the engines exist, the copy is
the wall; `stripeCatalogue()` is where an actual withdrawal would go.

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
payment processor and the page a customer read cannot disagree. 29 SKUs: 25
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
all, and `renderEditedVideo` had no `covers()` check.

**Correction to an earlier reading of this.** It was first written up here as
"an unlicensed customer could render a finished, unmarked video". That was
wrong, and wrong in the direction of alarm: `authorizeOutbound` returns
`license_required` when there is no licence key, so an anonymous user never
reaches the renderer. The exposure is narrower and more specific - **a licence
that does not cover video**: a Photo-only or Voice-only Single Studio, a Voice
Starter, a suspended licence of any tier. Those hold a key, so they clear
authorization, and the client never checked coverage before rendering.

The fix is the same either way, because the lane already resolves those cases
to `LANES.free`. But the description mattered, and the first one came from
reading the render function without tracing the authorization path in front of
it. `tests/tiers.test.mjs` now pins the real case.

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

**The restriction reaches Pro only.** HunyuanVideo *is* the Pro Motion Engine -
the thing the Pro tiers are sold on. The free and standard lanes run Wan 2.2,
which is Apache-2.0 with no territorial condition. So a free or standard
customer never touches the restricted engine anywhere in the world, and the
territory question only arises for a Pro render.

A Pro customer in an excluded territory drops to the standard engine rather
than losing video: they lose the upgrade, which is a fair outcome, not the
product. The Studio says so plainly instead of downgrading in silence and
leaving them to wonder why it looks different.

The site carries the same disclosure. Every place it sells the Pro Motion
Engine carries a footnote mark, and the note says which territories, what a
customer there gets instead, and that the Studio always names the engine that
produced a file. A test fails the build if a claim is made without the mark.

### How the gate is wired

`model-licence.js` decides what a territory permits. It is consumed by exactly
one piece of product code, `video-engine.js`, which is the only path to an
engine; a test fails the build if any other module imports a decision from it.
Both render paths - this device and the cloud - ask it before every render,
and its answer travels in the job (`opts.engine`, and `manifest.engine` with
the region it was decided on) and onto the produced file's provenance line.

The region comes from `GET /edge/region`, answered by the Worker from
Cloudflare's view of the connection with `Cache-Control: no-store`. The
browser is the thing being gated, so it is not asked. Off the edge the answer
is "unknown", and a generative render on a territorial engine fails closed on
"unknown"; an editorial render of the customer's own footage has no
territorial question and is unaffected, so the offline product still works.

**No generative engine is enabled** - `ENABLED_VIDEO_ENGINES` is empty and a
test pins it to what this file says. Every render today records "no
generative video model was used", which is what the terms now say. Adding an
engine id to that list is the one switch that turns the engine, its territory
gate, its switch in the cloud dialog and its disclosure on together; the gate
is proven against an injected two-engine build for every excluded state and a
client that explicitly asks for the restricted engine from Dublin.

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

## One defect, found seven times

Seven separate defects in this session had a single cause: **a tier was declared
in the price list and forgotten in a table somewhere else**, so it fell through
to whatever the fallback happened to be. Every one gave a paying customer less
than they bought, and every one was silent.

| What fell through | What the customer got |
| --- | --- |
| Upscale model list | a free preview could pick the licensed 4x model |
| Preview word cap | an unlicensed preview read a script of any length |
| Composite voice packs | a free preview outranked a paying Voice Starter |
| Personal voice profiles | a free preview kept unlimited ones; Starter kept one |
| Video watermark rules | an unlicensed render returned a clean MP4 |
| Lane export descriptors | prose no renderer could act on |
| **Voice ladder** | **a $39 Pro Studio customer could not train a voice; a $15 Single Studio customer could** |

The cause is structural, not careless. The Pro tiers were added to `pricing.js`
and to nothing else, and nothing anywhere asked whether a tier that appears in
`PRODUCTS` appears in the tables that decide what it receives.

`tests/tiers.test.mjs` asks that question of the code rather than assuming it.
For every plan the price list sells, on every product, it reads what the tier
actually receives - units, cloud credit, voice profiles, reference audio,
composite packs, script length, upscale models, watermarking - and holds four
rules:

1. **No paid tier receives less than the free preview.**
2. **A Pro tier is never worse than the tier it upgrades** (`single_pro` against
   `single`, `pro` against `full`).
3. **A covered Studio is never delivered watermarked.** That is the whole point
   of paying, and a tier missing from the lane table used to fall through to the
   free lane, which stamps everything.
4. **A suspended licence falls to the free tier, never through it.**

Verified against three separate reintroductions - removing the `single_pro`
rung from the voice ladder, dropping `pro` from the cloud-credit table, and
removing `pro` from `laneFor` - each of which the suite catches in two to four
places.

This is the check that would have caught all seven, and it is the one to run
first when a tier is added.

## Statements corrected against the code, and what is still blank

Four published statements said something the product does not do. Each is now
what the code does, and `tests/claims.test.mjs` pins the number to the function
it comes from so it cannot drift back:

| Statement | Was | Is | Pinned to |
| --- | --- | --- | --- |
| `legal/terms.html` Voice Starter allowance | 60 finished voice minutes | 30 | `MONTHLY_UNITS.voice_starter` |
| `legal/terms.html` Voice Starter auditions | "unlimited marked audition previews" | every take renders clean and spends allowance | `VOICE_STARTER_LANE.voice.stamped === false` |
| `legal/refunds.html` over-$50 purchases | "the Full Studio three-month term and both annual terms" | no list at all | `stripeCatalogue()` - 13 SKUs are over $50, five of them quarterly |
| `index.html` "never use your allowance" | said of every preview, on four cards | said only of the proof export, which authorizes zero units | the proof branch in `doExport` |

The refund page names no SKUs on purpose. A list of what costs over $50 is a
second copy of the price table, and the rule reads the same without it.

### Facts the documents still need from outside this repository

Every one of these is written into the page as a literal
`[TO BE COMPLETED: ...]` marker, so a page shipped with one still in it is
visibly unfinished rather than quietly wrong.

`legal/terms.html`
- state of formation, company registration number and registered office address
  of LibraSide Technologies, LLC
- date, scope, conformance level and known exceptions of an accessibility
  assessment - none has been carried out, and the page says so rather than
  claiming WCAG 2.2 AA
- the accessibility enforcement body for each country we sell into

`legal/privacy.html`
- retention periods for account and licence records, consent records, cloud-job
  records, cloud-job media and output, security events, and billing records
- name, address and email of the Article 27 representative in the EU, and of
  the one in the UK. Voice packs and identity reference sets are Article 9
  data, so the "occasional processing" exemption does not reach us and both
  appointments are required
- the transfer mechanism for personal data leaving the EEA and the UK

## What the terms carry, and what they cannot

Passing the territorial restriction down in the customer terms handles the
downstream half of this, and only the downstream half. The two are worth keeping
apart because they fail differently.

**Downstream - the terms handle it.** A customer who publishes their own video
to a global platform is making their own decision about their own work.
Hunyuan §6(d) is explicit: "You and Your users are solely responsible for
Outputs and their subsequent uses." Passing the restriction to downstream
recipients is what §3(a) contemplates, and the customer, not us, is the
publisher.

**Upstream - the terms cannot.** If we render Hunyuan output for a customer in
the excluded territories, that is us using and displaying outside the Territory.
A contract with our customer cannot grant us rights Tencent never gave us. Only
the geofence fixes that, and it is not optional.

The terms now say which engines exist, which territory the restricted one is
licensed for, that excluded regions are served by an unrestricted engine, and
that a customer who intends to publish worldwide may choose the unrestricted
engine instead. That last sentence is a promise, so the suite holds it: there
must be an unrestricted engine available in every territory, and the code must
be able to say which engine produced a file. A promise in the terms that the
code does not keep is a false statement, not a missing feature - the tests fail
if either side is removed.

None of this is legal advice, and the terms wording should go past counsel
before launch. The licence analysis it rests on is quoted verbatim in the
section above so counsel can check the reading rather than take it on trust.
