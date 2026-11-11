// Public CI boundary: child stdout/stderr are never inherited, piped, read or printed.
import { appendFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { startMainDiagnostics } from './main-safe-telemetry.mjs';
import { mainGuard } from './main-verification-guard.mjs';
import { MATRIX, POINTS_ENDPOINT } from './branch-verification-guard.mjs';
import { readCounts, spawnWithProgress } from './run-branch-verification.mjs';
import { assertFreshTestAccountAuthCache, assertNoRegisteredTestAccountKey, assertNoRegisteredSmokeAccountKey, assertSessionIdentity,
  mainAccount, PremiumKeyPreflightError } from './premium-key-preflight.mjs';
const require = createRequire(import.meta.url);
const { readDiagnostics } = require('./branch-safe-diagnostics.cjs');
const { sourceLocations } = require('./branch-safe-locations.cjs');
const keys = ['failed', 'interrupted', 'passed', 'skipped', 'timedOut'];
const fail = () => { throw new Error('Invalid main verification evidence'); };
const sum = counts => Object.values(counts).reduce((total, value) => total + value, 0);
export function mainSelection(suite, browser, os, env, cpuCount = cpus().length, mode = 'main') {
  if (!['main', 'branch'].includes(mode)) fail();
  const entry = MATRIX.find(item => item.browser === browser && item.os === os && item.browser !== 'firefox');
  if (!entry || !['normal', 'premium'].includes(suite)) fail();
  const manual = mode === 'main' && env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  const rawWorkers = manual && suite === 'normal' ? env.TEST_WORKERS || '1' : '1';
  let workers;
  if (/^[1-9][0-9]{0,2}$/.test(rawWorkers)) workers = Number(rawWorkers);
  else if (/^(?:[1-9][0-9]?|100)%$/.test(rawWorkers)) workers = Math.max(1, Math.floor(cpuCount * parseInt(rawWorkers) / 100));
  if (!Number.isSafeInteger(workers) || workers < 1 || workers > 997) fail();
  const retries = manual ? env.TEST_RETRIES || '0' : '0';
  if (!/^[0-5]$/.test(retries)) fail();
  const scope = manual && suite === 'normal' ? env.TEST_SCOPE || 'all' : 'all';
  const scopes = {
    all: [`tests/specs/${suite}`],
    'editor-regression': ['tests/specs/normal/editor-events-build.spec.ts', 'tests/specs/normal/editor-property-parsing-build.spec.ts',
      '--grep', 'DOMContentLoaded|loadイベント|ライフサイクルイベント|グローバルなイベント委譲|JSDocの@fires'],
    'quick-property-regression': ['tests/specs/normal/editor-quick-property-editor.spec.ts'],
    'style-ownership-regression': ['tests/specs/normal/editor-style-ownership.spec.ts'],
    'points-smoke': [],
  };
  const points = mode === 'branch' ? 'true' : env.PWAPPY_TEST_POINTS_ENABLED;
  if (!Object.hasOwn(scopes, scope) || !['true', 'false'].includes(points)) fail();
  return { suite, browser, os, workers, retries: Number(retries), scope, points, mode,
    suffix: entry.suffix, code: entry.code, testArgs: scopes[scope] };
}
export function mainInvocation(selection, phase, root, env, account) {
  const childEnv = { ...env, CI: 'true', TEST_RUN_SUFFIX: selection.suffix,
    PWAPPY_TEST_CLEANUP_BROWSER_CODE: selection.code,
    PWAPPY_TEST_POINTS_ENABLED: selection.points, PWAPPY_TEST_POINTS_PHASE: phase,
    PWAPPY_TEST_POINTS_READ_ENDPOINT: POINTS_ENDPOINT,
    PWAPPY_TEST_RUN_ID: `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}-${selection.suite}`,
    TEST_GEMINI_API_KEY: 'AIza_TEST_ONLY_WEBMCP', PWAPPY_LOGIN: '1', PWAPPY_TEST_USER_PREFIX: 'pwusr',
    DOTENV_CONFIG_PATH: join(root, 'absent.env'),
    PWAPPY_MAIN_DISABLE_RAW_EVIDENCE: selection.mode === 'branch' ? 'true' : 'false',
    PWAPPY_MAIN_WORKERS: String(phase === 'cleanup' ? 1 : selection.workers),
    PWAPPY_MAIN_ACCOUNTS_PATH: join(root, 'accounts.json'),
    PWAPPY_MAIN_INTEGRITY_PATH: join(root, 'integrity.json'),
    PWAPPY_BRANCH_OUTPUT_DIR: join(root, 'results'), PWAPPY_BRANCH_COUNTS_PATH: join(root, 'counts.json'),
    PWAPPY_BRANCH_PROGRESS_PATH: join(root, 'progress.json'),
    PWAPPY_BRANCH_DIAGNOSTICS_PATH: join(root, 'diagnostics.json'),
    PWAPPY_BRANCH_FAILURES_PATH: join(root, 'failures.json'), DEBUG: '', PWDEBUG: '' };
  childEnv.PWAPPY_FULL_BRANCH_VERIFICATION = selection.scope === 'all' ? 'true' : 'false';
  delete childEnv.PWAPPY_TEST_ACCOUNT_INDEX;
  delete childEnv.TEST_PARALLEL_INDEX;
  delete childEnv.TEST_WORKER_INDEX;
  if (selection.mode === 'branch') childEnv.PWAPPY_TEST_ACCOUNT_INDEX = '0';
  if (phase === 'cleanup') childEnv.PWAPPY_TEST_ACCOUNT_INDEX = String(account);
  if (selection.scope === 'points-smoke' && phase === 'tests') {
    childEnv.PWAPPY_SMOKE_IDENT = mainAccount(selection.browser, selection.os, 0).slice(0, 4) + '998';
    return { childEnv, args: ['tests/tools/points-smoke.mjs'] };
  }
  return { childEnv, args: [require.resolve('@playwright/test/cli'), 'test',
    ...(phase === 'cleanup' ? ['tests/tools/a0-cleanup-all-apps.spec.ts'] : selection.testArgs),
    '--config=playwright.main-safe.config.ts', `--project=${selection.browser}`,
    `--workers=${phase === 'cleanup' ? 1 : selection.workers}`, `--retries=${phase === 'cleanup' ? 0 : selection.retries}`] };
}
function validateCounts(counts) {
  if (!counts || Object.keys(counts).sort().join(',') !== keys.join(',')
      || Object.values(counts).some(n => !Number.isSafeInteger(n) || n < 0 || n > 600000)) fail();
  return counts;
}
export function readMainProgress(path, previous) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || Object.keys(value).sort().join(',') !== 'attempts,completed,counts,total'
      || !Number.isSafeInteger(value.total) || value.total < 0 || value.total > 100000
      || !Number.isSafeInteger(value.completed) || value.completed < 0 || value.completed > value.total) fail();
  validateCounts(value.counts); validateCounts(value.attempts);
  if (sum(value.counts) !== value.completed || sum(value.attempts) < value.completed
      || keys.some(key => value.counts[key] > value.attempts[key])
      || (previous && (value.total !== previous.total || value.completed < previous.completed
        || keys.some(key => value.attempts[key] < previous.attempts[key])))) fail();
  return value;
}
export function readAccounts(root, selection) {
  const path = join(root, 'accounts.json');
  if (!existsSync(path)) return [];
  const accounts = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(accounts) || accounts.length > selection.workers
      || accounts.some((n, index) => !Number.isInteger(n) || n < 0 || n >= selection.workers
        || n > 996 || (index > 0 && n <= accounts[index - 1]))) fail();
  return accounts;
}
export function readMainIntegrity(root, selection, final) {
  const value = JSON.parse(readFileSync(join(root, 'integrity.json'), 'utf8'));
  if (!value || Object.keys(value).sort().join(',') !== 'accounts,begun,failed'
      || value.failed !== false || !Number.isSafeInteger(value.begun) || value.begun < 0
      || value.begun > sum(final.attempts)
      || value.begun < sum(final.attempts) - final.attempts.skipped
      || !Array.isArray(value.accounts) || value.accounts.length > value.begun) fail();
  const accounts = readAccounts(root, selection);
  if (JSON.stringify(accounts) !== JSON.stringify(value.accounts)
      || (value.begun > 0 && accounts.length === 0)) fail();
  return value;
}
async function execute(selection, phase, root, env, dependencies, account) {
  const { childEnv, args } = mainInvocation(selection, phase, root, env, account);
  let previous, invalid = false;
  const progress = () => {
    if (!existsSync(childEnv.PWAPPY_BRANCH_PROGRESS_PATH)) return;
    try {
      previous = readMainProgress(childEnv.PWAPPY_BRANCH_PROGRESS_PATH, previous);
      console.log('Main progress: ' + JSON.stringify(previous));
    } catch { invalid = true; }
  };
  const stopDiagnostics = phase === 'tests' && selection.suite === 'normal' && selection.scope !== 'points-smoke'
    && process.platform === 'darwin' ? (dependencies.startDiagnostics || startMainDiagnostics)() : async () => {};
  let result;
  try {
    result = await (dependencies.spawn || spawnWithProgress)(process.execPath, args, { env: childEnv, stdio: 'ignore' }, progress);
  } finally { await stopDiagnostics(); }
  const exit = Number.isInteger(result.status) && result.status >= 0 && result.status <= 255 ? result.status : 1;
  if (phase === 'tests') appendFileSync(env.GITHUB_OUTPUT, `RAW_TEST_EXIT_CODE=${exit}\n`);
  if (selection.scope === 'points-smoke') {
    console.log(`Main points smoke: exit=${exit}`);
    return exit;
  }
  const counts = readCounts(childEnv.PWAPPY_BRANCH_COUNTS_PATH);
  const final = readMainProgress(childEnv.PWAPPY_BRANCH_PROGRESS_PATH, previous);
  if (invalid || keys.some(key => counts[key] !== final.counts[key])
      || sum(final.attempts) > final.total * ((phase === 'cleanup' ? 0 : selection.retries) + 1)
      || (exit === 0 && final.completed !== final.total)) fail();
  readMainIntegrity(root, { ...selection, workers: phase === 'cleanup' ? 1 : selection.workers }, final);
  const failures = sourceLocations().validate(JSON.parse(readFileSync(childEnv.PWAPPY_BRANCH_FAILURES_PATH, 'utf8')));
  const diagnostics = readDiagnostics(childEnv.PWAPPY_BRANCH_DIAGNOSTICS_PATH);
  for (const item of diagnostics) console.log('Main diagnostic: ' + JSON.stringify(item));
  for (const item of failures) console.log(`Main failure: ${item.status} ${item.kind} ${item.file}:${item.line}`);
  console.log(`Main ${selection.suite} ${phase}: ` + JSON.stringify({ ...final, exit }));
  // A flaky pass is reported separately but never silently turns a failed attempt green.
  return exit || (counts.passed === 0 || final.attempts.failed + final.attempts.timedOut + final.attempts.interrupted > 0 ? 1 : 0);
}
function manifest(selection, env, sourceCommit) {
  return { selection, sha: env.GITHUB_SHA, run: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, sourceCommit };
}
function validateRuntime(env) {
  if (!/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID || '') || !/^[1-9][0-9]{0,7}$/.test(env.GITHUB_RUN_ATTEMPT || '')
      || !env.PWAPPY_TEST_LOGIN_PASSCODE || !env.GITHUB_OUTPUT) fail();
}
async function runMainInternal(suite, browser, os, phase, env, dependencies, mode) {
  if (!['tests', 'cleanup'].includes(phase)) fail();
  const selection = mainSelection(suite, browser, os, env, dependencies.cpuCount, mode);
  validateRuntime(env);
  const guarded = await (dependencies.guard || mainGuard)(suite, env);
  const temp = resolve(env.RUNNER_TEMP || tmpdir());
  if (phase === 'cleanup') {
    const root = resolve(env.PWAPPY_MAIN_STATE_DIR || '');
    if (dirname(root) !== temp || !/^pwappy-main-check-[A-Za-z0-9_-]+$/.test(basename(root))
        || lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) fail();
    if (readFileSync(join(root, 'manifest.json'), 'utf8') !== JSON.stringify(manifest(selection, env, guarded.sourceCommit))) fail();
    // points-smoke has its own replay/cleanup balance assertions and creates no apps.
    if (selection.scope === 'points-smoke') return 0;
    const accounts = readAccounts(root, selection);
    let exit = 0;
    for (const account of accounts) {
      const identity = mainAccount(browser, os, account);
      const file = join(dependencies.authRoot || process.cwd(), '.auth', `user-${identity[2]}-${identity[3]}-${account}.json`);
      if (!existsSync(file)) continue;
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) fail();
      const text = readFileSync(file, 'utf8').trim();
      if (text === '{}' || !text) continue;
      assertSessionIdentity(JSON.parse(text), identity);
      await (dependencies.guard || mainGuard)(suite, env);
      const cleanupRoot = mkdtempSync(join(temp, 'pwappy-main-cleanup-'));
      const code = await execute(selection, phase, cleanupRoot, env, dependencies, account);
      exit ||= code;
    }
    await (dependencies.guard || mainGuard)(suite, env);
    return exit;
  }
  // Every candidate parallel slot must be fresh and free of registered keys before any test starts.
  if (selection.scope === 'points-smoke') {
    await (dependencies.smokeKeyCheck || assertNoRegisteredSmokeAccountKey)(browser, os, env);
  } else {
    for (let index = 0; index < selection.workers; index++) {
      assertFreshTestAccountAuthCache(browser, os, index, dependencies.authRoot || process.cwd());
    }
    for (let index = 0; index < selection.workers; index++) {
      await (dependencies.keyCheck || assertNoRegisteredTestAccountKey)(browser, os, index, env);
    }
  }
  await (dependencies.guard || mainGuard)(suite, env);
  const root = mkdtempSync(join(temp, 'pwappy-main-check-'));
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest(selection, env, guarded.sourceCommit)), { flag: 'wx', mode: 0o600 });
  appendFileSync(env.GITHUB_OUTPUT, `state_dir=${root}\n`);
  return execute(selection, phase, root, env, dependencies);
}
export async function runMain(suite, browser, os, phase, env = process.env, dependencies = {}, mode = 'main') {
  let exit = 1;
  try {
    exit = await runMainInternal(suite, browser, os, phase, env, dependencies, mode);
    return exit;
  } finally {
    if (phase === 'tests' && env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `EXIT_CODE=${exit}\n`);
  }
}
export async function main(args = process.argv.slice(2), env = process.env, dependencies = {}, mode = 'main') {
  try {
    if (args.length !== 4) fail();
    return await runMain(...args, env, dependencies, mode);
  } catch (error) {
    console.error(error instanceof PremiumKeyPreflightError ? `::error::${error.message}`
      : '::error::Main verification stopped; deployment, configuration or numeric evidence did not validate. Raw test data is not published.');
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
