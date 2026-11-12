import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { classify, parseHelper, validate, readDiagnostics, LIMIT } = require('../scripts/branch-safe-diagnostics.cjs');
const Reporter = require('../scripts/branch-count-reporter.cjs');
const secret = 'SECRET_selector_password_URL_user_actual';
const location = { file: 'tests/specs/normal/editor-ui-basic.spec.ts', line: 2 };
const navigation = { event: 'failed', reason: 'offline_precommit', attempt: 2, failedDocument: true,
  responseSeen: false, committed: false, nonGetSeen: false, crashed: false, closed: false, disconnected: false };
const http = { status: 503, method: 'GET', resource: 'xhr', pathKind: 'editor-json', serverFamily: 'nginx',
  retryAfter: { kind: 'seconds', seconds: 600, capped: false }, contentType: 'json' };
const line = (prefix, value) => `[${prefix}] ${JSON.stringify(value)}\n`;

test('primary errors map to fixed classes, operations and matcher names without messages', () => {
  for (const [message, errorClass, operation, matcher] of [
    [`page.goto: net::ERR_INTERNET_DISCONNECTED at https://${secret}`, 'navigation-offline', 'page.goto', 'unknown'],
    [`page.goto: The Internet connection appears to be offline. while navigating to https://${secret}`, 'navigation-offline', 'page.goto', 'unknown'],
    [`page.goto: The Internet connection appears to be offline.`, 'navigation-offline', 'page.goto', 'unknown'],
    [`page.goto: NS_ERROR_OFFLINE ${secret}`, 'navigation-offline', 'page.goto', 'unknown'],
    [`page.goto: net::ERR_CONNECTION_RESET ${secret}`, 'navigation-reset', 'page.goto', 'unknown'],
    [`page.goto: net::ERR_NAME_NOT_RESOLVED ${secret}`, 'navigation-dns', 'page.goto', 'unknown'],
    [`page.goto: net::ERR_HTTP_RESPONSE_CODE_FAILURE ${secret}`, 'navigation-http', 'page.goto', 'unknown'],
    [`page.goto: net::ERR_CONNECTION_REFUSED ${secret}`, 'navigation-connection', 'page.goto', 'unknown'],
    [`locator.click: Timeout 30000ms exceeded.\n${secret}`, 'timeout', 'locator.click', 'unknown'],
    [`locator.click: Target page, context or browser has been closed\n${secret}`, 'page-closed', 'locator.click', 'unknown'],
    [`page.goto: Page crashed\n${secret}`, 'page-crashed', 'page.goto', 'unknown'],
    [`\x1b[31mexpect(${secret}).not.toHaveText(${secret}) failed\x1b[39m\nExpected: ${secret}`, 'assertion', 'expect', 'toHaveText'],
    [`expect(${secret}).toBe(${secret}) // Object.is equality`, 'assertion', 'expect', 'toBe'],
    [`${secret}\npage.goto: net::ERR_CONNECTION_RESET`, 'unknown', 'unknown', 'unknown'],
  ]) assert.deepEqual(classify({ message, stack: secret, value: secret }, 'failed'), { errorClass, operation, matcher });
  assert.equal(classify(undefined, 'timedOut').errorClass, 'timeout');
  assert.equal(classify({ message: secret }, 'failed').errorClass, 'unknown');
  assert.equal(classify({ message: `expect(${secret}).${secret}(x)` }, 'failed').matcher, 'unknown');
  assert.doesNotMatch(JSON.stringify(classify({ message: secret }, 'failed')), /SECRET/);
});

