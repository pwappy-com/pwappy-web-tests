import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { boot } from './editor-fixture';

  test.use({channel:'chrome',launchOptions:{args:['--enable-experimental-web-platform-features']}});
  test('Chrome document API registration, execution and cleanup without adapter',async({page,browser},info)=>{
    const registrationWarnings:string[]=[];
    page.on('console',message=>{if(message.type()==='warning' && message.text().includes('[WebMCP]')) registrationWarnings.push(message.text());});
    await boot(page,'native');
    expect(registrationWarnings).toEqual([]);
    const capabilities=await page.evaluate(async()=>({
      nativeDocumentAPI:Boolean((document as any).modelContext),
      nativeExecutionAPI:typeof (document as any).modelContext.executeTool==='function',
      documentAdapterPresent:Object.prototype.hasOwnProperty.call(document,'modelContext'),
      names:(await (document as any).modelContext.getTools()).map((tool:any)=>tool.name)
    }));
    expect(capabilities.nativeDocumentAPI).toBe(true);
    expect(capabilities.nativeExecutionAPI).toBe(true);
    expect(capabilities.documentAdapterPresent).toBe(false);
    const expectedNames=await page.locator('app-container').evaluate((host:any)=>host.webMcpRegistry.toolDefinitions.map((tool:any)=>tool.name));
    expect([...capabilities.names].sort()).toEqual(expectedNames.sort());
    expect(capabilities.names).toEqual(expect.arrayContaining(['pwappy_save_project','pwappy_run_tests','pwappy_list_images','pwappy_get_editor_context']));
    const nativeCall=async(name:string,args:any={})=>{
      const raw=await page.evaluate(async({name,args})=>{const model=(document as any).modelContext; const registered=(await model.getTools()).find((tool:any)=>tool.name===name); return model.executeTool(registered,args);},{name,args});
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
    await page.screenshot({path:info.outputPath('native-chrome-webmcp-action.png'),fullPage:true});
    await writeFile(info.outputPath('native-evidence.json'),JSON.stringify({browser:browser.version(),capabilities,registrationWarnings,context,results,saved},null,2));
    await info.attach('Native WebMCP browser evidence',{path:info.outputPath('native-evidence.json'),contentType:'application/json'});
    await page.locator('app-container').evaluate(el=>el.remove());
    await expect.poll(()=>page.evaluate(()=>(document as any).modelContext.getTools())).toEqual([]);
  });
