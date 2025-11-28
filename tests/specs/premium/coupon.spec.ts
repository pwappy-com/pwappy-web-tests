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
        await expect(dashboardPoint).toBeVisible();

        const couponButton = dashboardPoint.getByTitle('クーポン入力');

        // クーポンダイアログ内の要素
        const dialog = dashboardPoint.locator('#coupon-input-dialog');
        const input = dashboardPoint.locator('#coupon-code-input');
        const applyButton = dashboardPoint.locator('.confirm-ok-button'); // 適用ボタン
        const alert = page.locator('alert-component');

        await test.step('1. クーポンコードを入力して適用する', async () => {
            await expect(couponButton).toBeVisible();
            await expect(couponButton).toBeEnabled();

            await couponButton.click();
            await expect(dialog).toBeVisible();

            await expect(input).toBeVisible();
            await expect(input).toBeEditable();

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
            await expect(couponButton).toBeVisible();
            await expect(couponButton).toBeEnabled();
            await couponButton.click();

            await expect(dialog).toBeVisible();
            await expect(input).toBeVisible();
            await expect(input).toBeEditable();

            await input.fill('TEST_DAILY_COUPON');
            await applyButton.click();

            // 失敗（重複）アラートの検証
            await expect(alert).toBeVisible();
            await expect(alert).not.toContainText('100ポイント獲得しました');

            // アラートを閉じる
            await alert.getByRole('button', { name: '閉じる' }).click();
        });
    });

    test('クーポン入力失敗回数上限(5回)のロックアウト確認', async ({ page }) => {
        const dashboardPoint = page.locator('dashboard-point');
        await expect(dashboardPoint).toBeVisible();

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
                // 前のループでアラートを閉じた後、入力ダイアログが閉じている可能性があるため、
                // inputが見えていないか、あるいはクーポンボタンが見えている場合はクリックする。
                // isVisible()は非同期で今の状態を取得するだけなので、待機を含まない。
                // 安全のため「inputが見えていなければ」開くロジックにするが、
                // アニメーション中の中途半端な状態を回避するため、まず短い待機を入れるか、
                // あるいは「couponButtonが見えるなら押す」という判定を追加する。

                // ここでは「inputが表示されていない」または「couponButtonが表示されている（ダイアログが閉じている）」場合にクリックする
                if (await couponButton.isVisible() || !await input.isVisible()) {
                    await expect(couponButton).toBeVisible();
                    await expect(couponButton).toBeEnabled();
                    await couponButton.click();
                }

                // 入力欄と適用ボタンが確実に操作可能になるまで待つ
                await expect(input).toBeVisible();
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

                // アラートを閉じる
                await alertCloseButton.click();
                await expect(alert).toBeHidden();

                // 次のループのために、ダイアログの状態が落ち着くのを待つ
                // アラートを閉じると入力ダイアログも閉じる仕様の場合、ここで閉じるのを待たないと
                // 次のループの isVisible() チェックですり抜けてしまう。
                // もし仕様として閉じないなら、この行はタイムアウトするが、
                // エラー内容から「閉じてしまっている」ことが濃厚なのでこれを入れる。
                // 念のため、try-catchやor条件にはせず、単純にinputの状態を確認する待機を入れることもできるが、
                // 最も安全なのは「次のループの冒頭で確実に開く」ことなので、
                // ここで無理に待たずとも上記の if 条件 (couponButton.isVisible || !input.isVisible) でカバーできるはず。
                // ただし、DOM更新のタイミング問題を避けるため、少しだけ待機を入れるか、
                // 確実に「閉じた」ことを確認する方がテストとして堅牢。

                // 現状のエラーは「ボタンがない」ことなので、ダイアログは閉じている。
                // よって、明示的に閉じるのを待つ。
                try {
                    // アラートを閉じた後、入力ダイアログも消えるのを待つ
                    // タイムアウトを短めにして、もし消えない仕様なら無視して進む
                    await expect(input).toBeHidden({ timeout: 2000 });
                } catch (e) {
                    // 消えない仕様、または消えるのに時間がかかっている場合はスルーして次のループへ
                    // 次のループの冒頭の条件分岐で処理される
                }
            });
        }
    });

});