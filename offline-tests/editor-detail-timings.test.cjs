const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validate,stepTiming}=require('../scripts/editor-detail-timings.cjs');
const input={location:{file:'/repo/tests/tools/runner-benchmark.spec.ts'},title:'Runner benchmark round 1'};
const step={category:'test.step',title:'runner-editor-detail:popup_trigger',duration:123};
test('only scalar fixed enum survives including failed steps',()=>{
  assert.deepEqual(stepTiming(input,{...step,error:{message:'PRIVATE URL'}}),{round:1,phase:'popup_trigger',durationMs:123,status:'failed'});
});
test('ignores foreign titles and API steps rather than logging them',()=>{
  assert.equal(stepTiming(input,{...step,title:'https://secret.invalid'}),null);
  assert.equal(stepTiming(input,{...step,category:'pw:api'}),null);
  assert.equal(stepTiming({...input,title:'Other test'},step),null);
});
test('rejects excess keys, duplicate rows, invalid bounds and enum injection',()=>{
  const row=stepTiming(input,step);
  for(const data of [[{...row,url:'secret'}],[row,row],[{...row,durationMs:Infinity}],[{...row,round:4}],[{...row,phase:'url'}]]){
    assert.throws(()=>validate(data));
  }
});
test('completed records require exact per-browser phase sets; symlinks and oversized data rejected',()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const schema=require('../scripts/editor-detail-timings.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'editor-detail-schema-')),file=path.join(dir,'data.json');
  try {
    const rows=[]; for(let round=1;round<=3;round++)for(const phase of schema.PHASES)rows.push({round,phase,durationMs:1,status:'passed'});
    fs.writeFileSync(file,JSON.stringify(rows)); assert.equal(schema.read(file,true,'webkit').length,33);
    assert.throws(()=>schema.read(file,true,'chromium'));
    fs.writeFileSync(file,JSON.stringify(rows.filter(row=>!['popup_interception','popup_create','popup_navigation'].includes(row.phase))));
    assert.equal(schema.read(file,true,'chromium').length,24);
    fs.writeFileSync(file,'[]'); assert.throws(()=>schema.read(file,true,'webkit'));
    assert.deepEqual(schema.read(file,false,'webkit'),[]);
    fs.symlinkSync(file,path.join(dir,'link')); assert.throws(()=>schema.read(path.join(dir,'link')));
    fs.writeFileSync(file,' '.repeat(8193)); assert.throws(()=>schema.read(file));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('wrapper canonicalizes detail path, keeps raw output ignored, cleanup cannot emit it',async()=>{
  const {mainSelection,mainInvocation}=await import('../scripts/run-main-verification.mjs');
  const env={GITHUB_EVENT_NAME:'workflow_dispatch',TEST_SCOPE:'runner-benchmark',PWAPPY_TEST_POINTS_ENABLED:'true',TEST_WORKERS:'1',TEST_RETRIES:'0'};
  const selected=mainSelection('normal','webkit','macos-latest',env);
  const invocation=mainInvocation(selected,'tests','/tmp/fixed-detail',env);
  const child=invocation.env || invocation.childEnv;
  assert.ok(child);
  assert.equal(child.PWAPPY_EDITOR_DETAIL_TIMINGS_PATH,'/tmp/fixed-detail/editor-detail-timings.json');
  const clean=mainInvocation(selected,'cleanup','/tmp/fixed-detail',env,0);
  assert.equal((clean.env||clean.childEnv).PWAPPY_EDITOR_DETAIL_TIMINGS_PATH,'');
});
test('reporter stores only validated detail rows and invalid durations stick failure',()=>{
  const Reporter=require('../scripts/main-count-reporter.cjs');
  const old=process.env.PWAPPY_BENCH_TIMINGS_PATH,oldDetail=process.env.PWAPPY_EDITOR_DETAIL_TIMINGS_PATH;
  process.env.PWAPPY_BENCH_TIMINGS_PATH='/not-written';process.env.PWAPPY_EDITOR_DETAIL_TIMINGS_PATH='/not-written';
  try{
    const reporter=new Reporter();reporter.onStepEnd(input,{},step);
    assert.deepEqual(reporter.editorDetailTimings,[{round:1,phase:'popup_trigger',durationMs:123,status:'passed'}]);
    reporter.onStepEnd(input,{}, {...step,title:'runner-editor-detail:popup_create',duration:Infinity});
    assert.equal(reporter.recordingFailed,true);
    assert.equal(reporter.editorDetailTimings.length,1);
  }finally{
    if(old===undefined)delete process.env.PWAPPY_BENCH_TIMINGS_PATH;else process.env.PWAPPY_BENCH_TIMINGS_PATH=old;
    if(oldDetail===undefined)delete process.env.PWAPPY_EDITOR_DETAIL_TIMINGS_PATH;else process.env.PWAPPY_EDITOR_DETAIL_TIMINGS_PATH=oldDetail;
  }
});
