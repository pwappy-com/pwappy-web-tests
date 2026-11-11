'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium, firefox, webkit, expect } = require('@playwright/test');

// Fail closed when invoked directly against a normal desktop/session.
const root = process.env.PWAPPY_CLIPBOARD_ROOT;
assert(root && path.isAbsolute(root), 'Use run-isolated.cjs, not this internal runner');
assert.equal(process.env.HOME, path.join(root, 'home'));
assert.equal(process.env.XDG_RUNTIME_DIR, path.join(root, 'runtime'));
assert.equal(process.env.XAUTHORITY, path.join(root, 'Xauthority'));
assert(fs.existsSync(process.env.XAUTHORITY));
assert(/^:\d+$/.test(process.env.DISPLAY || ''));
assert(process.env.DBUS_SESSION_BUS_ADDRESS && !process.env.WAYLAND_DISPLAY);

const marker = 'SYNTHETIC-CLIPBOARD-MARKER';
const schema = { type: 'object', properties: { answer: { type: 'string' } } };
const expected = marker + '\n\n### IMPORTANT: RESPONSE FORMAT ###\nPlease respond strictly in JSON format. Your output must conform to the following JSON Schema:\n\n' + JSON.stringify(schema, null, 2);
const results = [];

async function main() {
  const output = path.join(root, 'build');
  await require('./build.cjs')(path.resolve(process.argv[2]), output);
  const bundle = fs.readFileSync(path.join(output, 'component.js'));
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/component.js' ? 'application/javascript; charset=utf-8' : 'text/html; charset=utf-8');
    res.end(req.url === '/component.js' ? bundle : '<!doctype html><meta charset="utf-8"><link rel="stylesheet" data-name="fontawesomev6"><script src="/component.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
      for (const headless of [true, false]) {
        const browser = await type.launch({ headless, args: name === 'chromium' ? ['--ozone-platform=x11'] : [] });
        try {
          const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });
          await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin === origin && ['/', '/component.js'].includes(url.pathname) && route.request().method() === 'GET') return route.continue();
            return route.abort('blockedbyclient');
          });
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          page.on('dialog', dialog => dialog.dismiss());
          await page.goto(origin);
          await page.evaluate(async ({ marker, schema }) => {
            customElements.define('agent-chat-window', window.AgentModule.AgentChatWindow);
            const el = document.createElement('agent-chat-window');
            // No account, points API, real agent execution, or production controller state.
            el.showPwappyPoints = () => {};
            el.agentController = {
              lastPrompt: marker, getCurrentJsonSchema: () => schema, executionMode: 'manual', attachments: [], dispose() {},
              cancel() { el.agentState = { ...el.agentState, status: 'idle' }; },
            };
            el.agentState = { goal: 'synthetic', history: [{ type: 'log', text: 'synthetic' }], status: 'awaiting_manual_response', phase: 'architect', progress: null, aiResponseCount: 0 };
            el.style.display = 'block';
            document.body.append(el);
            await el.updateComplete;
            window.clipWrites = [];
            // Observe but never stub clipboard success: forward to the browser's real API.
            const original = navigator.clipboard.writeText.bind(navigator.clipboard);
            navigator.clipboard.writeText = async function(text) {
              const entry = { focused: document.hasFocus(), active: navigator.userActivation?.isActive, length: text.length };
              window.clipWrites.push(entry);
              try { await original(text); entry.ok = true; }
              catch (error) { entry.error = error.name + ': ' + error.message; throw error; }
            };
          }, { marker, schema });
          const button = page.locator('agent-chat-window #copy-combined-btn');
          async function probe(scenario, requireSuccess) {
            const count = await page.evaluate(() => window.clipWrites.length);
            const box = await button.boundingBox();
            assert(box && box.width > 0 && box.height > 0, 'Copy button must have a visible bounding box');
            // Native pointer input avoids locator stability RAF waits on a background tab.
            // The write observer and exact paste assertion still require the real click handler.
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            await expect.poll(() => page.evaluate(() => {
              const entry = window.clipWrites.at(-1);
              return entry?.ok || !!entry?.error;
            })).toBe(true);
            const writes = await page.evaluate(() => window.clipWrites);
            assert.equal(writes.length, count + 1);
            const write = writes.at(-1);
            if (requireSuccess) assert.equal(write.ok, true, `${name}/${headless}/${scenario}: ${write.error}`);
            // Unpermissioned headless Chromium is diagnostic: versions may change their default.
            if (!write.ok) assert.match(write.error, /^NotAllowedError:/);
            if (write.ok) {
              await expect(button).toContainText('コピー完了');
              const area = page.locator('agent-chat-window #manual-response-input');
              await area.fill('');
              await area.focus();
              // Read only after this exact probe's successful write of our synthetic marker.
              await page.keyboard.press('Control+V');
              await expect(area).toHaveValue(expected);
            }
            assert.deepEqual(errors, []);
            const row = { engine: name, version: browser.version(), headless, scenario, write, exactPasteVerified: !!write.ok };
            results.push(row);
            console.log(JSON.stringify(row));
            // Allow native paste/layout events to settle before switching browser tabs.
            await page.waitForTimeout(150);
          }
          const nativeRequired = name !== 'chromium' || !headless;
          await probe('native-foreground', nativeRequired);
          const other = await context.newPage();
          await other.goto(origin);
          await other.bringToFront();
          console.log(JSON.stringify({ engine: name, headless, scenario: 'other-tab-front', focused: await page.evaluate(() => document.hasFocus()) }));
          await probe('native-background', nativeRequired);
          await page.bringToFront();
          await probe('native-bringToFront', nativeRequired);
          if (name === 'chromium') {
            await context.grantPermissions(['clipboard-write'], { origin });
            await probe('grant-write-only', true);
            await other.bringToFront();
            await probe('grant-write-background', true);
            await page.bringToFront();
            await probe('grant-write-bringToFront', true);
          }
          await context.close();
        } finally { await browser.close(); }
      }
    }
    assert.equal(results.length, 24);
    assert(results.filter(row => row.exactPasteVerified).length >= 21);
  } finally {
    fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(results, null, 2));
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
