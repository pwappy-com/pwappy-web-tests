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

    // 3. スクリプトタブに移動し、スクリプトを作成して編集画面を開く
    await editorHelper.openMoveingHandle("right");
    const scriptContainer = editorPage.locator('script-container');
    await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
    await editorHelper.addNewScript('aiTestScript');
    await editorHelper.openScriptForEditing('aiTestScript');

    // 4. AIでコードを生成・置換
    await editorHelper.generateCodeWithAi(options.prompt, { model: options.model });

    // 5. エディタを閉じる
    await editorPage.close();

    // 6. ダッシュボードに戻り、PPの消費を確認
    await page.reload({ waitUntil: 'domcontentloaded' });

    // リロード後にダッシュボードの主要な要素が表示されるのを待つことで、安定性を高める
    await expect(page.getByRole('heading', { name: 'アプリケーション一覧' })).toBeVisible({ timeout: 15000 });

    const finalPoints = await getCurrentPoints(page);
    console.log(`[${options.model}] 最終PP: ${finalPoints}`);
    const consumedPoints = initialPoints - finalPoints;
    console.log(`[${options.model}] 消費PP: ${consumedPoints}`);

    // 7. アサーションのタイプに応じてPP消費量を検証
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
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
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

            // ダッシュボードから現在のPPを取得
            const initialPoints = await getCurrentPoints(page);
            console.log(`取得した初期ポイント: ${initialPoints}`);
            expect(initialPoints).toBeGreaterThanOrEqual(0);

            // 公開準備を開始
            await startPublishPreparation(page, appName, version);
            await expectVersionStatus(page, version, '公開準備中');

            // アニメーションが終わるまで固定で3秒停止
            await page.waitForTimeout(3000);

            const currentPoints = await getCurrentPoints(page);
            console.log(`公開審査を開始したあとに取得したポイント: ${currentPoints}`);
            // PPの差分を計算
            const pointsDiff = initialPoints - currentPoints;

            // 差分は50であることを確認
            expect(pointsDiff).toBe(50);

            // 公開準備完了を経て公開中にする
            await completePublication(page, appName, version);
            await expectVersionStatus(page, version, '公開中');

            // 非公開に戻す
            await unpublishVersion(page, appName, version);
            await expectVersionStatus(page, version, '非公開');
        });

        await test.step('テスト: ダウンロード機能を確認する', async () => {
            await downloadVersion(page, { appName, appKey, version });
        });

        await test.step('クリーンアップ: 作成したアプリケーションを削除する', async () => {
            await deleteApp(page, appKey);
            await expectAppVisibility(page, appName, false); // 汎用ヘルパーで確認
        });
    });

    test('GeminiAPIキーを登録した際の公開審査で使うPPをテストする', async ({ page }) => {
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
        const appName = (`審査PPテスト-${uniqueId}`).slice(0, 30);
        const appKey = (`mod-test-${uniqueId}`).slice(0, 30);
        const version = '1.0.0';
        const apiKey = process.env.TEST_GEMINI_API_KEY || '';

        await test.step('セットアップ: テスト用のアプリケーションを作成する', async () => {
            await createApp(page, appName, appKey);
        });

        // APIキーを登録するテスト
        await test.step('テスト: Gemini APIキーを登録する', async () => {
            // 環境変数からAPIキーを取得する
            await setGeminiApiKey(page, apiKey);
        });

        await test.step('テスト: 公開状態の遷移（非公開 -> 準備中 -> 準備完了 -> 公開 -> 非公開）', async () => {
            test.setTimeout(120000);

            // ダッシュボードから現在のPPを取得
            const initialPoints = await getCurrentPoints(page);
            console.log(`取得した初期ポイント: ${initialPoints}`);
            expect(initialPoints).toBeGreaterThanOrEqual(0);

            // 公開準備を開始
            await startPublishPreparation(page, appName, version);
            await expectVersionStatus(page, version, '公開準備中');

            // アニメーションが終わるまで固定で3秒停止
            await page.waitForTimeout(3000);

            const currentPoints = await getCurrentPoints(page);
            console.log(`公開審査を開始したあとに取得したポイント: ${currentPoints}`);
            // PPの差分を計算
            const pointsDiff = initialPoints - currentPoints;

            // 差分は10であることを確認
            expect(pointsDiff).toBe(10);

            // 公開準備完了を経て公開中にする
            await completePublication(page, appName, version);
            await expectVersionStatus(page, version, '公開中');

            // 非公開に戻す
            await unpublishVersion(page, appName, version);
            await expectVersionStatus(page, version, '非公開');
        });


        // APIキーを削除するテスト
        await test.step('テスト: Gemini APIキーを削除する', async () => {
            await deleteGeminiApiKey(page);
        });

        await test.step('クリーンアップ: 作成したアプリケーションを削除する', async () => {
            await deleteApp(page, appKey);
            await expectAppVisibility(page, appName, false);
        });
    });

    test('無効なGeminiAPIキーを登録した際のテストする', async ({ page }) => {
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
        const appName = (`審査GemNGテスト-${uniqueId}`).slice(0, 30);
        const appKey = (`mod-gem-ng-test-${uniqueId}`).slice(0, 30);
        const version = '1.0.0';
        let apiKey = process.env.TEST_GEMINI_API_KEY || '';

        //apiKeyが空でなければ、最後の10文字を別の文字に変える
        if (apiKey !== '') {
            apiKey = apiKey.slice(0, -10) + 'xxxxxxxxxx';
        }

        await test.step('セットアップ: テスト用のアプリケーションを作成する', async () => {
            await createApp(page, appName, appKey);
        });

        // APIキーを登録するテスト
        await test.step('テスト: Gemini APIキーを登録する', async () => {
            // 環境変数からAPIキーを取得する
            await setGeminiApiKey(page, apiKey);
        });

        await test.step('テスト: 公開状態の遷移（非公開 -> 準備中 -> 準備完了 -> 公開 -> 非公開）', async () => {
            test.setTimeout(120000);

            // ダッシュボードから現在のPPを取得
            const initialPoints = await getCurrentPoints(page);
            console.log(`取得した初期ポイント: ${initialPoints}`);
            expect(initialPoints).toBeGreaterThanOrEqual(0);

            // 公開準備を開始
            await startPublishPreparation(page, appName, version);
            await expectVersionStatus(page, version, '公開準備中');

            // アニメーションが終わるまで固定で3秒停止
            await page.waitForTimeout(3000);

            const currentPoints = await getCurrentPoints(page);
            console.log(`公開審査を開始したあとに取得したポイント: ${currentPoints}`);
            // PPの差分を計算
            const pointsDiff = initialPoints - currentPoints;

            // 差分は10であることを確認
            expect(pointsDiff).toBe(10);

            // 公開準備完了まで待機
            await waitForVersionStatus(page, appName, version, '公開審査却下');

            // 公開審査却下になっていることを確認
            await expectVersionStatus(page, version, '公開審査却下');
        });

        // APIキーを削除するテスト
        await test.step('テスト: Gemini APIキーを削除する', async () => {
            await deleteGeminiApiKey(page);
        });

        await test.step('クリーンアップ: 作成したアプリケーションを削除する', async () => {
            await deleteApp(page, appKey);
            await expectAppVisibility(page, appName, false);
        });
    });

    test('AIコーディングの使用ポイントをテストする', async ({ page, context, isMobile }) => {
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
        const appName = (`AIコードテスト-${uniqueId}`).slice(0, 30);
        const appKey = (`ai-code-test-${uniqueId}`).slice(0, 30);
        const version = '1.0.0';
        const apiKey = process.env.TEST_GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('環境変数 TEST_GEMINI_API_KEY が設定されていません。');
        }

        await test.step('セットアップ: テスト用のアプリケーションを作成し、AIコーディングを有効化', async () => {
            await createApp(page, appName, appKey);
            await setAiCoding(page, true);
        });

        const testContext = { page, context, isMobile, appName, version };

        // --- シナリオ1: APIキーなし + Proモデル ---
        await test.step('テスト: APIキーなしでProモデルを使用し、PPが多く消費されることを確認', async () => {
            await deleteGeminiApiKey(page);
            await testAiCodingPpConsumption(testContext, {
                prompt: '// この関数内に、Hello Worldとアラート表示するコードを実装',
                model: 'gemini-2.5-pro',
                expectedPpConsumption: 1, // 1より大きいことを確認
                assertionType: 'greaterThan'
            });
        });

        // --- シナリオ2: APIキーあり + Proモデル ---
        await test.step('テスト: APIキーありでProモデルを使用し、PPが1消費されることを確認', async () => {
            await setGeminiApiKey(page, apiKey);
            await testAiCodingPpConsumption(testContext, {
                prompt: '// この関数の中身を、現在時刻をコンソールに出力するコードに書き換えて',
                model: 'gemini-2.5-pro',
                expectedPpConsumption: 1, // 1と完全一致することを確認
                assertionType: 'exact'
            });
        });

        await test.step('クリーンアップ: 作成したアプリケーションを削除する', async () => {
            await deleteApp(page, appKey);
            await expectAppVisibility(page, appName, false);
        });
    });
});