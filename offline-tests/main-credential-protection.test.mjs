// Historical shell/hash contracts are replayed through an exact migration adapter.
// Actual main execution and preserved options/telemetry are covered by main-safe-execution.test.mjs.
import { restoreApprovedMainSafeExecution } from './main-safe-execution-contract.mjs';
// Offline contract tests only: fabricated request contexts, temporary cache and workflow predicates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { main } from '../scripts/preflight-main-premium.mjs';
import { IDENTITY_COOKIE_NAME, USER_SETTING_ENDPOINT } from '../scripts/premium-key-preflight.mjs';
import { LOGIN_ENDPOINT } from '../scripts/branch-verification-guard.mjs';
import { mainCredentialProtectionEdits, restoreApprovedMainCredentialProtection } from './main-credential-protection-contract.mjs';

const workflow = restoreApprovedMainSafeExecution(readFileSync(new URL('../.github/workflows/e2e-tests.yml', import.meta.url), 'utf8'));
const premium = workflow.split('  e2e-premium:\n')[1];
const normal = workflow.split('  e2e-normal:\n')[1].split('  e2e-premium:\n')[0];
const step = (source, name) => source.split(`      - name: ${name}\n`)[1].split(/^      - name: /m)[0];
const preflight = step(premium, 'Protect existing Premium credentials');
const run = step(premium, 'Run Premium E2E Tests');
const cleanup = step(premium, 'Run Local Cleanup on Finish');
const CANARY = 'SYNTHETIC_SECRET_MUST_NOT_APPEAR';
const env = {
  PWAPPY_PREFLIGHT_BROWSER: 'chromium', PWAPPY_PREFLIGHT_OS: 'ubuntu-latest',
  PWAPPY_TEST_ACCOUNT_INDEX: '0', PWAPPY_TEST_BASE_URL: 'https://dev.pwappy-dev.com/editor',
  PWAPPY_TEST_LOGIN_ENDPOINT: LOGIN_ENDPOINT, PWAPPY_TEST_LOGIN_PASSCODE: CANARY,
};
function fixture(options = {}) {
  const authRoot = mkdtempSync(join(tmpdir(), 'main-key-preflight-'));
  const calls = [], logs = [];
  let issuedIdentity;
  const response = (url, body) => ({ status: () => 200, url: () => url, json: async () => body });
  const context = {
    post: async (url, input) => {
      calls.push('login');
      assert.equal(url, LOGIN_ENDPOINT);
      assert.equal(input.maxRedirects, 0); assert.equal(input.maxRetries, 0);
      issuedIdentity = input.data.identkey;
      if (options.loginFailure) throw new Error(CANARY);
      return response(LOGIN_ENDPOINT);
    },
    storageState: async (...args) => {
      calls.push('identity'); assert.deepEqual(args, []);
      return { cookies: [{ name: IDENTITY_COOKIE_NAME, value: options.wrongIdentity ? 'other' : issuedIdentity,
        domain: '.pwappy-dev.com', path: '/', secure: true, httpOnly: true, expires: -1 }] };
    },
    get: async (url, input) => {
      calls.push('settings'); assert.equal(url, USER_SETTING_ENDPOINT);
      assert.equal(input.maxRedirects, 0); assert.equal(input.maxRetries, 0);
      return response(USER_SETTING_ENDPOINT, { code: 200, details: { userSetting: {
        isUserGeminiApiKeyRegistered: Object.hasOwn(options, 'registered') ? options.registered : false,
      } } });
    },
    dispose: async () => { calls.push('dispose'); },
  };
  const requestAPI = { newContext: async input => {
    calls.push('context'); assert.deepEqual(input, { ignoreHTTPSErrors: false });
    if (options.contextFailure) throw new Error(CANARY);
    return context;
  } };
  return { authRoot, calls, logs, requestAPI,
    output: { log: message => logs.push(message), error: message => logs.push(message) },
    dispose: () => rmSync(authRoot, { recursive: true, force: true }) };
}
function workflowAllows(block, preflightOutcome, testOutcome = 'success', scope = 'all') {
  const condition = block.match(/^        if: (.*)$/m)?.[1];
  assert.ok(condition);
  return runInNewContext(condition, {
    always: () => true, inputs: { test_scope: scope },
    steps: { premium_key_preflight: { outcome: preflightOutcome }, run_tests: { outcome: testOutcome } },
  });
}

