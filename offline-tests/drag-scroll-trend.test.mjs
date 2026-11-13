import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScrollTrend } from '../tests/tools/drag-scroll-trend.ts';
test('bounded summary distinguishes no observed motion from advance and return', () => {
 const t=createScrollTrend(); [0,0,0].forEach(x=>t.observe(x));
 assert.equal(t.summary().scrollTrendSampled,true);
 assert.equal(t.summary().scrollObservedIncrease,false);
 [5,12,4,0].forEach(x=>t.observe(x));
 assert.equal(t.summary().scrollObservedIncrease,true);
 assert.equal(t.summary().scrollObservedDecrease,true);
 assert.equal(t.summary().scrollObservedReturnToTop,true);
 assert.ok(Object.values(t.summary()).every(x=>typeof x==='boolean'));
});
test('missing samples and jitter are not evidence of motion', () => {
 const t=createScrollTrend(); [null,NaN,Infinity,0,0.1,0].forEach(x=>t.observe(x));
 assert.equal(t.summary().scrollSampleUnavailable,true);
 assert.equal(t.summary().scrollObservedIncrease,false);
 assert.equal(t.summary().scrollObservedReturnToTop,false);
});
