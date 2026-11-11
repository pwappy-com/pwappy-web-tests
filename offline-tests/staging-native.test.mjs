import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertFreshTestAccountAuthCache } from '../scripts/premium-key-preflight.mjs';
import { tmpdir } from 'node:os';
import { nativeInvocation, run, PHASES } from '../scripts/run-staging-native.mjs';
const require = createRequire(import.meta.url);
const { ORIGIN, VERSION, ASSET, ALLOWED, READS, fixedPayloads, guardToolCall, validateTarget } = require('../scripts/staging-native-contract.cjs');
const APP = 'wmcpstage-' + 'a'.repeat(20), TOKEN = 'b'.repeat(32);
const TARGET = `${ORIGIN}/app_editor.html?identKey=pwuc000&appKey=${APP}&version=${VERSION}`;
const REMOTE = 'http://127.0.0.1:19232/';
const ENV = { TEST_SUITE: 'normal', TEST_BROWSER: 'chromium', TEST_OS: 'ubuntu-latest',
  GITHUB_RUN_ID: '1234', GITHUB_RUN_ATTEMPT: '1', GITHUB_OUTPUT: '/unused/offline-output',
  PWAPPY_TEST_LOGIN_PASSCODE: 'SYNTHETIC_CANARY_NO_OUTPUT' };

test('bridge requires exact staging URL, new synthetic app, dedicated account and loopback endpoint', () => {
  assert.deepEqual(validateTarget(REMOTE, TARGET, TOKEN, APP), { endpoint: REMOTE, target: TARGET });
  for (const target of [TARGET.replace(ORIGIN, 'https://dev.pwappy.com'), TARGET.replace('pwuc000', 'pwuc001'),
    TARGET.replace(APP, 'existing-app'), TARGET + '&extra=x', TARGET + '#fragment', TARGET.replace('/app_editor.html', '/editor')]) {
    assert.throws(() => validateTarget(REMOTE, target, TOKEN, APP));
  }
  for (const remote of ['http://localhost:19232', 'https://127.0.0.1:19232', 'http://10.0.0.1:19232',
    REMOTE + 'json', REMOTE + '?token=x', 'http://user:pass@127.0.0.1:19232']) {
    assert.throws(() => validateTarget(remote, TARGET, TOKEN, APP));
  }
  assert.throws(() => validateTarget(REMOTE, TARGET, '', APP));
  assert.throws(() => validateTarget(REMOTE, TARGET, TOKEN, 'existing-app'));
});

test('only fixed synthetic editor and asset payloads can pass the mutation bridge', () => {
  const payloads = fixedPayloads(APP);
  for (const name of READS) { guardToolCall(name, {}, APP); assert.throws(() => guardToolCall(name, { unexpected: true }, APP)); }
  for (const [name, payload] of Object.entries(payloads)) {
    const needsRevision = ['pwappy_save_project', 'pwappy_read_asset_file', 'pwappy_update_global_style', 'pwappy_update_app_settings'].includes(name);
    const args = { ...payload, ...(needsRevision ? { expectedRevision: 'verified-revision' } : {}) };
    guardToolCall(name, args, APP);
    assert.throws(() => guardToolCall(name, { ...args, unexpected: true }, APP));
    if (needsRevision) assert.throws(() => guardToolCall(name, payload, APP));
    if ('appKey' in args) assert.throws(() => guardToolCall(name, { ...args, appKey: 'existing-app' }, APP));
  }
  for (const name of ['pwappy_delete_app', 'pwappy_delete_version', 'pwappy_publish_version',
    'pwappy_import_project_bundle', 'pwappy_run_tests', 'pwappy_manage_app_resource']) {
    assert.ok(!ALLOWED.includes(name)); assert.throws(() => guardToolCall(name, {}, APP));
  }
  assert.throws(() => guardToolCall('pwappy_manage_script', { ...payloads.pwappy_manage_script, scriptContent: 'fetch("https://external.invalid")' }, APP));
  assert.throws(() => guardToolCall('pwappy_upload_asset_file', { ...payloads.pwappy_upload_asset_file, base64: 'invalid' }, APP));
  assert.throws(() => guardToolCall('pwappy_upload_asset_file', { ...payloads.pwappy_upload_asset_file, name: '../existing.json' }, APP));
  assert.equal(Buffer.from(payloads.pwappy_upload_asset_file.base64, 'base64').toString(), ASSET.text);
});

