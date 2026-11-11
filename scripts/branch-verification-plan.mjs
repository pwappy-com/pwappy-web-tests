// Fixed branch-only scope. No environment selectors or account aliases.
import { MATRIX } from './branch-verification-guard.mjs';

export const BLOCKED_FIREFOX_REASON = 'staging-account-authorization-unavailable';
export function assertRunnableSelection(browser, os) {
  if (browser === 'firefox' && os === 'ubuntu-latest') {
    throw new Error('Branch verification blocked: Firefox staging account authorization is unavailable');
  }
}
export function verificationPlan() {
  const matrix = [], blocked = [];
  for (const suite of ['normal', 'premium']) {
    for (const entry of MATRIX) {
      const row = { ...entry, suite, runner: suite === 'premium' ? entry.os : entry.runner };
      if (entry.browser === 'firefox' && entry.os === 'ubuntu-latest') {
        blocked.push({ suite, os: entry.os, browser: entry.browser, status: 'blocked', reason: BLOCKED_FIREFOX_REASON });
      } else matrix.push(row);
    }
  }
  // Run the known slow WebKit regression first without dropping any coverage.
  const priority = row => row.suite === 'normal' && row.os === 'macos-latest' && row.browser === 'webkit';
  matrix.sort((left, right) => Number(priority(right)) - Number(priority(left)));
  return { matrix, blocked };
}
