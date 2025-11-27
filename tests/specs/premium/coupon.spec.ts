import { test, expect } from '@playwright/test';
import 'dotenv/config';

test.describe('クーポン機能 E2Eシナリオ', () => {

    // 各テストの実行前に認証とダッシュボードへのアクセスを行います。
    test.beforeEach(async ({ page, context }) => {
        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        const domain = testUrl.hostname;
        await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/' },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/' },
            { name: 'pwappy_login', value: '1', domain: domain, path: '/' },
        ]);
        await page.goto(String(process.env.PWAPPY_TEST_BASE_URL), { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: 'アプリケーション一覧' })).toBeVisible();
    });

    test('TEST_DAILY_COUPONの適用と重複利用の防止', async ({ page }) => {
        // ポイント表示コンポーネントを取得
        const dashboardPoint = page.locator('dashboard-point');
        const couponButton = dashboardPoint.getByTitle('クーポン入力');
        
        // クーポンダイアログ内の要素
        const dialog = dashboardPoint.locator('#coupon-input-dialog');
        const input = dashboardPoint.locator('#coupon-code-input');
        const applyButton = dashboardPoint.locator('.confirm-ok-button'); // 適用ボタン
        const alert = page.locator('alert-component');

        await test.step('1. クーポンコードを入力して適用する', async () => {
            await couponButton.click();
            await expect(dialog).toBeVisible();
            
            await input.fill('TEST_DAILY_COUPON');
            await applyButton.click();

            // 成功アラートの検証
            await expect(alert).toBeVisible();
            await expect(alert).toContainText('クーポンが適用されました');
            await expect(alert).toContainText('100ポイント獲得しました');
            
            // アラートを閉じる
            await alert.getByRole('button', { name: '閉じる' }).click();
            await expect(alert).toBeHidden();
        });

        await test.step('2. 同じクーポンコードを再度入力してポイントが加算されないことを確認する', async () => {
            await couponButton.click();
            await expect(dialog).toBeVisible();

            await input.fill('TEST_DAILY_COUPON');
            await applyButton.click();

            // 失敗（重複）アラートの検証
            // バックエンドの実装によりますが、成功メッセージが出ないことを確認するか、
            // 具体的なエラーメッセージ（例：「既に使用されています」など）を確認します。
            // ここでは汎用的なエラーまたは成功ではないことを確認します。
            await expect(alert).toBeVisible();
            await expect(alert).not.toContainText('100ポイント獲得しました');
            
            // アラートを閉じる
            await alert.getByRole('button', { name: '閉じる' }).click();
        });
    });

    test('クーポン入力失敗回数上限(5回)のロックアウト確認', async ({ page }) => {
        const dashboardPoint = page.locator('dashboard-point');
        const couponButton = dashboardPoint.getByTitle('クーポン入力');
        const input = dashboardPoint.locator('#coupon-code-input');
        const applyButton = dashboardPoint.locator('.confirm-ok-button');
        const alert = page.locator('alert-component');
        const alertCloseButton = alert.getByRole('button', { name: '閉じる' });

        // 6回連続で間違ったコードを入力する
        const maxAttempts = 6;
        const lockOutMessage = 'クーポン入力の失敗回数が上限に達しました';
        const waitMessage = 'しばらく時間を置いてから再試行してください';

        for (let i = 1; i <= maxAttempts; i++) {
            await test.step(`${i}回目の無効なコード入力`, async () => {
                // ダイアログを開く（前のループで閉じていない場合は開いたまま）
                //if (!await input.isVisible()) {
                    await couponButton.click();
                //}
                
                await input.fill(`INVALID_CODE_${Date.now()}_${i}`);
                await applyButton.click();

                await expect(alert).toBeVisible();

                if (i === maxAttempts) {
                    // 6回目でロックアウトメッセージが出ることを確認
                    await expect(alert).toContainText(lockOutMessage);
                    await expect(alert).toContainText(waitMessage);
                } else {
                    // それまでは通常のエラーメッセージ
                    // ※すでにロックアウトされている場合はここで失敗する可能性がありますが、
                    //   テスト前提としてロックされていない状態から開始すると仮定します。
                    await expect(alert).toContainText('このクーポンは使用できません。');
                }

                // アラートを閉じる
                await alertCloseButton.click();
                await expect(alert).toBeHidden();
            });
        }
    });

});