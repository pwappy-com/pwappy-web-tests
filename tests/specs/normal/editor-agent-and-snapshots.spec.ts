import { test as base, expect, Page } from '@playwright/test';
import 'dotenv/config';
import {
    createApp,
    deleteApp,
    openEditor,
    setGeminiApiKey,
    deleteGeminiApiKey,
    setAiCoding
} from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';

/**
 * テスト実行ごとに一意の識別子を生成するための定数。
 * ローカル実行時やCI環境でのリソース競合を避けるために使用します。
 */
const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

/**
 * Playwrightのテストフィクスチャを拡張し、各テストで独立したアプリケーション名を提供します。
 */
const test = base.extend<{ appName: string }>({
    appName: async ({ }, use) => {
        // 時刻を逆順にした文字列とサフィックスを組み合わせ、重複しにくいアプリ名を作成
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
        await use(`test-app-${uniqueId}`.slice(0, 30));
    },
});

/**
 * AIエージェント機能およびスナップショット管理機能のE2Eテストスイート。
 * 
 * 注意: .serial を使用しているのは、AI機能の有効化/無効化やAPIキーの設定といった
 * グローバルなダッシュボード設定を操作するため、並列実行による状態の不整合を防ぐためです。
 */
test.describe.serial('AIエージェントとスナップショット機能のテスト', () => {
    // 各テストで作成されるアプリケーションの識別用キーを保持する変数
    let appKey: string;

    /**
     * 各テスト実行前の共通セットアップ処理。
     * 1. 認証Cookieの注入による自動ログイン。
     * 2. ダッシュボードへの遷移確認。
     * 3. テスト用の一意なappKeyの生成。
     */
    test.beforeEach(async ({ page, context }) => {
        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        const domain = testUrl.hostname;

        // 環境変数から認証情報を取得してCookieを設定
        await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/' },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/' },
            { name: 'pwappy_login', value: '1', domain: domain, path: '/' },
        ]);

        // ダッシュボードページへ移動
        await page.goto(String(process.env.PWAPPY_TEST_BASE_URL), { waitUntil: 'domcontentloaded' });

        // ログイン成功（ダッシュボード表示）を確認
        await expect(page.getByRole('heading', { name: 'アプリケーション一覧' })).toBeVisible();

        // 実行ごとにユニークなappKeyを生成
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
        appKey = `test-key-${uniqueId}`.slice(0, 30);
    });

    /**
     * 各テスト実行後のクリーンアップ処理。
     * テストの成否に関わらず、作成したテストアプリを削除します。
     */
    test.afterEach(async ({ page }) => {
        if (appKey) {
            await deleteApp(page, appKey);
        }
    });

    /**
     * ケース1: AI機能有効 且つ Gemini APIキー登録済み の場合
     * AIエージェントが表示され、デフォルトのモデル設定が正しいことを確認します。
     */
    test('AIエージェント機能のUIとデフォルト設定を検証する（APIキー登録済み）', async ({ page, context, isMobile, appName }) => {
        const apiKey = process.env.TEST_GEMINI_API_KEY;
        // APIキーが環境変数にない場合はテストをスキップ
        test.skip(!apiKey, 'TEST_GEMINI_API_KEY is not set. Skipping AI Agent test.');

        let editorPage: Page | null = null;

        try {
            await test.step('セットアップ: AI機能を有効化、APIキーを登録し、アプリを作成してエディタを開く', async () => {
                await setAiCoding(page, true);
                await setGeminiApiKey(page, apiKey!);
                await createApp(page, appName, appKey);
                editorPage = await openEditor(page, context, appName);
            });

            await test.step('1. AIエージェントボタンが表示され、ウィンドウが開くことを確認', async () => {
                // 下部メニューを開く
                const menuButton = editorPage!.locator('#fab-bottom-menu-box');
                await menuButton.click();

                const platformBottomMenu = editorPage!.locator('#platformBottomMenu');
                await expect(platformBottomMenu).toBeVisible();

                // AIエージェントボタンの存在確認とクリック
                const agentButton = platformBottomMenu.getByText('AIエージェント');
                await expect(agentButton).toBeVisible();
                await agentButton.click();

                // チャットウィンドウの表示確認
                const agentWindow = editorPage!.locator('agent-chat-window');
                await expect(agentWindow).toBeVisible();
            });

            await test.step('2. モデル設定モーダル内のデフォルト値を確認', async () => {
                const agentWindow = editorPage!.locator('agent-chat-window');
                await agentWindow.locator('.settings-btn').click();

                const settingsModal = agentWindow.locator('.modal-dialog');
                await expect(settingsModal).toBeVisible();

                // システムデフォルト設定の検証
                await expect(settingsModal.locator('#agent-model-select')).toHaveValue('gemini-flash-latest');
                await expect(settingsModal.locator('#max-history-input')).toHaveValue('20');
                await expect(settingsModal.locator('#max-recovery-input')).toHaveValue('3');

                // モーダルとウィンドウを閉じる
                await settingsModal.getByRole('button', { name: 'キャンセル' }).click();
                await expect(settingsModal).toBeHidden();
                await agentWindow.locator('.close-btn').click();
                await expect(agentWindow).toBeHidden();
            });

        } finally {
            await test.step('クリーンアップ: エディタを閉じ、APIキーを削除し、AI機能を無効化する', async () => {
                if (editorPage && !editorPage.isClosed()) {
                    await editorPage.close();
                }
                await page.bringToFront();
                await deleteGeminiApiKey(page);
                await setAiCoding(page, false);
            });
        }
    });

    /**
     * ケース2: AI機能有効 且つ Gemini APIキー「未登録」の場合
     * 【新規仕様】APIキーが未登録でもAIエージェント機能が表示されることを確認します。
     */
    test('Gemini APIキーが未登録でも、AI機能が有効ならAIエージェントボタンが表示されることを確認する', async ({ page, context, isMobile, appName }) => {
        let editorPage: Page | null = null;

        try {
            await test.step('セットアップ: AI機能を有効化し、APIキーを削除した状態でアプリを作成', async () => {
                await setAiCoding(page, true);
                await deleteGeminiApiKey(page); // APIキーを削除して未登録状態にする
                await createApp(page, appName, appKey);
                editorPage = await openEditor(page, context, appName);
            });

            await test.step('1. メニューを開き、AIエージェントボタンが表示されることを確認', async () => {
                const menuButton = editorPage!.locator('#fab-bottom-menu-box');
                await menuButton.click();

                const platformBottomMenu = editorPage!.locator('#platformBottomMenu');
                await expect(platformBottomMenu).toBeVisible();

                // 【検証ポイント】APIキー未登録でもボタンが表示されること
                const agentButton = platformBottomMenu.getByText('AIエージェント');
                await expect(agentButton).toBeVisible();

                // ウィンドウが開くことも確認
                await agentButton.click();
                const agentWindow = editorPage!.locator('agent-chat-window');
                await expect(agentWindow).toBeVisible();
            });
        } finally {
            await test.step('クリーンアップ: エディタを閉じ、AI機能を無効化する', async () => {
                if (editorPage && !editorPage.isClosed()) {
                    await editorPage.close();
                }
                await page.bringToFront();
                await setAiCoding(page, false);
            });
        }
    });

    /**
     * ケース3: AI機能自体が「無効」の場合
     * APIキーの状態に関わらず、AIエージェントボタンが表示されないことを確認します。
     */
    test('AIコーディング機能が無効の場合、AIエージェントボタンが表示されないことを確認する', async ({ page, context, isMobile, appName }) => {
        let editorPage: Page | null = null;

        try {
            await test.step('セットアップ: AI機能を明示的に無効化してアプリを作成', async () => {
                await setAiCoding(page, false);
                await createApp(page, appName, appKey);
                editorPage = await openEditor(page, context, appName);
            });

            await test.step('1. メニューを開き、AIエージェントボタンが非表示であることを確認', async () => {
                const menuButton = editorPage!.locator('#fab-bottom-menu-box');
                await menuButton.click();

                const platformBottomMenu = editorPage!.locator('#platformBottomMenu');
                await expect(platformBottomMenu).toBeVisible();

                // 【検証ポイント】AI機能が無効ならボタンは隠れていること
                const agentButton = platformBottomMenu.getByText('AIエージェント');
                await expect(agentButton).toBeHidden();
            });
        } finally {
            await test.step('クリーンアップ: エディタを閉じる', async () => {
                if (editorPage && !editorPage.isClosed()) {
                    await editorPage.close();
                }
                await page.bringToFront();
            });
        }
    });

    /**
     * 補足テスト: スナップショット管理機能のライフサイクルテスト。
     * 作成 -> 変更 -> 復元 のフローを検証します。
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

            await test.step('1. 新しいスナップショットを保存', async () => {
                const menuButton = editorPage!.locator('#fab-bottom-menu-box');
                await menuButton.click();

                const platformBottomMenu = editorPage!.locator('#platformBottomMenu');
                await platformBottomMenu.getByText('スナップショット管理').click();

                const snapshotManager = editorPage!.locator('snapshot-manager');
                await expect(snapshotManager.locator('.container')).toBeVisible();

                await snapshotManager.getByRole('button', { name: '新規スナップショット' }).click();

                const saveDialog = editorPage!.locator('snapshot-save-dialog');
                await saveDialog.locator('#snapshot-name').fill(uniqueSnapshotName);
                await saveDialog.locator('#snapshot-description').fill('E2E Test Snapshot');
                await saveDialog.getByRole('button', { name: '保存' }).click();

                await expect(saveDialog).toBeHidden();
                await expect(snapshotManager.locator('.snapshot-item', { hasText: uniqueSnapshotName })).toBeVisible();

                // 管理画面を一度閉じる
                await snapshotManager.locator('.close-btn').click();
            });

            await test.step('2. アプリケーションを編集（ボタンを追加）', async () => {
                await editorHelper.addPage();
                const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
                await editorHelper.addComponent('ons-button', contentAreaSelector);

                // プレビュー上にボタンが存在することを確認
                const previewButton = editorHelper.getPreviewElement('ons-button');
                await expect(previewButton).toBeVisible();
            });

            await test.step('3. スナップショットから復元を実行', async () => {
                const menuButton = editorPage!.locator('#fab-bottom-menu-box');
                await menuButton.click();
                await editorPage!.locator('#platformBottomMenu').getByText('スナップショット管理').click();

                const snapshotManager = editorPage!.locator('snapshot-manager');
                const snapshotItem = snapshotManager.locator('.snapshot-item', { hasText: uniqueSnapshotName });
                const restoreButton = snapshotItem.getByRole('button', { name: '復元' });

                // ダイアログハンドリングの準備（確認ダイアログと完了アラート）
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

            await test.step('4. 復元後の状態確認（追加したボタンが消えていること）', async () => {
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