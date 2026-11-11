// Real Playwright fixture scheduling; no page/context/browser/request fixture is used.
import { test as base, expect } from '@playwright/test';

type Counts = { setups: number; teardowns: number; bodies: number };
const test = base.extend<{ heavy: string }, { counts: Counts }>({
    counts: [async ({}, use) => {
        await use({ setups: 0, teardowns: 0, bodies: 0 });
    }, { scope: 'worker' }],
    heavy: async ({ counts }, use) => {
        counts.setups++;
        try { await use('synthetic-editor'); }
        finally { counts.teardowns++; }
    },
});
test.describe.configure({ mode: 'serial' });

test.describe(() => {
    test.skip(({ isMobile }) => isMobile, 'Existing desktop-only condition');
    test('early modifier avoids the heavy fixture on mobile', async ({ heavy, counts }) => {
        expect(heavy).toBe('synthetic-editor');
        counts.bodies++;
    });
});
test('negative control: body skip is too late to avoid the heavy fixture', async ({ heavy, counts, isMobile }) => {
    test.skip(isMobile, 'Existing desktop-only condition');
    expect(heavy).toBe('synthetic-editor');
    counts.bodies++;
});
test('sentinel verifies exact fixture and body execution counts', async ({ counts, isMobile }) => {
    expect(counts).toEqual(isMobile
        ? { setups: 1, teardowns: 1, bodies: 0 }
        : { setups: 2, teardowns: 2, bodies: 2 });
});
