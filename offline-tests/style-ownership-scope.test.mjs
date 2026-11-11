// Offline scope contracts only: execute extracted argument selection, never CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { restoreApprovedNormalDefaults } from './normal-defaults-contract.mjs';

const workflow = readFileSync(new URL('../.github/workflows/e2e-tests.yml', import.meta.url), 'utf8');
const normal = workflow.split('  e2e-normal:\n')[1].split('  e2e-premium:\n')[0];
const block = normal.match(/^          case "\$\{TEST_SCOPE:-all\}" in\n[\s\S]*?^          esac$/m)?.[0];
assert.ok(block);
const path = 'tests/specs/normal/editor-style-ownership.spec.ts';
function select(scope) {
  const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-c',
    block.replace(/^          /gm, '') + '\nprintf "%s\\0" "${TEST_ARGS[@]}"\n'], {
    env: { PATH: process.env.PATH, TEST_SCOPE: scope }, encoding: 'utf8', timeout: 5000,
  });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout,
    args: result.status === 0 ? result.stdout.split('\0').filter(Boolean) : [] };
}
test('style ownership selects the whole six-scenario file without narrowing', () => {
  assert.deepEqual(select('style-ownership-regression'), { status: 0, output: path + '\0', args: [path] });
  assert.ok(existsSync(new URL('../' + path, import.meta.url)));
  assert.equal((readFileSync(new URL('../' + path, import.meta.url), 'utf8').match(/^test\('/gm) || []).length, 6);
  assert.doesNotMatch(block.split('style-ownership-regression)')[1].split(';;')[0], /--grep|--invert|--shard/);
});
for (const scope of ['style-ownership', 'STYLE-OWNERSHIP-REGRESSION', ' style-ownership-regression', 'style-ownership-regression\nall', 'style-ownership-regression; echo injected']) {
  test(`invalid focused scope fails closed: ${JSON.stringify(scope)}`, () => {
    assert.deepEqual(select(scope), { status: 1, output: '::error::Unsupported normal test scope\n', args: [] });
  });
}
test('strictly undoing only approved additions preserves the complete previous workflow', () => {
  const addition = '            style-ownership-regression)\n              TEST_ARGS=(tests/specs/normal/editor-style-ownership.spec.ts) ;;\n';
  const choice = '          - style-ownership-regression\n';
  assert.equal(workflow.split(addition).length, 2, 'exactly the approved selector addition');
  assert.equal(workflow.split(choice).length, 2, 'exactly the approved choice addition');
  const restored = restoreApprovedNormalDefaults(workflow).replace(addition, '').replace(choice, '');
  assert.equal(createHash('sha256').update(restored).digest('hex'), '56d57e7aaa3b5fe1be294add368818eb9cb24448e12358e443c65136ad3a6529');
  // Whole-file hash protects all earlier selectors/defaults, Premium, point
  // preparation, cleanup, timeouts and schedules—not just sampled substrings.
});
