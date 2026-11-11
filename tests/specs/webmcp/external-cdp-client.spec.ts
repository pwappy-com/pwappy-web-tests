import { test, expect } from '@playwright/test';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { boot } from './editor-fixture';

// Fresh Playwright-owned Chrome profile. Never connect to the user's browser/profile.
test.use({ channel:'chrome', launchOptions: { args: ['--enable-experimental-web-platform-features', '--remote-debugging-port=19230', '--remote-debugging-address=127.0.0.1'] } });
function client(url:string) {
  const child = spawn(process.execPath, [resolve('tests/tools/webmcp/stdio-cdp-client.cjs'), 'http://127.0.0.1:19230', url], { stdio:'pipe' }) as ChildProcessWithoutNullStreams;
  let id=0, stderr=''; const pending = new Map<number,{resolve:(v:any)=>void,reject:(e:Error)=>void}>();
  child.stderr.on('data',data=>stderr+=data.toString());
  createInterface({input:child.stdout}).on('line',line=>{const msg=JSON.parse(line);pending.get(msg.id)?.resolve(msg);pending.delete(msg.id);});
  child.on('exit',code=>{for(const p of pending.values())p.reject(new Error(`Client exited ${code}: ${stderr}`));});
  return { child, async rpc(method:string,params:any={}) {
    const request={jsonrpc:'2.0',id:++id,method,params};
    const result=new Promise<any>((resolve,reject)=>pending.set(request.id,{resolve,reject}));
    child.stdin.write(JSON.stringify(request)+'\n');return result;
  }};
}
test('Separate MCP stdio process discovers and invokes editor using native CDP, without page evaluation',async({page,browser},info)=>{
  const writes=await boot(page,'native');
  const external=client(page.url());
  try {
    const initialized=await external.rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'isolated-test-client',version:'1'}});
    expect(initialized.result.serverInfo.name).toBe('pwappy-isolated-cdp-readonly');
    const listing=await external.rpc('tools/list');
    expect(listing.result._meta.nativeDiscoveredCount).toBe(72);
    expect(listing.result.tools.map((t:any)=>t.name).sort()).toEqual(['pwappy_export_project','pwappy_get_application_json','pwappy_get_authoring_guide','pwappy_get_editor_context','pwappy_get_save_status','pwappy_list_asset_files','pwappy_read_asset_file']);
    const context=await external.rpc('tools/call',{name:'pwappy_get_editor_context',arguments:{}});
    expect(context.result.isError).toBeUndefined();
    expect(JSON.parse(context.result.content[0].text)).toMatchObject({appKey:'webmcp-fixture',version:'1'});
    const app=await external.rpc('tools/call',{name:'pwappy_get_application_json',arguments:{}});
    expect(app.result.content[0].text).toContain('fixture-page');
    const blocked=await external.rpc('tools/call',{name:'pwappy_save_project',arguments:{}});
    expect(blocked.error.message).toContain('read-only allowlist');
    expect(writes).toEqual([]);
    await writeFile(info.outputPath('external-client-evidence.json'),JSON.stringify({browser:browser.version(),transport:'Separate Node MCP stdio bridge -> CDP WebMCP.enable/invokeTool -> native browser registration',initialized,listing,context,blocked,writes},null,2));
    await info.attach('External CDP client evidence',{path:info.outputPath('external-client-evidence.json'),contentType:'application/json'});
    // Native removal notifications, still no JS execution to enumerate/invoke tools.
    await page.goto('about:blank');
    const after=await external.rpc('tools/list');
    expect(after.error.message).toContain('navigated outside');
  } finally { external.child.kill(); }
});

