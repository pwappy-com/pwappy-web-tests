import { test, expect, Page } from '@playwright/test';
import { gzipSync } from 'node:zlib';

const encode = (value: unknown) => gzipSync(JSON.stringify(value)).toString('base64');
const fixture = {
  code: 200, details: {
    editorJsonVersion: Buffer.from('1').toString('base64'),
    appSettings: encode({app_header: '<link rel="stylesheet" href="https://unpkg.com/onsenui@2.12.8/css/onsenui-core.min.css"><link rel="stylesheet" href="https://unpkg.com/onsenui@2.12.8/css/onsen-css-components.min.css"><script src="https://unpkg.com/onsenui@2.12.8/js/onsenui.min.js"></script>', body_top:'', body_bottom:'', type_def_resource:'', projectSpec:{locks:{pages:[],scripts:[],globalCss:false},specification:'Isolated WebMCP test',pageMap:{}}}),
    templateItems: encode({ templates: [{ id:'fixture-app', domId:'application',type:'app',tagName:'app',attributes:{},children:[{id:'fixture-nav',domId:'navigator',tagName:'ons-navigator',attributes:{page:'home.html'},children:[]}]},
      {id:'fixture-page',domId:'home.html',type:'page',tagName:'ons-page',attributes:{'template-id':'home.html'},explain:'Browser QA home',children:[
        {id:'fixture-title',domId:'qa-title',tagName:'h1',type:'element',attributes:{},text:'WebMCP Browser QA',children:[]}
      ]}
    ], trashbox:[], forceReload:false}),
    aiCodingEnabled:false,isUserGeminiApiKeyRegistered:false,
  }
};
export async function boot(page: Page, supported:boolean|'native'|'unmodified'=true, options: { saveFailure?:boolean, corruptReadback?:boolean, duringSave?:()=>Promise<void> }={}) {
  const writes: {url:string,method:string,body:string|null}[]=[];
  const saved = JSON.parse(JSON.stringify(fixture));
  await page.context().route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (!['GET','HEAD','OPTIONS'].includes(request.method())) writes.push({url:request.url(),method:request.method(),body:request.postData()});
    if (url.pathname.includes('/editor-json')) {
      if (request.method() !== 'GET') {
        if(options.saveFailure) return route.fulfill({json:{code:400,message:'ISOLATED_SAVE_REJECTED'}});
        saved.details = { ...saved.details, ...request.postDataJSON().editorJson, editorJsonVersion: Buffer.from(request.postDataJSON().editorJson.editorJsonVersion).toString('base64') };
        if(options.corruptReadback) saved.details.templateItems=fixture.details.templateItems;
        await options.duringSave?.();
      }
      return route.fulfill({json:request.method()==='GET' ? saved : {code:200,message:'Isolated save successful'}});
    }
    if (/file-list/.test(url.pathname)) return route.fulfill({json:{code:200,details:{files:[{name:'qa.png',size:68}],directories:[]}}});
    if (url.origin==='https://unpkg.com' && url.pathname.startsWith('/onsenui/')) return route.fulfill({response: await route.fetch({url:request.url().replace('/onsenui/', '/onsenui@2.12.8/')})});
    if (url.origin==='https://cdn.jsdelivr.net' && /^\/npm\/(holderjs@2.9.9|@fortawesome\/fontawesome-free@6)\//.test(url.pathname) && request.method()==='GET') return route.continue();
    if (url.origin==='https://unpkg.com' && url.pathname.startsWith('/onsenui@2.12.8/') && request.method()==='GET') return route.continue();
    // Only compiled localhost assets may reach a server. No API request reaches live data.
    if (url.origin === new URL(test.info().project.use.baseURL as string).origin && request.method()==='GET' && !/\/(rest|read)\//.test(url.pathname)) return route.continue();
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({code:200,details:[],items:[],files:[]})});
  });
  await page.addInitScript(({supported}) => {
    document.cookie='pwappy_login=isolated-test-only; path=/';
    localStorage.setItem('pwappy_tour_completed','true');
    (window as any).__webmcpTools = {};
    if (supported === 'native' || supported === 'unmodified') return;
    Object.defineProperty(document,'modelContext',{configurable:true,value:supported ? {
      registerTool(tool:any, options:any) {
        (window as any).__webmcpTools[tool.name]=tool;
        const remove=()=>delete (window as any).__webmcpTools[tool.name];
        options?.signal?.addEventListener('abort',remove,{once:true});
        return remove;
      }
    } : undefined});
  },{supported});
  await page.goto('/app_editor.html?appKey=webmcp-fixture&version=1&identKey=test');
  if (supported === 'native') await page.waitForFunction(async()=> { const testing=(navigator as any).modelContextTesting; const tools=testing ? testing.listTools() : await (document as any).modelContext?.getTools(); return tools?.some((tool:any)=>tool.name==='pwappy_get_application_json'); });
  else if (supported === true) await page.waitForFunction(()=>Object.keys((window as any).__webmcpTools).includes('pwappy_get_application_json'));
  await page.locator('app-container').waitFor();
  await expect(page.locator('app-container-loading-overlay')).toBeHidden();
  return writes;
}
export async function call(page:Page, name:string, args:any={}) {
  return page.evaluate(async ({name,args})=>{
    const tool=(window as any).__webmcpTools[name];
    if(!tool) throw new Error(`Missing tool ${name}`);
    return tool.execute(args);
  },{name,args});
}
