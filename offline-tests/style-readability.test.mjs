// Oracle/source contracts only. Actual formatting is verified by staging E2E.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inspectStyleDeclarationLines } from '../tests/tools/style-readability-oracle.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const blob = text => createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex');
const expected = { width: '137px', paddingLeft: '11px', quoted: '"alpha  beta; gamma"' };
const good = 'element.style {\n  width: 137px;\n  padding-left: 11px;\n  --readability-label: "alpha  beta; gamma";\n}';
const readable = { wrapper: true, width: true, paddingLeft: true, quoted: true, distinct: true };
const isReadable = text => Object.values(inspectStyleDeclarationLines(text, expected)).every(Boolean);

test('layout oracle accepts distinct declarations without pinning indentation or order', () => {
    assert.deepEqual(inspectStyleDeclarationLines(good, expected), readable);
    assert.equal(isReadable('element.style {\r\n\t--readability-label:"alpha  beta; gamma";\r\nwidth:137px;\r\npadding-left:11px;\r\n}'), true);
});
test('wrapper-only newlines are not CSS declaration formatting', () => {
    assert.equal(isReadable('element.style {\n width:137px;padding-left:11px;--readability-label:"alpha  beta; gamma";\n}'), false);
});
test('two declarations sharing a line fail even when other declarations have new lines', () => {
    assert.equal(isReadable(good.replace('width: 137px;\n  padding-left:', 'width: 137px; padding-left:')), false);
});
test('quoted semicolon and internal double spaces are preserved rather than split or normalized', () => {
    for (const text of [
        good.replace('beta; gamma', 'beta;\n gamma'),
        good.replace('alpha  beta', 'alpha beta'),
        good.replace('beta; gamma', 'beta gamma')
    ]) assert.equal(isReadable(text), false);
});
test('missing, wrong, duplicated declarations and foreign wrappers fail closed', () => {
    for (const text of [
        good.replace('  width: 137px;\n', ''),
        good.replace('width: 137px', 'max-width: 137px'),
        good.replace('137px', '223px'),
        good.replace('  width: 137px;', '  width: 137px;\n  width: 137px;'),
        good.replace('element.style', '.other'),
        good.replace('{', '')
    ]) assert.equal(isReadable(text), false);
});
test('malformed oracle inputs are rejected without coercing or exposing input text', () => {
    const bomb = { toString() { assert.fail('must not coerce'); } };
    for (const text of [null, undefined, 1, bomb]) assert.equal(Object.values(inspectStyleDeclarationLines(text, expected)).some(Boolean), false);
    for (const values of [null, {}, { ...expected, quoted: bomb }, { ...expected, quoted: '\n' }]) {
        assert.equal(Object.values(inspectStyleDeclarationLines(good, values)).some(Boolean), false);
    }
});

