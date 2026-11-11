import { test, expect, Page } from '@playwright/test';
import { boot } from './editor-fixture';

test.use({ channel: 'chrome', launchOptions: { args: ['--enable-experimental-web-platform-features'] } });
const target = { appKey: 'webmcp-fixture', version: '1' };
const zipBase64 = 'UEsDBBQAAAAAAAAAIVyrtgp4FwAAABcAAAAKAAAAc291cmNlLnR4dElzb2xhdGVkIGFzc2V0IGZpeHR1cmUKUEsBAhQDFAAAAAAAAAAhXKu2CngXAAAAFwAAAAoAAAAAAAAAAAAAAIABAAAAAHNvdXJjZS50eHRQSwUGAAAAAAEAAQA4AAAAPwAAAAAA';
async function call(page: Page, name: string, args: any) {
  return JSON.parse(await page.evaluate(async ({ name, args }) => {
    const model = (document as any).modelContext;
    const tool = (await model.getTools()).find((tool: any) => tool.name === name);
    if (!tool) throw new Error(`Missing native tool: ${name}`);
    return model.executeTool(tool, args);
  }, { name, args }));
}
async function assetFixture(page: Page) {
  await boot(page, 'native');
  const files: Record<string, { name: string; size: number }[]> = {
    assets: [{ name: 'source.txt', size: 23 }, { name: 'taken.txt', size: 4 }], destination: [], copies: [], '': []
  };
  const directories: Record<string, { name: string }[]> = { assets: [{ name: 'folder' }], '': [], destination: [], copies: [] };
  const writes: any[] = []; const downloads: any[] = []; const uploads: any[] = [];
  let badZip = false;
  // A newer route takes precedence; all unhandled requests return to the fully isolated boot fixture.
  await page.context().route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), endpoint = url.pathname.split('/').pop();
    if (req.method() === 'GET' && endpoint === 'file-list') {
      const path = url.searchParams.get('path') || '';
      return route.fulfill({ json: { code: 200, details: { files: files[path] || [], directories: directories[path] || [] } } });
    }
    if (req.method() === 'POST' && endpoint === 'file-download') {
      downloads.push(req.postDataJSON());
      return route.fulfill({ contentType: 'application/zip', body: badZip ? Buffer.from('NOT ZIP') : Buffer.from(zipBase64, 'base64') });
    }
    if (req.method() === 'POST' && endpoint === 'file-upload') {
      const form = await new Response(req.postDataBuffer()!, { headers: { 'content-type': req.headers()['content-type'] } }).formData();
      const file = form.get('files[]') as File;
      const record = { method: req.method(), endpoint, appKey: form.get('appKey'), version: form.get('version'), path: form.get('path'), name: file.name, mimeType: file.type, base64: Buffer.from(await file.arrayBuffer()).toString('base64'), fields: [...form.keys()].sort() };
      uploads.push(record);
      (files[String(record.path)] ||= []).push({ name: file.name, size: file.size });
      return route.fulfill({ json: { code: 200 } });
    }
    if ((req.method() === 'PUT' && ['file', 'directory'].includes(endpoint!)) || (req.method() === 'POST' && ['file-move', 'file-copy'].includes(endpoint!))) {
      const body = req.postDataJSON(); writes.push({ method: req.method(), endpoint, body });
      if (req.method() === 'PUT') {
        const items = endpoint === 'file' ? files[body.path] : directories[body.path];
        items.find(item => item.name === body.oldName)!.name = body.newName;
      } else {
        for (const name of body.names) {
          const file = files[body.srcPath]?.find(item => item.name === name);
          const store = file ? files : directories;
          const source = store[body.srcPath].find(item => item.name === name)!;
          (store[body.destPath] ||= []).push({ ...source } as any);
          if (endpoint === 'file-move') store[body.srcPath] = store[body.srcPath].filter(item => item.name !== name) as any;
        }
      }
      return route.fulfill({ json: { code: 200 } });
    }
    return route.fallback();
  });
  return { files, directories, writes, downloads, uploads, corruptZip: () => { badZip = true; } };
}