test('exact known helper stdout shapes reduce to enums, no raw data or arbitrary stdout', () => {
  assert.deepEqual(parseHelper(line('dashboard-navigation-recovery', navigation)), { kind: 'navigation', ...navigation });
  const expected = { kind: 'http', ...http, status: '503', retryAfter: 'seconds' };
  assert.deepEqual(parseHelper(Buffer.from(line('HttpFailure', http))), expected);
  assert.equal(parseHelper(line('HttpFailure', { ...http, status: 599 })).status, 'other-5xx');
  for (const value of [secret, line('Unknown', http), line('HttpFailure', http) + secret, line('HttpFailure', http).repeat(2),
    '[HttpFailure] {', '[HttpFailure] ' + 'x'.repeat(5000), line('HttpFailure', { ...http, extra: secret }),
    line('HttpFailure', { ...http, method: secret }), line('HttpFailure', { ...http, status: 200 }),
    line('HttpFailure', { ...http, retryAfter: { kind: 'seconds', seconds: 999999, capped: true } }),
    line('HttpFailure', { ...http, retryAfter: { kind: 'absent', extra: secret } }),
    line('dashboard-navigation-recovery', { ...navigation, event: secret }),
    line('dashboard-navigation-recovery', { ...navigation, closed: secret }),
    line('dashboard-navigation-recovery', { ...navigation, extra: secret }),
    line('dashboard-navigation-recovery', { ...navigation, attempt: 3 }),
    '[HttpFailure] {"__proto__":{"secret":"SECRET"}}', undefined]) assert.equal(parseHelper(value), null);
});

