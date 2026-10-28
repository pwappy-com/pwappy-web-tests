// Register the actual spec with a non-executing DSL double; no browser or service access.
// This proves modifier scope/eligibility and exact body preservation, not real-runner timing.
import { test as contract } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const cases = [], modifiers = [], hooks = [];
let current = { parent: null, modifiers: [] }, editorFixtures;
function declaredTest(title, body) {
    assert.equal(typeof title, 'string'); assert.equal(typeof body, 'function');
    const inherited = [];
    for (let scope = current; scope; scope = scope.parent) inherited.unshift(...scope.modifiers);
    cases.push({ title, body, modifiers: inherited });
}
declaredTest.extend = fixtures => { editorFixtures = fixtures; return declaredTest; };
declaredTest.describe = (...args) => {
    const previous = current;
    current = { parent: previous, modifiers: [] };
    try { args.at(-1)(); } finally { current = previous; }
};
declaredTest.skip = (predicate, reason) => {
    assert.equal(typeof predicate, 'function', 'only declaration-scope modifiers execute during registration');
    const modifier = { predicate, reason };
    current.modifiers.push(modifier); modifiers.push(modifier);
};
for (const kind of ['beforeAll', 'afterAll', 'beforeEach']) {
    declaredTest[kind] = body => { hooks.push({ kind, body }); };
}
globalThis.__platformSkipRegistration = declaredTest;
registerHooks({ resolve(specifier, context, nextResolve) {
    const source = specifier === '@playwright/test'
        ? 'export const test=globalThis.__platformSkipRegistration;export function expect(){throw Error("Test bodies must not execute");}export class Page{};export class Locator{};export class CDPSession{};export class Dialog{};'
        : specifier === 'dotenv/config' ? 'export {};'
        : specifier === '../../tools/dashboard-helpers'
            ? 'const blocked=()=>{throw Error("Dashboard/network operations must not execute");};export const createApp=blocked,deleteApp=blocked,gotoDashboard=blocked,openEditor=blocked,addVersion=blocked;'
        : specifier === '../../tools/editor-helpers'
            ? 'export class EditorHelper{};export const normalizeWhitespace=value=>value;'
        : specifier === '../../constants'
            ? 'export function getStorageStatePath(){throw Error("Authentication files must not be accessed");}'
        : null;
    return source === null ? nextResolve(specifier, context)
        : { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(source) };
} });
await import('../tests/specs/normal/editor-ui-properties-2.spec.ts');
const expectedDesktopTitles = [
    '属性(style-shadow)での不透明度ドラッグバッジによる微調整とShift加速の検証',
    '属性(style-typography)でのマウスドラッグによる数値増減とクランプ処理の検証',
    '属性(style-typography)での小数ステップ（行高）と負の値許容（文字間隔）のドラッグ検証',
    '属性(style-typography)でのShiftキー併用加速とデッドゾーン誤検知防止の検証'
];
const standardReason = 'マウスドラッグ操作はデスクトップ環境専用のためスキップします。';
const shiftReason = 'マウスドラッグ操作・Shiftキー操作はデスクトップ環境専用のためスキップします。';

contract('only four already-desktop-only cases inherit early platform modifiers', () => {
    assert.equal(cases.length, 26, 'all original test declarations remain');
    assert.equal(modifiers.length, 4);
    const restricted = cases.filter(item => item.modifiers.length);
    assert.deepEqual(restricted.map(item => item.title), expectedDesktopTitles);
    for (const [index, item] of restricted.entries()) {
        assert.equal(item.modifiers.length, 1);
        const { predicate, reason } = item.modifiers[0];
        assert.equal(reason, index === 3 ? shiftReason : standardReason);
        assert.equal(predicate({ isMobile: true }), true);
        assert.equal(predicate({ isMobile: false }), false);
        // No page/context/editor dependency can force heavy fixture setup for this modifier.
        assert.match(predicate.toString(), /^\(\{ isMobile \}\) => isMobile$/);
        assert.doesNotMatch(item.body.toString(), /test\.skip\(isMobile,/);
    }
    assert.ok(editorFixtures.editorPage.toString().includes('await gotoDashboard(page)'));
    assert.ok(hooks.some(hook => hook.kind === 'beforeAll'));
    assert.ok(hooks.some(hook => hook.kind === 'afterAll'));
});
contract('mobile-only touch case remains outside desktop skips with its original condition', () => {
    const item = cases.find(item => item.title === '属性(style-typography)でのタッチイベントによるドラッグ検証（モバイル環境用）');
    assert.ok(item); assert.deepEqual(item.modifiers, []);
    assert.match(item.body.toString(), /test\.skip\(!isMobile, 'This test is exclusive to mobile browser environments\.'\)/);
});
contract('undoing only the four skip moves restores the exact reviewed original spec', () => {
    const source = readFileSync(new URL('../tests/specs/normal/editor-ui-properties-2.spec.ts', import.meta.url), 'utf8');
    let restoredCount = 0;
    const restored = source.replace(
        /^    test\.describe\(\(\) => \{\n        \/\/ Apply the existing platform restriction before editorPage setup\.\n        test\.skip\(\(\{ isMobile \}\) => isMobile, ('[^']+')\);\n([\s\S]*?)^    \}\);/gm,
        (_wrapper, reason, indentedBody) => {
            restoredCount++;
            const body = indentedBody.replace(/^    /gm, '').replace(/\n$/, '');
            const lines = body.split('\n');
            const index = lines[1]?.includes('// モバイル環境（MouseEventが動作しない環境）ではスキップ') ? 2 : 1;
            lines.splice(index, 0, '        test.skip(isMobile, ' + reason + ');');
            return lines.join('\n');
        }
    );
    assert.equal(restoredCount, 4);
    assert.equal(createHash('sha256').update(restored).digest('hex'),
        '56367a59ecb9d419dc0e3430cb7d8fbcbe724715d0df02ee0523f5f06c1baa3a');
});
