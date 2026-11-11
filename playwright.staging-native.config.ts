import { defineConfig } from '@playwright/test';
// Never import the default config or dotenv. Live execution is wrapper-only;
// credential-free --list remains useful for offline discovery checks.
export default defineConfig({
  testDir: './staging-tests', testMatch: 'native-persistence.spec.ts',
  forbidOnly: true, fullyParallel: false, workers: 1, retries: 0,
  timeout: 180000, expect: { timeout: 20000 },
  reporter: './scripts/staging-native-reporter.cjs',
  outputDir: process.env.PWAPPY_BRANCH_OUTPUT_DIR,
  use: { channel: 'chrome', viewport: { width: 1280, height: 900 },
    trace: 'off', screenshot: 'off', video: 'off',
    storageState: { cookies: [], origins: [] },
    launchOptions: { args: ['--enable-automation', '--enable-experimental-web-platform-features',
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${process.env.PWAPPY_STAGING_NATIVE_PORT || '0'}`,
      `--pwappy-staging-native=${process.env.PWAPPY_STAGING_NATIVE_TOKEN || 'not-authorized'}`] } },
  projects: [{ name: 'staging-native-chrome' }],
});
