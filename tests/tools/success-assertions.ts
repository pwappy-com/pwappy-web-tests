import { expect, type Locator, type Page, type Response } from '@playwright/test';

// Contracts verified against EditorJsonPutUseCase and ApplyCouponUseCase, not
// inferred from the absence of an error dialog. This module never loads auth/env.
async function responseJson(response: Response, operation: string): Promise<Record<string, unknown>> {
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        throw new Error(`${operation}: response was not valid JSON`);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error(`${operation}: response was not a JSON object`);
    }
    return body as Record<string, unknown>;
}

export async function expectEditorSaveResponse(response: Response): Promise<void> {
    expect(response.status(), 'Editor save HTTP status').toBe(200);
    const body = await responseJson(response, 'Editor save');
    expect(body.code, 'Editor save application code').toBe(200);
    expect(body.status, 'Editor save application status').toBe('success');
}

/** Observe the current app/version's actual save before clicking, and fail on timeout. */
export async function saveEditorAndExpectSuccess(
    page: Page, trigger: () => Promise<unknown>, timeout = 30000
): Promise<void> {
    const current = new URL(page.url());
    const appKey = current.searchParams.get('appKey');
    const version = current.searchParams.get('version');
    if (!appKey || !version) throw new Error('Editor save: current appKey/version is missing');
    const [response] = await Promise.all([
        page.waitForResponse(response => {
            const request = response.request();
            if (request.method() !== 'PUT' || !/\/editor-json\/?$/.test(new URL(response.url()).pathname)) return false;
            try {
                const body = request.postDataJSON();
                return body?.appKey === appKey && body?.version === version &&
                    !!body.editorJson && typeof body.editorJson === 'object' && !Array.isArray(body.editorJson);
            } catch { return false; }
        }, { timeout }),
        trigger(),
    ]);
    await expectEditorSaveResponse(response);
}

/** Current editor hosts expose their completed PUT + readback verification result. */
export async function expectEditorReadbackStatus(page: Page): Promise<'verified' | 'unsupported'> {
    const host = page.locator('app-container');
    if (await host.count() === 0) return 'unsupported';
    const result = await host.evaluate((element: any) => ({
        supported: '_webMcpSaveStatus' in element || typeof element._performEditorJsonSave === 'function',
        status: element._webMcpSaveStatus?.status,
        serverSaved: element._webMcpSaveStatus?.serverSaved,
        serverVerified: element._webMcpSaveStatus?.serverVerified,
    }));
    if (!result.supported) return 'unsupported';
    expect(result, 'Editor save must finish its server readback verification').toMatchObject({
        status: 'saved', serverSaved: true, serverVerified: true,
    });
    return 'verified';
}

export async function expectIconOutputSuccess(alert: Locator, count: number, timeout = 20000): Promise<void> {
    expect(Number.isInteger(count) && count > 0, 'Expected icon output count').toBe(true);
    await expect(alert).toBeVisible({ timeout });
    await expect(alert).toContainText(`検出されたアプリアイコン（計 ${count} 件）をすべて出力しました。`, { timeout });
    await expect(alert).not.toContainText(/制限されています|デモモード|失敗/, { timeout });
}

export const COUPON_ALREADY_USED_MESSAGE = 'このクーポンは既に使用済みです。';

export async function expectCouponDuplicateResponse(response: Response): Promise<void> {
    // PHP returns 400 for an existing use, or 409 for a concurrent duplicate insert.
    expect([400, 409], 'Duplicate coupon HTTP status').toContain(response.status());
    const body = await responseJson(response, 'Duplicate coupon');
    expect(body.code, 'Duplicate coupon application code').toBe(response.status());
    expect(body.status, 'Duplicate coupon reason').toBe('coupon_already_used');
    expect(body.message, 'Duplicate coupon message').toBe(COUPON_ALREADY_USED_MESSAGE);
}

export async function applyCouponAndExpectDuplicate(
    page: Page, couponCode: string, trigger: () => Promise<unknown>, timeout = 30000
): Promise<void> {
    const [response] = await Promise.all([
        page.waitForResponse(response => {
            const request = response.request();
            if (request.method() !== 'PUT' || !/\/pwappy-coupons\/?$/.test(new URL(response.url()).pathname)) return false;
            try { return request.postDataJSON()?.couponCode === couponCode; } catch { return false; }
        }, { timeout }),
        trigger(),
    ]);
    await expectCouponDuplicateResponse(response);
    const alert = page.locator('alert-component');
    await expect(alert).toBeVisible({ timeout });
    await expect(alert).toContainText(COUPON_ALREADY_USED_MESSAGE, { timeout });
    await expect(alert).not.toContainText(/クーポンが適用されました|ポイント獲得しました/, { timeout });
}
