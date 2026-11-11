'use strict';
// This is a Node test, not a Playwright *.spec/test file. Never run live suites
// to validate discovery: only --list against credential-free temporary copies.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { childEnvironment } = require('./webmcp/isolation-options.cjs');

const repoRoot = path.resolve(__dirname, '../..');
let root;
let env;
const projects = ['chromium', 'firefox', 'webkit', 'mobile-chrome', 'mobile-safari'];
const cleanup = 'tools/a0-cleanup-all-apps.spec.ts';

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pwappy-discovery-'));
  for (const name of ['playwright.config.ts', 'playwright.webmcp.config.ts', 'playwright.staging-native.config.ts', 'package.json']) {
    fs.copyFileSync(path.join(repoRoot, name), path.join(root, name));
  }
  fs.cpSync(path.join(repoRoot, 'tests'), path.join(root, 'tests'), {
    recursive: true,
    filter(source) {
      const stat = fs.lstatSync(source);
      return !stat.isSymbolicLink() && (stat.isDirectory() || /\.(?:ts|cjs|mjs)$/.test(source));
    },
  });
  for (const name of ['staging-tests', 'scripts']) {
    fs.cpSync(path.join(repoRoot, name), path.join(root, name), { recursive: true,
      filter(source) { const stat = fs.lstatSync(source); return !stat.isSymbolicLink() && (stat.isDirectory() || /\.(?:ts|cjs|mjs|json)$/.test(source)); } });
  }
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  assert.equal(fs.existsSync(path.join(root, '.env')), false);
  assert.equal(fs.existsSync(path.join(root, '.auth')), false);
  const guard = path.join(root, 'no-network.cjs');
  fs.writeFileSync(guard, `
'use strict';
const deny = () => { throw new Error('Network access/listening is forbidden during discovery'); };
for (const name of ['node:http', 'node:https']) {
  const api = require(name); api.request = deny; api.get = deny;
}
const net = require('node:net');
net.connect = deny; net.createConnection = deny;
net.Socket.prototype.connect = deny; net.Server.prototype.listen = deny;
require('node:tls').connect = deny;
globalThis.fetch = deny;
require('node:module').syncBuiltinESMExports();
`);
  env = childEnvironment();
  env.NODE_OPTIONS = `--require=${guard}`;
  env.DOTENV_CONFIG_PATH = path.join(root, 'absent.env');
});

after(() => {
  // Only this check's newly created temporary copy is removed.
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

function list(config, selectors = []) {
  const args = [require.resolve('@playwright/test/cli'), 'test', '--config', config,
    '--list', '--reporter=json', ...selectors];
  const result = spawnSync(process.execPath, args, {
    cwd: root, env, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.errors, []);
  const entries = [];
  function visit(suite) {
    for (const spec of suite.specs || []) {
      for (const item of spec.tests) {
        assert.deepEqual(item.results, [], 'Discovery must not execute any test');
        entries.push({ file: spec.file.replaceAll('\\', '/'), project: item.projectName, title: spec.title });
      }
    }
    for (const child of suite.suites || []) visit(child);
  }
  for (const suite of report.suites) visit(suite);
  assert.ok(entries.length > 0, 'Expected a nonempty test inventory');
  return entries;
}

test('default discovery excludes isolated WebMCP and preserves all five live projects plus cleanup', () => {
  const entries = list('playwright.config.ts');
  assert.deepEqual([...new Set(entries.map(item => item.project))].sort(), [...projects].sort());
  assert.ok(entries.every(item => !item.file.startsWith('specs/webmcp/')));
  assert.ok(entries.every(item => !item.file.endsWith('.test.mjs')), 'Node-only tests must not execute during Playwright collection');
  for (const project of projects) {
    const scoped = entries.filter(item => item.project === project);
    assert.ok(scoped.some(item => item.file.startsWith('specs/normal/')));
    assert.ok(scoped.some(item => item.file.startsWith('specs/premium/')));
    assert.equal(scoped.filter(item => item.file === cleanup).length, 1);
  }
  console.log(`Default inventory: ${entries.length} entries; no WebMCP; cleanup retained in all five projects.`);
});

test('existing CI normal/premium selectors retain their own suites without cleanup or WebMCP', () => {
  for (const kind of ['normal', 'premium']) {
    const entries = list('playwright.config.ts', [`tests/specs/${kind}`, '--project=chromium']);
    assert.ok(entries.every(item => item.project === 'chromium' && item.file.startsWith(`specs/${kind}/`)));
    console.log(`CI ${kind} Chromium inventory: ${entries.length} entries.`);
  }
});

test('existing explicit CI cleanup selector still discovers only the intended cleanup', () => {
  const entries = list('playwright.config.ts', [`tests/${cleanup}`, '--project=chromium']);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].file, cleanup);
  assert.equal(entries[0].project, 'chromium');
});

test('dedicated configuration discovers only WebMCP cases without live suites or cleanup', () => {
  const entries = list('playwright.webmcp.config.ts');
  // Dedicated testDir makes JSON paths relative to tests/specs/webmcp.
  for (const item of entries) {
    assert.ok(!item.file.startsWith('../') && !item.file.includes('/normal/') && !item.file.includes('/premium/'));
    assert.ok(fs.existsSync(path.join(root, 'tests/specs/webmcp', item.file)));
    assert.notEqual(item.file, cleanup);
  }
  assert.ok(entries.some(item => item.file === 'external-authoring-lifecycle.spec.ts'));
  assert.ok(entries.some(item => item.file === 'persistence-recovery.spec.ts'));
  console.log(`Dedicated WebMCP inventory: ${entries.length} entries; no live suites or cleanup.`);
});

test('live native staging discovery is separate, credential-free and never default-selected', () => {
  const entries = list('playwright.staging-native.config.ts');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].file, 'native-persistence.spec.ts');
  assert.equal(entries[0].project, 'staging-native-chrome');
  assert.ok(list('playwright.config.ts').every(item => !item.file.includes('native-persistence')));
});
