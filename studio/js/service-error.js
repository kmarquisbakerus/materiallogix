// One place to turn a failed request into something a customer can act on.
// Browsers raise transport failures as "Failed to fetch" or "Load failed", and
// the API answers with machine codes like `request_unavailable`. Neither
// belongs on screen.

const TRANSPORT = /failed to fetch|load failed|networkerror|network request failed|connection (?:refused|reset)|the operation was aborted|signal timed out|timed? ?out/i;
const TRANSPORT_NAMES = new Set(['TypeError', 'AbortError', 'TimeoutError', 'NetworkError']);

const KNOWN_CODES = Object.freeze({
  request_unavailable: 'the service did not answer',
  unauthorized: 'this account is not signed in',
  forbidden: 'this account is not allowed to see it',
  not_found: 'it could not be found',
  rate_limited: 'too many requests were made just now',
  payment_required: 'the account needs an active payment method'
});

/**
 * A lower-case fragment that reads correctly after "… is unavailable: ".
 * Anything already written for a person is passed through untouched.
 */
export function readableServiceError(error) {
  const raw = String(error?.message ?? error ?? '').trim();
  if (!raw || TRANSPORT_NAMES.has(error?.name) || TRANSPORT.test(raw)) return 'the service could not be reached';
  if (KNOWN_CODES[raw]) return KNOWN_CODES[raw];
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(raw)) return raw.replaceAll('_', ' ');
  return raw;
}
