import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { bootNativeRuntime, nativeRuntimeCall, runtimeState } from './offline-runtime-fixture';

// Touch-capable desktop Chrome plus Pwappy's preview-device geometry, NOT an
// Android/iOS device, OS-back test or installed PWA. No persistent browser flags.
test.use({ channel: 'chrome', hasTouch: true, launchOptions: { args: ['--enable-experimental-web-platform-features'] } });

test('native-authored preview supports touch navigator/back across simulated mobile orientations', async ({ page, browser }, info) => {
  test.setTimeout(120_000);
  const { writes, structure } = await bootNativeRuntime(page);
  const observations: object[] = [];
  for (const os of ['android', 'ios']) {
    for (const orientation of ['portrait', 'landscape']) {
      const result = await nativeRuntimeCall(page, 'pwappy_set_preview_device', { os, width: 390, height: 844, orientation, scale: 75 });
      expect(result).toMatchObject({ realDevice: false, previewRecreated: true, preview: { ready: true, accessible: true } });
      const frame = page.frameLocator('platform-container iframe#renderzone');
      await expect(frame.locator('#runtimeTitle')).toBeVisible();
      const before = await runtimeState(page);
      const screenWidth = orientation === 'portrait' ? 390 : 844;
      const screenHeight = orientation === 'portrait' ? 844 : 390;
      // Android portrait and non-notch iOS portrait reserve visible system-bar
      // space. The content viewport is smaller than the simulated whole screen.
      expect(before).toMatchObject({ width: screenWidth, height: screenHeight - before.systemBarHeight, screenWidth, screenHeight, topPage: 'runtimeHome', pageCount: 1, note: '' });
      expect(before.touchPoints).toBeGreaterThan(0);
      const note = `${os} ${orientation} isolated note`;
      await frame.locator('#runtimeNote').fill(note);
      for (let cycle = 0; cycle < 2; cycle++) {
        await frame.locator('#runtimeForward').tap();
        await expect(frame.locator('#runtimeDetailText')).toBeVisible();
        const pushed = await runtimeState(page);
        expect(pushed).toMatchObject({ topPage: 'runtimeDetail', pageCount: 2, note, historyLength: before.historyLength });
        await frame.locator('#runtimeBack').tap();
        await expect(frame.locator('#runtimeTitle')).toBeVisible();
        await expect.poll(() => runtimeState(page)).toMatchObject({ topPage: 'runtimeHome', pageCount: 1, note, historyLength: before.historyLength });
      }
      const geometry = await frame.locator('#runtimeHomeContent').evaluate((content) => {
        const frameWidth = content.ownerDocument.defaultView!.innerWidth;
        return Array.from(content.querySelectorAll('input, ons-button, output')).map(node => {
          const rect = node.getBoundingClientRect();
          return { id: node.id, left: rect.left, right: rect.right, frameWidth };
        });
      });
      for (const item of geometry) {
        expect(item.left, `${item.id} must fit the simulated viewport`).toBeGreaterThanOrEqual(0);
        expect(item.right, `${item.id} must fit the simulated viewport`).toBeLessThanOrEqual(item.frameWidth);
      }
      observations.push({ os, orientation, device: result.device, state: await runtimeState(page), geometry });
      await page.locator('platform-container iframe#renderzone').screenshot({ path: info.outputPath(`runtime-${os}-${orientation}.png`) });
    }
  }
  expect(writes).toEqual([]);
  await writeFile(info.outputPath('mobile-runtime-evidence.json'), JSON.stringify({
    browser: browser.version(), structure, observations,
    verified: 'Native WebMCP-authored Pwappy pages/scripts/events in the actual action iframe; touch taps, navigator push/pop, preserved home input, repeated cycles and simulated geometry.',
    boundaries: ['Device changes recreate the iframe and reset transient runtime state.', 'Navigator push/pop does not add browser history entries. No automatic OS/browser-back integration is claimed.', 'No physical camera, physical touch device, installed PWA, deployed generated-app route, or mobile browser engine was tested.'],
  }, null, 2));
});

test('native-authored preview handles actual browser offline fetch and retries after reconnect', async ({ page, context, browser }, info) => {
  test.setTimeout(120_000);
  const { writes, endpoint } = await bootNativeRuntime(page);
  const responses: { status: number; fromServiceWorker: boolean }[] = [];
  const failures: string[] = [];
  page.on('response', response => {
    if (response.url() === endpoint) responses.push({ status: response.status(), fromServiceWorker: response.fromServiceWorker() });
  });
  page.on('requestfailed', request => {
    if (request.url() === endpoint) failures.push(request.failure()?.errorText || 'Unknown network failure');
  });
  const frame = page.frameLocator('platform-container iframe#renderzone');
  await frame.locator('#runtimeNote').fill('Keep this note across network loss');
  await frame.locator('#runtimeFetch').tap();
  await expect(frame.locator('#runtimeNetwork')).toHaveText('Online: local resource loaded');
  expect(responses).toEqual([{ status: 200, fromServiceWorker: false }]);
  await context.setOffline(true);
  try {
    await expect.poll(async () => (await runtimeState(page)).online).toBe(false);
    await frame.locator('#runtimeFetch').tap();
    await expect(frame.locator('#runtimeNetwork')).toHaveText('Network unavailable: retry when online');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('ERR_INTERNET_DISCONNECTED');
    expect(responses).toHaveLength(1);
    await frame.locator('#runtimeForward').tap();
    await expect(frame.locator('#runtimeDetailText')).toBeVisible();
    await frame.locator('#runtimeBack').tap();
    await expect(frame.locator('#runtimeNote')).toHaveValue('Keep this note across network loss');
    await page.locator('platform-container iframe#renderzone').screenshot({ path: info.outputPath('runtime-offline.png') });
  } finally {
    await context.setOffline(false);
  }
  await expect.poll(async () => (await runtimeState(page)).online).toBe(true);
  await frame.locator('#runtimeFetch').tap();
  await expect(frame.locator('#runtimeNetwork')).toHaveText('Online: local resource loaded');
  expect(responses).toEqual([{ status: 200, fromServiceWorker: false }, { status: 200, fromServiceWorker: false }]);
  await expect(frame.locator('#runtimeNote')).toHaveValue('Keep this note across network loss');
  const recovered = await runtimeState(page);
  expect(recovered).toMatchObject({ displayStandalone: false, serviceWorkerControlled: false, topPage: 'runtimeHome', pageCount: 1 });
  expect(writes).toEqual([]);
  await writeFile(info.outputPath('offline-runtime-evidence.json'), JSON.stringify({
    browser: browser.version(), endpoint, responses, failures, recovered,
    verified: 'Playwright browser-context network offline state, actual unmocked GET to local compiled resource, runtime error UI, in-memory navigation/input preservation and successful retry after reconnect.',
    boundaries: ['The editor was already loaded before network loss. Offline cold start and editor reload are not covered.', 'This is the real editor action preview with synthetic native app data. It does not register or run the generated app service worker.', 'Service workers are blocked by the isolated configuration. PWA install, cache/update lifecycle, background sync, browser/OS back and physical-device behavior remain unverified.'],
  }, null, 2));
});