const specPath = 'tests/specs/normal/editor-style-ownership.spec.ts';
const spec = read(specPath);
const importLine = "import { inspectStyleDeclarationLines } from '../../tools/style-readability-oracle.mjs';\n";
const begin = '// BEGIN CSS READABILITY E2E\n';
const end = '// END CSS READABILITY E2E\n\n';
function addedBlock(source) {
    assert.equal(source.split(begin).length, 2);
    assert.equal(source.split(end).length, 2);
    const start = source.indexOf(begin), finish = source.indexOf(end) + end.length;
    assert.ok(finish > start);
    return source.slice(start, finish);
}
function assertApprovedSpec(source) {
    const added = addedBlock(source);
    assert.equal(blob(added), '029568b13c1b74a6bc9e46e8b5a65e1a418de321');
    assert.equal(source.split(importLine).length, 2);
    const restored = source.replace(importLine, '').replace(added, '');
    assert.equal(blob(restored), '5ca4cf1953c9b9f4aa5b196f4a9ec80a8c6942f2');
}
test('exact additive block preserves all four existing scenarios and rejects oracle or old-budget drift', () => {
    assertApprovedSpec(spec);
    assert.throws(() => assertApprovedSpec(spec.replace('wrapper: true, width: true', 'wrapper: false, width: true')));
    assert.throws(() => assertApprovedSpec(spec.replace('timeout: 15000', 'timeout: 15001')));
    assert.throws(() => assertApprovedSpec(spec.replace('await deleteApp(page, appKey);', '')));
});
test('independent real-UI cases preserve native selection, actual typing and both final owner semantics', () => {
    const added = addedBlock(spec);
    assert.equal((added.match(/^test\('/gm) || []).length, 2);
    assert.doesNotMatch(added, /test\.(?:fail|skip|fixme|only|describe)|expect\.soft|waitForTimeout|setTimeout\(|formatDocument|\.run\(|\.trigger\(|force\s*:|setViewportSize|\.dispatch\(|\.setAttribute\(|\.setValue\(/);
    assert.match(added, /await helper\.selectNodeInDomTree\(node\)/);
    assert.match(added, /if \(isMobile\) await helper\.openMoveingHandle\('right'\)/);
    const select = added.slice(added.indexOf('async function selectNodeWithStyleActive'), added.indexOf('async function expectReadableSelectedStyle'));
    assert.equal((select.match(/await expect\(editor\)\.toBeVisible\(\)/g) || []).length, 2);
    assert.doesNotMatch(select, /nativeTab|#tab-style.*\.click|closeMoveingHandle|preview\.click/);
    assert.match(added, /inspectStyleDeclarationLines\(await modelText\(container\), fixture\)/);
    assert.match(added, /getPropertyValue\('--readability-label'\)\.trim\(\)/);
    const seed = added.slice(added.indexOf('async function seedReadabilityPair'), added.indexOf('async function selectNodeWithStyleActive'));
    const committed = seed.indexOf('expectReadabilitySemantics(pair.previewA, readableA)');
    const leaveOwner = seed.indexOf('selectNodeInDomTree(pair.b)');
    assert.ok(committed >= 0 && leaveOwner > committed);
    const owner = added.slice(added.indexOf("test('consecutive native selections"));
    assert.doesNotMatch(owner, /expectReadableSelectedStyle|writeStyle/);
    assert.equal((owner.match(/await typeVisibleStyleNatively/g) || []).length, 2);
    assert.equal((owner.match(/await expectReadabilitySemantics/g) || []).length, 4);
    assert.equal((owner.match(/modelText\(container\)\)\.toMatch/g) || []).length, 4);
    assert.match(added, /getValueInRange\(host\.styleEditor\.getSelection\(\)\) === model\.getValue\(\)/);
    assert.match(added, /keyboard\.insertText\('element\.style \{' \+ readabilityDeclarations\(fixture\) \+ '}'\)/);
    assert.doesNotMatch(added, /\.attach\(|console\.|page\.on\('request/);
});

const legacyChanges = {
  "offline-tests/style-ownership-contract.test.mjs": {
    "sha": "3f6cd5f0ca7446e6fc93ab4d087b34ad8f65eb4d",
    "edits": [
      {
        "before": "test('four added normal scenarios, without skips, timer mocks or new wait budgets'",
        "after": "test('six normal scenarios, without skips, timer mocks or new wait budgets'"
      },
      {
        "before": "assert.equal((source.match(/^test\\('/gm) || []).length, 4);",
        "after": "assert.equal((source.match(/^test\\('/gm) || []).length, 6);"
      }
    ]
  },
  "offline-tests/style-ownership-scope.test.mjs": {
    "sha": "a1a267c7338ea77a809fe55babaa9248abd411fd",
    "edits": [
      {
        "before": "test('style ownership selects the whole four-scenario file without narrowing'",
        "after": "test('style ownership selects the whole six-scenario file without narrowing'"
      },
      {
        "before": "assert.equal((readFileSync(new URL('../' + path, import.meta.url), 'utf8').match(/^test\\('/gm) || []).length, 4);",
        "after": "assert.equal((readFileSync(new URL('../' + path, import.meta.url), 'utf8').match(/^test\\('/gm) || []).length, 6);"
      }
    ]
  }
};
test('legacy contracts change only their explicit four-to-six scenario counts and titles', () => {
    for (const [path, { sha, edits }] of Object.entries(legacyChanges)) {
        let source = read(path);
        for (const { before, after } of edits) {
            assert.equal(source.split(after).length, 2);
            source = source.replace(after, before);
        }
        assert.equal(blob(source), sha);
    }
});
test('live workflow and test budget stay unchanged', () => {
    assert.equal(blob(read('.github/workflows/e2e-tests.yml')), '915228b40569c83bdd1b0e8db6ef966360c67568');
    assert.equal(blob(read('playwright.config.ts')), '66a03298a97609c171390f29d37955ccf086cf76');
    assert.equal(blob(read('package.json')), 'cb731d5ce2654976d0b24f52bd975c1fd2272e8f');
});
