// Offline workflow contracts: local Bash and Node only, no accounts or service calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const workflow = readFileSync(new URL('../.github/workflows/e2e-tests.yml', import.meta.url), 'utf8');
const config = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');
const normal = workflow.split('  e2e-normal:\n')[1].split('  e2e-premium:\n')[0];
const premium = workflow.split('  e2e-premium:\n')[1];
const traceBlock = workflow.split('      - name: Resolve suite trace snapshots\n')[1].split('      - name: Filter normal browser matrix\n')[0];
const traceScript = traceBlock.split('        run: |\n')[1].replace(/^          /gm, '');
function execute(script, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'normal-defaults-')); const output = join(dir, 'out');
  try {
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-c', script], {
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...env }, encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(result.error);
    return { status: result.status, stdout: result.stdout, output: existsSync(output) ? readFileSync(output, 'utf8') : '' };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
for (const value of [undefined, '', 'auto', 'true', 'false']) {
  test(`manual trace ${JSON.stringify(value)} resolves per-suite defaults without losing explicit false`, () => {
    const result = execute(traceScript, { EVENT_NAME: 'workflow_dispatch', ...(value === undefined ? {} : { TRACE_SNAPSHOTS_INPUT: value }) });
    const auto = !value || value === 'auto';
    assert.deepEqual(result, { status: 0, stdout: '', output: `normal_trace_snapshots=${auto ? 'false' : value}\npremium_trace_snapshots=${auto ? 'true' : value}\n` });
  });
}
for (const value of ['FALSE', 'True', '0', '1', ' auto ', 'null', '$(printf injected)', 'true\nx=false']) {
  test(`invalid trace ${JSON.stringify(value)} fails closed before jobs`, () => {
    assert.deepEqual(execute(traceScript, { EVENT_NAME: 'workflow_dispatch', TRACE_SNAPSHOTS_INPUT: value }), {
      status: 1, stdout: '::error::trace_snapshots must be auto, true, or false\n', output: '',
    });
  });
}
for (const value of ['', 'true', 'false', 'invalid']) {
  test(`schedule ignores dispatch trace ${JSON.stringify(value)}`, () => {
    assert.deepEqual(execute(traceScript, { EVENT_NAME: 'schedule', TRACE_SNAPSHOTS_INPUT: value }), {
      status: 0, stdout: '', output: 'normal_trace_snapshots=false\npremium_trace_snapshots=true\n',
    });
  });
}
test('trace choice and job wiring preserve Premium/local defaults and diagnostic opt-in', () => {
  const input = workflow.split('      trace_snapshots:\n')[1].split('      matrix_parallelism:')[0];
  assert.match(input, /type: choice/); assert.match(input, /default: "auto"/);
  assert.deepEqual([...input.matchAll(/^          - "(.*)"$/gm)].map(m=>m[1]), ['auto','true','false']);
  assert.match(traceBlock, /TRACE_SNAPSHOTS_INPUT: \$\{\{ github.event.inputs.trace_snapshots \}\}/);
  assert.doesNotMatch(traceScript, /\$\{\{/);
  assert.doesNotMatch(workflow.split('concurrency:')[0], /PWAPPY_TRACE_SNAPSHOTS:/);
  for (const [suite,job] of [['normal',normal],['premium',premium]]) {
    assert.ok(workflow.includes(`${suite}_trace_snapshots: \${{ steps.resolve-trace.outputs.${suite}_trace_snapshots }}`));
    assert.ok(job.includes(`PWAPPY_TRACE_SNAPSHOTS: \${{ needs.prepare-matrix.outputs.${suite}_trace_snapshots }}`));
    assert.match(job, /^    needs: prepare-matrix$/m);
  }
  assert.equal(workflow.match(/PWAPPY_TRACE_SNAPSHOTS:/g).length, 2);
  assert.equal(workflow.match(/continue-on-error:/g), null);
});
const workerBlock = normal.match(/^          WORKERS=1\n[\s\S]*?^          fi$/m)?.[0];
assert.ok(workerBlock);
for (const event of ['schedule','workflow_dispatch']) {
  for (const value of [undefined,'','1','2','75%']) {
    test(`${event} workers ${JSON.stringify(value)} uses bounded fallback and explicit manual override`, () => {
      const result = execute(workerBlock.replace(/^          /gm,'')+'\nprintf "%s" "$WORKERS"', {
        EVENT_NAME: event, ...(value === undefined ? {} : { TEST_WORKERS: value }),
      });
      assert.equal(result.status, 0);
      assert.equal(result.stdout, event === 'workflow_dispatch' ? value || '1' : '1');
    });
  }
}
const retriesBlock = normal.match(/^          RETRIES="\$\{TEST_RETRIES:-0\}"\n[\s\S]*?^          fi$/m)?.[0];
assert.ok(retriesBlock);
for (const value of [undefined,'','0','1','5','6','-1','00','$(printf injected)']) {
  test(`normal retries ${JSON.stringify(value)} defaults zero and remains validated`, () => {
    const result = execute(retriesBlock.replace(/^          /gm,'')+'\nprintf "%s" "$RETRIES"', value === undefined ? {} : { TEST_RETRIES: value });
    if (value === undefined || value === '' || /^[0-5]$/.test(value)) {
      assert.equal(result.status,0); assert.equal(result.stdout,value || '0');
    } else { assert.equal(result.status,1); assert.doesNotMatch(result.stdout,/injected/); }
  });
}
test('normal operational defaults preserve Premium, legacy points fallback, cleanup, and scope', () => {
  assert.match(workflow.split('      workers:\n')[1].split('      test_scope:')[0], /default: "1"/);
  assert.match(workflow.split('      retries:\n')[1].split('# ワークフロー')[0], /default: "0"/);
  assert.match(normal, /TEST_RETRIES: \$\{\{ inputs.retries \|\| '0' \}\}/);
  assert.match(normal, /EVENT_NAME: \$\{\{ github.event_name \}\}/);
  assert.match(normal, /TEST_WORKERS: \$\{\{ github.event.inputs.workers \}\}/);
  assert.doesNotMatch(workerBlock,/\$\{\{/);
  assert.match(premium,/npx playwright test tests\/specs\/premium .* --workers=1/);
  assert.match(premium,/--retries="\$RETRIES"/);
  assert.match(premium,/TEST_RETRIES: \$\{\{ inputs.retries \|\| '0' \}\}/);
  assert.doesNotMatch(premium,/TEST_WORKERS/);
  assert.match(config,/retries: isCleanup \? 0 : \(process.env.CI \? 5 : 0\)/);
  assert.match(premium,/max-parallel: 1/);
  assert.match(normal,/TEST_SCOPE: \$\{\{ inputs.test_scope \|\| 'all' \}\}/);
  assert.match(workflow,/PWAPPY_TEST_POINTS_ENABLED: \$\{\{ inputs.prepare_points && 'true' \|\| vars.PWAPPY_TEST_POINTS_ENABLED \}\}/);
  assert.match(workflow.split('      prepare_points:\n')[1].split('      trace_snapshots:')[0],/default: false/);
  for (const job of [normal,premium]) {
    assert.match(job,/name: Run Local Cleanup on Finish\n        timeout-minutes: 5\n        if: always\(\)/);
  }
});

const pointsBlock = workflow.split('      - name: Resolve normal point preparation\n')[1].split('      - name: Resolve suite trace snapshots\n')[0];
const pointsScript = pointsBlock.split('        run: |\n')[1].replace(/^          /gm, '');
for (const value of [undefined, '', 'true', 'false']) {
  test(`normal point preparation manual ${JSON.stringify(value)} preserves explicit false and defaults true`, () => {
    assert.deepEqual(execute(pointsScript, { EVENT_NAME: 'workflow_dispatch', ...(value === undefined ? {} : { NORMAL_PREPARE_POINTS_INPUT: value }) }), {
      status: 0, stdout: '', output: `normal_prepare_points=${value || 'true'}\n`,
    });
  });
}
for (const value of ['FALSE','True','0','1',' true ','auto','null','$(printf injected)','true\nx=false']) {
  test(`invalid normal point flag ${JSON.stringify(value)} fails before service jobs`, () => {
    assert.deepEqual(execute(pointsScript, { EVENT_NAME: 'workflow_dispatch', NORMAL_PREPARE_POINTS_INPUT: value }), {
      status: 1, stdout: '::error::normal_prepare_points must be true or false\n', output: '',
    });
  });
}
for (const value of [undefined,'','true','false','invalid']) {
  test(`scheduled normal preparation stays enabled regardless of irrelevant dispatch value ${JSON.stringify(value)}`, () => {
    assert.deepEqual(execute(pointsScript, { EVENT_NAME: 'schedule', ...(value === undefined ? {} : { NORMAL_PREPARE_POINTS_INPUT: value }) }), {
      status: 0, stdout: '', output: 'normal_prepare_points=true\n',
    });
  });
}
test('normal point preparation is versioned and suite-local; Premium old fallback and security unchanged', () => {
  const input = workflow.split('      normal_prepare_points:\n')[1].split('      prepare_points:')[0];
  assert.match(input,/type: boolean/); assert.match(input,/default: true/);
  const oldInput = workflow.split('      prepare_points:\n')[1].split('      trace_snapshots:')[0];
  assert.match(oldInput,/type: boolean/); assert.match(oldInput,/default: false/);
  assert.match(pointsBlock,/NORMAL_PREPARE_POINTS_INPUT: \$\{\{ github.event.inputs.normal_prepare_points \}\}/);
  assert.doesNotMatch(pointsScript,/\$\{\{|curl|wget|playwright|npm|continue-on-error/);
  assert.ok(workflow.includes('normal_prepare_points: ${{ steps.resolve-normal-points.outputs.normal_prepare_points }}'));
  assert.match(normal,/PWAPPY_TEST_POINTS_ENABLED: \$\{\{ needs.prepare-matrix.outputs.normal_prepare_points \}\}/);
  assert.doesNotMatch(premium,/PWAPPY_TEST_POINTS_ENABLED:|normal_prepare_points/);
  assert.match(workflow.split('concurrency:')[0],/PWAPPY_TEST_POINTS_ENABLED: \$\{\{ inputs.prepare_points && 'true' \|\| vars.PWAPPY_TEST_POINTS_ENABLED \}\}/);
  assert.equal(workflow.match(/PWAPPY_TEST_POINTS_ENABLED:/g).length,2);
  for (const job of [normal,premium]) assert.match(job,/^    needs: prepare-matrix$/m);
  const inputs = workflow.split('  workflow_dispatch:\n    inputs:\n')[1].split('\n# ワークフロー')[0];
  assert.equal([...inputs.matchAll(/^      (\w+):$/gm)].length,10);
});
