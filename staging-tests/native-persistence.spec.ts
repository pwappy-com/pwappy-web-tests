import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createApp, deleteApp, gotoDashboard, openEditor } from '../tests/tools/dashboard-helpers';
import { ensureAuthenticated, generateIdentKey } from '../tests/constants';
const { ORIGIN, VERSION, ASSET, SCRIPT, DESCRIPTION, fixedPayloads, validateTarget } = require('../scripts/staging-native-contract.cjs');

const { emptyDiagnostic, ownEditorRequest, responseEvidence, sanitizeSnapshot, ERRORS, classifyBlockedRequest, emptyBlockedDiagnostic, recordBlockedRequest } = require('../scripts/staging-startup-diagnostic.cjs');

type Pending = { resolve: (result: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
function client(url: string, appKey: string) {
  const endpoint = `http://127.0.0.1:${process.env.PWAPPY_STAGING_NATIVE_PORT}`;
  validateTarget(endpoint, url, process.env.PWAPPY_STAGING_NATIVE_TOKEN, appKey);
  const clientEnv = { ...process.env };
  delete clientEnv.PWAPPY_TEST_LOGIN_PASSCODE;
  delete clientEnv.TEST_GEMINI_API_KEY;
  const child = spawn(process.execPath, [resolve('scripts/staging-native-stdio.cjs'), endpoint,
    url, process.env.PWAPPY_STAGING_NATIVE_TOKEN!, appKey], { stdio: ['pipe', 'pipe', 'ignore'], env: clientEnv });
  let id = 0;
  const pending = new Map<number, Pending>();
  const stopPending = () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error('Dedicated native client stopped')); } pending.clear(); };
  createInterface({ input: child.stdout }).on('line', line => {
    try {
      const message = JSON.parse(line), entry = pending.get(message.id);
      if (entry) { clearTimeout(entry.timer); pending.delete(message.id); entry.resolve(message); }
    } catch { stopPending(); }
  });
  child.on('error', stopPending); child.on('exit', stopPending);
  return {
    async close() {
      stopPending();
      if (child.exitCode !== null || child.signalCode !== null) return;
      const ended = new Promise<void>(done => child.once('exit', () => done()));
      child.kill(); await ended;
    },
    rpc(method: string, params: any = {}) {
      const request = { jsonrpc: '2.0', id: ++id, method, params };
      return new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(request.id); reject(Error('Native RPC timed out; mutation is not retried')); }, 50000);
        pending.set(request.id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify(request) + '\n');
      });
    },
  };
}

