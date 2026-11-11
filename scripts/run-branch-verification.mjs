// Authenticated entry point: recheck the public marker before each test/cleanup process.
import { appendFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { assertRunnableSelection } from './branch-verification-plan.mjs';
import { guard, MATRIX, POINTS_ENDPOINT } from './branch-verification-guard.mjs';
import { assertFreshPremiumAuthCache, assertNoRegisteredGeminiKey, PremiumKeyPreflightError } from './premium-key-preflight.mjs';
const require = createRequire(import.meta.url);
const { sourceLocations } = require('./branch-safe-locations.cjs');
export function invocation(suite, browser, os, phase, root, env) {
  const entry = MATRIX.find(item => item.browser === browser && item.os === os);
  if (!entry || !['normal', 'premium'].includes(suite) || !['tests', 'cleanup'].includes(phase)) {
    throw new Error('Invalid branch test selection');
  }
  assertRunnableSelection(browser, os);
  const childEnv = { ...env, CI: 'true', TEST_RUN_SUFFIX: entry.suffix,
    PWAPPY_TEST_ACCOUNT_INDEX: '0', PWAPPY_TEST_CLEANUP_BROWSER_CODE: entry.code,
    PWAPPY_TEST_POINTS_ENABLED: 'true', PWAPPY_TEST_POINTS_PHASE: phase,
    PWAPPY_TEST_POINTS_READ_ENDPOINT: POINTS_ENDPOINT,
    PWAPPY_TEST_RUN_ID: `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}-${suite}`,
    PWAPPY_FULL_BRANCH_VERIFICATION: 'true', TEST_GEMINI_API_KEY: 'AIza_TEST_ONLY_WEBMCP',
    PWAPPY_LOGIN: '1', PWAPPY_TEST_USER_PREFIX: 'pwusr',
    DOTENV_CONFIG_PATH: join(root, 'absent.env'),
    PWAPPY_BRANCH_OUTPUT_DIR: join(root, 'results'), PWAPPY_BRANCH_COUNTS_PATH: join(root, 'counts.json'),
    PWAPPY_BRANCH_PROGRESS_PATH: join(root, 'progress.json'),
    PWAPPY_BRANCH_FAILURES_PATH: join(root, 'failures.json') };
  return { childEnv, args: [require.resolve('@playwright/test/cli'), 'test',
    phase === 'tests' ? `tests/specs/${suite}` : 'tests/tools/a0-cleanup-all-apps.spec.ts',
    '--config=playwright.branch.config.ts', `--project=${browser}`, '--workers=1', '--retries=0'] };
}
export function readCounts(path) {
  return validateCounts(JSON.parse(readFileSync(path, 'utf8')));
}
function validateCounts(counts) {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts) || Object.keys(counts).sort().join(',') !== 'failed,interrupted,passed,skipped,timedOut'
      || Object.values(counts).some(value => !Number.isSafeInteger(value) || value < 0 || value > 100000)) {
    throw new Error('Invalid branch test counts');
  }
  return counts;
}
export function readProgress(path, previous) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || Object.keys(value).sort().join(',') !== 'completed,counts,total'
      || !Number.isSafeInteger(value.total) || value.total < 0 || value.total > 100000
      || !Number.isSafeInteger(value.completed) || value.completed < 0 || value.completed > value.total) {
    throw new Error('Invalid branch progress');
  }
  const counts = validateCounts(value.counts);
  if (Object.values(counts).reduce((sum, count) => sum + count, 0) !== value.completed
      || (previous && (previous.total !== value.total
        || Object.keys(counts).some(key => counts[key] < previous.counts[key])))) {
    throw new Error('Invalid branch progress');
  }
  return value;
}
// No child pipes are read. Only validated snapshots can reach the console.
// At most 240 periodic lines (two hours); final evidence is always checked.
export async function spawnWithProgress(executable, args, options, progress, dependencies = {}) {
  const child = (dependencies.spawn || spawn)(executable, args, options);
  let ticks = 0;
  const timer = (dependencies.setInterval || setInterval)(() => {
    if (ticks++ < 240) progress();
  }, 30000);
  try {
    return await new Promise(resolve => {
      child.once('error', () => resolve({ status: 1 }));
      child.once('close', status => resolve({ status }));
    });
  } finally { (dependencies.clearInterval || clearInterval)(timer); }
}
export async function run(suite, browser, os, phase, env = process.env, dependencies = {}) {
  assertRunnableSelection(browser, os);
  await (dependencies.guard || guard)(suite, env);
  if (!/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID) || !/^[1-9][0-9]{0,7}$/.test(env.GITHUB_RUN_ATTEMPT)
      || !env.PWAPPY_TEST_LOGIN_PASSCODE || !env.GITHUB_OUTPUT) throw new Error('Missing branch test configuration');
  const root = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'pwappy-branch-check-'));
  const { childEnv, args } = invocation(suite, browser, os, phase, root, env);
  if (suite === 'premium' && phase === 'tests') {
    assertFreshPremiumAuthCache(browser, os, dependencies.authRoot || process.cwd());
    await (dependencies.premiumKeyCheck || assertNoRegisteredGeminiKey)(browser, os, childEnv);
  }
  // Do not signal started until the read-only Premium key check has succeeded.
  // The workflow's app cleanup is therefore also blocked for protected accounts.
  if (phase === 'tests') appendFileSync(env.GITHUB_OUTPUT, 'started=true\n');
  // Suppress all raw child output. Only strict numeric counts are echoed below.
  let previousProgress;
  let invalidProgress = false;
  const progress = () => {
    if (!existsSync(childEnv.PWAPPY_BRANCH_PROGRESS_PATH)) return;
    try {
      previousProgress = readProgress(childEnv.PWAPPY_BRANCH_PROGRESS_PATH, previousProgress);
      const { total, completed, counts } = previousProgress;
      console.log(`Branch progress: total=${total} completed=${completed} passed=${counts.passed} failed=${counts.failed} skipped=${counts.skipped} timedOut=${counts.timedOut} interrupted=${counts.interrupted}`);
    } catch { invalidProgress = true; }
  };
  const result = await (dependencies.spawn || spawnWithProgress)(process.execPath, args,
    { env: childEnv, stdio: 'ignore' }, progress);
  const exit = Number.isInteger(result.status) && result.status >= 0 && result.status <= 255 ? result.status : 1;
  if (phase === 'tests') appendFileSync(env.GITHUB_OUTPUT, `EXIT_CODE=${exit}\n`);
  if (phase === 'cleanup') await (dependencies.guard || guard)(suite, env);
  if (!existsSync(childEnv.PWAPPY_BRANCH_COUNTS_PATH)) throw new Error('Branch test counts unavailable');
  const counts = readCounts(childEnv.PWAPPY_BRANCH_COUNTS_PATH);
  if (invalidProgress) throw new Error('Invalid branch progress');
  if (existsSync(childEnv.PWAPPY_BRANCH_PROGRESS_PATH)) {
    const finalProgress = readProgress(childEnv.PWAPPY_BRANCH_PROGRESS_PATH, previousProgress);
    if (Object.keys(counts).some(key => counts[key] !== finalProgress.counts[key])
        || (exit === 0 && finalProgress.completed !== finalProgress.total)) {
      throw new Error('Incomplete branch progress');
    }
  } else throw new Error('Branch progress unavailable');
  const failures = sourceLocations().validate(JSON.parse(readFileSync(childEnv.PWAPPY_BRANCH_FAILURES_PATH, 'utf8')));
  for (const item of failures) console.log(`Branch failure: ${item.status} ${item.kind} ${item.file}:${item.line}`);
  console.log(`Branch ${suite} ${phase}: passed=${counts.passed} failed=${counts.failed} skipped=${counts.skipped} timedOut=${counts.timedOut} interrupted=${counts.interrupted}; exit=${exit}`);
  return exit || (counts.passed === 0 || counts.failed + counts.timedOut + counts.interrupted > 0 ? 1 : 0);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await run(...process.argv.slice(2)); }
  catch (error) {
    console.error(error instanceof PremiumKeyPreflightError
      ? `::error::${error.message}`
      : '::error::Branch verification stopped. Check the credential-free guard step and numeric outcome; raw test data is not published.');
    process.exitCode = 1;
  }
}
