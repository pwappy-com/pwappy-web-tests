import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {validate, stepTiming, PHASES}=require('../scripts/runner-benchmark-timings.cjs');
const location={file:'/repo/tests/tools/runner-benchmark.spec.ts'};
const row={round:1,phase:'dashboard',durationMs:150,status:'passed'};
test('fixed phase numeric timing only',()=>{
 assert.deepEqual(stepTiming({title:'Runner benchmark round 1',location},{category:'test.step',title:'runner-benchmark:dashboard',duration:150}),row);
 const rows=[1,2,3].flatMap(round=>PHASES.map(phase=>({...row,round,phase})));
 assert.equal(validate(rows).length,18);
});
test('reject injected fields, strings, duplicates, bounds and unknown labels',()=>{
 for(const bad of [{...row,url:'secret'},{...row,phase:'secret'},{...row,round:4},{...row,durationMs:'secret'},{...row,durationMs:NaN},{...row,durationMs:120001},{...row,status:'secret'}])assert.throws(()=>validate([bad]));
 assert.throws(()=>validate([row,row]));
 for(const title of ['secret','Runner benchmark round 1 secret'])assert.equal(stepTiming({title,location},{category:'test.step',title:'runner-benchmark:dashboard',duration:1}),null);
 assert.equal(stepTiming({title:'Runner benchmark round 1',location},{category:'test.step',title:'runner-benchmark:secret',duration:1}),null);
});
import { mainSelection, mainInvocation } from '../scripts/run-main-verification.mjs';
import { readFileSync, mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
test('diagnostic scope uses single worker, three tests, no raw evidence and separate times',()=>{
 const env={GITHUB_EVENT_NAME:'workflow_dispatch',TEST_SCOPE:'runner-benchmark',TEST_WORKERS:'1',TEST_RETRIES:'0',PWAPPY_TEST_POINTS_ENABLED:'true'};
 const sel=mainSelection('normal','webkit','macos-latest',env);
 assert.deepEqual(sel.testArgs,['tests/tools/runner-benchmark.spec.ts']);
 assert.throws(()=>mainSelection('normal','webkit','macos-latest',{...env,TEST_WORKERS:'2'}));
 assert.throws(()=>mainSelection('normal','webkit','macos-latest',{...env,TEST_RETRIES:'1'}));
 assert.equal(mainSelection('normal','webkit','macos-latest',{...env,GITHUB_EVENT_NAME:'push'}).scope,'all');
 const call=mainInvocation(sel,'tests','/tmp/synthetic-root',env,0);
 assert.equal(call.childEnv.PWAPPY_MAIN_DISABLE_RAW_EVIDENCE,'true');
 assert.equal(call.childEnv.PWAPPY_RUNNER_BENCHMARK,'true');
 assert.equal(mainInvocation(sel,'cleanup','/tmp/synthetic-root',env,0).childEnv.PWAPPY_RUNNER_BENCHMARK,'');
});
test('normal dispatch benchmark remains serial, default push remains two',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/e2e-tests.yml',import.meta.url),'utf8');
 const block=workflow.split('      - name: Validate normal matrix parallelism\n')[1].split('\n      - name:')[0];
 const script=block.split('        run: |\n')[1].split('\n').map(l=>l.replace(/^          /,'')).join('\n');
 for(const [event,scope,n] of [['workflow_dispatch','runner-benchmark','1'],['push','runner-benchmark','2'],['workflow_dispatch','all','5']]){
 const file=join(mkdtempSync(join(tmpdir(),'bench-')),'out');
 const r=spawnSync('bash',['-c',script],{env:{...process.env,GITHUB_OUTPUT:file,EVENT_NAME:event,BENCH_SCOPE:scope,MATRIX_PARALLELISM_INPUT:'5'},encoding:'utf8'});
 assert.equal(r.status,0);assert.equal(readFileSync(file,'utf8'),`matrix_parallelism=${n}\n`);
 }
});
test('read rejects oversized/symlinked/incomplete timing records',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bench-schema-')),file=join(dir,'data'),link=join(dir,'link');
 writeFileSync(file,JSON.stringify([row]));
 assert.deepEqual(require('../scripts/runner-benchmark-timings.cjs').read(file,false),[row]);
 assert.throws(()=>require('../scripts/runner-benchmark-timings.cjs').read(file,true));
 symlinkSync(file,link);assert.throws(()=>require('../scripts/runner-benchmark-timings.cjs').read(link,false));
 writeFileSync(file,' '.repeat(8193));assert.throws(()=>require('../scripts/runner-benchmark-timings.cjs').read(file,false));
});
