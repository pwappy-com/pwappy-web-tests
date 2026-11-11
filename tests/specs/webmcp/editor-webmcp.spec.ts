import { test, expect, Page } from '@playwright/test';
import { boot, call } from './editor-fixture';

test('registers tools, exposes real editor state and cleans up on disconnect',async({page},info)=>{
  await boot(page);
  const names=await page.evaluate(()=>Object.keys((window as any).__webmcpTools));
  expect(names).toContain('pwappy_get_authoring_guide');
  const json=await call(page,'pwappy_get_application_json');
  expect(JSON.stringify(json)).toContain('fixture-page');
  await call(page,'pwappy_get_authoring_guide');
  await page.screenshot({path:info.outputPath('editor-registered.png'),fullPage:true});
  await info.attach('Registered editor',{path:info.outputPath('editor-registered.png'),contentType:'image/png'});
  await page.locator('app-container').evaluate((el)=>el.remove());
  expect(await page.evaluate(()=>Object.keys((window as any).__webmcpTools))).toEqual([]);
});
test('unsupported browser keeps the editor usable',async({page},info)=>{
  await boot(page,false);
  await expect(page.locator('#dom-tree')).toBeVisible();
  expect(await page.evaluate(()=>Object.keys((window as any).__webmcpTools))).toEqual([]);
  await page.screenshot({path:info.outputPath('editor-unsupported.png'),fullPage:true});
});
test('save checks target and revision and verifies isolated round-trip',async({page})=>{
  await boot(page);
  await page.waitForFunction(()=>Boolean((window as any).__webmcpTools.pwappy_save_project));
  const context=await call(page,'pwappy_get_editor_context');
  expect(context).toMatchObject({appKey:'webmcp-fixture',version:'1',capabilities:{publish:false}});
  const status=await call(page,'pwappy_get_save_status');
  await expect(call(page,'pwappy_save_project',{appKey:'wrong',version:'1',expectedRevision:status.revision})).rejects.toThrow();
  await expect(call(page,'pwappy_save_project',{appKey:'webmcp-fixture',version:'1',expectedRevision:'stale'})).rejects.toThrow();
  const saved=await call(page,'pwappy_save_project',{appKey:'webmcp-fixture',version:'1',expectedRevision:status.revision});
  expect(saved).toMatchObject({success:true,dirty:false,serverVerified:true});
});
test('runtime mode changes and image read validation',async({page},info)=>{
  await boot(page);
  await page.waitForFunction(()=>Boolean((window as any).__webmcpTools.pwappy_set_mode));
  const action=await call(page,'pwappy_set_mode',{mode:'action'});
  expect(action).toMatchObject({mode:'action',preview:{ready:true,accessible:true}});
  await page.screenshot({path:info.outputPath('editor-action.png'),fullPage:true});
  const layout=await call(page,'pwappy_set_mode',{mode:'layout'});
  expect(layout.mode).toBe('layout');
  await expect(call(page,'pwappy_set_mode',{mode:'invalid'})).rejects.toThrow();
  const images=await call(page,'pwappy_list_images',{appKey:'webmcp-fixture',version:'1'});
  expect(images.images[0]).toMatchObject({name:'qa.png',url:'images/qa.png'});
  await expect(call(page,'pwappy_list_images',{appKey:'webmcp-fixture',version:'1',path:'../'})).rejects.toThrow();
  await call(page,'pwappy_focus_page_in_layout',{templateId:'home.html'});
  await page.screenshot({path:info.outputPath('editor-layout.png'),fullPage:true});
  // Exercise actual UI controls, then read the result through WebMCP.
  await page.getByTitle('Androidプレビュー',{exact:true}).click();
  await expect.poll(async()=>(await call(page,'pwappy_get_runtime_info')).device.os).toBe('android');
  await page.getByTitle('iOSプレビュー',{exact:true}).click();
  await expect.poll(async()=>(await call(page,'pwappy_get_runtime_info')).device.os).toBe('ios');
});
test('test and API mock CRUD reaches the real preview test runner',async({page},info)=>{
  await boot(page);
  const mock=await call(page,'pwappy_upsert_api_mock',{path:'/isolated-api',method:'GET',response:'{"ok":true}'});
  expect(mock.created).toBe(true);
  const scenario=await call(page,'pwappy_upsert_test',{name:'Browser WebMCP smoke',code:'export default async function runTest() { const response = await fetch("/isolated-api"); const data = await response.json(); if (data.ok !== true) throw new Error("Mock response mismatch"); }'});
  expect((await call(page,'pwappy_list_tests')).scenarios.some((s:any)=>s.id===scenario.scenario.id)).toBe(true);
  await expect(call(page,'pwappy_run_tests',{scenarioIds:[scenario.scenario.id]})).rejects.toThrow();
  const result=await call(page,'pwappy_run_tests',{scenarioIds:[scenario.scenario.id],confirmPreviewExecution:true,timeoutMs:10000});
  expect(result).toMatchObject({success:true,completed:1,executionContext:'preview-iframe'});
  expect(result.results[0].status).toBe('PASS');
  const fail=await call(page,'pwappy_upsert_test',{id:scenario.scenario.id,code:'export default async function runTest() { throw new Error("EXPECTED_QA_FAILURE"); }'});
  expect(fail.created).toBe(false);
  const failed=await call(page,'pwappy_run_tests',{scenarioIds:[scenario.scenario.id],confirmPreviewExecution:true,timeoutMs:10000});
  expect(failed.success).toBe(false);
  expect(failed.results[0].error).toContain('EXPECTED_QA_FAILURE');
  await page.screenshot({path:info.outputPath('editor-test-runner.png'),fullPage:true});
  await call(page,'pwappy_delete_test',{id:scenario.scenario.id});
  await call(page,'pwappy_delete_api_mock',{id:mock.mock.id});
  expect((await call(page,'pwappy_list_tests')).scenarios.some((s:any)=>s.id===scenario.scenario.id)).toBe(false);
});
async function changeDescription(page:Page, value:string) {
  await page.locator('app-container').evaluate((host:any,value)=>host.appSettingStore.dispatch({type:'appSetting/updateAppExp',payload:value}),value);
}
async function saveCurrent(page:Page) {
  const status=await call(page,'pwappy_get_save_status');
  return call(page,'pwappy_save_project',{appKey:'webmcp-fixture',version:'1',expectedRevision:status.revision});
}
test('rejected save stays dirty and reports failed verification',async({page})=>{
  await boot(page,true,{saveFailure:true});
  await changeDescription(page,'unsaved fixture change');
  await expect(saveCurrent(page)).rejects.toThrow('ISOLATED_SAVE_REJECTED');
  expect(await call(page,'pwappy_get_save_status')).toMatchObject({status:'failed',dirty:true,serverVerified:false});
});
test('save preserves a newer local edit made while request is in flight',async({page})=>{
  await boot(page,true,{duringSave:()=>changeDescription(page,'newer local edit')});
  await changeDescription(page,'first sent edit');
  const result=await saveCurrent(page);
  expect(result).toMatchObject({success:true,dirty:true,serverVerified:true});
  expect(await page.locator('app-container').evaluate((host:any)=>host.appSettingStore.getState().appSetting.app_exp)).toBe('newer local edit');
});
test('mismatched server readback never claims verified save',async({page})=>{
  await boot(page,true,{corruptReadback:true});
  await call(page,'pwappy_update_global_style',{css:'body { color: rgb(1, 2, 3); }'});
  await expect(saveCurrent(page)).rejects.toThrow();
  expect(await call(page,'pwappy_get_save_status')).toMatchObject({status:'failed',serverVerified:false,dirty:true});
});
test('local snapshot restores fixture edits without server save',async({page})=>{
  await boot(page);
  await changeDescription(page,'snapshot fixture value');
  let status=await call(page,'pwappy_get_save_status');
  await call(page,'pwappy_manage_snapshot',{action:'create',name:'QA recovery',appKey:'webmcp-fixture',version:'1',expectedRevision:status.revision});
  const snapshots=await call(page,'pwappy_manage_snapshot',{action:'list'});
  const snapshot=snapshots.snapshots.find((s:any)=>s.name==='QA recovery');
  expect(snapshot.id).toBeGreaterThan(0);
  await changeDescription(page,'changed after snapshot');
  status=await call(page,'pwappy_get_save_status');
  const restored=await call(page,'pwappy_manage_snapshot',{action:'restore',snapshotId:snapshot.id,appKey:'webmcp-fixture',version:'1',expectedRevision:status.revision});
  expect(restored).toMatchObject({success:true,serverSaved:false});
  expect(await page.locator('app-container').evaluate((host:any)=>host.appSettingStore.getState().appSetting.app_exp)).toBe('snapshot fixture value');
});
test('image upload and deletion use isolated API with explicit confirmation guard',async({page})=>{
  const writes=await boot(page);
  const input={appKey:'webmcp-fixture',version:'1',path:'images',name:'new.png',mimeType:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII='};
  await expect(call(page,'pwappy_upload_image',input)).rejects.toThrow();
  const upload=await call(page,'pwappy_upload_image',{...input,confirm:true});
  expect(upload).toMatchObject({success:true,path:'images/new.png'});
  await expect(call(page,'pwappy_delete_image',{appKey:input.appKey,version:'1',path:'images',name:'qa.png'})).rejects.toThrow();
  const removed=await call(page,'pwappy_delete_image',{appKey:input.appKey,version:'1',path:'images',name:'qa.png',confirm:true});
  expect(removed).toMatchObject({success:true,deletedPath:'images/qa.png'});
  const uploadRequest=writes.find(r=>r.url.endsWith('/file-upload'));
  expect(uploadRequest?.body).toContain('filename="new.png"');
  expect(uploadRequest?.body).toContain('webmcp-fixture');
  const deleteRequest=writes.find(r=>r.method==='DELETE');
  expect(JSON.parse(deleteRequest!.body!)).toMatchObject({appKey:'webmcp-fixture',version:'1',path:'images',files:['qa.png']});
});
test('save readback stays on original target and never applies to newly selected app',async({page})=>{
  const readbacks:string[]=[];
  page.on('request',request=>{if(request.method()==='GET' && request.url().includes('/editor-json')) readbacks.push(request.url());});
  await boot(page,true,{duringSave:async()=>{
    await page.evaluate(()=>{const url=new URL(location.href);url.searchParams.set('appKey','newly-selected-app');history.replaceState({},'',url);});
    await changeDescription(page,'new app unsaved edit');
  }});
  await changeDescription(page,'original sent data');
  await expect(saveCurrent(page)).rejects.toThrow();
  expect(readbacks.length).toBeGreaterThanOrEqual(2);
  expect(readbacks.every(url=>new URL(url).searchParams.get('appKey')==='webmcp-fixture')).toBe(true);
  expect(await page.locator('app-container').evaluate((host:any)=>host.appSettingStore.getState().appSetting.app_exp)).toBe('new app unsaved edit');
  expect(await call(page,'pwappy_get_save_status')).toMatchObject({appKey:'newly-selected-app',serverVerified:false});
});
test('snapshot restore refuses an edit arriving during IndexedDB read',async({page})=>{
  await boot(page);
  let status=await call(page,'pwappy_get_save_status');
  await call(page,'pwappy_manage_snapshot',{action:'create',name:'Snapshot race fixture',appKey:'webmcp-fixture',version:'1',expectedRevision:status.revision});
  const snapshot=(await call(page,'pwappy_manage_snapshot',{action:'list'})).snapshots.find((s:any)=>s.name==='Snapshot race fixture');
  await changeDescription(page,'before restore');
  status=await call(page,'pwappy_get_save_status');
  // Control the interleaving after the real IDB read; do not stub restoration or its guard.
  await page.locator('app-container').evaluate((host:any)=>{
    const controller=host.editorSessionService.snapshotController;
    const original=controller.getSnapshotsForCurrentProject.bind(controller);
    controller.getSnapshotsForCurrentProject=async()=>{
      const snapshots=await original();
      host.appSettingStore.dispatch({type:'appSetting/updateAppExp',payload:'edit during IDB read'});
      return snapshots;
    };
  });
  await expect(call(page,'pwappy_manage_snapshot',{action:'restore',snapshotId:snapshot.id,appKey:'webmcp-fixture',version:'1',expectedRevision:status.revision})).rejects.toThrow();
  expect(await page.locator('app-container').evaluate((host:any)=>host.appSettingStore.getState().appSetting.app_exp)).toBe('edit during IDB read');
});
