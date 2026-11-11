import { test, expect, type Page } from '@playwright/test';
import { EditorHelper } from '../../tools/editor-helpers';
import {
    applyCouponAndExpectDuplicate, COUPON_ALREADY_USED_MESSAGE,
    expectIconOutputSuccess, saveEditorAndExpectSuccess,
} from '../../tools/success-assertions';

// Deliberately tiny synthetic UI. No application bundle, backend, .env or saved
// account is needed to prove that the shared E2E assertions reject false success.
const pageHtml = `<!doctype html><meta charset="utf-8"><html><body>
<button id="fab-bottom-menu-box" onclick="document.querySelector('#platformBottomMenu').hidden = false">Menu</button>
<div id="platformBottomMenu" hidden><button id="save">保存</button><a id="qrcode" href="/success-preview" target="_blank">Preview</a></div>
<app-container-loading-overlay hidden><span>処理中</span></app-container-loading-overlay>
<alert-component hidden></alert-component>
<app-container></app-container>
<button id="coupon">Coupon</button>
<script>
document.querySelector('app-container')._webMcpSaveStatus = {status:'idle',serverSaved:false,serverVerified:false};
document.querySelector('#save').onclick = async () => {
 const loading = document.querySelector('app-container-loading-overlay'); loading.hidden = false;
 await fetch('/rest/v1/editor-json', {method:'PUT', body:JSON.stringify({appKey:'fixture',version:'1.0',editorJson:{}})});
 if (window.saveAlert) { const alert = document.querySelector('alert-component'); alert.textContent = window.saveAlert; alert.hidden = false; }
 if (!window.legacyEditor) document.querySelector('app-container')._webMcpSaveStatus = window.saveReadback || {status:'saved',serverSaved:true,serverVerified:true};
 loading.hidden = true;
};
document.querySelector('#coupon').onclick = async () => {
 const response = await fetch('/rest/v1/pwappy-coupons', {method:'PUT', body:JSON.stringify({couponCode:'SYNTHETIC_COUPON'})});
 const body = await response.json().catch(() => ({message:'通信応答が不正です'}));
 const alert = document.querySelector('alert-component'); alert.textContent = body.message; alert.hidden = false;
};
</script></body></html>`;

test.beforeEach(async ({ context, page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === origin && request.method() === 'GET' && ['/success-fixture', '/success-preview'].includes(url.pathname)) {
            return route.fulfill({ contentType: 'text/html', body: pageHtml });
        }
        return route.abort('blockedbyclient');
    });
    await page.goto('/success-fixture?appKey=fixture&version=1.0');
});

const saveResponse = (page: Page, status = 200, body: unknown = { status: 'success', code: 200 }) =>
    page.route('**/rest/v1/editor-json', route => route.fulfill({ status, contentType: 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body) }));

test('success assertions: save helper opens preview only after confirmed save', async ({ page, context }) => {
    await saveResponse(page);
    const preview = await new EditorHelper(page, false).saveAndOpenTestPage();
    await expect(preview).toHaveURL(/\/success-preview$/);
    expect(context.pages()).toHaveLength(2);
});

for (const scenario of [
    { name: 'HTTP failure with a misleading successful body', error: 'Editor save HTTP status', http: 503, body: { status: 'success', code: 200 } },
    { name: 'application failure with HTTP 200', error: 'Editor save application code', http: 200, body: { status: 'error', code: 400 } },
    { name: 'wrong status with successful code', error: 'Editor save application status', http: 200, body: { status: 'denied', code: 200 } },
    { name: 'missing success code', error: 'Editor save application code', http: 200, body: { status: 'success' } },
    { name: 'malformed JSON', error: 'not valid JSON', http: 200, body: '<html>Sign in required</html>' },
    { name: 'null JSON', error: 'not a JSON object', http: 200, body: null },
]) {
    test(`success assertions: save rejects ${scenario.name}`, async ({ page, context }) => {
        await saveResponse(page, scenario.http, scenario.body);
        await expect(new EditorHelper(page, false).saveAndOpenTestPage()).rejects.toThrow(scenario.error);
        expect(context.pages()).toHaveLength(1);
    });
}

test('success assertions: missing save response times out instead of succeeding', async ({ page }) => {
    await expect(saveEditorAndExpectSuccess(page, async () => {}, 200)).rejects.toThrow(/Timeout/);
});

test('success assertions: unrelated endpoint method or app save cannot satisfy the waiter', async ({ page }) => {
    for (const scenario of [
        { path: '/rest/v1/editor-not-save', method: 'PUT', appKey: 'fixture', version: '1.0' },
        { path: '/rest/v1/editor-json', method: 'POST', appKey: 'fixture', version: '1.0' },
        { path: '/rest/v1/editor-json', method: 'PUT', appKey: 'another-app', version: '1.0' },
        { path: '/rest/v1/editor-json', method: 'PUT', appKey: 'fixture', version: '2.0' },
    ]) {
        await page.route(`**${scenario.path}`, route => route.fulfill({ json: { status: 'success', code: 200 } }));
        await expect(saveEditorAndExpectSuccess(page, () => page.evaluate(async scenario => {
            await fetch(scenario.path, { method: scenario.method, body: JSON.stringify({ appKey: scenario.appKey, version: scenario.version, editorJson: {} }) });
        }, scenario), 300)).rejects.toThrow(/Timeout/);
    }
});

