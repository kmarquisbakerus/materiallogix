// Google and Apple sign-in.
//
// Both are built and wired, and both stay off until the server says otherwise.
// The switches are the ordinary server-controlled feature flags, so they can be
// turned on from Operations the day each developer account is approved - no
// release, no code change. Nothing renders while a provider is off, because a
// button that cannot work is worse than no button.

import { apiUrl } from './api-root.js';
import { featureEnabled } from './features.js';

export const ACCOUNT_PROVIDERS = Object.freeze([
  Object.freeze({
    id: 'google',
    flag: 'google_sign_in',
    label: 'Continue with Google',
    start: '/api/auth/google/start',
    pending: 'Google sign-in turns on here once the Google developer account is approved.'
  }),
  Object.freeze({
    id: 'apple',
    flag: 'apple_sign_in',
    label: 'Continue with Apple',
    start: '/api/auth/apple/start',
    pending: 'Apple sign-in turns on here once the Apple developer account is approved.'
  })
]);

export const ACCOUNT_PROVIDER_BY_ID = Object.fromEntries(ACCOUNT_PROVIDERS.map(provider => [provider.id, provider]));

/**
 * Where to send the browser to begin a sign-in.
 *
 * The return address is carried as a same-origin path only. An absolute or
 * cross-origin `returnTo` would turn this into an open redirect, so anything
 * that is not a plain path on this origin falls back to the current page.
 */
export function providerStartUrl(providerId, returnTo = typeof location === 'undefined' ? '/' : location.pathname + location.search) {
  const provider = ACCOUNT_PROVIDER_BY_ID[providerId];
  if (!provider) throw new Error('Unknown sign-in provider.');
  const url = new URL(apiUrl(provider.start), typeof location === 'undefined' ? 'https://materiallogix.com' : location.href);
  url.searchParams.set('return_to', safeReturnPath(returnTo));
  return url.toString();
}

export function safeReturnPath(value) {
  const raw = String(value ?? '');
  // A path, not a URL: no scheme, no authority, no protocol-relative form.
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\]/.test(raw)) return '/';
  try {
    const resolved = new URL(raw, 'https://materiallogix.invalid');
    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return '/';
  }
}

/** The providers this viewer may actually use, in declared order. */
export async function enabledAccountProviders(isEnabled = featureEnabled) {
  const states = await Promise.all(ACCOUNT_PROVIDERS.map(async provider => {
    try { return (await isEnabled(provider.flag)) === true; } catch { return false; }
  }));
  return ACCOUNT_PROVIDERS.filter((_, index) => states[index]);
}
