import { Browser, Page, Route, expect } from '@playwright/test';
import { gunzipSync } from 'node:zlib';
import { boot } from './editor-fixture';

export const target = { appKey: 'webmcp-fixture', version: '1' };
export const persistedFields = ['appSettings', 'attributeItems', 'eventItems', 'scriptItems',
  'serviceWorkerItems', 'templateItems', 'toolBoxItems', 'testItems'] as const;
export type SaveBody = typeof target & { editorJson: Record<string, string> };
type WriteMode = 'success' | 'disconnected' | 'expired-auth' | 'applied-response-lost';

/**
 * A synthetic transport, NOT PHP/server-write coverage. Each PUT is produced by
 * the real compiled editor, and independently decoded in Node. No store/save
 * method is stubbed. The response envelope survives closing every browser
 * context, so a fresh editor must load the captured bytes, not its old stores.
 * Page routes take precedence over boot's context isolation route. All other
 * traffic retains boot's allowlist; no API mutation reaches a real service.
 */
export class PersistenceTransport {
  writes: SaveBody[] = [];
  applied: SaveBody[] = [];
  reads: { url: string, fromSavedPayload: boolean }[] = [];
  nextWrite: WriteMode = 'success';
  expireNextSavedRead = false;
  private saved?: Record<string, string>;
  private heldWrite?: { reached: () => void, released: Promise<void> };

  holdNextSuccessfulWrite() {
    let reached!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { reached = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    this.heldWrite = { reached, released };
    return { started, release };
  }

  async install(page: Page) {
    await page.route('**/*', async (route: Route) => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.endsWith('/editor-json')) return route.fallback();
      if (request.method() === 'GET') {
        expect(Object.fromEntries(url.searchParams)).toEqual(target);
        this.reads.push({ url: request.url(), fromSavedPayload: Boolean(this.saved) });
        if (!this.saved) return route.fallback(); // Existing isolated initial editor fixture only.
        if (this.expireNextSavedRead) {
          this.expireNextSavedRead = false;
          return route.fulfill({ status: 401, json: { code: 401, message: 'ISOLATED_AUTH_EXPIRED', data: { status: 'app_token_error' } } });
        }
        return route.fulfill({ json: { code: 200, details: this.saved } });
      }
      // No unrecognized API method can fall through to a real server.
      expect(request.method()).toBe('PUT');
      const body: SaveBody = request.postDataJSON();
      expect({ appKey: body.appKey, version: body.version }).toEqual(target);
      expect(Object.keys(body.editorJson).sort()).toEqual([...persistedFields, 'editorJsonVersion'].sort());
      this.writes.push(structuredClone(body));
      const mode = this.nextWrite;
      this.nextWrite = 'success';
      if (mode === 'disconnected') return route.abort('internetdisconnected');
      if (mode === 'expired-auth') {
        // Actual FetchMixin authentication-error branch, not only a generic 401.
        return route.fulfill({ status: 401, json: { code: 401, message: 'ISOLATED_AUTH_EXPIRED', data: { status: 'app_token_error' } } });
      }
      this.saved = { ...body.editorJson,
        editorJsonVersion: Buffer.from(body.editorJson.editorJsonVersion).toString('base64') };
      this.applied.push(structuredClone(body));
      if (mode === 'applied-response-lost') return route.abort('connectionreset');
      const held = this.heldWrite;
      this.heldWrite = undefined;
      if (held) { held.reached(); await held.released; }
      return route.fulfill({ json: { code: 200, message: 'Synthetic editor JSON accepted' } });
    });
  }

  decodedSaved() {
    expect(this.applied.length, 'A real editor PUT must precede saved-byte assertions').toBeGreaterThan(0);
    return decodeWrite(this.applied[this.applied.length - 1]);
  }
}

export function decodeWrite(body: SaveBody): Record<string, any> {
  return Object.fromEntries(persistedFields.map(field => [field,
    JSON.parse(gunzipSync(Buffer.from(body.editorJson[field], 'base64')).toString('utf8'))]));
}

/** Runtime rendering/test status is deliberately reinitialized on a new load. */
export function durableState(state: Record<string, any>): Record<string, any> {
  const copy = JSON.parse(JSON.stringify(state));
  delete copy.templateItems.forceReload;
  delete copy.testItems.executionState;
  return copy;
}

export async function nativeCall(page: Page, name: string, args: any = {}): Promise<any> {
  return JSON.parse(await page.evaluate(async ({ name, args }) => {
    const context = (document as any).modelContext;
    const tool = (await context.getTools()).find((candidate: any) => candidate.name === name);
    if (!tool) throw new Error(`Missing native WebMCP tool: ${name}`);
    return context.executeTool(tool, args);
  }, { name, args }));
}

export async function openEditor(page: Page, transport: PersistenceTransport) {
  await transport.install(page);
  await boot(page, 'native');
  await nativeCall(page, 'pwappy_get_authoring_guide');
}

export async function freshEditor(browser: Browser, baseURL: string, transport: PersistenceTransport) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 },
    storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });
  try {
    // No storageState export/import, browser profile reuse, or IndexedDB copy.
    expect(await context.storageState()).toEqual({ cookies: [], origins: [] });
    const page = await context.newPage();
    await openEditor(page, transport);
    return { page, context };
  } catch (error) { await context.close(); throw error; }
}

export async function readStores(page: Page): Promise<Record<string, any>> {
  return page.locator('app-container').evaluate((host: any) => ({
    appSettings: host.appSettingStore.getState().appSetting,
    attributeItems: host.attributeItemStore.getState().attributeItems.items,
    eventItems: host.eventItemStore.getState().eventItems.items,
    scriptItems: host.scriptItemStore.getState().scriptItems,
    serviceWorkerItems: host.serviceWorkerItemStore.getState().serviceworkerItems.items,
    templateItems: host.templateJsonStore.getState().templateJson,
    toolBoxItems: host.toolBoxItemStore.getState().toolboxItems.customItems,
    testItems: host.testItemStore.getState().testItems
  }), undefined, { timeout: 5000 });
}

export async function setDescription(page: Page, description: string) {
  const settings = await nativeCall(page, 'pwappy_get_app_settings');
  await nativeCall(page, 'pwappy_update_app_settings', { expectedRevision: settings.revision, description });
}

export async function saveCurrent(page: Page) {
  const status = await nativeCall(page, 'pwappy_get_save_status');
  return nativeCall(page, 'pwappy_save_project', { ...target, expectedRevision: status.revision });
}

export async function expectFreshSaved(browser: Browser, baseURL: string, transport: PersistenceTransport) {
  const fresh = await freshEditor(browser, baseURL, transport);
  try {
    const loaded = await readStores(fresh.page);
    expect(durableState(loaded)).toEqual(durableState(transport.decodedSaved()));
    expect(loaded.templateItems.forceReload).toBe(false);
    expect(loaded.testItems.executionState).toEqual({ isRunning: false, isCancelled: false, currentScenarioId: null, results: {} });
    expect(await nativeCall(fresh.page, 'pwappy_get_save_status')).toMatchObject({ dirty: false, status: 'idle', serverVerified: false });
    // A fresh load must not fabricate a verification result for this session.
    expect(transport.reads[transport.reads.length - 1].fromSavedPayload).toBe(true);
  } finally { await fresh.context.close(); }
}
