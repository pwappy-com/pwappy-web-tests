import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAccountIndex } from './test-account-index.mjs';
test('worker restarts keep their parallel slot account', () => {
 for (const worker of ['1','6','18']) assert.equal(resolveAccountIndex(worker, {TEST_PARALLEL_INDEX:'1',TEST_WORKER_INDEX:worker}), '1');
 assert.equal(resolveAccountIndex('18', {TEST_PARALLEL_INDEX:'0'}),'0');
});
test('cleanup account survives Playwright overriding its worker variables', () => {
 for (const worker of ['0','1','5']) assert.equal(resolveAccountIndex(worker,{PWAPPY_TEST_ACCOUNT_INDEX:'3',TEST_PARALLEL_INDEX:'0',TEST_WORKER_INDEX:worker}),'3');
});
test('explicit callers work outside a Playwright worker', () => {
 assert.equal(resolveAccountIndex(998,{}),'998'); assert.equal(resolveAccountIndex('0',{}),'0');
});
test('invalid account selection fails before authentication', () => {
 for(const value of ['-1','1000','1x','']) assert.throws(()=>resolveAccountIndex('0',{PWAPPY_TEST_ACCOUNT_INDEX:value}));
});