test('native asset metadata ZIP download and rename move copy use exact isolated payloads', async ({ page }, info) => {
  const fixture = await assetFixture(page);
  const input = { ...target, path: 'assets', name: 'source.txt' };
  expect(await call(page, 'pwappy_get_asset_file', input)).toEqual({ ...target, name: 'source.txt', size: 23, path: 'assets/source.txt', mimeType: 'text/plain', url: 'assets/source.txt', urlKind: 'app-relative' });
  const downloaded = await call(page, 'pwappy_download_asset_file', input);
  expect(downloaded).toEqual({ ...target, path: 'assets/source.txt', name: 'source.txt.zip', mimeType: 'application/zip', archive: true, sourceName: 'source.txt', size: Buffer.from(zipBase64, 'base64').length, base64: zipBase64 });
  expect(fixture.downloads).toEqual([{ ...target, path: 'assets', directories: [], files: ['source.txt'] }]);
  expect(fixture.writes).toEqual([]);
  fixture.corruptZip();
  await expect(call(page, 'pwappy_download_asset_file', input)).rejects.toThrow();
  await expect(call(page, 'pwappy_rename_asset', { ...input, kind: 'file', newName: 'renamed.txt', confirm: false })).rejects.toThrow();
  await expect(call(page, 'pwappy_rename_asset', { ...input, kind: 'file', newName: 'taken.txt', confirm: true })).rejects.toThrow();
  await expect(call(page, 'pwappy_move_asset', { ...target, path: 'assets', name: 'folder', kind: 'directory', destinationPath: 'assets/folder/child', confirm: true })).rejects.toThrow();
  expect(fixture.writes).toEqual([]);
  expect(await call(page, 'pwappy_rename_asset', { ...input, kind: 'file', newName: 'renamed.txt', confirm: true })).toMatchObject({ success: true, outcome: 'server-confirmed', sourcePath: 'assets/source.txt', path: 'assets/renamed.txt', published: false, atomicNoOverwrite: false });
  expect(await call(page, 'pwappy_move_asset', { ...target, path: 'assets', name: 'renamed.txt', kind: 'file', destinationPath: 'destination', confirm: true })).toMatchObject({ success: true, sourcePath: 'assets/renamed.txt', path: 'destination/renamed.txt', published: false });
  expect(await call(page, 'pwappy_copy_asset', { ...target, path: 'destination', name: 'renamed.txt', kind: 'file', destinationPath: 'copies', confirm: true })).toMatchObject({ success: true, sourcePath: 'destination/renamed.txt', path: 'copies/renamed.txt', published: false });
  expect(await call(page, 'pwappy_rename_asset', { ...target, path: 'assets', name: 'folder', kind: 'directory', newName: 'renamed-folder', confirm: true })).toMatchObject({ success: true, path: 'assets/renamed-folder' });
  expect(fixture.writes).toEqual([
    { method: 'PUT', endpoint: 'file', body: { ...target, path: 'assets', oldName: 'source.txt', newName: 'renamed.txt' } },
    { method: 'POST', endpoint: 'file-move', body: { ...target, srcPath: 'assets', destPath: 'destination', names: ['renamed.txt'] } },
    { method: 'POST', endpoint: 'file-copy', body: { ...target, srcPath: 'destination', destPath: 'copies', names: ['renamed.txt'] } },
    { method: 'PUT', endpoint: 'directory', body: { ...target, path: 'assets', oldName: 'folder', newName: 'renamed-folder' } }
  ]);
  for (const path of ['destination', 'copies']) expect((await call(page, 'pwappy_list_asset_files', { ...target, path })).files.map((file: any) => file.name)).toEqual(['renamed.txt']);
  expect((await call(page, 'pwappy_list_asset_files', { ...target, path: 'assets' })).files.map((file: any) => file.name)).toEqual(['taken.txt']);
  await info.attach('Native asset payload evidence', { body: JSON.stringify({ downloaded, writes: fixture.writes, downloads: fixture.downloads }, null, 2), contentType: 'application/json' });
});

test('native CSV PDF MP4 WebM uploads preserve exact multipart bytes and reject bad signatures', async ({ page }, info) => {
  const fixture = await assetFixture(page);
  // These minimal synthetic payloads exercise signature checks, not PDF rendering or video playback.
  const assets = [
    { name: 'data.csv', mimeType: 'text/csv', bytes: Buffer.from('name,value\nfixture,123\n') },
    { name: 'document.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-1.7\n% synthetic fixture\n%%EOF\n') },
    { name: 'clip.mp4', mimeType: 'video/mp4', bytes: Buffer.from([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]) },
    { name: 'clip.webm', mimeType: 'video/webm', bytes: Buffer.from([26, 69, 223, 163, 128]) }
  ];
  for (const asset of assets) {
    const base64 = asset.bytes.toString('base64');
    if (asset.mimeType !== 'text/csv') await expect(call(page, 'pwappy_upload_asset_file', { ...target, path: 'uploads', name: asset.name, mimeType: asset.mimeType, base64: Buffer.from('invalid-signature').toString('base64'), confirm: true })).rejects.toThrow();
    const before = fixture.uploads.length;
    expect(await call(page, 'pwappy_upload_asset_file', { ...target, path: 'uploads', name: asset.name, mimeType: asset.mimeType, base64, confirm: true })).toMatchObject({ success: true, outcome: 'server-confirmed', path: `uploads/${asset.name}`, published: false, atomicNoOverwrite: false });
    expect(fixture.uploads.length).toBe(before + 1);
    expect(fixture.uploads.at(-1)).toEqual({ method: 'POST', endpoint: 'file-upload', ...target, path: 'uploads', name: asset.name, mimeType: asset.mimeType, base64, fields: ['appKey', 'files[]', 'path', 'version'] });
  }
  await expect(call(page, 'pwappy_upload_asset_file', { ...target, path: 'uploads', name: 'data.csv', mimeType: 'text/csv', base64: assets[0].bytes.toString('base64'), confirm: true })).rejects.toThrow();
  expect(fixture.uploads).toHaveLength(4);
  await info.attach('Native upload byte evidence', { body: JSON.stringify(fixture.uploads, null, 2), contentType: 'application/json' });
});
