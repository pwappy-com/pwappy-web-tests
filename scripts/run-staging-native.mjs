// Stage-only explicit entry point. No dotenv and no raw output/artifacts.
import { mkdtempSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { guard } from './branch-verification-guard.mjs';
import { invocation, readCounts } from './run-branch-verification.mjs';
const require = createRequire(import.meta.url);
const { validateDiagnostic, validateCleanup, validateBlockedDiagnostic, REQUEST_PHASES } = require('./staging-startup-diagnostic.cjs');
export const PHASES = REQUEST_PHASES.filter(phase => phase !== 'unknown');
async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
export function nativeInvocation(env, root, port, token) {
  if (env.TEST_SUITE !== 'normal' || env.TEST_BROWSER !== 'chromium' || env.TEST_OS !== 'ubuntu-latest'
      || !/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID || '')
      || !/^[1-9][0-9]{0,7}$/.test(env.GITHUB_RUN_ATTEMPT || '')
      || !env.PWAPPY_TEST_LOGIN_PASSCODE || !env.GITHUB_OUTPUT
      || !Number.isInteger(port) || port < 1024 || port > 65535 || !/^[0-9a-f]{32}$/.test(token)) {
    throw Error('Invalid native staging selection');
  }
  const { childEnv } = invocation('normal', 'chromium', 'ubuntu-latest', 'tests', root, env);
  // Reuse normal/Linux/Chromium identity and PP-preparation receipt, never a new account.
  Object.assign(childEnv, { PWAPPY_STAGING_NATIVE_GUARDED: 'true', PWAPPY_STAGING_NATIVE_PORT: String(port),
    PWAPPY_STAGING_NATIVE_CLEANUP_PATH: join(root, 'cleanup-outcome.json'),
    PWAPPY_STAGING_NATIVE_BLOCKED_PATH: join(root, 'blocked-diagnostic.json'),
    PWAPPY_STAGING_NATIVE_DIAGNOSTIC_PATH: join(root, 'startup-diagnostic.json'),
    PWAPPY_STAGING_NATIVE_TOKEN: token, PWAPPY_STAGING_NATIVE_PHASE_PATH: join(root, 'phase.json') });
  return { childEnv, args: [require.resolve('@playwright/test/cli'), 'test', '--config=playwright.staging-native.config.ts', '--workers=1', '--retries=0'] };
}
export async function run(env = process.env, dependencies = {}) {
  await (dependencies.guard || guard)('normal', env);
  const root = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'pwappy-staging-native-'));
  const { childEnv, args } = nativeInvocation(env, root, await (dependencies.unusedPort || unusedPort)(), randomBytes(16).toString('hex'));
  writeFileSync(childEnv.PWAPPY_STAGING_NATIVE_PHASE_PATH, JSON.stringify('native-preflight'), { mode: 0o600 });
  const result = (dependencies.spawn || spawnSync)(process.execPath, args, { env: childEnv, stdio: 'ignore' });
  const exit = Number.isInteger(result.status) && result.status >= 0 && result.status <= 255 ? result.status : 1;
  appendFileSync(env.GITHUB_OUTPUT, `EXIT_CODE=${exit}\n`);
  const counts = readCounts(childEnv.PWAPPY_BRANCH_COUNTS_PATH);
  let phase = 'not-started';
  try { const value = JSON.parse(readFileSync(childEnv.PWAPPY_STAGING_NATIVE_PHASE_PATH, 'utf8')); if (PHASES.includes(value)) phase = value; } catch {}
  console.log(`Native staging: phase=${phase} passed=${counts.passed} failed=${counts.failed} skipped=${counts.skipped} timedOut=${counts.timedOut} interrupted=${counts.interrupted}; exit=${exit}`);
  let cleanup = null;
  try {
    const raw = readFileSync(childEnv.PWAPPY_STAGING_NATIVE_CLEANUP_PATH, 'utf8');
    if (raw.length <= 1024) cleanup = validateCleanup(JSON.parse(raw));
  } catch {}
  console.log(`Native cleanup: ${cleanup ? JSON.stringify(cleanup) : 'unknown'}`);
  let blocked = null;
  try {
    const raw = readFileSync(childEnv.PWAPPY_STAGING_NATIVE_BLOCKED_PATH, 'utf8');
    if (raw.length <= 16384) blocked = validateBlockedDiagnostic(JSON.parse(raw));
  } catch {}
  console.log(`Native blocked requests: ${blocked ? JSON.stringify(blocked) : 'unavailable'}`);
  if (phase === 'editor-startup') {
    let diagnostic = null;
    try {
      const raw = readFileSync(childEnv.PWAPPY_STAGING_NATIVE_DIAGNOSTIC_PATH, 'utf8');
      if (raw.length <= 8192) diagnostic = validateDiagnostic(JSON.parse(raw));
    } catch {}
    if (diagnostic) console.log(`Native startup diagnostic: ${JSON.stringify(diagnostic)}`);
    else console.log('Native startup diagnostic: unavailable');
  }
  if (phase === 'native-preflight') console.error('::error::Native Chrome CDP WebMCP is required. Check Chrome installation/version; no adapter fallback is used.');
  return exit || (counts.passed !== 1 || counts.failed + counts.timedOut + counts.interrupted + counts.skipped > 0 || phase !== 'complete' ? 1 : 0);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await run(); }
  catch { console.error('::error::Native staging verification stopped before a verified result; raw test data is not published.'); process.exitCode = 1; }
}
