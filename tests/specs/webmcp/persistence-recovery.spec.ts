import { test, expect } from '@playwright/test';
import { PersistenceTransport, target, persistedFields, decodeWrite, nativeCall, openEditor,
  freshEditor, readStores, setDescription, saveCurrent, expectFreshSaved } from './persistence-fixture';

test.use({ channel: 'chrome', launchOptions: { args: ['--enable-experimental-web-platform-features'] } });

test('native mixed-store save survives a completely fresh browser context', async ({ page, browser, baseURL }, info) => {
  const transport = new PersistenceTransport();
  await openEditor(page, transport);
  const before = await readStores(page);
  await nativeCall(page, 'pwappy_manage_element', { action: 'update_attribute', targetId: 'fixture-title', attribute: 'title', value: 'Persisted heading / 日本語' });
  await nativeCall(page, 'pwappy_update_global_style', { css: 'h1 { color: rgb(12, 34, 56); } .persisted-card { padding: 7px; }' });
  await nativeCall(page, 'pwappy_manage_script', { action: 'upsert', scriptName: 'persistedGreeting', scriptContent: 'function persistedGreeting(){ return "保存済み / durable"; }', comment: 'Fresh-context persistence test' });
  await nativeCall(page, 'pwappy_manage_event_binding', { action: 'add_definition', tagName: 'h1', eventType: 'persistedEvent', comment: 'Persist custom event definition and binding' });
  await nativeCall(page, 'pwappy_manage_event_binding', { action: 'attach', targetId: 'fixture-title', eventType: 'persistedEvent', scriptName: 'persistedGreeting' });
  await nativeCall(page, 'pwappy_manage_service_worker', { action: 'attach', eventName: 'message', scriptName: 'persistedGreeting', comment: 'Definition only; service workers remain blocked' });
  // Attribute definitions do not have an authoring tool. Use the actual reducer,
  // not a replacement store or a hand-authored server payload.
  await page.locator('app-container').evaluate((host: any) => host.attributeItemStore.dispatch(
    host.attributeItemSlice.setIdTypeCommentForTag({ tagName: 'h1', idTypeComment: '/** @type{HTMLHeadingElement} persisted-attribute-definition */' })));
  const settings = await nativeCall(page, 'pwappy_get_app_settings');
  await nativeCall(page, 'pwappy_update_app_settings', { expectedRevision: settings.revision, lang: 'ja', description: '保存後の新しいブラウザで確認',
    manifest: { name: 'Persistence QA', short_name: 'Persist', start_url: './', display: 'standalone', theme_color: '#0c2238' } });
  const advanced = await nativeCall(page, 'pwappy_get_advanced_settings');
  await nativeCall(page, 'pwappy_update_advanced_settings', { ...target, expectedRevision: advanced.revision,
    specification: 'Fresh contexts must receive every saved store.', global: { testMarker: 'persisted-global' }, pageRoles: { 'home.html': 'Persistence entry page' } });
  const catalog = await nativeCall(page, 'pwappy_list_components', { source: 'custom' });
  await nativeCall(page, 'pwappy_manage_component', { ...target, expectedRevision: catalog.revision, action: 'add', componentName: 'Persistence card',
    component: { tagName: 'section', attributes: { class: 'persisted-card' }, children: [{ tagName: 'span', attributes: {}, text: 'Reusable durable card', children: [] }] }, filterTags: ['persistence'] });
  await nativeCall(page, 'pwappy_upsert_test', { name: 'Durable test definition', code: 'export default async function runTest(){ if(2 + 2 !== 4) throw new Error("arithmetic"); }' });
  await nativeCall(page, 'pwappy_upsert_api_mock', { path: '/isolated-persisted-api', method: 'GET', response: '{"persisted":true}' });
  await nativeCall(page, 'pwappy_upsert_browser_mock', { path: '__persistedFixture.value', browserMockType: 'property', response: '"durable"' });
  const changed = await readStores(page);
  for (const field of persistedFields) expect(changed[field], `${field} must contain a real local edit`).not.toEqual(before[field]);
  expect(await nativeCall(page, 'pwappy_get_save_status')).toMatchObject({ dirty: true });
  expect(await saveCurrent(page)).toMatchObject({ success: true, dirty: false, serverSaved: true, serverVerified: true });
  expect(transport.writes).toHaveLength(1);
  expect(decodeWrite(transport.writes[0])).toEqual(changed);
  // Close the original document before creating the unrelated context.
  await page.close();
  await expectFreshSaved(browser, baseURL!, transport);
  await info.attach('fresh-context-persistence-evidence', { contentType: 'application/json', body: JSON.stringify({
    browser: browser.version(), transport: 'Synthetic intercepted PUT/GET; not real PHP writes',
    api: 'Native document.modelContext', contextsShareStorage: false,
    decodedFieldsCompared: persistedFields, writes: transport.writes.length, reads: transport.reads,
    explicitlyReinitializedTransientFields: ['templateItems.forceReload', 'testItems.executionState'],
    assertion: 'Every durable saved field equals the fresh compiled editor store; runtime rendering/test flags reset. No old page or local storage is reused.'
  }, null, 2) });
});

