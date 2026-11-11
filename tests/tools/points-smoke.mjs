import { request } from '@playwright/test';
import assert from 'node:assert/strict';

const login = new URL(process.env.PWAPPY_TEST_LOGIN_ENDPOINT);
assert.equal(login.protocol, 'https:');
assert.match(login.pathname, /\/rest\/v1\/test-login$/);
const read = new URL(login); read.pathname = read.pathname.replace('/rest/', '/read/').replace('test-login', 'pwappy-points');
const prepare = new URL(login); prepare.pathname = prepare.pathname.replace('test-login', 'test-prepare-points');
const identKey = process.env.PWAPPY_SMOKE_IDENT;
assert.match(identKey, /^pw(uc|ua|wc|ms|mi)998$/);
const api = await request.newContext();
const passcode = process.env.PWAPPY_TEST_LOGIN_PASSCODE;
assert.ok(passcode);
const json = async (response, label) => {
  const body = await response.json();
  const stage = typeof body.stage === 'string' && /^[a-z_]{1,40}$/.test(body.stage) ? body.stage : 'unknown';
  assert.equal(response.status(), 200, `${label} HTTP status (stage=${stage})`);
  assert.equal(body.code, 200, `${label} API code`); return body;
};
const balance = async () => {
  const b = await json(await api.get(read.href), 'read');
  assert.ok(Number.isSafeInteger(b.details?.pwappyPoints)); return b.details.pwappyPoints;
};
try {
  const auth = await api.post(login.href, {data:{passcode,identkey:identKey}});
  assert.equal(auth.status(),200,'login HTTP status');
  const before = await balance();
  const data={passcode,identKey,runId:process.env.PWAPPY_TEST_RUN_ID,phase:'tests'};
  const deny=await api.post(prepare.href,{data:{...data,passcode:'invalid-smoke-passcode'}});
  assert.equal(deny.status(),403,'invalid credentials must fail');
  const unlisted=await api.post(prepare.href,{data:{...data,identKey:identKey.replace('998','997')}});
  assert.equal(unlisted.status(),403,'unlisted account must fail');
  const results=await Promise.all([1,2].map(async()=>json(await api.post(prepare.href,{data}), 'prepare')));
  assert.equal(results.reduce((n,r)=>n+r.added,0),Math.max(0,100-before),'one adjustment for concurrent requests');
  assert.equal(results.filter(r=>r.replayed).length,1,'one request must be replayed');
  const after=await balance();assert.equal(after,Math.max(100,before),'readback after concurrent preparation');
  const replay=await json(await api.post(prepare.href,{data}), 'replay');assert.equal(replay.added,0);assert.equal(replay.replayed,true);
  const cleanup=await json(await api.post(prepare.href,{data:{...data,phase:'cleanup'}}),'cleanup preparation');
  assert.ok(await balance()>=cleanup.target);
  console.log(`POINTS_SMOKE_OK account=${identKey} before=${before} after=${after} cleanupTarget=${cleanup.target}`);
} finally { await api.dispose(); }