test('main wrapper supports existing automatic and manual runs without a branch/source-pin gate', async () => {
  for (const [event, ref] of [['push', 'refs/heads/main'], ['schedule', 'refs/heads/main'],
    ['workflow_dispatch', 'refs/heads/diagnostics']]) {
    const f = fixture();
    try {
      assert.equal(await main([], { ...env, GITHUB_EVENT_NAME: event, GITHUB_REF: ref }, f), 0);
      assert.deepEqual(f.calls, ['context', 'login', 'identity', 'settings', 'dispose']);
      assert.deepEqual(f.logs, ['Premium credential safety check passed; dedicated account has no registered Gemini key.']);
      assert.equal(existsSync(join(f.authRoot, '.auth')), false, 'No authentication file is created');
    } finally { f.dispose(); }
  }
});

for (const [reason, options, expectedCalls] of [
  ['registered key', { registered: true }, ['context', 'login', 'identity', 'settings', 'dispose']],
  ['malformed registration', { registered: 'false' }, ['context', 'login', 'identity', 'settings', 'dispose']],
  ['unverified identity', { wrongIdentity: true }, ['context', 'login', 'identity', 'dispose']],
  ['login failure', { loginFailure: true }, ['context', 'login', 'dispose']],
  ['unknown context error', { contextFailure: true }, ['context']],
]) {
  test(`${reason} stops before Premium test or cleanup and emits no private value`, async () => {
    const f = fixture(options);
    try {
      const code = await main([], env, f);
      assert.equal(code, 1); assert.deepEqual(f.calls, expectedCalls);
      assert.equal(f.logs.length, 1); assert.match(f.logs[0], /^::error::Premium key safety check blocked:/);
      assert.doesNotMatch(f.logs[0], new RegExp(CANARY));
      assert.equal(workflowAllows(run, code ? 'failure' : 'success'), false);
      for (const outcome of ['skipped', 'failure', 'cancelled', 'success']) {
        assert.equal(workflowAllows(cleanup, 'failure', outcome), false);
      }
      assert.equal(existsSync(join(f.authRoot, '.auth')), false);
    } finally { f.dispose(); }
  });
}

test('nonempty dedicated auth cache is neither overwritten nor followed by any login/tests/cleanup', async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.authRoot, '.auth'));
    const file = join(f.authRoot, '.auth/user-u-c-0.json');
    writeFileSync(file, CANARY);
    assert.equal(await main([], env, f), 1);
    assert.deepEqual(f.calls, []); assert.equal(readFileSync(file, 'utf8'), CANARY);
    assert.match(f.logs[0], /existing authentication state/);
    assert.doesNotMatch(f.logs[0], new RegExp(CANARY));
    assert.equal(workflowAllows(run, 'failure'), false);
    assert.equal(workflowAllows(cleanup, 'failure'), false);
  } finally { f.dispose(); }
});

for (const changes of [
  { PWAPPY_TEST_BASE_URL: 'https://pwappy.com/editor' },
  { PWAPPY_TEST_BASE_URL: 'http://dev.pwappy-dev.com/editor' },
  { PWAPPY_TEST_BASE_URL: 'https://dev.pwappy-dev.com/editor?secret=' + CANARY },
  { PWAPPY_TEST_BASE_URL: 'https://user:' + CANARY + '@dev.pwappy-dev.com/editor' },
  { PWAPPY_TEST_LOGIN_ENDPOINT: 'https://other.invalid/rest/v1/test-login' },
  { PWAPPY_TEST_ACCOUNT_INDEX: '1' }, { PWAPPY_PREFLIGHT_OS: 'unsupported' },
  { PWAPPY_TEST_LOGIN_PASSCODE: '' },
]) {
  test(`invalid ${Object.keys(changes)[0]} stops before any authenticated request`, async () => {
    const f = fixture();
    try {
      assert.equal(await main([], { ...env, ...changes }, f), 1);
      assert.deepEqual(f.calls, []); assert.equal(f.logs.length, 1);
      assert.match(f.logs[0], /invalid dedicated account configuration/);
      assert.doesNotMatch(f.logs[0], new RegExp(CANARY));
    } finally { f.dispose(); }
  });
}

test('CLI rejects arbitrary command/URL arguments before login', async () => {
  const f = fixture();
  try {
    assert.equal(await main(['https://other.invalid/' + CANARY], env, f), 1);
    assert.deepEqual(f.calls, []); assert.doesNotMatch(f.logs[0], new RegExp(CANARY));
  } finally { f.dispose(); }
});

