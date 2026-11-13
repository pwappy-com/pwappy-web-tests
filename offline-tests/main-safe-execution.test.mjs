// Offline only: fabricated API responses or browserless Playwright in a temporary checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { validateMainConfiguration, mainGuard } from '../scripts/main-verification-guard.mjs';
import { mainSelection, mainInvocation, readMainProgress, readMainIntegrity, readAccounts, runMain, main } from '../scripts/run-main-verification.mjs';
import { mainAccount, assertNoRegisteredTestAccountKey, assertNoRegisteredSmokeAccountKey, PremiumKeyPreflightError } from '../scripts/premium-key-preflight.mjs';
import { resolveAccountIndex } from '../tests/tools/test-account-index.mjs';
import { LOGIN_ENDPOINT, POINTS_ENDPOINT, STAGING_ORIGIN, validateConfiguration, BRANCH } from '../scripts/branch-verification-guard.mjs';
const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHA = 'a'.repeat(40), SOURCE = 'b'.repeat(40), CANARY = 'SYNTHETIC_PRIVATE_MUST_NOT_ESCAPE';
const pin = { sourceCommit: SOURCE };
const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/diagnostic', GITHUB_SHA: SHA,
  GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', PWAPPY_TEST_BASE_URL: STAGING_ORIGIN,
  PWAPPY_TEST_LOGIN_ENDPOINT: LOGIN_ENDPOINT, PWAPPY_TEST_LOGIN_PASSCODE: CANARY,
  PWAPPY_TEST_POINTS_ENABLED: 'true', PWAPPY_WEBMCP_LIVE_PREMIUM_AUTHORIZED_SHA: SOURCE };