test('External MCP editor retrieves actual PHP saved editor stores and asset listing and bytes',async({page,browser},info)=>{
  const { startIsolatedReadApi } = require('../../tools/webmcp/isolated-readapi.cjs');
  const backend=await startIsolatedReadApi();
  const origin='http://127.0.0.1:8093';
  const writes:string[]=[],backendReads:{path:string,status:number}[]=[],downloads:any[]=[];
  let external:ReturnType<typeof client>|undefined;
  try {
    await page.context().route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url()),endpoint=url.pathname.split('/').pop();
      // This existing API uses POST for a read-only ZIP download. The production
      // use case creates only a temporary archive in the isolated fixture root.
      if(request.method()==='POST'&&endpoint==='file-download') {
        const body=request.postDataJSON();
        const response=await route.fetch({url:backend.baseURL+'/rest/v1/file-download',headers:{cookie:backend.cookie,'content-type':'application/json'}});
        downloads.push({body,status:response.status()});
        return route.fulfill({response});
      }
      if(!['GET','HEAD','OPTIONS'].includes(request.method()))writes.push(request.method()+' '+url.pathname);
      if(request.method()==='GET'&&['editor-json','file-list'].includes(endpoint!)) {
        const path='/read/v1/'+endpoint+url.search;
        const response=await route.fetch({url:backend.baseURL+path,headers:{cookie:backend.cookie}});
        backendReads.push({path,status:response.status()});
        return route.fulfill({response});
      }
      if(url.origin==='https://unpkg.com'&&url.pathname.startsWith('/onsenui/')&&request.method()==='GET') return route.fulfill({response:await route.fetch({url:request.url().replace('/onsenui/','/onsenui@2.12.8/')})});
      if(url.origin==='https://unpkg.com'&&url.pathname.startsWith('/onsenui@2.12.8/')&&request.method()==='GET')return route.continue();
      if(url.origin==='https://cdn.jsdelivr.net'&&/^\/npm\/(holderjs@2.9.9|@fortawesome\/fontawesome-free@6)\//.test(url.pathname)&&request.method()==='GET')return route.continue();
      if(url.origin===origin&&request.method()==='GET'&&!/\/(rest|read|v1)\//.test(url.pathname))return route.continue();
      return route.fulfill({json:{code:200,details:[],items:[],files:[]}});
    });
    await page.addInitScript(()=>{document.cookie='pwappy_login=isolated-test-only; path=/';localStorage.setItem('pwappy_tour_completed','true');});
    await page.goto('/app_editor.html?appKey=fixture&version=v1&identKey=webmcp1');
    await expect(page.locator('app-container-loading-overlay')).toBeHidden();
    external=client(page.url());
    await external.rpc('initialize');
    await expect.poll(async()=>{const listing=await external!.rpc('tools/list');return listing.result?._meta.nativeDiscoveredCount;}).toBe(72);
    const get=async(name:string,args:any={})=>{
      const result=await external!.rpc('tools/call',{name,arguments:args});
      expect(result.error,JSON.stringify(result)).toBeUndefined();expect(result.result.isError,JSON.stringify(result)).toBeUndefined();
      return JSON.parse(result.result.content[0].text);
    };
    const app=await get('pwappy_get_application_json');
    expect(JSON.stringify(app)).toContain('Actual PHP editor fixture');
    expect(JSON.stringify(app)).toContain('from-real-php-file');
    const exported=await get('pwappy_export_project');
    expect(exported.backup.metadata).toMatchObject({appKey:'fixture',appVersion:'v1'});
    expect(exported.backup.state.appSetting).toMatchObject({lang:'ja',app_exp:'Saved by isolated PHP fixture'});
    expect(exported.backup.state.scriptItems.scripts).toEqual(expect.arrayContaining([expect.objectContaining({scriptName:'phpFixtureValue'})]));
    expect(exported.backup.state.testItems.scenarios).toEqual(expect.arrayContaining([expect.objectContaining({id:'php-scenario',name:'Saved PHP test fixture'})]));
    expect(backendReads.some(r=>r.path.startsWith('/read/v1/editor-json?')&&r.status===200)).toBe(true);
    const beforeList=backendReads.length;
    const assets=await get('pwappy_list_asset_files',{appKey:'fixture',version:'v1',path:''});
    expect(assets.files).toEqual([expect.objectContaining({name:'test.txt',size:25,path:'test.txt',mimeType:'text/plain'})]);
    expect(assets.directories).toEqual([{name:'images',path:'images'}]);
    expect(backendReads.slice(beforeList).some(r=>r.path.startsWith('/read/v1/file-list?')&&r.status===200)).toBe(true);
    const status=await get('pwappy_get_save_status');
    const assetContent=await get('pwappy_read_asset_file',{appKey:'fixture',version:'v1',expectedRevision:status.revision,path:'',name:'test.txt',encoding:'text'});
    expect(assetContent).toMatchObject({appKey:'fixture',version:'v1',path:'test.txt',size:25,text:'isolated readapi fixture\n',base64:Buffer.from('isolated readapi fixture\n').toString('base64'),contentTrust:'untrusted-data'});
    expect(downloads).toEqual([{body:{appKey:'fixture',version:'v1',path:'',directories:[],files:['test.txt']},status:200}]);
    expect(writes).toEqual([]);
    expect(await backend.verifySourceUnchanged()).toBe(true);
    expect(await backend.verifyFixtureFilesUnchanged()).toBe(true);
    await writeFile(info.outputPath('external-php-editor-evidence.json'),JSON.stringify({browser:browser.version(),backendSourceHash:backend.sourceHash,downloadSourceHash:backend.downloadSourceHash,sourceAndFixtureFilesUnchanged:true,transport:'External MCP -> native CDP WebMCP -> actual PHP editor-json/file-list; asset bytes via real FileDownloadUseCase and native ZipArchive',adaptedDownloadBoundaries:['JWT gate','request/current-user/container','HTTP streaming; WordPress bootstrap not used'],app,exported,assets,assetContent,backendReads,downloads,writes},null,2));
    await info.attach('External MCP actual PHP editor and assets',{path:info.outputPath('external-php-editor-evidence.json'),contentType:'application/json'});
    await page.screenshot({path:info.outputPath('external-php-editor.png')});
  } finally {external?.child.kill();await backend.close();}
});

