// Actual createApp lifecycle with strict synthetic locators; no browser, network or credentials.
// Run by the existing Node 24 offline-contract workflow.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

function expect(value) {
    if (typeof value === 'function') return {
        toPass: async options => {
            // Only the unchanged, pre-submit modal-opening helper may use toPass.
            assert.deepEqual(options, { timeout: 20000, intervals: [1000] });
            await value();
        }
    };
    const check = async (method, expected, options) => value.check(method, expected, options);
    return {
        toBeEditable: options => check('editable', undefined, options),
        toBeHidden: options => check('hidden', undefined, options),
        toBeVisible: options => check('visible', undefined, options),
        toHaveCount: (expected, options) => check('count', expected, options),
        toHaveText: (expected, options) => check('text', expected, options)
    };
}
globalThis.__createAppPlaywright = { expect };
const blocked = 'export function ensureAuthenticated(){throw Error("Authentication is forbidden in offline tests");}';
registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === './initial-dashboard-navigation') return nextResolve(new URL('../tests/tools/initial-dashboard-navigation.ts', import.meta.url).href, context);
    const source = specifier === '@playwright/test'
        ? 'export const expect=globalThis.__createAppPlaywright.expect;'
        : specifier === './editor-helpers' ? 'export class EditorHelper {}'
        : specifier === './window-helpers'
            ? 'export function clickAndOpenNewTabSafely(){throw Error("Opening a browser is forbidden");}'
        : specifier === '../constants' ? blocked
        : specifier === './http-failure-diagnostics'
            ? 'export function observeHttpFailures(){};export function observePageHttpFailures(){};'
        : null;
    return source === null ? nextResolve(specifier, context)
        : { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(source) };
} });
const { createApp } = await import('../tests/tools/dashboard-helpers.ts');
const appName = 'synthetic-app', appKey = 'synthetic-key';
let readClock = () => 0;
const clockMock = mock.method(performance, 'now', () => readClock());
test.after(() => clockMock.mock.restore());
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
function fixture({ gate, clickError, postGate, modalVisible = false, loading = false,
    overlayLoading = loading, detailVisible = true, returnedKey = appKey, returnedName = appName,
    alertVisible = false, alertReadError, alertCloseError,
    alertReadTime = 0, alertCloseTime = 0, alertHiddenTime = 0 } = {}) {
    const events = [];
    let submitted = false, alertOpen = alertVisible, now = 0;
    readClock = () => now;
    const locator = name => ({
        locator: child => locator(name + ' ' + child),
        getByRole: (_role, options) => {
            assert.equal(name, 'alert-component'); assert.equal(options.name, '閉じる');
            return locator('alert-close');
        },
        isVisible: async () => {
            if (name.endsWith('span[slot="header-title"]')) return true;
            assert.equal(name, 'alert-component');
            if (alertReadError) throw alertReadError;
            now += alertReadTime;
            return alertOpen;
        },
        fill: async value => { events.push(['fill', name, value]); },
        click: async options => {
            assert.deepEqual(Object.keys(options), ['timeout'], 'native action is never forced');
            assert.ok(options.timeout > 0 && options.timeout <= 15000, 'finite shared input budget');
            assert.equal(options.timeout, 15000 - now, 'only the monotonic remainder is available');
            if (name === 'alert-close') {
                events.push(['alert-close', options.timeout]);
                if (alertCloseError) throw alertCloseError;
                now += alertCloseTime;
                alertOpen = false; return;
            }
            assert.equal(name, 'dashboard-modal-window#appModal .submit-button');
            events.push(['submit', options.timeout]);
            if (gate) await gate.promise;
            if (clickError) throw clickError;
            submitted = true;
            events.push(['input-settled']);
        },
        check: async (method, expected, options) => {
            events.push(['assert', name, method, expected, options]);
            if (method === 'editable') return;
            if (name === 'alert-component') {
                assert.equal(method, 'hidden'); assert.equal(alertOpen, false);
                assert.equal(options.timeout, 15000 - now);
                now += alertHiddenTime; return;
            }
            assert.equal(submitted, true, 'completion cannot be checked before native input settles');
            if (name === 'dashboard-modal-window#appModal') {
                assert.equal(method, 'hidden'); assert.deepEqual(options, { timeout: 30000 });
                if (postGate) await postGate.promise;
                assert.equal(modalVisible, false, 'modal remains visible');
            } else if (name === 'processing') {
                assert.equal(method, 'count'); assert.equal(expected, 0);
                assert.deepEqual(options, { timeout: 30000 });
                assert.equal(loading, false, 'processing remains active');
            } else if (name === 'dashboard-loading-overlay') {
                assert.equal(method, 'hidden'); assert.deepEqual(options, { timeout: 30000 });
                assert.equal(overlayLoading, false, 'loading remains active');
            } else if (name === 'dashboard-app-detail') {
                assert.equal(method, 'visible'); assert.deepEqual(options, { timeout: 15000 });
                assert.equal(detailVisible, true, 'detail did not appear');
            } else if (name === 'dashboard-app-detail .app-key') {
                assert.equal(method, 'text'); assert.equal(expected, appKey);
                assert.equal(returnedKey, expected, 'wrong app key');
            } else if (name === 'dashboard-app-detail .app-name') {
                assert.equal(method, 'text'); assert.equal(expected, appName);
                assert.equal(returnedName, expected, 'wrong app name');
            } else assert.fail('Unexpected completion locator: ' + name);
        }
    });
    const page = {
        url: () => 'https://synthetic.invalid/',
        locator,
        getByText: text => { assert.equal(text, '処理中...'); return locator('processing'); },
        waitForTimeout: async duration => { assert.equal(duration, 500); events.push(['initial-render-wait']); }
    };
    return { page, events };
}
const submissions = f => f.events.filter(event => event[0] === 'submit');
const completion = f => f.events.filter(event => event[0] === 'assert' && event[2] !== 'editable');
async function reachSubmit(f) {
    for (let round = 0; round < 40 && submissions(f).length === 0; round++) await Promise.resolve();
    assert.equal(submissions(f).length, 1);
}
test('one native submit fully settles before all completion and identity assertions', async () => {
    const gate = deferred(), f = fixture({ gate });
    let finished = false;
    const operation = createApp(f.page, appName, appKey).finally(() => { finished = true; });
    await reachSubmit(f);
    assert.equal(finished, false); assert.deepEqual(completion(f), []);
    gate.resolve(); await operation;
    assert.equal(submissions(f).length, 1);
    assert.deepEqual(completion(f).map(event => event.slice(1, 3)), [
        ['dashboard-modal-window#appModal', 'hidden'], ['processing', 'count'],
        ['dashboard-loading-overlay', 'hidden'], ['dashboard-app-detail', 'visible'],
        ['dashboard-app-detail .app-key', 'text'], ['dashboard-app-detail .app-name', 'text']
    ]);
    assert.ok(f.events.findIndex(event => event[0] === 'input-settled') <
        f.events.findIndex(event => event[0] === 'assert' && event[2] === 'hidden'));
});
test('ambiguous native input failure propagates unchanged, without readback or replay', async () => {
    const error = new Error('synthetic action timeout'), gate = deferred();
    const f = fixture({ gate, clickError: error });
    const operation = createApp(f.page, appName, appKey);
    await reachSubmit(f); gate.resolve();
    await assert.rejects(operation, candidate => candidate === error);
    assert.equal(submissions(f).length, 1); assert.deepEqual(completion(f), []);
    const settledEvents = [...f.events];
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.events, settledEvents);
});
test('delayed completion only waits for postconditions and never resubmits', async () => {
    const postGate = deferred(), f = fixture({ postGate });
    let finished = false;
    const operation = createApp(f.page, appName, appKey).finally(() => { finished = true; });
    await reachSubmit(f);
    for (let round = 0; round < 10; round++) await Promise.resolve();
    assert.equal(finished, false); assert.equal(submissions(f).length, 1);
    postGate.resolve(); await operation;
    assert.equal(submissions(f).length, 1);
});
for (const [label, options, error] of [
    ['visible modal', { modalVisible: true }, /modal remains visible/],
    ['active processing', { loading: true }, /processing remains active/],
    ['active overlay only', { overlayLoading: true }, /loading remains active/],
    ['missing detail', { detailVisible: false }, /detail did not appear/],
    ['wrong key', { returnedKey: 'another-key' }, /wrong app key/],
    ['wrong name', { returnedName: 'another-name' }, /wrong app name/]
]) test(label + ' fails without another submit', async () => {
    const f = fixture(options);
    await assert.rejects(createApp(f.page, appName, appKey), error);
    assert.equal(submissions(f).length, 1);
});
test('a preexisting alert is dismissed once, before submitting', async () => {
    const f = fixture({ alertVisible: true });
    await createApp(f.page, appName, appKey);
    assert.equal(f.events.filter(event => event[0] === 'alert-close').length, 1);
    assert.equal(submissions(f).length, 1);
    assert.ok(f.events.findIndex(event => event[0] === 'alert-close') <
        f.events.findIndex(event => event[0] === 'submit'));
});
for (const option of ['alertReadError', 'alertCloseError']) test(option + ' propagates before submission', async () => {
    const error = new Error('synthetic alert failure');
    const f = fixture({ alertVisible: true, [option]: error });
    await assert.rejects(createApp(f.page, appName, appKey), candidate => candidate === error);
    assert.equal(submissions(f).length, 0);
});
test('alert input and readiness consume the same 15s monotonic input budget', async () => {
    const f = fixture({ alertVisible: true, alertReadTime: 1000, alertCloseTime: 4000, alertHiddenTime: 2000 });
    await createApp(f.page, appName, appKey);
    assert.equal(f.events.find(event => event[0] === 'alert-close')[1], 14000);
    assert.equal(submissions(f)[0][1], 8000);
});
for (const options of [
    { alertReadTime: 15000 },
    { alertVisible: true, alertCloseTime: 15000 },
    { alertVisible: true, alertCloseTime: 9000, alertHiddenTime: 6000 }
]) test('exhausted shared input budget prevents any late submit: ' + JSON.stringify(options), async () => {
    const f = fixture(options);
    await assert.rejects(createApp(f.page, appName, appKey), /input budget exhausted before submission/);
    assert.equal(submissions(f).length, 0);
});
test('submit tail contains one native action and no retries, forced input or API creation', () => {
    const source = readFileSync(new URL('../tests/tools/dashboard-helpers.ts', import.meta.url), 'utf8');
    const create = source.split('export async function createApp(')[1].split('export async function deleteApp(')[0];
    const tail = create.slice(create.indexOf('    const alert ='));
    assert.equal((tail.match(/\.submit-button/g) || []).length, 1);
    assert.doesNotMatch(tail, /\.toPass\(|force:\s*true|\.catch\(|Promise\.race|\.evaluate\(|\.request\b|\.post\(/);
});