test('success assertions: save denial alert without error keywords never opens preview', async ({ page, context }) => {
    await saveResponse(page);
    await page.evaluate(() => { (window as any).saveAlert = 'デモモードでは書き込みは制限されています'; });
    await expect(new EditorHelper(page, false).saveAndOpenTestPage()).rejects.toThrow(/アプリ保存未確認/);
    expect(context.pages()).toHaveLength(1);
});

test('success assertions: exact icon output count succeeds', async ({ page }) => {
    await page.locator('alert-component').evaluate(el => { el.removeAttribute('hidden'); el.textContent = '検出されたアプリアイコン（計 3 件）をすべて出力しました。'; });
    await expectIconOutputSuccess(page.locator('alert-component'), 3, 200);
});

for (const message of [
    'デモモードでは、画像のアップロードやトリミング結果の保存は制限されています。',
    'アップロードに失敗しました: アクセスが拒否されました。',
    '検出されたアプリアイコン（計 2 件）をすべて出力しました。',
    '通信を完了しました。',
]) {
    test(`success assertions: icon output rejects ${message}`, async ({ page }) => {
        await page.locator('alert-component').evaluate((el, message) => { el.removeAttribute('hidden'); el.textContent = message; }, message);
        await expect(expectIconOutputSuccess(page.locator('alert-component'), 3, 150)).rejects.toThrow();
    });
}

for (const http of [400, 409]) {
    test(`success assertions: coupon duplicate has explicit PHP contract (${http})`, async ({ page }) => {
        await page.route('**/rest/v1/pwappy-coupons', route => route.fulfill({ status: http, json: { status: 'coupon_already_used', code: http, message: COUPON_ALREADY_USED_MESSAGE } }));
        await applyCouponAndExpectDuplicate(page, 'SYNTHETIC_COUPON', () => page.locator('#coupon').click(), 1000);
    });
}

for (const scenario of [
    { name: 'invalid coupon', error: 'Duplicate coupon reason', http: 400, code: 400, status: 'coupon_invalid', message: 'このクーポンは使用できません。' },
    { name: 'lockout', error: 'Duplicate coupon HTTP status', http: 429, code: 429, status: 'coupon_attempts_blocked', message: 'クーポン入力の失敗回数が上限に達しました' },
    { name: 'server error', error: 'Duplicate coupon HTTP status', http: 500, code: 500, status: 'internal_server_error', message: '予期せぬエラーが発生しました。' },
    { name: 'authentication error', error: 'Duplicate coupon HTTP status', http: 401, code: 401, status: 'auth_required', message: 'ログインが必要です。' },
    { name: 'unexpected second success', error: 'Duplicate coupon HTTP status', http: 200, code: 200, status: 'coupon_apply_success', message: 'クーポンが適用されました！100ポイント獲得しました。' },
    { name: 'misleading duplicate message', error: 'Duplicate coupon reason', http: 400, code: 400, status: 'coupon_invalid', message: COUPON_ALREADY_USED_MESSAGE },
    { name: 'inconsistent application code', error: 'Duplicate coupon application code', http: 400, code: 200, status: 'coupon_already_used', message: COUPON_ALREADY_USED_MESSAGE },
]) {
    test(`success assertions: coupon duplicate rejects ${scenario.name}`, async ({ page }) => {
        await page.route('**/rest/v1/pwappy-coupons', route => route.fulfill({ status: scenario.http, json: { status: scenario.status, code: scenario.code, message: scenario.message } }));
        await expect(applyCouponAndExpectDuplicate(page, 'SYNTHETIC_COUPON', () => page.locator('#coupon').click(), 1000)).rejects.toThrow(scenario.error);
    });
}

test('success assertions: missing editor target fails before a save is attempted', async ({ page }) => {
    await page.goto('/success-fixture');
    let triggered = false;
    await expect(saveEditorAndExpectSuccess(page, async () => { triggered = true; }, 200)).rejects.toThrow(/appKey\/version is missing/);
    expect(triggered).toBe(false);
});

for (const result of [
    { status: 'failed', serverSaved: true, serverVerified: false },
    { status: 'saved', serverSaved: true, serverVerified: false },
    { status: 'saving', serverSaved: true, serverVerified: false },
]) {
    test(`success assertions: PUT success cannot hide readback ${result.status}/${result.serverVerified}`, async ({ page, context }) => {
        await saveResponse(page);
        await page.evaluate(result => { (window as any).saveReadback = result; }, result);
        await expect(new EditorHelper(page, false).saveAndOpenTestPage()).rejects.toThrow(/readback verification/);
        await expect(page.locator('alert-component')).toBeHidden();
        expect(context.pages()).toHaveLength(1);
    });
}

test('success assertions: legacy editor explicitly reports API-only verification', async ({ page }, info) => {
    await saveResponse(page);
    await page.evaluate(() => {
        (window as any).legacyEditor = true;
        delete (document.querySelector('app-container') as any)._webMcpSaveStatus;
    });
    const preview = await new EditorHelper(page, false).saveAndOpenTestPage();
    await expect(preview).toHaveURL(/\/success-preview$/);
    expect(info.annotations).toContainEqual({ type: 'save-verification',
        description: 'Server readback status is unsupported by this editor; only the save API response was verified.' });
});
