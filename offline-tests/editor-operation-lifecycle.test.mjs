// Offline regression of the actual helper with a strict, non-network Playwright double.
// Node >=24: no package installation, browser, credentials or application required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import vm from 'node:vm';

const runtime = { step: async (_name, fn) => fn() };
function expect(locator) {
    if (typeof locator === 'function') throw new Error('Mutating toPass is forbidden in these operations');
    return {
        toBeHidden: async () => { if (locator.hiddenError) throw locator.hiddenError; },
        toBeVisible: async () => { if (locator.visibleError) throw locator.visibleError; },
        toHaveAttribute: async () => {},
        not: { toHaveAttribute: async (_key, _value, options) => {
            locator.events.push(['assert', options.timeout]);
            if (locator.assertError) throw locator.assertError;
        } },
    };
}
expect.poll = (read, options) => ({ toHaveLength: async length => {
    assert.equal(options.timeout, 10000);
    assert.equal((await read()).length, length);
} });
globalThis.__offlinePlaywright = { test: runtime, expect };
registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === '@playwright/test') return { shortCircuit: true, url: 'data:text/javascript,const p=globalThis.__offlinePlaywright;export const test=p.test,expect=p.expect,FrameLocator=class{},Page=class{},BrowserContext=class{};' };
    if (specifier === './window-helpers') return nextResolve('./window-helpers.ts', context);
    return nextResolve(specifier, context);
} });
const { EditorHelper } = await import('../tests/tools/editor-helpers.ts');

function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a;reject=b; }); return { promise, resolve, reject }; }
function fixture({ clickError, assertError, cleanupError, clickGate, existing = false, initiallyClosed = false } = {}) {
    const events = [];
    let now = 0, heartbeat, disconnected = 0, cleared = 0;
    const shadowRoot = new EventTarget();
    const element = Object.assign(new EventTarget(), {
        shadowRoot, hasAttribute: () => !initiallyClosed, getAttribute: () => initiallyClosed ? null : '',
    });
    const context = { performance: { now: () => now }, document: { hidden: false },
        MutationObserver: class { observe() {} disconnect() { disconnected++; } },
        setInterval: fn => { heartbeat = fn; return 1; }, clearInterval: () => { cleared++; },
    };
    const button = { click: async options => {
        events.push(['click', options.timeout]);
        if (clickGate) await clickGate.promise;
        if (clickError) throw clickError;
        events.push(['input-settled']);
    } };
    let evaluations = 0;
    const modal = { events, assertError, locator: () => ({ first: () => button }),
        evaluate: async (callback, _arg, options) => {
            const cleanup = evaluations++ > 0;
            events.push([cleanup ? 'cleanup' : 'install', options?.timeout]);
            if (cleanup && cleanupError) throw cleanupError;
            return vm.runInNewContext(`(${callback.toString()})`, context)(element);
        },
    };
    const page = { locator: selector => selector === 'starter-template-modal' ? modal : {
        locator: () => ({ count: async () => existing ? 1 : 0 }),
    }, waitForTimeout: async () => {} };
    return { helper: new EditorHelper(page, false), events, element,
        expire: () => { now = 30001; heartbeat(); },
        cleanupCounts: () => ({ disconnected, cleared }) };
}

// Wait only for microtasks, not wall-clock deadlines.
async function reachInput(f) { for (let i=0; i<50 && !f.events.some(e=>e[0]==='click'); i++) await Promise.resolve(); }

test('one native action is fully awaited before assertion and cleanup; no outer timeout callback', async () => {
    const gate = deferred(); const f = fixture({ clickGate: gate });
    let settled = false;
    const operation = f.helper.handleStarterTemplateModal().finally(() => { settled = true; });
    await reachInput(f);
    assert.equal(settled, false);
    assert.deepEqual(f.events.map(e=>e[0]), ['install', 'click']);
    gate.resolve(); await operation;
    assert.deepEqual(f.events.map(e=>e[0]), ['install', 'click', 'input-settled', 'assert', 'cleanup']);
    assert.equal(f.events[1][1], 15000);
    assert.equal(f.events[3][1], 10000);
    assert.equal(f.events[4][1], 5000);
    assert.deepEqual(f.cleanupCounts(), { disconnected: 1, cleared: 1 });
    assert.equal(f.element.__e2eStarterProbe, undefined);
});

test('native input failure is not reclassified as success or replayed; no late assertion', async () => {
    const error = new Error('native input failed'); const gate = deferred();
    const f = fixture({ clickGate: gate, clickError: error });
    const operation = f.helper.handleStarterTemplateModal();
    await reachInput(f); gate.resolve();
    await assert.rejects(operation, e => e === error);
    const before = [...f.events]; await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.events, before);
    assert.deepEqual(f.events.map(e=>e[0]), ['install', 'click', 'cleanup']);
    assert.equal(f.element.__e2eStarterProbe, undefined);
});

test('assertion negative control remains a failure with cleanup', async () => {
    const error = new Error('modal remained visible'); const f = fixture({ assertError: error });
    await assert.rejects(f.helper.handleStarterTemplateModal(), e => e === error);
    assert.equal(f.element.__e2eStarterProbe, undefined);
});

test('page closure during cleanup preserves input failure and probe self-cleans', async () => {
    const error = new Error('click interrupted');
    const f = fixture({ clickError: error, cleanupError: new Error('page closed') });
    await assert.rejects(f.helper.handleStarterTemplateModal(), e => e === error);
    f.expire(); assert.equal(f.element.__e2eStarterProbe, undefined);
    assert.deepEqual(f.cleanupCounts(), { disconnected: 1, cleared: 1 });
});

