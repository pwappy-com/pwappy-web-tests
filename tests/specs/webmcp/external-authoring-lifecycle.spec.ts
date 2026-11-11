import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const token=randomUUID(), origin='http://127.0.0.1:8093';
const target={appKey:'external-lifecycle-fixture',version:'v1'};
test.use({channel:'chrome',launchOptions:{args:['--enable-automation','--enable-experimental-web-platform-features','--remote-debugging-port=19231','--remote-debugging-address=127.0.0.1','--pwappy-isolated-lifecycle='+token]}});
function client(url:string){
 const child=spawn(process.execPath,[resolve('tests/tools/webmcp/stdio-lifecycle-fixture-client.cjs'),'http://127.0.0.1:19231',url,token],{stdio:'pipe'});
 let id=0,stderr='';const pending=new Map<number,{resolve:(v:any)=>void,reject:(e:Error)=>void}>();
 child.stderr.on('data',d=>stderr+=d.toString());
 createInterface({input:child.stdout}).on('line',line=>{const msg=JSON.parse(line);pending.get(msg.id)?.resolve(msg);pending.delete(msg.id);});
 child.on('exit',code=>{for(const p of pending.values())p.reject(Error(`Client exited ${code}: ${stderr}`));});
 return {child,rpc(method:string,params:any={}){const request={jsonrpc:'2.0',id:++id,method,params};return new Promise<any>((resolve,reject)=>{pending.set(request.id,{resolve,reject});child.stdin.write(JSON.stringify(request)+'\n');});}};
}
const encode=(v:any)=>gzipSync(JSON.stringify(v)).toString('base64');
test('External native MCP creates app/version, navigates, edits, verifies save, archives/restores and deletes isolated fixture',async({page,browser},info)=>{
 const active:any={identKey:'isolated-lifecycle',applications:[],versions:[],dailyReportLastTime:'2026-11-10T12:00:00Z',serverTime:'2026-11-10T12:00:00Z'};
 const archived:any={applications:[],versions:[]};
 const saved:any={code:200,details:{editorJsonVersion:Buffer.from('1').toString('base64'),appSettings:encode({app_header:'',body_top:'',body_bottom:'',type_def_resource:'',projectSpec:{locks:{pages:[],scripts:[],globalCss:false},specification:'Isolated external lifecycle',pageMap:{}}}),templateItems:encode({templates:[{id:'lifecycle-app',domId:'application',type:'app',tagName:'app',attributes:{},children:[]}],trashbox:[],forceReload:false}),aiCodingEnabled:false,isUserGeminiApiKeyRegistered:false}};
 const requests:any[]=[],calls:any[]=[],registrations:any[]=[],navigation:any[]=[],clients:ReturnType<typeof client>[]=[];
 let external:ReturnType<typeof client>;
 await page.context().route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
  const endpoint=path.split('/').pop();
  if(/\/(rest|read|v1)\//.test(path)||!['GET','HEAD','OPTIONS'].includes(method))requests.push({method,path,query:Object.fromEntries(url.searchParams),body:!['GET','HEAD','OPTIONS'].includes(method)?req.postDataJSON():undefined});
  if(method==='OPTIONS')return route.fulfill({status:204});
  if(endpoint==='dashboard-init')return route.fulfill({json:{code:200,details:{identKey:active.identKey,appList:active,notifications:[],usedDiskSpace:0}}});
  if(['publish-list','application-list','archive-list'].includes(endpoint!))return route.fulfill({json:{code:200,details:endpoint==='archive-list'?archived:active}});
  if(method==='POST'&&endpoint==='application'){active.applications.push(req.postDataJSON());return route.fulfill({json:{code:200}});}
  if(method==='POST'&&endpoint==='version'){active.versions.push({...req.postDataJSON(),status:'draft'});return route.fulfill({json:{code:200}});}
  if((method==='POST'&&path.endsWith('/application/archive'))||(method==='PUT'&&path.endsWith('/application/restore'))){const [from,to]=method==='POST'?[active,archived]:[archived,active];to.applications.push(...from.applications);to.versions.push(...from.versions);from.applications=[];from.versions=[];return route.fulfill({json:{code:200}});}
  if(method==='DELETE'&&endpoint==='version'){const body=req.postDataJSON();active.versions=active.versions.filter((v:any)=>v.appKey!==body.appKey||v.version!==body.version);return route.fulfill({json:{code:200}});}
  if(method==='DELETE'&&endpoint==='application'){const body=req.postDataJSON();for(const view of [active,archived]){view.applications=view.applications.filter((a:any)=>a.appKey!==body.appKey);view.versions=view.versions.filter((v:any)=>v.appKey!==body.appKey);}return route.fulfill({json:{code:200}});}
  if(endpoint==='editor-json'){
   expect(active.versions).toContainEqual(expect.objectContaining(target));
   if(method==='PUT'){const data=req.postDataJSON();expect(data).toMatchObject(target);saved.details={...saved.details,...data.editorJson,editorJsonVersion:Buffer.from(data.editorJson.editorJsonVersion).toString('base64')};return route.fulfill({json:{code:200,message:'Isolated lifecycle saved'}});}
   if(method==='GET')return route.fulfill({json:saved});
  }
  // All API calls and all nonlocal traffic are intercepted. Only local static GETs pass.
  if(url.origin===origin&&method==='GET'&&!/\/(rest|read|v1)\//.test(path))return route.continue();
  return route.fulfill({json:{code:200,details:[],items:[],files:[]}});
 });
 await page.context().addCookies([{name:'pwappy_login',value:'isolated-test-only',url:origin}]);
 await page.addInitScript(()=>localStorage.setItem('pwappy_tour_completed','true'));
 const connect=async(expected:string)=>{external=client(page.url());clients.push(external);const init=await external.rpc('initialize');expect(init.error,JSON.stringify(init)).toBeUndefined();await expect.poll(async()=>{const r=await external.rpc('tools/list');expect(r.error,JSON.stringify(r)).toBeUndefined();return r.result.tools.map((t:any)=>t.name);}).toContain(expected);const listing=await external.rpc('tools/list');expect(listing.result._meta.nativeDiscoveredCount).toBe(expected==='pwappy_manage_script'?72:14);registrations.push({url:page.url(),...listing.result});};
 const call=async(name:string,args:any={})=>{const r=await external.rpc('tools/call',{name,arguments:args});expect(r.error,JSON.stringify(r)).toBeUndefined();expect(r.result.isError,JSON.stringify(r)).toBeUndefined();const parsed=JSON.parse(r.result.content[0].text);calls.push({name,args,result:parsed});return parsed;};
 const dashboardUrl=origin+'/index.html#'+token;
 try{
  await page.goto(dashboardUrl);await expect(page.locator('dashboard-loading-overlay')).toBeHidden();await connect('pwappy_create_app');
  const blocked=await external.rpc('tools/call',{name:'pwappy_create_app',arguments:{appKey:'not-the-fixture'}});expect(blocked.error.message).toContain('Outside exact fixture');
  expect(await call('pwappy_create_app',{appKey:target.appKey,appName:'External lifecycle fixture',expectedOrigin:origin,confirm:true,acknowledgeDailyCost:true})).toMatchObject({serverVerified:true});
  expect(await call('pwappy_create_version',{...target,expectedOrigin:origin,confirm:true})).toMatchObject({serverVerified:true});
  const editor=await call('pwappy_get_editor_url',target);expect(editor.navigated).toBe(false);expect(page.url()).toBe(dashboardUrl);
  const editorURL=new URL(editor.url);expect(editorURL.origin).toBe(origin);expect(editorURL.pathname).toBe('/app_editor.html');expect(Object.fromEntries(editorURL.searchParams)).toEqual({...target,identKey:'isolated-lifecycle'});editorURL.hash=token;
  const oldDashboard=external;
  await page.goto(editorURL.href);await expect(page.locator('app-container-loading-overlay')).toBeHidden();
  const staleDashboard=await oldDashboard.rpc('tools/list');expect(staleDashboard.error.message).toContain('reconnect required');oldDashboard.child.kill();
  navigation.push({from:dashboardUrl,to:editorURL.href,performedBy:'Playwright client navigation after validating tool-returned URL',staleClient:staleDashboard});
  await connect('pwappy_manage_script');
  const chooser=page.locator('starter-template-modal[visible]');
  await expect(chooser).toBeVisible();
  await page.screenshot({path:info.outputPath('external-lifecycle-empty-chooser.png'),fullPage:true});
  await call('pwappy_get_authoring_guide');
  await call('pwappy_get_project_summary');
  const initialApplication=await call('pwappy_get_application_json');
  expect(initialApplication.root.children).toEqual([]);expect(initialApplication.pages).toEqual([]);
  await call('pwappy_manage_element',{action:'add_first_child',targetDomId:'application',element:{tagName:'ons-navigator',domId:'externalNavigator',attributes:{},children:[],explain:'隔離テスト画面遷移'}});
  await call('pwappy_manage_page',{action:'add',element:{tagName:'ons-page',domId:'externalHome',attributes:{'template-id':'home.html'},children:[{tagName:'div',domId:'externalBackground',attributes:{class:'page__background'},children:[]},{tagName:'div',domId:'externalContent',attributes:{class:'page__content'},children:[{tagName:'h1',domId:'externalTitle',attributes:{},text:'External native authoring',children:[]}]}],explain:'隔離テストホーム'}});
  await call('pwappy_manage_element',{action:'update_attribute',targetDomId:'externalNavigator',attribute:'page',value:'home.html'});
  await call('pwappy_manage_element',{action:'update_attribute',targetDomId:'externalHome',attribute:'data-lifecycle',value:'constructed-under-modal'});
  const structure=await call('pwappy_validate_project_structure');
  expect(structure).toMatchObject({valid:true,errors:[],stats:{appRootCount:1,pageCount:1,navigatorCount:1}});
  const constructedApplication=await call('pwappy_get_application_json');
  expect(constructedApplication.root.children).toEqual([expect.objectContaining({domId:'externalNavigator',attributes:{page:'home.html'}})]);
  expect(constructedApplication.pages).toEqual([expect.objectContaining({domId:'externalHome',attributes:{'template-id':'home.html','data-lifecycle':'constructed-under-modal'}})]);
  await expect(chooser).toBeVisible();
  await call('pwappy_manage_script',{action:'upsert',scriptName:'externalLifecycleValue',scriptContent:'function externalLifecycleValue(){ return "saved-external-lifecycle"; }'});
  const status=await call('pwappy_get_save_status');
  expect(await call('pwappy_save_project',{...target,expectedRevision:status.revision})).toMatchObject({serverVerified:true});
  expect(gunzipSync(Buffer.from(saved.details.scriptItems,'base64')).toString()).toContain('saved-external-lifecycle');
  const saveIndex=requests.findIndex(r=>r.method==='PUT'&&r.path.endsWith('/editor-json'));
  expect(saveIndex).toBeGreaterThan(-1);expect(requests.slice(saveIndex+1).some(r=>r.method==='GET'&&r.path.endsWith('/editor-json'))).toBe(true);
  const persistedTemplates=JSON.parse(gunzipSync(Buffer.from(saved.details.templateItems,'base64')).toString());
  expect(persistedTemplates.templates).toHaveLength(2);
  expect(persistedTemplates.templates[0].children[0]).toMatchObject({domId:'externalNavigator',attributes:{page:'home.html'}});
  expect(persistedTemplates.templates[1]).toMatchObject({domId:'externalHome',attributes:{'template-id':'home.html','data-lifecycle':'constructed-under-modal'}});
  await expect(chooser).toBeVisible();
  await page.screenshot({path:info.outputPath('external-lifecycle-saved-editor.png'),fullPage:true});
  const oldEditor=external;await page.goto(dashboardUrl);await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
  const staleEditor=await oldEditor.rpc('tools/call',{name:'pwappy_save_project',arguments:{...target,expectedRevision:status.revision}});expect(staleEditor.error.message).toContain('reconnect required');oldEditor.child.kill();
  navigation.push({from:editorURL.href,to:dashboardUrl,performedBy:'Playwright client navigation to exact fixture dashboard',staleClient:staleEditor});
  await connect('pwappy_delete_version');
  const appGuard={appKey:target.appKey,expectedOrigin:origin,confirm:true};
  expect(await call('pwappy_archive_app',{...appGuard,acknowledgeDailyCost:true,acknowledgeCost:true})).toMatchObject({serverVerified:true});
  expect(active.applications).toEqual([]);expect(archived.applications).toHaveLength(1);
  expect(await call('pwappy_restore_app',{...appGuard,acknowledgeDailyCost:true,acknowledgeCost:true})).toMatchObject({serverVerified:true});
  expect(active.applications).toHaveLength(1);expect(archived.applications).toEqual([]);
  expect(await call('pwappy_delete_version',{...appGuard,version:target.version,confirmIrreversible:true})).toMatchObject({serverVerified:true});
  expect(await call('pwappy_delete_app',{...appGuard,confirmIrreversible:true,archived:false,expectedVersions:[]})).toMatchObject({serverVerified:true});
  expect(active.applications).toEqual([]);expect(active.versions).toEqual([]);expect(archived.applications).toEqual([]);
  expect((await call('pwappy_list_apps')).applications).toEqual([]);
  await page.screenshot({path:info.outputPath('external-lifecycle-deleted-dashboard.png'),fullPage:true});
  const writes=requests.filter(r=>!['GET','HEAD','OPTIONS'].includes(r.method));
  expect(writes.map(r=>r.method+' '+r.path.split('/').slice(-1)[0])).toEqual(['POST application','POST version','PUT editor-json','POST archive','PUT restore','DELETE version','DELETE application']);
  await writeFile(info.outputPath('external-lifecycle-evidence.json'),JSON.stringify({browser:browser.version(),transport:'External Node MCP stdio process -> native CDP WebMCP.enable/invokeTool',isolation:'Fresh Playwright profile, launch capability and exact URL/argument allowlists; entirely synthetic API, no real login or backend writes',initialTemplate:'Synthetic root-only empty application matching client initial shape; real server defaults not verified',starterChooser:{initiallyVisible:true,visibleAfterNativeConstruction:true,visibleAfterVerifiedSave:true,dismissed:false,autoDismissed:false,nativeConstructionAndSaveBlocked:false},construction:'Navigator, independent page, initial page reference, page attribute and script created through external native MCP; no second app root',initialApplication,constructedApplication,structure,persistedTemplates,navigationLimitation:'Native WebMCP returns URLs but does not navigate. Client validates and navigates, then reconnects to fresh native registrations; stale clients fail closed.',calls,registrations,navigation,requests,blocked,finalState:{active,archived}},null,2));
  await info.attach('External authoring lifecycle evidence',{path:info.outputPath('external-lifecycle-evidence.json'),contentType:'application/json'});
 }finally{for(const c of clients)c.child.kill();}
});
