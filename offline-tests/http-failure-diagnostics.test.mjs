import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = readFileSync(new URL('../tests/tools/http-failure-diagnostics.ts', import.meta.url), 'utf8');
const { configuredOrigins, retryAfterKind, classifyHttpFailure, observeHttpFailures, observePageHttpFailures, HTTP_FAILURE_RECORD_LIMIT } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const env = { PWAPPY_TEST_BASE_URL: 'https://stage.invalid/dashboard?secret=config', PWAPPY_TEST_LOGIN_ENDPOINT: 'https://login.invalid/wp-json/login' };
const origins = configuredOrigins(env);
function response(options = {}) {
    const { status = 503, url = 'https://stage.invalid/pwappy-api/read/v1/editor-json/private-user?token=SECRET', method = 'GET', resource = 'xhr', headers = {} } = options;
    return { status: () => status, url: () => url, request: () => ({ method: () => method, resourceType: () => resource }), headers: () => headers,
        body() { throw Error('body must never be fetched'); }, text() { throw Error('text must never be fetched'); }, allHeaders() { throw Error('headers must not be fetched'); } };
}
test('exact configured origins only, invalid/absent config fails closed', () => {
    assert.deepEqual([...origins], ['https://stage.invalid', 'https://login.invalid']);
    assert.equal(configuredOrigins({ PWAPPY_TEST_BASE_URL: 'javascript:alert(1)', PWAPPY_TEST_LOGIN_ENDPOINT: '/relative' }).size, 0);
    for (const url of ['https://stage.invalid.evil.test/a','https://thirdparty.invalid/a','http://stage.invalid/a','https://stage.invalid:8443/a']) assert.equal(classifyHttpFailure(response({ url }), origins), null);
    assert.equal(classifyHttpFailure(response({ url: 'https://login.invalid/a' }), origins).status, 503);
});
test('privacy allowlist discards credentials, query, identifiers, server versions and every raw header', () => {
    const record = classifyHttpFailure(response({ headers: { server: 'nginx/SECRET', 'retry-after': '600', 'content-type': 'application/json; SECRET', cookie: 'SECRET', 'set-cookie': 'SECRET', via: 'SECRET', 'x-request-id': 'SECRET' } }), origins);
    assert.deepEqual(record, { status: 503, method: 'GET', resource: 'xhr', pathKind: 'editor-json', serverFamily: 'nginx', retryAfter: { kind: 'seconds', seconds: 600, capped: false }, contentType: 'json' });
    assert.doesNotMatch(JSON.stringify(record), /SECRET|private-user|stage.invalid|token|cookie|nginx\//);
});
test('only 5xx, early filter does not inspect headers/request', () => {
    for (const status of [200, 401, 429, 499, 600, 503.5, NaN]) assert.equal(classifyHttpFailure({ status: () => status }, origins), null);
    assert.equal(classifyHttpFailure({ status: () => 503, url: () => 'https://thirdparty.invalid' }, origins), null);
});
test('unknown metadata cannot leak arbitrary strings; no cause inferred from 503/507', () => {
    for (const status of [500, 503, 507, 599]) {
        const record = classifyHttpFailure(response({ status, method: 'SECRET', resource: 'SECRET', url: 'https://stage.invalid/SECRET', headers: { server: 'SECRET', 'content-type': 'SECRET', 'retry-after': 'SECRET' } }), origins);
        assert.equal(record.serverFamily, 'unknown'); assert.equal(record.contentType, 'other'); assert.equal(record.pathKind, 'other');
        assert.doesNotMatch(JSON.stringify(record), /SECRET|maintenance|capacity/);
    }
});
test('Retry-After bounded seconds or validated date classification only', () => {
    assert.deepEqual(retryAfterKind(undefined), { kind: 'absent' });
    assert.deepEqual(retryAfterKind('0'), { kind: 'seconds', seconds: 0, capped: false });
    assert.deepEqual(retryAfterKind('999999999'), { kind: 'seconds', seconds: 86400, capped: true });
    assert.deepEqual(retryAfterKind('Wed, 21 Oct 2015 07:28:00 GMT'), { kind: 'date' });
    for (const value of ['', '-1', '1.2', 'Infinity', '9999999999', '2026-10-27', 'Wed, 99 Oct 2015 07:28:00 GMT', 'Thu, 21 Oct 2015 07:28:00 GMT']) assert.deepEqual(retryAfterKind(value), { kind: 'invalid' });
});
test('one passive context listener covers existing and future pages without patching browser APIs', () => {
    const context = new EventEmitter(); const lines = [];
    context.route = context.newPage = context.pages = () => { throw Error('no active operation'); };
    const before = Object.keys(context); observeHttpFailures(context, env, line => lines.push(line)); observeHttpFailures(context, env, () => { throw Error('duplicate'); });
    assert.deepEqual(Object.keys(context), before);
    assert.equal(context.listenerCount('response'), 1);
    context.emit('response', response()); context.emit('response', response({ resource: 'document' }));
    assert.equal(lines.length, 2); context.emit('close'); assert.equal(context.listenerCount('response'), 0); assert.equal(context.listenerCount('close'), 0);
});
test('per-context cap remains after repeated installs and cleanup', () => {
    const context = new EventEmitter(), lines = []; observeHttpFailures(context, env, line => lines.push(line));
    for(let i=0;i<100;i++) context.emit('response', response());
    assert.equal(lines.length, HTTP_FAILURE_RECORD_LIMIT); assert.equal(context.listenerCount('response'), 0); assert.equal(context.listenerCount('close'), 0);
    observeHttpFailures(context, env, line => lines.push(line)); context.emit('response', response()); assert.equal(lines.length, HTTP_FAILURE_RECORD_LIMIT);
});
test('malformed metadata and output errors cannot fail behavior; cap counts output failures', () => {
    const context = new EventEmitter(); observeHttpFailures(context, env, () => { throw Error('sink failure'); });
    assert.doesNotThrow(() => context.emit('response', response({ url: 'not URL' })));
    assert.doesNotThrow(() => context.emit('response', { status() { throw Error('closed'); } }));
    for (let i=0;i<HTTP_FAILURE_RECORD_LIMIT;i++) assert.doesNotThrow(() => context.emit('response', response()));
    assert.equal(context.listenerCount('response'), 0);
});
test('partial install failure cleans up and no env adds no listeners', () => {
    const context = new EventEmitter(); const on = context.on;
    context.on = function (event, fn) { if (event === 'response') throw Error('closed'); return on.call(this,event,fn); };
    assert.doesNotThrow(() => observeHttpFailures(context, env)); assert.equal(context.listenerCount('close'),0);
    const empty = new EventEmitter(); observeHttpFailures(empty, {}); assert.equal(empty.eventNames().length,0);
});
test('common entry points install observation before dashboard navigation/editor opening', () => {
    const dashboard = readFileSync(new URL('../tests/tools/dashboard-helpers.ts', import.meta.url),'utf8');
    const editor = readFileSync(new URL('../tests/tools/editor-helpers.ts', import.meta.url),'utf8');
    assert.match(dashboard,/export async function gotoDashboard\(page: Page\): Promise<void> \{\s*observePageHttpFailures\(page\);/);
    assert.match(dashboard,/\): Promise<Page> \{\s*observeHttpFailures\(context\);\s*const versionRow/);
    assert.match(editor,/constructor\(page: Page, isMobile: boolean\) \{\s*observePageHttpFailures\(page\);/);
});

test('page context lookup failures cannot replace original test behavior', () => { assert.doesNotThrow(() => observePageHttpFailures({ context() { throw Error('closed'); } })); });

test('Retry-After cap is self-describing at the exact boundary', () => {
    assert.deepEqual(retryAfterKind('86400'), { kind: 'seconds', seconds: 86400, capped: false });
    assert.deepEqual(retryAfterKind('86401'), { kind: 'seconds', seconds: 86400, capped: true });
});
test('verified read/rest API route families classify without leaking IDs', () => {
    for (const family of ['read', 'rest']) for (const pathKind of ['editor-json', 'publish-list']) {
        const record = classifyHttpFailure(response({ method: family === 'read' ? 'GET' : 'PUT', url: `https://stage.invalid/pwappy-api/${family}/v1/${pathKind}/SECRET?user=SECRET` }), origins);
        assert.equal(record.pathKind, pathKind); assert.doesNotMatch(JSON.stringify(record), /SECRET/);
    }
    assert.equal(classifyHttpFailure(response({ url: 'https://stage.invalid/pwappy-api/write/v1/editor-json' }), origins).pathKind, 'pwappy-api');
});
