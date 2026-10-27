// Offline config contract only; no Playwright, dotenv, browser, or network imports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/e2e-tests.yml', import.meta.url), 'utf8');
// Evaluate the actual config, replacing only external imports and export syntax.
const executable = source.replace(/^import .*;\r?\n/gm, '')
  .replace('export default defineConfig(', 'globalThis.config = defineConfig(');
function config(env = {}, platform = 'darwin') {
  const context = { process: { env: { ...env }, platform },
    defineConfig: value => value, devices: {}, getStorageStatePath: (...args) => args.join('-') };
  vm.runInNewContext(executable, context);
  return JSON.parse(JSON.stringify(context.config));
}

for (const [label, value, expected] of [
  ['missing', undefined, true], ['empty (scheduled)', '', true],
  ['explicit true', 'true', true], ['explicit false', 'false', false],
]) {
  test(`${label}: retains mode and maps snapshots to ${expected}`, () => {
    const env = value === undefined ? {} : { PWAPPY_TRACE_SNAPSHOTS: value };
    assert.deepEqual(config(env).use.trace, { mode: 'retain-on-failure', snapshots: expected });
  });
}

for (const value of ['FALSE', 'True', '0', '1', 'no', ' false ', 'null']) {
  test(`invalid ${JSON.stringify(value)} fails closed instead of silently disabling evidence`, () => {
    assert.throws(() => config({ PWAPPY_TRACE_SNAPSHOTS: value }), /PWAPPY_TRACE_SNAPSHOTS must be true or false/);
  });
}

test('only snapshots changes across A/B, including CI and cleanup config', () => {
  for (const env of [{}, { CI: 'true' }, { CI: 'true', PWAPPY_TEST_POINTS_PHASE: 'cleanup', TEST_WORKER_INDEX: '2' }]) {
    const a = config({ ...env, PWAPPY_TRACE_SNAPSHOTS: 'true' });
    const b = config({ ...env, PWAPPY_TRACE_SNAPSHOTS: 'false' });
    b.use.trace.snapshots = true;
    assert.deepEqual(a, b);
    assert.equal(a.use.screenshot, 'only-on-failure');
    assert.equal(a.retries, env.PWAPPY_TEST_POINTS_PHASE ? 0 : env.CI ? 5 : 0);
    assert.equal(a.workers, env.PWAPPY_TEST_POINTS_PHASE ? 1 : undefined);
    assert.equal(a.use.video, env.CI ? 'off' : 'retain-on-failure');
    assert.deepEqual(Object.keys(a.use.trace).sort(), ['mode', 'snapshots']);
  }
});

test('workflow input is boolean, defaults true, and global env passes the event string without truthy fallback', () => {
  const declaration = workflow.match(/^      trace_snapshots:\n((?:        .*\n)+)/m)?.[1];
  assert.ok(declaration);
  assert.match(declaration, /^        type: boolean$/m);
  assert.match(declaration, /^        default: true$/m);
  const mapping = workflow.match(/^  PWAPPY_TRACE_SNAPSHOTS: (.*)$/m)?.[1];
  assert.equal(mapping, '${{ github.event.inputs.trace_snapshots }}');
  assert.equal(workflow.match(/PWAPPY_TRACE_SNAPSHOTS:/g)?.length, 1, 'no step/job override');
  // GitHub event.inputs converts dispatch booleans to strings; absent property resolves empty.
  // This tests the documented transport contract, not the hosted GitHub expression engine.
  for (const [event, expected] of [
    [{ inputs: { trace_snapshots: 'true' } }, true],
    [{ inputs: { trace_snapshots: 'false' } }, false],
    [{ inputs: {} }, true], [{ schedule: '0 18 * * *' }, true],
  ]) {
    assert.equal(config({ PWAPPY_TRACE_SNAPSHOTS: event.inputs?.trace_snapshots ?? '' }).use.trace.snapshots, expected);
  }
});
