import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ACCOUNT_PROVIDERS, ACCOUNT_PROVIDER_BY_ID, providerStartUrl, safeReturnPath, enabledAccountProviders
} from '../studio/js/account-providers.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('Google and Apple are both declared and both start on the server', () => {
  assert.deepEqual(ACCOUNT_PROVIDERS.map(p => p.id), ['google', 'apple']);
  for (const provider of ACCOUNT_PROVIDERS) {
    assert.match(provider.start, /^\/api\/auth\/[a-z]+\/start$/, `${provider.id} must begin server-side`);
    assert.ok(provider.flag, `${provider.id} must be behind a flag`);
    assert.ok(provider.label && provider.pending, `${provider.id} must be able to explain itself`);
  }
});

test('no provider is on by default, and an unreadable flag keeps it off', async () => {
  // The developer accounts are not approved yet: a viewer must see nothing.
  assert.deepEqual(await enabledAccountProviders(async () => false), []);
  assert.deepEqual(await enabledAccountProviders(async () => undefined), []);
  assert.deepEqual(await enabledAccountProviders(async () => 'true'), [], 'only a real true counts');
  assert.deepEqual(await enabledAccountProviders(async () => { throw new Error('offline'); }), []);
});

test('the server can turn each provider on independently', async () => {
  const only = flag => async key => key === flag;
  assert.deepEqual((await enabledAccountProviders(only('google_sign_in'))).map(p => p.id), ['google']);
  assert.deepEqual((await enabledAccountProviders(only('apple_sign_in'))).map(p => p.id), ['apple']);
  assert.deepEqual((await enabledAccountProviders(async () => true)).map(p => p.id), ['google', 'apple']);
});

test('the start URL carries the provider and a same-origin return path', () => {
  const url = new URL(providerStartUrl('google', '/studio/index.html?x=1'));
  assert.equal(url.pathname, '/api/auth/google/start');
  assert.equal(url.searchParams.get('return_to'), '/studio/index.html?x=1');
  assert.match(providerStartUrl('apple'), /\/api\/auth\/apple\/start/);
  assert.throws(() => providerStartUrl('facebook'), /Unknown sign-in provider/);
});

test('a return address can never leave this origin', () => {
  // Otherwise the sign-in entry point is an open redirect.
  for (const hostile of ['//evil.example', 'https://evil.example/x', 'http://evil.example',
                         '\\\\evil.example', '/\\evil.example', 'javascript:alert(1)', 'evil', '', null, undefined]) {
    assert.equal(safeReturnPath(hostile), '/', `${JSON.stringify(hostile)} must not survive`);
  }
  assert.equal(safeReturnPath('/studio/'), '/studio/');
  assert.equal(safeReturnPath('/studio/index.html?a=1&b=2'), '/studio/index.html?a=1&b=2');
  assert.equal(safeReturnPath('/ok#fragment'), '/ok', 'a fragment never reaches the server');
});

test('nothing renders a provider without consulting its flag', () => {
  const app = readFileSync(resolve(ROOT, 'studio/js/app.js'), 'utf8');
  assert.match(app, /enabledAccountProviders\(\)/, 'the panel must ask which providers are enabled');
  const rendersDirectly = /ACCOUNT_PROVIDERS\b/.test(app);
  assert.equal(rendersDirectly, false, 'the panel must never render the declared list directly');
});
