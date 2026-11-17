import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mainSelection, mainInvocation} from '../scripts/run-main-verification.mjs';

const env = {GITHUB_EVENT_NAME:'workflow_dispatch', PWAPPY_TEST_POINTS_ENABLED:'true',
  TEST_SCOPE:'monaco-demand-regression', TEST_WORKERS:'1', TEST_RETRIES:'0'};

test('Monaco scope keeps fixed test paths and strict dispatch selection', () => {
  const selection = mainSelection('normal', 'webkit', 'macos-latest', env);
  assert.deepEqual(selection.testArgs.slice(0, 3), [
    'tests/specs/normal/editor-style-ownership.spec.ts',
    'tests/specs/normal/editor-ui-scripts.spec.ts',
    '--grep',
  ]);
  for (const overrides of [{TEST_WORKERS:'2'}, {TEST_RETRIES:'1'}]) {
    assert.throws(() => mainSelection('normal', 'webkit', 'macos-latest', {...env, ...overrides}));
  }
});

test('Monaco assertion is opt-in only and raw evidence stays disabled', () => {
  const selection = mainSelection('normal', 'webkit', 'macos-latest', env);
  const invoke = (s, phase) => mainInvocation(s, phase, '/tmp/fixed', env, 0).childEnv;
  assert.equal(invoke(selection, 'tests').PWAPPY_MONACO_DEMAND_REGRESSION, 'true');
  assert.equal(invoke(selection, 'cleanup').PWAPPY_MONACO_DEMAND_REGRESSION, '');
  for (const phase of ['tests', 'cleanup']) {
    assert.equal(invoke(selection, phase).PWAPPY_MAIN_DISABLE_RAW_EVIDENCE, 'true');
  }
  const scheduled = mainSelection('normal', 'webkit', 'macos-latest', {...env, GITHUB_EVENT_NAME:'schedule'});
  assert.equal(scheduled.scope, 'all');
  assert.equal(invoke(scheduled, 'tests').PWAPPY_MONACO_DEMAND_REGRESSION, '');
});
