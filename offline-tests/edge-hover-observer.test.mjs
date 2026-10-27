// Offline only: executes the actual spec helper in an isolated DOM/protocol double.
// No Playwright discovery, dependencies, browser, network, or application requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
const source = readFileSync(new URL('../tests/specs/normal/editor-ui-basic.spec.ts', import.meta.url), 'utf8');
const start = source.indexOf('async function moveAndObserveEdgeHover(');
const end = source.indexOf("test.describe('画面エッジホバー", start);
const helperJS = stripTypeScriptTypes(source.slice(start, end));
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
function expect(actual) { return {
    toBe: expected => assert.equal(actual, expected),
    not: { toBeNull: () => assert.notEqual(actual, null) },
}; }
const helper = vm.runInNewContext(`(${helperJS.trim()})`, { expect, process: { env: {} }, console: { log() {}, error() {} } });
function fixture({ initialHover = false, mouseGate, mouseError, cleanupError, installGate } = {}) {
    const events = [], timers = new Map(), listeners = new Map();
    let now = 0, observer, classes = initialHover ? 'active hover' : 'active', state;
    let disconnected = 0, disposed = 0;
    const element = { isConnected: true, classList: { contains: name => classes.split(/\s+/).includes(name) }, getAttribute: () => classes };
    const browserContext = vm.createContext({ performance: { now: () => now },
        MutationObserver: class {
            constructor(callback) { this.callback = callback; observer = this; }
            observe(target, options) { assert.equal(target, element); assert.equal(options.attributeOldValue, true); this.active = true; events.push('armed'); }
            disconnect() { this.active = false; disconnected++; }
        },
        window: { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) },
        setTimeout: (callback, delay) => { assert.equal(delay, 10000); timers.set(1, callback); return 1; },
        clearTimeout: id => timers.delete(id),
    });
    const run = (callback, ...args) => vm.runInContext(`(${callback.toString()})`, browserContext)(...args);
    const probe = { evaluate: async callback => {
        events.push(callback.toString().includes('state.cleanup') ? 'cleanup' : 'read');
        if (callback.toString().includes('state.cleanup') && cleanupError) throw cleanupError;
        return run(callback, state);
    }, dispose: async () => { disposed++; events.push('dispose'); } };
    const trigger = { evaluateHandle: async (callback, timeout) => {
        if (installGate) await installGate.promise;
        state = run(callback, element, timeout); return probe;
    } };
    const page = { mouse: { move: async () => {
        assert.equal(observer.active, true, 'observer must be armed before input');
        events.push('mouse');
        if (mouseGate) await mouseGate.promise;
        if (mouseError) throw mouseError;
        events.push('mouse-settled');
    } } };
    return { events, element, run: () => helper(page, trigger, 10, 100),
        mutate(values) { const records = []; for (const value of values) { records.push({ oldValue: classes }); classes = value; }
            if (observer?.active) observer.callback(records); },
        expire() { now = 10000; for (const callback of [...timers.values()]) callback(); },
        setTime(value) { now = value; },
        navigate() { listeners.get('pagehide')?.(); },
        resources() { return { timers: timers.size, listeners: listeners.size, disconnected, disposed }; },
    };
}
async function reach(f, name = 'mouse') { for (let i=0; i<50 && !f.events.includes(name); i++) await Promise.resolve(); assert.ok(f.events.includes(name)); }
function clean(f) { assert.deepEqual(f.resources(), { timers: 0, listeners: 0, disconnected: 1, disposed: 1 }); }

test('awaited browser-ready barrier precedes input; fleeting hover survives delayed native response', async () => {
    const installGate = deferred(), mouseGate = deferred(); const f = fixture({ installGate, mouseGate });
    let settled = false; const operation = f.run().finally(() => settled = true);
    await Promise.resolve(); assert.deepEqual(f.events, []);
    installGate.resolve(); await reach(f);
    f.setTime(100); f.mutate(['active hover']); f.setTime(900); f.mutate(['active']);
    await Promise.resolve(); assert.equal(settled, false); assert.equal(f.events.includes('read'), false);
    mouseGate.resolve(); await operation; clean(f);
    assert.deepEqual(f.events, ['armed','mouse','mouse-settled','read','cleanup','dispose']);
});

test('same-batch hover add/remove is recorded using mutation oldValue', async () => {
    const mouseGate = deferred(), f = fixture({ mouseGate }); const operation = f.run(); await reach(f);
    f.mutate(['active hover', 'active']); mouseGate.resolve(); await operation; clean(f);
});

test('no hover negative control fails and cleans resources', async () => {
    const f = fixture(); const operation = f.run(); await reach(f); f.expire();
    await assert.rejects(operation, { name: 'AssertionError' }); clean(f);
});

