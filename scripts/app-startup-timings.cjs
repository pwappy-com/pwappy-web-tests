'use strict';
const {lstatSync,readFileSync}=require('node:fs');
const PHASES=Object.freeze(['imports','initial_get_decode','hydrate_registration','compression','put','readback_decode','validate_reload','snapshot','starter','import_agent_entry','import_snapshot_manager','import_ai_coder_window','import_file_explorer','import_login_container','import_app_menu_container','import_app_list_container','import_app_header_container','import_tool_box','import_tool_box_item_editor','import_platform_background','import_platform_container','import_platform_bottom_manu','import_app_container_loading_overlay','import_app_setting_store','import_editor_json_version_store','import_user_setting_store','import_template_selected_modifier_item_store','import_template_json_store','import_template_selected_root_store','import_template_selected_item_store','import_attribute_item_store','import_event_item_store','import_tool_box_item_store','import_script_item_store','import_platform_device_store','import_service_worker_item_store','import_test_item_store','import_platform_switcher','import_property_container','import_script_container','readback_headers','readback_body','readback_decompress','readback_parse','readback_normalize']);
const REQUIRED=Object.freeze(PHASES.filter(x=>x!=='starter'));
function validate(rows,complete=false){
 if(!Array.isArray(rows)||rows.length>PHASES.length*3)throw Error('Invalid app timing');
 const seen=new Set();
 for(const r of rows){
  if(!r||Object.keys(r).sort().join(',')!=='durationMs,phase,round'||!Number.isInteger(r.round)||r.round<1||r.round>3||!PHASES.includes(r.phase)||!Number.isInteger(r.durationMs)||r.durationMs<0||r.durationMs>120000||seen.has(r.round+'/'+r.phase))throw Error('Invalid app timing');
  seen.add(r.round+'/'+r.phase);
 }
 if(complete)for(let round=1;round<=3;round++)for(const phase of REQUIRED)if(!seen.has(round+'/'+phase))throw Error('Incomplete app timing');
 return rows;
}
function attachmentRows(test,result){
 if(!test?.location?.file?.replaceAll('\\','/').endsWith('/tests/tools/runner-benchmark.spec.ts'))return [];
 const m=/^Runner benchmark round ([1-3])$/.exec(test.title);if(!m)return [];
 const attachments=(result.attachments||[]).filter(a=>a.name==='pwappy-app-startup-scalars');
 if(attachments.length>1)throw Error('Invalid app timing');
 if(!attachments.length){if(result.status==='passed')throw Error('Missing app timing');return [];}
 const a=attachments[0];if(a.path||a.contentType!=='application/json'||!Buffer.isBuffer(a.body)||a.body.length>8192)throw Error('Invalid app timing');
 const rows=validate(JSON.parse(a.body.toString('utf8')));
 if(rows.some(r=>r.round!==Number(m[1])))throw Error('Invalid app timing');
 if(result.status==='passed')for(const p of REQUIRED)if(!rows.some(r=>r.phase===p))throw Error('Incomplete app timing');
 return rows;
}
function read(file,complete=false){const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>32768)throw Error('Invalid app timing');return validate(JSON.parse(readFileSync(file,'utf8')),complete);}
module.exports={PHASES,REQUIRED,validate,attachmentRows,read};
