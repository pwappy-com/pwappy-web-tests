// Orchestration contracts only. These are not browser, Monaco or Redux tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../tests/specs/normal/editor-style-ownership.spec.ts', import.meta.url), 'utf8');
const start = source.indexOf('async function awaitCapturedStyleTimer(');
const bodyStart = source.indexOf('{', start) + 1;
const bodyEnd = source.indexOf('\n}\n', bodyStart);
assert.ok(start >= 0 && bodyEnd > bodyStart);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const fence = new AsyncFunction('container', 'timer', 'expect', source.slice(bodyStart, bodyEnd).replaceAll('host: any', 'host'));

function expectations(onPending) {
    const expect = actual => ({
        toBe: expected => assert.equal(actual, expected),
        toBeGreaterThan: expected => assert.ok(actual > expected),
    });
    expect.poll = read => ({ async toBe(expected) {
        if (await read() !== expected) {
            await onPending();
            assert.equal(await read(), expected);
        }
    } });
    return expect;
}

test('captured timer fence waits for the old callback, not an already-correct preview', async () => {
    const host = { _styleDispatchTimer: 17, style: 'width: 281px;' };
    let callbackRan = false;
    const container = { evaluate: (read, timer) => read(host, timer) };
    await fence(container, 17, expectations(() => {
        callbackRan = true;
        // Deliberate old-code negative control: wrong write before null.
        host.style = 'width: 999px;';
        host._styleDispatchTimer = null;
    }));
    assert.equal(callbackRan, true);
    assert.equal(host.style, 'width: 999px;');
    assert.throws(() => assert.equal(host.style, 'width: 281px;'));
});

test('canceled captured timer passes the fence but still requires the UI oracle', async () => {
    const host = { _styleDispatchTimer: null, style: 'width: 281px;' };
    await fence({ evaluate: (read, timer) => read(host, timer) }, 17,
        expectations(() => assert.fail('already canceled; no callback needed')));
    assert.equal(host.style, 'width: 281px;');
});

test('a timer that never settles fails instead of advancing to a new owner', async () => {
    const host = { _styleDispatchTimer: 17 };
    await assert.rejects(fence({ evaluate: (read, timer) => read(host, timer) }, 17,
        expectations(() => {})));
    assert.equal(host._styleDispatchTimer, 17);
});

test('a missing schedule fails instead of treating undefined as cancellation', async () => {
    for (const timer of [undefined, null, 0]) {
        await assert.rejects(fence({ evaluate: () => assert.fail('must validate capture first') }, timer,
            expectations(() => {})));
    }
});

test('four added normal scenarios, without skips, timer mocks or new wait budgets', () => {
    assert.equal((source.match(/^test\('/gm) || []).length, 4);
    assert.doesNotMatch(source, /test\.(?:skip|fixme|only)|waitForTimeout|page\.clock|setTimeout\(|clearTimeout\(/);
    assert.doesNotMatch(source, /\.dispatch\(|\.setAttribute\(|\.value\s*=/);
    assert.equal((source.match(/await awaitCapturedStyleTimer\(container, (?:timer|tabTimer)\)/g) || []).length, 4);
});

test('native input and nonnative boundaries remain explicitly distinct', () => {
    assert.match(source, /NON-NATIVE overlap probe/);
    assert.match(source, /NON-NATIVE Undo boundary/);
    assert.match(source, /NON-NATIVE boundary probe/);
    assert.match(source, /await button\.click\(\)/);
    assert.match(source, /await widthInput\.fill\('281px'\)/);
    assert.match(source, /await editorPage\.keyboard\.insertText\(typed\)/);
    assert.match(source, /await editorPage\.keyboard\.press\('ControlOrMeta\+z'\)/);
    assert.match(source, /expect\(cursor\)\.toEqual\(\{ lineNumber: 3, column: 2, focused: true \}\)/);
});

test('attribute and Undo probes wait for their exact timer before switching to B', () => {
    for (const title of ['newer attribute change wins', 'quoted CSS whitespace persists']) {
        const begin = source.indexOf(`test('${title}`);
        const next = source.indexOf('\ntest(', begin + 1);
        const scenario = source.slice(begin, next < 0 ? undefined : next);
        assert.ok(scenario.indexOf('await awaitCapturedStyleTimer(container, timer)') > 0);
        assert.ok(scenario.indexOf('await awaitCapturedStyleTimer(container, timer)') < scenario.indexOf('await commitStyleOnB('));
    }
});

test('same-ID history probe preserves quote-space oracle and does not bypass Undo UI', () => {
    assert.match(source, /--quoted: "ab"/);
    assert.match(source, /--quoted: "a b"/);
    assert.match(source, /await undo\.evaluate/);
    assert.match(source, /\(button as HTMLButtonElement\)\.click\(\)/);
    assert.match(source, /toHaveAttribute\('data-node-id', ownerId!/);
    assert.doesNotMatch(source, /templateHistoryManager\.(?:undo|redo)|loadTemplateJson\(/);
});

test('real Undo selection followup is observed and cleaned before selecting B', () => {
    const begin = source.indexOf("test('quoted CSS whitespace persists");
    const end = source.indexOf('\ntest(', begin + 1);
    const scenario = source.slice(begin, end);
    assert.ok(scenario.indexOf("window.addEventListener('to-element-and-select', listener)") < scenario.indexOf('await undo.evaluate('));
    assert.match(scenario, /payload\?\.targetTemplateId === expectedId/);
    assert.ok(scenario.indexOf('undoSelection.evaluate(observation => observation.seen)') < scenario.indexOf('await commitStyleOnB('));
    assert.match(scenario, /finally \{\s*try \{ await undoSelection.evaluate\(observation => observation.cleanup\(\)\)/);
    assert.match(scenario, /window.removeEventListener\('to-element-and-select', listener\)/);
    assert.match(scenario, /await undoSelection.dispose\(\)/);
    assert.doesNotMatch(scenario, /dispatchEvent\(/);
});


test('new fixture card selection preserves native actionability checks', () => {
    assert.match(source, /await appRow\.click\(\)/);
    assert.doesNotMatch(source, /force\s*:\s*true/);
});
