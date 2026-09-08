// Where the customer is, asked of the edge rather than the browser.
//
// The video engine's publisher licenses it for a territory, so the render path
// needs a location that did not come from the thing being gated. The Worker
// answers `/edge/region` from Cloudflare's own view of the connection; a
// browser API would be either absent (no geolocation permission for this) or
// trivially set by the person it is meant to constrain.
//
// This is the client's copy of a server decision. It is not the trust
// boundary - the render service must make the same check - but it is what the
// Studio shows the customer, and it must never be more permissive than the
// server would be.

import { API_ORIGIN } from './api-root.js';

const REGION_URL = `${API_ORIGIN}/edge/region`;

let inflight = null;
let resolved = null;

/**
 * The customer's two-letter country, or null when it could not be established.
 *
 * Cached for the life of the page once known. A failed lookup is NOT cached:
 * an offline moment must not pin the session to "unknown" for as long as the
 * tab stays open, because the gate that reads this fails closed.
 */
export async function customerCountry() {
  if (resolved) return resolved;
  if (!inflight) {
    inflight = (async () => {
      try {
        const response = await fetch(REGION_URL, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: AbortSignal.timeout(6000)
        });
        if (!response.ok) return null;
        const body = await response.json();
        const country = typeof body?.country === 'string' ? body.country.trim().toUpperCase() : '';
        return /^[A-Z]{2}$/.test(country) ? country : null;
      } catch {
        return null;   // offline, blocked, or too slow - the gate decides what that means
      }
    })().then(country => {
      // Only a definite answer is remembered. Clearing the in-flight promise on
      // failure is what lets the next render try again instead of inheriting
      // one bad moment for the life of the tab.
      if (country) resolved = country; else inflight = null;
      return country;
    });
  }
  return inflight;
}

/** Forget the cached country. For a signed-out session or a test. */
export function forgetRegion() { resolved = null; inflight = null; }
