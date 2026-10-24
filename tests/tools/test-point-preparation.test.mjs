import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareTestPoints } from './test-point-preparation.ts';
const env = { PWAPPY_TEST_LOGIN_ENDPOINT: 'https://staging.example/rest/v1/test-login', PWAPPY_TEST_POINTS_READ_ENDPOINT: 'https://staging.example/read/v1/pwappy-points', PWAPPY_TEST_LOGIN_PASSCODE: 'test-only', PWAPPY_TEST_RUN_ID: '123-1' };
const reply = (body, status=200) => ({ok:()=>status===200, status:()=>status, json:async()=>body});
const success = {code:200,status:'test_points_prepared',balance:100,target:100};
test('prepares and independently verifies balance', async()=>{
 let request; const api={post:async(url,args)=>{request={url,...args.data};return reply(success)}, get:async()=>reply({code:200,details:{pwappyPoints:100}})};
 await prepareTestPoints(api,env,'pwua000'); assert.equal(request.phase,'tests'); assert.equal(request.identKey,'pwua000'); assert.match(request.url,/test-prepare-points$/);
});
test('cleanup sends a phase, never a client-selected amount',async()=>{
 let sent; await prepareTestPoints({post:async(u,a)=>{sent=a.data;return reply({...success,target:350,balance:350})},get:async()=>reply({code:200,details:{pwappyPoints:350}})}, {...env,PWAPPY_TEST_POINTS_PHASE:'cleanup'},'pwwc001'); assert.equal(sent.phase,'cleanup'); assert.equal(sent.amount,undefined);
});
for (const [label, write, read] of [
 ['HTTP error',reply({},403),reply({})], ['API error',reply({code:400}),reply({})],
 ['stale read',reply(success),reply({code:200,details:{pwappyPoints:0}})],
 ['malformed read',reply(success),reply({code:200,details:{pwappyPoints:null}})],
 ['read failure',reply(success),reply({},503)]
]) test(label,async()=>assert.rejects(prepareTestPoints({post:async()=>write,get:async()=>read},env,'pwua000')));
test('rejects configuration before sending credentials',async()=>{
 for(const changed of [{PWAPPY_TEST_RUN_ID:''},{PWAPPY_TEST_POINTS_READ_ENDPOINT:'https://other.example/read'},{PWAPPY_TEST_POINTS_PHASE:'arbitrary'},{PWAPPY_TEST_LOGIN_PASSCODE:''}]) {
  await assert.rejects(prepareTestPoints({post:()=>assert.fail('must not call')},{...env,...changed},'pwua000'));
 }
});
