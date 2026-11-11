'use strict';
// A logical result replaces its earlier retry result. Attempt failures remain visible and fatal.
const { writeFileSync, renameSync, appendFileSync } = require('node:fs');
const Base = require('./branch-count-reporter.cjs');
const empty = () => ({ passed: 0, failed: 0, skipped: 0, timedOut: 0, interrupted: 0 });
const atomic = (path, value) => {
  writeFileSync(path + '.tmp', JSON.stringify(value), { mode: 0o600 });
  renameSync(path + '.tmp', path);
};
module.exports = class MainCountReporter extends Base {
  constructor() {
    super(); this.results = new Map(); this.attempts = empty(); this.accounts = new Set();
    this.begun = 0; this.recordingFailed = false; this.startedPublished = false;
  }
  record(operation) {
    // Playwright can swallow reporter exceptions. Keep a sticky, data-free failure
    // and require the wrapper to validate a final completion record independently.
    try { return operation(); } catch { this.recordingFailed = true; }
  }
  onBegin(config, suite) { this.record(() => super.onBegin(config, suite)); }
  onStdOut(chunk, test) { this.record(() => super.onStdOut(chunk, test)); }
  onTestBegin(_test, result) { this.record(() => {
    // Skipped/unstarted tests have workerIndex=-1. Retry workers retain parallelIndex.
    if (!Number.isInteger(result.workerIndex) || result.workerIndex < 0) return;
    const index = result.parallelIndex;
    const workers = Number(process.env.PWAPPY_MAIN_WORKERS);
    if (!Number.isInteger(index) || index < 0 || index >= workers || index > 996) throw new Error('Invalid main account');
    this.begun++;
    this.accounts.add(index);
    atomic(process.env.PWAPPY_MAIN_ACCOUNTS_PATH, [...this.accounts].sort((a, b) => a - b));
    if (!this.startedPublished && process.env.PWAPPY_TEST_POINTS_PHASE === 'tests') {
      appendFileSync(process.env.GITHUB_OUTPUT, 'started=true\n');
      this.startedPublished = true;
    }
  }); }
  onTestEnd(test, result) { this.record(() => {
    if (!Object.hasOwn(this.attempts, result.status)) throw new Error('Invalid main status');
    this.attempts[result.status]++;
    // Base reporter retains only allowlisted diagnostics, coordinates and status enums.
    this.results.set(test.id, result.status);
    this.counts = empty();
    for (const status of this.results.values()) this.counts[status]++;
    // Base increments once; compensate before calling it to retain its safety filtering.
    this.counts[result.status]--;
    super.onTestEnd(test, result);
  }); }
  publishProgress() { this.record(() => {
    if (this.total === undefined) return;
    const completed = Object.values(this.counts).reduce((sum, n) => sum + n, 0);
    if (this.total < completed || this.total > 100000) throw new Error('Invalid main counts');
    atomic(process.env.PWAPPY_BRANCH_PROGRESS_PATH, {
      total: this.total, completed, counts: this.counts, attempts: this.attempts,
    });
  }); }
  onEnd() {
    this.record(() => super.onEnd());
    this.record(() => atomic(process.env.PWAPPY_MAIN_INTEGRITY_PATH, {
      accounts: [...this.accounts].sort((a, b) => a - b), begun: this.begun, failed: this.recordingFailed,
    }));
    // If even the completion record cannot be saved, no record means failure in
    // the wrapper, independently of how Playwright handles this return value.
    if (this.recordingFailed) return { status: 'failed' };
  }
};
