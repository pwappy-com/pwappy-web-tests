// Standalone native protocol proof: loopback only, no application config/auth/staging.
import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: '.',
    testMatch: 'initial-navigation-webkit.playwright.ts',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 30000,
    reporter: 'line',
    use: {
        browserName: 'webkit',
        trace: 'off',
        screenshot: 'off',
        video: 'off',
    },
});
