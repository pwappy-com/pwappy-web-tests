'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { parseOptions, childEnvironment } = require('./isolation-options.cjs');
const repoRoot = path.resolve(__dirname, '../../..');
let child;
function run(command, args, env) {
  return new Promise((resolve, reject) => {
    child = spawn(command, args, { cwd: repoRoot, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => { child = undefined; code === 0 ? resolve() : reject(new Error(`Process failed (${signal || code}): ${path.basename(command)}`)); });
  });
}
async function main() {
  const options = parseOptions(process.argv.slice(2), repoRoot);
  const env = childEnvironment();
  const cli = require.resolve('@playwright/test/cli');
  const args = [cli, 'test', '--config', path.join(repoRoot, options.firefoxUI ? 'playwright.webmcp-firefox.config.ts' : 'playwright.webmcp.config.ts')];
  if (options.grep) args.push('--grep', options.grep);
  if (options.list) { args.push('--list'); await run(process.execPath, args, env); return; }
  if (options.headed) args.push('--headed');
  const lock = path.join(os.tmpdir(), 'pwappy-webmcp-isolated.lock');
  let lockHandle;
  try { lockHandle = fs.openSync(lock, 'wx'); }
  catch { throw new Error(`Another isolated run may be active: ${lock}. Do not remove an unverified lock.`); }
  fs.writeFileSync(lockHandle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const stop = () => { child?.kill('SIGTERM'); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pwappy-webmcp-run-'));
    const runName = path.basename(root), buildDir = path.join(root, 'build');
    const output = path.join(repoRoot, 'test-results', runName);
    fs.mkdirSync(output, { recursive: true });
    env.PWAPPY_WEBMCP_BUILD_DIR = buildDir;
    env.PWAPPY_WEBMCP_OUTPUT_DIR = output;
    env.PWAPPY_WEBMCP_REPORT_DIR = path.join(repoRoot, 'playwright-report', runName);
    env.PWAPPY_WEBMCP_PREVIEW_BASE_URL = 'http://127.0.0.1:8093/';
    if (process.env.PWAPPY_WEBMCP_PLUGIN_DIR) env.PWAPPY_WEBMCP_PLUGIN_DIR = fs.realpathSync(process.env.PWAPPY_WEBMCP_PLUGIN_DIR);
    await run(process.execPath, [path.join(__dirname, 'build-isolated.cjs'), options.appRoot, buildDir], env);
    console.log(`Isolated report: ${env.PWAPPY_WEBMCP_REPORT_DIR}`);
    console.log(`Isolated build retained: ${buildDir}`);
    try { await run(process.execPath, args, env); }
    finally {
      // Playwright clears outputDir at startup, so preserve the build evidence
      // after the test process exits, including failed runs.
      fs.mkdirSync(output, { recursive: true });
      fs.copyFileSync(path.join(buildDir, 'isolated-build-manifest.json'), path.join(output, 'build-manifest.json'));
    }
  } finally {
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    fs.closeSync(lockHandle); fs.unlinkSync(lock);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
