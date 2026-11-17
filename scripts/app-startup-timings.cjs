'use strict';
const {lstatSync,readFileSync}=require('node:fs');
const PHASES=Object.freeze(['imports','initial_get_decode','hydrate_registration','compression','put','readback_decode','validate_reload','snapshot','starter']);
const REQUIRED=Object.freeze(PHASES.filter(x=>x!=='starter'));
function validate(rows,complete=false){
 if(!Array.isArray(rows)||rows.length>27)throw Error('Invalid app timing');
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
 const a=attachments[0];if(a.path||a.contentType!=='application/json'||!Buffer.isBuffer(a.body)||a.body.length>4096)throw Error('Invalid app timing');
 const rows=validate(JSON.parse(a.body.toString('utf8')));
 if(rows.some(r=>r.round!==Number(m[1])))throw Error('Invalid app timing');
 if(result.status==='passed')for(const p of REQUIRED)if(!rows.some(r=>r.phase===p))throw Error('Incomplete app timing');
 return rows;
}
function read(file,complete=false){const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>8192)throw Error('Invalid app timing');return validate(JSON.parse(readFileSync(file,'utf8')),complete);}
module.exports={PHASES,REQUIRED,validate,attachmentRows,read};