test('successful preflight gates tests and cleanup, including failed tests, without loosening skipped/cancelled preflight', () => {
  assert.equal(workflowAllows(run, 'success'), true);
  assert.equal(workflowAllows(cleanup, 'success', 'success'), true);
  assert.equal(workflowAllows(cleanup, 'success', 'failure'), true);
  assert.equal(workflowAllows(cleanup, 'success', 'skipped'), false);
  assert.equal(workflowAllows(cleanup, 'success', 'success', 'points-smoke'), false);
  for (const outcome of ['failure', 'skipped', 'cancelled', '']) {
    assert.equal(workflowAllows(run, outcome), false);
    assert.equal(workflowAllows(cleanup, outcome), false);
  }
});

test('main workflow wires exact account index and dummy key only; preflight receives no Gemini secret', () => {
  assert.ok(premium.indexOf('name: Protect existing Premium credentials') < premium.indexOf('name: Run Premium E2E Tests'));
  assert.match(preflight, /^        id: premium_key_preflight$/m);
  assert.match(preflight, /^        run: node scripts\/preflight-main-premium\.mjs$/m);
  for (const key of ['BASE_URL', 'LOGIN_ENDPOINT', 'LOGIN_PASSCODE']) {
    assert.ok(preflight.includes(`PWAPPY_TEST_${key}: \${{ secrets.PWAPPY_TEST_${key} }}`));
  }
  assert.ok(preflight.includes('PWAPPY_PREFLIGHT_BROWSER: ${{ matrix.browser }}'));
  assert.ok(preflight.includes('PWAPPY_PREFLIGHT_OS: ${{ matrix.os }}'));
  for (const block of [preflight, run]) assert.match(block, /^          PWAPPY_TEST_ACCOUNT_INDEX: "0"$/m);
  assert.doesNotMatch(preflight, /TEST_GEMINI_API_KEY|continue-on-error|always\(\)/);
  assert.doesNotMatch(workflow, /secrets\.TEST_GEMINI_API_KEY/);
  assert.equal((workflow.match(/^          TEST_GEMINI_API_KEY: "AIza_TEST_ONLY_WEBMCP"$/gm) || []).length, 4);
  assert.match(normal, /if: always\(\) && inputs.test_scope != 'points-smoke'/);
  assert.match(cleanup, /for worker in 0 1 2 3; do/);
  assert.match(run, /--workers=1 --retries="\$RETRIES"/);
  assert.doesNotMatch(run, /continue-on-error|--grep|--shard/);
  const wrapper = readFileSync(new URL('../scripts/preflight-main-premium.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(wrapper, /spawn|execSync|fetch\(|dotenv|writeFile|appendFile|storageState/);
});

function assertPreviousWorkflow(source) {
  const restored = restoreApprovedMainCredentialProtection(source);
  const hash = createHash('sha1').update('blob ' + Buffer.byteLength(restored) + '\0').update(restored).digest('hex');
  assert.equal(hash, '47f0f77ba47ba19c1304a518b7e74d609338825f');
}
test('only reviewed credential protections change; all earlier whole-file hashes and security checks stay fixed', () => {
  assert.equal(mainCredentialProtectionEdits.length, 4);
  assertPreviousWorkflow(workflow);
  for (const { before, after } of mainCredentialProtectionEdits) {
    assert.throws(() => assertPreviousWorkflow(workflow.replace(after, before)));
    assert.throws(() => assertPreviousWorkflow(workflow.replace(after, after + after)));
  }
  for (const [before, after] of [
    ["steps.premium_key_preflight.outcome == 'success'", "steps.premium_key_preflight.outcome != 'cancelled'"],
    ['          PWAPPY_TEST_ACCOUNT_INDEX: "0"', '          PWAPPY_TEST_ACCOUNT_INDEX: "1"'],
    ['TEST_GEMINI_API_KEY: "AIza_TEST_ONLY_WEBMCP"', 'TEST_GEMINI_API_KEY: ${{ secrets.TEST_GEMINI_API_KEY }}'],
    ['if-no-files-found: error', 'if-no-files-found: ignore'],
    ['cancel-in-progress: false', 'cancel-in-progress: true'],
    ['contents: read', 'contents: write'],
    ['timeout-minutes: 120', 'timeout-minutes: 240'],
  ]) {
    assert.ok(workflow.includes(before));
    assert.throws(() => assertPreviousWorkflow(workflow.replace(before, after)));
  }
});
