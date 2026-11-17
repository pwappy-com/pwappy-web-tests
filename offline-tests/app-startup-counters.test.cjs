const {test}=require('node:test');const assert=require('node:assert/strict');const schema=require('../scripts/app-startup-counters.cjs');
const row={round:1,phase:'readback_retries',count:0};
test('counter required all three rounds, bounded and distinct from durations',()=>{
 assert.equal(schema.validate([1,2,3].map(round=>({...row,round})),true).length,3);
 for(const bad of [[row,row],[{...row,count:5}],[{...row,count:-1}],[{...row,count:1.5}],[{...row,durationMs:2}],[{...row,phase:'url'}]])assert.throws(()=>schema.validate(bad));
 assert.throws(()=>schema.validate([row],true));
});
test('counter attachment rejects raw paths and malformed/missing evidence',()=>{
 const t={title:'Runner benchmark round 1',location:{file:'/safe/tests/tools/runner-benchmark.spec.ts'}};
 const a={name:'pwappy-app-startup-counters',contentType:'application/json',body:Buffer.from(JSON.stringify([row]))};
 assert.equal(schema.attachmentRows(t,{status:'passed',attachments:[a]}).length,1);
 for(const result of [{status:'passed'},{status:'passed',attachments:[{...a,path:'/secret'}]},{status:'passed',attachments:[a,a]},{status:'passed',attachments:[{...a,body:Buffer.alloc(257)}]}])assert.throws(()=>schema.attachmentRows(t,result));
});
