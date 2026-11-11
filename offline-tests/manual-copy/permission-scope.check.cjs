'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..');

test('clipboard permission is Chromium-only, write-only, editor-origin-scoped and local to the manual test', () => {
  const source = fs.readFileSync(path.join(repo, 'tests/specs/premium/agent-flow.spec.ts'), 'utf8');
  const start = source.indexOf("test('手動実行モード：プロンプトのコピーと応答の貼り付けUI'");
  assert(start >= 0);
  const end = source.indexOf("\n    test('", start + 1);
  assert(end > start);
  const target = source.slice(start, end);
  const others = source.slice(0, start) + source.slice(end);
  assert(!others.includes('grantPermissions'));
  assert.match(target, /async \(\{ editorPage, context, browserName \}\)/);
  assert.match(target, /if \(browserName === 'chromium'\) \{\s*await context\.grantPermissions\(\['clipboard-write'\], \{ origin: new URL\(editorPage\.url\(\)\)\.origin \}\);\s*\}/);
  assert(target.indexOf('test.skip(') < target.indexOf('grantPermissions'));
  assert(!target.includes('clipboard-read'));
  assert.equal((target.match(/grantPermissions/g) || []).length, 1);
  assert.match(target, /await copyBtn\.click\(\);\s*await expect\(copyBtn\)\.toContainText\('コピー完了'\)/);
  assert.match(target, /await expect\(manualUI\)\.toBeHidden\(\)/);
});

test('internal browser runner refuses normal direct invocation before launching a browser', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'run.cjs')], {
    env: { PATH: process.env.PATH || '/usr/bin:/bin' }, encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Use run-isolated\.cjs/);
});
