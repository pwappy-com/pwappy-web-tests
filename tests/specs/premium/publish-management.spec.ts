/**
 * @file 公開管理機能、およびAIコーディング機能に関するE2Eテストシナリオです。
 * - アプリケーションバージョンの公開ライフサイクル（公開準備、公開、非公開）のテスト
 * - 公開審査におけるPP（ポイント）消費のテスト
 * - AIコーディング機能利用時のPP消費のテスト
 * などを検証します。
 */

import { test, expect, Page, BrowserContext } from '@playwright/test';
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

// CI/CD環境で実行される際に、どの環境からのテスト実行かを識別するための接尾辞
const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

/**
 * AIコーディングを実行し、指定されたPPが消費されることを検証するヘルパー関数です。
 * この関数は、テストの安定性を高めるために、ページ間のコンテキスト切り替えを慎重に扱います。
 * 
 * @param page - ダッシュボードのPageオブジェクト
 * @param context - BrowserContextオブジェクト
 * @param isMobile - モバイルフラグ
 * @param appName - 対象のアプリ名
 * @param version - 対象のバージョン
 * @param options - テストオプション
 * @param options.prompt - AIに送るプロンプト
 * @param options.model - 使用するAIモデル
 * @param options.expectedPpConsumption - 期待するPP消費量
 * @param options.assertionType - 'exact' (完全一致) または 'greaterThan' (より大きい) の検証方法
 */
async function testAiCodingPpConsumption(
    { page, context, isMobile, appName, version }: { page: Page, context: BrowserContext, isMobile: boolean, appName: string, version: string },
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

    // 2. エディタを新しいページ（タブ）として開き、ヘルパーを準備
    const editorPage = await openEditor(page, context, appName, version);
    const editorHelper = new EditorHelper(editorPage, isMobile);

    // 3. スクリプトタブに移動し、テスト用のスクリプトを作成して編集画面を開く
    await editorHelper.openMoveingHandle("right");
    const scriptContainer = editorPage.locator('script-container');
    await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
    await editorHelper.addNewScript('aiTestScript');
    await editorHelper.openScriptForEditing('aiTestScript');

    // 4. AI機能を利用してコードを生成・置換する
    await editorHelper.generateCodeWithAi(options.prompt, { model: options.model });

    // 5. エディタページを閉じる
    await editorPage.close();

    // 6. メインのダッシュボードページに操作フォーカスを戻す
    // 新しいページを開閉した後は、後続の操作が不安定になるのを防ぐため、
    // 操作対象のページを明示的にアクティブ化します。
    await page.bringToFront();

    // 7. ダッシュボードをリロードし、PPの消費を確認
    // CI環境での安定性を考慮し、'networkidle'ではなくデフォルトの'load'イベントを待ちます。
    await page.reload();
    // リロード後、ページの主要な要素が表示されるのを待つことで、ページの読み込み完了を確実にします。
    await expect(page.getByRole('heading', { name: 'アプリケーション一覧' })).toBeVisible({ timeout: 15000 });

    const finalPoints = await getCurrentPoints(page);
    console.log(`[${options.model}] 最終PP: ${finalPoints}`);
    const consumedPoints = initialPoints - finalPoints;
    console.log(`[${options.model}] 消費PP: ${consumedPoints}`);

    // 8. アサーションのタイプに応じてPP消費量を検証
    if (options.assertionType === 'exact') {
        expect(consumedPoints).toBe(options.expectedPpConsumption);
    } else if (options.assertionType === 'greaterThan') {
        expect(consumedPoints).toBeGreaterThan(options.expectedPpConsumption);
    }
}

