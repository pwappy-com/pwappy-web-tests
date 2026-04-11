import { test, expect } from '@playwright/test';
import 'dotenv/config';
import { setAiCoding, navigateToSettings } from '../../tools/dashboard-helpers';

/**
 * AIヒントバナーの挙動に関するテスト
 * localStorage の管理を含む一連のライフサイクルを検証します。
 */
test.describe('AIヒントバナーの検証', () => {

    test.beforeEach(async ({ page, context }) => {
        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        var domain: string = testUrl.hostname;
        if (domain !== 'localhost') {
            domain = '.' + domain;
        }
        // 先にクッキーを削除
      await context.clearCookies();
      await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 },
            { name: 'pwappy_login', value: process.env.PWAPPY_LOGIN!, domain: domain, path: '/', secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 },
        ]);

        // 1. テストの前提条件として、アカウントのAI機能を「無効」に設定する
        await page.goto(String(process.env.PWAPPY_TEST_BASE_URL));
        await expect(page.getByRole('heading', { name: 'アプリケーション一覧' })).toBeVisible();

        try {
            await setAiCoding(page, false);
        } catch (e) {
            console.warn('[Warning] setAiCoding failed/timed out, continuing test...', e);
        }

        // 2. localStorageをクリアしてヒントが表示される状態にする
        await page.evaluate(() => {
            localStorage.removeItem('pwappy_ai_hint_closed');
        });

        // 状態を確実に反映させるためにリロード
        await page.reload({ waitUntil: 'domcontentloaded' });
    });

    test('AIが無効かつ未閉鎖の場合、バナーが表示される', async ({ page }) => {
        const banner = page.locator('.ai-hint-banner');
        await expect(banner).toBeVisible();
        await expect(banner).toContainText('AIアシスタントで開発を加速');
    });

    test('バナーの「×」ボタンで閉じると、リロード後も表示されない', async ({ page }) => {
        const banner = page.locator('.ai-hint-banner');
        const closeButton = banner.locator('.ai-hint-close');

        // 1. バナーを閉じる
        await closeButton.click({ force: true });
        await expect(banner).toBeHidden();

        // 2. localStorageにフラグが立っていることを確認
        const isClosed = await page.evaluate(() => localStorage.getItem('pwappy_ai_hint_closed'));
        expect(isClosed).toBe('true');

        // 3. リロードしても再表示されないことを確認
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('.ai-hint-banner')).toBeHidden();
    });

    test('バナーからAI機能を有効化できる', async ({ page }) => {
        const banner = page.locator('.ai-hint-banner');
        const enableButton = banner.locator('.ai-hint-button');

        // 1. 有効化ボタンをクリック
        await enableButton.click({ force: true });

        // 2. 確認モーダルの「表示」を内部のスロット要素で判定する
        const modal = page.locator('dashboard-modal-window#aiEnableHintModal');
        const modalTitle = modal.locator('span[slot="header-title"]');

        // アニメーション完了を含めて待機
        await expect(modalTitle).toBeVisible({ timeout: 10000 });
        await expect(modal).toContainText('あなたは18歳以上ですか？');

        // 3. 「はい」をクリック
        await modal.locator('span[slot="submit-button-text"]').click({ force: true });

        // 4. モーダルとバナーが消えるのを待つ
        await expect(modalTitle).toBeHidden();
        await expect(banner).toBeHidden();

        // 5. 設定画面で有効になっているか確認
        // ベタ書きを廃止し、堅牢なヘルパー関数を使用する
        await navigateToSettings(page);

        const checkbox = page.locator('#aiCodingCheckbox');
        await expect(checkbox).toBeChecked();
    });

    test('AI機能が既に有効な場合、バナーは表示されない', async ({ page }) => {
        // 1. AI機能を有効に設定
        try {
            await setAiCoding(page, true);
        } catch (e) {
            console.warn('[Warning] setAiCoding failed/timed out, continuing test...', e);
        }

        // 2. localStorage をクリアしても表示されないことを確認
        await page.evaluate(() => localStorage.removeItem('pwappy_ai_hint_closed'));
        await page.reload({ waitUntil: 'domcontentloaded' });

        await expect(page.locator('.ai-hint-banner')).toBeHidden();

        // クリーンアップ: 他のテストのために無効に戻す
        try {
            await setAiCoding(page, false);
        } catch (e) {
            console.warn('[Warning] setAiCoding (cleanup) failed/timed out, continuing test...', e);
        }
    });
});