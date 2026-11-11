import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, cpSync, copyFileSync, mkdirSync, symlinkSync, lstatSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { MATRIX, STAGING_ORIGIN, LOGIN_ENDPOINT, POINTS_ENDPOINT, BRANCH,
  validateConfiguration, verifyStage, readPin } from '../scripts/branch-verification-guard.mjs';
import { invocation, readCounts, readProgress, spawnWithProgress, run } from '../scripts/run-branch-verification.mjs';
const require = createRequire(import.meta.url);
const SOURCE = 'a'.repeat(40), TESTS = 'b'.repeat(40), CANARY = 'SYNTHETIC_SECRET_NEVER_ECHO';
const pin = { sourceCommit: SOURCE };
const event = { ref: BRANCH, after: TESTS, head_commit: { id: TESTS, message: 'Verify staging [verify-webmcp]' }, forced: false, deleted: false };
const env = { GITHUB_EVENT_NAME: 'push', GITHUB_REF: BRANCH, GITHUB_SHA: TESTS,
  GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', PWAPPY_TEST_BASE_URL: STAGING_ORIGIN,
  PWAPPY_TEST_LOGIN_ENDPOINT: LOGIN_ENDPOINT, PWAPPY_TEST_LOGIN_PASSCODE: CANARY };
const marker = { commit: SOURCE, run_id: '123', run_attempt: '1' };
const workflow = readFileSync(new URL('../.github/workflows/webmcp-branch-verification.yml', import.meta.url), 'utf8');
function response(value = marker, override = {}) {
  return { ok: true, redirected: false, url: `${STAGING_ORIGIN}/staging-deployment.json`,
    body: (async function* () { yield Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)); })(), ...override };
}

test('pin is exactly one full source SHA; mismatched supplied SHA cannot override it', () => {
  assert.match(readPin().sourceCommit, /^[a-f0-9]{40}$/);
  for (const invalid of [null, {}, { sourceCommit: 'HEAD' }, { ...pin, extra: true }]) {
    assert.throws(() => validateConfiguration(env, event, invalid, 'normal'), /invalid source pin/);
  }
  assert.throws(() => validateConfiguration({ ...env, PWAPPY_WEBMCP_SOURCE_SHA: TESTS }, event, pin, 'normal'), /pin mismatch/);
  assert.equal(validateConfiguration({ ...env, PWAPPY_WEBMCP_SOURCE_SHA: SOURCE }, event, pin, 'normal').sourceCommit, SOURCE);
});

test('only marked, exact branch tip push is accepted', () => {
  for (const changed of [{ GITHUB_EVENT_NAME: 'workflow_dispatch' }, { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_EVENT_NAME: 'schedule' }, { GITHUB_REF: 'refs/heads/main' }, { GITHUB_SHA: SOURCE }]) {
    assert.throws(() => validateConfiguration({ ...env, ...changed }, event, pin, 'normal'), /trigger/);
  }
  for (const changed of [{ after: SOURCE }, { ref: 'refs/heads/main' }, { forced: true }, { deleted: true },
    { head_commit: null }, { head_commit: { id: TESTS, message: 'ordinary push' } },
    { head_commit: { id: SOURCE, message: '[verify-webmcp]' } }]) {
    assert.throws(() => validateConfiguration(env, { ...event, ...changed }, pin, 'normal'), /trigger/);
  }
});

test('verified base origin accepts root/editor paths, never arbitrary URLs', () => {
  for (const path of ['', '/', '/editor', '/editor/']) {
    assert.equal(validateConfiguration({ ...env, PWAPPY_TEST_BASE_URL: STAGING_ORIGIN + path }, event, pin, 'normal').sourceCommit, SOURCE);
  }
  for (const base of [undefined, 'not a URL', 'http://dev.pwappy-dev.com/', 'https://pwappy.com/',
    STAGING_ORIGIN + '.evil.test/', STAGING_ORIGIN + '/other', STAGING_ORIGIN + '?token=' + CANARY,
    STAGING_ORIGIN + '/#' + CANARY, `https://user:${CANARY}@dev.pwappy-dev.com/editor`]) {
    assert.throws(() => validateConfiguration({ ...env, PWAPPY_TEST_BASE_URL: base }, event, pin, 'normal'),
      error => /staging base configuration/.test(error.message) && !error.message.includes(CANARY));
  }
});

