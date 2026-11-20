import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: '.',
    testMatch: 'models-and-points.spec.ts',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 90000,
    reporter: 'line',
    expect: { timeout: 12000 },
    use: {
        browserName: 'chromium',
        serviceWorkers: 'block',
        viewport: { width: 1450, height: 1000 },
    },
    outputDir: process.env.PWAPPY_TEST_OUTPUT || '/tmp/pwappy-ai-playwright-results',
});
