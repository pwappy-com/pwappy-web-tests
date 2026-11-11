import {test,expect,Page} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {boot} from './editor-fixture';
test.use({channel:'chrome',launchOptions:{args:['--enable-experimental-web-platform-features']}});
async function call(page:Page,name:string,args:any={}) {return JSON.parse(await page.evaluate(async({name,args})=>{const m=(document as any).modelContext,t=(await m.getTools()).find((x:any)=>x.name===name);if(!t)throw Error(name);return m.executeTool(t,args);},{name,args}));}
test('native preview inspection interaction guards and DOM rendered PNG reflect actual isolated viewport',async({page},info)=>{
 await boot(page,'native');await call(page,'pwappy_set_mode',{mode:'action'});await call(page,'pwappy_refresh_preview');
 // Test-only DOM fixture: all handlers are local and no real APIs or data are involved.
 await page.locator('app-container').evaluate((host:any)=>{
  const doc=host.editorSessionService.getIframe().contentDocument;
  const root=doc.createElement('section');root.id='qa-preview-controls';root.style.cssText='position:fixed;inset:30px 0 auto;background:white;z-index:99999;padding:10px';
  root.innerHTML='<input id="qa-input" value="initial"><button id="qa-click" type="button">Apply</button><select id="qa-select"><option value="one">One</option><option value="two">Two</option></select><output id="qa-output">Waiting</output><input id="qa-password" type="password" value="synthetic-not-a-secret"><input id="qa-file" type="file"><a id="qa-link" href="/blocked-navigation">Blocked</a><button class="qa-ambiguous" type="button">A</button><button class="qa-ambiguous" type="button">B</button>';
  doc.body.append(root);
  doc.querySelector('#qa-input').addEventListener('input',()=>doc.querySelector('#qa-output').textContent='typed:'+doc.querySelector('#qa-input').value);
  doc.querySelector('#qa-click').addEventListener('click',()=>doc.querySelector('#qa-output').textContent='clicked:'+doc.querySelector('#qa-input').value);
 });
 const inspect=(selector:string)=>call(page,'pwappy_inspect_preview',{selector});
 expect((await inspect('#qa-password')).elements[0]).toMatchObject({value:'[redacted]',text:''});
 expect((await inspect('#qa-file')).elements[0].value).toBe('[redacted]');
 expect(JSON.stringify(await inspect('#qa-preview-controls'))).not.toContain('synthetic-not-a-secret');
 await expect(call(page,'pwappy_capture_preview')).rejects.toThrow();
 await expect(call(page,'pwappy_interact_preview',{selector:'#qa-click',action:'click'})).rejects.toThrow();
 for(const selector of ['#qa-password','#qa-file','#qa-link','.qa-ambiguous']) await expect(call(page,'pwappy_interact_preview',{selector,action:'click',confirmPreviewInteraction:true})).rejects.toThrow();
 const act=(args:any)=>call(page,'pwappy_interact_preview',{...args,confirmPreviewInteraction:true});
 expect(await act({selector:'#qa-input',action:'input',value:'native input'})).toMatchObject({success:true,trustedGesture:false});
 expect((await inspect('#qa-output')).elements[0].text).toBe('typed:native input');
 await act({selector:'#qa-click',action:'click'});expect((await inspect('#qa-output')).elements[0].text).toBe('clicked:native input');
 await act({selector:'#qa-select',action:'select',value:'two'});expect((await inspect('#qa-select')).elements[0].value).toBe('two');
 await page.locator('app-container').evaluate((host:any)=>host.editorSessionService.getIframe().contentDocument.querySelector('#qa-password').remove());
 const selectedAttributes=await page.locator('app-container').evaluate((h:any)=>Array.from(h.editorSessionService.getIframe().contentDocument.querySelectorAll('#qa-select option')).map((n:any)=>({selected:n.selected,attribute:n.getAttribute('selected')})));
 const png=await call(page,'pwappy_capture_preview');expect(png).toMatchObject({mimeType:'image/png',captureKind:'dom-render',realBrowserScreenshot:false});
 const bytes=Buffer.from(png.dataUrl.split(',')[1],'base64');expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');expect(bytes.readUInt32BE(16)).toBe(png.width);expect(bytes.readUInt32BE(20)).toBe(png.height);expect(bytes.length).toBe(png.bytes);
 expect(await page.locator('app-container').evaluate((h:any)=>Array.from(h.editorSessionService.getIframe().contentDocument.querySelectorAll('#qa-select option')).map((n:any)=>({selected:n.selected,attribute:n.getAttribute('selected')})))).toEqual(selectedAttributes);
 writeFileSync(info.outputPath('native-preview-dom-render.png'),bytes);
 await page.screenshot({path:info.outputPath('native-preview-real-browser.png'),fullPage:true});
});
