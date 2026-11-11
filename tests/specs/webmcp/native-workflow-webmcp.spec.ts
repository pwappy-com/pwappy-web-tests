import {test,expect,Page} from '@playwright/test';
import {boot} from './editor-fixture';
test.use({channel:'chrome',launchOptions:{args:['--enable-experimental-web-platform-features']}});
const target={appKey:'webmcp-fixture',version:'1'};
async function call(page:Page,name:string,args:any={}) {return JSON.parse(await page.evaluate(async({name,args})=>{const m=(document as any).modelContext,t=(await m.getTools()).find((x:any)=>x.name===name);if(!t)throw Error(name);return m.executeTool(t,args);},{name,args}));}
async function guarded(page:Page,name:string,args:any={}) {const s=await call(page,'pwappy_get_save_status');return call(page,name,{...target,expectedRevision:s.revision,...args});}

test('native element selection and individual trash restore recover location and event bindings',async({page},info)=>{
 await boot(page,'native');
 expect(await call(page,'pwappy_select_element',{elementId:'fixture-title'})).toMatchObject({success:true,rootId:'fixture-page',elementId:'fixture-title',mode:'layout'});
 await expect(page.locator('attributes-container input[data-attribute-type="domId"]')).toHaveValue('qa-title');
 await call(page,'pwappy_manage_script',{action:'upsert',scriptName:'qaRestore',scriptContent:'function qaRestore(){ return "isolated"; }'});
 await call(page,'pwappy_manage_event_binding',{action:'add_definition',tagName:'h1',eventType:'qaSynthetic',comment:'Isolated custom event'});
 await call(page,'pwappy_manage_event_binding',{action:'attach',targetId:'fixture-title',eventType:'qaSynthetic',scriptName:'qaRestore'});
 await call(page,'pwappy_manage_element',{action:'delete',targetId:'fixture-title'});
 const trash=await call(page,'pwappy_list_trash');
 expect(trash.entries.find((x:any)=>x.elementId==='fixture-title')).toMatchObject({recoveryAvailable:true,originalParentId:'fixture-page',bindingCount:1});
 await expect(guarded(page,'pwappy_restore_trash',{elementId:'fixture-title'})).rejects.toThrow();
 expect(await guarded(page,'pwappy_restore_trash',{elementId:'fixture-title',confirm:true})).toMatchObject({success:true,parentId:'fixture-page',index:0,restoredBindings:1,skippedBindings:[]});
 expect((await call(page,'pwappy_list_trash')).entries).toEqual([]);
 const state=await page.locator('app-container').evaluate((h:any)=>({templates:h.templateJsonStore.getState().templateJson.templates,events:h.eventItemStore.getState().eventItems.items}));
 expect(state.templates.find((n:any)=>n.id==='fixture-page').children[0].id).toBe('fixture-title');
 expect(JSON.stringify(state.events)).toContain('qaRestore');
 await call(page,'pwappy_select_element',{elementId:'fixture-title'});
 await page.screenshot({path:info.outputPath('native-selected-restored-element.png'),fullPage:true});
});

test('native reusable component CRUD and advanced settings preserve unrelated locks',async({page})=>{
 await boot(page,'native');
 const catalog=()=>call(page,'pwappy_list_components',{source:'custom'});
 const component={tagName:'div',attributes:{class:'qa-reusable'},text:'Reusable QA',children:[]};
 await call(page,'pwappy_manage_component',{...target,expectedRevision:(await catalog()).revision,action:'add',componentName:'QA reusable',component,filterTags:['qa']});
 expect((await call(page,'pwappy_get_component',{componentName:'QA reusable',source:'custom'})).component).toMatchObject(component);
 await call(page,'pwappy_manage_component',{...target,expectedRevision:(await catalog()).revision,action:'update',componentName:'QA reusable',newName:'QA renamed'});
 await expect(call(page,'pwappy_manage_component',{...target,expectedRevision:(await catalog()).revision,action:'delete',componentName:'QA renamed'})).rejects.toThrow();
 await call(page,'pwappy_manage_component',{...target,expectedRevision:(await catalog()).revision,action:'delete',componentName:'QA renamed',confirmDelete:true});
 expect((await catalog()).components.some((x:any)=>x.componentName==='QA renamed')).toBe(false);
 const locks=()=>page.locator('app-container').evaluate((h:any)=>h.appSettingStore.getState().appSetting.projectSpec.locks);
 const before=await locks(), old=await call(page,'pwappy_get_advanced_settings');
 await expect(call(page,'pwappy_update_advanced_settings',{...target,expectedRevision:old.revision,global:{locks:{pages:[]}}})).rejects.toThrow();
 const result=await call(page,'pwappy_update_advanced_settings',{...target,expectedRevision:old.revision,typeDefResource:'',specification:'QA advanced specification',global:{qaDescription:'synthetic only'},pageRoles:{'home.html':'QA entry page'}});
 expect(result.success).toBe(true);expect(await locks()).toEqual(before);
 expect(await call(page,'pwappy_get_advanced_settings')).toMatchObject({specification:'QA advanced specification',global:{qaDescription:'synthetic only'}});
 await expect(call(page,'pwappy_update_advanced_settings',{...target,expectedRevision:old.revision,specification:'stale'})).rejects.toThrow();
 expect(await guarded(page,'pwappy_save_project')).toMatchObject({serverVerified:true});
});