test('normal needs no Premium authorization; live Premium fails closed for any other SHA', () => {
  assert.equal(validateConfiguration(env, event, pin, 'normal').sourceCommit, SOURCE);
  for (const value of [undefined, '', 'true', TESTS, SOURCE + '\n']) {
    assert.throws(() => validateConfiguration({ ...env, PWAPPY_WEBMCP_LIVE_PREMIUM_AUTHORIZED_SHA: value }, event, pin, 'premium'), /authorization/);
  }
  assert.equal(validateConfiguration({ ...env, PWAPPY_WEBMCP_LIVE_PREMIUM_AUTHORIZED_SHA: SOURCE }, event, pin, 'premium').sourceCommit, SOURCE);
});

test('login and points endpoints are fixed before any credential transmission', async () => {
  for (const changed of [{ PWAPPY_TEST_LOGIN_ENDPOINT: 'https://prod.invalid/rest/v1/test-login' },
    { PWAPPY_TEST_LOGIN_ENDPOINT: LOGIN_ENDPOINT + '?key=' + CANARY },
    { PWAPPY_TEST_POINTS_READ_ENDPOINT: 'https://other.invalid/read/v1/pwappy-points' }]) {
    await assert.rejects(verifyStage({ ...env, ...changed }, event, pin, 'normal', () => assert.fail('must not fetch')), /configuration/);
  }
  assert.equal(validateConfiguration({ ...env, PWAPPY_TEST_POINTS_READ_ENDPOINT: POINTS_ENDPOINT }, event, pin, 'normal').sourceCommit, SOURCE);
});

test('guard sends only a cache-busted credential-free root marker GET with a deadline', async () => {
  let count = 0;
  await verifyStage({ ...env, PWAPPY_TEST_BASE_URL: STAGING_ORIGIN + '/editor' }, event, pin, 'normal', async (url, options) => {
    count++;
    assert.equal(url.origin, STAGING_ORIGIN); assert.equal(url.pathname, '/staging-deployment.json');
    assert.ok(url.searchParams.get('verify').startsWith(TESTS + '-'));
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store'); assert.deepEqual(options.headers, { 'Cache-Control': 'no-cache' });
    assert.ok(options.signal instanceof AbortSignal); assert.doesNotMatch(JSON.stringify(options), new RegExp(CANARY));
    return response();
  });
  assert.equal(count, 1);
});

for (const [name, value, override] of [
  ['different source', { ...marker, commit: TESTS }], ['invalid run', { ...marker, run_id: '0' }],
  ['numeric run', { ...marker, run_id: 123 }], ['extra fields', { ...marker, token: CANARY }],
  ['malformed JSON', CANARY], ['oversized JSON', 'x'.repeat(4097)],
  ['HTTP failure', marker, { ok: false }], ['redirect', marker, { redirected: true }],
  ['other origin', marker, { url: 'https://other.invalid/' }],
]) {
  test(`marker rejects ${name} without publishing its body`, async () => {
    await assert.rejects(verifyStage(env, event, pin, 'normal', async () => response(value, override)),
      error => error.message.startsWith('Branch verification blocked:') && !error.message.includes(CANARY));
  });
}

test('unapproved Premium stops even before the static fetch; transport errors never echo inputs', async () => {
  await assert.rejects(verifyStage(env, event, pin, 'premium', () => assert.fail('no request allowed')), /authorization/);
  await assert.rejects(verifyStage(env, event, pin, 'normal', () => { throw new Error(CANARY); }),
    error => error.message === 'Branch verification blocked: staging marker request failed.');
});

