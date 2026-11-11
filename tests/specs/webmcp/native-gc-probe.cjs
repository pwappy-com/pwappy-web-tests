// Standalone browser-engine diagnostic. No app, server, auth, or network required.
// node tests/specs/webmcp/native-gc-probe.cjs
const { chromium } = require('@playwright/test');
(async () => {
  for (const channel of [undefined, 'chrome']) {
    const browser = await chromium.launch({ channel, args: ['--enable-experimental-web-platform-features'] });
    try {
      const page = await browser.newPage();
      await page.route('**/*', route => route.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated native GC probe</title>'}));
      await page.goto('http://127.0.0.1:8093/native-gc-probe');
      await page.evaluate(async () => {
        window.probeController = new AbortController();
        await (navigator.modelContext || document.modelContext).registerTool({
          name:'gc_probe', description:'Temporary isolated GC regression probe',
          inputSchema:{type:'object',properties:{}}, execute:async()=>({ok:true})
        }, {signal:window.probeController.signal});
      });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('HeapProfiler.collectGarbage');
      const result = await page.evaluate(async () => {
        window.probeController.abort();
        const tools = navigator.modelContextTesting ? navigator.modelContextTesting.listTools() : await document.modelContext.getTools();
        return {aborted:window.probeController.signal.aborted,remainingNames:tools.map(tool=>tool.name)};
      });
      console.log(JSON.stringify({browser:browser.version(),channel:channel||'bundled-chromium',...result}));
    } finally { await browser.close(); }
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
