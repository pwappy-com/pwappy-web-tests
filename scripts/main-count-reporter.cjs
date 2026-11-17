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
    this.appStartupTimings = []; this.benchmarkTimings = []; this.editorDetailTimings = [];
    this.begun = 0; this.recordingFailed = false; this.startedPublished = false;
  }
  record(operation) {
    // Playwright can swallow reporter exceptions. Keep a sticky, data-free failure
    // and require the wrapper to validate a final completion record independently.
    try { return operation(); } catch { this.recordingFailed = true; }
  }
  onBegin(config, suite) { this.record(() => super.onBegin(config, suite)); }
  onStdOut(chunk, test) { this.record(() => super.onStdOut(chunk, test)); }
  onStepEnd(test, _result, step) { this.record(() => {
    if (!process.env.PWAPPY_BENCH_TIMINGS_PATH) return;
    const schema = require('./runner-benchmark-timings.cjs');
    const row = schema.stepTiming(test, step);
    if (row) { this.benchmarkTimings.push(row); schema.validate(this.benchmarkTimings); }
    if (process.env.PWAPPY_EDITOR_DETAIL_TIMINGS_PATH) {
      const detailSchema = require('./editor-detail-timings.cjs');
      const detail = detailSchema.stepTiming(test, step);
      if (detail) { this.editorDetailTimings.push(detail); detailSchema.validate(this.editorDetailTimings); }
    }
  }); }
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
    if (process.env.PWAPPY_APP_STARTUP_TIMINGS_PATH) {
      const schema = require('./app-startup-timings.cjs');
      this.appStartupTimings.push(...schema.attachmentRows(test, result));
      schema.validate(this.appStartupTimings);
    }
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
    this.record(() => { if (process.env.PWAPPY_APP_STARTUP_TIMINGS_PATH) atomic(process.env.PWAPPY_APP_STARTUP_TIMINGS_PATH, this.appStartupTimings); });
    this.record(() => { if (process.env.PWAPPY_EDITOR_DETAIL_TIMINGS_PATH) atomic(process.env.PWAPPY_EDITOR_DETAIL_TIMINGS_PATH, this.editorDetailTimings); });
    this.record(() => { if (process.env.PWAPPY_BENCH_TIMINGS_PATH) atomic(process.env.PWAPPY_BENCH_TIMINGS_PATH, this.benchmarkTimings); });
    this.record(() => super.onEnd());
    this.record(() => atomic(process.env.PWAPPY_MAIN_INTEGRITY_PATH, {
      accounts: [...this.accounts].sort((a, b) => a - b), begun: this.begun, failed: this.recordingFailed,
    }));
    // If even the completion record cannot be saved, no record means failure in
    // the wrapper, independently of how Playwright handles this return value.
    if (this.recordingFailed) return { status: 'failed' };
  }
};
