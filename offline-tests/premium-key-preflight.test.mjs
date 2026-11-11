// Fabricated HTTP/context objects only. No live authentication or service requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertFreshPremiumAuthCache, assertNoRegisteredGeminiKey, assertSessionIdentity, IDENTITY_COOKIE_NAME, IDENTITY_COOKIE_NAMES, dedicatedAccount, PremiumKeyPreflightError,
  USER_SETTING_ENDPOINT } from '../scripts/premium-key-preflight.mjs';
import { MATRIX, LOGIN_ENDPOINT } from '../scripts/branch-verification-guard.mjs';
import { run } from '../scripts/run-branch-verification.mjs';
const CANARY = 'SYNTHETIC_PRIVATE_RESPONSE_MUST_NOT_ESCAPE';
const env = { PWAPPY_TEST_LOGIN_ENDPOINT: LOGIN_ENDPOINT, PWAPPY_TEST_LOGIN_PASSCODE: 'SYNTHETIC_PASSCODE',
  PWAPPY_TEST_ACCOUNT_INDEX: '0', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
const noKey = { code: 200, details: { userSetting: { isUserGeminiApiKeyRegistered: false } } };
function fake(options = {}) {
  const calls = [];
  let issuedIdentity;
  const response = (kind, body) => ({
    status: () => options[kind + 'Status'] ?? 200,
    url: () => options[kind + 'URL'] ?? (kind === 'login' ? LOGIN_ENDPOINT : USER_SETTING_ENDPOINT),
    json: async () => {
      calls.push('json');
      assert.equal(kind, 'settings', 'Do not read the login response or actual credential value');
      if (options.invalidJSON) throw new Error(CANARY);
      return body;
    },
  });
  const context = {
    post: async (url, input) => {
      calls.push({ method: 'POST', url, input });
      issuedIdentity = input.data.identkey;
      if (options.loginFailure) throw new Error(CANARY);
      return response('login');
    },
    get: async (url, input) => {
      calls.push({ method: 'GET', url, input });
      if (options.settingsFailure) throw new Error(CANARY);
      return response('settings', Object.hasOwn(options, 'body') ? options.body : noKey);
    },
    storageState: async (...args) => {
      assert.deepEqual(args, [], 'Storage state must never be persisted to a path');
      calls.push('storageState');
      if (options.storageFailure) throw new Error(CANARY);
      return Object.hasOwn(options, 'state') ? options.state : { cookies: [{
        name: IDENTITY_COOKIE_NAME, value: issuedIdentity, domain: '.pwappy-dev.com',
        path: '/', secure: true, httpOnly: true, expires: -1,
      }] };
    },
    dispose: async () => { calls.push('dispose'); if (options.disposeFailure) throw new Error(CANARY); },
  };
  const request = { newContext: async options => {
    calls.push({ newContext: options });
    if (Object.hasOwn(options, 'storageState')) assert.fail('Must not load/save an existing auth session');
    return context;
  } };
  return { request, calls };
}
const safeError = (reason) => error => error instanceof PremiumKeyPreflightError
  && error.message.includes(reason) && !error.message.includes(CANARY)
  && !error.message.includes(env.PWAPPY_TEST_LOGIN_PASSCODE);

test('all six matrix accounts match existing OS/browser/index-zero identity derivation', async () => {
  const identities = ['pwuc000', 'pwua000', 'pwuf000', 'pwwc000', 'pwms000', 'pwmi000'];
  for (const [index, entry] of MATRIX.entries()) {
    assert.equal(dedicatedAccount(entry.browser, entry.os), identities[index]);
    const f = fake();
    const result = await assertNoRegisteredGeminiKey(entry.browser, entry.os, env, f.request);
    assert.equal(result, undefined, 'No response/user setting/cookie is returned');
    assert.deepEqual(f.calls[0], { newContext: { ignoreHTTPSErrors: false } });
    assert.deepEqual(f.calls[1], { method: 'POST', url: LOGIN_ENDPOINT, input: {
      data: { passcode: env.PWAPPY_TEST_LOGIN_PASSCODE, identkey: identities[index] },
      maxRedirects: 0, maxRetries: 0, timeout: 15000, failOnStatusCode: false,
    } });
    assert.equal(f.calls[2], 'storageState');
    assert.deepEqual(f.calls[3], { method: 'GET', url: USER_SETTING_ENDPOINT, input: {
      maxRedirects: 0, maxRetries: 0, timeout: 15000, failOnStatusCode: false,
    } });
    assert.deepEqual(f.calls.slice(4), ['json', 'dispose']);
  }
});

test('wrong account/endpoint configuration is rejected before creating an authenticated context', async () => {
  for (const changes of [{ PWAPPY_TEST_LOGIN_ENDPOINT: 'https://other.invalid/test-login' },
    { PWAPPY_TEST_LOGIN_ENDPOINT: LOGIN_ENDPOINT + '?token=' + CANARY },
    { PWAPPY_TEST_LOGIN_PASSCODE: '' }, { PWAPPY_TEST_LOGIN_PASSCODE: undefined },
    { PWAPPY_TEST_ACCOUNT_INDEX: '1' }, { PWAPPY_TEST_ACCOUNT_INDEX: undefined }]) {
    const f = fake();
    await assert.rejects(assertNoRegisteredGeminiKey('chromium', 'ubuntu-latest', { ...env, ...changes }, f.request), safeError('configuration'));
    assert.deepEqual(f.calls, []);
  }
  const f = fake();
  await assert.rejects(assertNoRegisteredGeminiKey('firefox', 'windows-latest', env, f.request), safeError('configuration'));
  assert.deepEqual(f.calls, []);
});

for (const [name, body, reason] of [
  ['registered real or unknown existing key', { code: 200, details: { userSetting: { isUserGeminiApiKeyRegistered: true } } }, 'already has a registered'],
  ['missing body', undefined, 'malformed'], ['null body', null, 'malformed'],
  ['bad API code', { ...noKey, code: 500 }, 'malformed'],
  ['string API code', { ...noKey, code: '200' }, 'malformed'],
  ['missing details', { code: 200 }, 'malformed'],
  ['missing settings', { code: 200, details: {} }, 'malformed'],
  ['missing flag', { code: 200, details: { userSetting: {} } }, 'malformed'],
  ['null flag', { code: 200, details: { userSetting: { isUserGeminiApiKeyRegistered: null } } }, 'malformed'],
  ['string false flag', { code: 200, details: { userSetting: { isUserGeminiApiKeyRegistered: 'false' } } }, 'malformed'],
  ['number zero flag', { code: 200, details: { userSetting: { isUserGeminiApiKeyRegistered: 0 } } }, 'malformed'],
]) {
  test(`fail closed and dispose for ${name}`, async () => {
    const f = fake({ body });
    await assert.rejects(assertNoRegisteredGeminiKey('chromium', 'ubuntu-latest', env, f.request), safeError(reason));
    assert.equal(f.calls.at(-1), 'dispose');
    assert.equal(f.calls.filter(call => call === 'dispose').length, 1);
    assert.deepEqual(f.calls.filter(call => call.method).map(call => call.method), ['POST', 'GET']);
  });
}

for (const options of [{ loginStatus: 302 }, { loginStatus: 401 }, { loginFailure: true },
  { loginURL: 'https://other.invalid/' + CANARY }]) {
  test(`login failure or redirect cannot reach user settings (${Object.keys(options)[0]})`, async () => {
    const f = fake(options);
    await assert.rejects(assertNoRegisteredGeminiKey('chromium', 'ubuntu-latest', env, f.request), safeError('login was unavailable'));
    assert.equal(f.calls.at(-1), 'dispose');
    assert.deepEqual(f.calls.filter(call => call.method).map(call => call.method), ['POST']);
  });
}

for (const options of [{ settingsStatus: 302 }, { settingsStatus: 500 }, { settingsFailure: true },
  { invalidJSON: true }, { settingsURL: 'https://other.invalid/' + CANARY }]) {
  test(`settings failure or redirect cannot permit tests (${Object.keys(options)[0]})`, async () => {
    const f = fake(options);
    await assert.rejects(assertNoRegisteredGeminiKey('chromium', 'ubuntu-latest', env, f.request), safeError('malformed'));
    assert.equal(f.calls.at(-1), 'dispose');
    assert.deepEqual(f.calls.filter(call => call.method).map(call => call.method), ['POST', 'GET']);
  });
}

test('context creation/disposal failures never leak transport data and cannot permit tests', async () => {
  await assert.rejects(assertNoRegisteredGeminiKey('chromium', 'ubuntu-latest', env,
    { newContext: async () => { throw new Error(CANARY); } }), safeError('could not be verified'));
  const f = fake({ disposeFailure: true });
  await assert.rejects(assertNoRegisteredGeminiKey('chromium', 'ubuntu-latest', env, f.request), safeError('could not be disposed'));
  assert.equal(f.calls.at(-1), 'dispose');
});

test('registered key stops wrapper before started, spawn and workflow app cleanup eligibility', async () => {
  const root = mkdtempSync(join(tmpdir(), 'premium-key-wrapper-'));
  const output = join(root, 'output'); writeFileSync(output, '');
  const calls = [];
  try {
    const f = fake({ body: { code: 200, details: { userSetting: { isUserGeminiApiKeyRegistered: true } } } });
    await assert.rejects(run('premium', 'chromium', 'ubuntu-latest', 'tests', { ...env, RUNNER_TEMP: root, GITHUB_OUTPUT: output }, {
      authRoot: root,
      guard: async () => { calls.push('stage-guard'); },
      premiumKeyCheck: async (browser, os, childEnv) => {
        calls.push('key-check');
        assert.equal(childEnv.PWAPPY_TEST_ACCOUNT_INDEX, '0');
        await assertNoRegisteredGeminiKey(browser, os, childEnv, f.request);
      },
      spawn: () => assert.fail('No test, key deletion, app mutation or cleanup may run'),
    }), safeError('already has a registered'));
    assert.deepEqual(calls, ['stage-guard', 'key-check']);
    assert.equal(readFileSync(output, 'utf8'), '');
    assert.equal(f.calls.at(-1), 'dispose');
    const workflow = readFileSync(new URL('../.github/workflows/webmcp-branch-verification.yml', import.meta.url), 'utf8');
    assert.match(workflow, /always\(\) && steps.run_tests.outputs.started == 'true'/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('false registration flag is disposed before Premium starts using only the synthetic test key', async () => {
  const root = mkdtempSync(join(tmpdir(), 'premium-key-success-'));
  const output = join(root, 'output'); writeFileSync(output, '');
  const f = fake(), calls = [];
  const originalLog = console.log;
  console.log = () => {};
  try {
    const exit = await run('premium', 'mobile-safari', 'macos-latest', 'tests', { ...env, RUNNER_TEMP: root, GITHUB_OUTPUT: output }, {
      authRoot: root,
      guard: async () => { calls.push('stage-guard'); },
      premiumKeyCheck: async (browser, os, childEnv) => {
        calls.push('key-check'); await assertNoRegisteredGeminiKey(browser, os, childEnv, f.request);
      },
      spawn: (_executable, args, options) => {
        calls.push('tests'); assert.equal(f.calls.at(-1), 'dispose');
        assert.equal(options.env.TEST_GEMINI_API_KEY, 'AIza_TEST_ONLY_WEBMCP');
        assert.ok(args.includes('tests/specs/premium'));
        assert.equal(readFileSync(output, 'utf8'), 'started=true\n');
        writeFileSync(options.env.PWAPPY_BRANCH_COUNTS_PATH, JSON.stringify({ passed: 1, failed: 0, skipped: 0, timedOut: 0, interrupted: 0 }));
        const counts = JSON.parse(readFileSync(options.env.PWAPPY_BRANCH_COUNTS_PATH, 'utf8'));
        const completed = Object.values(counts).reduce((sum, count) => sum + count, 0);
        writeFileSync(options.env.PWAPPY_BRANCH_PROGRESS_PATH, JSON.stringify({ total: completed, completed, counts }));
        writeFileSync(options.env.PWAPPY_BRANCH_FAILURES_PATH, '[]');
        return { status: 0 };
      },
    });
    assert.equal(exit, 0); assert.deepEqual(calls, ['stage-guard', 'key-check', 'tests']);
  } finally { console.log = originalLog; rmSync(root, { recursive: true, force: true }); }
});

test('normal and cleanup do not run the Premium registration/key mutation prerequisite', async () => {
  const root = mkdtempSync(join(tmpdir(), 'premium-key-not-required-'));
  const output = join(root, 'output'); writeFileSync(output, '');
  const originalLog = console.log; console.log = () => {};
  try {
    for (const [suite, phase] of [['normal', 'tests'], ['normal', 'cleanup'], ['premium', 'cleanup']]) {
      const exit = await run(suite, 'chromium', 'ubuntu-latest', phase, { ...env, RUNNER_TEMP: root, GITHUB_OUTPUT: output }, {
        guard: async () => {}, premiumKeyCheck: () => assert.fail('Only Premium test setup checks registration'),
        spawn: (_executable, _args, options) => {
          writeFileSync(options.env.PWAPPY_BRANCH_COUNTS_PATH, JSON.stringify({ passed: 1, failed: 0, skipped: 0, timedOut: 0, interrupted: 0 }));
          const counts = JSON.parse(readFileSync(options.env.PWAPPY_BRANCH_COUNTS_PATH, 'utf8'));
        const completed = Object.values(counts).reduce((sum, count) => sum + count, 0);
        writeFileSync(options.env.PWAPPY_BRANCH_PROGRESS_PATH, JSON.stringify({ total: completed, completed, counts }));
        writeFileSync(options.env.PWAPPY_BRANCH_FAILURES_PATH, '[]'); return { status: 0 };
        },
      });
      assert.equal(exit, 0);
    }
  } finally { console.log = originalLog; rmSync(root, { recursive: true, force: true }); }
});


test('existing auth cache is never reused, overwritten or removed, while absent/empty state is safe', () => {
  const root = mkdtempSync(join(tmpdir(), 'premium-key-cache-'));
  const file = join(root, '.auth', 'user-u-c-0.json');
  try {
    assert.doesNotThrow(() => assertFreshPremiumAuthCache('chromium', 'ubuntu-latest', root));
    mkdirSync(join(root, '.auth'));
    writeFileSync(file, '{}');
    assert.doesNotThrow(() => assertFreshPremiumAuthCache('chromium', 'ubuntu-latest', root));
    writeFileSync(file, JSON.stringify({ cookies: [{ name: 'synthetic', value: CANARY }] }));
    const original = readFileSync(file, 'utf8');
    assert.throws(() => assertFreshPremiumAuthCache('chromium', 'ubuntu-latest', root), safeError('must not be reused'));
    assert.equal(readFileSync(file, 'utf8'), original);
    // An unrelated account's cache cannot change which identity gets checked.
    assert.doesNotThrow(() => assertFreshPremiumAuthCache('firefox', 'ubuntu-latest', root));
    const target = join(root, 'empty-state.json'); writeFileSync(target, '{}');
    symlinkSync(target, join(root, '.auth', 'user-u-f-0.json'));
    assert.throws(() => assertFreshPremiumAuthCache('firefox', 'ubuntu-latest', root), safeError('must not be reused'));
    symlinkSync(join(root, 'absent-state.json'), join(root, '.auth', 'user-u-a-0.json'));
    assert.throws(() => assertFreshPremiumAuthCache('mobile-chrome', 'ubuntu-latest', root), safeError('must not be reused'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('only the registration boolean is inspected, never an actual-key property or response body output', async () => {
  const settings = { isUserGeminiApiKeyRegistered: false };
  Object.defineProperty(settings, 'userGeminiApiKey', { get() { assert.fail('Actual key value must not be read'); } });
  const f = fake({ body: { code: 200, details: { userSetting: settings }, privateCanary: CANARY } });
  const log = console.log, error = console.error, outputs = [];
  console.log = (...args) => outputs.push(args); console.error = (...args) => outputs.push(args);
  try {
    assert.equal(await assertNoRegisteredGeminiKey('chromium', 'ubuntu-latest', env, f.request), undefined);
    assert.deepEqual(outputs, []);
  } finally { console.log = log; console.error = error; }
});


test('service-issued identity cookie accepts only the matching dedicated account and applicable secure domain', () => {
  const valid = { name: IDENTITY_COOKIE_NAME, value: 'pwuc000', domain: '.pwappy-dev.com',
    path: '/', secure: true, httpOnly: true, expires: -1 };
  assert.deepEqual(IDENTITY_COOKIE_NAMES, ['pwappy_ident_key', 'pwappy_ident']);
  for (const name of IDENTITY_COOKIE_NAMES) {
    assert.doesNotThrow(() => assertSessionIdentity({ cookies: [{ ...valid, name }] }, 'pwuc000', 1000));
  }
  for (const domain of ['dev.pwappy-dev.com', '.dev.pwappy-dev.com', '.pwappy-dev.com']) {
    assert.doesNotThrow(() => assertSessionIdentity({ cookies: [{ ...valid, domain }] }, 'pwuc000', 1000));
  }
  assert.doesNotThrow(() => assertSessionIdentity({ cookies: [{ ...valid, expires: 1001 }] }, 'pwuc000', 1000));
  for (const change of [{ name: 'pwappy_identkey' }, { name: 'pwappy_auth' }, { value: 'pwuf000' }, { value: CANARY }, { domain: 'pwappy-dev.com' },
    { domain: 'evil-pwappy-dev.com' }, { domain: '.pwappy-dev.com.evil.invalid' }, { domain: '.com' },
    { domain: 'other.pwappy-dev.com' }, { path: '/other' }, { secure: false }, { httpOnly: false },
    { expires: 999 }, { expires: 1000 }, { expires: undefined }, { expires: '-1' }]) {
    assert.throws(() => assertSessionIdentity({ cookies: [{ ...valid, ...change }] }, 'pwuc000', 1000), safeError('identity'));
  }
  for (const cookies of [undefined, [], [valid, valid], [valid, { ...valid, path: '/other' }],
    [valid, { ...valid, name: 'pwappy_ident' }]]) {
    assert.throws(() => assertSessionIdentity({ cookies }, 'pwuc000', 1000), safeError('identity'));
  }
});

for (const [name, state] of [
  ['missing cookie', { cookies: [] }],
  ['mismatched account', { cookies: [{ name: IDENTITY_COOKIE_NAME, value: 'pwuf000', domain: '.pwappy-dev.com', path: '/', secure: true, httpOnly: true, expires: -1 }] }],
  ['duplicate cookies', { cookies: Array(2).fill({ name: IDENTITY_COOKIE_NAME, value: 'pwuc000', domain: '.pwappy-dev.com', path: '/', secure: true, httpOnly: true, expires: -1 }) }],
  ['wrong host', { cookies: [{ name: IDENTITY_COOKIE_NAME, value: 'pwuc000', domain: '.evil.invalid', path: '/', secure: true, httpOnly: true, expires: -1 }] }],
]) {
  test(`${name} fails before settings GET and disposes the context`, async () => {
    const f = fake({ state });
    await assert.rejects(assertNoRegisteredGeminiKey('chromium', 'ubuntu-latest', env, f.request), safeError('identity'));
    assert.deepEqual(f.calls.filter(call => call.method).map(call => call.method), ['POST']);
    assert.equal(f.calls.at(-1), 'dispose');
  });
}

test('in-memory state read failure is sanitized; unrelated token cookies are never decoded or inspected', async () => {
  const failed = fake({ storageFailure: true });
  await assert.rejects(assertNoRegisteredGeminiKey('chromium', 'ubuntu-latest', env, failed.request), safeError('identity'));
  assert.deepEqual(failed.calls.filter(call => call.method).map(call => call.method), ['POST']);
  assert.equal(failed.calls.at(-1), 'dispose');
  const token = { name: 'pwappy_auth' };
  Object.defineProperty(token, 'value', { get() { assert.fail('JWT/token value must not be inspected'); } });
  const f = fake({ state: { cookies: [token, { name: IDENTITY_COOKIE_NAME, value: 'pwuc000', domain: '.pwappy-dev.com',
    path: '/', secure: true, httpOnly: true, expires: -1 }] } });
  await assertNoRegisteredGeminiKey('chromium', 'ubuntu-latest', env, f.request);
  assert.equal(f.calls.at(-1), 'dispose');
});
