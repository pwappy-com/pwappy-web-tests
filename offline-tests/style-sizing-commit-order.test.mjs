// Contract checks for E2E orchestration only, not a real browser timing test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const source = readFileSync(new URL('../tests/specs/normal/editor-ui-properties-2.spec.ts', import.meta.url), 'utf8');
const start = source.indexOf("            const brokenStyle = 'element.style {\\n    width: 300px\\n}';");
assert.notEqual(start, -1);
const end = source.indexOf("            await editorHelper.switchTabInContainer(propertyContainer, '属性');", start);
const block = source.slice(start, end);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = new AsyncFunction('editorHelper', 'styleEditor', 'expect', 'previewSelector', block);
const exactExpectation = actual => ({ toBe(expected) { assert.equal(actual, expected); }, async toHaveAttribute(name, pattern) { return actual.assertAttribute(name, pattern); } });

function fixture({ success = true, wrongReadback = false, previewFailure = false } = {}) {
  const state = { style: 'max-width: 500px;', computedWidth: '300px', events: [], pending: null };
  const helper = {
    async setMonacoValue(_editor, value) {
      state.events.push('set-model');
      state.pending = () => { state.style = 'width: 300px'; state.events.push('commit-old-edit'); };
      return { success, actual: wrongReadback ? 'wrong model' : value };
    },
    getPreviewElement(selector) {
      assert.equal(selector, 'ons-button');
      return { async assertAttribute(name, pattern) {
        assert.equal(name, 'style');
        assert.doesNotMatch(state.style, pattern, 'layout width is not evidence of raw committed CSS');
        state.events.push('await-preview');
        if (previewFailure) throw new Error('preview did not commit');
        state.pending();
        state.pending = null;
        assert.match(state.style, pattern);
      } };
    },
  };
  return { state, helper };
}

test('the previous model commit finishes before the next independent edit', async () => {
  const { state, helper } = fixture();
  await execute(helper, {}, exactExpectation, 'ons-button');
  state.events.push('next-attribute-edit');
  state.style = 'width: invalid_value_test;';
  state.pending?.();
  assert.equal(state.style, 'width: invalid_value_test;');
  assert.deepEqual(state.events, ['set-model', 'await-preview', 'commit-old-edit', 'next-attribute-edit']);
});

test('negative control: the original sequence allows the old write to win', async () => {
  const { state, helper } = fixture();
  await helper.setMonacoValue({}, 'element.style {\n    width: 300px\n}');
  state.style = 'width: invalid_value_test;';
  state.pending();
  assert.equal(state.style, 'width: 300px');
});

test('raw declaration barrier rejects max-width and unrelated computed layout matches', async () => {
  const { helper } = fixture();
  let captured;
  const captureExpect = actual => ({
    toBe(expected) { assert.equal(actual, expected); },
    async toHaveAttribute(name, pattern) { assert.equal(name, 'style'); captured = pattern; },
  });
  await execute(helper, {}, captureExpect, 'ons-button');
  for (const oldStyle of ['', 'max-width: 300px;', 'max-width: 500px;\nmax-height: 400px;', 'width: invalid_value_test;']) {
    assert.doesNotMatch(oldStyle, captured);
  }
  for (const committedStyle of ['width: 300px', ' width:300px;\n']) assert.match(committedStyle, captured);
});

for (const options of [{ success: false }, { wrongReadback: true }]) {
  test(`model update failure is not treated as a completed setup: ${JSON.stringify(options)}`, async () => {
    const { state, helper } = fixture(options);
    await assert.rejects(execute(helper, {}, exactExpectation, 'ons-button'));
    assert.deepEqual(state.events, ['set-model']);
  });
}

test('missing preview commit fails rather than advancing or retrying a mutation', async () => {
  const { state, helper } = fixture({ previewFailure: true });
  await assert.rejects(execute(helper, {}, exactExpectation, 'ons-button'), /preview did not commit/);
  assert.deepEqual(state.events, ['set-model', 'await-preview']);
});

test('the added barrier contains no fixed delay or repeated mutating callback', () => {
  assert.doesNotMatch(block, /waitForTimeout|setTimeout|toPass|\.fill\(|\.press\(/);
  assert.equal((block.match(/setMonacoValue/g) || []).length, 1);
  assert.equal((block.match(/toHaveAttribute/g) || []).length, 1);
  assert.doesNotMatch(block, /toHaveCSS|expectPreviewElementCss/);
});

test('all other scenarios, assertions, time budgets and cleanup remain byte-identical', () => {
  const originalBlock = "            const brokenStyle = 'element.style {\\n    width: 300px\\n}';\n            await editorHelper.setMonacoValue(styleEditor, brokenStyle);\n\n";
  const normalized = source.slice(0, start) + originalBlock + source.slice(end);
  assert.equal(createHash('sha256').update(normalized).digest('hex'), '134ef093926d042fdd53879e61f8a4971daa76e87f394ffae572e3308727e7f0');
});