test('wrapper selects only serial normal Ubuntu Chrome and preserves its exact index-zero identity', () => {
  const { childEnv, args } = nativeInvocation(ENV, '/temporary/new', 19232, TOKEN);
  assert.ok(args.includes(`--config=${fileURLToPath(new URL('../playwright.staging-native.config.ts', import.meta.url))}`));
  assert.ok(args.includes('--workers=1')); assert.ok(args.includes('--retries=0'));
  assert.equal(childEnv.PWAPPY_TEST_ACCOUNT_INDEX, '0'); assert.equal(childEnv.TEST_RUN_SUFFIX, 'ubuntu');
  assert.equal(childEnv.PWAPPY_TEST_CLEANUP_BROWSER_CODE, 'c'); assert.equal(childEnv.PWAPPY_TEST_RUN_ID, '1234-1-normal');
  assert.equal(childEnv.PWAPPY_TEST_POINTS_PHASE, 'tests'); assert.equal(childEnv.PWAPPY_STAGING_NATIVE_GUARDED, 'true');
  assert.equal(childEnv.DOTENV_CONFIG_PATH, '/temporary/new/absent.env');
  for (const override of [{ TEST_SUITE: 'premium' }, { TEST_OS: 'windows-latest' }, { TEST_BROWSER: 'mobile-chrome' },
    { GITHUB_RUN_ID: '' }, { PWAPPY_TEST_LOGIN_PASSCODE: '' }]) assert.throws(() => nativeInvocation({ ...ENV, ...override }, '/tmp', 19232, TOKEN));
});

test('failed preauthentication source guard never spawns a browser/test process', async () => {
  let spawned = false;
  await assert.rejects(run(ENV, { guard: async () => { throw Error('blocked'); },
    spawn: () => { spawned = true; }, unusedPort: async () => 19232 }), /blocked/);
  assert.equal(spawned, false);
});

for (const scenario of [{ phase: 'complete', passed: 1, failed: 0, status: 0, expected: 0 },
  { phase: 'native-preflight', passed: 0, failed: 1, status: 1, expected: 1 },
  { phase: 'complete', passed: 0, failed: 0, status: 0, expected: 1 },
  { phase: ENV.PWAPPY_TEST_LOGIN_PASSCODE, passed: 1, failed: 0, status: 0, expected: 1 }]) {
  test(`wrapper reports only validated counters and phase (${PHASES.includes(scenario.phase) ? scenario.phase : 'invalid'})`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'native-smoke-offline-'));
    const output = join(root, 'github-output'); writeFileSync(output, '');
    const messages = [], oldLog = console.log, oldError = console.error;
    console.log = (...items) => messages.push(items.join(' ')); console.error = (...items) => messages.push(items.join(' '));
    try {
      const exit = await run({ ...ENV, GITHUB_OUTPUT: output, RUNNER_TEMP: root }, { guard: async suite => assert.equal(suite, 'normal'),
        unusedPort: async () => 19232, spawn: (_command, _args, options) => {
          assert.equal(options.stdio, 'ignore');
          writeFileSync(options.env.PWAPPY_BRANCH_COUNTS_PATH, JSON.stringify({ passed: scenario.passed, failed: scenario.failed, skipped: 0, timedOut: 0, interrupted: 0 }));
          writeFileSync(options.env.PWAPPY_STAGING_NATIVE_PHASE_PATH, JSON.stringify(scenario.phase));
          return { status: scenario.status, stdout: ENV.PWAPPY_TEST_LOGIN_PASSCODE, stderr: ENV.PWAPPY_TEST_LOGIN_PASSCODE };
        } });
      assert.equal(exit, scenario.expected);
      assert.doesNotMatch(messages.join('\n'), new RegExp(ENV.PWAPPY_TEST_LOGIN_PASSCODE));
      assert.match(readFileSync(output, 'utf8'), /^EXIT_CODE=[01]\n$/);
      if (scenario.phase === 'native-preflight') assert.match(messages.join('\n'), /no adapter fallback/);
    } finally { console.log = oldLog; console.error = oldError; rmSync(root, { recursive: true, force: true }); }
  });
}

