# The journey

One script that uses the whole product the way a customer does: arrive, start a
project, try it free, hit the paywall, pay, edit a photo, generate one, fill
part of it, enhance it, cut a clip, direct a voice, deliver every way the
product offers, check the wallet and the ledger, and work with the network off.

It exists because unit tests cannot tell you that a slider moves the picture.

## Running it

The journey drives a real browser, so unlike `npm test` it needs two things
that are deliberately not repository dependencies:

```bash
npm install --no-save playwright-core
JOURNEY_CHROME=/path/to/chromium npm run journey
```

Any Chromium build works. If Playwright already manages one, point
`JOURNEY_CHROME` at it; `CHROME_PATH` is honoured too.

Nothing else is required. The script starts its own static server on 8099 and
its own engine stub on 8188, mints a licence in memory for the run, and stubs
the billing service. It stops all of them when it finishes.

## What it stands up

| File | What it is |
| --- | --- |
| `serve.mjs` | Static server for the repository |
| `engine-stub.mjs` | A ComfyUI-compatible stand-in that returns a real PNG |
| `harness.mjs` | Mints a run-scoped licence, stubs billing, opens a session |
| `journey.mjs` | The journey itself |

The licence is signed with a keypair generated for that run, and the shipped
public key is swapped at the network edge so it verifies. No product code is
modified and no real key is involved.

## Reading the result

Every step prints `PASS` or `**FAIL**` with what it saw. The run exits non-zero
if any step fails **or** if the page logged a single console error, because a
customer-facing error is a failure whether or not the step it happened in
carried on working.
