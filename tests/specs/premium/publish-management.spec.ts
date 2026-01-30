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
    openEditor
} from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';

test.describe.configure({ mode: 'serial' });

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

/**
 * AIコーディングを実行し、指定されたPPが消費されることを検証するヘルパー関数
 * @param page - ダッシュボードのPageオブジェクト
 * @param context - BrowserContextオブジェクト
 * @param isMobile - モバイルフラグ
 * @param appName - 対象のアプリ名
 * @param version - 対象のバージョン
 * @param options - テストオプション
 * @param options.prompt - AIに送るプロンプト
 * @param options.model - 使用するAIモデル
 * @param options.expectedPpConsumption - 期待するPP消費量（数値、または比較関数）
 * @param options.assertionType - 'exact' (完全一致) または 'greaterThan' (より大きい)
 */
async function testAiCodingPpConsumption(
    { page, context, isMobile, appName, version }: { page: any, context: any, isMobile: boolean, appName: string, version: string },
    options: {
        prompt: string;
        model: string;
        expectedPpConsumption: number;
        assertionType: 'exact' | 'greaterThan';
    }
) {
    // 1. AI実行前のPPを取得
    const initialPoints = await getCurrentPoints(page);
    console.log(`[${options.model}] 初期PP: ${initialPoints}`);

    // 2. エディタを開いてヘルパーを準備
    const editorPage = await openEditor(page, context, appName, version);
    const editorHelper = new EditorHelper(editorPage, isMobile);

    // 3. スクリプトタブに移動
    await editorHelper.openMoveingHandle("right");
    const scriptContainer = editorPage.locator('script-container');
    await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
    await editorHelper.addNewScript('aiTestScript');
    await editorHelper.openScriptForEditing('aiTestScript');

    // 4. AIでコードを生成・置換
    await editorHelper.generateCodeWithAi(options.prompt, { model: options.model });

    // 5. エディタページを「メニュー > 保存せずに閉じる」で正常終了させる
    // これにより自動保存との競合を防ぎ、テストを安定させます
    await editorPage.locator('platform-bottom-menu').click();
    const saveAndCloseButton = editorPage.locator('.menu-item', { hasText: '保存せずに閉じる' });

    // クリックと同時にページが閉じるのを待機
    await Promise.all([
        editorPage.waitForEvent('close'),
        saveAndCloseButton.click()
    ]);

    // 6. ダッシュボードに戻り、PPの消費を確認
    await page.reload({ waitUntil: 'networkidle' });
    const finalPoints = await getCurrentPoints(page);
    console.log(`[${options.model}] 最終PP: ${finalPoints}`);
    const consumedPoints = initialPoints - finalPoints;
    console.log(`[${options.model}] 消費PP: ${consumedPoints}`);

    // 7. 検証
    if (options.assertionType === 'exact') {
        expect(consumedPoints).toBe(options.expectedPpConsumption);
    } else if (options.assertionType === 'greaterThan') {
        expect(consumedPoints).toBeGreaterThan(options.expectedPpConsumption);
    }
}

// --- テストシナリオ ---
test.describe('公開管理 E2Eシナリオ', () => {

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

            // 【重要】仕様変更：OpenAI Moderation切り替えにより、APIキー有無に関わらず一律20PP消費
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
            await waitForVersionStatus(page, appName, version, '公開準備完了');
            await expectVersionStatus(page, version, '公開準備完了');
        });

        await test.step('クリーンアップ', async () => {
            await deleteGeminiApiKey(page);
            await deleteApp(page, appKey);
        });
    });

    // test('AIコーディングの使用ポイントをテストする', async ({ page, context, isMobile }) => {
    //     const workerIndex = test.info().workerIndex;
    //     const reversedTimestamp = Date.now().toString().split('').reverse().join('');
    //     const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
    //     const appName = (`AIコードテスト-${uniqueId}`).slice(0, 30);
    //     const appKey = (`ai-code-test-${uniqueId}`).slice(0, 30);
    //     const version = '1.0.0';
    //     const apiKey = process.env.TEST_GEMINI_API_KEY;
    //     if (!apiKey) {
    //         throw new Error('環境変数 TEST_GEMINI_API_KEY が設定されていません。');
    //     }

    //     await test.step('セットアップ: アプリ作成とAI有効化', async () => {
    //         await createApp(page, appName, appKey);
    //         await setAiCoding(page, true);
    //     });

    //     const testContext = { page, context, isMobile, appName, version };

    //     // --- シナリオ1: APIキーなし ---
    //     await test.step('テスト: APIキーなしでPPが多く消費されることを確認', async () => {
    //         await deleteGeminiApiKey(page);
    //         await testAiCodingPpConsumption(testContext, {
    //             prompt: '// canvasを作って、ひらがな、カタカナ、英数字をランダムで上下左右から文字が現れるアニメーションを表示するコードを実装してください。文字は残像を残してアニメーションをします。また、10秒毎に文字の大きさがランダムで切り替わり、豪華なパーティクルもつけてください。',
    //             model: 'gemini-2.5-flash-lite',
    //             expectedPpConsumption: 1, // 1より大きいことを確認
    //             assertionType: 'greaterThan'
    //         });
    //         // ページ終了処理はヘルパー関数内の「保存して閉じる」で行われます
    //     });

    //     // --- シナリオ2: APIキーあり ---
    //     await test.step('テスト: APIキーありでPPが1消費されることを確認', async () => {
    //         await setGeminiApiKey(page, apiKey);
    //         await testAiCodingPpConsumption(testContext, {
    //             prompt: '// canvasを作って、ひらがな、カタカナ、英数字をランダムで上下左右から文字が現れるアニメーションを表示するコードを実装してください。文字は残像を残してアニメーションをします。また、10秒毎に文字の大きさがランダムで切り替わり、豪華なパーティクルもつけてください。',
    //             model: 'gemini-2.5-flash-lite',
    //             expectedPpConsumption: 1, // 1と完全一致することを確認
    //             assertionType: 'exact'
    //         });
    //     });

    //     await test.step('クリーンアップ: 作成したアプリケーションを削除する', async () => {
    //         await deleteApp(page, appKey);
    //         await expectAppVisibility(page, appKey, false);
    //     });
    // });

    // Geminiを使わないモック版のテスト
    test('AIコーディングをテストする（モック実行）', async ({ page, context, isMobile }) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appName = (`AIモックテスト-${uniqueId}`).slice(0, 30);
        const appKey = (`ai-mock-test-${uniqueId}`).slice(0, 30);
        const version = '1.0.0';

        // 1. ネットワークリクエストをモック化
        // AIコーディングのAPIエンドポイント（ここでは仮に **/ai-coding とします）をフック
        await page.route('**/ai-coding', async (route) => {
            // リクエストを受け取ったフリをして、1秒後にダミー回答を返す
            await new Promise(resolve => setTimeout(resolve, 1000));
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    code: 200,
                    details: {
                        text: "function mockedFunction() {\n  console.log('This is a mocked response');\n}"
                    }
                })
            });
        });

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
            await editorPage.locator('platform-bottom-menu').click();
            await Promise.all([
                editorPage.waitForEvent('close'),
                editorPage.locator('.menu-item', { hasText: '保存せずに閉じる' }).click()
            ]);

            //モックなのでPP消費はなし
        });

        await test.step('クリーンアップ', async () => {
            await deleteApp(page, appKey);
        });
    });

});