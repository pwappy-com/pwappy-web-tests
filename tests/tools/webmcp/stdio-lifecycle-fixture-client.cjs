/** Test-only mutation bridge. NOT a general-purpose authenticated-browser MCP server.
 * Requires a fresh Playwright browser launch capability plus exact fixture page.
 * Every call goes through native CDP WebMCP; never evaluates page JavaScript.
 */
const { chromium } = require('playwright');
const readline = require('node:readline');
const { isDeepStrictEqual } = require('node:util');
const endpoint = new URL(process.argv[2]);
const target = new URL(process.argv[3]);
const token = process.argv[4];
const origin = 'http://127.0.0.1:8093';
const appKey = 'external-lifecycle-fixture', version = 'v1';
if (!/^[0-9a-f-]{36}$/.test(token || '') || endpoint.origin !== 'http://127.0.0.1:19231' || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password || target.origin !== origin || target.username || target.password || target.hash !== '#'+token) throw Error('Dedicated loopback fixture capability required');
const dashboard = target.pathname === '/index.html' && target.search === '';
const editor = target.pathname === '/app_editor.html' && target.search === '?identKey=isolated-lifecycle&appKey='+appKey+'&version='+version;
if (!dashboard && !editor) throw Error('Exact fixture dashboard/editor target required');
const allowed = new Set(dashboard ? ['pwappy_list_apps','pwappy_create_app','pwappy_create_version','pwappy_get_editor_url','pwappy_delete_version','pwappy_delete_app','pwappy_archive_app','pwappy_restore_app','pwappy_list_archived_apps'] : ['pwappy_get_application_json','pwappy_get_save_status','pwappy_manage_script','pwappy_save_project','pwappy_get_authoring_guide','pwappy_get_project_summary','pwappy_validate_project_structure','pwappy_manage_element','pwappy_manage_page']);
let browser,session;
const tools = new Map(), responses = new Map(), pending = new Map();
const ready = (async()=>{
 browser = await chromium.connectOverCDP(endpoint.href);
 const browserSession = await browser.newBrowserCDPSession();
 const {arguments:args} = await browserSession.send('Browser.getBrowserCommandLine');
 await browserSession.detach();
 if (!args.includes('--pwappy-isolated-lifecycle='+token) || !args.some(arg=>/^--user-data-dir=.*playwright_chromiumdev_profile-/.test(arg))) throw Error('Not the dedicated fresh Playwright fixture browser');
 const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url()===target.href);
 if(pages.length!==1)throw Error('Exact unique fixture page not found');
 session=await pages[0].context().newCDPSession(pages[0]);
 session.on('WebMCP.toolsAdded',({tools:added})=>added.forEach(t=>tools.set(t.name,t)));
 session.on('WebMCP.toolsRemoved',({tools:removed})=>removed.forEach(t=>tools.delete(t.name)));
 session.on('WebMCP.toolResponded',response=>{if(pending.has(response.invocationId))pending.get(response.invocationId)(response);else responses.set(response.invocationId,response);});
 await session.send('WebMCP.enable'); await session.send('Page.getFrameTree');
})();
function guard(name,args){
 if(!allowed.has(name))throw Error('Outside fixture lifecycle allowlist');
 const keys={pwappy_get_authoring_guide:[],pwappy_get_project_summary:[],pwappy_validate_project_structure:[],pwappy_manage_element:['action','targetDomId','element','attribute','value'],pwappy_manage_page:['action','element'],pwappy_list_archived_apps:['appKey'],pwappy_archive_app:['appKey','expectedOrigin','confirm','acknowledgeDailyCost','acknowledgeCost'],pwappy_restore_app:['appKey','expectedOrigin','confirm','acknowledgeDailyCost','acknowledgeCost'],pwappy_list_apps:['appKey'],pwappy_create_app:['appKey','appName','expectedOrigin','confirm','acknowledgeDailyCost'],pwappy_create_version:['appKey','version','expectedOrigin','confirm'],pwappy_get_editor_url:['appKey','version'],pwappy_delete_version:['appKey','version','expectedOrigin','confirm','confirmIrreversible'],pwappy_delete_app:['appKey','expectedOrigin','confirm','confirmIrreversible','archived','expectedVersions'],pwappy_get_application_json:[],pwappy_get_save_status:[],pwappy_manage_script:['action','scriptName','scriptContent'],pwappy_save_project:['appKey','version','expectedRevision']};
 if(Object.keys(args).some(k=>!keys[name].includes(k)))throw Error('Outside fixture argument allowlist');
 if(args.appKey!==undefined&&args.appKey!==appKey||args.version!==undefined&&args.version!==version)throw Error('Outside exact fixture application/version');
 if(name==='pwappy_manage_element'&&![{action:'add_first_child',targetDomId:'application',element:{tagName:'ons-navigator',domId:'externalNavigator',attributes:{},children:[],explain:'隔離テスト画面遷移'}},{action:'update_attribute',targetDomId:'externalNavigator',attribute:'page',value:'home.html'},{action:'update_attribute',targetDomId:'externalHome',attribute:'data-lifecycle',value:'constructed-under-modal'}].some(payload=>isDeepStrictEqual(args,payload)))throw Error('Only fixed synthetic navigator/page attribute operations allowed');
 if(name==='pwappy_manage_page'&&!isDeepStrictEqual(args,{action:'add',element:{tagName:'ons-page',domId:'externalHome',attributes:{'template-id':'home.html'},children:[{tagName:'div',domId:'externalBackground',attributes:{class:'page__background'},children:[]},{tagName:'div',domId:'externalContent',attributes:{class:'page__content'},children:[{tagName:'h1',domId:'externalTitle',attributes:{},text:'External native authoring',children:[]}]}],explain:'隔離テストホーム'}}))throw Error('Only fixed synthetic home page creation allowed');
 if(name==='pwappy_manage_script'&&(args.action!=='upsert'||args.scriptName!=='externalLifecycleValue'||args.scriptContent!=='function externalLifecycleValue(){ return "saved-external-lifecycle"; }'))throw Error('Only fixed synthetic script edit allowed');
 if(['pwappy_create_app','pwappy_create_version','pwappy_get_editor_url','pwappy_delete_version','pwappy_delete_app','pwappy_archive_app','pwappy_restore_app','pwappy_save_project'].includes(name)&&args.appKey!==appKey)throw Error('Exact fixture app required');
 if(['pwappy_create_version','pwappy_get_editor_url','pwappy_delete_version','pwappy_save_project'].includes(name)&&args.version!==version)throw Error('Exact fixture version required');
 if(['pwappy_delete_app','pwappy_delete_version'].includes(name)&&args.confirmIrreversible!==true)throw Error('Explicit irreversible fixture deletion confirmation required');
 if(['pwappy_create_app','pwappy_archive_app','pwappy_restore_app'].includes(name)&&args.acknowledgeDailyCost!==true)throw Error('Fixture cost acknowledgement required');
 if(['pwappy_archive_app','pwappy_restore_app'].includes(name)&&args.acknowledgeCost!==true)throw Error('Fixture move cost acknowledgement required');
 if(name==='pwappy_delete_app'&&(!Array.isArray(args.expectedVersions)||args.expectedVersions.length!==0||args.archived!==false))throw Error('Only empty active fixture app deletion allowed');
 if(name==='pwappy_create_app'&&args.appName!=='External lifecycle fixture')throw Error('Exact fixture app name required');
 if(dashboard&&name!=='pwappy_list_apps'&&name!=='pwappy_list_archived_apps'&&name!=='pwappy_get_editor_url'&&(args.expectedOrigin!==origin||args.confirm!==true))throw Error('Explicit fixture mutation confirmation required');
}
async function dispatch(method,params){
 await ready;
 if(method==='initialize')return{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'pwappy-dedicated-lifecycle-fixture',version:'1.0.0'}};
 const {frameTree}=await session.send('Page.getFrameTree');
 if(frameTree.frame.url+(frameTree.frame.urlFragment||'')!==target.href)throw Error('Target navigated outside exact fixture page; reconnect required');
 if(method==='tools/list')return{tools:[...tools.values()].filter(t=>allowed.has(t.name)).map(t=>({name:t.name,inputSchema:t.inputSchema||{type:'object'}})),_meta:{nativeDiscoveredCount:tools.size}};
 if(method!=='tools/call')throw Error('Unsupported method');
 const args=params.arguments||{};guard(params.name,args);
 const tool=tools.get(params.name);if(!tool)throw Error('Native tool unavailable');
 const {invocationId}=await session.send('WebMCP.invokeTool',{frameId:tool.frameId,toolName:tool.name,input:args});
 const response=responses.get(invocationId)||await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{pending.delete(invocationId);reject(Error('Invocation timed out'));},15000);pending.set(invocationId,value=>{clearTimeout(timeout);pending.delete(invocationId);resolve(value);});});
 responses.delete(invocationId);
 if(response.status!=='Completed')return{isError:true,content:[{type:'text',text:response.errorText||response.status}]};
 return{content:[{type:'text',text:typeof response.output==='string'?response.output:JSON.stringify(response.output)}]};
}
readline.createInterface({input:process.stdin}).on('line',async line=>{let msg;try{msg=JSON.parse(line);if(msg.id===undefined)return;process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:await dispatch(msg.method,msg.params)})+'\n');}catch(error){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg?.id??null,error:{code:-32602,message:error.message}})+'\n');}}).on('close',async()=>{if(session)await session.detach();if(browser)await browser.close();});
