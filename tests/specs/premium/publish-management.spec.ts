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

test.describe.configure({ mode: 'serial' });

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

const logTime = (msg: string) => {
    const now = new Date();
    console.log(`[PublishTest:Time] ${now.toISOString()} - ${msg}`);
};

test.describe('公開管理 E2Eシナリオ', () => {

    test.beforeEach(async ({ page, context }) => {
        page.on('console', msg => {
            if (msg.type() === 'error' || msg.type() === 'warning') {
                console.log(`[PublishTest:Console] ${msg.type()}: ${msg.text()}`);
            }
        });
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
            await startPublishPreparation(page, appName, version);
            await expectVersionStatus(page, version, '審査待ち');
            await waitForVersionStatus(page, version, '準備完了', { timeout: 150000, intervals: [10000, 20000] });
            await expectVersionStatus(page, version, '準備完了');
            const currentPoints = await getCurrentPoints(page);
            expect(initialPoints - currentPoints).toBe(0);
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
            expect(initialPoints - currentPoints).toBe(0);
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
        // 処理全体でどこに時間がかかっているかを完全追跡
        logTime('テスト開始');

        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appName = (`AIモックテスト-${uniqueId}`).slice(0, 30);
        const appKey = (`ai-mock-test-${uniqueId}`).slice(0, 30);
        const version = '1.0.0';

        await test.step('セットアップ: アプリ作成とAI有効化', async () => {
            logTime('createApp 開始');
            await createApp(page, appName, appKey);
            logTime('createApp 完了、setAiCoding 開始');
            await setAiCoding(page, true);
            logTime('setAiCoding 完了');
        });

        await test.step('テスト: モック応答でAIコーディングのフローが完了することを確認', async () => {
            logTime('deleteGeminiApiKey 開始');
            await deleteGeminiApiKey(page);
            logTime('deleteGeminiApiKey 完了、openEditor 開始');

            const editorPage = await openEditor(page, context, appName, version);
            logTime('openEditor 完了、route モック設定開始');

            // ---------------------------------------------------------
            // 【原因特定用】 ダイアログやエラーの監視
            // ---------------------------------------------------------
            editorPage.on('dialog', async dialog => {
                logTime(`[PublishTest:Dialog] Type: ${dialog.type()}, Message: ${dialog.message()}`);
                // Playwrightのデフォルト動作に委ねる場合はdismiss
                await dialog.dismiss();
            });
            editorPage.on('pageerror', error => {
                logTime(`[PublishTest:PageError] ${error.message}`);
            });
            // ---------------------------------------------------------

            let isProcessing = false;
            let getRequestAfterPostCount = 0;

            await editorPage.route('**/ai-script-coding*', async (route) => {
                const request = route.request();

                if (request.method() === 'POST') {
                    isProcessing = true;
                    getRequestAfterPostCount = 0;
                    logTime('API Mock: POST 受信');
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
                            body: JSON.stringify({ code: 200, details: [] })
                        });
                    } else {
                        getRequestAfterPostCount++;
                        logTime(`API Mock: GET 受信 (${getRequestAfterPostCount}回目)`);
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
            logTime('editorHelper 初期化完了、UI操作開始');

            await editorHelper.openMoveingHandle("right");
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await editorHelper.addNewScript('mockScript');
            await editorHelper.openScriptForEditing('mockScript');

            logTime('generateCodeWithAi 開始');
            await editorHelper.generateCodeWithAi('モック用の指示です');
            logTime('generateCodeWithAi 完了');

            await editorHelper.closeMoveingHandle();

            logTime('エディタを閉じる操作 開始');

            // ---------------------------------------------------------
            // 【原因特定用】 100秒間のフリーズがどこで発生しているかを1行ずつ記録
            // ---------------------------------------------------------
            try {
                logTime('Step A: platform-bottom-menu クリック実行');
                await editorPage.locator('platform-bottom-menu').evaluate((el: HTMLElement) => el.click());
                logTime('Step A: platform-bottom-menu クリック完了');

                logTime('Step B: 保存せずに閉じる クリック実行');
                // Promise.all にせず、1行ずつ実行してどこで詰まるか確認
                const closeAction = editorPage.locator('.menu-item', { hasText: '保存せずに閉じる' }).evaluate((el: HTMLElement) => el.click());
                logTime('Step B: 保存せずに閉じる クリック(非同期)発行完了');

                logTime('Step C: waitForEvent("close") 待機開始');
                // 無限に待たないようにタイムアウトを設定して状態を可視化
                await editorPage.waitForEvent('close', { timeout: 15000 });
                logTime('Step C: waitForEvent("close") 完了');

                await closeAction; // クリック自体が完了したか確認
                logTime('Step D: クリックPromiseの解決確認 完了');

            } catch (e: any) {
                logTime(`エディタを閉じる操作中にエラー/タイムアウト発生: ${e.message}`);
            }

            logTime('エディタを閉じる操作 完了');
        });

        await test.step('クリーンアップ', async () => {
            logTime('クリーンアップステップ 開始');
            const activeRequests = new Set<string>();
            const reqHandler = (req: any) => activeRequests.add(req.url());
            const resHandler = (req: any) => activeRequests.delete(req.url());
            page.on('request', reqHandler);
            page.on('requestfinished', resHandler);
            page.on('requestfailed', resHandler);

            const interval = setInterval(() => {
                if (activeRequests.size > 0) {
                    console.log(`[PublishTest:PendingRequests] 待機中: ${Array.from(activeRequests).join(', ')}`);
                }
            }, 5000);

            try {
                logTime('page.reload(networkidle) 開始');
                await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
                logTime('page.reload(networkidle) 完了');
            } catch (e: any) {
                logTime(`page.reload(networkidle) エラー: ${e.message}`);
                try {
                    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
                    logTime('page.reload(domcontentloaded) 完了');
                } catch (ee) { }
            } finally {
                clearInterval(interval);
                page.off('request', reqHandler);
                page.off('requestfinished', resHandler);
                page.off('requestfailed', resHandler);
            }

            logTime('deleteApp 開始');
            await deleteApp(page, appKey);
            logTime('deleteApp 完了');
        });
    });
});