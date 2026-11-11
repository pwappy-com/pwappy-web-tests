import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Branch runner supplies a new temporary path and explicitly selects one live suite.
// Do not record raw evidence on public CI runners or publish test-generated content.
export default defineConfig({
  ...base,
  reporter: './scripts/branch-count-reporter.cjs',
  outputDir: process.env.PWAPPY_BRANCH_OUTPUT_DIR,
  retries: 0,
  workers: 1,
  use: { ...base.use, trace: 'off', screenshot: 'off', video: 'off' },
});
