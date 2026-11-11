'use strict';
// Linux-only launcher. Never inherits the host display, session bus, HOME, or credentials.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'linux') throw new Error('This clipboard harness requires Linux Xvfb and dbus-run-session.');
const source = path.resolve(process.argv[2] || path.join(__dirname, '../../../pwappy-web'));
if (!fs.existsSync(path.join(source, 'src/components/AgentChatWindow.js'))) {
  throw new Error('Pass the checked-out pwappy-web source directory as the first argument.');
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pwappy-manual-copy-'));
for (const name of ['home', 'runtime']) fs.mkdirSync(path.join(root, name), { mode: 0o700 });
const browsers = path.resolve(process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache/ms-playwright'));
if (!fs.existsSync(browsers)) throw new Error('Install the reviewed Playwright browsers separately; this harness never downloads software.');
const env = {
  PATH: process.env.PATH || '/usr/bin:/bin',
  HOME: path.join(root, 'home'), XDG_RUNTIME_DIR: path.join(root, 'runtime'),
  XDG_SESSION_TYPE: 'x11', GDK_BACKEND: 'x11', LANG: 'C.UTF-8',
  PLAYWRIGHT_BROWSERS_PATH: browsers,
  PWAPPY_CLIPBOARD_ROOT: root,
};
// Dedicated auth-file and a fresh X server prevent any host clipboard read/write.
const result = spawnSync('xvfb-run', ['-a', '--auth-file', path.join(root, 'Xauthority'),
  'dbus-run-session', '--', process.execPath, path.join(__dirname, 'run.cjs'), source], {
  env, stdio: 'inherit', timeout: 180000,
});
console.log(`Isolated clipboard results: ${path.join(root, 'results.json')}`);
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Isolated runner failed: status=${result.status}, signal=${result.signal}`);