test('native transport source has no page evaluation or mocks, isolated evidence is never uploaded', () => {
  const bridge = readFileSync(new URL('../scripts/staging-native-stdio.cjs', import.meta.url), 'utf8');
  assert.match(bridge, /session\.send\('WebMCP\.enable'\)/); assert.match(bridge, /session\.send\('WebMCP\.invokeTool'/);
  assert.doesNotMatch(bridge, /\.evaluate\(|\.executeTool\(/);
  assert.match(bridge, /playwright_chromiumdev_profile-/);
  const spec = readFileSync(new URL('../staging-tests/native-persistence.spec.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(spec, /route\.fulfill|\.attach\(|\.screenshot\(/);
  assert.match(spec, /origins: \[\]/);
  const config = readFileSync(new URL('../playwright.staging-native.config.ts', import.meta.url), 'utf8');
  assert.match(config, /testDir: '\.\/staging-tests'/); assert.doesNotMatch(config, /^import .*dotenv/m);
  assert.match(config, /trace: 'off', screenshot: 'off', video: 'off'/);
  const workflow = readFileSync(new URL('../.github/workflows/webmcp-branch-verification.yml', import.meta.url), 'utf8');
  const step = workflow.slice(workflow.indexOf('      - name: Verify native WebMCP'), workflow.indexOf('      - name: Clean only'));
  assert.match(step, /success\(\).*matrix\.suite == 'normal'.*matrix\.os == 'ubuntu-latest'.*matrix\.browser == 'chromium'/);
  assert.match(step, /npm run test:webmcp:staging/);
});

const { gzipSync } = require('node:zlib');
const { FIELDS, emptyDiagnostic, ownEditorRequest, responseEvidence, sanitizeSnapshot, validateDiagnostic } = require('../scripts/staging-startup-diagnostic.cjs');
const encode = value => gzipSync(JSON.stringify(value)).toString('base64');
test('startup evidence compares only eight fixed decoded fields and never exports payloads', () => {
  const secret = 'SYNTHETIC_PRIVATE_CANARY';
  const sent = Object.fromEntries(FIELDS.map(field => [field, encode({ synthetic: secret, a: 1 })]));
  const details = { ...sent, editorJsonVersion: 'aW5pdA==', unexpected: secret };
  details.testItems = encode({ synthetic: secret, a: 2 });
  delete details.toolBoxItems;
  const result = responseEvidence('GET', 200, { code: 200, details, message: secret }, sent);
  assert.equal(result.fields.testItems.equal, false);
  assert.equal(result.fields.appSettings.equal, true);
  assert.deepEqual(result.fields.toolBoxItems, { present: false, equal: null });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  assert.equal(result.editorJsonVersionPresent, true);
  assert.equal(responseEvidence('GET', 200, { details: { editorJson: details } }, sent).fields.appSettings.present, false);
  assert.equal(responseEvidence('GET', 200, { details: { appSettings: secret } }, sent).fields.appSettings.equal, null);
});
test('startup response observation is confined to exact owned app and endpoint', () => {
  const endpoint = `${ORIGIN}/pwappy-api/rest/v1/editor-json`;
  const get = `${endpoint.replace('/rest/', '/read/')}?appKey=${APP}&version=${VERSION}`;
  assert.equal(ownEditorRequest(get, 'GET', APP), true);
  assert.equal(ownEditorRequest(endpoint, 'PUT', APP, { appKey: APP, version: VERSION }), true);
  for (const url of [get + '&extra=secret', get.replace(APP, 'existing'), get.replace(ORIGIN, 'https://example.org'), get + '#x']) {
    assert.equal(ownEditorRequest(url, 'GET', APP), false);
  }
  assert.equal(ownEditorRequest(endpoint, 'POST', APP, { appKey: APP, version: VERSION }), false);
});
test('diagnostic strict schema rejects any unknown keys, free text, invalid enums or numbers', () => {
  const base = emptyDiagnostic();
  assert.deepEqual(validateDiagnostic(base), base);
  for (const mutation of [{ extra: 'secret' }, { saveStatus: 'secret' }, { errorClassification: 'secret' },
    { getCode: 'secret' }, { putHttpStatus: 999 }, { pageNodes: -1 }, { initialVersionInit: 'secret' },
    { fields: { ...base.fields, secret: true } }, { fields: { ...base.fields, testItems: { present: true, equal: null, secret: true } } }]) {
    assert.equal(validateDiagnostic({ ...base, ...mutation }), null);
  }
  assert.equal(sanitizeSnapshot({ error: 'secret', saveStatus: 'secret' }).errorClassification, 'unknown');
});
for (const malicious of [false, true]) test(`startup wrapper emits only strict evidence (malicious=${malicious})`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'native-startup-offline-'));
  const output = join(root, 'github-output'); writeFileSync(output, '');
  const messages = [], oldLog = console.log, oldError = console.error;
  console.log = (...items) => messages.push(items.join(' ')); console.error = (...items) => messages.push(items.join(' '));
  try {
    const exit = await run({ ...ENV, GITHUB_OUTPUT: output, RUNNER_TEMP: root }, { guard: async () => {}, unusedPort: async () => 19232,
      spawn: (_command, _args, { env }) => {
        writeFileSync(env.PWAPPY_BRANCH_COUNTS_PATH, JSON.stringify({ passed: 0, failed: 1, skipped: 0, timedOut: 0, interrupted: 0 }));
        writeFileSync(env.PWAPPY_STAGING_NATIVE_PHASE_PATH, JSON.stringify('editor-startup'));
        writeFileSync(env.PWAPPY_STAGING_NATIVE_CLEANUP_PATH, JSON.stringify({ outcome: 'failed', deleteRequested: true, absenceVerified: false, blockedWrites: false, ...(malicious ? { extra: ENV.PWAPPY_TEST_LOGIN_PASSCODE } : {}) }));
        writeFileSync(env.PWAPPY_STAGING_NATIVE_DIAGNOSTIC_PATH, JSON.stringify({ ...emptyDiagnostic(), ...(malicious ? { extra: ENV.PWAPPY_TEST_LOGIN_PASSCODE } : {}) }));
        return { status: 1 };
      } });
    assert.equal(exit, 1);
    assert.doesNotMatch(messages.join('\n'), new RegExp(ENV.PWAPPY_TEST_LOGIN_PASSCODE));
    assert.match(messages.join('\n'), malicious ? /diagnostic: unavailable/ : /"schemaVersion":1/);
    assert.match(messages.join('\n'), malicious ? /Native cleanup: unknown/ : /Native cleanup: \{"outcome":"failed"/);
  } finally { console.log = oldLog; console.error = oldError; rmSync(root, { recursive: true, force: true }); }
});
test('startup capture preserves guarded finally cleanup and never actively requests backend data', () => {
  const spec = readFileSync(new URL('../staging-tests/native-persistence.spec.ts', import.meta.url), 'utf8');
  const capture = spec.slice(spec.indexOf('const captureStartup'), spec.indexOf('let primaryFailure'));
  assert.match(capture, /validateTarget/);
  assert.match(capture, /url\.origin !== expected\.origin/);
  assert.doesNotMatch(capture, /\.request\(|\.fetch\(|fetch\(|\.goto\(|\.click\(|pageerror|console\./);
  assert.match(spec, /phase\('editor-startup'\);\s+editor = await openEditor/);
  assert.match(spec, /finally \{[\s\S]*if \(cleanupNeeded\)[\s\S]*await guard\('normal'\)[\s\S]*await deleteApp\(page, appKey\)/);
  assert.match(spec, /body\?\.appKey === appKey && body\?\.version === VERSION/);
});

const { validateCleanup } = require('../scripts/staging-startup-diagnostic.cjs');
test('cleanup evidence rejects secrets and unproven success', () => {
  const good = { outcome: 'succeeded', deleteRequested: true, absenceVerified: true, blockedWrites: false };
  assert.deepEqual(validateCleanup(good), good);
  for (const change of [{ extra: 'secret' }, { outcome: 'secret' }, { deleteRequested: false }, { absenceVerified: false }, { blockedWrites: true }]) {
    assert.equal(validateCleanup({ ...good, ...change }), null);
  }
  assert.equal(validateCleanup({ ...good, outcome: 'failed' }).outcome, 'failed');
});

const { BLOCK_ENUMS, classifyBlockedRequest, emptyBlockedDiagnostic, recordBlockedRequest, validateBlockedDiagnostic } = require('../scripts/staging-startup-diagnostic.cjs');
const blockedEntry = () => classifyBlockedRequest(`${ORIGIN}/pwappy-api/rest/v1/admax-view-status/remaining-count`, 'PUT', 'cleanup-delete', 'original');
test('blocked request classifier emits fixed labels only, without retaining URL data', () => {
  assert.deepEqual(blockedEntry(), { phase: 'cleanup-delete', context: 'original', method: 'PUT', endpoint: 'admax-remaining-count', reason: 'endpoint-method' });
  const prefix = `${ORIGIN}/pwappy-api/rest/v1/`;
  for (const [url, method, parseFailed, reason] of [
    ['https://external.invalid/private?token=PRIVATE_CANARY', 'POST', false, 'outside-origin'],
    [ORIGIN + '/PRIVATE_CANARY', 'PUT', false, 'outside-rest-api'],
    [prefix + 'application?token=PRIVATE_CANARY', 'POST', false, 'query-present'],
    [prefix + 'application', 'PATCH', false, 'endpoint-method'],
    [prefix + 'application', 'POST', false, 'payload-mismatch'],
    [prefix + 'application', 'POST', true, 'parse-failed'],
    [prefix + 'PRIVATE_CANARY', 'POST', true, 'endpoint-method'],
    ['PRIVATE_CANARY', 'PRIVATE_CANARY', true, 'outside-origin'],
  ]) {
    const entry = classifyBlockedRequest(url, method, 'PRIVATE_CANARY', 'PRIVATE_CANARY', parseFailed);
    assert.equal(entry.reason, reason);
    assert.equal(entry.phase, 'unknown'); assert.equal(entry.context, 'unknown');
    assert.doesNotMatch(JSON.stringify(entry), /PRIVATE_CANARY/);
  }
});
test('blocked evidence strictly validates enums, keys, counts, totals and duplicate rows', () => {
  const base = emptyBlockedDiagnostic(); recordBlockedRequest(base, blockedEntry()); recordBlockedRequest(base, blockedEntry());
  assert.equal(base.total, 2); assert.equal(base.entries.length, 1); assert.equal(base.entries[0].count, 2);
  assert.deepEqual(validateBlockedDiagnostic(base), base);
  const bad = [null, [], { ...base, secret: 'PRIVATE_CANARY' }, { ...base, schemaVersion: 2 },
    { ...base, total: 1 }, { ...base, total: -1 }, { ...base, overflow: 1 },
    { ...base, entries: [...base.entries, ...base.entries], total: 4 }, { ...base, entries: null }];
  for (const key of Object.keys(BLOCK_ENUMS)) bad.push({ ...base, entries: [{ ...base.entries[0], [key]: 'PRIVATE_CANARY' }] });
  for (const count of [-1, 0, 1.5, 1000001, Infinity, NaN, 'PRIVATE_CANARY', true]) bad.push({ ...base, entries: [{ ...base.entries[0], count }] });
  bad.push({ ...base, entries: [{ ...base.entries[0], url: 'PRIVATE_CANARY' }] });
  for (const value of bad) assert.equal(validateBlockedDiagnostic(value), null);
  assert.throws(() => recordBlockedRequest(base, { ...blockedEntry(), phase: 'PRIVATE_CANARY' }));
});
test('blocked evidence caps row cardinality with explicit overflow without relaxing rejection', () => {
  const value = emptyBlockedDiagnostic();
  for (const phase of BLOCK_ENUMS.phase) for (const method of BLOCK_ENUMS.method) recordBlockedRequest(value, { ...blockedEntry(), phase, method });
  assert.equal(value.entries.length, 64);
  assert.equal(value.overflow, value.total - 64);
  assert.deepEqual(validateBlockedDiagnostic(value), value);
  assert.equal(validateBlockedDiagnostic({ ...value, entries: [...value.entries, value.entries[0]] }), null);
});
for (const variant of ['valid', 'unknown-key', 'unknown-enum', 'oversized', 'malformed']) test(`wrapper rejects unsafe blocked diagnostics (${variant})`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'native-blocked-offline-'));
  const output = join(root, 'github-output'); writeFileSync(output, '');
  const messages = [], oldLog = console.log;
  console.log = (...items) => messages.push(items.join(' '));
  try {
    const exit = await run({ ...ENV, GITHUB_OUTPUT: output, RUNNER_TEMP: root }, { guard: async () => {}, unusedPort: async () => 19232,
      spawn: (_command, _args, { env }) => {
        writeFileSync(env.PWAPPY_BRANCH_COUNTS_PATH, JSON.stringify({ passed: 0, failed: 1, skipped: 0, timedOut: 0, interrupted: 0 }));
        writeFileSync(env.PWAPPY_STAGING_NATIVE_PHASE_PATH, JSON.stringify('cleanup-assertions'));
        const evidence = emptyBlockedDiagnostic(); recordBlockedRequest(evidence, blockedEntry());
        if (variant === 'unknown-key') evidence.secret = ENV.PWAPPY_TEST_LOGIN_PASSCODE;
        if (variant === 'unknown-enum') evidence.entries[0].endpoint = ENV.PWAPPY_TEST_LOGIN_PASSCODE;
        const raw = variant === 'oversized' ? JSON.stringify({ secret: ENV.PWAPPY_TEST_LOGIN_PASSCODE.repeat(1024) })
          : variant === 'malformed' ? ENV.PWAPPY_TEST_LOGIN_PASSCODE : JSON.stringify(evidence);
        writeFileSync(env.PWAPPY_STAGING_NATIVE_BLOCKED_PATH, raw);
        return { status: 1 };
      } });
    assert.equal(exit, 1);
    assert.doesNotMatch(messages.join('\n'), new RegExp(ENV.PWAPPY_TEST_LOGIN_PASSCODE));
    assert.match(messages.join('\n'), variant === 'valid' ? /Native blocked requests: .*admax-remaining-count/ : /Native blocked requests: unavailable/);
  } finally { console.log = oldLog; rmSync(root, { recursive: true, force: true }); }
});
test('blocked diagnostics preserve abort and zero-block assertion at both checkpoints', () => {
  const spec = readFileSync(new URL('../staging-tests/native-persistence.spec.ts', import.meta.url), 'utf8');
  assert.equal((spec.match(/expect\(apiCounts.blocked\)\.toBe\(0\)/g) || []).length, 2);
  assert.match(spec, /recordBlockedRequest[\s\S]*return route\.abort\('blockedbyclient'\)/);
  for (const phase of ['cleanup-close-clients', 'cleanup-close-contexts', 'cleanup-guard', 'cleanup-delete', 'cleanup-verify-absence', 'cleanup-assertions']) assert.ok(PHASES.includes(phase));
});

for (const preexisting of [false, true]) test(`real browserless native worker isolates auth from main checkout (preexisting=${preexisting})`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'native-auth-offline-'));
  const checkout = join(root, 'checkout'), runnerTemp = join(root, 'runner');
  mkdirSync(checkout); mkdirSync(runnerTemp);
  const output = join(root, 'github-output'), config = join(root, 'synthetic.config.cjs');
  const checkoutCache = join(checkout, '.auth/user-u-c-0.json');
  const sentinel = JSON.stringify({ cookies: [], origins: [], existing: 'SYNTHETIC_DO_NOT_TOUCH' });
  if (preexisting) { mkdirSync(join(checkout, '.auth')); writeFileSync(checkoutCache, sentinel); }
  writeFileSync(config, `module.exports = ${JSON.stringify({
    testDir: fileURLToPath(new URL('.', import.meta.url)), testMatch: 'native-auth-isolation.playwright.ts',
    reporter: fileURLToPath(new URL('../scripts/staging-native-reporter.cjs', import.meta.url)),
    workers: 1, retries: 0, timeout: 10000,
  })};`);
  const oldCwd = process.cwd();
  let ownedRoot;
  try {
    process.chdir(checkout);
    const exit = await run({ ...ENV, GITHUB_OUTPUT: output, RUNNER_TEMP: runnerTemp }, {
      guard: async () => {}, unusedPort: async () => 19232,
      spawn: (command, args, options) => {
        ownedRoot = options.cwd;
        assert.ok(ownedRoot?.startsWith(join(runnerTemp, 'pwappy-staging-native-')));
        // Discover the real native config/spec from the isolated cwd without a browser.
        const listed = spawnSync(command, [...args, '--list'], { ...options,
          env: { ...options.env, PWAPPY_BRANCH_COUNTS_PATH: join(ownedRoot, 'discovery-counts.json') } });
        assert.equal(listed.status, 0, 'real native config and helper imports resolve outside checkout');
        return spawnSync(command, args.map(arg => arg.startsWith('--config=') ? `--config=${config}` : arg), options);
      },
    });
    assert.equal(exit, 0);
    assert.deepEqual(JSON.parse(readFileSync(join(ownedRoot, '.auth/user-u-c-0.json'), 'utf8')),
      { cookies: [], origins: [], synthetic: true });
    if (preexisting) {
      assert.equal(readFileSync(checkoutCache, 'utf8'), sentinel);
      assert.throws(() => assertFreshTestAccountAuthCache('chromium', 'ubuntu-latest', '0', checkout),
        /existing authentication state must not be reused or overwritten/);
      assert.equal(readFileSync(checkoutCache, 'utf8'), sentinel);
    } else {
      assert.equal(existsSync(join(checkout, '.auth')), false);
      assert.doesNotThrow(() => assertFreshTestAccountAuthCache('chromium', 'ubuntu-latest', '0', checkout));
    }
  } finally { process.chdir(oldCwd); rmSync(root, { recursive: true, force: true }); }
});
