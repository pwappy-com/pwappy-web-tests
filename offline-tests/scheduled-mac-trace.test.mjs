import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { omitScheduledMacTraceScreenshots as policy } from '../scripts/scheduled-mac-trace-policy.mjs';
import { mainInvocation, mainSelection } from '../scripts/run-main-verification.mjs';
import { SCHEDULES } from '../scripts/main-verification-guard.mjs';
const dir=mkdtempSync(join(tmpdir(),'synthetic-trace-policy-')),eventPath=join(dir,'event.json');
process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));
const env={GITHUB_EVENT_NAME:'schedule',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_PATH:eventPath,PWAPPY_TEST_POINTS_ENABLED:'true'};
const selection={mode:'main',suite:'normal',scope:'all',os:'macos-latest',browser:'webkit'};
const runtime={platform:'darwin',arch:'arm64'};
const setEvent=schedule=>writeFileSync(eventPath,JSON.stringify({schedule}));
setEvent(SCHEDULES[1]);
test('only existing Mac Normal schedule opts in, desktop and mobile',()=>{
 setEvent(SCHEDULES[1]);
 for(const browser of ['webkit','mobile-safari'])assert.equal(policy({...selection,browser},'tests',env,runtime),true);
 for(const schedule of [SCHEDULES[0],SCHEDULES[2],'arbitrary']){setEvent(schedule);assert.equal(policy(selection,'tests',env,runtime),false);}
 setEvent(SCHEDULES[1]);
});
test('every out-of-scope route keeps recording',()=>{
 setEvent(SCHEDULES[1]);
 for(const delta of [{mode:'branch'},{suite:'premium'},{scope:'points-smoke'},{os:'ubuntu-latest'},{os:'windows-latest'},{browser:'chromium'}])
  assert.equal(policy({...selection,...delta},'tests',env,runtime),false);
 for(const phase of ['cleanup','other'])assert.equal(policy(selection,phase,env,runtime),false);
 for(const actual of [{platform:'darwin',arch:'x64'},{platform:'linux',arch:'arm64'},{platform:'win32',arch:'arm64'}])
  assert.equal(policy(selection,'tests',env,actual),false);
 for(const event of ['push','workflow_dispatch','pull_request'])assert.equal(policy(selection,'tests',{...env,GITHUB_EVENT_NAME:event},runtime),false);
 assert.equal(policy(selection,'tests',{...env,GITHUB_REF:'refs/heads/diagnostic'},runtime),false);
});
test('missing/malformed event never changes recording',()=>{
 writeFileSync(eventPath,'bad json');assert.equal(policy(selection,'tests',env,runtime),false);
 assert.equal(policy(selection,'tests',{...env,GITHUB_EVENT_PATH:'/nonexistent/synthetic'},runtime),false);setEvent(SCHEDULES[1]);
});
test('internal flag injection cannot opt other scopes in, cleanup remains normal',()=>{
 for(const event of ['push','workflow_dispatch','schedule']){
  const e={...env,GITHUB_EVENT_NAME:event,PWAPPY_MAIN_TRACE_NO_SCREENSHOTS:'true'};
  for(const suite of ['normal','premium']){
   const s=mainSelection(suite,'webkit','macos-latest',e,3);
   const cleanup=mainInvocation(s,'cleanup','/tmp/synthetic',e,0);
   assert.equal(cleanup.childEnv.PWAPPY_MAIN_TRACE_NO_SCREENSHOTS,'false');
   if(event!=='schedule'||suite==='premium')assert.equal(mainInvocation(s,'tests','/tmp/synthetic',e,0).childEnv.PWAPPY_MAIN_TRACE_NO_SCREENSHOTS,'false');
  }
 }
});
const baseSource=readFileSync(new URL('../playwright.config.ts',import.meta.url),'utf8')
 .replace(/^import .*;\r?\n/gm,'').replace('export default defineConfig(','globalThis.config = defineConfig(');
const safeSource=readFileSync(new URL('../playwright.main-safe.config.ts',import.meta.url),'utf8')
 .replace(/^import .*;\r?\n/gm,'').replaceAll(' as const','').replace('export default defineConfig(','globalThis.config = defineConfig(');
function config(extra={},actual=runtime){
 const context={process:{env:{CI:'true',PWAPPY_TEST_POINTS_PHASE:'tests',PWAPPY_TRACE_SNAPSHOTS:'false',...extra},...actual},defineConfig:v=>v,devices:{},getStorageStatePath:(...a)=>a.join('-')};
 vm.runInNewContext(baseSource,context);context.base=context.config;vm.runInNewContext(safeSource,context);return JSON.parse(JSON.stringify(context.config));
}
test('actual resulting config differs only in trace.screenshots',()=>{
 for(const snapshots of ['true','false']){
  const a=config({PWAPPY_TRACE_SNAPSHOTS:snapshots}),b=config({PWAPPY_TRACE_SNAPSHOTS:snapshots,PWAPPY_MAIN_TRACE_NO_SCREENSHOTS:'true'});
  assert.equal(b.use.trace.mode,'retain-on-failure');assert.equal(b.use.trace.snapshots,snapshots==='true');
  assert.equal(b.use.trace.screenshots,false);assert.equal(b.use.screenshot,'only-on-failure');assert.equal(b.use.video,'off');
  delete b.use.trace.screenshots;assert.deepEqual(b,a);
 }
});
test('config independently crosschecks CPU/OS/phase, branch raw-evidence restriction wins',()=>{
 for(const actual of [{platform:'darwin',arch:'x64'},{platform:'linux',arch:'arm64'}])
  assert.deepEqual(config({PWAPPY_MAIN_TRACE_NO_SCREENSHOTS:'true'},actual),config({},actual));
 for(const delta of [{CI:'false'},{PWAPPY_TEST_POINTS_PHASE:'cleanup',TEST_WORKER_INDEX:'0'}])
  assert.deepEqual(config({...delta,PWAPPY_MAIN_TRACE_NO_SCREENSHOTS:'true'}),config(delta));
 const c=config({PWAPPY_MAIN_TRACE_NO_SCREENSHOTS:'true',PWAPPY_MAIN_DISABLE_RAW_EVIDENCE:'true'});
 assert.equal(c.use.trace,'off');assert.equal(c.use.screenshot,'off');assert.equal(c.use.video,'off');
});
test('exact rollback restores original files; workflows/guards/base config stay byte identical',()=>{
 const digest=s=>createHash('sha256').update(s).digest('hex');
 const entries=JSON.parse(readFileSync(new URL('./scheduled-mac-trace-rollback.json',import.meta.url),'utf8'));
 for(const {file,edits,sha256} of entries){
  let actual=readFileSync(new URL('../'+file,import.meta.url),'utf8');
  for(const {before,after} of edits){assert.equal(actual.split(after).length-1,1);actual=actual.replace(after,before);}
  assert.equal(digest(actual),sha256,'unreviewed change in '+file);
 }
 const untouched=JSON.parse(readFileSync(new URL('./scheduled-mac-trace-unchanged.json',import.meta.url),'utf8'));
 for(const [file,sha] of Object.entries(untouched))assert.equal(digest(readFileSync(new URL('../'+file,import.meta.url))),sha,file);
});
