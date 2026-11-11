// Offline only: extracted Bash/Node scripts use synthetic inputs and a stubbed npx.
// Never dispatch Actions, import dotenv, load authentication, or contact a service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mainPushCiEdits, restoreApprovedMainPushCi } from './main-push-ci-contract.mjs';

const workflow = readFileSync(new URL('../.github/workflows/e2e-tests.yml', import.meta.url), 'utf8');
const matrix = [
  { os: 'ubuntu-latest', browser: 'chromium', binary: 'chromium' },
  { os: 'ubuntu-latest', browser: 'mobile-chrome', binary: 'chromium' },
  { os: 'windows-latest', browser: 'chromium', binary: 'chromium' },
  { os: 'macos-latest', browser: 'webkit', binary: 'webkit' },
  { os: 'macos-latest', browser: 'mobile-safari', binary: 'webkit' },
];
function block(name, source = workflow) {
  const result = source.split(`      - name: ${name}\n`)[1]?.split(/^      - name: /m)[0];
  assert.ok(result, `workflow step exists: ${name}`);
  return result;
}
function script(name, expressions = {}) {
  const source = block(name).split('        run: |\n')[1]?.split(/^        env:\n/m)[0];
  assert.ok(source, `workflow step has script: ${name}`);
  // Remove trailing YAML comments/blank lines outside the indented script.
  return source.split('\n').filter(line => line.startsWith('          ') || !line.trim())
    .map(line => line.replace(/^          /, '')).join('\n')
    .replace(/\$\{\{ (.*?) \}\}/g, (_, expression) => {
      assert.ok(Object.hasOwn(expressions, expression), `known fixed expression: ${expression}`);
      return expressions[expression];
    });
}
function execute(source, variables = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'main-push-ci-'));
  const output = join(directory, 'output');
  try {
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-c', source], {
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...variables },
      cwd: directory, encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(result.error);
    const text = existsSync(output) ? readFileSync(output, 'utf8') : '';
    return { status: result.status, stdout: result.stdout, stderr: result.stderr,
      output: Object.fromEntries(text.trim().split('\n').filter(Boolean).map(line => {
        const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)];
      })) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
function prepare(event, { os = '', suite = '', schedule = '' } = {}) {
  const expressions = { 'github.event_name': event, 'github.event.schedule': schedule,
    'inputs.os || github.event.inputs.os': os,
    'inputs.test_suite || github.event.inputs.test_suite': suite };
  const results = ['Determine test matrix', 'Determine Test Suite Flags'].map(name => {
    const result = execute(script(name, expressions));
    assert.equal(result.status, 0, result.stderr);
    return result.output;
  });
  return Object.assign({}, ...results);
}

test('only main pushes start automatic CI; schedules and manual dispatch remain', () => {
  const triggers = workflow.split('\non:\n')[1].split('\n# ワークフローを構成するジョブ')[0];
  assert.deepEqual([...triggers.matchAll(/^  ([a-z_]+):$/gm)].map(match => match[1]),
    ['push', 'schedule', 'workflow_dispatch']);
  assert.match(triggers, /^  push:\n    branches:\n      - main\n  # 定期実行/m);
  assert.doesNotMatch(triggers, /branches-ignore:|paths:|paths-ignore:|tags:|pull_request|workflow_run/);
  assert.deepEqual([...triggers.matchAll(/^    - cron: "(.*)"$/gm)].map(match => match[1]),
    ['0 1,4,7,10,13,20,23 * * *', '0 18 * * *', '0 0 * * *']);
});

for (const inputs of [{}, { os: 'ubuntu-latest', suite: 'normal' }, { os: 'macos-latest', suite: 'premium' }]) {
  test(`main push always enables both suites and all five jobs per suite: ${JSON.stringify(inputs)}`, () => {
    const prepared = prepare('push', inputs);
    assert.deepEqual(Object.keys(prepared).sort(), ['matrix', 'run_normal', 'run_premium']);
    assert.equal(prepared.run_normal, 'true');
    assert.equal(prepared.run_premium, 'true');
    assert.deepEqual(JSON.parse(prepared.matrix), matrix);
    const filtered = execute(script('Filter normal browser matrix'), {
      EVENT_NAME: 'push', NORMAL_BROWSER_INPUT: 'invalid', RUN_NORMAL: prepared.run_normal,
      BASE_MATRIX: prepared.matrix,
    });
    assert.equal(filtered.status, 0, filtered.stderr);
    assert.equal(filtered.output.normal_matrix, prepared.matrix);
  });
}

for (const [schedule, indexes, suite] of [
  ['0 0 * * *', [0, 1, 2, 3, 4], 'premium'],
  ['0 1,4,7,10,13,20,23 * * *', [0, 1], 'normal'],
  ['0 18 * * *', [2, 3, 4], 'normal'],
]) {
  test(`schedule ${schedule} preserves its exact matrix and single suite`, () => {
    const prepared = prepare('schedule', { schedule });
    assert.deepEqual(JSON.parse(prepared.matrix), indexes.map(i => matrix[i]));
    assert.deepEqual(Object.keys(prepared).sort(), ['matrix', `run_${suite}`]);
    assert.equal(prepared[`run_${suite}`], 'true');
  });
}

for (const suite of ['normal', 'premium', 'all']) {
  for (const [os, indexes] of [
    ['all', [0, 1, 2, 3, 4]], ['ubuntu-latest', [0, 1]], ['windows-latest', [2]], ['macos-latest', [3, 4]],
  ]) {
    test(`manual ${suite}/${os} preserves selection`, () => {
      const prepared = prepare('workflow_dispatch', { os, suite });
      assert.deepEqual(JSON.parse(prepared.matrix), indexes.map(i => matrix[i]));
      assert.equal(prepared.run_normal, suite === 'premium' ? undefined : 'true');
      assert.equal(prepared.run_premium, suite === 'normal' ? undefined : 'true');
    });
  }
}

test('push keeps bounded parallelism, enabled points and per-suite traces independent of manual inputs', () => {
  const cases = [
    ['Validate normal matrix parallelism', { MATRIX_PARALLELISM_INPUT: '5' }, { matrix_parallelism: '2' }],
    ['Resolve normal point preparation', { NORMAL_PREPARE_POINTS_INPUT: 'false' }, { normal_prepare_points: 'true' }],
    ['Resolve premium point preparation', { PREMIUM_PREPARE_POINTS_INPUT: 'false' }, { premium_prepare_points: 'true' }],
    ['Resolve suite trace snapshots', { TRACE_SNAPSHOTS_INPUT: 'invalid' },
      { normal_trace_snapshots: 'false', premium_trace_snapshots: 'true' }],
  ];
  for (const [name, variables, expected] of cases) {
    const result = execute(script(name), { EVENT_NAME: 'push', ...variables });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.output, expected);
  }
  const normal = workflow.split('  e2e-normal:\n')[1].split('  e2e-premium:\n')[0];
  const premium = workflow.split('  e2e-premium:\n')[1];
  assert.match(normal, /^      max-parallel: \$\{\{ fromJSON\(needs.prepare-matrix.outputs.matrix_parallelism\) \}\}$/m);
  assert.match(premium, /^      max-parallel: 1$/m);
  for (const [suite, job] of [['normal', normal], ['premium', premium]]) {
    assert.ok(job.includes(`PWAPPY_TEST_POINTS_ENABLED: \${{ needs.prepare-matrix.outputs.${suite}_prepare_points }}`));
    assert.match(job, /^    timeout-minutes: 120$/m);
  }
});

