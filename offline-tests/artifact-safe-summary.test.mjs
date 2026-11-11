import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeSummary, publishSummary } from '../scripts/artifact-safe-summary.mjs';
import { restoreApprovedArtifactSafety } from './artifact-safety-contract.mjs';

const canary = 'SYNTHETIC-SECRET-DO-NOT-UPLOAD-846163';
const base = { GITHUB_RUN_ID: '123456', GITHUB_RUN_ATTEMPT: '2',
  SAFE_TEST_SUITE: 'normal', SAFE_TEST_OS: 'macos-latest',
  SAFE_TEST_BROWSER: 'mobile-safari', SAFE_TEST_EXIT_CODE: '1' };
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'artifact-policy-test-'));
  try {
    const output = join(root, 'github-output'); writeFileSync(output, '');
    return fn({ root, output, env: { ...base, RUNNER_TEMP: root, GITHUB_OUTPUT: output } });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test('only fixed-schema scalar workflow metadata survives, never unrelated secrets', () => {
  const summary = makeSummary({ ...base, PWAPPY_TEST_LOGIN_PASSCODE: canary,
    TEST_GEMINI_API_KEY: canary, GITHUB_TOKEN: canary, Authorization: canary,
    cookies: [{ name: 'pwappy_auth', value: canary }], storageState: { cookies: [canary] } });
  assert.deepEqual(Object.keys(summary), ['schemaVersion', 'evidencePolicy', 'runId', 'runAttempt',
    'suite', 'os', 'browser', 'testExitCode', 'testProcessOutcome', 'excludedEvidence']);
  assert.doesNotMatch(JSON.stringify(summary), new RegExp(canary));
  assert.equal(summary.testProcessOutcome, 'failed');
  assert.equal(makeSummary({ ...base, SAFE_TEST_EXIT_CODE: '0' }).testProcessOutcome, 'passed');
  assert.equal(makeSummary({ ...base, SAFE_TEST_EXIT_CODE: '' }).testExitCode, null);
  assert.equal(makeSummary({ ...base, SAFE_TEST_EXIT_CODE: '' }).testProcessOutcome, 'not-recorded');
});
for (const key of Object.keys(base)) {
  for (const value of [undefined, null, {}, [], canary, '0\nverified=true', '$(cat .auth)', 'a'.repeat(100000)]) {
    test(`invalid ${key} (${typeof value}) fails closed without producing uploader outputs`, () => fixture(({ env, root, output }) => {
      assert.throws(() => publishSummary({ ...env, [key]: value }));
      assert.equal(readFileSync(output, 'utf8'), '');
      assert.deepEqual(readdirSync(root), ['github-output']);
    }));
  }
}
for (const exit of ['-1', '256', '01', '1.5', '1e2', ' 0', '0 ', 'NaN']) {
  test(`invalid exit code ${exit}`, () => assert.throws(() => makeSummary({ ...base, SAFE_TEST_EXIT_CODE: exit })));
}
test('fresh exact-file output; all hostile raw artifact formats are unconditionally excluded', () => fixture(({ env, root, output }) => {
  const raw = join(root, 'test-results'); mkdirSync(raw);
  // These are synthetic, not real credentials. Nothing in this directory is read.
  writeFileSync(join(raw, 'trace.zip'), Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from(canary)]));
  writeFileSync(join(raw, 'nested-zip-traversal.zip'), Buffer.from(`../../${canary}\0PK\x03\x04`));
  writeFileSync(join(raw, 'malformed.trace'), '{"storageState":' + canary);
  writeFileSync(join(raw, 'network.trace'), JSON.stringify({ cookies: [canary],
    Authorization: canary, 'Set-Cookie': canary, url: `https://invalid/?token=${canary}` }));
  writeFileSync(join(raw, 'screenshot.png'), Buffer.from(canary));
  writeFileSync(join(raw, 'video.webm'), Buffer.from(canary));
  writeFileSync(join(raw, 'report.html'), canary);
  writeFileSync(join(raw, 'body.json'), JSON.stringify({ password: canary }));
  writeFileSync(join(raw, 'huge.bin'), Buffer.alloc(2 * 1024 * 1024, 65));
  symlinkSync(join(root, 'missing'), join(raw, 'symlink'));
  const path = publishSummary({ ...env, TEST_RESULTS_PATH: raw, PWAPPY_TEST_LOGIN_PASSCODE: canary });
  assert.match(path, /pwappy-safe-evidence-[^/\\]+[/\\]summary\.json$/);
  assert.notEqual(path, join(raw, 'summary.json'));
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), makeSummary(base));
  assert.equal(readFileSync(output, 'utf8'), `summary_path=${path}\nverified=true\n`);
  assert.doesNotMatch(readFileSync(path, 'utf8'), new RegExp(canary));
  const path2 = publishSummary(env); assert.notEqual(path, path2, 'never reuse stale output');
}));
test('reject symlink output destinations, never append verification to an arbitrary file', () => fixture(({ env, root, output }) => {
  const link = join(root, 'output-link'); symlinkSync(output, link);
  assert.throws(() => publishSummary({ ...env, GITHUB_OUTPUT: link }));
  assert.equal(readFileSync(output, 'utf8'), '');
}));
test('CLI failure emits constant error only, no attacker metadata or paths', () => fixture(({ env, output }) => {
  const script = fileURLToPath(new URL('../scripts/artifact-safe-summary.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], {
    env: { ...env, SAFE_TEST_BROWSER: canary }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '::error::Safe artifact summary generation failed; no artifact may be uploaded.\n');
  assert.equal(readFileSync(output, 'utf8'), '');
}));
// Exercise the actual checked-in workflow environment, not a hand-written copy.
// This catches a renamed/missing SAFE_TEST_SUITE even when the generator itself
// and the uploader's fail-closed checks independently pass.
for (const suite of ['normal', 'premium']) {
  for (const exitCode of ['0', '1', '']) {
    test(`workflow-to-generator integration: ${suite}, exit ${exitCode || 'missing'}`, () => fixture(({ root, output }) => {
      const workflow = readFileSync(new URL('../.github/workflows/e2e-tests.yml', import.meta.url), 'utf8');
      const job = workflow.split(`  e2e-${suite}:\n`)[1].split(/^  [a-z][a-z0-9-]*:\n/m)[0];
      const block = job.split('      - name: Prepare safe artifact summary\n')[1].split('      - name: ')[0];
      assert.match(block, /        if: always\(\)/);
      assert.match(block, /        run: node scripts\/artifact-safe-summary\.mjs/);
      const expressions = {
        '${{ matrix.os }}': 'macos-latest',
        '${{ matrix.browser }}': 'mobile-safari',
        '${{ steps.run_tests.outputs.EXIT_CODE }}': exitCode,
      };
      const stepEnv = Object.fromEntries([...block.split('        env:\n')[1]
        .matchAll(/^          ([A-Z_a-z0-9]+): (.+)$/gm)].map(([, key, value]) => {
          if (value.includes('${{')) assert.ok(Object.hasOwn(expressions, value), 'unknown workflow expression');
          return [key, Object.hasOwn(expressions, value) ? expressions[value] : value];
        }));
      assert.deepEqual(Object.keys(stepEnv).sort(), ['SAFE_TEST_BROWSER', 'SAFE_TEST_EXIT_CODE', 'SAFE_TEST_OS', 'SAFE_TEST_SUITE']);
      assert.equal(stepEnv.SAFE_TEST_SUITE, suite);
      const script = fileURLToPath(new URL('../scripts/artifact-safe-summary.mjs', import.meta.url));
      const result = spawnSync(process.execPath, [script], {
        // Do not prefill SAFE_TEST_* here: only the real workflow provides them.
        env: { GITHUB_RUN_ID: '123456', GITHUB_RUN_ATTEMPT: '2',
          RUNNER_TEMP: root, GITHUB_OUTPUT: output, ...stepEnv },
        encoding: 'utf8', timeout: 5000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, ''); assert.equal(result.stdout, '');
      const published = readFileSync(output, 'utf8');
      assert.match(published, /\nverified=true\n$/);
      const path = published.split('\n')[0].slice('summary_path='.length);
      const summary = JSON.parse(readFileSync(path, 'utf8'));
      assert.equal(summary.suite, suite);
      assert.equal(summary.testExitCode, exitCode === '' ? null : Number(exitCode));
      assert.equal(summary.testProcessOutcome, exitCode === '' ? 'not-recorded' : exitCode === '0' ? 'passed' : 'failed');
    }));
  }
}
test('both suites upload only verified safe file, even after failure; raw evidence never uploaded', () => {
  const workflow = readFileSync(new URL('../.github/workflows/e2e-tests.yml', import.meta.url), 'utf8');
  const uploads = [...workflow.matchAll(/      - name: Upload safe workflow summary\n[\s\S]*?(?=      - name:)/g)].map(x => x[0]);
  assert.equal(uploads.length, 2);
  assert.equal((workflow.match(/uses: actions\/upload-artifact@/g) || []).length, 2);
  assert.equal((workflow.match(/run: node scripts\/artifact-safe-summary\.mjs/g) || []).length, 2);
  for (const block of uploads) {
    assert.match(block, /always\(\) && steps\.safe_artifact\.outcome == 'success' && steps\.safe_artifact\.outputs\.verified == 'true' && steps\.safe_artifact\.outputs\.summary_path != ''/);
    assert.match(block, /path: \$\{\{ steps\.safe_artifact\.outputs\.summary_path \}\}/);
    assert.match(block, /if-no-files-found: error/);
    assert.doesNotMatch(block, /test-results|playwright-report|\.auth|\*|continue-on-error/);
  }
  const restored = restoreApprovedArtifactSafety(workflow);
  assert.equal((restored.match(/path: test-results\//g) || []).length, 2);
  assert.throws(() => restoreApprovedArtifactSafety(workflow.replace('if-no-files-found: error', 'if-no-files-found: ignore')));
  const source = readFileSync(new URL('../scripts/artifact-safe-summary.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\(|https?:\/\/|child_process|execSync|unzip|extract|process\.env\.[A-Z_]*(?:TOKEN|SECRET|PASSCODE)/);
});
