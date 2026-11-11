import { defineConfig } from '@playwright/test';
import base from './playwright.config';
// Keep manual trace_snapshots behavior locally, but publish only metadata/safe numeric diagnostics.
// No built-in reporter can echo browser console, API bodies, titles, errors or attachments.
export default defineConfig({
  ...base,
  reporter: './scripts/main-count-reporter.cjs',
  outputDir: process.env.PWAPPY_BRANCH_OUTPUT_DIR,
  // Branch rehearsal shares the runner/reporter but preserves its no-raw-evidence policy.
  use: { ...base.use, ...(process.env.PWAPPY_MAIN_DISABLE_RAW_EVIDENCE === 'true'
    ? { trace: 'off' as const, screenshot: 'off' as const, video: 'off' as const } : {}) },
});