test('matrix retains five existing CI combinations and adds separate Linux Firefox account', () => {
  assert.equal(MATRIX.length, 6);
  assert.equal(new Set(MATRIX.map(row => row.os + '/' + row.browser)).size, 6);
  assert.deepEqual(MATRIX.map(row => row.os + '/' + row.browser), ['ubuntu-latest/chromium',
    'ubuntu-latest/mobile-chrome', 'ubuntu-latest/firefox', 'windows-latest/chromium',
    'macos-latest/webkit', 'macos-latest/mobile-safari']);
  for (const row of MATRIX) {
    if (row.browser === 'firefox') {
      assert.throws(() => invocation('normal', row.browser, row.os, 'tests', '/temporary', env), /Firefox staging account authorization/);
      continue;
    }
    const { args, childEnv } = invocation('normal', row.browser, row.os, 'tests', '/temporary', env);
    assert.ok(args.includes('tests/specs/normal')); assert.ok(args.includes('--workers=1')); assert.ok(args.includes('--retries=0'));
    assert.ok(!args.some(arg => arg.includes('premium') || arg.includes('cleanup')));
    assert.equal(childEnv.PWAPPY_TEST_ACCOUNT_INDEX, '0'); assert.equal(childEnv.TEST_RUN_SUFFIX, row.suffix);
    assert.equal(childEnv.PWAPPY_TEST_CLEANUP_BROWSER_CODE, row.code);
    assert.equal(childEnv.PWAPPY_TEST_POINTS_ENABLED, 'true'); assert.equal(childEnv.PWAPPY_TEST_POINTS_READ_ENDPOINT, POINTS_ENDPOINT);
    assert.equal(childEnv.TEST_GEMINI_API_KEY, 'AIza_TEST_ONLY_WEBMCP');
    assert.equal(childEnv.PWAPPY_FULL_BRANCH_VERIFICATION, 'true');
    assert.equal(childEnv.DOTENV_CONFIG_PATH, '/temporary/absent.env');
    const cleanup = invocation('premium', row.browser, row.os, 'cleanup', '/temporary', env);
    assert.ok(cleanup.args.includes('tests/tools/a0-cleanup-all-apps.spec.ts'));
    assert.equal(cleanup.childEnv.PWAPPY_TEST_ACCOUNT_INDEX, '0');
    assert.equal(cleanup.childEnv.PWAPPY_TEST_POINTS_PHASE, 'cleanup');
  }
});

test('invocation rejects unknown browser, OS, suite or phase', () => {
  for (const args of [['normal', 'firefox', 'windows-latest', 'tests'], ['all', 'chromium', 'ubuntu-latest', 'tests'],
    ['normal', 'chromium', 'ubuntu-latest', 'arbitrary']]) {
    assert.throws(() => invocation(...args, '/temporary', env), /Invalid branch test selection/);
  }
});

test('runner guard finishes before child starts, records exact exit and publishes scalar counts only', async () => {
  const root = mkdtempSync(join(tmpdir(), 'branch-guard-test-'));
  const output = join(root, 'output'); writeFileSync(output, '');
  const calls = [], logs = [], originalLog = console.log;
  console.log = text => logs.push(text);
  try {
    const code = await run('normal', 'chromium', 'ubuntu-latest', 'tests', { ...env, RUNNER_TEMP: root, GITHUB_OUTPUT: output }, {
      guard: async () => { calls.push('guard'); },
      spawn: (_executable, _args, options) => {
        calls.push('spawn'); assert.equal(options.stdio, 'ignore');
        writeFileSync(options.env.PWAPPY_BRANCH_COUNTS_PATH, JSON.stringify({ passed: 3, failed: 1, skipped: 2, timedOut: 0, interrupted: 0 }));
        const counts = readCounts(options.env.PWAPPY_BRANCH_COUNTS_PATH);
        const completed = Object.values(counts).reduce((sum, count) => sum + count, 0);
        writeFileSync(options.env.PWAPPY_BRANCH_PROGRESS_PATH, JSON.stringify({ total: completed, completed, counts }));
        writeFileSync(options.env.PWAPPY_BRANCH_FAILURES_PATH, '[]');
        return { status: 1, stdout: CANARY, stderr: CANARY };
      },
    });
    assert.equal(code, 1); assert.deepEqual(calls, ['guard', 'spawn']);
    assert.equal(readFileSync(output, 'utf8'), 'started=true\nEXIT_CODE=1\n');
    assert.match(logs.join('\n'), /passed=3 failed=1 skipped=2/); assert.doesNotMatch(logs.join('\n'), new RegExp(CANARY));
    await assert.rejects(run('normal', 'chromium', 'ubuntu-latest', 'cleanup', env, {
      guard: async () => { throw new Error('guard rejected'); }, spawn: () => assert.fail('must not spawn'),
    }), /guard rejected/);
  } finally { console.log = originalLog; rmSync(root, { recursive: true, force: true }); }
});