test('Separate MCP stdio process discovers and invokes native dashboard read-only tool',async({page,browser},info)=>{
  const origin='http://127.0.0.1:8093';
  const state={identKey:'isolated-routing-id',applications:[{appKey:'fixture',appName:'Fixture application'}],versions:[{appKey:'fixture',version:'v1',status:'draft'}]};
  const writes:string[]=[];
  await page.context().route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(!['GET','HEAD','OPTIONS'].includes(request.method()))writes.push(request.method()+' '+url.pathname);
    if(url.pathname.endsWith('/dashboard-init'))return route.fulfill({json:{code:200,details:{identKey:state.identKey,appList:state,notifications:[],usedDiskSpace:0}}});
    if(url.pathname.endsWith('/publish-list')||url.pathname.endsWith('/application-list'))return route.fulfill({json:{code:200,details:state}});
    if(url.origin===origin&&request.method()==='GET'&&!/\/(rest|read|v1)\//.test(url.pathname))return route.continue();
    return route.fulfill({json:{code:200,details:[],items:[],files:[]}});
  });
  await page.context().addCookies([{name:'pwappy_login',value:'isolated-test-only',url:origin}]);
  await page.goto('/index.html');
  await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
  const external=client(page.url());
  try {
    await external.rpc('initialize');
    let listing:any;
    await expect.poll(async()=>{listing=await external.rpc('tools/list');return listing.result?._meta.nativeDiscoveredCount;}).toBe(14);
    expect(listing.result.tools.map((t:any)=>t.name)).toEqual(['pwappy_list_apps']);
    const result=await external.rpc('tools/call',{name:'pwappy_list_apps',arguments:{}});
    expect(result.result.isError).toBeUndefined();
    expect(JSON.parse(result.result.content[0].text)).toMatchObject({origin,applications:state.applications,versions:state.versions,capabilities:{publish:false,delete:true}});
    const blocked=await external.rpc('tools/call',{name:'pwappy_create_app',arguments:{}});
    expect(blocked.error.message).toContain('read-only allowlist');
    expect(writes).toEqual([]);
    await writeFile(info.outputPath('external-dashboard-evidence.json'),JSON.stringify({browser:browser.version(),listing,result,blocked,writes},null,2));
    await info.attach('External dashboard client evidence',{path:info.outputPath('external-dashboard-evidence.json'),contentType:'application/json'});
  } finally { external.child.kill(); }
});