// --- テストシナリオ ---
test.describe('公開管理 E2Eシナリオ', () => {

    /**
     * 各テストの実行前に、Cookieを使用してログイン状態を再現し、
     * ダッシュボードの初期ページにアクセスします。
     */
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

    /**
     * アプリケーションバージョンの公開状態が一連の流れ（非公開 -> 公開準備中 -> ... -> 非公開）
     * で正しく遷移すること、およびダウンロード機能が正常に動作することを検証します。
     */
    test('公開状態の遷移とダウンロード機能をテストする', async ({ page }) => {
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
        const appName = (`公開機能テスト-${uniqueId}`).slice(0, 30);
        const appKey = (`publish-test-${uniqueId}`).slice(0, 30);
        const version = '1.0.0';

        await test.step('セットアップ: テスト用のアプリケーションを作成する', async () => {
            await createApp(page, appName, appKey);
        });

        await test.step('テスト: Gemini APIキーを削除する（テスト環境の初期化）', async () => {
            await deleteGeminiApiKey(page);
        });

        await test.step('テスト: 公開状態の遷移とPP消費を確認する', async () => {
            // 公開審査には時間がかかる可能性があるため、このステップのタイムアウトを延長
            test.setTimeout(120000);

            // ダッシュボードから現在のPPを取得
            const initialPoints = await getCurrentPoints(page);
            console.log(`取得した初期ポイント: ${initialPoints}`);
            expect(initialPoints).toBeGreaterThanOrEqual(0);

            // 公開準備を開始
            await startPublishPreparation(page, appName, version);
            await expectVersionStatus(page, version, '公開準備中');

            // ポイントが消費されるのを待つ。固定時間待機(waitForTimeout)は不安定なため、
            // 状態が変化する（PPが減る）までポーリングする方式に変更。
            await expect(async () => {
                await page.reload();
                const currentPointsAfterRequest = await getCurrentPoints(page);
                expect(currentPointsAfterRequest).toBeLessThan(initialPoints);
            }).toPass({ timeout: 15000 }); // 15秒以内にPPが減ることを期待

            // PPの差分を計算し、期待値（50）であることを確認
            const currentPoints = await getCurrentPoints(page);
            console.log(`公開審査を開始したあとに取得したポイント: ${currentPoints}`);
            const pointsDiff = initialPoints - currentPoints;
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
            await expectAppVisibility(page, appName, false);
        });
    });

    /**
     * ユーザーが自身のGemini APIキーを登録した場合、公開審査で消費されるPPが
     * 少なくなることを検証します。
     */
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

        await test.step('テスト: Gemini APIキーを登録する', async () => {
            await setGeminiApiKey(page, apiKey);
        });

        await test.step('テスト: 公開状態の遷移とPP消費を確認する', async () => {
            test.setTimeout(120000);

            const initialPoints = await getCurrentPoints(page);
            console.log(`取得した初期ポイント: ${initialPoints}`);
            expect(initialPoints).toBeGreaterThanOrEqual(0);

            await startPublishPreparation(page, appName, version);
            await expectVersionStatus(page, version, '公開準備中');

            // ポイントが消費されるのをポーリングして待つ
            await expect(async () => {
                await page.reload();
                const currentPointsAfterRequest = await getCurrentPoints(page);
                expect(currentPointsAfterRequest).toBeLessThan(initialPoints);
            }).toPass({ timeout: 15000 });

            // PPの差分を計算し、期待値（10）であることを確認
            const currentPoints = await getCurrentPoints(page);
            console.log(`公開審査を開始したあとに取得したポイント: ${currentPoints}`);
            const pointsDiff = initialPoints - currentPoints;
            expect(pointsDiff).toBe(10);

            await completePublication(page, appName, version);
            await expectVersionStatus(page, version, '公開中');

            await unpublishVersion(page, appName, version);
            await expectVersionStatus(page, version, '非公開');
        });

        await test.step('クリーンアップ: Gemini APIキーを削除する', async () => {
            await deleteGeminiApiKey(page);
        });

        await test.step('クリーンアップ: 作成したアプリケーションを削除する', async () => {
            await deleteApp(page, appKey);
            await expectAppVisibility(page, appName, false);
        });
    });

    /**
     * 無効なGemini APIキーを登録して公開準備を開始した場合、
     * 公開審査が却下されることを検証します。
     */
    test('無効なGeminiAPIキーを登録した際のテストする', async ({ page }) => {
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
        const appName = (`審査GemNGテスト-${uniqueId}`).slice(0, 30);
        const appKey = (`mod-gem-ng-test-${uniqueId}`).slice(0, 30);
        const version = '1.0.0';
        let apiKey = process.env.TEST_GEMINI_API_KEY || '';

        // APIキーが存在する場合、意図的に無効なキーに加工する
        if (apiKey !== '') {
            apiKey = apiKey.slice(0, -10) + 'xxxxxxxxxx';
        }

        await test.step('セットアップ: テスト用のアプリケーションを作成する', async () => {
            await createApp(page, appName, appKey);
        });

        await test.step('テスト: 無効なGemini APIキーを登録する', async () => {
            await setGeminiApiKey(page, apiKey);
        });

        await test.step('テスト: 公開審査が却下されることを確認する', async () => {
            test.setTimeout(120000);

            const initialPoints = await getCurrentPoints(page);
            console.log(`取得した初期ポイント: ${initialPoints}`);
            expect(initialPoints).toBeGreaterThanOrEqual(0);

            await startPublishPreparation(page, appName, version);
            await expectVersionStatus(page, version, '公開準備中');

            // ポイントが消費されるのをポーリングして待つ
            await expect(async () => {
                await page.reload();
                const currentPointsAfterRequest = await getCurrentPoints(page);
                expect(currentPointsAfterRequest).toBeLessThan(initialPoints);
            }).toPass({ timeout: 15000 });

            const currentPoints = await getCurrentPoints(page);
            console.log(`公開審査を開始したあとに取得したポイント: ${currentPoints}`);
            const pointsDiff = initialPoints - currentPoints;
            expect(pointsDiff).toBe(10);

            // サーバー側の審査処理が完了し、「公開審査却下」になるまで待機
            await waitForVersionStatus(page, appName, version, '公開審査却下');
            await expectVersionStatus(page, version, '公開審査却下');
        });

        await test.step('クリーンアップ: Gemini APIキーを削除する', async () => {
            await deleteGeminiApiKey(page);
        });

        await test.step('クリーンアップ: 作成したアプリケーションを削除する', async () => {
            await deleteApp(page, appKey);
            await expectAppVisibility(page, appName, false);
        });
    });

    /**
     * AIコーディング機能を使用した際のPP消費量を、APIキーの有無のシナリオで検証します。
     */
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

        await test.step('セットアップ: アプリ作成とAIコーディングの有効化', async () => {
            await createApp(page, appName, appKey);
            await setAiCoding(page, true);
        });

        // テスト関数に渡すコンテキスト情報をまとめる
        const testContext = { page, context, isMobile, appName, version };

        await test.step('シナリオ1: APIキーなしでProモデルを使用し、PPが多く消費される', async () => {
            await deleteGeminiApiKey(page);
            await testAiCodingPpConsumption(testContext, {
                prompt: '// この関数内に、Hello Worldとアラート表示するコードを実装',
                model: 'gemini-2.5-pro',
                expectedPpConsumption: 1, // 期待値は1より大きいこと
                assertionType: 'greaterThan'
            });
        });

        await test.step('シナリオ2: APIキーありでProモデルを使用し、PPが1消費される', async () => {
            await setGeminiApiKey(page, apiKey);
            await testAiCodingPpConsumption(testContext, {
                prompt: '// この関数の中身を、現在時刻をコンソールに出力するコードに書き換えて',
                model: 'gemini-2.5-pro',
                expectedPpConsumption: 1, // 期待値は1と完全一致すること
                assertionType: 'exact'
            });
        });

        await test.step('クリーンアップ: 作成したアプリケーションを削除する', async () => {
            await deleteApp(page, appKey);
            await expectAppVisibility(page, appName, false);
        });
    });
});