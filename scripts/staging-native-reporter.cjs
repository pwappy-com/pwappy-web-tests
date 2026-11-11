'use strict';
const { writeFileSync } = require('node:fs');
module.exports = class NativeCountReporter {
  constructor() { this.counts = { passed: 0, failed: 0, skipped: 0, timedOut: 0, interrupted: 0 }; }
  onTestEnd(_test, result) {
    if (!Object.hasOwn(this.counts, result.status)) throw Error('Invalid test status');
    this.counts[result.status]++;
  }
  onEnd() { writeFileSync(process.env.PWAPPY_BRANCH_COUNTS_PATH, JSON.stringify(this.counts), { flag: 'wx', mode: 0o600 }); }
  printsToStdio() { return false; }
};
