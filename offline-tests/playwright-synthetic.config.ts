// Standalone synthetic runner: never import the application config or auth fixtures.
import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: '.',
    testMatch: 'platform-skip-order.playwright.ts',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 10000,
    reporter: 'line',
    use: { trace: 'off', screenshot: 'off', video: 'off' },
    projects: [
        { name: 'synthetic-desktop', use: { isMobile: false } },
        { name: 'synthetic-mobile', use: { isMobile: true } },
    ],
});
