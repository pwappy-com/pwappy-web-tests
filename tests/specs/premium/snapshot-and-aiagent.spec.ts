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
 * Playwrightのテストフィクスチャを拡張。
 * 各テストでユニークなアプリケーション名を提供します。
 */
const test = base.extend<{ appName: string }>({
    appName: async ({ }, use) => {
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
        await use(`ai-snap-test-app-${uniqueId}`.slice(0, 30));
    },
});

/**
 * AIエージェント機能およびスナップショット管理機能の統合テストスイート。
 * 
 * 重要: 
 * AI機能の有効化/無効化やAPIキーの設定はダッシュボード上のグローバルな設定を操作するため、
 * 「設定変更の完了後にエディタを開く」という順序を厳守する必要があります。
 * また、並列実行による状態の不整合を防ぐため .serial を使用します。
 */
test.describe.serial('AIエージェントとスナップショット機能の統合テスト', () => {
    let appKey: string;

    /**
     * 各テスト実行前の共通セットアップ処理。
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
        appKey = `ai-snap-key-${uniqueId}`.slice(0, 30);
    });

    /**
     * 各テスト実行後のクリーンアップ処理。
     */
    test.afterEach(async ({ page }) => {
        if (appKey) {
            await deleteApp(page, appKey);
        }
        // AI設定を無効に戻しておく（他のテストへの影響を防ぐ）
        await setAiCoding(page, false);
    });

    /**
     * ケース1: AI機能有効 且つ Gemini APIキー登録済み の場合
     * AIエージェントが表示され、デフォルトのモデル設定が正しいことを確認します。
     */
    test('AIエージェント機能のUIとデフォルト設定を検証する（APIキー登録済み）', async ({ page, context, appName, isMobile }) => {
        const apiKey = process.env.TEST_GEMINI_API_KEY;
        test.skip(!apiKey, 'TEST_GEMINI_API_KEY is not set. Skipping AI Agent test.');

        let editorPage: Page;

        await test.step('1. 設定変更：AI機能を有効化しAPIキーを登録', async () => {
            await setAiCoding(page, true);
            await setGeminiApiKey(page, apiKey!);
        });

        await test.step('2. アプリ作成とエディタ起動', async () => {
            await createApp(page, appName, appKey);
            editorPage = await openEditor(page, context, appName);
        });

        try {
            await test.step('3. AIエージェントボタンが表示され、ウィンドウが開くことを確認', async () => {
                const menuButton = editorPage.locator('#fab-bottom-menu-box');
                await menuButton.click();

                const platformBottomMenu = editorPage.locator('#platformBottomMenu');
                await expect(platformBottomMenu).toBeVisible();

                const agentButton = platformBottomMenu.getByText('AIエージェント');
                await expect(agentButton).toBeVisible();
                await agentButton.click();

                const agentWindow = editorPage.locator('agent-chat-window');
                await expect(agentWindow).toBeVisible();
            });

            await test.step('4. モデル設定モーダル内のデフォルト値を確認', async () => {
                const agentWindow = editorPage.locator('agent-chat-window');
                await agentWindow.locator('.settings-btn').click();

                const settingsModal = agentWindow.locator('.modal-dialog');
                await expect(settingsModal).toBeVisible();

                await expect(settingsModal.locator('#agent-model-select')).toHaveValue('gemini-flash-latest');
                await expect(settingsModal.locator('#max-history-input')).toHaveValue('20');
                await expect(settingsModal.locator('#max-recovery-input')).toHaveValue('3');

                await settingsModal.getByRole('button', { name: 'キャンセル' }).click();
            });
        } finally {
            await editorPage!.close();
            await page.bringToFront();
            await deleteGeminiApiKey(page);
        }
    });

    /**
     * ケース2: AI機能有効 且つ Gemini APIキー「未登録」の場合
     * APIキーが未登録でもAIエージェントボタンが表示されることを確認します。
     */
    test('Gemini APIキーが未登録でも、AI機能が有効ならAIエージェントボタンが表示されることを確認する', async ({ page, context, appName, isMobile }) => {
        let editorPage: Page;

        await test.step('1. 設定変更：AI機能を有効化しAPIキーを削除', async () => {
            await setAiCoding(page, true);
            await deleteGeminiApiKey(page);
        });

        await test.step('2. アプリ作成とエディタ起動', async () => {
            await createApp(page, appName, appKey);
            editorPage = await openEditor(page, context, appName);
        });

        try {
            await test.step('3. メニューを開き、AIエージェントボタンが表示されることを確認', async () => {
                const menuButton = editorPage.locator('#fab-bottom-menu-box');
                await menuButton.click();

                const platformBottomMenu = editorPage.locator('#platformBottomMenu');
                await expect(platformBottomMenu).toBeVisible();

                const agentButton = platformBottomMenu.getByText('AIエージェント');
                await expect(agentButton).toBeVisible();

                await agentButton.click();
                const agentWindow = editorPage.locator('agent-chat-window');
                await expect(agentWindow).toBeVisible();
            });
        } finally {
            await editorPage!.close();
            await page.bringToFront();
        }
    });

    /**
     * ケース3: AI機能自体が「無効」の場合
     * APIキーの状態に関わらず、AIエージェントボタンが表示されないことを確認します。
     */
    test('AIコーディング機能が無効の場合、AIエージェントボタンが表示されないことを確認する', async ({ page, context, appName, isMobile }) => {
        let editorPage: Page;

        await test.step('1. 設定変更：AI機能を明示的に無効化', async () => {
            await setAiCoding(page, false);
        });

        await test.step('2. アプリ作成とエディタ起動', async () => {
            await createApp(page, appName, appKey);
            editorPage = await openEditor(page, context, appName);
        });

        try {
            await test.step('3. メニューを開き、AIエージェントボタンが非表示であることを確認', async () => {
                const menuButton = editorPage.locator('#fab-bottom-menu-box');
                await menuButton.click();

                const platformBottomMenu = editorPage.locator('#platformBottomMenu');
                await expect(platformBottomMenu).toBeVisible();

                const agentButton = platformBottomMenu.getByText('AIエージェント');
                await expect(agentButton).toBeHidden();
            });
        } finally {
            await editorPage!.close();
            await page.bringToFront();
        }
    });

    /**
     * ケース4: スナップショットとAIエージェントの組み合わせテスト
     * 手動スナップショットを作成し、要素の削除後に復元できるか検証します。
     */
    test('手動スナップショット：破壊的な変更をスナップショットで元に戻す（AIエージェント連携）', async ({ page, context, appName, isMobile }) => {
        test.setTimeout(150000);

        await test.step('1. 設定変更：AI機能を有効化', async () => {
            await setAiCoding(page, true);
        });

        await test.step('2. アプリ作成とエディタ起動', async () => {
            await createApp(page, appName, appKey);
        });

        const editorPage = await openEditor(page, context, appName);
        const editorHelper = new EditorHelper(editorPage, isMobile);

        const snapshotName = '破壊的前のスナップショット';
        let pageId: string;

        try {
            await test.step('3. 正常な状態で手動スナップショットを作成', async () => {
                const setUp = await editorHelper.setupPageWithButton();
                pageId = await setUp.pageNode.getAttribute('data-node-id') as string;

                await editorPage.locator('#fab-bottom-menu-box').click();
                await editorPage.locator('#platformBottomMenu').getByText('AIエージェント').click();
                const agentWindow = editorPage.locator('agent-chat-window');
                await expect(agentWindow).toBeVisible();

                await agentWindow.locator('button[title="添付"]').click();
                await agentWindow.locator('.attachment-menu button', { hasText: 'スナップショット保存' }).click();

                const modal = agentWindow.locator('.modal-dialog');
                await expect(modal).toBeVisible();
                await modal.locator('#snapshot-name').fill(snapshotName);
                await modal.getByRole('button', { name: '作成' }).click();

                const snapshotItem = agentWindow.locator(`.snapshot-body:has-text("${snapshotName}")`);
                await expect(snapshotItem).toBeVisible({ timeout: 30000 });

                await agentWindow.locator('.close-btn').click();
            });

            await test.step('4. 破壊的な変更を加える（要素の削除）', async () => {
                const domTree = editorHelper.getDomTree();
                const buttonNode = domTree.locator('.node[data-node-type="ons-button"]').first();

                await buttonNode.locator('.clear-icon').click();
                await buttonNode.locator('.clear-icon').click();

                await expect(buttonNode).toBeHidden();
            });

            await test.step('5. スナップショット管理画面から復元を実行', async () => {
                await editorPage.locator('#fab-bottom-menu-box').click();
                await editorPage.locator('#platformBottomMenu').getByText('スナップショット管理').click();

                const manager = editorPage.locator('snapshot-manager');
                const item = manager.locator('.snapshot-item', { hasText: snapshotName });
                await expect(item).toBeVisible();

                editorPage.once('dialog', dialog => dialog.accept());
                await item.getByRole('button', { name: '復元' }).click();
            });

            await test.step('6. 削除した要素が復活していることを確認', async () => {
                await editorHelper.switchTopLevelTemplate(pageId);
                const domTree = editorHelper.getDomTree();
                await expect(domTree.locator('.node[data-node-type="ons-button"]')).toBeVisible();
            });
        } finally {
            await editorPage.close();
            await page.bringToFront();
        }
    });
});