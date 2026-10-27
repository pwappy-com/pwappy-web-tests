// Offline contract checks: built-in Node modules and local Bash only; no service calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync(new URL('../.github/workflows/e2e-tests.yml', import.meta.url), 'utf8');
const validation = workflow.split('      - name: Validate normal matrix parallelism\n')[1]
  ?.split('      - name: Determine test matrix\n')[0];
assert.ok(validation, 'validation step exists before matrix preparation');
const script = validation.split('        run: |\n')[1]
  .split('\n').map(line => line.replace(/^          /, '')).join('\n');

function validate(value, event = 'workflow_dispatch') {
  const directory = mkdtempSync(join(tmpdir(), 'matrix-load-control-'));
  const output = join(directory, 'output');
  try {
    const env = { PATH: process.env.PATH, EVENT_NAME: event, GITHUB_OUTPUT: output };
    if (value !== undefined) env.MATRIX_PARALLELISM_INPUT = value;
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-c', script], {
      env, cwd: directory, encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(result.error);
    return { status: result.status, stdout: result.stdout,
      output: existsSync(output) ? readFileSync(output, 'utf8') : '' };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const value of ['1', '2', '5', '', undefined]) {
  test(`manual ${JSON.stringify(value)} produces a safe numeric output`, () => {
    const result = validate(value);
    assert.equal(result.status, 0);
    assert.equal(result.output, `matrix_parallelism=${value || '5'}\n`);
  });
}
for (const value of ['0', '3', '-1', '10', '01', '1.0', ' 1 ', 'true', 'null',
  '1\nmatrix_parallelism=5', '$(printf injected)', '`printf injected`', '1; printf injected']) {
  test(`manual invalid ${JSON.stringify(value)} fails closed`, () => {
    const result = validate(value);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /::error::matrix_parallelism must be 1, 2, or 5/);
    assert.equal(result.output, '');
    assert.doesNotMatch(result.stdout, /injected/);
  });
}
for (const value of [undefined, '', '1', 'invalid']) {
  test(`schedule ignores dispatch value ${JSON.stringify(value)} and retains 5`, () => {
    assert.deepEqual(validate(value, 'schedule'), {
      status: 0, stdout: '', output: 'matrix_parallelism=5\n',
    });
  });
}

test('choice input and safe environment transport are wired without shell interpolation', () => {
  const inputs = workflow.split('  workflow_dispatch:\n    inputs:\n')[1].split('\n# ワークフロー')[0];
  const names = [...inputs.matchAll(/^      (\w+):$/gm)].map(match => match[1]);
  assert.ok(names.length <= 10);
  assert.equal(names.length, 9);
  assert.ok(names.includes('trace_snapshots'));
  const declaration = inputs.split('      matrix_parallelism:\n')[1].split('      retries:')[0];
  assert.match(declaration, /^        type: choice$/m);
  assert.match(declaration, /^        default: "5"$/m);
  assert.deepEqual([...declaration.matchAll(/^          - "(\d+)"$/gm)].map(m => m[1]), ['1', '2', '5']);
  assert.match(validation, /MATRIX_PARALLELISM_INPUT: \$\{\{ inputs.matrix_parallelism \}\}/);
  assert.match(validation, /EVENT_NAME: \$\{\{ github.event_name \}\}/);
  assert.doesNotMatch(script, /\$\{\{/);
  assert.doesNotMatch(validation, /uses:|curl|wget|npm|playwright/);
});

test('validation gates both service-facing jobs, normal uses output and premium remains 1', () => {
  const prepare = workflow.split('  prepare-matrix:\n')[1].split('  e2e-normal:\n')[0];
  assert.match(prepare, /matrix_parallelism: \$\{\{ steps.validate-parallelism.outputs.matrix_parallelism \}\}/);
  assert.match(prepare, /steps:\n      - name: Validate normal matrix parallelism/);
  assert.doesNotMatch(prepare, /continue-on-error:/);
  const normal = workflow.split('  e2e-normal:\n')[1].split('  e2e-premium:\n')[0];
  const premium = workflow.split('  e2e-premium:\n')[1];
  for (const job of [normal, premium]) {
    assert.match(job, /^    needs: prepare-matrix$/m);
    assert.match(job, /^    if: \$\{\{ needs.prepare-matrix.outputs.run_(normal|premium) == 'true' \}\}$/m);
    assert.match(job, /^      fail-fast: false$/m);
  }
  assert.match(normal, /^      max-parallel: \$\{\{ fromJSON\(needs.prepare-matrix.outputs.matrix_parallelism\) \}\}$/m);
  assert.match(premium, /^      max-parallel: 1$/m);
  assert.equal(workflow.match(/max-parallel:/g).length, 2);
});
