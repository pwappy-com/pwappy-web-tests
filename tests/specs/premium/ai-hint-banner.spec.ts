import { test, expect } from '@playwright/test';
import 'dotenv/config';
import { setAiCoding, navigateToTab } from '../../tools/dashboard-helpers';

/**
 * AIヒントバナーの挙動に関するテスト
 * localStorage の管理を含む一連のライフサイクルを検証します。
 */
test.describe('AIヒントバナーの検証', () => {

    test.beforeEach(async ({ page, context }) => {
        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        const domain = testUrl.hostname;

        // 認証Cookieの設定
        await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/' },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/' },
            { name: 'pwappy_login', value: '1', domain: domain, path: '/' },
        ]);

        // 1. テストの前提条件として、アカウントのAI機能を「無効」に設定する
        await page.goto(String(process.env.PWAPPY_TEST_BASE_URL));
        await expect(page.getByRole('heading', { name: 'アプリケーション一覧' })).toBeVisible();
        await setAiCoding(page, false);

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
        await closeButton.click();
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
        await enableButton.click();

        // 2. 確認モーダルの「表示」を内部のスロット要素で判定する
        const modal = page.locator('dashboard-modal-window#aiEnableHintModal');
        const modalTitle = modal.locator('span[slot="header-title"]');

        // アニメーション完了を含めて待機
        await expect(modalTitle).toBeVisible({ timeout: 10000 });
        await expect(modal).toContainText('あなたは18歳以上ですか？');

        // 3. 「はい」をクリック
        await modal.locator('span[slot="submit-button-text"]').click();

        // 4. モーダルとバナーが消えるのを待つ
        await expect(modalTitle).toBeHidden();
        await expect(banner).toBeHidden();

        // 5. 設定画面で有効になっているか確認
        await page.locator('button.menu-button[title="メニュー"]').click();
        await page.locator('#appMenuList .dashboard-menu-item', { hasText: '設定' }).click();

        const checkbox = page.locator('#aiCodingCheckbox');
        await expect(checkbox).toBeChecked();
    });

    test('AI機能が既に有効な場合、バナーは表示されない', async ({ page }) => {
        // 1. AI機能を有効に設定
        await setAiCoding(page, true);

        // 2. localStorage をクリアしても表示されないことを確認
        await page.evaluate(() => localStorage.removeItem('pwappy_ai_hint_closed'));
        await page.reload({ waitUntil: 'domcontentloaded' });

        await expect(page.locator('.ai-hint-banner')).toBeHidden();

        // クリーンアップ: 他のテストのために無効に戻す
        await setAiCoding(page, false);
    });
});