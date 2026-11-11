// Authenticated entry point: recheck the public marker before each test/cleanup process.
import { appendFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { guard, MATRIX, POINTS_ENDPOINT } from './branch-verification-guard.mjs';
const require = createRequire(import.meta.url);
const { sourceLocations } = require('./branch-safe-locations.cjs');
export function invocation(suite, browser, os, phase, root, env) {
  const entry = MATRIX.find(item => item.browser === browser && item.os === os);
  if (!entry || !['normal', 'premium'].includes(suite) || !['tests', 'cleanup'].includes(phase)) {
    throw new Error('Invalid branch test selection');
  }
  const childEnv = { ...env, CI: 'true', TEST_RUN_SUFFIX: entry.suffix,
    PWAPPY_TEST_ACCOUNT_INDEX: '0', PWAPPY_TEST_CLEANUP_BROWSER_CODE: entry.code,
    PWAPPY_TEST_POINTS_ENABLED: 'true', PWAPPY_TEST_POINTS_PHASE: phase,
    PWAPPY_TEST_POINTS_READ_ENDPOINT: POINTS_ENDPOINT,
    PWAPPY_TEST_RUN_ID: `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}-${suite}`,
    PWAPPY_FULL_BRANCH_VERIFICATION: 'true', TEST_GEMINI_API_KEY: 'AIza_TEST_ONLY_WEBMCP',
    PWAPPY_LOGIN: '1', PWAPPY_TEST_USER_PREFIX: 'pwusr',
    DOTENV_CONFIG_PATH: join(root, 'absent.env'),
    PWAPPY_BRANCH_OUTPUT_DIR: join(root, 'results'), PWAPPY_BRANCH_COUNTS_PATH: join(root, 'counts.json'),
    PWAPPY_BRANCH_FAILURES_PATH: join(root, 'failures.json') };
  return { childEnv, args: [require.resolve('@playwright/test/cli'), 'test',
    phase === 'tests' ? `tests/specs/${suite}` : 'tests/tools/a0-cleanup-all-apps.spec.ts',
    '--config=playwright.branch.config.ts', `--project=${browser}`, '--workers=1', '--retries=0'] };
}
export function readCounts(path) {
  const counts = JSON.parse(readFileSync(path, 'utf8'));
  if (Object.keys(counts).sort().join(',') !== 'failed,interrupted,passed,skipped,timedOut'
      || Object.values(counts).some(value => !Number.isSafeInteger(value) || value < 0 || value > 100000)) {
    throw new Error('Invalid branch test counts');
  }
  return counts;
}
export async function run(suite, browser, os, phase, env = process.env, dependencies = {}) {
  await (dependencies.guard || guard)(suite, env);
  if (!/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID) || !/^[1-9][0-9]{0,7}$/.test(env.GITHUB_RUN_ATTEMPT)
      || !env.PWAPPY_TEST_LOGIN_PASSCODE || !env.GITHUB_OUTPUT) throw new Error('Missing branch test configuration');
  const root = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'pwappy-branch-check-'));
  const { childEnv, args } = invocation(suite, browser, os, phase, root, env);
  if (phase === 'tests') appendFileSync(env.GITHUB_OUTPUT, 'started=true\n');
  // Suppress all raw child output. Only strict numeric counts are echoed below.
  const result = (dependencies.spawn || spawnSync)(process.execPath, args, { env: childEnv, stdio: 'ignore' });
  const exit = Number.isInteger(result.status) && result.status >= 0 && result.status <= 255 ? result.status : 1;
  if (phase === 'tests') appendFileSync(env.GITHUB_OUTPUT, `EXIT_CODE=${exit}\n`);
  if (phase === 'cleanup') await (dependencies.guard || guard)(suite, env);
  if (!existsSync(childEnv.PWAPPY_BRANCH_COUNTS_PATH)) throw new Error('Branch test counts unavailable');
  const counts = readCounts(childEnv.PWAPPY_BRANCH_COUNTS_PATH);
  const failures = sourceLocations().validate(JSON.parse(readFileSync(childEnv.PWAPPY_BRANCH_FAILURES_PATH, 'utf8')));
  for (const item of failures) console.log(`Branch failure: ${item.status} ${item.kind} ${item.file}:${item.line}`);
  console.log(`Branch ${suite} ${phase}: passed=${counts.passed} failed=${counts.failed} skipped=${counts.skipped} timedOut=${counts.timedOut} interrupted=${counts.interrupted}; exit=${exit}`);
  return exit || (counts.passed === 0 || counts.failed + counts.timedOut + counts.interrupted > 0 ? 1 : 0);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await run(...process.argv.slice(2)); }
  catch {
    console.error('::error::Branch verification stopped. Check the credential-free guard step and numeric outcome; raw test data is not published.');
    process.exitCode = 1;
  }
}
