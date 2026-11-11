import { test, expect, Page } from '@playwright/test';
import { deflateRawSync } from 'node:zlib';
import { boot } from './editor-fixture';

test.use({ channel: 'chrome', launchOptions: { args: ['--enable-experimental-web-platform-features'] } });
const target = { appKey: 'webmcp-fixture', version: '1' };
const content: Record<string, Buffer> = {
  'note.txt': Buffer.from('Stored synthetic asset\n'),
  'docs/data.csv': Buffer.from('label,value\nsynthetic,42\n')
};
const crc32 = (bytes: Buffer) => {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
};
// Generate standard single-file ZIP fixtures independently of browser application code.
function zip(name: string, bytes: Buffer, deflated = false) {
  const filename = Buffer.from(name), packed = deflated ? deflateRawSync(bytes) : bytes;
  const local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(deflated ? 8 : 0, 8);
  local.writeUInt32LE(crc32(bytes), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(deflated ? 8 : 0, 10);
  central.writeUInt32LE(crc32(bytes), 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(filename.length, 28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + packed.length, 16);
  return Buffer.concat([local, filename, packed, central, filename, end]);
}
async function call(page: Page, name: string, args: any = {}) {
  return JSON.parse(await page.evaluate(async ({ name, args }) => {
    const model = (document as any).modelContext, tool = (await model.getTools()).find((tool: any) => tool.name === name);
    if (!tool) throw new Error(`Missing native tool: ${name}`);
    return model.executeTool(tool, args);
  }, { name, args }));
}
async function guarded(page: Page, name: string, args: any = {}) {
  const { revision } = await call(page, 'pwappy_get_save_status');
  return call(page, name, { ...target, expectedRevision: revision, ...args });
}
async function description(page: Page, value: string) {
  const settings = await call(page, 'pwappy_get_app_settings');
  return call(page, 'pwappy_update_app_settings', { expectedRevision: settings.revision, description: value });
}
async function fixture(page: Page) {
  await boot(page, 'native');
  let files = new Map(Object.entries(content));
  let directories = new Set(['docs']);
  let failurePath = '', corruptArchive = false;
  const uploads: any[] = [], mkdirs: any[] = [], downloads: any[] = [];
  await page.context().route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), endpoint = url.pathname.split('/').pop();
    if (req.method() === 'GET' && endpoint === 'file-list') {
      const path = url.searchParams.get('path') || '';
      const parent = (entry: string) => entry.includes('/') ? entry.substring(0, entry.lastIndexOf('/')) : '';
      return route.fulfill({ json: { code: 200, details: {
        files: [...files].filter(([name]) => parent(name) === path).map(([name, bytes]) => ({ name: name.split('/').pop(), size: bytes.length })),
        directories: [...directories].filter(name => parent(name) === path).map(name => ({ name: name.split('/').pop() }))
      } } });
    }
    if (req.method() === 'POST' && endpoint === 'file-download') {
      const body = req.postDataJSON(); downloads.push(body);
      const path = [body.path, body.files[0]].filter(Boolean).join('/');
      let archive = zip(body.files[0], files.get(path)!, path.endsWith('.csv'));
      if (corruptArchive) { archive = Buffer.from(archive); archive[30 + Buffer.byteLength(body.files[0])] ^= 1; }
      return route.fulfill({ contentType: 'application/zip', body: archive });
    }
    if (req.method() === 'POST' && endpoint === 'directory') {
      const body = req.postDataJSON(); mkdirs.push(body);
      directories.add([body.path, body.directory].filter(Boolean).join('/'));
      return route.fulfill({ json: { code: 200 } });
    }
    if (req.method() === 'POST' && endpoint === 'file-upload') {
      const form = await new Response(req.postDataBuffer()!, { headers: { 'content-type': req.headers()['content-type'] } }).formData();
      const file = form.get('files[]') as File, bytes = Buffer.from(await file.arrayBuffer());
      const path = [form.get('path'), file.name].filter(Boolean).join('/');
      uploads.push({ appKey: form.get('appKey'), version: form.get('version'), path: form.get('path'), name: file.name, mimeType: file.type, base64: bytes.toString('base64') });
      if (failurePath === path) return route.fulfill({ status: 503, json: { code: 503, message: 'Synthetic uncertain upload outcome' } });
      files.set(path, bytes);
      return route.fulfill({ json: { code: 200 } });
    }
    return route.fallback();
  });
  return {
    uploads, mkdirs, downloads,
    empty: () => { files = new Map(); directories = new Set(); },
    failAt: (path: string) => { failurePath = path; },
    corrupt: () => { corruptArchive = true; },
    entries: () => [...files].map(([path, bytes]) => ({ path, base64: bytes.toString('base64') }))
  };
}
async function exportEdited(page: Page) {
  await description(page, 'Archive export edited description');
  const exported = await guarded(page, 'pwappy_export_project_bundle');
  expect(exported).toMatchObject({ fileCount: 2, assetBytes: Object.values(content).reduce((sum, bytes) => sum + bytes.length, 0), includesAssetFiles: true, savedToFile: false, atomicSnapshot: false, restoreSupported: true });
  expect(exported.bundle).toMatchObject({ type: 'pwappy-project-bundle', formatVersion: 1, ...target, directories: ['docs'] });
  expect(JSON.stringify(exported.bundle.editorBackup.state)).toContain('Archive export edited description');
  expect(exported.bundle.files).toEqual(Object.entries(content).map(([path, bytes]) => ({ path, size: bytes.length, crc32: crc32(bytes).toString(16).padStart(8, '0'), mimeType: path.endsWith('.csv') ? 'text/csv' : 'text/plain', base64: bytes.toString('base64') })));
  return exported;
}

