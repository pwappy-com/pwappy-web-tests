import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
test('legacy feature-only workflow is archived, not runnable in Actions',()=>{
 assert.equal(existsSync(new URL('.github/workflows/webmcp-branch-verification.yml',root)),false);
 const text=readFileSync(new URL('offline-tests/fixtures/legacy-webmcp-branch-verification.yml',root));
 assert.equal(createHash('sha256').update(text).digest('hex'),'4d0714feb3d19643991a49a4abb3a6e2317ca51267246c8a13303727a8af4abd');
 for(const file of readdirSync(new URL('.github/workflows/',root)).filter(x=>/\.ya?ml$/.test(x))) assert.doesNotMatch(readFileSync(new URL('.github/workflows/'+file,root),'utf8'),/feat\/webmcp-authoring/);
 assert.ok(existsSync(new URL('.github/workflows/e2e-tests.yml',root)));
 assert.ok(existsSync(new URL('.github/workflows/webmcp-isolated.yml',root)));
});