test('network disconnect leaves edits dirty with no implicit write retry, then explicit retry reloads', async ({ page, browser, baseURL }) => {
  const transport = new PersistenceTransport();
  await openEditor(page, transport);
  await setDescription(page, 'Keep this draft across the network failure');
  const draft = await readStores(page);
  transport.nextWrite = 'disconnected';
  await expect(saveCurrent(page)).rejects.toThrow();
  expect(transport.writes).toHaveLength(1);
  expect(transport.applied).toHaveLength(0);
  expect(await nativeCall(page, 'pwappy_get_save_status')).toMatchObject({ status: 'failed', dirty: true, serverVerified: false, serverSaved: null });
  expect(await readStores(page)).toEqual(draft);
  await expect(page.locator('app-container-loading-overlay')).toBeHidden();
  expect(await saveCurrent(page)).toMatchObject({ success: true, dirty: false, serverVerified: true });
  expect(transport.writes).toHaveLength(2);
  expect(decodeWrite(transport.writes[1])).toEqual(draft);
  await expectFreshSaved(browser, baseURL!, transport);
});

for (const phase of ['write', 'readback'] as const) {
test(`expired authentication during ${phase} preserves the editor and unsaved stores for recovery`, async ({ page, browser, baseURL }) => {
  const transport = new PersistenceTransport();
  await openEditor(page, transport);
  await setDescription(page, 'Do not discard this draft when authentication expires');
  const originalURL = page.url(), draft = await readStores(page);
  const navigations: string[] = [];
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
  if (phase === 'write') transport.nextWrite = 'expired-auth';
  else transport.expireNextSavedRead = true;
  if (phase === 'write') {
    await expect(saveCurrent(page)).rejects.toThrow();
  } else {
    // Verify the actual user-facing MENU > Save event path as well as native WebMCP.
    await page.getByTitle('ボトムメニュー', { exact: true }).click();
    await page.locator('platform-bottom-menu .menu-item').filter({ hasText: /^\s*保存\s*$/ }).click();
    await expect.poll(async () => (await nativeCall(page, 'pwappy_get_save_status')).status).toBe('failed');
  }
  expect(page.url(), 'An expired save must not navigate away from unsaved editor data').toBe(originalURL);
  expect(navigations).toEqual([]);
  expect(transport.writes).toHaveLength(1);
  expect(transport.applied).toHaveLength(phase === 'write' ? 0 : 1);
  expect(await readStores(page)).toEqual(draft);
  expect(await nativeCall(page, 'pwappy_get_save_status')).toMatchObject({ status: 'failed', dirty: true, serverVerified: false });
  expect(await page.evaluate(() => document.cookie.split(';').some(item => item.trim().startsWith('pwappy_login=')))).toBe(false);
  if (phase === 'readback') expect(await nativeCall(page, 'pwappy_get_save_status')).toMatchObject({ serverSaved: true });
  const alert = page.locator('alert-component');
  await expect(alert).toBeVisible();
  await expect(alert.locator('.message-container')).toContainText('編集内容をこの画面に保持しています');
  await expect(alert.locator('.message-container')).toContainText('この画面を閉じずに別の画面で再ログイン');
  await alert.locator('#closeButton').click();
  await expect(page.locator('app-container-loading-overlay')).toBeHidden();
  // Synthetic recovery only. No existing account, credential or real login.
  await page.evaluate(() => { document.cookie = 'pwappy_login=isolated-test-only; path=/'; });
  expect(await saveCurrent(page)).toMatchObject({ dirty: false, serverVerified: true });
  expect(transport.writes).toHaveLength(2);
  await expectFreshSaved(browser, baseURL!, transport);
});
}