test('native Monaco draft apply discard and stale guard use real editor typing',async({page},info)=>{
 await boot(page,'native');
 expect(await call(page,'pwappy_get_script_draft')).toMatchObject({active:false,changed:false});
 await call(page,'pwappy_manage_script',{action:'upsert',scriptName:'qaDraft',scriptContent:'function qaDraft(){ return "initial"; }'});
 await page.locator('script-container #tab-script').click();
 await page.locator('script-container button[title="スクリプトの編集"][data-script-name="qaDraft"]').click();
 const editor=page.locator('script-container #script-container .monaco-editor').first();
 await editor.click();await page.keyboard.press('Control+a');await page.keyboard.type('function qaDraft(){ return "applied-native-draft"; }');
 const draft=await call(page,'pwappy_get_script_draft',{includeContent:true});
 expect(draft).toMatchObject({active:true,changed:true,scriptName:'qaDraft'});expect(draft.content).toContain('applied-native-draft');
 await expect(guarded(page,'pwappy_resolve_script_draft',{action:'apply',expectedDraftRevision:'stale'})).rejects.toThrow();
 expect(await guarded(page,'pwappy_resolve_script_draft',{action:'apply',expectedDraftRevision:draft.draftRevision})).toMatchObject({success:true,draft:{changed:false}});
 await editor.click();await page.keyboard.press('Control+a');await page.keyboard.type('function qaDraft(){ return "discard-me"; }');
 const discard=await call(page,'pwappy_get_script_draft',{includeContent:true});
 await expect(guarded(page,'pwappy_resolve_script_draft',{action:'discard',expectedDraftRevision:discard.draftRevision})).rejects.toThrow();
 const result=await guarded(page,'pwappy_resolve_script_draft',{action:'discard',expectedDraftRevision:discard.draftRevision,confirmDiscard:true});
 expect(result).toMatchObject({success:true,draft:{changed:false}});expect(result.discardedDraft.content).toContain('discard-me');
 expect((await call(page,'pwappy_get_script_draft',{includeContent:true})).content).toContain('applied-native-draft');
 await call(page,'pwappy_manage_script',{action:'upsert',scriptName:'qaExisting',scriptContent:'function qaExisting(){ return "keep-existing"; }'});
 const beforeScripts=await page.locator('app-container').evaluate((h:any)=>h.scriptItemStore.getState().scriptItems.scripts);
 await editor.click();await page.keyboard.press('Control+a');await page.keyboard.type('function qaExisting(){ return "collision-must-not-apply"; }');
 const duplicate=await call(page,'pwappy_get_script_draft',{includeContent:true});
 await expect(guarded(page,'pwappy_resolve_script_draft',{action:'apply',expectedDraftRevision:duplicate.draftRevision})).rejects.toThrow();
 expect(await page.locator('app-container').evaluate((h:any)=>h.scriptItemStore.getState().scriptItems.scripts)).toEqual(beforeScripts);
 await guarded(page,'pwappy_resolve_script_draft',{action:'discard',expectedDraftRevision:duplicate.draftRevision,confirmDiscard:true});
 await page.screenshot({path:info.outputPath('native-monaco-draft.png'),fullPage:true});
});

test('native script trash restores code deleted through actual UI without inventing event bindings',async({page})=>{
 await boot(page,'native');
 const scriptName='qaRecoverCode',scriptContent='function qaRecoverCode(){ return "recover-this-code"; }';
 await call(page,'pwappy_manage_script',{action:'upsert',scriptName,scriptContent});
 await page.locator('script-container #tab-script').click();
 const remove=page.locator(`script-container button[title="ゴミ箱に移動"][data-script-name="${scriptName}"]`);
 await remove.click();await remove.click();
 const list=()=>call(page,'pwappy_manage_script_trash',{action:'list'});
 expect((await list()).scripts.find((s:any)=>s.scriptName===scriptName).scriptValue.join('\n')).toContain('recover-this-code');
 await expect(guarded(page,'pwappy_manage_script_trash',{action:'restore',scriptName})).rejects.toThrow();
 expect(await guarded(page,'pwappy_manage_script_trash',{action:'restore',scriptName,confirm:true})).toMatchObject({success:true,scriptName,serverSaved:false,originalEventBindingsKnown:false});
 expect((await list()).scripts.some((s:any)=>s.scriptName===scriptName)).toBe(false);
 await expect(page.locator(`script-container button[title="スクリプトの編集"][data-script-name="${scriptName}"]`)).toBeVisible();
 expect(await page.locator('app-container').evaluate((h:any)=>h.scriptItemStore.getState().scriptItems.scripts.find((s:any)=>s.scriptName==='qaRecoverCode').scriptValue.join('\n'))).toContain('recover-this-code');
});
