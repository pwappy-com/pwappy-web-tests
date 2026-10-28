// Import the actual type-only module. No browser, network, auth, or application fixtures.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, readdirSync } from 'node:fs';
import { gotoInitialDashboard } from '../tests/tools/initial-dashboard-navigation.ts';

const offline = 'The Internet connection appears to be offline.';
const target = 'https://synthetic.invalid/dashboard?private=must-not-be-logged';
const nativeError = () => new Error('page.goto: ' + offline + '\nCall log:\n private-url-must-not-be-logged');
let now = 0;
const clock = mock.method(performance, 'now', () => now);
const records = [];
const logger = mock.method(console, 'log', (...args) => records.push(args));
test.after(() => { clock.mock.restore(); logger.mock.restore(); });

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function fixture(options = {}) {
    now = 0; records.length = 0;
    const calls = [], frame = {}, browser = new EventEmitter(), page = new EventEmitter();
    browser.browserType = () => ({ name: () => options.browserName ?? 'webkit' });
    browser.isConnected = () => options.connected !== false;
    page.context = () => ({ browser: () => browser });
    page.url = () => (calls.some(([name]) => name === 'first-rejected') && options.finalURL) || options.initialURL || 'about:blank';
    page.mainFrame = () => frame;
    page.isClosed = () => options.isClosed ?? false;
    const firstError = options.firstError ?? nativeError();
    const result = { status: () => options.status ?? 200 };
    const request = {
        method: () => options.method ?? 'GET',
        isNavigationRequest: () => options.navigation !== false,
        frame: () => options.otherFrame ? {} : frame,
        resourceType: () => options.resourceType ?? 'document',
        url: () => options.requestURL ?? target,
        redirectedFrom: () => options.redirected ? {} : null,
        failure: () => ({ errorText: options.failureText ?? offline })
    };
    function signals(names = []) {
        for (const name of names) {
            if (name === 'disconnected') browser.emit(name);
            else if (name === 'framenavigated') page.emit(name, frame);
            else if (name === 'non-get') page.emit('request', {
                ...request, method: () => 'POST', isNavigationRequest: () => false
            });
            else if (name === 'second-document') page.emit('request', request);
            else page.emit(name, {});
        }
    }
    page.goto = async (url, config) => {
        assert.equal(url, target);
        calls.push(['goto', config]);
        const attempt = calls.filter(([name]) => name === 'goto').length;
        if (attempt === 1) {
            assert.deepEqual(config, { waitUntil: 'domcontentloaded' });
            if (!options.noRequest) page.emit('request', request);
            signals(options.signals);
            if (options.success) {
                page.emit('response', result); page.emit('framenavigated', frame);
                return result;
            }
            if (!options.noFailure) page.emit('requestfailed', request);
            if (options.gate) await options.gate.promise;
            now = options.firstElapsed ?? 100;
            calls.push(['first-rejected']);
            throw firstError;
        }
        assert.equal(attempt, 2, 'no third attempt');
        assert.equal(calls.some(([name]) => name === 'first-rejected'), true);
        assert.deepEqual(Object.keys(config).sort(), ['timeout', 'waitUntil']);
        assert.equal(config.waitUntil, 'domcontentloaded');
        assert.ok(config.timeout > 0 && config.timeout <= 15000);
        assert.ok(config.timeout <= 15000 - now, 'no new recovery window');
        if (options.retryError) throw options.retryError;
        return result;
    };
    function clean() {
        for (const name of ['request','requestfailed','response','framenavigated','crash','close'])
            assert.equal(page.listenerCount(name), 0, name + ' observer removed');
        assert.equal(browser.listenerCount('disconnected'), 0);
    }
    return { page, calls, firstError, result, clean,
        run: () => gotoInitialDashboard(page, target, {
            expectedOnline: options.expectedOnline ?? true,
            recoveryDeadline: options.deadline ?? 15000
        }) };
}

test('one settled initial GET recovers within the existing shared deadline', async () => {
    const f = fixture({ firstElapsed: 2000 });
    assert.equal(await f.run(), f.result);
    assert.deepEqual(f.calls.map(([name]) => name), ['goto','first-rejected','goto']);
    const timeout = f.calls.at(-1)[1].timeout;
    assert.ok(timeout > 0 && timeout <= 13000, 'only the remaining original deadline');
    assert.deepEqual(records.map(([,json]) => JSON.parse(json).event), ['eligible','recovered']);
    assert.doesNotMatch(JSON.stringify(records), /synthetic\.invalid|private|Call log|Internet connection/);
    f.clean();
});

test('requestfailed alone cannot start a retry while first native goto is pending', async () => {
    const gate = deferred(), f = fixture({ gate });
    const pending = f.run();
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(f.calls.map(([name]) => name), ['goto']);
    gate.resolve();
    await pending;
    assert.equal(f.calls.filter(([name]) => name === 'goto').length, 2);
    f.clean();
});

