'use strict';
// Dedicated CI bridge, not a general-purpose authenticated browser server.
// No Runtime.evaluate, document.modelContext adapter, HTTP mock, or tool fallback.
const { chromium } = require('playwright');
const readline = require('node:readline');
const { ALLOWED, validateTarget, guardToolCall } = require('./staging-native-contract.cjs');
const [remote, target, token, appKey] = process.argv.slice(2);
const checked = validateTarget(remote, target, token, appKey);
if (process.env.PWAPPY_STAGING_NATIVE_GUARDED !== 'true') throw Error('Guarded staging wrapper required');
const tools = new Map(), completed = new Map(), pending = new Map();
let browser, session;
const ready = (async () => {
  browser = await chromium.connectOverCDP(checked.endpoint);
  const root = await browser.newBrowserCDPSession();
  const { arguments: args } = await root.send('Browser.getBrowserCommandLine');
  await root.detach();
  if (!args.includes('--pwappy-staging-native=' + token)
      || !args.some(arg => /^--user-data-dir=.*playwright_chromiumdev_profile-/.test(arg))) {
    throw Error('Dedicated temporary Playwright profile required');
  }
  const pages = browser.contexts().flatMap(context => context.pages()).filter(page => page.url() === checked.target);
  if (pages.length !== 1) throw Error('Exact unique synthetic editor page required');
  session = await pages[0].context().newCDPSession(pages[0]);
  session.on('WebMCP.toolsAdded', ({ tools: added }) => added.forEach(tool => tools.set(tool.name, tool)));
  session.on('WebMCP.toolsRemoved', ({ tools: removed }) => removed.forEach(tool => tools.delete(tool.name)));
  session.on('WebMCP.toolResponded', response => {
    if (pending.has(response.invocationId)) pending.get(response.invocationId)(response);
    else completed.set(response.invocationId, response);
  });
  try { await session.send('WebMCP.enable'); }
  catch { throw Error('Native Chrome CDP WebMCP unavailable; no fallback'); }
})();
// A failed early connection is observed by dispatch rather than emitted as an unhandled rejection.
ready.catch(() => {});
async function dispatch(method, params = {}) {
  await ready;
  if (method === 'initialize') return { protocolVersion: '2024-11-05', capabilities: { tools: {} },
    serverInfo: { name: 'pwappy-staging-native-smoke', version: '1.0.0' } };
  const { frameTree } = await session.send('Page.getFrameTree');
  if (frameTree.frame.url + (frameTree.frame.urlFragment || '') !== checked.target) throw Error('Target navigated; reconnect required');
  if (method === 'tools/list') return { tools: [...tools.values()].filter(tool => ALLOWED.includes(tool.name)).map(tool => ({ name: tool.name, inputSchema: tool.inputSchema || { type: 'object' } })), _meta: { nativeDiscoveredCount: tools.size } };
  if (method !== 'tools/call') throw Error('Unsupported method');
  const args = params.arguments || {};
  guardToolCall(params.name, args, appKey);
  const tool = tools.get(params.name);
  if (!tool) throw Error('Native tool unavailable');
  const { invocationId } = await session.send('WebMCP.invokeTool', { frameId: tool.frameId, toolName: tool.name, input: args });
  const response = completed.get(invocationId) || await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(invocationId); reject(Error('Native invocation timed out; do not replay writes')); }, 45000);
    pending.set(invocationId, value => { clearTimeout(timeout); pending.delete(invocationId); resolve(value); });
  });
  completed.delete(invocationId);
  if (response.status !== 'Completed') return { isError: true, content: [{ type: 'text', text: 'Native tool execution failed' }] };
  return { content: [{ type: 'text', text: typeof response.output === 'string' ? response.output : JSON.stringify(response.output) }] };
}
readline.createInterface({ input: process.stdin }).on('line', async line => {
  let message;
  try {
    if (Buffer.byteLength(line) > 16384) throw Error('Request too large');
    message = JSON.parse(line);
    if (message.id === undefined) return;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: await dispatch(message.method, message.params) }) + '\n');
  } catch {
    // Never forward browser errors, page data, cookies, URLs or arbitrary content.
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message?.id ?? null,
      error: { code: -32602, message: 'Dedicated native staging request failed' } }) + '\n');
  }
}).on('close', async () => { if (session) await session.detach().catch(() => {}); if (browser) await browser.close(); });
