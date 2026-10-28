// Actual helper lifecycle regression. Synthetic DOM/input doubles only; no network.
// Run on Node 24 in GitHub Actions, without dependencies or browser credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function expect(value, message) {
    if (typeof value === 'function') throw new Error('Mutating toPass is forbidden');
    return { toBe: expected => assert.equal(value, expected, message) };
}
expect.poll = (read, options) => ({
    toBe: async expected => {
        assert.ok(options.timeout === undefined || options.timeout === 5000, 'only readiness has the existing 5s budget');
        for (let round = 0; round < 12; round++) {
            if (await read() === expected) return;
        }
        assert.fail(options.timeout === 5000 ? 'read-only readiness did not settle' : 'paired panel state did not settle');
    }
});
globalThis.__movingHandlePlaywright = { expect };
registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === '@playwright/test') return { shortCircuit: true,
        url: 'data:text/javascript,const p=globalThis.__movingHandlePlaywright;export const expect=p.expect,test={},FrameLocator=class{},Page=class{},BrowserContext=class{};' };
    if (specifier === './http-failure-diagnostics') return nextResolve('./http-failure-diagnostics.ts', context);
    if (specifier === './window-helpers') return nextResolve('./window-helpers.ts', context);
    return nextResolve(specifier, context);
} });
const { EditorHelper } = await import('../tests/tools/editor-helpers.ts');
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
const closed = () => ({ left: false, right: false, template: false, toolbox: false, property: false, script: false });
function opened(side) {
    return { ...closed(), [side]: true,
        ...(side === 'left' ? { template: true, toolbox: true } : { property: true, script: true }) };
}
function fixture({ initial = closed(), frames, gate, inputError, readyError, readinessGate,
    afterReady, partial = false, viewportWidth = 390, hiddenHandle = false, covered = false,
    top = 380, mobile = true, readyFrames = [], visibility = 'visible', disabled = false,
    ariaDisabled = false, inert = false, inertParent = false, connected = true } = {}) {
    const events = [];
    let state = { ...initial }, phase = 'before', frame = 0, activeSide, rafCount = 0;
    const view = { top, covered, visibility, disabled, ariaDisabled, inert, inertParent, connected,
        width: hiddenHandle ? 0 : 27, height: 27, viewportWidth, viewportHeight: 844, generation: 0 };
    const read = async (callback, args) => {
        const { side, requireStable } = args;
        events.push(['read', phase, side, requireStable]);
        activeSide = side;
        if (requireStable && readyError) throw readyError;
        if (phase === 'after' && frames) state = { ...frames[Math.min(frame++, frames.length - 1)] };
        const generation = view.generation;
        const rect = () => {
            const x = partial ? 80 : (side === 'left' ? state.left : !state.right) ? view.viewportWidth - view.width : 0;
            return { left: x, right: x + view.width, top: view.top, bottom: view.top + view.height,
                width: view.width, height: view.height };
        };
        const panelKeys = { 'template-container': 'template', 'tool-box': 'toolbox', 'property-container': 'property', 'script-container': 'script' };
        class ShadowRoot {}
        const root = Object.assign(new ShadowRoot(), { querySelector: selector => ({
            visible: state[panelKeys[selector]],
            getBoundingClientRect: () => ({ width: state[panelKeys[selector]] ? 300 : 0, height: 250 })
        }) });
        const document = { elementFromPoint: () => view.covered ? blocker : appHost };
        const appHost = {
            shadowRoot: root, parentElement: null, getRootNode: () => document,
            matches: () => false, hasAttribute: name => name === 'inert' && view.inertParent,
            getAttribute: () => null
        };
        root.host = appHost;
        const element = {
            get isConnected() { return view.connected && generation === view.generation; },
            getRootNode: () => root, getBoundingClientRect: rect, contains: () => false, parentElement: null,
            matches: selector => selector === ':disabled' && view.disabled,
            hasAttribute: name => name === 'inert' && view.inert,
            getAttribute: name => name === 'aria-disabled'
                ? (typeof view.ariaDisabled === 'string' ? view.ariaDisabled : view.ariaDisabled ? 'true' : null) : null
        };
        const innerRoot = Object.assign(new ShadowRoot(), { host: element, elementFromPoint: () => inner });
        const inner = { getRootNode: () => innerRoot };
        element.shadowRoot = innerRoot;
        root.elementFromPoint = () => generation === view.generation ? element : blocker;
        const blocker = { getRootNode: () => document };
        return vm.runInNewContext('(' + callback.toString() + ')', {
            window: { get innerWidth() { return view.viewportWidth; }, get innerHeight() { return view.viewportHeight; } },
            document, ShadowRoot,
            getComputedStyle: node => ({ visibility: node === element ? view.visibility : node.visible ? 'visible' : 'hidden' }),
            requestAnimationFrame: done => {
                events.push(['frame', ++rafCount]);
                Promise.resolve(readinessGate?.promise).then(() => {
                    const next = readyFrames[rafCount - 1] || {};
                    if (next.replace) view.generation++;
                    Object.assign(view, next);
                    if (afterReady) state = { ...afterReady };
                    done(rafCount * 16);
                });
            }
        })(element, args);
    };
    const page = {
        locator: selector => {
            const side = selector === '#leftMovingHandle' ? 'left' : selector === '#rightMovingHandle' ? 'right' : assert.fail('unexpected selector');
            return {
                evaluate: async (callback, args) => { assert.equal(args.side, side); return read(callback, args); },
                dblclick: async () => { assert.fail('locator trial must never dispatch readiness input'); }
            };
        },
        mouse: {
            up: async () => { events.push(['release']); },
            dblclick: async (x, y) => {
                events.push(['input', activeSide, x, y]);
                if (gate) await gate.promise;
                phase = 'after';
                if (inputError) { state = opened(activeSide); throw inputError; }
                if (!frames) state = state[activeSide] ? closed() : opened(activeSide);
                events.push(['input-settled']);
            }
        }
    };
    return { helper: new EditorHelper(page, mobile), events };
}
const inputs = f => f.events.filter(event => event[0] === 'input');
async function reachInput(f) {
    for (let i = 0; i < 100 && inputs(f).length === 0; i++) await Promise.resolve();
    assert.equal(inputs(f).length, 1);
}
for (const side of ['left', 'right']) {
    test(side + ': already requested open state performs no input or readiness input', async () => {
        const f = fixture({ initial: opened(side) });
        await f.helper.openMoveingHandle(side);
        assert.deepEqual(f.events.map(event => event[0]), ['read', 'read']);
    });
    test(side + ': one actionable native input is awaited before any postcondition', async () => {
        const gate = deferred(), f = fixture({ gate });
        let settled = false;
        const operation = f.helper.openMoveingHandle(side).finally(() => { settled = true; });
        await reachInput(f);
        assert.equal(settled, false);
        assert.deepEqual(f.events.map(event => event[0]), ['read', 'release', 'read', 'frame', 'frame', 'input']);
        gate.resolve(); await operation;
        assert.equal(inputs(f).length, 1);
        assert.deepEqual(f.events.slice(-2).map(event => event[0]), ['input-settled', 'read']);
        assert.equal(inputs(f)[0][2], side === 'left' ? 13.5 : 376.5);
        assert.equal(inputs(f)[0][3], 393.5);
    });
    test(side + ': delayed own panel and opposite closure only retry observations', async () => {
        const full = opened(side), partialOwn = { ...full, [side === 'left' ? 'toolbox' : 'script']: false };
        const oppositeStillVisible = { ...full, [side === 'left' ? 'property' : 'template']: true };
        const f = fixture({ initial: opened(side === 'left' ? 'right' : 'left'),
            frames: [partialOwn, partialOwn, oppositeStillVisible, full] });
        await f.helper.openMoveingHandle(side);
        assert.equal(inputs(f).length, 1);
        assert.equal(f.events.filter(event => event[0] === 'read' && event[1] === 'after').length, 4);
    });
    test(side + ': native failure is preserved without readback or a second toggle', async () => {
        const error = new Error('synthetic input rejection'), gate = deferred();
        const f = fixture({ gate, inputError: error, frames: [opened(side)] });
        const operation = f.helper.openMoveingHandle(side);
        await reachInput(f); gate.resolve();
        await assert.rejects(operation, candidate => candidate === error);
        const recorded = [...f.events]; await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(f.events, recorded);
        assert.equal(inputs(f).length, 1);
        assert.equal(f.events.filter(event => event[0] === 'read' && event[1] === 'after').length, 0);
    });
    test(side + ': state reached during readiness skips stale toggle intent', async () => {
        const f = fixture({ afterReady: opened(side) });
        await f.helper.openMoveingHandle(side);
        assert.equal(inputs(f).length, 0);
    });
    test(side + ': permanently incomplete postcondition fails without replay', async () => {
        const f = fixture({ frames: [{ ...opened(side), [side === 'left' ? 'toolbox' : 'script']: false }] });
        await assert.rejects(f.helper.openMoveingHandle(side), /did not settle/);
        assert.equal(inputs(f).length, 1);
    });
}
test('closing each side awaits both panels hidden and never opens the opposite side', async () => {
    for (const side of ['left', 'right']) {
        const f = fixture({ initial: opened(side) });
        await f.helper.closeMoveingHandle();
        assert.equal(inputs(f).length, 1);
        assert.equal(inputs(f)[0][1], side);
    }
});
test('desktop public open and close APIs remain complete no-ops', async () => {
    const f = fixture({ mobile: false });
    await f.helper.openMoveingHandle('left'); await f.helper.openMoveingHandle('right');
    await f.helper.closeMoveingHandle(); assert.deepEqual(f.events, []);
});
test('partial, desktop-width and invisible handle layouts fail before input', async () => {
    for (const options of [{ partial: true }, { viewportWidth: 1200 }, { hiddenHandle: true }]) {
        const f = fixture(options);
        await assert.rejects(f.helper.openMoveingHandle('left'), /complete mobile edge layout/);
        assert.equal(inputs(f).length, 0);
    }
});
test('readiness failure cannot fall back to forced or coordinate input', async () => {
    const error = new Error('synthetic obscured target'), f = fixture({ readyError: error });
    await assert.rejects(f.helper.openMoveingHandle('left'), candidate => candidate === error);
    assert.equal(inputs(f).length, 0);
});
test('already-open geometry with hidden child is not misclassified as closed', async () => {
    const f = fixture({ initial: { ...opened('left'), template: false } });
    await assert.rejects(f.helper.openMoveingHandle('left'), /did not settle/);
    assert.equal(inputs(f).length, 0);
});
test('the actual method contains no trial or forced input, mutating retry or fabricated UI state', () => {
    const source = readFileSync(new URL('../tests/tools/editor-helpers.ts', import.meta.url), 'utf8')
        .split('    private async setMovingHandleState(')[1].split('\n    /**')[0];
    assert.doesNotMatch(source, /trial:\s*true|handle\.dblclick|force:\s*true|\.toPass\(|Promise\.race|dispatchEvent|\.click\(\)|style\.[a-z]+\s*=/);
    assert.equal((source.match(/mouse\.dblclick\(/g) || []).length, 1);
});

test('an occluded fresh center fails without coordinate input after readiness', async () => {
    const f = fixture({ covered: true });
    await assert.rejects(f.helper.openMoveingHandle('left'), /read-only readiness did not settle/);
    assert.equal(inputs(f).length, 0);
});

test('intentional vertical split preserves the sibling hidden by the frontend geometry', async () => {
    for (const [side, top, state] of [
        ['left', 817, { ...opened('left'), toolbox: false }],
        ['right', 0, { ...opened('right'), property: false }]
    ]) {
        const f = fixture({ initial: state, top });
        await f.helper.openMoveingHandle(side);
        assert.equal(inputs(f).length, 0);
    }
});
test('requested child vertically collapsed fails instead of toggling the open side closed', async () => {
    for (const [side, top] of [['left', 0], ['right', 817]]) {
        const f = fixture({ initial: opened(side), top });
        await assert.rejects(f.helper.openMoveingHandle(side), /vertically collapsed/);
        assert.equal(inputs(f).length, 0);
    }
});

for (const options of [
    { connected: false }, { visibility: 'hidden' }, { visibility: 'collapse' },
    { disabled: true }, { ariaDisabled: true }, { ariaDisabled: 'TRUE' }, { inert: true }, { inertParent: true }
]) {
    test('unactionable handle never receives native input: ' + JSON.stringify(options), async () => {
        const f = fixture(options);
        await assert.rejects(f.helper.openMoveingHandle('left'), /read-only readiness did not settle/);
        assert.equal(inputs(f).length, 0);
    });
}
for (const [key, bad, good] of [
    ['covered', true, false], ['connected', false, true], ['visibility', 'hidden', 'visible'],
    ['disabled', true, false], ['ariaDisabled', true, false], ['inert', true, false], ['inertParent', true, false]
]) {
    for (const frameIndex of [0, 1]) {
        test(key + ' at frame ' + (frameIndex + 1) + ' requires a later complete stable pair', async () => {
            const readyFrames = [{ [key]: good }, { [key]: good }, { [key]: good }, { [key]: good }];
            readyFrames[frameIndex] = { [key]: bad };
            const f = fixture({ readyFrames });
            await f.helper.openMoveingHandle('left');
            assert.equal(inputs(f).length, 1);
            assert.equal(f.events.filter(event => event[0] === 'frame').length, 4);
            assert.equal(f.events.filter(event => event[0] === 'read' && event[3] === true).length, 2);
        });
    }
}
for (const [key, first, second] of [
    ['top', 380, 381], ['width', 27, 28], ['height', 27, 28],
    ['viewportWidth', 390, 391], ['viewportHeight', 844, 845]
]) {
    test('continuously changing ' + key + ' fails readiness without any gesture', async () => {
        const readyFrames = Array.from({ length: 24 }, (_, index) => ({ [key]: index % 2 ? second : first }));
        const f = fixture({ readyFrames });
        await assert.rejects(f.helper.openMoveingHandle('left'), /read-only readiness did not settle/);
        assert.equal(inputs(f).length, 0);
    });
}
test('fresh settled geometry supplies the native point, not the initial box', async () => {
    const f = fixture({ readyFrames: [{ top: 380 }, { top: 410 }, { top: 410 }, { top: 410 }] });
    await f.helper.openMoveingHandle('left');
    assert.equal(inputs(f).length, 1);
    assert.equal(inputs(f)[0][3], 423.5);
    assert.equal(f.events.filter(event => event[0] === 'frame').length, 4);
});
test('replacement between frames requires a stable observation of the new element', async () => {
    const f = fixture({ readyFrames: [{}, { replace: true }, {}, {}] });
    await f.helper.openMoveingHandle('left');
    assert.equal(inputs(f).length, 1);
    assert.equal(f.events.filter(event => event[0] === 'read' && event[3] === true).length, 2);
});
test('pending read-only animation frame cannot start native input', async () => {
    const readinessGate = deferred(), f = fixture({ readinessGate });
    const operation = f.helper.openMoveingHandle('left');
    for (let turn = 0; turn < 100 && !f.events.some(event => event[0] === 'frame'); turn++) await Promise.resolve();
    assert.equal(f.events.filter(event => event[0] === 'frame').length, 1);
    assert.equal(inputs(f).length, 0);
    readinessGate.resolve(); await operation;
    assert.equal(inputs(f).length, 1);
});
test('late readiness completion after poll rejection cannot dispatch native input', async () => {
    const readinessGate = deferred(), f = fixture({ readinessGate });
    const error = new Error('synthetic readiness deadline');
    const originalPoll = expect.poll;
    let pendingRead;
    expect.poll = (read, options) => {
        if (options.timeout !== 5000) return originalPoll(read, options);
        pendingRead = read();
        return { toBe: async () => { throw error; } };
    };
    try {
        await assert.rejects(f.helper.openMoveingHandle('left'), candidate => candidate === error);
        assert.equal(inputs(f).length, 0);
        readinessGate.resolve(); await pendingRead;
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(inputs(f).length, 0);
    } finally {
        expect.poll = originalPoll; readinessGate.resolve(); await pendingRead;
    }
});