test('parent boundary rejects malicious fields, arbitrary enums, coordinates and oversized files', () => {
  const record = { kind: 'error', ...location, status: 'failed', ...classify({}, 'failed') };
  assert.deepEqual(validate([record]), [record]);
  for (const changed of [{ extra: secret }, { errorClass: secret }, { matcher: secret }, { operation: secret },
    { kind: secret }, { status: secret }, { file: secret }, { line: 999999 }, { file: '../' + location.file }]) {
    assert.throws(() => validate([{ ...record, ...changed }]), /Invalid branch diagnostics/);
  }
  const helper = { ...location, ...parseHelper(line('HttpFailure', http)) };
  assert.deepEqual(validate([helper]), [helper]);
  assert.throws(() => validate([{ ...helper, retryAfter: http.retryAfter }]), /Invalid branch diagnostics/);
  assert.throws(() => validate(Array(LIMIT + 1).fill(record)), /Invalid branch diagnostics/);
  const root = mkdtempSync(join(tmpdir(), 'safe-diagnostics-'));
  try {
    const target = join(root, 'diagnostics.json');
    for (const value of [secret, ' '.repeat(262145), JSON.stringify([{ ...record, operation: secret }])]) {
      writeFileSync(target, value);
      assert.throws(() => readDiagnostics(target), error => error.message === 'Invalid branch diagnostics');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('reporter discards sensitive titles, attachments, errors, raw stdout and caps safe diagnostics', () => {
  const root = mkdtempSync(join(tmpdir(), 'safe-reporter-'));
  const names = ['COUNTS', 'FAILURES', 'DIAGNOSTICS'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[`PWAPPY_BRANCH_${name}_PATH`]]));
  for (const name of names) process.env[`PWAPPY_BRANCH_${name}_PATH`] = join(root, name + '.json');
  try {
    const reporter = new Reporter(), test = { location, title: secret };
    reporter.onStdOut(secret, test);
    reporter.onStdOut(line('HttpFailure', { ...http, secret }), test);
    reporter.onStdOut(line('HttpFailure', http), undefined);
    reporter.onStdOut(line('dashboard-navigation-recovery', navigation), test);
    reporter.onTestEnd(test, { status: 'failed', errors: [{ message: `expect(${secret}).toBe(${secret})`, stack: secret }], attachments: [secret] });
    reporter.onEnd();
    const text = readFileSync(process.env.PWAPPY_BRANCH_DIAGNOSTICS_PATH, 'utf8');
    const records = readDiagnostics(process.env.PWAPPY_BRANCH_DIAGNOSTICS_PATH);
    assert.equal(records.length, 2); assert.equal(records[1].matcher, 'toBe'); assert.doesNotMatch(text, /SECRET/);
    for (let i = 0; i < 1000; i++) reporter.onTestEnd(test, { status: 'failed', errors: [] });
    assert.equal(reporter.diagnostics.length, LIMIT);
  } finally {
    for (const name of names) {
      const key = `PWAPPY_BRANCH_${name}_PATH`;
      if (previous[name] === undefined) delete process.env[key]; else process.env[key] = previous[name];
    }
    rmSync(root, { recursive: true, force: true });
  }
});


test('editor startup allows only the exact enum and boolean snapshot at both boundaries', () => {
  const startup = { captured: true, containerPresent: true, storePresent: true, loading: false,
    empty: true, initialVersionInit: false, saveStatus: 'failed', serverSaved: false,
    serverVerified: null, starterVisible: true, messageVisible: false, initialSaveError: true,
    pageNodesPresent: true, navigatorNodesPresent: false, errorClassification: 'readback-mismatch' };
  const parsed = parseHelper(line('EditorStartupFailure', startup));
  assert.deepEqual(parsed, { kind: 'editor-startup', ...startup });
  assert.deepEqual(validate([{ ...location, ...parsed }]), [{ ...location, ...parsed }]);
  for (const key of Object.keys(startup)) {
    assert.equal(parseHelper(line('EditorStartupFailure', { ...startup, [key]: secret })), null);
    assert.throws(() => validate([{ ...location, ...parsed, [key]: secret }]), /Invalid branch diagnostics/);
    const missing = { ...startup }; delete missing[key];
    assert.equal(parseHelper(line('EditorStartupFailure', missing)), null);
  }
  assert.equal(parseHelper(line('EditorStartupFailure', { ...startup, extra: secret })), null);
});

test('drag diagnostics allow only exact boolean/enum schema at both boundaries', () => {
  const drag = { phase: 'before-assert', captured: true, targetExists: true, targetInScrollport: true,
    pointerInScrollport: true, dragImageActive: true, dragActive: true, sourceMatched: true,
    siblingMarkerSelected: false, scrollAtBottom: false, scrollAtTop: false, canScroll: true, targetBelow: false, pointerInViewport: true, popupOpen: false, hit: 'target-gap' };
  const parsed = parseHelper(line('EditorDragState', drag));
  assert.deepEqual(parsed, { kind: 'editor-drag', ...drag });
  assert.deepEqual(validate([{ ...location, ...parsed }]), [{ ...location, ...parsed }]);
  for (const key of Object.keys(drag)) {
    for (const invalid of [secret, null, 123, {}, []]) {
      assert.equal(parseHelper(line('EditorDragState', { ...drag, [key]: invalid })), null);
      assert.throws(() => validate([{ ...location, ...parsed, [key]: invalid }]), /Invalid branch diagnostics/);
    }
    const missing = { ...drag }; delete missing[key];
    assert.equal(parseHelper(line('EditorDragState', missing)), null);
  }
  for (const hit of ['target-gap', 'target-node', 'dragged-node', 'toolbar', 'outside', 'other']) {
    assert.equal(parseHelper(line('EditorDragState', { ...drag, phase: 'assertion-failed', hit })).hit, hit);
  }
  for (const extra of [{ x: 1 }, { className: secret }, { url: secret }, { text: secret }]) {
    assert.equal(parseHelper(line('EditorDragState', { ...drag, ...extra })), null);
    assert.throws(() => validate([{ ...location, ...parsed, ...extra }]), /Invalid branch diagnostics/);
  }
  assert.equal(parseHelper(line('EditorDragState', drag) + secret), null);
  assert.equal(parseHelper(line('EditorDragState', drag).repeat(2)), null);
  const reporter = new Reporter();
  reporter.onStdOut(line('EditorDragState', { ...drag, text: secret }), { location });
  reporter.onStdOut(line('EditorDragState', drag), { location });
  assert.equal(reporter.diagnostics.length, 1);
  assert.doesNotMatch(JSON.stringify(reporter.diagnostics), /SECRET/);
});
