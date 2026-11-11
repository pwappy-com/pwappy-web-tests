'use strict';
// Discard test titles, errors, stdout/stderr, attachments and service data.
const { writeFileSync } = require('node:fs');
const { sourceLocations, statuses } = require('./branch-safe-locations.cjs');
module.exports = class BranchCountReporter {
  constructor() {
    this.counts = { passed: 0, failed: 0, skipped: 0, timedOut: 0, interrupted: 0 };
    this.failures = [];
    this.sources = sourceLocations();
  }
  onTestEnd(test, result) {
    if (!Object.hasOwn(this.counts, result.status)) throw new Error('Unknown test status');
    this.counts[result.status]++;
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
