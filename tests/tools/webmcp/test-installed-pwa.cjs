'use strict';
// Actual CDP PWA installation in a read-only-root, private-network/DBus sandbox.
const fs = require('node:fs'), path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
if (process.argv[2] !== '--inside') {
 const root = fs.mkdtempSync('/tmp/pwappy-generated-pwa-');
 for (const name of ['home', 'runtime', 'config', 'data', 'cache', 'tmp']) fs.mkdirSync(path.join(root, name), { mode: 0o700 });
 const env = { PATH: '/usr/bin:/bin', HOME: root + '/home', XDG_RUNTIME_DIR: root + '/runtime', XDG_CONFIG_HOME: root + '/config', XDG_DATA_HOME: root + '/data', XDG_CACHE_HOME: root + '/cache', TMPDIR: root + '/tmp', DISPLAY: ':91', LANG: 'C.UTF-8', DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + root + '/no-session-bus', DBUS_SYSTEM_BUS_ADDRESS: 'unix:path=' + root + '/no-system-bus' };
 const result = spawnSync('/usr/bin/bwrap', ['--ro-bind', '/', '/', '--unshare-net', '--unshare-pid', '--unshare-ipc', '--tmpfs', '/run', '--tmpfs', '/tmp', '--bind', root, root, '--proc', '/proc', '--dev', '/dev', '--die-with-parent', process.execPath, __filename, '--inside', root], { env, stdio: 'inherit', timeout: 120000 });
 process.exit(result.status ?? 1);
}
const root = process.argv[3];
// Fail closed if --inside was invoked directly or the required mount isolation
// did not take effect. Never fall back to the normal desktop/profile.
assert.match(root || '', /^\/tmp\/pwappy-generated-pwa-[^/]+$/);
assert.equal(fs.realpathSync(root), root);
const mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8').trim().split('\n').map(line => line.split(' '));
assert.ok(mounts.some(fields => fields[4] === '/' && fields[5].split(',').includes('ro')), 'Read-only root required');
assert.ok(mounts.some(fields => fields[4] === '/run' && fields.includes('tmpfs')), 'Private /run required');
assert.ok(mounts.some(fields => fields[4] === '/tmp' && fields.includes('tmpfs')), 'Private /tmp required');
assert.equal(process.env.HOME, root + '/home');
assert.equal(process.env.XDG_DATA_HOME, root + '/data');
assert.equal(process.env.DBUS_SESSION_BUS_ADDRESS, 'unix:path=' + root + '/no-session-bus');
assert.equal(process.env.DBUS_SYSTEM_BUS_ADDRESS, 'unix:path=' + root + '/no-system-bus');
assert.equal(fs.readFileSync('/proc/net/route', 'utf8').trim().split('\n').length, 1, 'Private network without external routes required');
const checks = [], evidence = {};
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
async function main() {
 const display = spawn('/usr/bin/Xvfb', [':91', '-screen', '0', '1280x900x24', '-nolisten', 'tcp'], { stdio: ['ignore', fs.openSync(root + '/xvfb.log', 'w'), 'ignore'] });
 let context, server;
 try {
  await expect.poll(() => fs.existsSync('/tmp/.X11-unix/X91')).toBe(true);
  evidence.generator = JSON.parse(execFileSync('php', ['-d', 'xdebug.mode=off', path.join(__dirname, 'generate-isolated-pwa.php'), root, '/var/www/html/wordpress/wp-content/plugins/pwappy-plugin', 'one', '--installable'], { encoding: 'utf8' }));
  const output = evidence.generator.output;
  server = http.createServer((req, res) => {
   const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
   const file = path.resolve(output, '.' + pathname, pathname.endsWith('/') ? 'index.html' : '');
   if (!file.startsWith(output + '/') || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
   res.writeHead(200, { 'Content-Type': ({ '.png': 'image/png', '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json' })[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
   res.end(fs.readFileSync(file));
  });
  await listen(server);
  const base = `http://127.0.0.1:${server.address().port}/`;
  const launch = () => chromium.launchPersistentContext(root + '/profile', { executablePath: '/opt/google/chrome/chrome', headless: false, serviceWorkers: 'allow', args: ['--remote-debugging-port=0', '--disable-background-networking', '--password-store=basic'], env: process.env });
  context = await launch();
  const port = fs.readFileSync(root + '/profile/DevToolsActivePort', 'utf8').split('\n')[0];
  const protocol = await fetch(`http://127.0.0.1:${port}/json/protocol`).then(r => r.json());
  evidence.protocol = protocol.domains.find(domain => domain.domain === 'PWA');
  fs.writeFileSync(root + '/protocol-pwa.json', JSON.stringify(evidence.protocol, null, 2));
  evidence.chrome = await context.browser().version();
  const page = context.pages()[0];
  await page.goto(base); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  let cdp = await context.browser().newBrowserCDPSession();
  evidence.install = await cdp.send('PWA.install', { manifestId: base, installUrlOrBundleUrl: base });
  checks.push('CDP PWA.install completed for real generated PWA');
  evidence.installed = await cdp.send('PWA.getOsAppState', { manifestId: base });
  // CDP install defaults to browser-window preference on this Chrome build.
  // Set only this disposable app preference; this is not --app mode.
  await cdp.send('PWA.changeAppUserSettings', { manifestId: base, displayMode: 'standalone' });
  evidence.disposableAppDisplayPreference = 'standalone';
  const launchApp = async () => {
   const before = new Set(context.pages());
   const result = await cdp.send('PWA.launch', { manifestId: base });
   let app;
   await expect.poll(async () => {
    for (const candidate of context.pages()) {
     if (!before.has(candidate) && await candidate.evaluate(() => matchMedia('(display-mode: standalone)').matches).catch(() => false)) app = candidate;
    }
    return !!app;
   }).toBe(true);
   await app.waitForLoadState();
   await expect(app.locator('#revision')).toHaveText('one');
   assert.equal(await app.evaluate(() => matchMedia('(display-mode: standalone)').matches), true);
   const session = await context.newCDPSession(app);
   const { targetInfo } = await session.send('Target.getTargetInfo');
   await session.detach();
   return { cdpLaunchTargetId: result.targetId, observedPageTargetId: targetInfo.targetId, url: app.url(), standalone: true };
  };
  evidence.firstLaunch = await launchApp();
  checks.push('installed PWA launches actual standalone target, not --app emulation');
  const desktopFiles = fs.readdirSync(root + '/data/applications').filter(name => name.endsWith('.desktop'));
  assert.equal(desktopFiles.length, 1);
  evidence.desktopEntry = fs.readFileSync(root + '/data/applications/' + desktopFiles[0], 'utf8');
  assert.match(evidence.desktopEntry, /--app-id=/);
  assert.ok(evidence.desktopEntry.includes(root + '/profile'));
  checks.push('OS desktop registration created only inside disposable XDG data');
  await context.close(); context = undefined;
  await new Promise(resolve => server.close(resolve)); server = undefined;
  checks.push('all browser windows/process closed and origin HTTP server stopped');
  context = await launch();
  cdp = await context.browser().newBrowserCDPSession();
  evidence.afterRestart = await cdp.send('PWA.getOsAppState', { manifestId: base });
  evidence.offlineRestart = await launchApp();
  checks.push('installed PWA survives full Chrome restart and launches standalone offline with origin stopped');
  await cdp.send('PWA.uninstall', { manifestId: base });
  let uninstalled = false;
  try { await cdp.send('PWA.launch', { manifestId: base }); } catch (error) { uninstalled = /not installed|not found|No app|Unknown web-app|Failed to launch/i.test(error.message); evidence.uninstalledError = error.message; }
  assert.equal(uninstalled, true);
  await expect.poll(() => fs.existsSync(root + '/data/applications/' + desktopFiles[0])).toBe(false);
  checks.push('uninstall removes disposable installed app and its desktop entry');
  delete evidence.protocol;
  const report = { status: 'PASS', checks, evidence, root, isolation: 'bwrap read-only root; private network/PID/IPC; empty /run and private /tmp; writable owned root only; nonexistent DBus sockets; private Xvfb/HOME/XDG/profile', limitations: ['Synthetic installable manifest/icons and cache policy are real generator inputs.', 'Linux Chrome 157 in VMware, not Android/iOS physical devices.', 'Desktop registration confined to test HOME/XDG, not the user desktop.'] };
  fs.writeFileSync(root + '/installed-pwa-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
 } finally { await context?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve()); display.kill(); }
}
main().catch(error => { const report = { status: 'FAIL', checks, root, error: error.stack }; fs.writeFileSync(root + '/installed-pwa-report.json', JSON.stringify(report, null, 2)); console.error(JSON.stringify(report, null, 2)); process.exitCode = 1; });
