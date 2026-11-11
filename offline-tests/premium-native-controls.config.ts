// Standalone native WebKit proof. No application configuration, accounts, or remote service.
import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir: '.', testMatch: 'premium-native-controls.playwright.ts',
    fullyParallel: false, workers: 1, retries: 0, timeout: 10000, reporter: 'line',
    expect: { timeout: 1000 },
    use: { browserName: 'webkit', trace: 'off', screenshot: 'off', video: 'off' },
});
