import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSiblingDragSnapshot, findNativeScrollEdge } from '../tests/tools/drag-state-diagnostics.ts';
const secret = 'CANARY_private_label_URL_ID_class';
function fixture(hitKind = 'target-gap') {
  const marker = { classList: { contains: value => ['node-add-point', 'node-add-point-selected'].includes(value) } };
  const parent = {};
  const target = { parentElement: parent, nextElementSibling: marker, textContent: secret,
    getBoundingClientRect: () => ({ left: 10, right: 90, width: 80, top: 100, bottom: 150 }) };
  const source = { dataset: { nodeId: secret } };
  const tree = { contains: () => hitKind !== 'toolbar' && hitKind !== 'outside', getBoundingClientRect: () => ({ left: 0, right: 100, top: 60, bottom: 300 }) };
  const hit = { className: secret, closest: selector => selector === '.node'
    ? hitKind === 'target-node' ? target : hitKind === 'dragged-node' ? source : hitKind === 'target-gap' ? parent : null
    : hitKind === 'toolbar' ? {} : null };
  const root = { contains: el => el === hit, querySelector: s => s === '#dom-tree' ? tree : s.includes('ons-button1') ? target : source,
    elementFromPoint: () => hitKind === 'outside' ? null : hit };
  return { shadowRoot: root, ownerDocument: { defaultView: { dragItemType: 'node-id', dragItemId: secret }, querySelector: () => ({ textContent: secret }) } };
}
test('snapshot emits booleans and bounded hit enums, never source content or geometry', () => {
  for (const kind of ['target-gap', 'target-node', 'dragged-node', 'toolbar', 'outside', 'other']) {
    const result = readSiblingDragSnapshot(fixture(kind), { x: 50, y: 155 });
    assert.equal(result.hit, kind);
    for (const [key, value] of Object.entries(result)) if (key !== 'hit') assert.equal(typeof value, 'boolean');
    assert.doesNotMatch(JSON.stringify(result), /CANARY|155|className|textContent|nodeId/);
    assert.equal(result.targetInScrollport, true);
    assert.equal(result.pointerAtScrollEdge, false);
    assert.equal(result.hitWithinTree, kind !== 'toolbar' && kind !== 'outside');
    assert.equal(result.sourceMatched, true);
    assert.equal(result.siblingMarkerSelected, true);
  }
});
test('missing container and outside pointer are represented without throwing or raw errors', () => {
  assert.equal(readSiblingDragSnapshot(null, { x: 0, y: 0 }).captured, false);
  const value = readSiblingDragSnapshot(fixture(), { x: 500, y: 155 });
  assert.equal(value.pointerInScrollport, false); assert.equal(value.hit, 'other');
});
test('coordinate flow uses actual scrollport, keeps assertions, bounds read-only diagnostics and rethrows', () => {
  const source = readFileSync(new URL('../tests/specs/normal/editor-ui-basic.spec.ts', import.meta.url), 'utf8');
  const flow = source.slice(source.indexOf("test('ドラッグ＆ドロップ：座標操作"), source.indexOf('// Merged from: tests/specs/normal/editor-html-tag-dialog'));
  assert.equal((flow.match(/const layoutPanel = editorPage.locator\('template-container #dom-tree'\)/g) || []).length, 2);
  assert.doesNotMatch(flow, /template-container \.panel/);
  assert.match(flow, /readSiblingDragSnapshot, \{ x: currentX, y: currentY \}, \{ timeout: 1000 \}/);
  assert.match(flow, /catch \(error\) \{\s*await reportDragState\('assertion-failed'\);\s*throw error;/);
  assert.match(flow, /expect\(targetInsertPoint\).toHaveClass/);
  assert.match(flow, /expect\(finalNodes\).toHaveCount\(2\)/);
  assert.match(flow, /:scope > \.node/);
  assert.equal((flow.match(/await reportDragState\(/g) || []).length, 2);
});
test('negative drag state remains false for missing target, wrong source and clipped gap', () => {
  const container = fixture();
  const query = container.shadowRoot.querySelector;
  container.shadowRoot.querySelector = selector => selector.includes('ons-button1') ? null : query(selector);
  container.ownerDocument.defaultView.dragItemId = 'different synthetic source';
  container.ownerDocument.querySelector = () => null;
  let result = readSiblingDragSnapshot(container, { x: 50, y: 155 });
  assert.equal(result.targetExists, false); assert.equal(result.targetInScrollport, false);
  assert.equal(result.siblingMarkerSelected, false); assert.equal(result.sourceMatched, false);
  assert.equal(result.dragImageActive, false);
  container.shadowRoot.querySelector = selector => selector === '#dom-tree'
    ? { contains: () => true, getBoundingClientRect: () => ({ left: 0, right: 100, top: 160, bottom: 300 }) } : query(selector);
  result = readSiblingDragSnapshot(container, { x: 50, y: 155 });
  assert.equal(result.targetExists, true); assert.equal(result.targetInScrollport, false);
  assert.equal(result.pointerInScrollport, false); assert.notEqual(result.hit, 'target-gap');
});
test('reorder tracks the moving gap and never makes an unchecked final drop move', () => {
  const source = readFileSync(new URL('../tests/specs/normal/editor-ui-basic.spec.ts', import.meta.url), 'utf8');
  const start = source.indexOf("await test.step('2. ドラッグ操作による順序反転");
  const flow = source.slice(start, source.indexOf('// Merged from: tests/specs/normal/editor-html-tag-dialog', start));
  assert.match(flow, /const settledBox = await btnBottom.boundingBox\(\)/);
  assert.match(flow, /const settledPanel = await layoutPanel.boundingBox\(\)/);
  assert.match(flow, /pointStillAtGap && await targetInsertPoint.evaluate/);
  assert.doesNotMatch(flow, /finalDestY|pointerAction\.up\(finalBox/);
  assert.match(flow, /await pointerAction.up\(currentX, currentY\)/);
  assert.match(flow, /await expect\(targetInsertPoint\).toHaveClass/);
  assert.match(flow, /await expect\(finalNodes.nth\(0\)\).toHaveAttribute\('data-node-dom-id', 'ons-button1'\)/);
});

test('native scroll edge avoids overlay hits and exceeds the start threshold', () => {
  const node = {};
  const tree = { getBoundingClientRect: () => ({left:10,right:110,width:100,top:20,bottom:120}), contains: el => el === node };
  const container = {ownerDocument:{defaultView:{innerWidth:200,innerHeight:200}},shadowRoot:{querySelector:()=>tree,elementFromPoint:(x,y)=> x > 60 ? {} : node}};
  const point = findNativeScrollEdge(container,{sourceX:50,sourceY:110,down:true});
  assert.equal(point.x,20);
  assert.ok(point.y > 90 && point.y < 120);
  assert.ok(Math.abs(point.x - 50) > 10);
  container.shadowRoot.elementFromPoint = () => ({});
  assert.equal(findNativeScrollEdge(container,{sourceX:50,sourceY:110,down:true}),null);
  assert.equal(findNativeScrollEdge(null,{sourceX:50,sourceY:110,down:true}),null);
});

test('scroll edge and overlay diagnostics remain bounded independent booleans', () => {
  assert.equal(readSiblingDragSnapshot(fixture(), { x: 50, y: 280 }).pointerAtScrollEdge, true);
  const covered = readSiblingDragSnapshot(fixture('toolbar'), { x: 50, y: 280 });
  assert.equal(covered.pointerAtScrollEdge, true);
  assert.equal(covered.hitWithinTree, false);
  assert.equal(readSiblingDragSnapshot(fixture(), { x: 50, y: 310 }).pointerAtScrollEdge, false);
});
