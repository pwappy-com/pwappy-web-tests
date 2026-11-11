'use strict';
// Standalone localhost-only integration; intentionally no shared Playwright config/auth/env.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium, expect } = require('@playwright/test');
const { childEnvironment } = require('./isolation-options.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pwappy-generated-pwa-'));
const plugin = '/var/www/html/wordpress/wp-content/plugins/pwappy-plugin';
const checks = [], provenance = [];
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => server.close(resolve));
function generate(revision) {
 const value = execFileSync('php', ['-d', 'xdebug.mode=off', path.join(__dirname, 'generate-isolated-pwa.php'), root, plugin, revision], { env: childEnvironment(), encoding: 'utf8' });
 provenance.push(JSON.parse(value));
}
async function main() {
 let browser, context;
 generate('one');
 const output = provenance[0].output;
 const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(output, '.' + pathname, pathname.endsWith('/') ? 'index.html' : '');
  if (!file.startsWith(output + '/') || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json' };
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; worker-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'" });
  res.end(fs.readFileSync(file));
 });
 // Deny external traffic for every Chromium target including SW. Loopback bypass
 // is explicitly configured; this proxy has no forwarding or CONNECT implementation.
 const denied = [];
 const proxy = http.createServer((req, res) => { denied.push(req.url); res.writeHead(403).end(); });
 proxy.on('connect', (req, socket) => { denied.push(req.url); socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
 await listen(server); await listen(proxy);
 try {
  browser = await chromium.launch({ headless: true, proxy: { server: `http://127.0.0.1:${proxy.address().port}`, bypass: '127.0.0.1' }, args: ['--disable-background-networking'] });
  context = await browser.newContext({ serviceWorkers: 'allow', storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') console.error('Browser:', msg.text()); });
  await page.goto(base);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.equal(await page.locator('#revision').innerText(), 'one');
  assert.equal(await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.active.scriptURL)), base + 'service-worker.js');
  checks.push('real generated HTML registers module SW and controls page');
  assert.deepEqual(await page.evaluate(() => caches.keys()), ['fixture-one']);
  assert.equal(await page.evaluate(() => caches.open('fixture-one').then(c => c.keys()).then(keys => keys.length)), 5);
  checks.push('fixture install policy precaches five generated resources');
  const manifest = await page.evaluate(() => fetch(document.querySelector('link[rel=manifest]').href).then(r => r.json()));
  assert.equal(manifest.display, 'standalone'); assert.equal(manifest.start_url, './');
  checks.push('generator writes manifest and its HTML link');
  await context.setOffline(true); await page.reload();
  assert.equal(await page.locator('#revision').innerText(), 'one');
  checks.push('controlled generated page reloads offline');
  const second = await context.newPage(); await second.goto(base + 'offline.html');
  assert.equal(await second.locator('#offline').innerText(), 'Precached offline page');
  checks.push('previously unopened precached page opens offline in new tab');
  await second.close(); await context.setOffline(false);
  generate('two');
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  await expect.poll(() => page.evaluate(() => new Promise(resolve => {
   if (!navigator.serviceWorker.controller) return resolve(null);
   const channel = new MessageChannel();
   const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 500);
   channel.port1.onmessage = e => { clearTimeout(timer); channel.port1.close(); resolve(e.data); };
   navigator.serviceWorker.controller.postMessage('version', [channel.port2]);
  }))).toBe('two');
  await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(['fixture-two']);
  assert.deepEqual(await page.evaluate(() => caches.keys()), ['fixture-two']);
  await context.setOffline(true); await page.reload();
  assert.equal(await page.locator('#revision').innerText(), 'two');
  checks.push('regenerated SW activates, replaces old cache, serves updated HTML offline');
  assert.deepEqual(errors, []);
  checks.push('generated page has no uncaught browser exceptions');
  const report = { status: 'PASS', checks, root, provenance, deniedRequests: denied, limitations: ['Synthetic templates and SW policy use real private generator; not public publish/auth/DB workflow.', 'Desktop Chromium only; not physical Android/iOS or OS-installed PWA.', 'No default/off-the-shelf app cache policy is claimed.'] };
  fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
 } finally {
  await context?.close(); await browser?.close(); await close(server); await close(proxy);
 }
}
main().catch(error => { console.error(JSON.stringify({ status: 'FAIL', completed: checks, root, error: error.stack }, null, 2)); process.exitCode = 1; });