test('cleanup failure after successful action is not hidden', async () => {
    const error = new Error('cleanup failed'); const f = fixture({ cleanupError: error });
    await assert.rejects(f.helper.handleStarterTemplateModal(), e => e === error);
    f.expire();
});

test('existing app does not install probe or click', async () => {
    const f = fixture({ existing: true }); await f.helper.handleStarterTemplateModal(); assert.deepEqual(f.events, []);
});

test('already-closed modal skips input but still verifies state and cleans up', async () => {
    const f = fixture({ initiallyClosed: true }); await f.helper.handleStarterTemplateModal();
    assert.deepEqual(f.events.map(e=>e[0]), ['install', 'assert', 'cleanup']);
});

function dragFixture({ dragError, releaseError, added = ['new'], gate } = {}) {
    const events = []; let reads = 0, releases = 0;
    const nodes = { evaluateAll: async () => ++reads === 1 ? [] : added,
        and: () => ({}) };
    const page = { locator: () => ({ dragTo: async (_target, options) => {
        events.push(['drag', options.timeout]); if (gate) await gate.promise;
        if (dragError) throw dragError;
    } }), mouse: { up: async () => {
        events.push(['release']); if (++releases === 2 && releaseError) throw releaseError;
    } } };
    const helper = new EditorHelper(page, false); helper.openMoveingHandle = async () => {};
    return { helper, events, target: { locator: () => nodes } };
}

test('drag settles before release and rejection; no late duplicate mutation', async () => {
    const gate = deferred(), error = new Error('drag failed');
    const f = dragFixture({ gate, dragError: error });
    let settled = false;
    const operation = f.helper.addComponent('button', f.target).finally(() => { settled = true; });
    for (let i=0; i<50 && f.events.length<2; i++) await Promise.resolve();
    assert.equal(settled, false); assert.deepEqual(f.events, [['release'], ['drag', 15000]]);
    gate.resolve(); await assert.rejects(operation, e => e === error);
    const before = [...f.events]; await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.events, before); assert.deepEqual(before, [['release'], ['drag',15000], ['release']]);
});

test('drag cleanup cannot mask native failure', async () => {
    const error = new Error('original drag error');
    const f = dragFixture({ dragError: error, releaseError: new Error('closed page') });
    await assert.rejects(f.helper.addComponent('button', f.target), e => e === error);
});

test('drag postcondition rejects missing or duplicate node without replay', async () => {
    for (const added of [[], ['new', 'duplicate']]) {
        const f = dragFixture({ added });
        await assert.rejects(f.helper.addComponent('button', f.target), { name: 'AssertionError' });
        assert.equal(f.events.filter(e=>e[0]==='drag').length, 1);
    }
});

test('drag succeeds only for exactly one new node', async () => {
    const f = dragFixture(); await f.helper.addComponent('button', f.target);
    assert.equal(f.events.filter(e=>e[0]==='drag').length, 1);
});

function snapshotFixture({ inputError, visibleError, initialHiddenError, confirmHiddenError } = {}) {
    const events = [];
    const confirm = { isVisible: async () => false, visibleError, hiddenError: confirmHiddenError,
        getByRole: () => ({ click: async () => { events.push('confirm'); } }) };
    const initial = { isVisible: async () => true, hiddenError: initialHiddenError, getByRole: () => ({ click: async () => {
        events.push('discard'); if (inputError) throw inputError;
    } }) };
    const page = { on: () => events.push('listen'), off: () => events.push('unlisten'),
        locator: (_selector, options) => options?.hasText?.startsWith('前回') ? initial : options ? confirm : {} };
    return { helper: new EditorHelper(page, false), events };
}

test('snapshot native failure remains failure and unregisters dialog listener', async () => {
    const error = new Error('discard failed'); const f = snapshotFixture({ inputError: error });
    await assert.rejects(f.helper.handleSnapshotRestoreDialog(), e => e === error);
    assert.deepEqual(f.events, ['listen','discard','unlisten']);
});

test('snapshot confirmation assertion failure never replays discard or clicks confirmation', async () => {
    const error = new Error('confirmation absent'); const f = snapshotFixture({ visibleError: error });
    await assert.rejects(f.helper.handleSnapshotRestoreDialog(), e => e === error);
    assert.deepEqual(f.events, ['listen','discard','unlisten']);
});


test('expired probe cleanup is idempotent after native action completes', async () => {
    const gate = deferred(); const f = fixture({ clickGate: gate });
    const operation = f.helper.handleStarterTemplateModal(); await reachInput(f);
    f.expire(); gate.resolve(); await operation;
    assert.deepEqual(f.cleanupCounts(), { disconnected: 1, cleared: 1 });
});


test('successful drag with failed cleanup remains a failure', async () => {
    const error = new Error('release failed'); const f = dragFixture({ releaseError: error });
    await assert.rejects(f.helper.addComponent('button', f.target), e => e === error);
});

test('snapshot happy path confirms once and unregisters listener', async () => {
    const f = snapshotFixture(); await f.helper.handleSnapshotRestoreDialog();
    assert.deepEqual(f.events, ['listen', 'discard', 'confirm', 'unlisten']);
});

test('snapshot requires both dialogs hidden after confirmation', async () => {
    for (const key of ['initialHiddenError', 'confirmHiddenError']) {
        const error = new Error(`${key}: dialog remained visible`);
        const f = snapshotFixture({ [key]: error });
        await assert.rejects(f.helper.handleSnapshotRestoreDialog(), e => e === error);
        assert.deepEqual(f.events, ['listen', 'discard', 'confirm', 'unlisten']);
    }
});
