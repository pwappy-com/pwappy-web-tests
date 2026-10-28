// Offline workflow argument selection; no browser, account, or network access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync(new URL('../.github/workflows/e2e-tests.yml', import.meta.url), 'utf8');
const normal = workflow.split('  e2e-normal:\n')[1].split('  e2e-premium:\n')[0];
const block = normal.match(/^          case "\$\{TEST_SCOPE:-all\}" in\n[\s\S]*?^          esac$/m)?.[0];
assert.ok(block, 'normal test argument selector exists');
const script = block.replace(/^          /gm, '') + '\nprintf "%s\\0" "${TEST_ARGS[@]}"\n';
const quickPath = 'tests/specs/normal/editor-quick-property-editor.spec.ts';
function select(scope) {
  const env = { PATH: process.env.PATH };
  if (scope !== undefined) env.TEST_SCOPE = scope;
  const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-c', script], {
    env, encoding: 'utf8', timeout: 5000,
  });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout,
    args: result.status === 0 ? result.stdout.split('\0').filter(Boolean) : [] };
}

for (const scope of [undefined, '', 'all']) {
  test(`full-suite default stays unchanged for ${JSON.stringify(scope)}`, () => {
    assert.deepEqual(select(scope).args, ['tests/specs/normal']);
    assert.equal(select(scope).status, 0);
  });
}
test('quick-property scope selects exactly the complete existing file', () => {
  assert.deepEqual(select('quick-property-regression').args, [quickPath]);
  assert.equal(select('quick-property-regression').status, 0);
  assert.ok(existsSync(new URL('../' + quickPath, import.meta.url)));
  assert.doesNotMatch(block.split('quick-property-regression)')[1].split(';;')[0], /--grep|--invert|--shard/);
});
test('existing editor regression selection and grep remain unchanged', () => {
  assert.deepEqual(select('editor-regression').args, [
    'tests/specs/normal/editor-events-build.spec.ts',
    'tests/specs/normal/editor-property-parsing-build.spec.ts',
    '--grep', 'DOMContentLoaded|loadイベント|ライフサイクルイベント|グローバルなイベント委譲|JSDocの@fires',
  ]);
});
for (const scope of ['quick-property', 'typo', ' all ', 'ALL', '$(printf injected)', 'all; printf injected', 'all\nquick-property-regression']) {
  test(`unknown scope fails instead of running the full suite: ${JSON.stringify(scope)}`, () => {
    const result = select(scope);
    assert.equal(result.status, 1);
    assert.equal(result.output, '::error::Unsupported normal test scope\n');
    assert.deepEqual(result.args, []);
  });
}
test('manual choice is wired while defaults, smoke exit and cleanup remain', () => {
  const input = workflow.split('      test_scope:\n')[1].split('      prepare_points:')[0];
  assert.match(input, /default: "all"/);
  assert.deepEqual([...input.matchAll(/^          - (.+)$/gm)].map(m => m[1]),
    ['all', 'editor-regression', 'quick-property-regression', 'style-ownership-regression', 'points-smoke']);
  assert.match(normal, /TEST_SCOPE: \$\{\{ inputs.test_scope \|\| 'all' \}\}/);
  assert.ok(normal.indexOf('node tests/tools/points-smoke.mjs\n            exit $?') < normal.indexOf(block));
  assert.match(normal, /npx playwright test "\$\{TEST_ARGS\[@\]\}" --project=\$\{\{ matrix.browser \}\} --reporter=line --workers="\$WORKERS" --retries="\$RETRIES"/);
  assert.match(normal, /name: Run Local Cleanup on Finish\n        timeout-minutes: 5\n        if: always\(\) && inputs.test_scope != 'points-smoke'/);
  assert.doesNotMatch(workflow.split('  e2e-premium:\n')[1], /quick-property-regression/);
});
