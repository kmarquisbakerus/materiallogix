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
  legal, identity, anatomy, consent, or rights correctness;
- Single Studio Pro and Pro Studio are published tiers with no checkout SKU and
  no plan in the licence model, so the site states that neither can be bought
  online yet; they must not be sold until both exist;
- cloud Video credit is advertised at $20 per paid period but the cloud lane
  itself is not production-enabled, so no credit is issued to anyone yet.

Cloud charging and production account claims must remain unavailable until the
zero-trust backend and release acceptance tests are complete.
