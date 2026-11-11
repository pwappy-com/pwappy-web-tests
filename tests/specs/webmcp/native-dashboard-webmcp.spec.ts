import { test, expect, Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test.use({ channel: 'chrome', launchOptions: { args: ['--enable-experimental-web-platform-features'] } });

async function nativeCall(page: Page, name: string, args: any = {}) {
  const raw = await page.evaluate(async ({ name, args }) => {
    const model = (document as any).modelContext;
    const tool = (await model.getTools()).find((tool: any) => tool.name === name);
    if (!tool) throw new Error(`Missing native tool: ${name}`);
    return model.executeTool(tool, args);
  }, { name, args });
  return JSON.parse(raw);
}

test('Native dashboard WebMCP registry, isolated writes, guards and cleanup', async ({ page, browser }, info) => {
  const origin = 'http://127.0.0.1:8093';
  const state = {
    identKey: 'isolated-routing-id',
    applications: [{ appKey: 'fixture', appName: 'Fixture application' }],
    versions: [{ appKey: 'fixture', version: 'v1', status: 'draft' }],
    dailyReportLastTime: '2026-11-10T12:00:00Z', serverTime: '2026-11-10T12:00:00Z'
  };
  const writes: { path: string; method: string; body: any }[] = [];
  const apiReads: string[] = [];
  const reviewQueries: Record<string, string>[] = [];
  const registrationWarnings: string[] = [];
  page.on('console', message => {
    if (message.type() === 'warning' && message.text().includes('[WebMCP]')) registrationWarnings.push(message.text());
  });
  // Route every request before navigation. Never use real auth or forward API requests.
  await page.context().route('**/*', async route => {
    const req = route.request(); const url = new URL(req.url());
    const path = url.pathname; const method = req.method();
    const post = method === 'POST';
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) writes.push({ path, method, body: req.postDataJSON() });
    if (method === 'OPTIONS') return route.fulfill({ status: 204 });
    if (path.endsWith('/dashboard-init')) return route.fulfill({ json: { code: 200, details: { identKey: state.identKey, appList: state, notifications: [], usedDiskSpace: 0 } } });
    if (path.endsWith('/archive-list')) return route.fulfill({ json: { code: 200, details: { identKey: state.identKey, applications: [], versions: [] } } });
    if (path.endsWith('/publish-list') || path.endsWith('/application-list')) {
      apiReads.push(path);
      return route.fulfill({ json: { code: 200, details: state } });
    }
    if (method === 'GET' && path.endsWith('/moderation-status')) {
      reviewQueries.push(Object.fromEntries(url.searchParams));
      return route.fulfill({ json: { code: 200, details: { fileModerationResults: JSON.stringify([
        { filePath: { FilePath: '/private/server/fixture/v1/assets/check.js' }, status: { ModerationStatus: 'rejected' }, reason: { Reason: 'Synthetic review reason' }, errorMessage: { ErrorMessage: 'Synthetic diagnostic' } },
        { filePath: { FilePath: '/another/private/root/fallback.txt' }, status: { ModerationStatus: 'approved' } }
      ]) } } });
    }
    if (method === 'PUT' && path.endsWith('/application')) {
      const payload = req.postDataJSON();
      const app = state.applications.find(item => item.appKey === payload.originAppKey)!;
      app.appKey = payload.newAppKey; app.appName = payload.appName;
      state.versions.filter(item => item.appKey === payload.originAppKey).forEach(item => { item.appKey = payload.newAppKey; });
      return route.fulfill({ json: { code: 200 } });
    }
    if (method === 'PUT' && path.endsWith('/version')) {
      const payload = req.postDataJSON();
      state.versions.find(item => item.appKey === payload.appKey && item.version === payload.originVersion)!.version = payload.newVersion;
      return route.fulfill({ json: { code: 200 } });
    }
    if (post && path.endsWith('/application')) {
      state.applications.push(req.postDataJSON());
      return route.fulfill({ json: { code: 200 } });
    }
    if (post && path.endsWith('/version')) {
      state.versions.push({ ...req.postDataJSON(), status: 'draft' });
      return route.fulfill({ json: { code: 200 } });
    }
    if (post && path.endsWith('/version-duplicate')) {
      state.versions.push({ appKey: req.postDataJSON().appKey, version: 'server-copy-v1', status: 'draft' });
      return route.fulfill({ json: { code: 200 } });
    }
    // Only compiled local static assets can pass through. All other requests are synthetic.
    if (url.origin === origin && method === 'GET' && !/\/(rest|read|v1)\//.test(path)) return route.continue();
    return route.fulfill({ json: { code: 200, details: [], items: [], files: [] } });
  });
  await page.context().addCookies([{ name: 'pwappy_login', value: 'isolated-test-only', url: origin }]);
  await page.goto('/index.html');
  await page.waitForFunction(async () => (await (document as any).modelContext?.getTools())?.length === 14);
  await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
  const capabilities = await page.evaluate(async () => ({
    documentAdapterPresent: Object.prototype.hasOwnProperty.call(document, 'modelContext'),
    names: (await (document as any).modelContext.getTools()).map((tool: any) => tool.name).sort()
  }));
  expect(capabilities.documentAdapterPresent).toBe(false);
  expect(capabilities.names).toEqual(['pwappy_archive_app', 'pwappy_clone_version', 'pwappy_create_app', 'pwappy_create_version', 'pwappy_delete_app', 'pwappy_delete_version', 'pwappy_get_editor_url', 'pwappy_get_saved_preview_url', 'pwappy_get_version_review_status', 'pwappy_list_apps', 'pwappy_list_archived_apps', 'pwappy_rename_version', 'pwappy_restore_app', 'pwappy_update_app']);
  const listing = await nativeCall(page, 'pwappy_list_apps');
  expect(listing).toMatchObject({ origin, applications: state.applications, versions: state.versions, capabilities: { publish: false, delete: true } });
  expect(listing.costs.workbenchApp).toContain('2 PP');
  const beforeURL = page.url();
  const editorURL = await nativeCall(page, 'pwappy_get_editor_url', { appKey: 'fixture', version: 'v1' });
  expect(editorURL).toEqual({ appKey: 'fixture', version: 'v1', url: `${origin}/app_editor.html?identKey=isolated-routing-id&appKey=fixture&version=v1`, navigated: false });
  const savedPreviewURL = await nativeCall(page, 'pwappy_get_saved_preview_url', { appKey: 'fixture', version: 'v1' });
  expect(savedPreviewURL).toEqual({
    appKey: 'fixture', version: 'v1', url: `${process.env.PWAPPY_WEBMCP_PREVIEW_BASE_URL || 'http://localhost/'}isolated-routing-id/fixture/v1/`,
    navigated: false, pageLoaded: false,
    notice: 'UIの「確認」と同じ保存版URLです。アプリ/版の存在のみ確認済みで、画面読込や最新編集の保存を保証するものではありません。'
  });
  expect(state.versions).toEqual([{ appKey: 'fixture', version: 'v1', status: 'draft' }]);
  const reviewStatus = await nativeCall(page, 'pwappy_get_version_review_status', { appKey: 'fixture', version: 'v1' });
  expect(reviewStatus).toEqual({ appKey: 'fixture', version: 'v1', status: 'draft', readOnly: true,
    fileModerationResults: [
      { path: 'assets/check.js', status: 'rejected', reason: 'Synthetic review reason', errorMessage: 'Synthetic diagnostic' },
      { path: 'fallback.txt', status: 'approved', reason: null, errorMessage: null }
    ]
  });
  expect(reviewQueries).toEqual([{ appKey: 'fixture', version: 'v1' }]);
  expect(JSON.stringify(reviewStatus)).not.toContain('/private/');
  await expect(nativeCall(page, 'pwappy_get_version_review_status', { appKey: 'fixture', version: 'missing' })).rejects.toThrow();
  expect(reviewQueries).toHaveLength(1);
  expect(page.url()).toBe(beforeURL);
  expect(page.context().pages()).toHaveLength(1);
  expect(writes).toEqual([]);

  const appInput = { appKey: 'created', appName: 'Created via native API', expectedOrigin: origin, confirm: true, acknowledgeDailyCost: true };
  await expect(nativeCall(page, 'pwappy_create_app', { ...appInput, acknowledgeDailyCost: false })).rejects.toThrow();
  await expect(nativeCall(page, 'pwappy_create_app', { ...appInput, expectedOrigin: 'https://wrong.invalid' })).rejects.toThrow();
  await expect(nativeCall(page, 'pwappy_create_version', { appKey: 'fixture', version: 'v2', expectedOrigin: origin, confirm: false })).rejects.toThrow();
  expect(writes).toEqual([]);
  const readsBefore = apiReads.length;
  const created = await nativeCall(page, 'pwappy_create_app', appInput);
  expect(created).toMatchObject({ action: 'createApp', mutationAccepted: true, serverVerified: true, published: false, application: { appKey: 'created', appName: appInput.appName }, versions: [] });
  expect(apiReads.length - readsBefore).toBe(2);
  const version = await nativeCall(page, 'pwappy_create_version', { appKey: 'created', version: 'v1', expectedOrigin: origin, confirm: true });
  expect(version).toMatchObject({ action: 'createVersion', mutationAccepted: true, serverVerified: true, published: false, versions: [{ appKey: 'created', version: 'v1', status: 'draft' }] });
  const clone = await nativeCall(page, 'pwappy_clone_version', { appKey: 'created', sourceVersion: 'v1', expectedOrigin: origin, confirm: true });
  expect(clone).toMatchObject({ action: 'cloneVersion', mutationAccepted: true, serverVerified: false, serverAssignedVersion: true, published: false, observedNewVersions: [{ appKey: 'created', version: 'server-copy-v1', status: 'draft' }] });
  expect(writes.map(write => ({ ...write, path: write.path.split('/').pop() }))).toEqual([
    { path: 'application', method: 'POST', body: { appKey: 'created', appName: appInput.appName } },
    { path: 'version', method: 'POST', body: { appKey: 'created', version: 'v1' } },
    { path: 'version-duplicate', method: 'POST', body: { appKey: 'created', version: 'v1' } }
  ]);
  const readback = await nativeCall(page, 'pwappy_list_apps', { appKey: 'created' });
  expect(readback.applications).toEqual([{ appKey: 'created', appName: appInput.appName }]);
  expect(readback.versions.map((item: any) => item.version)).toEqual(['v1', 'server-copy-v1']);
  await expect(page.locator('dashboard-app-content')).toContainText(appInput.appName);
  const updateInput = { appKey: 'created', newAppKey: 'renamed', appName: 'Renamed native application', expectedOrigin: origin, confirm: true };
  const renameInput = { appKey: 'created', version: 'v1', newVersion: 'v2', expectedOrigin: origin, confirm: true };
  await expect(nativeCall(page, 'pwappy_update_app', { ...updateInput, expectedOrigin: 'https://wrong.invalid' })).rejects.toThrow();
  await expect(nativeCall(page, 'pwappy_update_app', { ...updateInput, newAppKey: 'fixture' })).rejects.toThrow();
  await expect(nativeCall(page, 'pwappy_rename_version', { ...renameInput, confirm: false })).rejects.toThrow();
  await expect(nativeCall(page, 'pwappy_rename_version', { ...renameInput, newVersion: 'server-copy-v1' })).rejects.toThrow();
  state.versions.find(item => item.appKey === 'created' && item.version === 'v1')!.status = 'published';
  await expect(nativeCall(page, 'pwappy_update_app', updateInput)).rejects.toThrow();
  await expect(nativeCall(page, 'pwappy_rename_version', renameInput)).rejects.toThrow();
  state.versions.find(item => item.appKey === 'created' && item.version === 'v1')!.status = 'draft';
  expect(writes).toHaveLength(3);
  const readsBeforeUpdate = apiReads.length;
  const updated = await nativeCall(page, 'pwappy_update_app', updateInput);
  expect(updated).toMatchObject({ action: 'updateApp', appKey: 'created', newAppKey: 'renamed', mutationAccepted: true, serverVerified: true, doNotRetry: false, published: false,
    application: { appKey: 'renamed', appName: updateInput.appName }, versions: [{ appKey: 'renamed', version: 'v1', status: 'draft' }, { appKey: 'renamed', version: 'server-copy-v1', status: 'draft' }] });
  expect(apiReads.length - readsBeforeUpdate).toBe(2);
  const renamed = await nativeCall(page, 'pwappy_rename_version', { ...renameInput, appKey: 'renamed' });
  expect(renamed).toMatchObject({ action: 'renameVersion', appKey: 'renamed', version: 'v1', newVersion: 'v2', mutationAccepted: true, serverVerified: true, doNotRetry: false, published: false });
  expect(writes.slice(3).map(write => ({ ...write, path: write.path.split('/').pop() }))).toEqual([
    { path: 'application', method: 'PUT', body: { appName: updateInput.appName, originAppKey: 'created', newAppKey: 'renamed' } },
    { path: 'version', method: 'PUT', body: { appKey: 'renamed', originVersion: 'v1', newVersion: 'v2' } }
  ]);
  const updatedReadback = await nativeCall(page, 'pwappy_list_apps', { appKey: 'renamed' });
  expect(updatedReadback.applications).toEqual([{ appKey: 'renamed', appName: updateInput.appName }]);
  expect(updatedReadback.versions.map((item: any) => item.version)).toEqual(['v2', 'server-copy-v1']);
  await expect(nativeCall(page, 'pwappy_list_apps', { appKey: 'created' })).rejects.toThrow();
  await expect(page.locator('dashboard-app-content')).toContainText(updateInput.appName);
  await page.screenshot({ path: info.outputPath('native-dashboard.png'), fullPage: true });
  await page.locator('dashboard-main-content').evaluate(element => element.remove());
  await expect.poll(() => page.evaluate(() => (document as any).modelContext.getTools())).toEqual([]);
  expect(registrationWarnings).toEqual([]);
  await writeFile(info.outputPath('native-dashboard-evidence.json'), JSON.stringify({ browser: browser.version(), capabilities, listing, editorURL, savedPreviewURL, reviewStatus, reviewQueries, updated, renamed, updatedReadback, created, version, clone, readback, writes, apiReads, registrationWarnings, cleanupVerified: true }, null, 2));
  await info.attach('Native dashboard evidence', { path: info.outputPath('native-dashboard-evidence.json'), contentType: 'application/json' });
});
