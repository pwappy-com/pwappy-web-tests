// Public artifact boundary: deliberately DO NOT read any test-generated files.
// This is an allowlisted summary generator, NOT a trace/media sanitizer.
import { appendFileSync, lstatSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const allowed = {
  suite: ['normal', 'premium'],
  os: ['ubuntu-latest', 'windows-latest', 'macos-latest'],
  browser: ['chromium', 'firefox', 'webkit', 'mobile-chrome', 'mobile-safari'],
};
function member(value, choices) {
  if (!choices.includes(value)) throw new Error('Invalid metadata');
  return value;
}
function decimal(value, maximumLength) {
  if (typeof value !== 'string' || value.length > maximumLength || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error('Invalid metadata');
  }
  return value;
}
export function makeSummary(env) {
  const exit = env.SAFE_TEST_EXIT_CODE;
  if (typeof exit !== 'string' || (exit !== '' && (!/^(0|[1-9][0-9]{0,2})$/.test(exit) || Number(exit) > 255))) {
    throw new Error('Invalid metadata');
  }
  return {
    schemaVersion: 1,
    evidencePolicy: 'workflow-metadata-only-no-test-files-v1',
    runId: decimal(env.GITHUB_RUN_ID, 20),
    runAttempt: decimal(env.GITHUB_RUN_ATTEMPT, 8),
    suite: member(env.SAFE_TEST_SUITE, allowed.suite),
    os: member(env.SAFE_TEST_OS, allowed.os),
    browser: member(env.SAFE_TEST_BROWSER, allowed.browser),
    testExitCode: exit === '' ? null : Number(exit),
    testProcessOutcome: exit === '' ? 'not-recorded' : exit === '0' ? 'passed' : 'failed',
    // A successful test process does NOT prove cleanup or the whole job succeeded.
    excludedEvidence: ['traces', 'reports', 'screenshots', 'videos', 'attachments', 'storage-state', 'test-output'],
  };
}
export function publishSummary(env) {
  // Validate EVERYTHING before creating an output or advertising it to the uploader.
  const summary = makeSummary(env);
  const root = env.RUNNER_TEMP;
  const output = env.GITHUB_OUTPUT;
  if (typeof root !== 'string' || !isAbsolute(root) || /[\r\n]/.test(root) || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) {
    throw new Error('Invalid output boundary');
  }
  if (typeof output !== 'string' || !isAbsolute(output) || /[\r\n]/.test(output) || !lstatSync(output).isFile() || lstatSync(output).isSymbolicLink()) {
    throw new Error('Invalid output boundary');
  }
  // Fresh unpredictable directory, never a reused repository/test-results location.
  const directory = mkdtempSync(join(root, 'pwappy-safe-evidence-'));
  const file = join(directory, 'summary.json');
  const contents = JSON.stringify(summary, null, 2) + '\n';
  writeFileSync(file, contents, { flag: 'wx', mode: 0o600 });
  if (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile() ||
      readdirSync(directory).join(',') !== 'summary.json' ||
      readFileSync(file, 'utf8') !== contents ||
      JSON.stringify(JSON.parse(readFileSync(file, 'utf8'))) !== JSON.stringify(summary)) {
    throw new Error('Verification failed');
  }
  // The workflow uploads this EXACT file, not its directory, glob, or raw inputs.
  appendFileSync(output, `summary_path=${file}\nverified=true\n`, 'utf8');
  return file;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { publishSummary(process.env); }
  catch {
    // Do not echo arbitrary metadata, filenames, stack traces or secret values.
    console.error('::error::Safe artifact summary generation failed; no artifact may be uploaded.');
    process.exitCode = 1;
  }
}
