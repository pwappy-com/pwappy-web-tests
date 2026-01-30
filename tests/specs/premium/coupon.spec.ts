import { test, expect } from '@playwright/test';
import 'dotenv/config';

test.describe('クーポン機能 E2Eシナリオ', () => {

    test.skip(({ browserName, isMobile }) => {
        const isLinux = process.platform === 'linux';
        const isChromium = browserName === 'chromium';
        const isDesktop = !isMobile; // isMobileフィクスチャで判定

        // 「Ubuntu かつ Chromium かつ デスクトップ」 以外の場合はスキップ
        return !(isLinux && isChromium && isDesktop);
    }, 'クーポンロック回避のため、Ubuntu PC (Desktop Chromium) 環境以外ではスキップします');

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
        const dashboardPoint = page.locator('dashboard-point');
        await expect(dashboardPoint).toBeVisible();

        // コンポーネントの初期化（イベントリスナー登録）を待つために少し待機
        await page.waitForTimeout(1000);

        const couponButton = dashboardPoint.getByTitle('クーポン入力');
        const dialog = dashboardPoint.locator('#coupon-input-dialog');
        const input = dashboardPoint.locator('#coupon-code-input');
        const applyButton = dashboardPoint.locator('.confirm-ok-button');
        const alert = page.locator('alert-component');

        await test.step('1. クーポンコードを入力して適用する', async () => {
            // ボタンが表示されるまで待つ
            await expect(couponButton).toBeVisible();
            await expect(couponButton).toBeEnabled();

            // クリックしてもダイアログが出ない場合のリトライロジック
            // 「入力欄が表示される」という状態になるまで、クリックを試行する
            await expect(async () => {
                // まだ入力欄が見えていなければクリックする
                if (!(await input.isVisible())) {
                    await couponButton.click();
                }
                // 入力欄が見えることを期待（短めのタイムアウトで確認）
                await expect(input).toBeVisible({ timeout: 2000 });
            }).toPass({
                timeout: 15000,   // 最大15秒間リトライする
                intervals: [1000] // 1秒おきに再チェック
            });

            // ダイアログが開いた後の処理
            await expect(input).toBeVisible();
            await expect(input).toBeEditable();

            await input.fill('TEST_DAILY_COUPON');

            // 適用ボタンのクリックも念のためリトライ機構に入れるか、Visibleを待つ
            await expect(applyButton).toBeVisible();
            await applyButton.click();

            // 成功アラートの検証
            await expect(alert).toBeVisible();
            await expect(alert).toContainText('クーポンが適用されました');
            await expect(alert).toContainText('100ポイント獲得しました');

            await alert.getByRole('button', { name: '閉じる' }).click();
            await expect(alert).toBeHidden();
        });

        await test.step('2. 同じクーポンコードを再度入力してポイントが加算されないことを確認する', async () => {
            // 2回目のクリックも同様にリトライロジックで確実に開く
            await expect(async () => {
                if (!(await input.isVisible())) {
                    await couponButton.click();
                }
                await expect(input).toBeVisible({ timeout: 2000 });
            }).toPass({ timeout: 15000 });

            await expect(input).toBeVisible();
            await expect(input).toBeEditable();

            await input.fill('TEST_DAILY_COUPON');
            await applyButton.click();

            // 失敗（重複）アラートの検証
            await expect(alert).toBeVisible();
            await expect(alert).not.toContainText('100ポイント獲得しました');

            await alert.getByRole('button', { name: '閉じる' }).click();
        });
    });

    test('クーポン入力失敗回数上限(5回)のロックアウト確認', async ({ page }) => {
        const dashboardPoint = page.locator('dashboard-point');
        await expect(dashboardPoint).toBeVisible();
        await page.waitForTimeout(1000); // 初期化待ち

        const couponButton = dashboardPoint.getByTitle('クーポン入力');
        const input = dashboardPoint.locator('#coupon-code-input');
        const applyButton = dashboardPoint.locator('.confirm-ok-button');
        const alert = page.locator('alert-component');
        const alertCloseButton = alert.getByRole('button', { name: '閉じる' });

        const maxAttempts = 6;
        const lockOutMessage = 'クーポン入力の失敗回数が上限に達しました';
        const waitMessage = 'しばらく時間を置いてから再試行してください';

        for (let i = 1; i <= maxAttempts; i++) {
            await test.step(`${i}回目の無効なコード入力`, async () => {
                // ループ内でも確実にダイアログを開く
                await expect(async () => {
                    if (!(await input.isVisible())) {
                        await couponButton.click();
                    }
                    await expect(input).toBeVisible({ timeout: 2000 });
                }).toPass({ timeout: 10000 });

                await expect(input).toBeEditable();
                await expect(applyButton).toBeVisible();

                await input.fill(`INVALID_CODE_${Date.now()}_${i}`);
                await applyButton.click();

                await expect(alert).toBeVisible();

                if (i === maxAttempts) {
                    await expect(alert).toContainText(lockOutMessage);
                    await expect(alert).toContainText(waitMessage);
                } else {
                    await expect(alert).toContainText('このクーポンは使用できません。');
                }

                await alertCloseButton.click();
                await expect(alert).toBeHidden();

                // ダイアログが閉じるアニメーションなどを考慮して少し待つ
                // 次のループの toPass で開くのを確認するので、ここでは閉じるのを厳密に待たなくても良いが、
                // 状態を安定させるために少し待機
                try {
                    await expect(input).toBeHidden({ timeout: 2000 });
                } catch {
                    // 閉じなくても次のループで処理する
                }
            });
        }
    });

});