test('native move rejection after observed hover remains the original failure; no late input', async () => {
    const mouseGate = deferred(), mouseError = new Error('native mouse failed'); const f = fixture({ mouseGate, mouseError });
    const operation = f.run(); await reach(f); f.mutate(['active hover']); mouseGate.resolve();
    await assert.rejects(operation, error => error === mouseError); clean(f);
    assert.equal(f.events.includes('read'), false);
    const before = [...f.events]; await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(f.events, before);
});

test('preexisting hover is not accepted as a new transition', async () => {
    const f = fixture({ initialHover: true }); await assert.rejects(f.run(), /already hovered/); assert.deepEqual(f.events, []);
});

test('replacement node cannot supply a missing transition on the original node', async () => {
    const f = fixture(); const operation = f.run(); await reach(f); f.element.isConnected = false;
    // A replacement's class is deliberately not delivered to the original node's observer.
    f.expire(); await assert.rejects(operation, { name: 'AssertionError' }); clean(f);
});

test('original node detachment after a valid transition still fails', async () => {
    const mouseGate = deferred(), f = fixture({ mouseGate }); const operation = f.run(); await reach(f);
    f.mutate(['active hover']); f.element.isConnected = false; mouseGate.resolve();
    await assert.rejects(operation, { name: 'AssertionError' }); clean(f);
});

test('navigation releases observer/timer/listener and does not accept later hover', async () => {
    const mouseGate = deferred(), f = fixture({ mouseGate }); const operation = f.run(); await reach(f);
    f.navigate(); f.mutate(['active hover']); mouseGate.resolve();
    await assert.rejects(operation, { name: 'AssertionError' }); clean(f);
});

test('event-loop delayed callback after existing observation deadline fails', async () => {
    const mouseGate = deferred(), f = fixture({ mouseGate }); const operation = f.run(); await reach(f);
    f.setTime(10001); f.mutate(['active hover']); mouseGate.resolve();
    await assert.rejects(operation, { name: 'AssertionError' }); clean(f);
});

test('cleanup failure cannot replace native mouse failure; handle still disposed', async () => {
    const mouseGate = deferred(), mouseError = new Error('native mouse failed'); const f = fixture({ mouseGate, mouseError, cleanupError: new Error('context destroyed') });
    const operation = f.run(); await reach(f); f.navigate(); mouseGate.resolve();
    await assert.rejects(operation, error => error === mouseError); clean(f);
});

test('cleanup error on success is visible and handle still disposed', async () => {
    const mouseGate = deferred(), cleanupError = new Error('cleanup protocol failed'); const f = fixture({ mouseGate, cleanupError });
    const operation = f.run(); await reach(f); f.mutate(['active hover']); mouseGate.resolve();
    await assert.rejects(operation, error => error === cleanupError); clean(f);
});

test('both edges use observer; panel 1500ms waits, visibility and drag-end checks unchanged', () => {
    for (const edge of ['right', 'left']) assert.ok(source.includes(`await moveAndObserveEdgeHover(editorPage, ${edge}EdgeTrigger, targetX, targetY);`));
    const sections = text => text.slice(text.indexOf("test.describe('画面エッジホバー"), text.indexOf('// tests/specs/normal/backup-io.spec.ts'));
    const unchanged = text => sections(text).split('\n').filter(line => /1500|toBeVisible|app-drag-|dragItemType|not.toHaveClass/.test(line));
    // Frozen from verified 8a13cddf baseline; no dependency on a local backup.
    assert.equal(createHash('sha256').update(JSON.stringify(unchanged(source))).digest('hex'), '41b81ea59459779b61d52ffde037c1728373744cf59dba582c480cbe60f09ed1');
});

test('observation deadline does not abandon pending native mouse input', async () => {
    const mouseGate = deferred(), f = fixture({ mouseGate }); let settled = false;
    const operation = f.run().finally(() => settled = true); await reach(f); f.expire();
    await Promise.resolve(); assert.equal(settled, false); assert.equal(f.events.includes('read'), false);
    mouseGate.resolve(); await assert.rejects(operation, { name: 'AssertionError' }); clean(f);
});

test('failed cleanup after input failure has bounded browser fallback', async () => {
    const mouseError = new Error('native mouse failed'); const f = fixture({ mouseError, cleanupError: new Error('protocol failed') });
    await assert.rejects(f.run(), error => error === mouseError);
    assert.equal(f.resources().disposed, 1); f.expire(); clean(f);
});

test('observation budget remains the configured default expect timeout, not the 800ms product timer', () => {
    const config = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');
    assert.match(config, /expect:\s*\{[\s\S]*?timeout:\s*process\.env\.CI \? 20 \* 1000 : 10 \* 1000/);
    assert.match(helperJS, /observationTimeout = process\.env\.CI \? 20000 : 10000/);
});
