// Diagnostic-only scope: same staged flow and helpers on each selected runner.
import { attachAppStartupTimings } from './app-startup-timings';
import { test, expect } from '@playwright/test';
import { ensureAuthenticated } from '../constants';
import { createApp, deleteApp, gotoDashboard, openEditor } from './dashboard-helpers';
test.describe.configure({ mode: 'serial' });
for (let round = 1; round <= 3; round++) {
  test(`Runner benchmark round ${round}`, async ({ page, context, browserName }, testInfo) => {
    const code = browserName === 'webkit' ? 's' : 'c';
    const name = `runner-bench-${Date.now()}-${round}`;
    const key = `rb-${Date.now()}-${round}`;
    // First iteration includes authentication/point preparation; later ones use
    // the normal auth cache, explicitly reported as separate rounds.
    await test.step('runner-benchmark:auth_cache_points', () => ensureAuthenticated(0, code));
    await test.step('runner-benchmark:dashboard', () => gotoDashboard(page));
    await test.step('runner-benchmark:create_app', () => createApp(page, name, key));
    const editor = await test.step('runner-benchmark:editor_ready', () => openEditor(page, context, name));
    await expect(editor.locator('ios-component')).toBeVisible();
    await attachAppStartupTimings(editor, testInfo, round);
    await test.step('runner-benchmark:editor_close', () => editor.close());
    await test.step('runner-benchmark:delete_app', () => deleteApp(page, key));
  });
}
