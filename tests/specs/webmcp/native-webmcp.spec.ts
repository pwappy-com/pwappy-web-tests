import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { boot } from './editor-fixture';

  test.use({launchOptions:{args:['--enable-experimental-web-platform-features']}});
  test('native navigator registration, execution and stale-handle protection',async({page,browser},info)=>{
    const registrationWarnings:string[]=[];
    page.on('console',message=>{if(message.type()==='warning' && message.text().includes('[WebMCP]')) registrationWarnings.push(message.text());});
    await boot(page,'native');
    expect(registrationWarnings).toEqual([]);
    const capabilities=await page.evaluate(()=>({
      nativeNavigatorAPI:Boolean((navigator as any).modelContext),
      nativeTestingAPI:Boolean((navigator as any).modelContextTesting),
      documentAdapterPresent:Object.prototype.hasOwnProperty.call(document,'modelContext'),
      names:(navigator as any).modelContextTesting.listTools().map((tool:any)=>tool.name)
    }));
    expect(capabilities.nativeNavigatorAPI).toBe(true);
    expect(capabilities.nativeTestingAPI).toBe(true);
    expect(capabilities.documentAdapterPresent).toBe(false);
    const expectedNames=await page.locator('app-container').evaluate((host:any)=>host.webMcpRegistry.toolDefinitions.map((tool:any)=>tool.name));
    expect([...capabilities.names].sort()).toEqual(expectedNames.sort());
    expect(capabilities.names).toEqual(expect.arrayContaining(['pwappy_save_project','pwappy_run_tests','pwappy_list_images','pwappy_get_editor_context']));
    const nativeCall=async(name:string,args:any={})=>{
      const raw=await page.evaluate(({name,args})=>(navigator as any).modelContextTesting.executeTool(name,JSON.stringify(args)),{name,args});
      return JSON.parse(raw);
    };
    const context=await nativeCall('pwappy_get_editor_context');
    expect(context).toMatchObject({appKey:'webmcp-fixture',version:'1'});
    expect(JSON.stringify(await nativeCall('pwappy_get_application_json'))).toContain('fixture-page');
    await nativeCall('pwappy_get_authoring_guide');
    const mode=await nativeCall('pwappy_set_mode',{mode:'action'});
    expect(mode).toMatchObject({mode:'action',preview:{ready:true}});
    const created=await nativeCall('pwappy_upsert_test',{name:'Native WebMCP test',code:'export default async function runTest() { if (!document.querySelector("#qa-title")) throw new Error("Native preview DOM missing"); }'});
    const results=await nativeCall('pwappy_run_tests',{scenarioIds:[created.scenario.id],confirmPreviewExecution:true,timeoutMs:10000});
    expect(results).toMatchObject({success:true,completed:1});
    const status=await nativeCall('pwappy_get_save_status');
    const saved=await nativeCall('pwappy_save_project',{appKey:'webmcp-fixture',version:'1',expectedRevision:status.revision});
    expect(saved).toMatchObject({success:true,serverVerified:true,dirty:false});
    await page.screenshot({path:info.outputPath('native-webmcp-action.png'),fullPage:true});
    await writeFile(info.outputPath('native-evidence.json'),JSON.stringify({browser:browser.version(),capabilities,registrationWarnings,context,results,saved},null,2));
    await info.attach('Native WebMCP browser evidence',{path:info.outputPath('native-evidence.json'),contentType:'application/json'});
    const cleanupState=await page.locator('app-container').evaluate((el:any)=>{const registry=el.webMcpRegistry, controller=registry.abortController; el.remove(); return {connected:el.isConnected,aborted:controller?.signal.aborted,registryStopped:registry.abortController===null};});
    expect(cleanupState).toEqual({connected:false,aborted:true,registryStopped:true});
    const remainingNames=await page.evaluate(()=>(navigator as any).modelContextTesting.listTools().map((tool:any)=>tool.name));
    // Chromium148 loses native AbortSignal cleanup after GC. Handles must still fail closed.
    await expect(nativeCall('pwappy_get_editor_context')).rejects.toThrow();
    await expect(nativeCall('pwappy_upsert_test',{name:'stale',code:'export default async function runTest() {}'})).rejects.toThrow();
    await writeFile(info.outputPath('native-lifecycle.json'),JSON.stringify({cleanupState,remainingNames,browserLimitation:remainingNames.length ? 'Chromium148 native signal cleanup lost after GC; page reload required to clear stale inventory' : null},null,2));
  });