const blocked = [
    ['caller intentionally offline', { expectedOnline: false }],
    ['non-WebKit', { browserName: 'chromium' }],
    ['already loaded page', { initialURL: 'https://synthetic.invalid/existing' }],
    ['no request observation', { noRequest: true }],
    ['no failure observation', { noFailure: true }],
    ['wrong failed request error', { failureText: 'net::ERR_FAILED' }],
    ['wrong method', { method: 'POST' }],
    ['not navigation', { navigation: false }],
    ['subframe', { otherFrame: true }],
    ['not document', { resourceType: 'script' }],
    ['different URL', { requestURL: 'https://synthetic.invalid/other' }],
    ['redirected request', { redirected: true }],
    ['multiple documents', { signals: ['second-document'] }],
    ['response received', { signals: ['response'] }],
    ['document committed', { signals: ['framenavigated'] }],
    ['non-GET observed', { signals: ['non-get'] }],
    ['page crashed', { signals: ['crash'] }],
    ['page closed event', { signals: ['close'] }],
    ['page already closed', { isClosed: true }],
    ['browser disconnected event', { signals: ['disconnected'] }],
    ['browser disconnected state', { connected: false }],
    ['zero remaining budget', { firstElapsed: 15000 }],
    ['negative remaining budget', { firstElapsed: 16000 }],
    ['zero initial budget', { deadline: 0 }],
    ['invalid budget', { deadline: Number.NaN }],
    ['infinite budget', { deadline: Number.POSITIVE_INFINITY }],
    ['page URL changed before retry', { finalURL: 'https://synthetic.invalid/changed' }],
    ['unknown native error', { firstError: new Error('page.goto: net::ERR_CONNECTION_RESET') }],
    ['offline text only in call log', { firstError: new Error('page.goto: other\n' + offline) }],
];
for (const [name, options] of blocked) test('does not replay: ' + name, async () => {
    const f = fixture(options);
    await assert.rejects(f.run(), error => error === f.firstError);
    assert.equal(f.calls.filter(([kind]) => kind === 'goto').length, 1);
    f.clean();
});

test('partially registered observers are removed if acquisition fails', async () => {
    const f = fixture(), failure = new Error('observer registration failed');
    const on = f.page.on.bind(f.page);
    f.page.on = (event, listener) => {
        if (event === 'response') throw failure;
        return on(event, listener);
    };
    await assert.rejects(f.run(), error => error === failure);
    assert.equal(f.calls.length, 0);
    f.clean();
});

test('second native failure is preserved and never retried again', async () => {
    const retryError = nativeError(), f = fixture({ retryError });
    await assert.rejects(f.run(), error => error === retryError);
    assert.equal(f.calls.filter(([name]) => name === 'goto').length, 2);
    assert.equal(JSON.parse(records.at(-1)[1]).event, 'failed');
    f.clean();
});

for (const status of [200, 401, 404, 500]) test('HTTP ' + status + ' response is returned without replay', async () => {
    const f = fixture({ success: true, status });
    assert.equal(await f.run(), f.result);
    assert.equal(f.calls.filter(([name]) => name === 'goto').length, 1);
    assert.equal(records.length, 0);
    f.clean();
});

test('integration shares the existing init budget and does not wrap auth or application setup', () => {
    const source = readFileSync(new URL('../tests/tools/dashboard-helpers.ts', import.meta.url), 'utf8');
    const body = source.slice(source.indexOf('export async function gotoDashboard'), source.indexOf('export async function reloadDashboard'));
    assert.equal((body.match(/ensureAuthenticated\(/g) || []).length, 1);
    assert.equal((body.match(/gotoInitialDashboard\(/g) || []).length, 1);
    const markers = ['ensureAuthenticated(', 'const recoveryDeadline = performance.now() + 15000;',
        'const dashboardInitPromise', 'await gotoInitialDashboard(', 'await page.evaluate('];
    const positions = markers.map(marker => {
        const index = body.indexOf(marker);
        assert.notEqual(index, -1, 'required integration marker: ' + marker);
        return index;
    });
    for (let i = 1; i < positions.length; i++) assert.ok(positions[i - 1] < positions[i]);
    assert.match(body, /expectedOnline: true, recoveryDeadline/);
    assert.match(body, /\{ timeout: 15000 \}/);
    const module = readFileSync(new URL('../tests/tools/initial-dashboard-navigation.ts', import.meta.url), 'utf8');
    assert.match(module, /^import type /);
    assert.doesNotMatch(module, /setOffline|newContext|newPage|\.reload\(|toPass|Promise\.race|setTimeout/);
    // Guard the explicit expected-online call against later intentional offline setup.
    const files = readdirSync(new URL('../tests/', import.meta.url), { recursive: true });
    for (const path of files.filter(path => /\.(ts|mjs|js)$/.test(path))) {
        const text = readFileSync(new URL('../tests/' + path, import.meta.url), 'utf8');
        assert.doesNotMatch(text, /\.setOffline\s*\(|\boffline\s*:/, path);
    }
    const config = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(config, /\.setOffline\s*\(|\boffline\s*:/);
});