test('count reporter omits all test names, errors, attachments, URLs and environment secrets', () => {
  const Reporter = require('../scripts/branch-count-reporter.cjs');
  const root = mkdtempSync(join(tmpdir(), 'branch-count-test-'));
  const target = join(root, 'counts.json'), previous = process.env.PWAPPY_BRANCH_COUNTS_PATH;
  const previousFailures = process.env.PWAPPY_BRANCH_FAILURES_PATH;
  process.env.PWAPPY_BRANCH_FAILURES_PATH = join(root, 'failures.json');
  process.env.PWAPPY_BRANCH_COUNTS_PATH = target;
  try {
    const reporter = new Reporter();
    reporter.onTestEnd({ title: CANARY }, { status: 'passed', error: CANARY, attachments: [CANARY] });
    reporter.onTestEnd({}, { status: 'skipped' }); reporter.onEnd();
    assert.deepEqual(readCounts(target), { passed: 1, failed: 0, skipped: 1, timedOut: 0, interrupted: 0 });
    assert.doesNotMatch(readFileSync(target, 'utf8'), new RegExp(CANARY));
    for (const counts of [{ passed: CANARY }, { passed: 1, failed: 0, skipped: 0, timedOut: 0, interrupted: 0, extra: CANARY },
      { passed: -1, failed: 0, skipped: 0, timedOut: 0, interrupted: 0 }]) {
      writeFileSync(target, JSON.stringify(counts)); assert.throws(() => readCounts(target));
    }
  } finally {
    if (previous === undefined) delete process.env.PWAPPY_BRANCH_COUNTS_PATH; else process.env.PWAPPY_BRANCH_COUNTS_PATH = previous;
    if (previousFailures === undefined) delete process.env.PWAPPY_BRANCH_FAILURES_PATH; else process.env.PWAPPY_BRANCH_FAILURES_PATH = previousFailures;
    rmSync(root, { recursive: true, force: true });
  }
});

test('workflow uses branch opt-in, guards before credentials, separate suite selectors, complete checks and safe artifact boundary', () => {
  assert.match(workflow, /push:\n    branches: \[feat\/webmcp-authoring\]/);
  assert.match(workflow, /contains\(github.event.head_commit.message, '\[verify-webmcp\]'\)/);
  assert.doesNotMatch(workflow, /workflow_dispatch:|schedule:|pull_request:|gh workflow|secrets.TEST_GEMINI_API_KEY|actions: write|continue-on-error/);
  assert.match(workflow, /shell: bash/); assert.match(workflow, /max-parallel: 1/);
  assert.match(workflow, /group: pwappy-staging-shared-test-accounts/);
  assert.match(workflow, /group: pwappy-staging-account-\$\{\{ matrix.os \}\}-\$\{\{ matrix.browser \}\}/);
  assert.equal((workflow.match(/persist-credentials: false/g) || []).length, 2);
  assert.ok(workflow.indexOf('branch-verification-guard.mjs "$TEST_SUITE"') < workflow.indexOf('PWAPPY_TEST_LOGIN_PASSCODE:'));
  assert.match(workflow, /node --test offline-tests\/\*\.test\.mjs/);
  assert.match(workflow, /npm run test:discovery/); assert.match(workflow, /npm run test:webmcp:checks/);
  assert.match(workflow, /verificationPlan\(\)/);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /steps.run_tests.outputs.started == 'true'/);
  assert.match(workflow, /steps.safe_artifact.outcome == 'success'.*steps.safe_artifact.outputs.verified == 'true'.*summary_path != ''/);
  assert.match(workflow, /path: \$\{\{ steps.safe_artifact.outputs.summary_path \}\}/);
  assert.doesNotMatch(workflow, /path:.*(?:test-results|playwright-report|\.auth|\*)/);
  assert.match(workflow, /VERIFICATION_RESULT.*success/);
});

