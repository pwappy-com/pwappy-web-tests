import { defineConfig, devices } from '@playwright/test';
// Isolated local verification: intentionally does not load .env or saved auth.
const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
const buildDir = process.env.PWAPPY_WEBMCP_BUILD_DIR || '/tmp/pwappy-webmcp-build';
export default defineConfig({
  webServer: { command: `python3 -m http.server 8093 --bind 127.0.0.1 --directory ${quote(buildDir)}`, url: 'http://127.0.0.1:8093/app_editor.html', reuseExistingServer: false, stderr: 'ignore' },
  testDir: './tests/specs/webmcp', fullyParallel: false, workers: 1,
  timeout: 60000, expect: { timeout: 10000 },
  outputDir: process.env.PWAPPY_WEBMCP_OUTPUT_DIR || 'test-results/webmcp-isolated',
  reporter: [['list'], ['html', { outputFolder: process.env.PWAPPY_WEBMCP_REPORT_DIR || 'playwright-report/webmcp-isolated', open: 'never' }]],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:8093',
    viewport: { width: 1440, height: 1000 }, storageState: { cookies: [], origins: [] },
    serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
