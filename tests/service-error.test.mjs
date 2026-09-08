import test from 'node:test';
import assert from 'node:assert/strict';
import { readableServiceError } from '../studio/js/service-error.js';

test('a transport failure never shows the browser wording', () => {
  for (const raw of ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource', 'signal timed out']) {
    assert.equal(readableServiceError(new Error(raw)), 'the service could not be reached', raw);
  }
  assert.equal(readableServiceError(Object.assign(new Error('x'), { name: 'TypeError' })), 'the service could not be reached');
  assert.equal(readableServiceError(Object.assign(new Error('x'), { name: 'AbortError' })), 'the service could not be reached');
});

test('an empty or missing error still reads as a sentence', () => {
  for (const value of [null, undefined, '', new Error('')]) {
    assert.equal(readableServiceError(value), 'the service could not be reached');
  }
});

test('known service codes are spelled out', () => {
  assert.equal(readableServiceError(new Error('request_unavailable')), 'the service did not answer');
  assert.equal(readableServiceError(new Error('unauthorized')), 'this account is not signed in');
  assert.equal(readableServiceError(new Error('rate_limited')), 'too many requests were made just now');
});

test('an unknown machine code is at least made readable', () => {
  assert.equal(readableServiceError(new Error('wallet_hold_expired')), 'wallet hold expired');
});

test('a message already written for a person is left alone', () => {
  const written = 'This period is already closed for reconciliation.';
  assert.equal(readableServiceError(new Error(written)), written);
});

test('the result always slots into the surrounding sentence', () => {
  const sentence = `Usage is unavailable: ${readableServiceError(new Error('Failed to fetch'))}.`;
  assert.equal(sentence, 'Usage is unavailable: the service could not be reached.');
});
