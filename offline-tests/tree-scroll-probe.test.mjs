import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installTreeScrollProbe} from '../tests/tools/tree-scroll-probe.ts';
function fixture() {
 const listeners = new Set(), calls = [];
 const proto = {scrollTo(...args){calls.push({self:this,args}); if(args[0]?.throw) throw args[0].throw;return args[0]?.result;}};
 const tree=Object.assign(Object.create(proto),{isConnected:true,scrollTop:0,
 addEventListener(_,fn){listeners.add(fn)}, removeEventListener(_,fn){listeners.delete(fn)}});
 return {tree,listeners,calls,emit(){for(const fn of listeners)fn()}};
}
test('native this/arguments/return and thrown identity preserved, foreign receivers not counted',()=>{
 const {tree,calls}=fixture(), original=tree.scrollTo,probe=installTreeScrollProbe(tree);
 probe.begin();const options={top:2,result:{identity:true}};
 assert.equal(tree.scrollTo(options),options.result);assert.equal(calls[0].self,tree);assert.equal(calls[0].args[0],options);
 const error=new Error('PRIVATE');assert.throws(()=>tree.scrollTo({throw:error}),e=>e===error);
 assert.equal(probe.summary().requestThrew,true);
 probe.begin();tree.scrollTo.call({},options);
 assert.equal(probe.summary().requestObserved,false);
 probe.dispose();assert.equal(tree.scrollTo,original);assert.equal(Object.hasOwn(tree,'scrollTo'),false);
});
test('request without motion distinguished from motion, reset window and boolean-only report',()=>{
 const {tree,emit,listeners}=fixture(),probe=installTreeScrollProbe(tree);probe.begin();
 tree.scrollTo({top:20});assert.equal(probe.summary().requestObserved,true);
 assert.equal(probe.summary().movementObserved,false);
 tree.scrollTop=20;emit();assert.equal(probe.summary().increaseObserved,true);
 tree.scrollTop=10;emit();assert.equal(probe.summary().decreaseObserved,true);
 assert.ok(Object.values(probe.summary()).every(v=>typeof v==='boolean'));
 probe.begin();assert.equal(probe.summary().requestObserved,false);assert.equal(probe.summary().eventObserved,false);
 tree.isConnected=false;assert.equal(probe.summary().windowObserved,false);
 probe.dispose();probe.dispose();assert.equal(listeners.size,0);assert.equal(probe.summary().available,false);
});
test('restores exact own descriptor; declines protected accessors; does not clobber later replacement',()=>{
 const {tree}=fixture();Object.defineProperty(tree,'scrollTo',{value:tree.scrollTo,writable:false,enumerable:true,configurable:true});
 const descriptor=Object.getOwnPropertyDescriptor(tree,'scrollTo');const p=installTreeScrollProbe(tree);p.dispose();
 assert.deepEqual(Object.getOwnPropertyDescriptor(tree,'scrollTo'),descriptor);
 Object.defineProperty(tree,'scrollTo',{get(){return ()=>{}},configurable:true});assert.equal(installTreeScrollProbe(tree),null);
 const f=fixture();const q=installTreeScrollProbe(f.tree);const replacement=()=>{};f.tree.scrollTo=replacement;q.dispose();assert.equal(f.tree.scrollTo,replacement);
});
test('real suite keeps assertions and scopes observer cleanup, exposes only named booleans',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('../tests/specs/normal/editor-ui-basic.spec.ts',import.meta.url),'utf8');
 assert.match(source,/evaluateHandle\(installTreeScrollProbe, undefined, \{ timeout: 1000 \}\)/);
 assert.match(source,/if \(phase === 'before-assert' && scrollProbe\) await scrollProbe.evaluate\(p => p\?\.begin\(\)\)/);
 assert.match(source,/catch \(error\) \{\s*await reportDragState\('assertion-failed'\);\s*throw error;/);
 assert.match(source,/finally \{\s*if \(scrollProbe\)/);
 assert.match(source,/await scrollProbe.dispose\(\).catch/);
 assert.match(source,/await expect\(finalNodes\).toHaveCount\(2\)/);
 const log=source.split('\n').find(l=>l.includes("console.log('[EditorDragState]"));
 assert.ok(log.includes('...probeState'));assert.ok(!log.includes('probeSummary'));
});