for (const suite of ['Normal', 'Premium']) {
  test(`push runs the full ${suite} command with one worker and zero retries, without running Playwright`, () => {
    const name = `Run ${suite} E2E Tests`;
    const runBlock = block(name);
    assert.match(runBlock, /TEST_RETRIES: \$\{\{ inputs.retries \|\| '0' \}\}/);
    if (suite === 'Normal') assert.match(runBlock, /TEST_SCOPE: \$\{\{ inputs.test_scope \|\| 'all' \}\}/);
    const source = script(name, { 'inputs.test_scope': '', 'matrix.browser': 'chromium', 'matrix.os': 'ubuntu-latest' });
    // Functions shadow every external test command; uname avoids optional Mac diagnostics.
    const stubs = 'npx() { printf "ARG=%s\\n" "$@"; };\nuname() { printf "Linux\\n"; };\n';
    const result = execute(stubs + source, { EVENT_NAME: 'push', TEST_WORKERS: '75%', TEST_RETRIES: '0', TEST_SCOPE: 'all' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.output, { EXIT_CODE: '0' });
    assert.deepEqual(result.stdout.split('\n').filter(line => line.startsWith('ARG=')), [
      'ARG=playwright', 'ARG=test', `ARG=tests/specs/${suite.toLowerCase()}`, 'ARG=--project=chromium',
      'ARG=--reporter=line', 'ARG=--workers=1', 'ARG=--retries=0',
    ]);
  });
}

function assertPreviousWorkflow(source) {
  const restored = restoreApprovedMainPushCi(source);
  const hash = createHash('sha1').update('blob ' + Buffer.byteLength(restored) + '\0').update(restored).digest('hex');
  assert.equal(hash, '915228b40569c83bdd1b0e8db6ef966360c67568');
}
test('only reviewed push and credential-protection additions change; prior scheduling and job budgets remain byte-identical', () => {
  assert.equal(mainPushCiEdits.length, 3);
  assertPreviousWorkflow(workflow);
  for (const { before, after } of mainPushCiEdits) {
    assert.throws(() => assertPreviousWorkflow(workflow.replace(after, before)));
    assert.throws(() => assertPreviousWorkflow(workflow.replace(after, after + after)));
  }
  for (const [before, after] of [
    ['      - main\n', '      - "**"\n'],
    ['run_premium=true', 'run_premium=false'],
    ['max-parallel: 1', 'max-parallel: 5'],
    ['if-no-files-found: error', 'if-no-files-found: ignore'],
    ['          path: ${{ steps.safe_artifact.outputs.summary_path }}', '          path: .auth/'],
    ['cancel-in-progress: false', 'cancel-in-progress: true'],
    ['contents: read', 'contents: write'],
    ['timeout-minutes: 120', 'timeout-minutes: 240'],
    ["--workers=1 --retries=\"$RETRIES\"", "--workers=2 --retries=\"$RETRIES\""],
  ]) {
    assert.ok(workflow.includes(before));
    assert.throws(() => assertPreviousWorkflow(workflow.replace(before, after)));
  }
});