test('External MCP dashboard reads unchanged PHP readapi through isolated synthetic backend',async({page,browser},info)=>{
  const { startIsolatedReadApi } = require('../../tools/webmcp/isolated-readapi.cjs');
  const backend=await startIsolatedReadApi();
  const origin='http://127.0.0.1:8093';
  const writes:string[]=[],backendReads:{path:string,status:number}[]=[];
  let external:ReturnType<typeof client>|undefined;
  try {
    await page.context().route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(!['GET','HEAD','OPTIONS'].includes(request.method()))writes.push(request.method()+' '+url.pathname);
      const endpoint=url.pathname.split('/').pop();
      if(request.method()==='GET'&&endpoint==='dashboard-init') {
        // dashboard-init belongs to WordPress; never bootstrap it in this test.
        // Only its envelope is synthetic; initial appList also comes from real PHP.
        const response=await route.fetch({url:backend.baseURL+'/read/v1/publish-list',headers:{cookie:backend.cookie}});
        backendReads.push({path:'/read/v1/publish-list',status:response.status()});
        const payload=await response.json();
        const syntheticInitTime=new Date().toISOString();
        // Suppress the dashboard's unrelated daily-report billing POST during synthetic init.
        const appList={...payload.details,dailyReportLastTime:syntheticInitTime,serverTime:syntheticInitTime};
        return route.fulfill({json:{code:payload.code,details:{identKey:payload.details.identKey,appList,notifications:[],usedDiskSpace:0}}});
      }
      if(request.method()==='GET'&&['publish-list','application-list'].includes(endpoint!)) {
        const response=await route.fetch({url:backend.baseURL+'/read/v1/'+endpoint,headers:{cookie:backend.cookie}});
        backendReads.push({path:'/read/v1/'+endpoint,status:response.status()});
        return route.fulfill({response});
      }
      // No application writes or real service requests are ever forwarded.
      if(url.origin===origin&&request.method()==='GET'&&!/\/(rest|read|v1)\//.test(url.pathname))return route.continue();
      return route.fulfill({json:{code:200,details:[],items:[],files:[]}});
    });
    await page.context().addCookies([{name:'pwappy_login',value:'isolated-test-only',url:origin}]);
    await page.goto('/index.html');
    await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
    external=client(page.url());
    await external.rpc('initialize');
    let listing:any;
    await expect.poll(async()=>{listing=await external!.rpc('tools/list');return listing.result?._meta.nativeDiscoveredCount;}).toBe(14);
    const readCountBefore=backendReads.length;
    const result=await external.rpc('tools/call',{name:'pwappy_list_apps',arguments:{}});
    expect(result.result.isError).toBeUndefined();
    const parsed=JSON.parse(result.result.content[0].text);
    expect(parsed).toMatchObject({origin,capabilities:{publish:false,delete:true}});
    expect(parsed.applications).toEqual(expect.arrayContaining([expect.objectContaining({appKey:'fixture',appName:'Isolated backend fixture'})]));
    expect(parsed.versions).toEqual(expect.arrayContaining([expect.objectContaining({appKey:'fixture',version:'v1',status:'draft'})]));
    expect(backendReads.slice(readCountBefore)).toEqual(expect.arrayContaining([{path:'/read/v1/publish-list',status:200}]));
    expect(writes).toEqual([]);
    expect(await backend.verifySourceUnchanged()).toBe(true);
    await writeFile(info.outputPath('external-php-readapi-evidence.json'),JSON.stringify({browser:browser.version(),backendSourceHash:backend.sourceHash,backendSourceUnchanged:true,syntheticEndpoints:['dashboard-init envelope and daily-report timestamps only; app/version data fetched from real PHP publish-list'],transport:'MCP stdio -> Chrome native CDP WebMCP -> dashboard -> unchanged PHP readapi with isolated SQLite',listing,result,backendReads,writes},null,2));
    await info.attach('External MCP real PHP read evidence',{path:info.outputPath('external-php-readapi-evidence.json'),contentType:'application/json'});
  } finally { external?.child.kill(); await backend.close(); }
});
