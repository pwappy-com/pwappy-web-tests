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
    gotoDashboard,
} from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';
import { time } from 'console';

test.describe.configure({ mode: 'serial' });

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

test.describe('公開管理 E2Eシナリオ', () => {

    test.beforeEach(async ({ page, context }) => {
        await gotoDashboard(page);
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

        await test.step('テスト: Gemini APIキーを削除する', async () => {
            await deleteGeminiApiKey(page);
        });

        await test.step('テスト: 公開状態の遷移（非公開 -> 準備中 -> 準備完了 -> 公開 -> 非公開）', async () => {
            test.setTimeout(120000);

            const initialPoints = await getCurrentPoints(page);
            console.log(`取得した初期ポイント: ${initialPoints}`);
            expect(initialPoints).toBeGreaterThanOrEqual(20);

            await startPublishPreparation(page, appName, version);
            await expectVersionStatus(page, version, '審査待ち');
            await waitForVersionStatus(page, version, '準備完了', { timeout: 150000, intervals: [10000, 20000] });
            await expectVersionStatus(page, version, '準備完了');
            const currentPoints = await getCurrentPoints(page);
            console.log(`公開審査を開始したあとに取得したポイント: ${currentPoints}`);

            const pointsDiff = initialPoints - currentPoints;
            expect(pointsDiff).toBe(0);

            await completePublication(page, appName, version);
            await expectVersionStatus(page, version, '公開中');

            await unpublishVersion(page, appName, version);
            await expectVersionStatus(page, version, '非公開');
        });

        await test.step('テスト: ダウンロード機能を確認する', async () => {
            await downloadVersion(page, { appName, appKey, version });
        });

        await test.step('クリーンアップ: 作成したアプリケーションを削除する', async () => {
            await page.reload({ waitUntil: 'networkidle' });
            await deleteApp(page, appKey);
            await expectAppVisibility(page, appKey, false);
        });
    });

    test('GeminiAPIキーを登録した状態でも無料で審査できること（0PP消費）をテストする', async ({ page }) => {
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

        await test.step('テスト: APIキーがあっても消費PPが0であることを確認', async () => {
            test.setTimeout(120000);

            const initialPoints = await getCurrentPoints(page);
            console.log(`取得した初期ポイント: ${initialPoints}`);

            await startPublishPreparation(page, appName, version);
            await expectVersionStatus(page, version, '審査待ち');
            await waitForVersionStatus(page, version, '準備完了', { timeout: 150000, intervals: [10000, 20000] });
            await expectVersionStatus(page, version, '準備完了');

            const currentPoints = await getCurrentPoints(page);
            console.log(`公開審査後のポイント: ${currentPoints}`);

            const pointsDiff = initialPoints - currentPoints;
            expect(pointsDiff).toBe(0);
        });

        await test.step('クリーンアップ: APIキー削除とアプリ削除', async () => {
            await page.reload({ waitUntil: 'networkidle' });
            await deleteGeminiApiKey(page);
            await deleteApp(page, appKey);
        });
    });

    test('GeminiAPIキーが無効な状態でも公開審査（0PP消費）が正常に完了することをテストする', async ({ page }) => {
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
            await setGeminiApiKey(page, apiKey);
        });

        await test.step('テスト: 審査実行と20PP消費、および審査通過の確認', async () => {
            test.setTimeout(120000);

            const initialPoints = await getCurrentPoints(page);

            await startPublishPreparation(page, appName, version);

            await page.waitForTimeout(3000);
            const currentPoints = await getCurrentPoints(page);
            expect(initialPoints - currentPoints).toBe(0);
            await waitForVersionStatus(page, version, '準備完了', { timeout: 150000, intervals: [10000, 20000] });
            await expectVersionStatus(page, version, '準備完了');
        });

        await test.step('クリーンアップ', async () => {
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
            await deleteGeminiApiKey(page);
            const initialPoints = await getCurrentPoints(page);

            const editorPage = await openEditor(page, context, appName, version);

            let isProcessing = false;
            let getRequestAfterPostCount = 0;

            await editorPage.route('**/ai-script-coding*', async (route) => {
                const request = route.request();

                if (request.method() === 'POST') {
                    isProcessing = true;
                    getRequestAfterPostCount = 0;
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({ code: 200, message: 'Request accepted' })
                    });
                } else if (request.method() === 'GET') {
                    if (!isProcessing) {
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

            await editorHelper.generateCodeWithAi('モック用の指示です');
            await editorHelper.closeMoveingHandle();

            await editorPage.locator('platform-bottom-menu').evaluate((el: HTMLElement) => el.click());
            await Promise.all([
                editorPage.waitForEvent('close'),
                editorPage.locator('.menu-item', { hasText: '保存せずに閉じる' }).evaluate((el: HTMLElement) => el.click())
            ]);
        });

        await test.step('クリーンアップ', async () => {
            await page.reload({ waitUntil: 'networkidle' });
            await deleteApp(page, appKey);
        });
    });
});