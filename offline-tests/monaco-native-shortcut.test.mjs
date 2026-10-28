import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = readFileSync(new URL('../tests/tools/monaco-native-shortcut.ts', import.meta.url), 'utf8');
const { nativeMonacoShortcut, nativeMonacoShortcutDiagnostic } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const chord = (metaKey, keyLabel) => ({ ctrlKey: !metaKey, metaKey, shiftKey: false, altKey: false, keyLabel });

test('resolved Control bindings map identically on any runner, including emulated iPhone on macOS', () => {
    assert.equal(nativeMonacoShortcut([chord(false, 'A')], 'a'), 'Control+a');
    assert.equal(nativeMonacoShortcut([chord(false, 'Z')], 'z'), 'Control+z');
});
test('resolved Meta bindings retain native Mac shortcuts', () => {
    assert.equal(nativeMonacoShortcut([chord(true, 'A')], 'a'), 'Meta+a');
    assert.equal(nativeMonacoShortcut([chord(true, 'Z')], 'z'), 'Meta+z');
});
test('missing, ambiguous, unsupported or wrong-letter bindings fail closed', () => {
    for (const value of [null, undefined, [], [chord(false, 'A'), chord(false, 'Z')],
        [{ ...chord(false, 'A'), ctrlKey: false }], [{ ...chord(false, 'A'), metaKey: true }],
        [{ ...chord(false, 'A'), shiftKey: true }], [{ ...chord(false, 'A'), altKey: true }],
        [{ ...chord(false, 'A'), keyLabel: null }], [chord(false, 'Z')]]) {
        assert.throws(() => nativeMonacoShortcut(value, 'a'));
    }
});
test('scenario reads actual bindings once and retains selection, cursor and native Undo oracles', () => {
    const scenario = readFileSync(new URL('../tests/specs/normal/editor-style-ownership.spec.ts', import.meta.url), 'utf8').split("test('native Monaco typing")[1];
    assert.match(scenario, /_standaloneKeybindingService/);
    assert.match(scenario, /lookupKeybinding\(command\)\?\.getChords\(\)/);
    assert.match(scenario, /selectAll: read\('editor.action.selectAll'\), undo: read\('undo'\)/);
    assert.match(scenario, /keyboard.press\(selectAllShortcut\)/);
    assert.match(scenario, /keyboard.press\(undoShortcut\)/);
    assert.match(scenario, /startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 2/);
    assert.match(scenario, /lineNumber: 2, column: 15, focused: true/);
    assert.match(scenario, /modelText\(container\)\)\.toBe\(seed\)/);
    assert.doesNotMatch(scenario, /keyboard.press\('ControlOrMeta|addDynamicKeybinding|addCommand|\.trigger\(|\.run\(/);
    assert.doesNotMatch(source, /process\.platform|navigator|catch\s*\{/);
});


test('diagnostic emits one bounded fixed-schema line and ignores unknown fields', () => {
    const forbidden = 'SYNTHETIC_PRIVATE_SENTINEL\nhttps://invalid.example/private';
    const selectAll = [{ ...chord(false, 'A'), extra: forbidden }];
    const undo = [{ ...chord(true, 'Z'), extra: forbidden }];
    const line = nativeMonacoShortcutDiagnostic(selectAll, undo, {
        macintoshUA: false, iosUA: true, maxTouchPoints: 5, cookie: forbidden, url: forbidden, userAgent: forbidden
    });
    assert.ok(line.length < 350);
    assert.equal(line.split('\n').length, 1);
    assert.ok(line.startsWith('[monaco-native-shortcuts] '));
    assert.ok(!line.includes(forbidden));
    assert.deepEqual(JSON.parse(line.slice('[monaco-native-shortcuts] '.length)), {
        selectAll: { modifier: 'Control', key: 'A', shortcut: 'Control+a' },
        undo: { modifier: 'Meta', key: 'Z', shortcut: 'Meta+z' },
        macintoshUA: false, iosUA: true, maxTouchPoints: 5, touchCountCapped: false
    });
});

test('diagnostic bounds numeric values and never coerces malformed platform data', () => {
    const bomb = { toString() { assert.fail('must not coerce'); }, toJSON() { assert.fail('must not serialize'); } };
    for (const value of [-1, 1.5, NaN, Infinity, '5', bomb, undefined]) {
        const line = nativeMonacoShortcutDiagnostic([chord(true, 'A')], [chord(false, 'Z')], {
            macintoshUA: bomb, iosUA: 'private', maxTouchPoints: value
        });
        const data = JSON.parse(line.slice('[monaco-native-shortcuts] '.length));
        assert.equal(data.macintoshUA, null);
        assert.equal(data.iosUA, null);
        assert.equal(data.maxTouchPoints, null);
        assert.equal(data.touchCountCapped, false);
    }
    const line = nativeMonacoShortcutDiagnostic([chord(false, 'A')], [chord(false, 'Z')], {
        macintoshUA: false, iosUA: false, maxTouchPoints: Number.MAX_SAFE_INTEGER
    });
    const data = JSON.parse(line.slice('[monaco-native-shortcuts] '.length));
    assert.equal(data.maxTouchPoints, 32);
    assert.equal(data.touchCountCapped, true);
    assert.ok(line.length < 350);
});

test('diagnostic refuses invalid bindings before producing log output', () => {
    assert.throws(() => nativeMonacoShortcutDiagnostic([chord(false, 'Z')], [chord(false, 'Z')], {
        macintoshUA: false, iosUA: true, maxTouchPoints: 0
    }));
});

test('scenario logs only the diagnostic helper result once without raw attachments', () => {
    const scenario = readFileSync(new URL('../tests/specs/normal/editor-style-ownership.spec.ts', import.meta.url), 'utf8').split("test('native Monaco typing")[1];
    assert.equal((scenario.match(/console\.log\(/g) || []).length, 1);
    assert.match(scenario, /console\.log\(nativeMonacoShortcutDiagnostic\(bindings.selectAll, bindings.undo, bindings.platform\)\)/);
    assert.doesNotMatch(scenario, /JSON.stringify|\.attach\(/);
});
