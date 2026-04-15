import { test, expect } from '@playwright/test';
import 'dotenv/config';
import {
    createApp,
    deleteApp,
    startPublishPreparation,
    completePublication,
    unpublishVersion,
    expectVersionStatus,
    downloadVersion,
    expectAppVisibility,
    getCurrentPoints,
    setAiCoding,
    setGeminiApiKey,
    deleteGeminiApiKey,
    waitForVersionStatus,
    openEditor,
    gotoDashboard
} from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';

test.describe.configure({ mode: 'serial' });

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

// --- テストシナリオ ---
test.describe('公開管理 E2Eシナリオ', () => {

    test.beforeEach(async ({ page, context }) => {
        await gotoDashboard(page);
        await expect(page.getByRole('heading', { name: 'アプリケーション一覧' })).toBeVisible();
    });

    test('公開状態の遷移とダウンロード機能をテストする', async ({ page }) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appName = (`公開機能テスト-${uniqueId}`).slice(0, 30);
        const appKey = (`publish-test-${uniqueId}`).slice(0, 30);
        const version = '1.0.0';

        await test.step('セットアップ: テスト用のアプリケーションを作成する', async () => {
            await createApp(page, appName, appKey);
        });

        // APIキーを削除するテスト
        await test.step('テスト: Gemini APIキーを削除する', async () => {
            await deleteGeminiApiKey(page);
        });

        await test.step('テスト: 公開状態の遷移（非公開 -> 準備中 -> 準備完了 -> 公開 -> 非公開）', async () => {
            test.setTimeout(120000);

            const initialPoints = await getCurrentPoints(page);
            console.log(`取得した初期ポイント: ${initialPoints}`);
            expect(initialPoints).toBeGreaterThanOrEqual(20); // 審査に必要な最低20PPがあること

            // 公開準備を開始（ここで審査が走りPPが消費される）
            await startPublishPreparation(page, appName, version);
            await expectVersionStatus(page, version, '公開準備中');

            // アニメーションおよび処理完了まで待機
            await page.waitForTimeout(3000);

            const currentPoints = await getCurrentPoints(page);
            console.log(`公開審査を開始したあとに取得したポイント: ${currentPoints}`);

            const pointsDiff = initialPoints - currentPoints;
            expect(pointsDiff).toBe(20);

            // 公開準備完了を経て公開中にする
            await completePublication(page, appName, version);
            await expectVersionStatus(page, version, '公開中');

            // 非公開に戻す
            await unpublishVersion(page, appName, version);
            await expectVersionStatus(page, version, '非公開');
        });

        await test.step('テスト: ダウンロード機能を確認する', async () => {
            // ダウンロード時は10PP消費される
            await downloadVersion(page, { appName, appKey, version });
        });

        await test.step('クリーンアップ: 作成したアプリケーションを削除する', async () => {
            // ダウンロードダイアログの残存や通信ラグを防ぐため、networkidleまでリロードして状態を完全にリセット
            await page.reload({ waitUntil: 'networkidle' });
            await deleteApp(page, appKey);
            await expectAppVisibility(page, appKey, false);
        });
    });

    test('GeminiAPIキーを登録した状態でも公開審査が20PPであることをテストする', async ({ page }) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appName = (`審査PP固定テスト-${uniqueId}`).slice(0, 30);
        const appKey = (`mod-fixed-test-${uniqueId}`).slice(0, 30);
        const version = '1.0.0';
        const apiKey = process.env.TEST_GEMINI_API_KEY || '';

        await test.step('セットアップ: アプリ作成とAPIキー登録', async () => {
            await createApp(page, appName, appKey);
            await setGeminiApiKey(page, apiKey);
        });

        await test.step('テスト: APIキーがあっても消費PPが20であることを確認', async () => {
            test.setTimeout(120000);

            const initialPoints = await getCurrentPoints(page);
            console.log(`取得した初期ポイント: ${initialPoints}`);

            await startPublishPreparation(page, appName, version);
            await expectVersionStatus(page, version, '公開準備中');

            await page.waitForTimeout(3000);

            const currentPoints = await getCurrentPoints(page);
            console.log(`公開審査後のポイント: ${currentPoints}`);

            // APIキーがあっても10PPではなく20PP消費される
            const pointsDiff = initialPoints - currentPoints;
            expect(pointsDiff).toBe(20);
        });

        await test.step('クリーンアップ: APIキー削除とアプリ削除', async () => {
            // 状態をクリーンにして削除ボタンが確実に押せるようにする
            await page.reload({ waitUntil: 'networkidle' });
            await deleteGeminiApiKey(page);
            await deleteApp(page, appKey);
        });
    });

    test('GeminiAPIキーが無効な状態でも公開審査（20PP消費）が正常に完了することをテストする', async ({ page }) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appName = (`審査GemNG影響なしテスト-${uniqueId}`).slice(0, 30);
        const appKey = (`mod-gem-ng-ok-test-${uniqueId}`).slice(0, 30);
        const version = '1.0.0';
        let apiKey = process.env.TEST_GEMINI_API_KEY || '';

        if (apiKey !== '') {
            apiKey = apiKey.slice(0, -10) + 'xxxxxxxxxx';
        }

        await test.step('セットアップ: アプリ作成と無効なAPIキー設定', async () => {
            await createApp(page, appName, appKey);
            // ユーザー設定として無効なGeminiキーを登録
            await setGeminiApiKey(page, apiKey);
        });

        await test.step('テスト: 審査実行と20PP消費、および審査通過の確認', async () => {
            test.setTimeout(120000);

            // 審査開始前のポイントを保持
            const initialPoints = await getCurrentPoints(page);

            // 公開準備を開始（OpenAI Moderationによる審査が走る）
            await startPublishPreparation(page, appName, version);

            // 1. 消費ポイントの検証: 審査開始時点で一律20PP消費されることを確認
            await page.waitForTimeout(3000);
            const currentPoints = await getCurrentPoints(page);
            expect(initialPoints - currentPoints).toBe(20);

            // OpenAI Moderation審査なので、ユーザーのGeminiキーが無効でも「公開準備完了」になる
            await waitForVersionStatus(page, appName, version, '公開準備完了', { timeout: 150000, intervals: [10000, 20000] });
            await expectVersionStatus(page, version, '公開準備完了');
        });

        await test.step('クリーンアップ', async () => {
            // 状態をクリーンにして削除ボタンが確実に押せるようにする
            await page.reload({ waitUntil: 'networkidle' });
            await deleteGeminiApiKey(page);
            await deleteApp(page, appKey);
        });
    });

    test('AIコーディングをテストする（モック実行）', async ({ page, context, isMobile }) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appName = (`AIモックテスト-${uniqueId}`).slice(0, 30);
        const appKey = (`ai-mock-test-${uniqueId}`).slice(0, 30);
        const version = '1.0.0';

        await test.step('セットアップ: アプリ作成とAI有効化', async () => {
            await createApp(page, appName, appKey);
            await setAiCoding(page, true);
        });

        const testContext = { page, context, isMobile, appName, version };

        await test.step('テスト: モック応答でAIコーディングのフローが完了することを確認', async () => {
            // APIキーの有無に関わらず、モックが反応するので Gemini は消費されない
            await deleteGeminiApiKey(page);

            // initialPoints の取得
            const initialPoints = await getCurrentPoints(page);

            const editorPage = await openEditor(page, context, appName, version);

            // 状態管理用の変数
            let isProcessing = false;
            let getRequestAfterPostCount = 0;

            // モックを設定する
            // エンドポイントを **/ai-script-coding* に変更し、GET/POSTで分岐
            // 末尾にワイルドカードをつけることでクエリパラメータ(?ticket=...)に対応
            await editorPage.route('**/ai-script-coding*', async (route) => {
                const request = route.request();

                if (request.method() === 'POST') {
                    // 送信リクエストには受付OKを返す
                    isProcessing = true;
                    getRequestAfterPostCount = 0;
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({ code: 200, message: 'Request accepted' })
                    });
                } else if (request.method() === 'GET') {
                    if (!isProcessing) {
                        // 初期状態（エディタを開いた直後）は履歴なしを返す
                        // これで「コード生成中」などの不要なメッセージが出ないようにする
                        await route.fulfill({
                            status: 200,
                            contentType: 'application/json',
                            body: JSON.stringify({
                                code: 200,
                                details: []
                            })
                        });
                    } else {
                        getRequestAfterPostCount++;

                        // 送信後のポーリングリクエストには、状態を変化させて返す
                        // 1回目: pending (コード生成中) -> verifyのために必要
                        // 2回目以降: completed (完了) -> ボタンを表示させるため
                        const status = getRequestAfterPostCount <= 1 ? "pending" : "completed";

                        await route.fulfill({
                            status: 200,
                            contentType: 'application/json',
                            body: JSON.stringify({
                                code: 200,
                                details: [
                                    {
                                        ticket: "mock-ticket-12345",
                                        requestContent: "モック用の指示です",
                                        // サーバー側でMarkdown記法や説明文は既に除去され、純粋なコードのみになっている状態をシミュレート
                                        responseContent: status === "completed" ?
                                            "function mockedFunction() {\n  console.log('This is a mocked response');\n}"
                                            : null,
                                        responseFormat: "text",
                                        status: status,
                                        createdDate: new Date().toLocaleString(),
                                        finishReason: status === "completed" ? "STOP" : null
                                    }
                                ]
                            })
                        });
                    }
                } else {
                    await route.continue();
                }
            });

            const editorHelper = new EditorHelper(editorPage, isMobile);

            await editorHelper.openMoveingHandle("right");
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await editorHelper.addNewScript('mockScript');
            await editorHelper.openScriptForEditing('mockScript');

            // AI実行（ここで page.route が発動する）
            await editorHelper.generateCodeWithAi('モック用の指示です');

            await editorHelper.closeMoveingHandle();

            // エディタを閉じる
            await editorPage.locator('platform-bottom-menu').evaluate((el: HTMLElement) => el.click());
            await Promise.all([
                editorPage.waitForEvent('close'),
                editorPage.locator('.menu-item', { hasText: '保存せずに閉じる' }).evaluate((el: HTMLElement) => el.click())
            ]);
        });

        await test.step('クリーンアップ', async () => {
            // 状態をクリーンにして削除ボタンが確実に押せるようにする
            await page.reload({ waitUntil: 'networkidle' });
            await deleteApp(page, appKey);
        });
    });

});