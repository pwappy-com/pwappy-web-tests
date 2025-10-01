import { test as base, expect, Page, Locator } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, openEditor, setGeminiApiKey, deleteGeminiApiKey } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';

// テスト実行ごとにユニークな接尾辞を生成するための環境変数
const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

/**
 * Playwrightのテストフィクスチャを拡張します。
 * このファイル内の各テストで、ユニークなアプリケーション名を自動的に提供します。
 */
const test = base.extend<{ appName: string }>({
    appName: async ({ }, use) => {
        // 現在時刻の逆順文字列と接尾辞を組み合わせて、テストごとにユニークなアプリ名を生成
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
        await use(`test-app-${uniqueId}`.slice(0, 30));
    },
});

/**
 * AIエージェント機能とスナップショット機能に関するE2Eテストスイート。
 * .serial を指定することで、このファイル内のテストが記述された順に直列実行され、
 * テスト間の状態汚染（APIキーの登録状態など）を防ぎます。
 */
test.describe.serial('AIエージェントとスナップショット機能のテスト', () => {
    // describe スコープで appKey を保持し、afterEach でのクリーンアップに使用
    let appKey: string;

    /**
     * 各テストの実行前に共通のセットアップ処理を実行します。
     * - 認証Cookieを設定してログイン状態をシミュレート
     * - ダッシュボードページにアクセス
     * - 各テストで使用するユニークなappKeyを生成
     */
    test.beforeEach(async ({ page, context }) => {
        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        const domain = testUrl.hostname;
        // 認証情報をCookieに設定
        await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/' },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/' },
            { name: 'pwappy_login', value: '1', domain: domain, path: '/' },
        ]);
        // ダッシュボードページに移動
        await page.goto(String(process.env.PWAPPY_TEST_BASE_URL), { waitUntil: 'domcontentloaded' });
        // ページが正しく読み込まれたことを確認
        await expect(page.getByRole('heading', { name: 'アプリケーション一覧' })).toBeVisible();

        // 各テストで一意となるappKeyを生成
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
        appKey = `test-key-${uniqueId}`.slice(0, 30);
    });

    /**
     * 各テストの実行後に、作成されたアプリケーションを必ず削除するクリーンアップ処理。
     */
    test.afterEach(async ({ page }) => {
        // afterEachはテストが失敗しても実行されるため、appKeyが存在する場合のみ削除処理を行う
        if (appKey) {
            await deleteApp(page, appKey);
        }
    });

    /**
     * AIエージェント機能のUI表示と、モデル設定のデフォルト値が正しいかを検証します。
     * このテストはGemini APIキーが登録されていることを前提とします。
     */
    test('AIエージェント機能のUIとデフォルト設定を検証する', async ({ page, context, isMobile, appName }) => {
        const apiKey = process.env.TEST_GEMINI_API_KEY;
        // 修正箇所: test.skip の使い方を修正
        test.skip(!apiKey, 'TEST_GEMINI_API_KEY is not set. Skipping AI Agent test.');

        let editorPage: Page | null = null; // editorPageをnull許容で初期化

        try {
            await test.step('セットアップ: Gemini APIキーを登録し、アプリを作成してエディタを開く', async () => {
                await setGeminiApiKey(page, apiKey!); // apiKeyが存在することはskipで保証されている
                await createApp(page, appName, appKey);
                editorPage = await openEditor(page, context, appName);
            });

            const editorHelper = new EditorHelper(editorPage!, isMobile);

            await test.step('1. AIエージェントボタンが表示され、ウィンドウが開くことを確認', async () => {
                const menuButton = editorPage!.locator('#fab-bottom-menu-box');
                await menuButton.click();

                const platformBottomMenu = editorPage!.locator('#platformBottomMenu');
                await expect(platformBottomMenu).toBeVisible();

                const agentButton = platformBottomMenu.getByText('AIエージェント');
                await expect(agentButton).toBeVisible();
                await agentButton.click();

                const agentWindow = editorPage!.locator('agent-chat-window');
                await expect(agentWindow).toBeVisible();
            });

            await test.step('2. モデル設定モーダルを開き、デフォルト値を確認', async () => {
                const agentWindow = editorPage!.locator('agent-chat-window');
                await agentWindow.locator('.settings-btn').click();

                const settingsModal = agentWindow.locator('.modal-dialog');
                await expect(settingsModal).toBeVisible();

                await expect(settingsModal.locator('#ideation-model-select')).toHaveValue('gemini-2.5-pro');
                await expect(settingsModal.locator('#planning-model-select')).toHaveValue('gemini-2.5-flash');
                await expect(settingsModal.locator('#implementation-model-select')).toHaveValue('gemini-2.5-flash');
                await expect(settingsModal.locator('#verification-model-select')).toHaveValue('gemini-2.5-flash');
                await expect(settingsModal.locator('#max-history-input')).toHaveValue('20');
                await expect(settingsModal.locator('#max-recovery-input')).toHaveValue('3');

                await settingsModal.getByRole('button', { name: 'キャンセル' }).click();
                await expect(settingsModal).toBeHidden();

                await agentWindow.locator('.close-btn').click();
                await expect(agentWindow).toBeHidden();
            });

        } finally {
            // finallyブロックでクリーンアップ処理を確実に行う
            await test.step('クリーンアップ: Gemini APIキーを削除し、エディタを閉じる', async () => {
                // editorPageが開かれている場合のみ閉じる
                if (editorPage && !editorPage.isClosed()) {
                    await editorPage.close();
                }
                // ダッシュボードページに戻ってAPIキーを削除
                await page.bringToFront();
                await deleteGeminiApiKey(page);
            });
        }
    });

    /**
     * Gemini APIキーが登録されていない場合に、AIエージェントのメニュー項目が
     * 表示されないことを検証します。
     */
    test('Gemini APIキーが未登録の場合、AIエージェントボタンが表示されないことを確認する', async ({ page, context, isMobile, appName }) => {
        let editorPage: Page | null = null; // editorPageをnull許容で初期化

        try {
            await test.step('セットアップ: APIキーを削除し、アプリを作成してエディタを開く', async () => {
                await deleteGeminiApiKey(page);
                await createApp(page, appName, appKey);
                editorPage = await openEditor(page, context, appName);
            });

            await test.step('1. メニューを開き、AIエージェントボタンが表示されないことを確認', async () => {
                const menuButton = editorPage!.locator('#fab-bottom-menu-box');
                await menuButton.click();

                const platformBottomMenu = editorPage!.locator('#platformBottomMenu');
                await expect(platformBottomMenu).toBeVisible();

                const agentButton = platformBottomMenu.getByText('AIエージェント');
                await expect(agentButton).toBeHidden();
            });
        } finally {
            await test.step('クリーンアップ: エディタを閉じる', async () => {
                if (editorPage && !editorPage.isClosed()) {
                    await editorPage.close();
                }
            });
        }
    });

    /**
     * スナップショットの作成、アプリケーションの変更、そしてスナップショットからの
     * 状態復元という一連のライフサイクルをテストします。
     */
    test('スナップショットの作成と復元ができる', async ({ page, context, isMobile, appName }) => {
        const uniqueSnapshotName = `test-snapshot-${Date.now()}`;
        let editorPage: Page | null = null;
        let editorHelper: EditorHelper;

        try {
            await test.step('セットアップ: アプリを作成してエディタを開く', async () => {
                await createApp(page, appName, appKey);
                editorPage = await openEditor(page, context, appName);
                editorHelper = new EditorHelper(editorPage, isMobile);
            });

            await test.step('1. スナップショット管理画面を開き、新しいスナップショットを作成', async () => {
                const menuButton = editorPage!.locator('#fab-bottom-menu-box');
                await menuButton.click();

                const platformBottomMenu = editorPage!.locator('#platformBottomMenu');
                await platformBottomMenu.getByText('スナップショット管理').click();

                const snapshotManager = editorPage!.locator('snapshot-manager');
                const managerContainer = snapshotManager.locator('.container');
                await expect(managerContainer).toBeVisible();

                await snapshotManager.getByRole('button', { name: '新規スナップショット' }).click();

                const saveDialog = editorPage!.locator('snapshot-save-dialog');
                const dialogContent = saveDialog.locator('.dialog');
                await expect(dialogContent).toBeVisible();

                await saveDialog.locator('#snapshot-name').fill(uniqueSnapshotName);
                await saveDialog.locator('#snapshot-description').fill('Test description');
                await saveDialog.getByRole('button', { name: '保存' }).click();

                await expect(saveDialog).toBeHidden();
                await expect(snapshotManager.locator('.snapshot-item', { hasText: uniqueSnapshotName })).toBeVisible();
            });

            await test.step('2. アプリケーションの状態を変更する', async () => {
                await editorPage!.locator('snapshot-manager .close-btn').click();
                await expect(editorPage!.locator('snapshot-manager')).toBeHidden();

                await editorHelper.addPage();
                const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
                await editorHelper.addComponent('ons-button', contentAreaSelector);

                const previewButton = editorHelper.getPreviewElement('ons-button');
                await expect(previewButton).toBeVisible();
            });

            await test.step('3. スナップショットを復元する', async () => {
                const menuButton = editorPage!.locator('#fab-bottom-menu-box');
                await menuButton.click();

                const platformBottomMenu = editorPage!.locator('#platformBottomMenu');
                await platformBottomMenu.getByText('スナップショット管理').click();

                const snapshotManager = editorPage!.locator('snapshot-manager');
                const managerContainer = snapshotManager.locator('.container');
                await expect(managerContainer).toBeVisible();

                const snapshotItem = snapshotManager.locator('.snapshot-item', { hasText: uniqueSnapshotName });
                const restoreButton = snapshotItem.getByRole('button', { name: '復元' });
                await expect(restoreButton).toBeEnabled();

                editorPage!.once('dialog', async confirmDialog => {
                    expect(confirmDialog.message()).toContain('現在の編集内容は破棄され');
                    editorPage!.once('dialog', async alertDialog => {
                        expect(alertDialog.message()).toBe('スナップショットを復元しました。');
                        await alertDialog.dismiss();
                    });
                    await confirmDialog.accept();
                });

                await restoreButton.click({ noWaitAfter: true });

                await expect(snapshotManager).toBeHidden();
            });

            await test.step('4. 状態が復元されたことを確認する', async () => {
                const previewButton = editorHelper.getPreviewElement('ons-button');
                await expect(previewButton).toBeHidden();
            });
        } finally {
            await test.step('クリーンアップ: エディタを閉じる', async () => {
                if (editorPage && !editorPage.isClosed()) {
                    await editorPage.close();
                }
            });
        }
    });
});