test('server-applied save with lost response stays uncertain until independent read and explicit retry', async ({ page, browser, baseURL }, info) => {
  const transport = new PersistenceTransport();
  await openEditor(page, transport);
  await setDescription(page, 'Applied by the synthetic server before its response was lost');
  const submitted = await readStores(page);
  transport.nextWrite = 'applied-response-lost';
  await expect(saveCurrent(page)).rejects.toThrow();
  expect(transport.writes).toHaveLength(1);
  expect(transport.applied).toHaveLength(1);
  expect(await nativeCall(page, 'pwappy_get_save_status')).toMatchObject({ status: 'failed', dirty: true, serverSaved: null, serverVerified: false });
  expect(await readStores(page)).toEqual(submitted);
  await expectFreshSaved(browser, baseURL!, transport);
  // Independent verification must not silently clear the original draft/status.
  expect(await nativeCall(page, 'pwappy_get_save_status')).toMatchObject({ dirty: true, serverVerified: false, serverSaved: null });
  await setDescription(page, 'Newer local edit after independently checking the uncertain outcome');
  expect(await saveCurrent(page)).toMatchObject({ dirty: false, serverVerified: true });
  expect(transport.writes).toHaveLength(2);
  expect(transport.decodedSaved().appSettings.app_exp).toBe('Newer local edit after independently checking the uncertain outcome');
  await expectFreshSaved(browser, baseURL!, transport);
  await info.attach('uncertain-save-evidence', { contentType: 'application/json', body: JSON.stringify({
    transport: 'Synthetic apply followed by browser connectionreset, not a real PHP write',
    writesBeforeManualRetry: 1, originalDraftRetained: true, automaticRetry: false, independentFreshContextRead: true
  }) });
});

test('two browser contexts detect a conflicting readback without replacing the first draft', async ({ page, browser, baseURL }) => {
  const transport = new PersistenceTransport();
  await openEditor(page, transport);
  await setDescription(page, 'First editor draft');
  const firstDraft = await readStores(page);
  const gate = transport.holdNextSuccessfulWrite();
  // Catch immediately so the deliberately rejected asynchronous save is observed.
  const firstSave = saveCurrent(page).then(result => ({ result, error: undefined as unknown }), error => ({ result: undefined, error }));
  let second: Awaited<ReturnType<typeof freshEditor>> | undefined;
  try {
    await Promise.race([gate.started, firstSave.then(({ error }) => {
      throw error || new Error('Save unexpectedly completed before the response gate');
    })]);
    second = await freshEditor(browser, baseURL!, transport);
    expect((await readStores(second.page)).appSettings.app_exp).toBe('First editor draft');
    await setDescription(second.page, 'Concurrent editor saved a different value');
    expect(await saveCurrent(second.page)).toMatchObject({ dirty: false, serverVerified: true });
    gate.release();
    expect((await firstSave).error).toBeTruthy(); // Chrome masks thrown tool errors with native UnknownError.
    expect(await nativeCall(page, 'pwappy_get_save_status')).toMatchObject({ status: 'failed', dirty: true, serverSaved: true,
      serverVerified: false, error: expect.stringContaining('送信内容と一致しません') });
    expect(await readStores(page)).toEqual(firstDraft);
    expect(transport.decodedSaved().appSettings.app_exp).toBe('Concurrent editor saved a different value');
    expect(transport.writes).toHaveLength(2);
    // This is readback collision detection, not server-side optimistic locking.
    await expectFreshSaved(browser, baseURL!, transport);
  } finally {
    gate.release();
    await firstSave;
    await second?.context.close();
  }
});
