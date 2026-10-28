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

test('accepts a canonical integer string from the read API', async()=>{
 await prepareTestPoints({post:async()=>reply(success),get:async()=>reply({code:200,details:{pwappyPoints:'100'}})},env,'pwua000');
});
test('rejects malformed or insufficient readback without coercion or another preparation', async()=>{
 for(const balance of ['', ' ', '1e2', '100.0', '100x', '+100', '0100', '-100', '99', '9007199254740993', null, true, {}, 100.5, -100]) {
  let writes=0;
  await assert.rejects(prepareTestPoints({post:async()=>{writes++;return reply(success)},get:async()=>reply({code:200,details:{pwappyPoints:balance}})},env,'pwua000'));
  assert.equal(writes,1);
 }
});

const replay = {...success, preparationVersion:1, preparedBalance:100, balance:98, added:0, replayed:true};
test('consumed balance replay validates receipt and independent current balance without another write',async()=>{
 let writes=0;
 await prepareTestPoints({post:async()=>{writes++;return reply(replay)},get:async()=>reply({code:200,details:{pwappyPoints:'98'}})},env,'pwua000');
 assert.equal(writes,1);
});
test('rejects invalid receipts, replay additions, initial shortfall and inconsistent readback',async()=>{
 for(const write of [
  {...replay,preparedBalance:98},{...replay,preparedBalance:undefined},
  {...replay,added:2},{...replay,replayed:false},{...replay,replayed:'true'},
  {...replay,preparationVersion:2},{...replay,balance:-1}
 ]) await assert.rejects(prepareTestPoints({post:async()=>reply(write),get:async()=>reply({code:200,details:{pwappyPoints:98}})},env,'pwua000'));
 await assert.rejects(prepareTestPoints({post:async()=>reply(replay),get:async()=>reply({code:200,details:{pwappyPoints:97}})},env,'pwua000'));
});
