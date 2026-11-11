import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { probeNativeChrome } = require('../scripts/preflight-native-chrome.cjs');
function fixture({ version = '157.0.8192.0', pageURL = 'about:blank', unavailable = false } = {}) {
  const calls = [];
  let handler;
  const session = { async send(method) { calls.push(method); if (unavailable) throw Error('SYNTHETIC_PRIVATE_BROWSER_ERROR'); }, async detach() { calls.push('detach'); } };
  const context = {
    async route(pattern, callback) { calls.push(['route', pattern]); handler = callback; },
    async newPage() { calls.push('new-page'); return { url: () => pageURL }; },
    async newCDPSession() { calls.push('session'); return session; },
  };
  return { calls, get handler() { return handler; },
    launch: async options => { calls.push(['launch', options]); return {
      version: () => version, async newContext(options) { calls.push(['context', options]); return context; },
      async close() { calls.push('close'); },
    }; },
  };
}
test('early Chrome probe is empty-profile, network-denied and strictly native CDP', async () => {
  const probe = fixture();
  assert.equal(await probeNativeChrome(probe.launch), '157.0.8192.0');
  assert.deepEqual(probe.calls, [
    ['launch', { channel: 'chrome', headless: true, timeout: 30000, args: ['--enable-experimental-web-platform-features'] }],
    ['context', { storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' }],
    ['route', '**/*'], 'new-page', 'session', 'WebMCP.enable', 'detach', 'close',
  ]);
  let aborted = false;
  await probe.handler({ abort: async reason => { assert.equal(reason, 'blockedbyclient'); aborted = true; } });
  assert.equal(aborted, true);
});
test('unavailable native API fails and closes Chrome, without adapter fallback', async () => {
  const probe = fixture({ unavailable: true });
  await assert.rejects(probeNativeChrome(probe.launch));
  assert.deepEqual(probe.calls.slice(-3), ['WebMCP.enable', 'detach', 'close']);
});
test('probe rejects unsafe version metadata and any nonblank page before native invocation', async () => {
  for (const options of [{ version: 'SYNTHETIC_PRIVATE_VALUE\n' }, { pageURL: 'https://dev.pwappy-dev.com/' }]) {
    const probe = fixture(options);
    await assert.rejects(probeNativeChrome(probe.launch));
    assert.ok(!probe.calls.includes('WebMCP.enable')); assert.equal(probe.calls.at(-1), 'close');
  }
});
test('early workflow probe precedes live suite with no secret environment; guarded supplement remains after it', () => {
  const workflow = readFileSync(new URL('../.github/workflows/webmcp-branch-verification.yml', import.meta.url), 'utf8');
  const start = workflow.indexOf('      - name: Probe native WebMCP');
  const end = workflow.indexOf('      - name:', start + 1);
  const step = workflow.slice(start, end);
  assert.ok(start > workflow.indexOf('      - name: Install the selected Playwright browser'));
  assert.ok(end < workflow.indexOf('      - name: Run complete suite'));
  assert.match(step, /matrix\.suite == 'normal'.*matrix\.os == 'ubuntu-latest'.*matrix\.browser == 'chromium'/);
  assert.match(step, /run: node scripts\/preflight-native-chrome\.cjs/);
  assert.doesNotMatch(step, /secrets\.|\benv:/);
  assert.ok(workflow.indexOf('      - name: Verify native WebMCP against real staged persistence') > workflow.indexOf('      - name: Run complete suite'));
  const source = readFileSync(new URL('../scripts/preflight-native-chrome.cjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /process\.env|\.goto\(|\.evaluate\(|document\.modelContext/);
  assert.match(source, /console\.log\(`Native WebMCP Chrome preflight PASS; Chrome=\$\{version\}`\)/);
});