const empty = () => ({ passed: 0, failed: 0, skipped: 0, timedOut: 0, interrupted: 0 });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'main-safe-test-'));
  const output = join(root, 'github-output'); writeFileSync(output, '');
  return { root, output, env: { ...env, RUNNER_TEMP: root, GITHUB_OUTPUT: output },
    dispose: () => rmSync(root, { recursive: true, force: true }) };
}
function evidence(e, { accounts = [0], status = 'passed', failedAttempt = false, total } = {}) {
  const completed = Math.max(accounts.length, 1);
  const counts = { ...empty(), [status]: completed };
  total ??= completed;
  const attempts = { ...counts, failed: counts.failed + Number(failedAttempt) };
  writeFileSync(e.PWAPPY_BRANCH_COUNTS_PATH, JSON.stringify(counts));
  writeFileSync(e.PWAPPY_BRANCH_PROGRESS_PATH, JSON.stringify({ counts, attempts, total, completed }));
  writeFileSync(e.PWAPPY_BRANCH_DIAGNOSTICS_PATH, '[]');
  writeFileSync(e.PWAPPY_BRANCH_FAILURES_PATH, '[]');
  writeFileSync(e.PWAPPY_MAIN_ACCOUNTS_PATH, JSON.stringify(accounts));
  writeFileSync(e.PWAPPY_MAIN_INTEGRITY_PATH, JSON.stringify({ accounts, begun: accounts.length + Number(failedAttempt), failed: false }));
}
function deps(f, options = {}) {
  const calls = [];
  return { calls, authRoot: f.root,
    guard: async () => { calls.push('guard'); return pin; },
    keyCheck: async (_browser, _os, index) => { calls.push(`key:${index}`); },
    smokeKeyCheck: async () => { calls.push('smoke-key'); },
    spawn: async (_exe, args, opts) => {
      calls.push('spawn'); assert.equal(opts.stdio, 'ignore');
      assert.equal(opts.env.TEST_GEMINI_API_KEY, 'AIza_TEST_ONLY_WEBMCP');
      if (!args.includes('tests/tools/points-smoke.mjs')) evidence(opts.env, options);
      return { status: options.exit ?? 0 };
    },
  };
}
test('main push/schedules/manual branch selection share exact source pin and endpoints; branch trigger stays closed', async () => {
  const cases = [
    [{ GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' }, { ref: 'refs/heads/main', after: SHA, head_commit: { id: SHA } }],
    ...['0 1,4,7,10,13,20,23 * * *', '0 18 * * *', '0 0 * * *'].map(schedule =>
      [{ GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/main' }, { schedule }]),
    [{}, { ref: 'diagnostic' }],
  ];
  for (const [changes, event] of cases) {
    assert.deepEqual(validateMainConfiguration({ ...env, ...changes }, event, pin, 'premium'), { sourceCommit: SOURCE, baseURL: STAGING_ORIGIN + '/' });
    assert.throws(() => validateConfiguration({ ...env, ...changes }, event, pin, 'normal'), /trigger/);
  }
  for (const changes of [{ GITHUB_SHA: 'HEAD' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: BRANCH }]) {
    assert.throws(() => validateMainConfiguration({ ...env, ...changes }, { ref: 'diagnostic' }, pin, 'normal'));
  }
  for (const changes of [{ PWAPPY_TEST_BASE_URL: 'https://production.invalid/' },
    { PWAPPY_TEST_LOGIN_ENDPOINT: LOGIN_ENDPOINT + '?secret=' + CANARY },
    { PWAPPY_TEST_POINTS_READ_ENDPOINT: 'https://production.invalid/points' },
    { PWAPPY_WEBMCP_SOURCE_SHA: SHA }, { PWAPPY_WEBMCP_LIVE_PREMIUM_AUTHORIZED_SHA: SHA }]) {
    assert.throws(() => validateMainConfiguration({ ...env, ...changes }, { ref: 'diagnostic' }, pin, 'premium'),
      error => !error.message.includes(CANARY));
  }
  const f = fixture();
  try {
    const eventPath = join(f.root, 'event.json'); writeFileSync(eventPath, JSON.stringify({ ref: 'diagnostic' }));
    let fetched = 0;
    await assert.rejects(mainGuard('premium', { ...f.env, GITHUB_EVENT_PATH: eventPath }, {
      readPin: () => pin, fetch: async (url, opts) => {
        fetched++; assert.equal(url.origin, STAGING_ORIGIN); assert.equal(opts.credentials, 'omit'); assert.equal(opts.redirect, 'error');
        return { ok: true, redirected: false, url: STAGING_ORIGIN + '/staging-deployment.json',
          body: (async function* () { yield Buffer.from(JSON.stringify({ commit: SHA, run_id: '1', run_attempt: '1' })); })() };
      },
    }), /pinned deployment/);
    assert.equal(fetched, 1);
  } finally { f.dispose(); }
});
test('all manual scopes/workers/retries/points toggles preserve bounded behavior; defaults ignore manual input', () => {
  for (const scope of ['all', 'editor-regression', 'quick-property-regression', 'style-ownership-regression', 'points-smoke']) {
    for (const points of ['true', 'false']) {
      const selected = mainSelection('normal', 'chromium', 'ubuntu-latest', { ...env, TEST_SCOPE: scope, TEST_WORKERS: '3', TEST_RETRIES: '5', PWAPPY_TEST_POINTS_ENABLED: points });
      assert.equal(selected.scope, scope); assert.equal(selected.workers, 3); assert.equal(selected.retries, 5); assert.equal(selected.points, points);
    }
  }
  assert.equal(mainSelection('normal', 'webkit', 'macos-latest', { ...env, TEST_WORKERS: '50%' }, 8).workers, 4);
  const automatic = mainSelection('normal', 'chromium', 'windows-latest', { ...env, GITHUB_EVENT_NAME: 'push', TEST_SCOPE: 'bad', TEST_WORKERS: 'bad', TEST_RETRIES: 'bad' });
  assert.equal(automatic.workers, 1); assert.equal(automatic.retries, 0); assert.equal(automatic.scope, 'all');
  assert.equal(mainSelection('premium', 'mobile-safari', 'macos-latest', { ...env, TEST_SCOPE: 'points-smoke', TEST_WORKERS: '4' }).scope, 'all');
  for (const changed of [{ TEST_WORKERS: '0' }, { TEST_WORKERS: '998' }, { TEST_WORKERS: '$(bad)' }, { TEST_RETRIES: '6' }, { TEST_SCOPE: 'unknown' }]) {
    assert.throws(() => mainSelection('normal', 'chromium', 'ubuntu-latest', { ...env, ...changed }));
  }
  assert.throws(() => mainSelection('normal', 'firefox', 'ubuntu-latest', env));
  assert.equal(resolveAccountIndex(91, { TEST_PARALLEL_INDEX: '2', PWAPPY_MAIN_WORKERS: '3' }), '2');
  assert.throws(() => resolveAccountIndex(91, { TEST_PARALLEL_INDEX: '3', PWAPPY_MAIN_WORKERS: '3' }));
});
test('invocations preserve normal account slots, exact cleanup account, trace options and synthetic key; no full-branch override', () => {
  const selected = mainSelection('normal', 'mobile-chrome', 'ubuntu-latest', { ...env, TEST_WORKERS: '3', TEST_RETRIES: '2' });
  const { childEnv, args } = mainInvocation(selected, 'tests', '/tmp/synthetic', { ...env, PWAPPY_TEST_ACCOUNT_INDEX: '37', TEST_PARALLEL_INDEX: '55', TEST_GEMINI_API_KEY: CANARY, PWAPPY_FULL_BRANCH_VERIFICATION: 'true' });
  assert.ok(args.includes('--workers=3')); assert.ok(args.includes('--retries=2')); assert.ok(args.includes('--config=playwright.main-safe.config.ts'));
  assert.equal(childEnv.PWAPPY_TEST_ACCOUNT_INDEX, undefined); assert.equal(childEnv.TEST_PARALLEL_INDEX, undefined);
  assert.equal(childEnv.PWAPPY_FULL_BRANCH_VERIFICATION, 'true'); assert.equal(childEnv.PWAPPY_TEST_POINTS_READ_ENDPOINT, POINTS_ENDPOINT);
  assert.equal(childEnv.TEST_GEMINI_API_KEY, 'AIza_TEST_ONLY_WEBMCP');
  const cleanup = mainInvocation(selected, 'cleanup', '/tmp/synthetic', env, 2);
  assert.equal(cleanup.childEnv.PWAPPY_TEST_ACCOUNT_INDEX, '2'); assert.ok(cleanup.args.includes('--workers=1')); assert.ok(cleanup.args.includes('--retries=0'));
});
test('guard and all account checks finish before spawn, registered keys block tests/cleanup with no started output', async () => {
  const f = fixture(); const d = deps(f);
  try {
    assert.equal(await runMain('normal', 'chromium', 'ubuntu-latest', 'tests', { ...f.env, TEST_WORKERS: '3' }, d), 0);
    assert.deepEqual(d.calls, ['guard', 'key:0', 'key:1', 'key:2', 'guard', 'spawn']);
    const f2 = fixture(); const blocked = deps(f2);
    blocked.keyCheck = async () => { throw new PremiumKeyPreflightError('registered'); };
    try {
      assert.equal(await main(['premium', 'chromium', 'ubuntu-latest', 'tests'], f2.env, blocked), 1);
      assert.deepEqual(blocked.calls, ['guard']);
      assert.equal(readFileSync(f2.output, 'utf8'), 'EXIT_CODE=1\n');
      assert.doesNotMatch(readFileSync(f2.output, 'utf8'), /started|state_dir/);
    } finally { f2.dispose(); }
  } finally { f.dispose(); }
});
test('malformed/failed/incomplete child evidence stays failed and saves the actual child exit', async () => {
  for (const options of [{ exit: 7, status: 'failed' }, { failedAttempt: true }, { total: 2 }]) {
    const f = fixture(); const d = deps(f, options); if (options.failedAttempt) f.env.TEST_RETRIES = '1';
    try {
      assert.notEqual(await main(['normal', 'chromium', 'ubuntu-latest', 'tests'], f.env, d), 0);
      const output = readFileSync(f.output, 'utf8');
      assert.match(output, new RegExp(`RAW_TEST_EXIT_CODE=${options.exit ?? 0}\\n`)); assert.match(output, new RegExp(`EXIT_CODE=${options.exit || 1}\\n`));
    } finally { f.dispose(); }
  }
});
test('multiworker cleanup uses only started accounts with verified same-account sessions; no legacy 0..3 sweep', async () => {
  const f = fixture(); const d = deps(f, { accounts: [1, 2] });
  const cfg = { ...f.env, TEST_WORKERS: '3' };
  try {
    await runMain('normal', 'chromium', 'ubuntu-latest', 'tests', cfg, d);
    const state = readFileSync(f.output, 'utf8').match(/^state_dir=(.*)$/m)[1];
    mkdirSync(join(f.root, '.auth'));
    const session = account => ({ cookies: [{ name: 'pwappy_ident_key', value: `pwuc00${account}`,
      domain: '.pwappy-dev.com', path: '/', secure: true, httpOnly: true, expires: -1 }] });
    for (const account of [0, 1, 2, 3]) writeFileSync(join(f.root, `.auth/user-u-c-${account}.json`), JSON.stringify(session(account)));
    const cleaned = [];
    d.spawn = async (_exec, args, opts) => {
      cleaned.push(opts.env.PWAPPY_TEST_ACCOUNT_INDEX); assert.equal(opts.stdio, 'ignore');
      assert.ok(args.includes('tests/tools/a0-cleanup-all-apps.spec.ts')); evidence(opts.env); return { status: 0 };
    };
    assert.equal(await runMain('normal', 'chromium', 'ubuntu-latest', 'cleanup', { ...cfg, PWAPPY_MAIN_STATE_DIR: state }, d), 0);
    assert.deepEqual(cleaned, ['1', '2']);
    writeFileSync(join(state, 'accounts.json'), '[3]');
    await assert.rejects(runMain('normal', 'chromium', 'ubuntu-latest', 'cleanup', { ...cfg, PWAPPY_MAIN_STATE_DIR: state }, d));
    assert.deepEqual(cleaned, ['1', '2']);
    writeFileSync(join(state, 'accounts.json'), '[1]');
    writeFileSync(join(f.root, '.auth/user-u-c-1.json'), JSON.stringify(session(0)));
    await assert.rejects(runMain('normal', 'chromium', 'ubuntu-latest', 'cleanup', { ...cfg, PWAPPY_MAIN_STATE_DIR: state }, d), /identity/);
    assert.deepEqual(cleaned, ['1', '2']);
    await assert.rejects(runMain('premium', 'chromium', 'ubuntu-latest', 'cleanup', { ...cfg, PWAPPY_MAIN_STATE_DIR: state }, d));
  } finally { f.dispose(); }
});
test('missing actual starts and missing/empty own sessions never launch cleanup', async () => {
  const f = fixture(); const d = deps(f, { accounts: [], status: 'skipped' });
  try {
    await runMain('normal', 'chromium', 'ubuntu-latest', 'tests', f.env, d);
    const state = readFileSync(f.output, 'utf8').match(/^state_dir=(.*)$/m)[1];
    d.spawn = () => assert.fail('cleanup must not start');
    const cfg = { ...f.env, PWAPPY_MAIN_STATE_DIR: state };
    assert.equal(await runMain('normal', 'chromium', 'ubuntu-latest', 'cleanup', cfg, d), 0);
    writeFileSync(join(state, 'accounts.json'), '[0]');
    assert.equal(await runMain('normal', 'chromium', 'ubuntu-latest', 'cleanup', cfg, d), 0);
    mkdirSync(join(f.root, '.auth')); writeFileSync(join(f.root, '.auth/user-u-c-0.json'), '{}');
    assert.equal(await runMain('normal', 'chromium', 'ubuntu-latest', 'cleanup', cfg, d), 0);
  } finally { f.dispose(); }
});
test('points smoke is guarded and key checked, suppresses raw output, records exit, and has no app cleanup', async () => {
  const f = fixture(); const d = deps(f);
  try {
    assert.equal(await runMain('normal', 'chromium', 'ubuntu-latest', 'tests', { ...f.env, TEST_SCOPE: 'points-smoke' }, d), 0);
    assert.deepEqual(d.calls, ['guard', 'smoke-key', 'guard', 'spawn']);
    assert.match(readFileSync(f.output, 'utf8'), /RAW_TEST_EXIT_CODE=0\nEXIT_CODE=0/);
    assert.doesNotMatch(readFileSync(f.output, 'utf8'), /started=true/);
  } finally { f.dispose(); }
});
test('indexed and smoke key preflights verify exact server identity and keep branch zero-only behavior', async () => {
  for (const index of [0, 2, 996, 998]) {
    let identity;
    const api = { newContext: async () => ({
      post: async (url, opts) => { identity = opts.data.identkey; assert.equal(opts.maxRedirects, 0); return { status: () => 200, url: () => url }; },
      storageState: async () => ({ cookies: [{ name: 'pwappy_ident', value: identity, domain: '.pwappy-dev.com', path: '/', secure: true, httpOnly: true, expires: -1 }] }),
      get: async (url, opts) => { assert.equal(opts.maxRedirects, 0); return { status: () => 200, url: () => url, json: async () => ({ code: 200, details: { userSetting: { isUserGeminiApiKeyRegistered: false } } }) }; },
      dispose: async () => {},
    }) };
    if (index === 998) await assertNoRegisteredSmokeAccountKey('webkit', 'macos-latest', env, api);
    else await assertNoRegisteredTestAccountKey('webkit', 'macos-latest', index, env, api);
    assert.equal(identity, 'pwms' + String(index).padStart(3, '0'));
  }
  for (const index of [997, 998, 999, -1, '00', CANARY]) assert.throws(() => mainAccount('chromium', 'ubuntu-latest', index));
});
test('progress permits retry result replacement but rejects regressions and injected values', () => {
  const f = fixture(); const path = join(f.root, 'progress.json');
  const write = value => writeFileSync(path, JSON.stringify(value));
  try {
    const first = { total: 1, completed: 1, counts: { ...empty(), failed: 1 }, attempts: { ...empty(), failed: 1 } };
    write(first); assert.deepEqual(readMainProgress(path), first);
    const final = { total: 1, completed: 1, counts: { ...empty(), passed: 1 }, attempts: { ...empty(), failed: 1, passed: 1 } };
    write(final); assert.deepEqual(readMainProgress(path, first), final);
    for (const invalid of [{ ...final, completed: 2 }, { ...final, total: 100001 }, { ...final, secret: CANARY },
      { ...final, attempts: empty() }, { ...final, counts: { ...final.counts, passed: CANARY } }]) {
      write(invalid); assert.throws(() => readMainProgress(path, first));
    }
  } finally { f.dispose(); }
});
test('actual browserless child with retries/multiple workers exposes only safe evidence and never hides first failures', async () => {
  const f = fixture(); const originalCwd = process.cwd(); const logs = [];
  const log = console.log, error = console.error;
  try {
    for (const path of ['scripts', 'tests', 'playwright.config.ts', 'playwright.main-safe.config.ts']) cpSync(join(ROOT, path), join(f.root, path), { recursive: true });
    symlinkSync(join(ROOT, 'node_modules'), join(f.root, 'node_modules'), 'dir');
    const spec = join(f.root, 'tests/specs/normal/editor-quick-property-editor.spec.ts');
    writeFileSync(spec, `import { test, expect } from '@playwright/test';
      test.describe.configure({ mode: 'parallel' });
      test('${CANARY} retry', async ({}, info) => { console.log('${CANARY}'); console.error('${CANARY}'); expect(info.retry, '${CANARY}').toBe(1); });
      test('${CANARY} pass', async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      test.skip('${CANARY} skip', async () => {});`);
    process.chdir(f.root); console.log = (...values) => logs.push(values.join(' ')); console.error = (...values) => logs.push(values.join(' '));
    const d = deps(f); delete d.spawn;
    assert.equal(await main(['normal', 'chromium', 'ubuntu-latest', 'tests'], { ...f.env, TEST_SCOPE: 'quick-property-regression', TEST_WORKERS: '2', TEST_RETRIES: '1' }, d), 1);
    const output = readFileSync(f.output, 'utf8');
    assert.match(output, /started=true/); assert.match(output, /RAW_TEST_EXIT_CODE=0/); assert.match(output, /EXIT_CODE=1/);
    const state = output.match(/^state_dir=(.*)$/m)[1];
    const progress = readMainProgress(join(state, 'progress.json'));
    assert.equal(progress.total, 3); assert.equal(progress.completed, 3); assert.equal(progress.counts.skipped, 1); assert.equal(progress.attempts.skipped, 1); assert.equal(progress.counts.passed, 2);
    assert.equal(progress.attempts.failed, 1); assert.equal(progress.attempts.passed, 2);
    assert.deepEqual(readAccounts(state, { workers: 2 }), [0, 1]);
    assert.doesNotMatch(logs.join('\n'), new RegExp(CANARY));
    // A genuinely unstarted, all-skipped run must not claim cleanup eligibility.
    writeFileSync(f.output, '');
    writeFileSync(spec, `import { test } from '@playwright/test'; test.skip('${CANARY}', async () => {});`);
    assert.equal(await main(['normal', 'chromium', 'ubuntu-latest', 'tests'], { ...f.env, TEST_SCOPE: 'quick-property-regression' }, d), 1);
    const skippedOutput = readFileSync(f.output, 'utf8');
    assert.doesNotMatch(skippedOutput, /started=true/);
    const skippedState = skippedOutput.match(/^state_dir=(.*)$/m)[1];
    assert.deepEqual(readAccounts(skippedState, { workers: 1 }), []);
    assert.equal(readMainProgress(join(skippedState, 'progress.json')).counts.skipped, 1);
  } finally { console.log = log; console.error = error; process.chdir(originalCwd); f.dispose(); }
});
test('successful child exits cannot hide missing, incomplete or failed account recording', async () => {
  const cases = [
    e => rmSync(e.PWAPPY_MAIN_INTEGRITY_PATH),
    e => writeFileSync(e.PWAPPY_MAIN_INTEGRITY_PATH, JSON.stringify({ accounts: [0], begun: 1, failed: true })),
    e => writeFileSync(e.PWAPPY_MAIN_INTEGRITY_PATH, JSON.stringify({ accounts: [], begun: 1, failed: false })),
    e => writeFileSync(e.PWAPPY_MAIN_INTEGRITY_PATH, JSON.stringify({ accounts: [0], begun: 0, failed: false })),
    e => writeFileSync(e.PWAPPY_MAIN_INTEGRITY_PATH, JSON.stringify({ accounts: [0], begun: 1, failed: false, secret: CANARY })),
    e => rmSync(e.PWAPPY_MAIN_ACCOUNTS_PATH),
    e => writeFileSync(e.PWAPPY_MAIN_ACCOUNTS_PATH, '[]'),
  ];
  for (const corrupt of cases) {
    const f = fixture(); const d = deps(f); const spawn = d.spawn;
    try {
      d.spawn = async (...args) => { const result = await spawn(...args); corrupt(args[2].env); return result; };
      assert.equal(await main(['normal', 'chromium', 'ubuntu-latest', 'tests'], f.env, d), 1);
      assert.match(readFileSync(f.output, 'utf8'), /RAW_TEST_EXIT_CODE=0\nEXIT_CODE=1/);
    } finally { f.dispose(); }
  }
});
test('actual Playwright ledger/output failures stay fatal even when reporter callbacks are swallowed', async () => {
  const originalCwd = process.cwd(), log = console.log, error = console.error;
  const logs = [];
  try {
    console.log = (...values) => logs.push(values.join(' ')); console.error = (...values) => logs.push(values.join(' '));
    for (const fault of ['account-write', 'account-rename', 'second-account', 'started-output', 'integrity-write']) {
      const f = fixture();
      try {
        for (const path of ['scripts', 'tests', 'playwright.config.ts', 'playwright.main-safe.config.ts']) cpSync(join(ROOT, path), join(f.root, path), { recursive: true });
        symlinkSync(join(ROOT, 'node_modules'), join(f.root, 'node_modules'), 'dir');
        const spec = join(f.root, 'tests/specs/normal/editor-quick-property-editor.spec.ts');
        writeFileSync(spec, `import { test } from '@playwright/test';
          test.describe.configure({ mode: 'parallel' });
          test('${CANARY} one', async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
          test('${CANARY} two', async () => { await new Promise(resolve => setTimeout(resolve, 30)); });`);
        const marker = join(f.root, 'injected'), preload = join(f.root, 'fault.cjs');
        // Monkeypatch only this disposable child. Production has no fault-injection switch.
        writeFileSync(preload, `const fs = require('node:fs');
          const original = { writeFileSync: fs.writeFileSync, renameSync: fs.renameSync, appendFileSync: fs.appendFileSync };
          let writes = 0;
          for (const method of Object.keys(original)) fs[method] = function (...args) {
            const path = String(args[0]);
            const accountWrite = method === 'writeFileSync' && path === process.env.PWAPPY_MAIN_ACCOUNTS_PATH + '.tmp';
            if (accountWrite) writes++;
            const shouldFail = ${JSON.stringify(fault)} === 'account-write' && accountWrite
              || ${JSON.stringify(fault)} === 'second-account' && accountWrite && writes === 2
              || ${JSON.stringify(fault)} === 'account-rename' && method === 'renameSync' && path === process.env.PWAPPY_MAIN_ACCOUNTS_PATH + '.tmp'
              || ${JSON.stringify(fault)} === 'started-output' && method === 'appendFileSync' && path === process.env.GITHUB_OUTPUT
              || ${JSON.stringify(fault)} === 'integrity-write' && method === 'writeFileSync' && path === process.env.PWAPPY_MAIN_INTEGRITY_PATH + '.tmp';
            if (shouldFail && !fs.existsSync(${JSON.stringify(marker)})) {
              original.writeFileSync(${JSON.stringify(marker)}, 'injected');
              throw new Error('${CANARY}');
            }
            return original[method](...args);
          };`);
        process.chdir(f.root);
        const d = deps(f); delete d.spawn;
        assert.equal(await main(['normal', 'chromium', 'ubuntu-latest', 'tests'], {
          ...f.env, TEST_SCOPE: 'quick-property-regression', TEST_WORKERS: '2', NODE_OPTIONS: `--require=${preload}`,
        }, d), 1, fault);
        assert.ok(existsSync(marker), fault + ' was not exercised');
        assert.match(readFileSync(f.output, 'utf8'), /EXIT_CODE=1/, fault);
        const state = readFileSync(f.output, 'utf8').match(/^state_dir=(.*)$/m)[1];
        const final = readMainProgress(join(state, 'progress.json'));
        assert.equal(final.counts.passed, 2, fault + ' must not be a test failure');
        assert.throws(() => readMainIntegrity(state, { workers: 2 }, final), undefined, fault);
      } finally { process.chdir(originalCwd); f.dispose(); }
    }
    assert.doesNotMatch(logs.join('\n'), new RegExp(CANARY));
  } finally { console.log = log; console.error = error; process.chdir(originalCwd); }
});
test('actual workflow has one guarded wrapper per suite/phase, preserves five-way main matrix and metadata-only uploads', () => {
  const source = readFileSync(join(ROOT, '.github/workflows/e2e-tests.yml'), 'utf8');
  assert.equal((source.match(/run: node scripts\/run-main-verification.mjs .* tests/g) || []).length, 2);
  assert.equal((source.match(/run: node scripts\/run-main-verification.mjs .* cleanup/g) || []).length, 2);
  assert.equal((source.match(/if: always\(\) && steps.run_tests.outputs.started == 'true' && steps.run_tests.outputs.state_dir != ''/g) || []).length, 2);
  assert.equal((source.match(/PWAPPY_WEBMCP_LIVE_PREMIUM_AUTHORIZED_SHA: \$\{\{ vars.PWAPPY_WEBMCP_LIVE_PREMIUM_AUTHORIZED_SHA \}\}/g) || []).length, 4);
  assert.doesNotMatch(source, /npx playwright test|--reporter=line|for worker in 0 1 2 3|preflight-main-premium.mjs|secrets.TEST_GEMINI_API_KEY/);
  assert.doesNotMatch(source, /browser.*firefox|continue-on-error/);
  assert.equal((source.match(/path: \$\{\{ steps.safe_artifact.outputs.summary_path \}\}/g) || []).length, 2);
  assert.equal((source.match(/SAFE_TEST_EXIT_CODE: \$\{\{ steps.run_tests.outputs.EXIT_CODE \}\}/g) || []).length, 2);
  assert.doesNotMatch(source.split('  e2e-premium:\n')[1].split('      - name: Run Premium')[0], /inputs.test_scope != 'points-smoke'/);
});

test('all-scope main/schedule/manual enables nonphysical D&D/copy tests; focused manual scopes stay focused', () => {
  for (const event of ['push', 'schedule', 'workflow_dispatch']) {
    const selection = mainSelection('normal', 'chromium', 'ubuntu-latest', { ...env, GITHUB_EVENT_NAME: event });
    assert.equal(mainInvocation(selection, 'tests', '/tmp/synthetic', env).childEnv.PWAPPY_FULL_BRANCH_VERIFICATION, 'true');
  }
  const selection = mainSelection('normal', 'chromium', 'ubuntu-latest', { ...env, TEST_SCOPE: 'editor-regression' });
  assert.equal(mainInvocation(selection, 'tests', '/tmp/synthetic', env).childEnv.PWAPPY_FULL_BRANCH_VERIFICATION, 'false');
  assert.deepEqual(selection.testArgs.slice(0, 2), ['tests/specs/normal/editor-events-build.spec.ts', 'tests/specs/normal/editor-property-parsing-build.spec.ts']);
  for (const ref of ['diagnostic', 'refs/heads/diagnostic']) assert.doesNotThrow(() => validateMainConfiguration(env, { ref }, pin, 'normal'));
  for (const ref of ['other', 'refs/tags/diagnostic', 'refs/heads/other']) assert.throws(() => validateMainConfiguration(env, { ref }, pin, 'normal'));
});

test('macOS telemetry retains resource pressure and public transport observations, never raw process/OS text', async () => {
  const { resourceSnapshot, startMainDiagnostics } = await import('../scripts/main-safe-telemetry.mjs');
  const options = {
    exec: (command, args, opts) => {
      assert.equal(opts.stdio[2], 'ignore');
      if (command === 'vm_stat') return `Pages free: 123.\nSwapins: 45.\nSwapouts: 67.\n${CANARY}`;
      assert.deepEqual(args, ['-axo', 'pid,ppid,%cpu,rss']);
      return `PID PPID %CPU RSS\n12 1 42.5 9876\n55 1 90 1000 ${CANARY}\n${CANARY}`;
    },
    now: () => 123, cpus: () => [1, 2], totalmem: () => 1000, freemem: () => 500, loadavg: () => [1.2, 2, 3],
  };
  const result = resourceSnapshot(options);
  assert.equal(result.pages['Pages free'], 123); assert.equal(result.pages.Swapouts, 67);
  assert.deepEqual(result.processes, [{ pid: 12, parentPid: 1, cpuPercent: 42.5, rssKiB: 9876 }]);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(CANARY));
  const logs = []; let signal, cleared = false;
  const stop = startMainDiagnostics({ ...options, output: { log: line => logs.push(line) },
    setInterval: (_callback, ms) => { assert.equal(ms, 30000); return 123; },
    clearInterval: timer => { assert.equal(timer, 123); cleared = true; },
    runSampler: async options => {
      assert.equal(options.baseUrl, STAGING_ORIGIN); signal = options.signal;
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    },
  });
  await stop(); assert.equal(signal.aborted, true); assert.equal(cleared, true);
  assert.doesNotMatch(logs.join('\n'), new RegExp(CANARY));
  const source = readFileSync(join(ROOT, 'scripts/run-main-verification.mjs'), 'utf8');
  assert.match(source, /process.platform === 'darwin'/); assert.match(source, /finally \{ await stopDiagnostics\(\); \}/);
});

test('exact migration reverses only reviewed execution/install spans and keeps all historical hashes enforceable', async () => {
  const { restoreApprovedMainSafeExecution, mainSafeExecutionEdits } = await import('./main-safe-execution-contract.mjs');
  const { createHash } = await import('node:crypto');
  const source = readFileSync(join(ROOT, '.github/workflows/e2e-tests.yml'), 'utf8');
  const old = restoreApprovedMainSafeExecution(source);
  const blob = createHash('sha1').update('blob ' + Buffer.byteLength(old) + '\0').update(old).digest('hex');
  // c027dc9 workflow before this safety migration, not a regenerated expected baseline.
  assert.equal(blob, 'f256b071142dc040374bcbbf851041f828252e37');
  assert.equal(mainSafeExecutionEdits.length, 3);
  assert.throws(() => restoreApprovedMainSafeExecution(source.replace('"$TEST_OS" tests', '"$TEST_OS" cleanup')));
  assert.throws(() => restoreApprovedMainSafeExecution(source.replace("steps.run_tests.outputs.started == 'true'", "steps.run_tests.outputs.started != 'false'")));
});

test('opaque startup failures expose only fixed phase codes and preserve fail-closed behavior', async () => {
  for (const phase of ['selection', 'runtime-configuration', 'initial-deployment-guard',
    'fresh-auth-cache', 'account-key-preflight', 'final-deployment-guard', 'state-creation', 'test-execution-or-evidence']) {
    const f = fixture();
    const d = deps(f); let guardCalls = 0, spawnCalls = 0;
    const cfg = { ...f.env };
    const args = ['normal', 'chromium', 'ubuntu-latest', 'tests'];
    d.guard = async () => {
      guardCalls++;
      if ((phase === 'initial-deployment-guard' && guardCalls === 1)
          || (phase === 'final-deployment-guard' && guardCalls === 2)) throw new Error(CANARY);
      return pin;
    };
    d.keyCheck = async () => { if (phase === 'account-key-preflight') throw new Error(CANARY); };
    d.spawn = async () => { spawnCalls++; throw new Error(CANARY); };
    if (phase === 'selection') args[1] = CANARY;
    if (phase === 'runtime-configuration') cfg.PWAPPY_TEST_LOGIN_PASSCODE = '';
    if (phase === 'fresh-auth-cache') {
      mkdirSync(join(f.root, '.auth'));
      writeFileSync(join(f.root, '.auth', 'user-u-c-0.json'), CANARY);
    }
    if (phase === 'state-creation') cfg.RUNNER_TEMP = join(f.root, 'missing');
    const lines = [], original = console.error;
    console.error = (...values) => lines.push(values.join(' '));
    try {
      assert.equal(await main(args, cfg, d), 1);
      assert.equal(lines[0], `Main verification failure phase: ${phase}`);
      assert.doesNotMatch(lines.join('\n'), new RegExp(CANARY));
      assert.equal(spawnCalls, phase === 'test-execution-or-evidence' ? 1 : 0);
    } finally { console.error = original; f.dispose(); }
  }
});
