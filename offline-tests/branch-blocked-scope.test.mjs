import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { verificationPlan, BLOCKED_FIREFOX_REASON } from '../scripts/branch-verification-plan.mjs';
import { invocation, run } from '../scripts/run-branch-verification.mjs';

const workflow = readFileSync(new URL('../.github/workflows/webmcp-branch-verification.yml', import.meta.url), 'utf8');
test('fixed plan preserves ten existing suites and records both blocked Firefox suites', () => {
  const { matrix, blocked } = verificationPlan();
  assert.equal(matrix.length, 10);
  assert.deepEqual([matrix[0].suite, matrix[0].os, matrix[0].browser], ['normal', 'macos-latest', 'webkit']);
  assert.equal(new Set(matrix.map(row => `${row.suite}/${row.os}/${row.browser}`)).size, 10);
  for (const suite of ['normal', 'premium']) {
    assert.deepEqual(matrix.filter(row => row.suite === suite).map(row => `${row.os}/${row.browser}`).sort(), [
      'ubuntu-latest/chromium', 'ubuntu-latest/mobile-chrome', 'windows-latest/chromium',
      'macos-latest/webkit', 'macos-latest/mobile-safari',
    ].sort());
    for (const row of matrix.filter(row => row.suite === suite)) {
      assert.equal(row.runner, suite === 'premium' ? row.os : row.os === 'macos-latest' ? 'macos-26-intel' : row.os);
    }
  }
  assert.deepEqual(blocked, ['normal', 'premium'].map(suite => ({ suite, os: 'ubuntu-latest', browser: 'firefox',
    status: 'blocked', reason: BLOCKED_FIREFOX_REASON })));
});

test('direct Firefox tests and cleanup stop before guard, network, key checks or spawn', async () => {
  for (const suite of ['normal', 'premium']) for (const phase of ['tests', 'cleanup']) {
    assert.throws(() => invocation(suite, 'firefox', 'ubuntu-latest', phase, '/unused', {}), /Firefox staging account authorization/);
    const forbidden = () => assert.fail('blocked selection must perform no operation');
    await assert.rejects(run(suite, 'firefox', 'ubuntu-latest', phase, {}, {
      guard: forbidden, premiumKeyCheck: forbidden, spawn: forbidden,
    }), /Firefox staging account authorization/);
  }
});

test('workflow carries blocked count, visible records and executes all runnable suites serially', () => {
  assert.match(workflow, /blocked_count: \$\{\{ steps.matrix.outputs.blocked_count \}\}/);
  assert.match(workflow, /blocked_count=\$\{blocked.length\}/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
  assert.match(workflow, /BLOCKED \(not run\)/);
  assert.match(workflow, /BLOCKED_COUNT: \$\{\{ needs.preflight.outputs.blocked_count \}\}/);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /max-parallel: 1/);
});

test('actual final shell gate fails for blocked or missing counts even when runnable suites pass', () => {
  const gate = workflow.split('  verification-result:')[1].split('        run: |\n')[1]
    .split('\n').map(line => line.replace(/^          /, '')).join('\n');
  for (const count of ['2', '', 'invalid']) {
    const result = spawnSync('bash', ['-c', gate], { encoding: 'utf8',
      env: { PREFLIGHT_RESULT: 'success', VERIFICATION_RESULT: 'success', BLOCKED_COUNT: count } });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /coverage is blocked and was not run/);
    assert.doesNotMatch(result.stdout, /Configured branch suites passed/);
  }
  for (const result of ['failure', 'cancelled', 'skipped', '']) {
    assert.equal(spawnSync('bash', ['-c', gate], { env: {
      PREFLIGHT_RESULT: 'success', VERIFICATION_RESULT: result, BLOCKED_COUNT: '0',
    } }).status, 1);
  }
  assert.equal(spawnSync('bash', ['-c', gate], { env: {
    PREFLIGHT_RESULT: 'success', VERIFICATION_RESULT: 'success', BLOCKED_COUNT: '0',
  } }).status, 0);
});
