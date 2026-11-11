'use strict';

// Exercise the installed, unmodified readapi.php against disposable synthetic data.
// Never bootstrap WordPress, load its .env, or open an existing account/database.
const { spawn, execFileSync } = require('node:child_process');
const { createHash, generateKeyPairSync, sign } = require('node:crypto');
const { mkdtemp, mkdir, readFile, writeFile, rm, realpath } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const net = require('node:net');
const { gzipSync } = require('node:zlib');

const DEFAULT_PLUGIN = '/var/www/html/wordpress/wp-content/plugins/pwappy-plugin';
const phpString = value => "'" + value.replaceAll('\\', '\\\\').replaceAll("'", "\\'") + "'";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startIsolatedReadApi({ pluginDir = process.env.PWAPPY_WEBMCP_PLUGIN_DIR || DEFAULT_PLUGIN } = {}) {
  pluginDir = await realpath(pluginDir);
  const sourcePath = join(pluginDir, 'readapi.php');
  const source = await readFile(sourcePath);
  await readFile(join(pluginDir, 'vendor/autoload.php'));
  const sourceHash = createHash('sha256').update(source).digest('hex');
  const downloadSourcePath = join(pluginDir, 'src/Pwappy/UseCase/FileDownloadUseCase.php');
  const downloadSourceHash = createHash('sha256').update(await readFile(downloadSourcePath)).digest('hex');
  const root = await mkdtemp(join(tmpdir(), 'pwappy-readapi-isolated-'));
  let server;
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    if (server && server.exitCode === null && server.signalCode === null) {
      const stopped = new Promise(resolve => server.once('exit', resolve));
      server.kill('SIGTERM');
      await Promise.race([stopped, delay(2000)]);
      if (server.exitCode === null && server.signalCode === null) { server.kill('SIGKILL'); await stopped; }
    }
    // Only the exact random directory allocated by this invocation is disposable.
    if (resolve(root).startsWith(resolve(tmpdir()) + '/pwappy-readapi-isolated-')) await rm(root, { recursive: true, force: true });
  }
  try {
    const projects = join(root, 'projects');
    const envDir = join(root, 'empty-env');
    const versionDir = join(projects, 'webmcp1', 'fixture', 'v1');
    const assetsDir = join(versionDir, 'assets');
    await mkdir(join(assetsDir, 'images'), { recursive: true });
    await mkdir(envDir);
    await writeFile(join(assetsDir, 'test.txt'), 'isolated readapi fixture\n');
    await writeFile(join(assetsDir, 'index.html'), 'not returned in asset listings');
    await writeFile(join(versionDir, 'editorJsonVersion.txt'), 'v1');
    const editorData = {
      appSettings: { lang: 'ja', fixtureMarker: 'real-php-isolated', app_exp: 'Saved by isolated PHP fixture',
        app_header: '<link rel="stylesheet" href="https://unpkg.com/onsenui@2.12.8/css/onsenui-core.min.css"><link rel="stylesheet" href="https://unpkg.com/onsenui@2.12.8/css/onsen-css-components.min.css"><script src="https://unpkg.com/onsenui@2.12.8/js/onsenui.min.js"></script>',
        body_top: '', body_bottom: '', type_def_resource: '',
        projectSpec: { specification: 'Loaded from actual PHP compressed files', locks: { pages: [], scripts: [], globalCss: false }, pageMap: {} } },
      templateItems: { templates: [
        { id: 'php-app', domId: 'application', type: 'app', tagName: 'app', attributes: {}, children: [
          { id: 'php-nav', domId: 'navigator', tagName: 'ons-navigator', attributes: { page: 'home.html' }, children: [] }] },
        { id: 'php-page', domId: 'home.html', type: 'page', tagName: 'ons-page', attributes: { 'template-id': 'home.html' }, children: [
          { id: 'php-title', domId: 'php-title', type: 'element', tagName: 'h1', attributes: {}, text: 'Actual PHP editor fixture', children: [] }] }
      ], trashbox: [], forceReload: false },
      scriptItems: { scripts: [{ scriptName: 'phpFixtureValue', scriptType: 'function', comment: 'Synthetic read-only fixture',
        scriptValue: ['function phpFixtureValue() {', '  return "from-real-php-file";', '}'] }], trashbox: [] },
      attributeItems: [], eventItems: [], serviceWorkerItems: [], toolBoxItems: [],
      testItems: { mocks: [], scenarios: [{ id: 'php-scenario', name: 'Saved PHP test fixture', description: 'Read only, not executed',
        code: 'export default async function runTest() { return "php-fixture"; }', locked: false }] },
    };
    for (const [name, value] of Object.entries(editorData)) await writeFile(join(versionDir, name + '.json.gz'), gzipSync(JSON.stringify(value)));
    const fixtureFiles = [join(assetsDir, 'test.txt'), join(assetsDir, 'index.html'), join(versionDir, 'editorJsonVersion.txt'), ...Object.keys(editorData).map(name => join(versionDir, name + '.json.gz'))];
    const fixtureHashes = await Promise.all(fixtureFiles.map(async path => createHash('sha256').update(await readFile(path)).digest('hex')));

    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const body = Buffer.from(JSON.stringify({ sub: 'webmcp1', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const input = header + '.' + body;
    const cookie = 'pwappy_auth=' + input + '.' + sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');
    // The private key and authentication cookie stay in process memory, never logs/files.
    const config = {
      ALLOWED_ORIGINS: 'http://127.0.0.1:8093', PROJECT_DIR: projects,
      USER_SQLITE_FILE_NAME: 'database.sqlite', SQLITE_SCHEMA_VERSION: '202604031847',
      PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }), AUTH_COOKIE_NAME: 'pwappy_auth',
      ASSETS_DIR_NAME: 'assets', ADMAX_REMAINING_MAX: '10',
    };
    // Do not inherit process secrets, source .env, database credentials, or PHP prepend hooks.
    const env = { PATH: '/usr/bin:/bin', HOME: root, TMPDIR: root, XDEBUG_MODE: 'off', PWAPPY_ENV_DIR: envDir };
    const init = `<?php
$pdo = new PDO('sqlite:' . ${phpString(join(projects, 'webmcp1', 'database.sqlite'))});
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec(<<<'SQL'
CREATE TABLE pwappy_meta (key TEXT PRIMARY KEY, value TEXT);
INSERT INTO pwappy_meta VALUES ('schema_version', '202604031847');
CREATE TABLE pwappy_users (userId INTEGER PRIMARY KEY, sub TEXT, identKey TEXT, email TEXT, status TEXT, createdDate TEXT, updatedDate TEXT);
INSERT INTO pwappy_users (userId, identKey, status) VALUES (1, 'webmcp1', 'active');
CREATE TABLE pwappy_applications (appId INTEGER PRIMARY KEY, userId INTEGER, appName TEXT, appKey TEXT, archive INTEGER, createdDate TEXT, updatedDate TEXT);
INSERT INTO pwappy_applications (appId, userId, appName, appKey, archive) VALUES (1, 1, 'Isolated backend fixture', 'fixture', 0);
CREATE TABLE pwappy_application_versions (versionId INTEGER PRIMARY KEY, appId INTEGER, version TEXT, status TEXT, moderationStatus TEXT, moderationCheckedDate TEXT, fileModerationResults TEXT, appFilesSize INTEGER, assetsSpaceSize INTEGER, outputSpaceSize INTEGER, createdDate TEXT, updatedDate TEXT);
INSERT INTO pwappy_application_versions (versionId, appId, version, status, moderationStatus, appFilesSize, assetsSpaceSize, outputSpaceSize) VALUES (1, 1, 'v1', 'draft', 'not_checked', 100, 200, 0);
CREATE TABLE pwappy_application_daily_reports (userId INTEGER PRIMARY KEY, lastProcessedTime TEXT);
CREATE TABLE pwappy_user_settings (userId INTEGER PRIMARY KEY, aiCodingEnabled INTEGER, referralCode TEXT, referrerUserId INTEGER, createdDate TEXT, updatedDate TEXT);
INSERT INTO pwappy_user_settings (userId, aiCodingEnabled) VALUES (1, 0);
CREATE TABLE user_gemini_api_keys (userId INTEGER PRIMARY KEY, encryptedApiKey TEXT, createdDate TEXT, updatedDate TEXT);
SQL);
`;
    await writeFile(join(root, 'init.php'), init);
    execFileSync('/usr/bin/php', ['-d', 'auto_prepend_file=', '-d', 'auto_append_file=', join(root, 'init.php')], { env, cwd: root, timeout: 10000 });
    const router = `<?php
// No WordPress fallback or automatic static serving. Only these synthetic read routes.
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$_ENV = json_decode(${phpString(JSON.stringify(config))}, true);
putenv('PWAPPY_ENV_DIR=' . ${phpString(envDir)});
if ($path === '/rest/v1/file-download') {
    $isolatedRoot = ${phpString(root)};
    $isolatedPluginDir = ${phpString(pluginDir)};
    require ${phpString(join(__dirname, 'isolated-file-download.php'))};
    exit;
}
$allowed = ['/read/v1/publish-list', '/read/v1/application-list', '/read/v1/version-list', '/read/v1/file-list', '/read/v1/editor-json', '/read/v1/moderation-status', '/webmcp1/fixture/v1/test.txt'];
if (!in_array($_SERVER['REQUEST_METHOD'], ['GET', 'OPTIONS'], true)) { http_response_code(405); exit; }
if ($path === '/health') { header('Content-Type: text/plain'); echo 'isolated-readapi'; exit; }
if (!in_array($path, $allowed, true)) { http_response_code(404); exit; }
require ${phpString(sourcePath)};
http_response_code(501);
header('Content-Type: application/json');
echo json_encode(['error' => 'WordPress fallback deliberately disabled in isolated test']);
`;
    await writeFile(join(root, 'router.php'), router);
    const port = await freePort();
    const baseURL = 'http://127.0.0.1:' + port;
    let errors = '';
    server = spawn('/usr/bin/php', ['-d', 'auto_prepend_file=', '-d', 'auto_append_file=', '-d', 'display_errors=0', '-d', 'apc.enable_cli=0', '-S', '127.0.0.1:' + port, '-t', root, join(root, 'router.php')], { env, cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
    server.stderr.on('data', data => { errors = (errors + data.toString()).slice(-4000); });
    server.once('error', error => { errors = error.message; });
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (server.exitCode !== null) break;
      try { const response = await fetch(baseURL + '/health', { signal: AbortSignal.timeout(1000) }); ready = response.status === 200 && await response.text() === 'isolated-readapi'; } catch {}
      if (ready) break;
      await delay(50);
    }
    if (!ready) throw new Error('Isolated PHP startup failed: ' + errors);
    return {
      baseURL, cookie, sourceHash, downloadSourceHash, close,
      async request(path, { authenticated = true, method = 'GET' } = {}) {
        const url = new URL(path, baseURL);
        if (url.origin !== baseURL) throw new Error('Only this isolated loopback backend is allowed');
        return fetch(url, { method, headers: authenticated ? { cookie } : {}, signal: AbortSignal.timeout(5000) });
      },
      async verifySourceUnchanged() {
        return createHash('sha256').update(await readFile(sourcePath)).digest('hex') === sourceHash &&
          createHash('sha256').update(await readFile(downloadSourcePath)).digest('hex') === downloadSourceHash;
      },
      async verifyFixtureFilesUnchanged() {
        const after = await Promise.all(fixtureFiles.map(async path => createHash('sha256').update(await readFile(path)).digest('hex')));
        return after.every((hash, index) => hash === fixtureHashes[index]);
      },
    };
  } catch (error) { await close(); throw error; }
}

module.exports = { startIsolatedReadApi };
