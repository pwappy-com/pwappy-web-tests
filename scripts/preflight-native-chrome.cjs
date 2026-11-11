'use strict';
// Credential-free native capability probe: empty temporary Chrome profile and
// about:blank only. Never imports application helpers or dotenv.
async function probeNativeChrome(launch = options => require('playwright').chromium.launch(options)) {
  const browser = await launch({ channel: 'chrome', headless: true, timeout: 30000,
    args: ['--enable-experimental-web-platform-features'] });
  let session;
  try {
    const version = browser.version();
    if (!/^[0-9]{1,3}(?:\.[0-9]{1,5}){3}$/.test(version)) throw Error('Unexpected Chrome version');
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' });
    await context.route('**/*', route => route.abort('blockedbyclient'));
    const page = await context.newPage();
    if (page.url() !== 'about:blank') throw Error('Empty page required');
    session = await context.newCDPSession(page);
    await session.send('WebMCP.enable');
    return version;
  } finally {
    if (session) await session.detach().catch(() => {});
    await browser.close();
  }
}
module.exports = { probeNativeChrome };
if (require.main === module) {
  probeNativeChrome().then(version => {
    console.log(`Native WebMCP Chrome preflight PASS; Chrome=${version}`);
  }).catch(() => {
    console.error('::error::Native WebMCP Chrome preflight failed. Installed Chrome and native CDP WebMCP are required; no fallback or authentication was attempted.');
    process.exitCode = 1;
  });
}