test('native stored and deflated asset ZIPs decode exact bytes text CRC and reject corruption', async ({ page }, info) => {
  const api = await fixture(page), results = [];
  for (const [path, bytes] of Object.entries(content)) {
    const parts = path.split('/'), name = parts.pop();
    const result = await guarded(page, 'pwappy_read_asset_file', { path: parts.join('/'), name, encoding: 'text' });
    expect(result).toEqual({ ...target, path, size: bytes.length, crc32: crc32(bytes).toString(16).padStart(8, '0'), base64: bytes.toString('base64'), text: bytes.toString(), contentTrust: 'untrusted-data' });
    results.push(result);
  }
  expect(api.downloads).toEqual([
    { ...target, path: '', directories: [], files: ['note.txt'] },
    { ...target, path: 'docs', directories: [], files: ['data.csv'] }
  ]);
  api.corrupt();
  await expect(guarded(page, 'pwappy_read_asset_file', { path: '', name: 'note.txt' })).rejects.toThrow();
  expect(api.uploads).toEqual([]); expect(api.mkdirs).toEqual([]);
  await info.attach('Verified archive read evidence', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
});

test('native project bundle exports actual assets and imports empty target with exact uploads', async ({ page }, info) => {
  const api = await fixture(page), exported = await exportEdited(page);
  expect(api.uploads).toEqual([]); expect(api.mkdirs).toEqual([]);
  api.empty();
  await description(page, 'Target before import');
  const result = await guarded(page, 'pwappy_import_project_bundle', { bundle: exported.bundle, confirmReplace: true, confirmPartialWrites: true });
  expect(result).toMatchObject({ success: true, editorImported: true, serverSaved: false, published: false, atomicNoOverwrite: false,
    completed: [{ kind: 'directory', path: 'docs' }, { kind: 'file', path: 'note.txt' }, { kind: 'file', path: 'docs/data.csv' }] });
  expect(api.mkdirs).toEqual([{ ...target, path: '', directory: 'docs' }]);
  expect(api.uploads).toEqual([
    { ...target, path: '', name: 'note.txt', mimeType: 'text/plain', base64: content['note.txt'].toString('base64') },
    { ...target, path: 'docs', name: 'data.csv', mimeType: 'text/csv', base64: content['docs/data.csv'].toString('base64') }
  ]);
  expect(api.entries()).toEqual(Object.entries(content).map(([path, bytes]) => ({ path, base64: bytes.toString('base64') })));
  expect((await call(page, 'pwappy_get_app_settings')).description).toBe('Archive export edited description');
  const snapshots = await call(page, 'pwappy_manage_snapshot', { action: 'list' });
  expect(snapshots.snapshots.some((snapshot: any) => snapshot.name === 'WebMCP - インポート直前')).toBe(true);
  await info.attach('Bundle import evidence', { body: JSON.stringify({ exported, result, uploads: api.uploads, mkdirs: api.mkdirs }, null, 2), contentType: 'application/json' });
});

test('native bundle collision and CRC preflight write nothing; partial upload failure stays explicit', async ({ page }, info) => {
  const api = await fixture(page), exported = await exportEdited(page);
  const importArgs = { bundle: exported.bundle, confirmReplace: true, confirmPartialWrites: true };
  await expect(guarded(page, 'pwappy_import_project_bundle', importArgs)).rejects.toThrow();
  expect(api.uploads).toEqual([]); expect(api.mkdirs).toEqual([]);
  api.empty();
  const invalid = structuredClone(exported.bundle); invalid.files[0].crc32 = '00000000';
  await expect(guarded(page, 'pwappy_import_project_bundle', { ...importArgs, bundle: invalid })).rejects.toThrow();
  expect(api.uploads).toEqual([]); expect(api.mkdirs).toEqual([]);
  await description(page, 'Must survive failed bundle import');
  api.failAt('docs/data.csv');
  const result = await guarded(page, 'pwappy_import_project_bundle', importArgs);
  expect(result).toMatchObject({ success: false, outcome: 'unknown', doNotRetry: true, editorImported: false, atomicNoOverwrite: false,
    completed: [{ kind: 'directory', path: 'docs' }, { kind: 'file', path: 'note.txt' }],
    remaining: [{ kind: 'file', path: 'docs/data.csv' }], uncertain: [{ kind: 'file', path: 'docs/data.csv' }] });
  expect(api.uploads).toHaveLength(2);
  expect(api.entries()).toEqual([{ path: 'note.txt', base64: content['note.txt'].toString('base64') }]);
  expect((await call(page, 'pwappy_get_app_settings')).description).toBe('Must survive failed bundle import');
  await info.attach('Bundle partial failure evidence', { body: JSON.stringify({ result, uploads: api.uploads, remainingMockFiles: api.entries() }, null, 2), contentType: 'application/json' });
});
