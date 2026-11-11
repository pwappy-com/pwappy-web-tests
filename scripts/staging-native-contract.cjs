'use strict';
// Exact synthetic payload allowlist shared by the stdio client and offline tests.
const { isDeepStrictEqual } = require('node:util');
const ORIGIN = 'https://dev.pwappy-dev.com';
const VERSION = '1.0.0';
const ASSET = { name: 'native-smoke.json', mimeType: 'application/json',
  text: '{"synthetic":true,"transport":"native-webmcp","value":427}\n' };
const SCRIPT = 'function nativeStagingValue(){ return "synthetic-native-staging-427"; }';
const CSS = '.native-staging-427 { color: rgb(12, 34, 56); }';
const DESCRIPTION = 'Synthetic native WebMCP staging persistence 427';
const READS = ['pwappy_get_editor_context', 'pwappy_get_authoring_guide', 'pwappy_get_application_json',
  'pwappy_get_save_status', 'pwappy_get_global_stylesheet', 'pwappy_get_app_settings', 'pwappy_export_project'];
const ALLOWED = [...READS, 'pwappy_list_asset_files', 'pwappy_read_asset_file', 'pwappy_manage_element',
  'pwappy_manage_script', 'pwappy_update_global_style', 'pwappy_update_app_settings',
  'pwappy_save_project', 'pwappy_upload_asset_file'];
const fail = () => { throw Error('Outside exact synthetic staging allowlist'); };
function validAppKey(value) { return typeof value === 'string' && /^wmcpstage-[a-f0-9]{20}$/.test(value); }
function validateTarget(endpoint, target, token, appKey) {
  let remote, page;
  try { remote = new URL(endpoint); page = new URL(target); } catch { fail(); }
  if (!/^[0-9a-f]{32}$/.test(token || '') || !validAppKey(appKey)
      || remote.protocol !== 'http:' || remote.hostname !== '127.0.0.1'
      || !/^[0-9]{4,5}$/.test(remote.port) || +remote.port < 1024 || +remote.port > 65535
      || remote.pathname !== '/' || remote.username || remote.password || remote.search || remote.hash
      || page.origin !== ORIGIN || page.pathname !== '/app_editor.html' || page.username || page.password
      || page.hash || [...page.searchParams.keys()].sort().join(',') !== 'appKey,identKey,version'
      || page.searchParams.get('identKey') !== 'pwuc000'
      || page.searchParams.get('appKey') !== appKey || page.searchParams.get('version') !== VERSION) fail();
  return { endpoint: remote.href, target: page.href };
}
function fixedPayloads(appKey) {
  if (!validAppKey(appKey)) fail();
  const target = { appKey, version: VERSION };
  return {
    pwappy_manage_element: { action: 'update_attribute', targetDomId: 'application', attribute: 'data-native-staging', value: 'synthetic-427' },
    pwappy_manage_script: { action: 'upsert', scriptName: 'nativeStagingValue', scriptContent: SCRIPT },
    pwappy_update_global_style: { css: CSS, mode: 'merge' },
    pwappy_update_app_settings: { description: DESCRIPTION },
    pwappy_save_project: target,
    pwappy_list_asset_files: { ...target, path: '' },
    pwappy_read_asset_file: { ...target, path: '', name: ASSET.name, encoding: 'text' },
    pwappy_upload_asset_file: { ...target, path: '', name: ASSET.name, mimeType: ASSET.mimeType,
      base64: Buffer.from(ASSET.text).toString('base64'), confirm: true },
  };
}
function guardToolCall(name, args, appKey) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || !ALLOWED.includes(name)) fail();
  if (READS.includes(name)) { if (!isDeepStrictEqual(args, {})) fail(); return; }
  const { expectedRevision, ...rest } = args;
  const revisionRequired = ['pwappy_save_project', 'pwappy_read_asset_file', 'pwappy_update_global_style', 'pwappy_update_app_settings'].includes(name);
  if (revisionRequired ? typeof expectedRevision !== 'string' || expectedRevision.length < 1 || expectedRevision.length > 512 : expectedRevision !== undefined) fail();
  if (!isDeepStrictEqual(rest, fixedPayloads(appKey)[name])) fail();
}
module.exports = { ORIGIN, VERSION, ASSET, SCRIPT, CSS, DESCRIPTION, ALLOWED, READS, validAppKey, validateTarget, fixedPayloads, guardToolCall };