test('branch disables raw evidence and explicitly opts into the two nonphysical CI skips', () => {
  const config = readFileSync(new URL('../playwright.branch.config.ts', import.meta.url), 'utf8');
  assert.match(config, /trace: 'off', screenshot: 'off', video: 'off'/);
  for (const file of ['normal/editor-ui-basic', 'premium/agent-flow']) {
    const source = readFileSync(new URL(`../tests/specs/${file}.spec.ts`, import.meta.url), 'utf8');
    assert.match(source, /test.skip\(!!process.env.CI && process.env.PWAPPY_FULL_BRANCH_VERIFICATION !== 'true',/);
    const skip = (CI, flag) => !!CI && flag !== 'true';
    assert.equal(skip('true', undefined), true); assert.equal(skip('true', 'false'), true);
    assert.equal(skip('true', 'true'), false); assert.equal(skip(undefined, undefined), false);
  }
});


test('failure coordinates contain only static allowlisted paths and bounded line numbers', () => {
  const { sourceLocations } = require('../scripts/branch-safe-locations.cjs');
  const paths = sourceLocations();
  const file = 'tests/specs/normal/editor-ui-basic.spec.ts';
  assert.deepEqual(paths.location(join(process.cwd(), file), 10), { file, line: 10 });
  for (const [target, line] of [['.env', 1], ['/other/' + file, 1], ['tests/tools/secret-token.ts', 1],
    [file, 0], [file, -1], [file, 999999], [file, '10']]) assert.equal(paths.location(target, line), null);
  assert.deepEqual(paths.fromStack(`${CANARY}\n    at test (${join(process.cwd(), file)}:10:2)\n    at /secret/canary:3:4`), [{ file, line: 10 }]);
  for (const entry of [{ kind: 'definition', status: 'failed', file: '.env', line: 1 },
    { kind: CANARY, status: 'failed', file, line: 10 }, { kind: 'stack', status: CANARY, file, line: 10 },
    { kind: 'stack', status: 'failed', file, line: 10, extra: CANARY }]) assert.throws(() => paths.validate([entry]));
  assert.deepEqual(paths.validate([{ kind: 'definition', status: 'failed', file, line: 10 }]),
    [{ kind: 'definition', status: 'failed', file, line: 10 }]);
});

test('cleanup rechecks the marker after its child finishes and never marks another test run started', async () => {
  const root = mkdtempSync(join(tmpdir(), 'branch-cleanup-test-'));
  const output = join(root, 'output'); writeFileSync(output, '');
  const calls = [];
  try {
    const exit = await run('normal', 'chromium', 'ubuntu-latest', 'cleanup', { ...env, RUNNER_TEMP: root, GITHUB_OUTPUT: output }, {
      guard: async () => { calls.push('guard'); },
      spawn: (_executable, _args, options) => {
        calls.push('cleanup');
        writeFileSync(options.env.PWAPPY_BRANCH_COUNTS_PATH, JSON.stringify({ passed: 1, failed: 0, skipped: 0, timedOut: 0, interrupted: 0 }));
        const counts = readCounts(options.env.PWAPPY_BRANCH_COUNTS_PATH);
        const completed = Object.values(counts).reduce((sum, count) => sum + count, 0);
        writeFileSync(options.env.PWAPPY_BRANCH_PROGRESS_PATH, JSON.stringify({ total: completed, completed, counts }));
        writeFileSync(options.env.PWAPPY_BRANCH_FAILURES_PATH, '[]'); return { status: 0 };
      },
    });
    assert.equal(exit, 0); assert.deepEqual(calls, ['guard', 'cleanup', 'guard']);
    assert.equal(readFileSync(output, 'utf8'), '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('real Playwright child uses the branch config, filters raw output and reports only safe failure coordinates', async () => {
  const root = mkdtempSync(join(tmpdir(), 'branch-reporter-real-'));
  const repo = process.cwd(), logs = [], originalLog = console.log;
  const output = join(root, 'github-output'); writeFileSync(output, '');
  try {
    for (const file of ['package.json', 'playwright.config.ts', 'playwright.branch.config.ts']) copyFileSync(join(repo, file), join(root, file));
    cpSync(join(repo, 'tests'), join(root, 'tests'), { recursive: true, filter: source => {
      const stat = lstatSync(source);
      return !stat.isSymbolicLink() && (stat.isDirectory() || /\.(?:ts|cjs|mjs)$/.test(source));
    } });
    mkdirSync(join(root, 'scripts'));
    for (const file of ['branch-count-reporter.cjs', 'branch-safe-locations.cjs', 'branch-safe-sources.json']) {
      copyFileSync(join(repo, 'scripts', file), join(root, 'scripts', file));
    }
    symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'), 'dir');
    const guardPath = join(root, 'deny-network.cjs');
    writeFileSync(guardPath, `const deny=()=>{throw Error('Network forbidden');};
      for(const name of ['node:http','node:https']) { const api=require(name); api.request=deny; api.get=deny; }
      const net=require('node:net'); net.connect=deny; net.createConnection=deny;
      net.Socket.prototype.connect=deny; net.Server.prototype.listen=deny;
      require('node:tls').connect=deny; globalThis.fetch=deny;
      require('node:module').syncBuiltinESMExports();`);
    const file = 'tests/specs/normal/editor-ui-basic.spec.ts';
    // Only this disposable copy changes. No browser fixture or service operation runs.
    writeFileSync(join(root, file), `import { test, expect } from '@playwright/test';
      test('SYNTHETIC_SECRET_NEVER_ECHO', () => { console.log('SYNTHETIC_SECRET_NEVER_ECHO'); expect(1).toBe(2); });
      test('passing', async () => { await new Promise(resolve => setTimeout(resolve, 100)); expect(1).toBe(1); });
      test.skip('applicability skip', () => {});`);
    console.log = line => logs.push(line);
    const status = await run('normal', 'chromium', 'ubuntu-latest', 'tests', { ...env,
      RUNNER_TEMP: root, GITHUB_OUTPUT: output, NODE_OPTIONS: `--require=${guardPath}`,
      PATH: process.env.PATH, HOME: root }, {
      guard: async () => {},
      spawn: (executable, args, options, progress) => spawnWithProgress(executable, args.map(value => value === 'tests/specs/normal' ? file : value),
        { ...options, cwd: root, timeout: 30000 }, progress, {
          setInterval: callback => setInterval(callback, 10),
        }),
    });
    assert.equal(status, 1);
    assert.ok(logs.some(line => line.startsWith('Branch progress: total=3 completed=')));
    assert.match(logs.join('\n'), /passed=1 failed=1 skipped=1/);
    assert.match(logs.join('\n'), /Branch failure: failed definition tests\/specs\/normal\/editor-ui-basic.spec.ts:2/);
    assert.match(logs.join('\n'), /Branch failure: failed stack tests\/specs\/normal\/editor-ui-basic.spec.ts:2/);
    assert.doesNotMatch(logs.join('\n'), new RegExp(CANARY));
    assert.doesNotMatch(logs.join('\n'), /Expected|Received|expect\(|toBe|Error:/);
  } finally { console.log = originalLog; rmSync(root, { recursive: true, force: true }); }
});


test('progress snapshots reject nonnumeric, extra, oversized, inconsistent and regressing data', () => {
  const root = mkdtempSync(join(tmpdir(), 'branch-progress-schema-'));
  const path = join(root, 'progress.json');
  const good = { total: 3, completed: 1, counts: { passed: 1, failed: 0, skipped: 0, timedOut: 0, interrupted: 0 } };
  try {
    writeFileSync(path, JSON.stringify(good)); assert.deepEqual(readProgress(path), good);
    for (const value of [null, [], { ...good, extra: CANARY }, { ...good, total: CANARY },
      { ...good, total: 100001 }, { ...good, total: 0 }, { ...good, completed: 2 },
      { ...good, counts: { ...good.counts, passed: -1 } },
      { ...good, counts: { ...good.counts, passed: 1.5 } },
      { ...good, counts: { ...good.counts, extra: CANARY } }]) {
      writeFileSync(path, JSON.stringify(value)); assert.throws(() => readProgress(path));
    }
    writeFileSync(path, JSON.stringify(good));
    assert.throws(() => readProgress(path, { ...good, total: 4 }));
    assert.throws(() => readProgress(path, { ...good, counts: { ...good.counts, passed: 2 } }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('asynchronous child reporting is bounded, ignores raw streams, and clears timer on close/error', async () => {
  const { EventEmitter } = await import('node:events');
  for (const failed of [false, true]) {
    const child = new EventEmitter(); let callback, cleared = 0, updates = 0;
    const result = spawnWithProgress('synthetic', [], { stdio: 'ignore' }, () => updates++, {
      spawn: (_executable, _args, options) => { assert.equal(options.stdio, 'ignore'); return child; },
      setInterval: (fn, milliseconds) => { callback = fn; assert.equal(milliseconds, 30000); return 123; },
      clearInterval: timer => { assert.equal(timer, 123); cleared++; },
    });
    for (let i = 0; i < 1000; i++) callback();
    assert.equal(updates, 240);
    if (failed) child.emit('error', new Error(CANARY)); else child.emit('close', 0);
    assert.deepEqual(await result, { status: failed ? 1 : 0 }); assert.equal(cleared, 1);
  }
});

test('runner rejects missing completion, inconsistent final counts and invalid intermediate progress', async () => {
  const root = mkdtempSync(join(tmpdir(), 'branch-progress-final-'));
  const output = join(root, 'output'); writeFileSync(output, '');
  const counts = { passed: 1, failed: 0, skipped: 0, timedOut: 0, interrupted: 0 };
  const originalLog = console.log, logs = []; console.log = line => logs.push(line);
  try {
    for (const mode of ['missing', 'incomplete', 'mismatch', 'invalid-intermediate']) {
      await assert.rejects(run('normal', 'chromium', 'ubuntu-latest', 'tests', { ...env, RUNNER_TEMP: root, GITHUB_OUTPUT: output }, {
        guard: async () => {},
        spawn: (_executable, _args, options, progress) => {
          const path = options.env.PWAPPY_BRANCH_PROGRESS_PATH;
          if (mode === 'invalid-intermediate') { writeFileSync(path, CANARY); progress(); }
          if (mode !== 'missing') writeFileSync(path, JSON.stringify({ total: mode === 'incomplete' ? 2 : 1, completed: 1, counts }));
          progress();
          writeFileSync(options.env.PWAPPY_BRANCH_COUNTS_PATH, JSON.stringify(mode === 'mismatch' ? { ...counts, passed: 2 } : counts));
          writeFileSync(options.env.PWAPPY_BRANCH_FAILURES_PATH, '[]');
          return { status: 0 };
        },
      }), /branch progress/i);
    }
    assert.doesNotMatch(logs.join('\n'), new RegExp(CANARY));
  } finally { console.log = originalLog; rmSync(root, { recursive: true, force: true }); }
});
