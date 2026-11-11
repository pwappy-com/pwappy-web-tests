import { test, expect, Page } from '@playwright/test';
import { boot } from './editor-fixture';
test.use({channel:'chrome',launchOptions:{args:['--enable-experimental-web-platform-features']}});
async function call(page:Page,name:string,args:any={}) {
  return JSON.parse(await page.evaluate(async({name,args})=>{
    const m=(document as any).modelContext,t=(await m.getTools()).find((t:any)=>t.name===name);
    if(!t) throw new Error(`Missing native tool: ${name}`);
    return m.executeTool(t,args);
  },{name,args}));
}
const target={appKey:'webmcp-fixture',version:'1'};
async function guarded(page:Page,name:string,args:any={}) {
  const {revision}=await call(page,'pwappy_get_save_status');
  return call(page,name,{...target,expectedRevision:revision,...args});
}
async function settings(page:Page,description:string) {
 const s=await call(page,'pwappy_get_app_settings');
 return call(page,'pwappy_update_app_settings',{expectedRevision:s.revision,description});
}
test('native component catalog and settings persist through verified save',async({page})=>{
 await boot(page,'native');
 const catalog=await call(page,'pwappy_list_components',{query:'button',source:'builtin',limit:10});
 expect(catalog.total).toBeGreaterThan(0);
 const detail=await call(page,'pwappy_get_component',{componentName:catalog.components[0].componentName,source:'builtin'});
 expect(detail.component.tagName).toBeTruthy();expect(Array.isArray(detail.attributes)).toBe(true);expect(Array.isArray(detail.events)).toBe(true);
 const old=await call(page,'pwappy_get_app_settings');
 await expect(call(page,'pwappy_update_app_settings',{expectedRevision:'stale',description:'rejected'})).rejects.toThrow();
 const manifest={name:'Native QA',short_name:'QA',start_url:'./',display:'standalone',theme_color:'#123456'};
 const changed=await call(page,'pwappy_update_app_settings',{expectedRevision:old.revision,lang:'en',description:'Catalog persistence fixture',manifest});
 expect(changed).toMatchObject({success:true,persisted:false});
 expect(await guarded(page,'pwappy_save_project')).toMatchObject({serverVerified:true,dirty:false});
 const saved=await call(page,'pwappy_get_app_settings');
 expect(saved).toMatchObject({lang:'en',description:'Catalog persistence fixture'});
 expect(JSON.parse(saved.manifest)).toEqual(manifest);
});
test('native browser property and function mocks affect real preview tests',async({page})=>{
 await boot(page,'native');
 const property=await call(page,'pwappy_upsert_browser_mock',{path:'__qaSynthetic.value',browserMockType:'property',response:'"synthetic-value"'});
 const fn=await call(page,'pwappy_upsert_browser_mock',{path:'__qaSynthetic.getValue',browserMockType:'async_function',response:'{"ok":true}'});
 expect((await call(page,'pwappy_list_browser_mocks')).mocks.map((m:any)=>m.id)).toEqual(expect.arrayContaining([property.mock.id,fn.mock.id]));
 const scenario=await call(page,'pwappy_upsert_test',{name:'Synthetic browser APIs',code:'export default async function runTest(){ if(window.__qaSynthetic.value!=="synthetic-value") throw new Error("PROPERTY_MOCK_MISSING"); const result=await window.__qaSynthetic.getValue(); if(!result.ok) throw new Error("FUNCTION_MOCK_MISSING"); }'});
 const result=await call(page,'pwappy_run_tests',{scenarioIds:[scenario.scenario.id],confirmPreviewExecution:true,timeoutMs:10000});
 expect(result.results[0],JSON.stringify(result)).toMatchObject({status:'PASS'});
 await call(page,'pwappy_delete_browser_mock',{id:property.mock.id});await call(page,'pwappy_delete_browser_mock',{id:fn.mock.id});
 expect((await call(page,'pwappy_list_browser_mocks')).mocks.some((m:any)=>m.id===property.mock.id||m.id===fn.mock.id)).toBe(false);
});
test('native preview device changes OS dimensions orientation and awaits readiness',async({page},info)=>{
 await boot(page,'native');
 const devices=await call(page,'pwappy_get_preview_devices');expect(devices.realDevice).toBe(false);expect(devices.devices.length).toBeGreaterThan(0);
 await call(page,'pwappy_set_mode',{mode:'action'});
 const result=await call(page,'pwappy_set_preview_device',{os:'android',width:400,height:800,orientation:'landscape',scale:75});
 expect(result).toMatchObject({success:true,realDevice:false,previewRecreated:true,device:{os:'android',width:400,height:800,orientation:'landscape',scale:75,displayWidth:800,displayHeight:400,dimensionsArePortraitBase:true},preview:{ready:true,accessible:true}});
 await expect(call(page,'pwappy_set_preview_device',{width:0})).rejects.toThrow();
 const geometry=await page.locator('android-component').evaluate((host:any)=>{const platform=host.getRootNode().host,screen=host.shadowRoot.querySelector('.android-screen-side'),zone=host.shadowRoot.querySelector('renderzone-component'),frame=zone.shadowRoot.querySelector('iframe');return {screenWidth:screen.clientWidth,screenHeight:screen.clientHeight,frameWidth:frame.clientWidth,frameHeight:frame.clientHeight,outerWidth:platform.clientWidth,outerHeight:platform.clientHeight};});
 expect(geometry).toEqual({screenWidth:800,screenHeight:400,frameWidth:800,frameHeight:400,outerWidth:824,outerHeight:424});
 await page.screenshot({path:info.outputPath('native-android-landscape.png'),fullPage:true});
});
test('native project JSON export import guards and checkpoint preserve roundtrip',async({page})=>{
 await boot(page,'native');await settings(page,'exported fixture description');
 const exported=await call(page,'pwappy_export_project');
 expect(exported).toMatchObject({includesAssetFiles:false,savedToFile:false,backup:{type:'pwappy-project-backup'}});
 await settings(page,'description before import');
 await call(page,'pwappy_manage_element',{action:'update_attribute',targetId:'fixture-title',attribute:'title',value:'pre-import layout marker'});
 expect((await call(page,'pwappy_get_edit_history')).undoCount).toBeGreaterThan(0);
 await expect(guarded(page,'pwappy_import_project',{backup:exported.backup})).rejects.toThrow();
 const foreign=structuredClone(exported.backup);foreign.metadata.appKey='other-app';
 await expect(guarded(page,'pwappy_import_project',{backup:foreign,confirmReplace:true})).rejects.toThrow();
 const result=await guarded(page,'pwappy_import_project',{backup:exported.backup,confirmReplace:true});
 expect(result).toMatchObject({success:true,serverSaved:false,importedAssetFiles:false});
 expect(await call(page,'pwappy_get_edit_history')).toMatchObject({undoCount:0,redoCount:0});
 expect((await call(page,'pwappy_get_app_settings')).description).toBe('exported fixture description');
 const snapshots=await call(page,'pwappy_manage_snapshot',{action:'list'});
 const checkpoint=snapshots.snapshots.find((s:any)=>s.name==='WebMCP - インポート直前');expect(checkpoint).toBeTruthy();
 await guarded(page,'pwappy_manage_snapshot',{action:'restore',snapshotId:checkpoint.id});
 expect((await call(page,'pwappy_get_app_settings')).description).toBe('description before import');
 expect(JSON.stringify(await call(page,'pwappy_get_application_json'))).toContain('pre-import layout marker');
});
test('native undo and redo restore a tool-edited layout attribute',async({page})=>{
 await boot(page,'native');
 await call(page,'pwappy_manage_element',{action:'update_attribute',targetId:'fixture-title',attribute:'title',value:'Edited by native tool'});
 const json=()=>call(page,'pwappy_get_application_json');
 expect(JSON.stringify(await json())).toContain('Edited by native tool');
 const history=await call(page,'pwappy_get_edit_history');expect(history.undoCount).toBeGreaterThan(0);
 await guarded(page,'pwappy_change_edit_history',{action:'undo'});
 expect(JSON.stringify(await json())).not.toContain('Edited by native tool');
 await guarded(page,'pwappy_change_edit_history',{action:'redo'});
 expect(JSON.stringify(await json())).toContain('Edited by native tool');
});
test('native asset directory JSON and SVG uploads emit isolated exact payloads',async({page})=>{
 const writes=await boot(page,'native');
 const listing=await call(page,'pwappy_list_asset_files',{...target,path:'assets'});expect(Array.isArray(listing.files)).toBe(true);
 await expect(call(page,'pwappy_create_asset_directory',{...target,path:'',name:'qa-assets'})).rejects.toThrow();
 expect(await call(page,'pwappy_create_asset_directory',{...target,path:'',name:'qa-assets',confirm:true})).toMatchObject({success:true});
 const json=JSON.stringify({fixture:true}),svg='<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#123456"/></svg>';
 for(const asset of [{name:'fixture.json',mimeType:'application/json',text:json},{name:'fixture.svg',mimeType:'image/svg+xml',text:svg}]) {
   const result=await call(page,'pwappy_upload_asset_file',{...target,path:'qa-assets',name:asset.name,mimeType:asset.mimeType,base64:Buffer.from(asset.text).toString('base64'),confirm:true});
   expect(result).toMatchObject({success:true});
 }
 const directory=writes.find(r=>r.url.endsWith('/directory'));expect(JSON.parse(directory!.body!)).toEqual({...target,path:'',directory:'qa-assets'});
 const uploads=writes.filter(r=>r.url.endsWith('/file-upload'));expect(uploads).toHaveLength(2);
 expect(uploads[0].body).toContain('filename="fixture.json"');expect(uploads[0].body).toContain(json);
 expect(uploads[1].body).toContain('filename="fixture.svg"');expect(uploads[1].body).toContain(svg);
 expect(uploads.every(r=>r.body!.includes('qa-assets'))).toBe(true);
});
test('native cancellation lets active JavaScript finish and skips later scenarios',async({page})=>{
 await boot(page,'native');
 const first=await call(page,'pwappy_upsert_test',{name:'Cancelable slow fixture',code:'export default async function runTest(){window.__qaSlowStarted=true;await new Promise(resolve=>window.__qaRelease=resolve);}'});
 const second=await call(page,'pwappy_upsert_test',{name:'Must be skipped',code:'export default async function runTest(){throw new Error("SECOND_MUST_NOT_RUN");}'});
 await page.evaluate(async(ids)=>{const m=(document as any).modelContext,t=(await m.getTools()).find((t:any)=>t.name==='pwappy_run_tests');(window as any).__qaRunPromise=m.executeTool(t,{scenarioIds:ids,confirmPreviewExecution:true,timeoutMs:10000});},[first.scenario.id,second.scenario.id]);
 await expect.poll(async()=>(await call(page,'pwappy_get_test_results')).currentScenarioId).toBe(first.scenario.id);
 await expect.poll(()=>page.locator('app-container').evaluate((host:any)=>Boolean(host.editorSessionService.getIframe()?.contentWindow?.__qaSlowStarted))).toBe(true);
 const cancelled=await call(page,'pwappy_cancel_tests');expect(cancelled).toMatchObject({requested:true,cancelled:true,interruptsCurrentScenario:false,currentScenarioId:first.scenario.id});
 expect((await call(page,'pwappy_get_test_results')).isRunning).toBe(true);
 await page.locator('app-container').evaluate((host:any)=>host.editorSessionService.getIframe().contentWindow.__qaRelease());
 const result=JSON.parse(await page.evaluate(()=>(window as any).__qaRunPromise));
 expect(result).toMatchObject({success:false,cancelled:true});expect(result.completed).toBe(1);expect(result.results[0].status).toBe('PASS');expect(result.skipped).toContain(second.scenario.id);
 expect(await call(page,'pwappy_cancel_tests')).toMatchObject({requested:false});
});
