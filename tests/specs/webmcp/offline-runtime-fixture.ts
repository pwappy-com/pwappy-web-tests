import { expect, Page } from '@playwright/test';
import { boot } from './editor-fixture';

// This fixture is authored through native Pwappy tools, then rendered by the real
// editor. It does not append an unrelated demo directly to the preview DOM.
export async function nativeRuntimeCall(page: Page, name: string, args: object = {}) {
  return JSON.parse(await page.evaluate(async ({ name, args }) => {
    const context = (document as any).modelContext;
    const tool = (await context.getTools()).find((candidate: any) => candidate.name === name);
    if (!tool) throw new Error(`Missing native tool: ${name}`);
    return context.executeTool(tool, args);
  }, { name, args }));
}

const element = (tagName: string, domId: string, text = '', attributes: object = {}, children: object[] = []) =>
  ({ tagName, domId, attributes, children, ...(text ? { text } : {}) });

export async function bootNativeRuntime(page: Page) {
  const writes = await boot(page, 'native');
  const call = (name: string, args: object = {}) => nativeRuntimeCall(page, name, args);
  await call('pwappy_get_authoring_guide');
  await call('pwappy_manage_page', {
    action: 'update', templateId: 'home.html', newContent: element('ons-page', 'runtimeHome', '',
      { 'template-id': 'home.html' }, [
        element('div', 'runtimeHomeBackground', '', { class: 'page__background' }),
        element('div', 'runtimeHomeContent', '', { class: 'page__content', style: 'padding:16px;box-sizing:border-box' }, [
          element('h1', 'runtimeTitle', 'Pwappy runtime boundary'),
          element('label', 'runtimeLabel', 'Isolated note', { for: 'runtimeNote' }),
          element('input', 'runtimeNote', '', { type: 'text', value: '', style: 'display:block;width:100%;box-sizing:border-box;margin:12px 0' }),
          element('ons-button', 'runtimeForward', 'Open detail', { style: 'display:block;margin:12px 0' }),
          element('ons-button', 'runtimeFetch', 'Check local network', { style: 'display:block;margin:12px 0' }),
          element('output', 'runtimeNetwork', 'Not checked', { style: 'display:block;white-space:normal' }),
        ]),
      ]),
  });
  await call('pwappy_manage_page', {
    action: 'add', element: element('ons-page', 'runtimeDetail', '', { 'template-id': 'runtime-detail.html' }, [
      element('div', 'runtimeDetailBackground', '', { class: 'page__background' }),
      element('ons-toolbar', 'runtimeDetailToolbar', '', {}, [
        element('div', 'runtimeDetailLeft', '', { class: 'left' }, [
          element('ons-back-button', 'runtimeBack', 'Back'),
        ]),
        element('div', 'runtimeDetailCenter', 'Detail', { class: 'center' }),
      ]),
      element('div', 'runtimeDetailContent', '', { class: 'page__content', style: 'padding:16px;box-sizing:border-box' }, [
        element('p', 'runtimeDetailText', 'Native navigator detail page'),
      ]),
    ]),
  });
  await call('pwappy_manage_script', {
    action: 'upsert', scriptName: 'runtimeForward',
    scriptContent: 'function runtimeForward(event) { return document.getElementById("navigator").pushPage("runtime-detail.html", { animation: "none" }); }',
  });
  const endpoint = `${new URL(page.url()).origin}/serviceworkeritem.json?pwappy-runtime-network-probe=1`;
  await call('pwappy_manage_script', {
    action: 'upsert', scriptName: 'runtimeFetch',
    scriptContent: `async function runtimeFetch(event) {
      const output = document.getElementById('runtimeNetwork');
      output.textContent = 'Loading';
      try {
        const response = await fetch(${JSON.stringify(endpoint)}, { cache: 'no-store', credentials: 'omit' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        if (!Array.isArray(data) || !data.some(item => item.eventName === 'install')) throw new Error('Unexpected isolated resource');
        output.textContent = 'Online: local resource loaded';
      } catch (error) {
        output.textContent = 'Network unavailable: retry when online';
      }
    }`,
  });
  for (const targetDomId of ['runtimeForward', 'runtimeFetch']) {
    await call('pwappy_manage_event_binding', { action: 'attach', targetDomId, eventType: 'click', scriptName: targetDomId });
  }
  const structure = await call('pwappy_validate_project_structure');
  expect(structure).toMatchObject({ valid: true, errors: [], stats: { pageCount: 2, navigatorCount: 1 } });
  const authored = await call('pwappy_get_application_json');
  expect(JSON.stringify(authored)).toContain('runtime-detail.html');
  expect(JSON.stringify(authored)).not.toMatch(/"on(click|touchstart)"/);
  await call('pwappy_set_mode', { mode: 'action' });
  await call('pwappy_set_preview_device', { os: 'android', width: 390, height: 844, orientation: 'portrait', scale: 75 });
  await expect(page.frameLocator('platform-container iframe#renderzone').locator('#runtimeTitle')).toHaveText('Pwappy runtime boundary');
  expect(writes, 'Runtime fixture authoring must not save or change any backend').toEqual([]);
  return { writes, structure, endpoint };
}

export async function runtimeState(page: Page) {
  return page.locator('app-container').evaluate((host: any) => {
    const frame = host.editorSessionService.getIframe();
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const navigator = doc.getElementById('navigator');
    const deviceRoot = frame.getRootNode().host.getRootNode();
    const screen = deviceRoot.querySelector('.android-screen, .android-screen-side, .ios-screen, .ios-screen-side');
    const systemBarHeight = Array.from(deviceRoot.querySelectorAll('.dummy-statusbar, .dummy-navigationbar')).reduce((sum: number, node: any) => sum + node.offsetHeight, 0);
    return {
      online: win.navigator.onLine,
      width: win.innerWidth,
      height: win.innerHeight,
      screenWidth: screen.clientWidth,
      screenHeight: screen.clientHeight,
      systemBarHeight,
      touchPoints: win.navigator.maxTouchPoints,
      topPage: navigator.topPage?.id,
      pageCount: navigator.pages.length,
      historyLength: win.history.length,
      note: doc.getElementById('runtimeNote')?.value,
      networkText: doc.getElementById('runtimeNetwork')?.textContent,
      displayStandalone: win.matchMedia('(display-mode: standalone)').matches,
      serviceWorkerControlled: Boolean(win.navigator.serviceWorker?.controller),
    };
  });
}
