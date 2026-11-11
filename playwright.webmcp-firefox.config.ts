import { defineConfig, devices } from '@playwright/test';
import isolated from './playwright.webmcp.config';
// Only synthetic UI tests; no native WebMCP preferences, real auth or .env.
export default defineConfig({
  ...isolated,
  testDir: './offline-tests',
  testMatch: 'webmcp-firefox-ui.playwright.ts',
  use: { ...isolated.use, ...devices['Desktop Firefox'],
    viewport: { width: 1440, height: 1000 } },
});