test('native staging edits and asset bytes persist after fresh-context reload', async ({ browser, context, page }) => {
  const { guard } = await import('../scripts/branch-verification-guard.mjs');
  let lastPhase = 'guard';
  const phase = (value: string) => { lastPhase = value; writeFileSync(process.env.PWAPPY_STAGING_NATIVE_PHASE_PATH!, JSON.stringify(value), { mode: 0o600 }); };
  phase('guard');
  if (process.env.PWAPPY_STAGING_NATIVE_GUARDED !== 'true') throw Error('Run only through the guarded staging wrapper');
  await guard('normal'); // Before login, PP preparation, navigation or mutation.
  expect(generateIdentKey('0', 'c')).toBe('pwuc000');
  const appKey = 'wmcpstage-' + randomBytes(10).toString('hex');
  const appName = 'Native staging synthetic';
  const payloads = fixedPayloads(appKey);
  const clients: ReturnType<typeof client>[] = [];
  let fresh: BrowserContext | undefined, editor: Page | undefined, cleanupNeeded = false;
  let external: ReturnType<typeof client>;
  const apiCounts = { create: 0, save: 0, upload: 0, assetRead: 0, deleted: 0, blocked: 0 };
  const blockedDiagnostic = emptyBlockedDiagnostic();
  const restrictWrites = async (targetContext: BrowserContext, contextKind: 'original' | 'fresh') => {
    await targetContext.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      const requestPhase = lastPhase;
      let parseFailed = false;
      if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return route.continue();
      // No synthetic responses: every permitted request goes to the real staged backend.
      let allowed = false;
      if (url.origin === ORIGIN && url.pathname.startsWith('/pwappy-api/rest/v1/') && !url.search) {
        const endpoint = url.pathname.slice('/pwappy-api/rest/v1/'.length);
        try {
          if (endpoint === 'file-upload' && method === 'POST') {
            const form = await new Response(request.postDataBuffer()!, { headers: { 'content-type': request.headers()['content-type'] } }).formData();
            const file = form.get('files[]') as File;
            allowed = isDeepStrictEqual([...form.keys()].sort(), ['appKey', 'files[]', 'path', 'version'])
              && form.get('appKey') === appKey && form.get('version') === VERSION && form.get('path') === ''
              && file.name === ASSET.name && file.type === ASSET.mimeType && await file.text() === ASSET.text;
            if (allowed) apiCounts.upload++;
          } else {
            const body = request.postDataJSON();
            // Normal dashboard's automatic test-account daily report. No purchases.
            if (endpoint === 'application/daily-report' && method === 'POST') allowed = isDeepStrictEqual(body, {});
            if (endpoint === 'application' && method === 'POST') { allowed = isDeepStrictEqual(body, { appKey, appName }); if (allowed) apiCounts.create++; }
            if (endpoint === 'application' && method === 'DELETE') { allowed = cleanupNeeded && isDeepStrictEqual(body, { appKey }); if (allowed) apiCounts.deleted++; }
            if (endpoint === 'editor-json' && method === 'PUT') {
              allowed = body?.appKey === appKey && body?.version === VERSION && body?.editorJson && typeof body.editorJson === 'object';
              if (allowed) apiCounts.save++;
            }
            if (endpoint === 'file-download' && method === 'POST') {
              allowed = isDeepStrictEqual(body, { appKey, version: VERSION, path: '', directories: [], files: [ASSET.name] });
              if (allowed) apiCounts.assetRead++;
            }
          }
        } catch { allowed = false; parseFailed = true; }
      }
      if (allowed) return route.continue();
      apiCounts.blocked++;
      recordBlockedRequest(blockedDiagnostic, classifyBlockedRequest(request.url(), method, requestPhase, contextKind, parseFailed));
      // Persist on each block as well as at completion, including interrupted cleanup.
      try { writeFileSync(process.env.PWAPPY_STAGING_NATIVE_BLOCKED_PATH!, JSON.stringify(blockedDiagnostic), { mode: 0o600 }); } catch {}
      return route.abort('blockedbyclient');
    });
    await targetContext.addInitScript(() => localStorage.setItem('pwappy_tour_completed', 'true'));
  };
  const connect = async (target: Page) => {
    external = client(target.url(), appKey); clients.push(external);
    const initialized = await external.rpc('initialize');
    expect(initialized.error).toBeUndefined();
    expect(initialized.result.serverInfo.name).toBe('pwappy-staging-native-smoke');
    await expect.poll(async () => {
      const listing = await external.rpc('tools/list');
      expect(listing.error).toBeUndefined();
      return listing.result?._meta.nativeDiscoveredCount;
    }).toBe(72);
    const listing = await external.rpc('tools/list');
    expect(listing.result.tools.map((tool: any) => tool.name)).toContain('pwappy_save_project');
  };
  const call = async (name: string, args: any = {}) => {
    const response = await external.rpc('tools/call', { name, arguments: args });
    expect(response.error).toBeUndefined(); expect(response.result.isError).toBeUndefined();
    return JSON.parse(response.result.content[0].text);
  };
  const readAsset = async () => {
    const status = await call('pwappy_get_save_status');
    const result = await call('pwappy_read_asset_file', { ...payloads.pwappy_read_asset_file, expectedRevision: status.revision });
    expect(result.text).toBe(ASSET.text);
    expect(result.base64).toBe(Buffer.from(ASSET.text).toString('base64'));
    expect(result.size).toBe(Buffer.byteLength(ASSET.text));
  };
  const startupDiagnostic = emptyDiagnostic();
  let startupSent: any;
  const observedResponses = new Set<Promise<void>>();
  // Passive observations only, restricted to this run's random owned app.
  context.on('request', request => {
    if (lastPhase !== 'editor-startup' || request.method() !== 'PUT') return;
    try {
      const body = request.postDataJSON();
      if (ownEditorRequest(request.url(), 'PUT', appKey, body)) startupSent = body.editorJson;
    } catch {}
  });
  context.on('response', response => {
    if (lastPhase !== 'editor-startup') return;
    const request = response.request(), method = request.method();
    let body: any;
    try { if (method === 'PUT') body = request.postDataJSON(); } catch { return; }
    if (!ownEditorRequest(response.url(), method, appKey, body)) return;
    const sent = startupSent;
    const pending = (async () => {
      let json: any;
      try { json = await response.json(); } catch {}
      Object.assign(startupDiagnostic, responseEvidence(method, response.status(), json, sent));
    })();
    observedResponses.add(pending);
    void pending.finally(() => observedResponses.delete(pending));
  });
  const captureStartup = async () => {
    // openEditor can throw before returning its page. Never inspect another app.
    const target = context.pages().find(candidate => {
      try { validateTarget(`http://127.0.0.1:${process.env.PWAPPY_STAGING_NATIVE_PORT}`, candidate.url(), process.env.PWAPPY_STAGING_NATIVE_TOKEN, appKey); return true; }
      catch { return false; }
    });
    if (target) {
      try {
      const snapshot = await target.locator('app-container').evaluateAll((nodes, expected) => {
        const url = new URL(location.href);
        if (url.origin !== expected.origin || url.pathname !== '/app_editor.html'
          || url.searchParams.get('appKey') !== expected.appKey || url.searchParams.get('version') !== expected.version) throw Error('Target changed');
        const errors = expected.errors;
        const container = nodes[0] as any;
        const status = container?._webMcpSaveStatus;
        const root = container?.shadowRoot;
        const tree = root?.querySelector('template-container')?.shadowRoot;
        const version = container?.editorJsonVersionStore?.getState()?.editorJsonVersion?.currentVersion;
        // Classify exact known errors inside the page. Raw errors never leave it.
        const error = Object.prototype.hasOwnProperty.call(errors, status?.error) ? status.error : '';
        return { saveStatus: ['saving', 'saved', 'failed'].includes(status?.status) ? status.status : 'unknown',
          serverSaved: typeof status?.serverSaved === 'boolean' ? status.serverSaved : null,
          serverVerified: typeof status?.serverVerified === 'boolean' ? status.serverVerified : null,
          initialVersionInit: typeof version === 'string' ? version === 'init' : null,
          starterVisible: !!root?.querySelector('starter-template-modal[visible]'),
          snapshotVisible: !!root?.querySelector('message-box[visible]'),
          pageNodes: tree?.querySelectorAll('#dom-tree .node[data-node-type="page"]').length || 0,
          navigatorNodes: tree?.querySelectorAll('#dom-tree .node[data-node-type="ons-navigator"]').length || 0, error };
      }, { errors: ERRORS, origin: ORIGIN, appKey, version: VERSION });
      Object.assign(startupDiagnostic, sanitizeSnapshot(snapshot));
      } catch { /* A closed/changed page must not suppress passive safe evidence. */ }
    }
    // Do not wait indefinitely for a failed network request during cleanup.
    await Promise.race([Promise.all([...observedResponses]), new Promise(resolve => setTimeout(resolve, 1000))]);
    writeFileSync(process.env.PWAPPY_STAGING_NATIVE_DIAGNOSTIC_PATH!, JSON.stringify(startupDiagnostic), { mode: 0o600 });
    startupSent = undefined;
  };
  const cleanupOutcome = { outcome: 'not-needed', deleteRequested: false, absenceVerified: false, blockedWrites: false };
  let primaryFailure: unknown, failurePhase: string | undefined;
  try {
    phase('native-preflight');
    // Availability is checked before authentication or creating any real records.
    const probe = await context.newCDPSession(page);
    try { await probe.send('WebMCP.enable' as any); }
    finally { await probe.detach(); }
    phase('authentication');
    const storageStatePath = await ensureAuthenticated('0', 'c');
    const state = JSON.parse(readFileSync(storageStatePath, 'utf8'));
    await context.addCookies(state.cookies);
    await restrictWrites(context, 'original');
    await gotoDashboard(page);
    await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
    await expect(page.locator('.app-card .app-key').filter({ hasText: appKey })).toHaveCount(0);
    phase('create-app');
    cleanupNeeded = true; // Includes uncertain completion of this one new-key create; never replay it.
    await createApp(page, appName, appKey);
    expect(apiCounts.create).toBe(1);
    phase('editor-startup');
    editor = await openEditor(page, context, appName, VERSION, { skipStarterModal: true });
    validateTarget(`http://127.0.0.1:${process.env.PWAPPY_STAGING_NATIVE_PORT}`, editor.url(), process.env.PWAPPY_STAGING_NATIVE_TOKEN, appKey);
    phase('native-discovery');
    await connect(editor);
    expect(await call('pwappy_get_editor_context')).toMatchObject({ appKey, version: VERSION });
    await call('pwappy_get_authoring_guide');
    phase('native-edit');
    await call('pwappy_manage_element', payloads.pwappy_manage_element);
    await call('pwappy_manage_script', payloads.pwappy_manage_script);
    const style = await call('pwappy_get_global_stylesheet');
    await call('pwappy_update_global_style', { ...payloads.pwappy_update_global_style, expectedRevision: style.revision });
    const settings = await call('pwappy_get_app_settings');
    await call('pwappy_update_app_settings', { ...payloads.pwappy_update_app_settings, expectedRevision: settings.revision });
    phase('asset-upload-read');
    expect((await call('pwappy_list_asset_files', payloads.pwappy_list_asset_files)).files.map((file: any) => file.name)).not.toContain(ASSET.name);
    expect(await call('pwappy_upload_asset_file', payloads.pwappy_upload_asset_file)).toMatchObject({ success: true, outcome: 'server-confirmed', published: false });
    expect(apiCounts.upload).toBe(1);
    await readAsset();
    phase('save');
    const status = await call('pwappy_get_save_status');
    expect(await call('pwappy_save_project', { ...payloads.pwappy_save_project, expectedRevision: status.revision })).toMatchObject({ serverVerified: true, dirty: false });
    const saved = await call('pwappy_export_project');
    const savedCss = await call('pwappy_get_global_stylesheet');
    expect(saved.backup.state.scriptItems.scripts.find((script: any) => script.scriptName === 'nativeStagingValue')?.scriptValue.join('\n')).toBe(SCRIPT);
    expect((await call('pwappy_get_application_json')).root.attributes['data-native-staging']).toBe('synthetic-427');
    expect(savedCss.css).toContain('.native-staging-427');
    expect((await call('pwappy_get_app_settings')).description).toBe(DESCRIPTION);
    expect(apiCounts.save).toBeGreaterThan(0);
    const url = editor.url();
    // Drop all editor memory, localStorage, IndexedDB and service workers. Only the
    // already-authorized cookie session crosses into the new, empty browser context.
    await external.close(); await editor.close(); editor = undefined;
    phase('fresh-context-readback');
    fresh = await browser.newContext({ storageState: { cookies: (await context.storageState()).cookies, origins: [] }, viewport: { width: 1280, height: 900 } });
    await restrictWrites(fresh, 'fresh');
    const reloaded = await fresh.newPage();
    await reloaded.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(reloaded.locator('app-container-loading-overlay')).toBeHidden();
    await connect(reloaded);
    const reopened = await call('pwappy_export_project');
    expect(reopened.backup.state.templateJson.templates).toEqual(saved.backup.state.templateJson.templates);
    expect(reopened.backup.state.scriptItems.scripts).toEqual(saved.backup.state.scriptItems.scripts);
    expect((await call('pwappy_get_global_stylesheet')).css).toBe(savedCss.css);
    expect((await call('pwappy_get_app_settings')).description).toBe(DESCRIPTION);
    expect((await call('pwappy_get_save_status')).dirty).toBe(false);
    expect((await call('pwappy_list_asset_files', payloads.pwappy_list_asset_files)).files.map((file: any) => file.name)).toContain(ASSET.name);
    await readAsset();
    expect(apiCounts.assetRead).toBe(2);
    expect(apiCounts.blocked).toBe(0);
  } catch (error) {
    primaryFailure = error; failurePhase = lastPhase;
    if (failurePhase === 'editor-startup') { try { await captureStartup(); } catch {} }
  }
  finally {
    phase('cleanup-close-clients');
    for (const connection of clients) await connection.close();
    phase('cleanup-close-contexts');
    await fresh?.close(); await editor?.close();
    if (cleanupNeeded) {
      cleanupOutcome.outcome = 'unknown';
      try {
        phase('cleanup-guard');
        await guard('normal'); // A changed deployment cannot be mutated by stale cleanup.
        phase('cleanup-delete');
        await deleteApp(page, appKey);
        phase('cleanup-verify-absence');
        await gotoDashboard(page);
        await expect(page.locator('.app-card .app-key').filter({ hasText: appKey })).toHaveCount(0);
        cleanupOutcome.absenceVerified = true;
        phase('cleanup-assertions');
        if (apiCounts.create === 1 && !primaryFailure) expect(apiCounts.deleted).toBe(1);
        expect(apiCounts.blocked).toBe(0);
        cleanupOutcome.outcome = apiCounts.deleted > 0 ? 'succeeded' : 'unknown';
      } catch (error) {
        cleanupOutcome.outcome = 'failed';
        if (!primaryFailure) { primaryFailure = error; failurePhase = lastPhase; }
      }
      cleanupOutcome.deleteRequested = apiCounts.deleted > 0;
      cleanupOutcome.blockedWrites = apiCounts.blocked > 0;
    }
  }
  try { writeFileSync(process.env.PWAPPY_STAGING_NATIVE_BLOCKED_PATH!, JSON.stringify(blockedDiagnostic), { mode: 0o600 }); } catch {}
  // Persist separately after cleanup so a secondary failure cannot hide behind startup.
  try { writeFileSync(process.env.PWAPPY_STAGING_NATIVE_CLEANUP_PATH!, JSON.stringify(cleanupOutcome), { mode: 0o600 }); } catch {}
  if (primaryFailure) { phase(failurePhase!); throw primaryFailure; }
  phase('complete');
});
