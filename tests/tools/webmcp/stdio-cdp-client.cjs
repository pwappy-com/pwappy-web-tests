/** Isolated development bridge. JSON-RPC MCP stdio -> Chrome native WebMCP CDP.
 * No page JavaScript evaluation, injected adapter, persistent config or credentials.
 * Only explicit read-only tools on one exact loopback page may be invoked.
 */
const { chromium } = require('playwright');
const readline = require('node:readline');
const allowed = new Set(['pwappy_get_editor_context', 'pwappy_get_application_json',
  'pwappy_get_authoring_guide', 'pwappy_get_save_status', 'pwappy_list_apps',
  'pwappy_list_asset_files', 'pwappy_read_asset_file', 'pwappy_export_project']);
const endpoint = new URL(process.argv[2]);
const pageUrl = new URL(process.argv[3]);
for (const u of [endpoint, pageUrl]) {
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || u.username || u.password) {
    throw new Error('Only credential-free IPv4 loopback HTTP endpoints are supported');
  }
}
let browser, session, page;
const tools = new Map(), responses = new Map(), pending = new Map();
const ready = (async () => {
  browser = await chromium.connectOverCDP(endpoint.href);
  page = browser.contexts().flatMap(c => c.pages()).find(p => p.url() === pageUrl.href);
  if (!page) throw new Error('Exact isolated page target not found');
  session = await page.context().newCDPSession(page);
  session.on('WebMCP.toolsAdded', ({ tools: added }) => added.forEach(t => tools.set(t.name, t)));
  session.on('WebMCP.toolsRemoved', ({ tools: removed }) => removed.forEach(t => tools.delete(t.name)));
  session.on('WebMCP.toolResponded', response => {
    if (pending.has(response.invocationId)) pending.get(response.invocationId)(response);
    else responses.set(response.invocationId, response);
  });
  await session.send('WebMCP.enable');
  await session.send('Page.getFrameTree'); // protocol ordering barrier, not JS evaluation
})();
async function dispatch(method, params) {
  await ready;
  if (method === 'initialize') return { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'pwappy-isolated-cdp-readonly', version: '1.0.0' } };
  if (method === 'ping') return {};
  const { frameTree } = await session.send('Page.getFrameTree');
  if (frameTree.frame.url !== pageUrl.href) throw new Error('Target navigated outside exact allowed page');
  if (method === 'tools/list') return { tools: [...tools.values()].filter(t => allowed.has(t.name)).map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema || { type:'object', properties:{} }, annotations: { readOnlyHint: true } })), _meta: { nativeDiscoveredCount: tools.size, transport: 'CDP WebMCP' } };
  if (method !== 'tools/call') throw new Error('Unsupported method');
  if (!allowed.has(params?.name)) throw new Error('Tool outside explicit read-only allowlist');
  const tool = tools.get(params.name);
  if (!tool) throw new Error('Native tool unavailable');
  const { invocationId } = await session.send('WebMCP.invokeTool', { frameId: tool.frameId, toolName: tool.name, input: params.arguments || {} });
  const response = responses.get(invocationId) || await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(invocationId); reject(new Error('Invocation timed out')); }, 10000);
    pending.set(invocationId, value => { clearTimeout(timeout); pending.delete(invocationId); resolve(value); });
  });
  responses.delete(invocationId);
  if (response.status !== 'Completed') return { isError: true, content: [{ type:'text', text: response.errorText || response.status }] };
  return { content: [{ type:'text', text: typeof response.output === 'string' ? response.output : JSON.stringify(response.output) }] };
}
readline.createInterface({ input: process.stdin }).on('line', async line => {
  let message;
  try {
    message = JSON.parse(line);
    if (message.id === undefined) return; // MCP notifications have no response
    const result = await dispatch(message.method, message.params);
    process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:message.id, result })+'\n');
  } catch(error) {
    process.stdout.write(JSON.stringify({ jsonrpc:'2.0', id:message?.id ?? null, error:{ code:-32602, message:error.message } })+'\n');
  }
}).on('close', async () => { if (session) await session.detach(); if (browser) await browser.close(); });
