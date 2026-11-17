import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mainGuard,validateMainConfiguration} from '../scripts/main-verification-guard.mjs';
import {validateConfiguration,STAGING_ORIGIN,LOGIN_ENDPOINT} from '../scripts/branch-verification-guard.mjs';
const sourceCommit='6de60fb902e9fc42f7622da826fbb775246af6b4';
const pin={sourceCommit};
const sha='5b73f05221d3df02d6a6325adbc636e8048c75b7';
const repo='pwappy-com/pwappy-web-tests';
const env={GITHUB_REPOSITORY:repo,GITHUB_REF:'refs/heads/main',GITHUB_SHA:sha,GITHUB_WORKFLOW_SHA:sha,GITHUB_WORKFLOW_REF:`${repo}/.github/workflows/e2e-tests.yml@refs/heads/main`,GITHUB_EVENT_NAME:'schedule',PWAPPY_TEST_BASE_URL:STAGING_ORIGIN,PWAPPY_TEST_LOGIN_ENDPOINT:LOGIN_ENDPOINT};
const event={schedule:'0 0 * * *',repository:{full_name:repo,fork:false,default_branch:'main'}};
const check=(e=env,v=event)=>validateMainConfiguration(e,v,pin,'premium');
test('fixed periodic main and existing automated main push qualify',()=>{
 assert.equal(check().sourceCommit,sourceCommit);
 assert.equal(check({...env,GITHUB_EVENT_NAME:'push'},{...event,ref:env.GITHUB_REF,after:sha,head_commit:{id:sha},forced:false,deleted:false}).sourceCommit,sourceCommit);
});
test('wrong identity, ref, workflow, commit or event never inherits approval',()=>{
 for(const change of [{GITHUB_REPOSITORY:'fork/pwappy-web-tests'},{GITHUB_REF:'refs/heads/feature'},{GITHUB_WORKFLOW_REF:`${repo}/.github/workflows/other.yml@refs/heads/main`},{GITHUB_WORKFLOW_SHA:'a'.repeat(40)},{GITHUB_SHA:'short'},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_EVENT_NAME:'workflow_dispatch'}]) assert.throws(()=>check({...env,...change}));
 for(const change of [{repository:{...event.repository,fork:true}},{repository:{...event.repository,full_name:'fork/pwappy-web-tests'}},{repository:{...event.repository,default_branch:'other'}},{repository:undefined},{schedule:'* * * * *'}]) assert.throws(()=>check(env,{...event,...change}));
});
test('main identity does not relax source or destination validation',()=>{
 for(const change of [{PWAPPY_TEST_BASE_URL:'https://pwappy.com'},{PWAPPY_TEST_LOGIN_ENDPOINT:'https://example.com/login'},{PWAPPY_TEST_POINTS_READ_ENDPOINT:'https://example.com/points'},{PWAPPY_WEBMCP_SOURCE_SHA:'a'.repeat(40)}]) assert.throws(()=>check({...env,...change}));
 assert.throws(()=>validateMainConfiguration(env,event,{sourceCommit:'bad'},'premium'));
});
test('manual and marked feature branch retain legacy source-specific authorization',()=>{
 const branch='refs/heads/feat/webmcp-authoring';
 const e={...env,GITHUB_REF:branch,GITHUB_EVENT_NAME:'workflow_dispatch'};
 const v={...event,ref:branch};
 assert.throws(()=>check(e,v));
 assert.equal(check({...e,PWAPPY_WEBMCP_LIVE_PREMIUM_AUTHORIZED_SHA:sourceCommit},v).sourceCommit,sourceCommit);
 const push={...event,ref:branch,after:sha,head_commit:{id:sha,message:'[verify-webmcp]'},forced:false,deleted:false};
 assert.throws(()=>validateConfiguration({...e,GITHUB_EVENT_NAME:'push'},push,pin,'premium'));
 assert.equal(validateConfiguration({...e,GITHUB_EVENT_NAME:'push',PWAPPY_WEBMCP_LIVE_PREMIUM_AUTHORIZED_SHA:sourceCommit},push,pin,'premium').sourceCommit,sourceCommit);
});
test('live mismatch blocks before any authenticated work; fixed unauthenticated marker only',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'recurring-premium-'));const file=join(dir,'event.json');writeFileSync(file,JSON.stringify(event));let authenticated=0;let calls=0;
 try {
  await assert.rejects(async()=>{
   await mainGuard('premium',{...env,GITHUB_EVENT_PATH:file},{readPin:()=>pin,fetch:async(url,options)=>{calls++;assert.equal(url.origin,STAGING_ORIGIN);assert.equal(url.pathname,'/staging-deployment.json');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');return{ok:true,redirected:false,url:url.href,body:(async function*(){yield Buffer.from(JSON.stringify({commit:'a'.repeat(40),run_id:'1',run_attempt:'1'}));})()};}});
   authenticated++;
  },/pinned deployment/);
  assert.equal(calls,1);assert.equal(authenticated,0);
 } finally {rmSync(dir,{recursive:true});}
});
