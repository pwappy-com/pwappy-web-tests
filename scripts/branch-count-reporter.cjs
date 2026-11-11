'use strict';
// Discard test titles, errors, stdout/stderr, attachments and service data.
const { writeFileSync, renameSync } = require('node:fs');
const { sourceLocations, statuses } = require('./branch-safe-locations.cjs');
module.exports = class BranchCountReporter {
  constructor() {
    this.counts = { passed: 0, failed: 0, skipped: 0, timedOut: 0, interrupted: 0 };
    this.failures = [];
    this.sources = sourceLocations();
  }
  onBegin(_config, suite) {
    this.total = suite.allTests().length;
    this.publishProgress();
  }
  publishProgress() {
    // A single atomic snapshot cannot expose partial JSON to the parent.
    if (!process.env.PWAPPY_BRANCH_PROGRESS_PATH || this.total === undefined) return;
    const completed = Object.values(this.counts).reduce((sum, value) => sum + value, 0);
    if (!Number.isSafeInteger(this.total) || this.total < completed || this.total > 100000) {
      throw new Error('Invalid branch progress counts');
    }
    const target = process.env.PWAPPY_BRANCH_PROGRESS_PATH;
    writeFileSync(target + '.tmp', JSON.stringify({ total: this.total, completed, counts: this.counts }), { mode: 0o600 });
    renameSync(target + '.tmp', target);
  }
  onTestEnd(test, result) {
    if (!Object.hasOwn(this.counts, result.status)) throw new Error('Unknown test status');
    this.counts[result.status]++;
    this.publishProgress();
    if (!statuses.includes(result.status)) return;
    const definition = this.sources.location(test.location?.file, test.location?.line);
    const add = (kind, location) => {
      if (location && this.failures.length < 256) this.failures.push({ kind, status: result.status, ...location });
    };
    add('definition', definition);
    for (const error of (result.errors || []).slice(0, 5)) {
      for (const location of this.sources.fromStack(error.stack)) add('stack', location);
    }
  }
  onEnd() {
    writeFileSync(process.env.PWAPPY_BRANCH_COUNTS_PATH, JSON.stringify(this.counts), { flag: 'wx', mode: 0o600 });
    writeFileSync(process.env.PWAPPY_BRANCH_FAILURES_PATH, JSON.stringify(this.sources.validate(this.failures)), { flag: 'wx', mode: 0o600 });
  }
  printsToStdio() { return false; }
};
