import { defineConfig, devices } from '@playwright/test';

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
        serviceWorkers: 'block',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
        { name: 'mobile-safari', use: { ...devices['iPhone 12'] } },
    ],
    outputDir: process.env.PWAPPY_TEST_OUTPUT || '/tmp/pwappy-ai-playwright-results',
});
