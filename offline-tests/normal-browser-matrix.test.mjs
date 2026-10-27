// Offline only: execute extracted workflow scripts with synthetic inputs, never jobs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync(new URL('../.github/workflows/e2e-tests.yml', import.meta.url), 'utf8');
const filterBlock = workflow.match(/^      - name: Filter normal browser matrix\n[\s\S]*?(?=^  # ===)/m)[0];
function script(block) {
  return block.split('        run: |\n')[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
}
const filter = script(filterBlock);
function execute(source, variables = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'normal-browser-matrix-'));
  const output = join(directory, 'output');
  try {
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-c', source], {
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...variables },
      cwd: directory, encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(result.error);
    const text = existsSync(output) ? readFileSync(output, 'utf8') : '';
    return { status: result.status, stderr: result.stderr, stdout: result.stdout,
      output: Object.fromEntries(text.trim().split('\n').filter(Boolean).map(line => {
        const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)];
      })) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
function prepare(event, os, suite, schedule = '') {
  // Existing baseline scripts interpolate expressions. Substitute only fixed test data;
  // hostile selector inputs go solely through the new filter's environment.
  const expressions = { 'github.event_name': event, 'github.event.schedule': schedule,
    'inputs.os || github.event.inputs.os': os,
    'inputs.test_suite || github.event.inputs.test_suite': suite };
  const run = name => {
    const block = workflow.split(`      - name: ${name}\n`)[1].split('      - name: ')[0];
    const source = script(block).replace(/\$\{\{ (.*?) \}\}/g, (_, expression) => {
      assert.ok(Object.hasOwn(expressions, expression)); return expressions[expression];
    });
    const result = execute(source); assert.equal(result.status, 0, result.stderr);
    return result.output;
  };
  return { ...run('Determine test matrix'), ...run('Determine Test Suite Flags') };
}
function select(base, browser, event = 'workflow_dispatch') {
  return execute(filter, { EVENT_NAME: event, RUN_NORMAL: base.run_normal || '',
    BASE_MATRIX: base.matrix || '', ...(browser === undefined ? {} : { NORMAL_BROWSER_INPUT: browser }) });
}
for (const suite of ['normal', 'all', 'premium']) {
  for (const os of ['all', 'ubuntu-latest', 'windows-latest', 'macos-latest']) {
    for (const browser of [undefined, '', 'all', 'webkit', 'mobile-safari']) {
      test(`${suite} / ${os} / ${JSON.stringify(browser)}`, () => {
        const base = prepare('workflow_dispatch', os, suite);
        const original = JSON.parse(base.matrix);
        const expected = original.filter(entry => suite === 'premium' || !browser || browser === 'all' || entry.browser === browser);
        const result = select(base, browser);
        assert.equal(result.status, expected.length ? 0 : 1, result.stderr);
        if (expected.length) assert.deepEqual(JSON.parse(result.output.normal_matrix), expected);
        else { assert.match(result.stderr, /select no normal jobs/); assert.deepEqual(result.output, {}); }
        assert.equal(base.run_normal, suite === 'premium' ? undefined : 'true');
        assert.equal(base.run_premium, suite === 'normal' ? undefined : 'true');
      });
    }
  }
}
for (const schedule of ['0 0 * * *', '0 1,4,7,10,13,20,23 * * *', '0 18 * * *']) {
  test(`scheduled ${schedule} preserves baseline even with irrelevant invalid selector`, () => {
    const base = prepare('schedule', '', '', schedule);
    const result = select(base, 'invalid', 'schedule');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output.normal_matrix, base.matrix);
  });
}
for (const browser of ['chromium', 'WebKit', ' all ', 'all\nnormal_matrix=[]', '$(printf injected)', '`printf injected`', 'all; printf injected']) {
  test(`invalid selector ${JSON.stringify(browser)} fails closed only when normal requested`, () => {
    const failed = select(prepare('workflow_dispatch', 'all', 'normal'), browser);
    assert.equal(failed.status, 1); assert.deepEqual(failed.output, {});
    assert.match(failed.stderr, /normal_browser must be/); assert.doesNotMatch(failed.stdout, /injected/);
    assert.equal(select(prepare('workflow_dispatch', 'ubuntu-latest', 'premium'), browser).status, 0);
  });
}
test('unknown OS cannot start requested normal jobs', () => {
  const result = select(prepare('workflow_dispatch', 'unsupported', 'normal'), 'all');
  assert.equal(result.status, 1); assert.match(result.stderr, /select no normal jobs/);
});
test('filter preserves all entry properties rather than rebuilding runners or labels', () => {
  const entry = { os: 'macos-latest', browser: 'mobile-safari', binary: 'webkit', labels: ['keep-me'], extra: 7 };
  const result = select({ matrix: JSON.stringify([entry]), run_normal: 'true' }, 'mobile-safari');
  assert.deepEqual(JSON.parse(result.output.normal_matrix), [entry]);
});
test('safe wiring, nine inputs, no service operations, separate premium matrix', () => {
  assert.doesNotMatch(filter, /\$\{\{|curl|wget|npm|playwright/);
  assert.match(filterBlock, /NORMAL_BROWSER_INPUT: \$\{\{ inputs.normal_browser \}\}/);
  assert.match(filterBlock, /RUN_NORMAL: \$\{\{ steps.get_suite.outputs.run_normal \}\}/);
  assert.match(filterBlock, /BASE_MATRIX: \$\{\{ steps.set-matrix.outputs.matrix \}\}/);
  assert.match(workflow, /normal_matrix: \$\{\{ steps.filter-normal-matrix.outputs.normal_matrix \}\}/);
  const inputs = workflow.split('  workflow_dispatch:\n    inputs:\n')[1].split('\n# ワークフロー')[0];
  assert.equal([...inputs.matchAll(/^      (\w+):$/gm)].length, 9);
  const declaration = inputs.split('      normal_browser:\n')[1].split('      # 手動実行時のワーカー数')[0];
  assert.match(declaration, /default: "all"/); assert.match(declaration, /type: choice/);
  assert.deepEqual([...declaration.matchAll(/^          - (.+)$/gm)].map(m => m[1]), ['all', 'webkit', 'mobile-safari']);
  assert.match(workflow.split('  e2e-normal:\n')[1].split('  e2e-premium:\n')[0], /include: \$\{\{ fromJSON\(needs.prepare-matrix.outputs.normal_matrix\) \}\}/);
  assert.match(workflow.split('  e2e-premium:\n')[1], /include: \$\{\{ fromJSON\(needs.prepare-matrix.outputs.matrix\) \}\}/);
});
test('undoing browser selector and later focused-scope additions reproduces exact verified remote baseline', () => {
  // The later quick-property scope has its own executable argument-selection contracts.
  // Restore precisely that reviewed addition before checking the older immutable baseline.
  const focused = workflow.match(/^          case "\$\{TEST_SCOPE:-all\}" in\n[\s\S]*?^          esac$/m)?.[0];
  const approvedFocused = `          case "\${TEST_SCOPE:-all}" in
            all) TEST_ARGS=(tests/specs/normal) ;;
            editor-regression)
              TEST_ARGS=(tests/specs/normal/editor-events-build.spec.ts tests/specs/normal/editor-property-parsing-build.spec.ts
                --grep 'DOMContentLoaded|loadイベント|ライフサイクルイベント|グローバルなイベント委譲|JSDocの@fires') ;;
            quick-property-regression)
              TEST_ARGS=(tests/specs/normal/editor-quick-property-editor.spec.ts) ;;
            *) echo "::error::Unsupported normal test scope"; exit 1 ;;
          esac`;
  assert.equal(focused, approvedFocused, 'only the exact approved scope addition may be normalized');
  const originalScope = `          TEST_ARGS=(tests/specs/normal)
          if [ "$TEST_SCOPE" = "editor-regression" ]; then
            TEST_ARGS=(tests/specs/normal/editor-events-build.spec.ts tests/specs/normal/editor-property-parsing-build.spec.ts
              --grep 'DOMContentLoaded|loadイベント|ライフサイクルイベント|グローバルなイベント委譲|JSDocの@fires')
          fi`;
  const restored = workflow
    .replace('          - quick-property-regression\n', '')
    .replace(focused, originalScope)
    .replace(/^      normal_browser:\n[\s\S]*?(?=^      # 手動実行時のワーカー数)/m, '')
    .replace('      normal_matrix: ${{ steps.filter-normal-matrix.outputs.normal_matrix }}\n', '')
    .replace(filterBlock, '')
    .replace('include: ${{ fromJSON(needs.prepare-matrix.outputs.normal_matrix) }}', 'include: ${{ fromJSON(needs.prepare-matrix.outputs.matrix) }}');
  assert.equal(createHash('sha256').update(restored).digest('hex'), '157520974bde9d1dd380c807ad9a04a738545b37e577beea0797f05b38f711d4');
});
