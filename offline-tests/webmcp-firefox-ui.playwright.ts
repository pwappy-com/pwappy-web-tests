import { test, expect, Page } from '@playwright/test';
import { boot } from '../tests/specs/webmcp/editor-fixture';
import { PersistenceTransport, readStores, decodeWrite } from '../tests/specs/webmcp/persistence-fixture';

async function open(page: Page, transport: PersistenceTransport) {
  await transport.install(page);
  // Unlike the Chrome suppression test, do not redefine either modelContext.
  await boot(page, 'unmodified');
  expect(await page.evaluate(() => ({ secure: isSecureContext,
    navigatorAPI: 'modelContext' in navigator, documentAPI: 'modelContext' in document })))
    .toEqual({ secure: true, navigatorAPI: false, documentAPI: false });
  await expect(page.locator('#dom-tree')).toBeVisible();
  await page.getByText('アプリ設定', { exact: true }).click();
}
const description = (page: Page) => page.locator('appsetting-container .editor-row')
  .filter({ has: page.getByText('アプリの説明', { exact: true }) }).locator('input');
async function edit(page: Page, value: string) {
  await description(page).fill(value);
  await description(page).press('Tab');
  await expect.poll(async () => (await readStores(page)).appSettings.app_exp).toBe(value);
}
async function save(page: Page) {
  await page.locator('#fab-bottom-menu-box').click();
  await page.locator('#platformBottomMenu').getByText('保存', { exact: true }).click();
}

test('actual Firefox without WebMCP edits via UI and reloads captured save bytes in a fresh context', async ({ page, browser, baseURL }, info) => {
  info.annotations.push({ type: 'browser-version', description: browser.version() });
  const transport = new PersistenceTransport();
  await open(page, transport);
  await edit(page, 'Firefox synthetic UI save');
  await save(page);
  await expect.poll(() => transport.applied.length).toBe(1);
  await expect(page.locator('app-container-loading-overlay')).toBeHidden();
  expect(transport.decodedSaved().appSettings.app_exp).toBe('Firefox synthetic UI save');
  await expect.poll(() => transport.reads.some(read => read.fromSavedPayload)).toBe(true);
  const fresh = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 },
    storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });
  try {
    expect(await fresh.storageState()).toEqual({ cookies: [], origins: [] });
    const reloaded = await fresh.newPage();
    await open(reloaded, transport);
    await expect(description(reloaded)).toHaveValue('Firefox synthetic UI save');
    await reloaded.screenshot({ path: info.outputPath('firefox-ui-readback.png') });
  } finally { await fresh.close(); }
});

test('actual Firefox failed UI save preserves edits and permits a successful retry', async ({ page }) => {
  const transport = new PersistenceTransport();
  await open(page, transport);
  await edit(page, 'Firefox retained after disconnect');
  transport.nextWrite = 'disconnected';
  await save(page);
  await expect.poll(() => transport.writes.length).toBe(1);
  await expect(page.locator('app-container-loading-overlay')).toBeHidden();
  expect(transport.applied).toHaveLength(0);
  expect(decodeWrite(transport.writes[0]).appSettings.app_exp).toBe('Firefox retained after disconnect');
  await expect(description(page)).toHaveValue('Firefox retained after disconnect');
  // Close the real failure alert, then edit and save again through the UI.
  await page.locator('alert-component').getByRole('button').click();
  await edit(page, 'Firefox retry saved');
  await save(page);
  await expect.poll(() => transport.applied.length).toBe(1);
  await expect(page.locator('app-container-loading-overlay')).toBeHidden();
  expect(transport.decodedSaved().appSettings.app_exp).toBe('Firefox retry saved');
});
