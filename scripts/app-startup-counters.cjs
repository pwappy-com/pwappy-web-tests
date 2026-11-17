'use strict';
const {lstatSync,readFileSync}=require('node:fs');
function validate(rows,complete=false){
 if(!Array.isArray(rows)||rows.length>3)throw Error('Invalid startup counter');
 const seen=new Set();
 for(const r of rows){if(!r||Object.keys(r).sort().join(',')!=='count,phase,round'||!Number.isInteger(r.round)||r.round<1||r.round>3||r.phase!=='readback_retries'||!Number.isInteger(r.count)||r.count<0||r.count>4||seen.has(r.round))throw Error('Invalid startup counter');seen.add(r.round);}
 if(complete&&seen.size!==3)throw Error('Missing startup counter');return rows;
}
function attachmentRows(test,result){
 if(!test?.location?.file?.replaceAll('\\','/').endsWith('/tests/tools/runner-benchmark.spec.ts'))return [];
 const m=/^Runner benchmark round ([1-3])$/.exec(test.title);if(!m)return [];
 const all=(result.attachments||[]).filter(a=>a.name==='pwappy-app-startup-counters');
 if(all.length>1)throw Error('Invalid startup counter');
 if(!all.length){if(result.status==='passed')throw Error('Missing startup counter');return [];}
 const a=all[0];if(a.path||a.contentType!=='application/json'||!Buffer.isBuffer(a.body)||a.body.length>256)throw Error('Invalid startup counter');
 const rows=validate(JSON.parse(a.body.toString('utf8')));
 if(rows.some(r=>r.round!==Number(m[1]))||(result.status==='passed'&&rows.length!==1))throw Error('Invalid startup counter');return rows;
}
function read(file,complete=false){const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>1024)throw Error('Invalid startup counter');return validate(JSON.parse(readFileSync(file,'utf8')),complete);}
module.exports={validate,attachmentRows,read};
