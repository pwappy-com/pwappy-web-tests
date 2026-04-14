import { test as base, expect, Page } from '@playwright/test';
import 'dotenv/config';
import {
    createApp,
    deleteApp,
    openEditor,
    setGeminiApiKey,
    deleteGeminiApiKey,
    setAiCoding,
    gotoDashboard
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
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        await use(`ai-snap-test-app-${uniqueId}`.slice(0, 30));
    },
});

test.describe.configure({ mode: 'serial' });

/**
 * AIエージェント機能およびスナップショット管理機能の統合テストスイート。
 * 
 * 重要: 
 * AI機能の有効化/無効化やAPIキーの設定はダッシュボード上のグローバルな設定を操作するため、
 * 「設定変更の完了後にエディタを開く」という順序を厳守する必要があります。
 */
test.describe('AIエージェントとスナップショット機能の統合テスト', () => {
    let appKey: string;

    /**
     * 各テスト実行前の共通セットアップ処理。
     */
    test.beforeEach(async ({ page, context }) => {
        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        var domain = testUrl.hostname;
        if (domain !== 'localhost') {
            domain = '.' + domain;
        }
        // 先にクッキーを削除
        await context.clearCookies();
        await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 },
            { name: 'pwappy_login', value: process.env.PWAPPY_LOGIN!, domain: domain, path: '/', secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 },
        ]);

        // ダッシュボードページへ移動
        await gotoDashboard(page);

        // ログイン成功（ダッシュボード表示）を確認
        await expect(page.getByRole('heading', { name: 'アプリケーション一覧' })).toBeVisible();

        // 実行ごとにユニークなappKeyを生成
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
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
            await page.reload({ waitUntil: 'domcontentloaded' });
        });

        await test.step('2. アプリ作成とエディタ起動', async () => {
            await createApp(page, appName, appKey);
            editorPage = await openEditor(page, context, appName);
        });

        try {
            await test.step('3. AIエージェントボタンが表示され、ウィンドウが開くことを確認', async () => {
                console.log('[DEBUG] Case 1: Opening AI Agent window...');
                await expect(async () => {
                    await editorPage.locator('#fab-bottom-menu-box').evaluate((el: HTMLElement) => el.click());
                    const bottomMenu = editorPage.locator('#platformBottomMenu');
                    await expect(bottomMenu).toBeVisible({ timeout: 2000 });

                    const agentButton = bottomMenu.getByText('AIエージェント');
                    await expect(agentButton).toBeVisible({ timeout: 2000 });
                    await agentButton.evaluate((el: HTMLElement) => el.click());

                    const agentWindow = editorPage.locator('agent-chat-window');
                    await expect(agentWindow).toBeVisible({ timeout: 2000 });
                }).toPass({ timeout: 15000, intervals: [1000] });
            });

            await test.step('4. モデル設定モーダル内のデフォルト値を確認', async () => {
                const agentWindow = editorPage.locator('agent-chat-window');
                await agentWindow.locator('.settings-btn').evaluate((el: HTMLElement) => el.click());

                const settingsModal = agentWindow.locator('.modal-dialog');
                await expect(settingsModal).toBeVisible();

                await expect(settingsModal.locator('#agent-model-select')).toHaveValue('gemini-flash-latest');
                await expect(settingsModal.locator('#max-history-input')).toHaveValue('20');
                await expect(settingsModal.locator('#max-recovery-input')).toHaveValue('3');

                // getByRoleでのタイムアウトを防ぐため、ロケータを簡素化して確実なクリックを行う
                await settingsModal.locator('button', { hasText: 'キャンセル' }).evaluate((el: HTMLElement) => el.click());
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
            await page.reload({ waitUntil: 'domcontentloaded' });
        });

        await test.step('2. アプリ作成とエディタ起動', async () => {
            await createApp(page, appName, appKey);
            editorPage = await openEditor(page, context, appName);
        });

        try {
            await test.step('3. メニューを開き、AIエージェントボタンが表示されることを確認', async () => {
                console.log('[DEBUG] Case 2: Opening AI Agent window...');
                await expect(async () => {
                    await editorPage.locator('#fab-bottom-menu-box').evaluate((el: HTMLElement) => el.click());
                    const bottomMenu = editorPage.locator('#platformBottomMenu');
                    await expect(bottomMenu).toBeVisible({ timeout: 2000 });

                    const agentButton = bottomMenu.getByText('AIエージェント');
                    await expect(agentButton).toBeVisible({ timeout: 2000 });
                    await agentButton.evaluate((el: HTMLElement) => el.click());

                    const agentWindow = editorPage.locator('agent-chat-window');
                    await expect(agentWindow).toBeVisible({ timeout: 2000 });
                }).toPass({ timeout: 15000, intervals: [1000] });
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
            await page.reload({ waitUntil: 'domcontentloaded' });
        });

        await test.step('2. アプリ作成とエディタ起動', async () => {
            await createApp(page, appName, appKey);
            editorPage = await openEditor(page, context, appName);
        });

        try {
            await test.step('3. メニューを開き、AIエージェントボタンが非表示であることを確認', async () => {
                console.log('[DEBUG] Case 3: Checking AI Agent button is hidden...');
                await expect(async () => {
                    await editorPage.locator('#fab-bottom-menu-box').evaluate((el: HTMLElement) => el.click());
                    const bottomMenu = editorPage.locator('#platformBottomMenu');
                    await expect(bottomMenu).toBeVisible({ timeout: 2000 });

                    const agentButton = bottomMenu.getByText('AIエージェント');
                    await expect(agentButton).toBeHidden({ timeout: 2000 });
                }).toPass({ timeout: 15000, intervals: [1000] });
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
        test.setTimeout(180000);

        await test.step('1. 設定変更：AI機能を有効化', async () => {
            await setAiCoding(page, true);
            await page.reload({ waitUntil: 'domcontentloaded' });
        });

        await test.step('2. アプリ作成とエディタ起動', async () => {
            await createApp(page, appName, appKey);
        });

        const editorPage = await openEditor(page, context, appName);
        editorPage.on('console', msg => console.log(`[Editor Console] ${msg.type()}: ${msg.text()}`));

        // CI環境等での画像生成フリーズを防ぐため、アプリ側にフラグを立てる
        await editorPage.evaluate(() => { (window as any).__DISABLE_SCREENSHOT__ = true; });

        const editorHelper = new EditorHelper(editorPage, isMobile);

        const snapshotName = '破壊的前のスナップショット';
        let pageId: string;

        try {
            await test.step('3. 正常な状態で手動スナップショットを作成', async () => {
                const setUp = await editorHelper.setupPageWithButton();
                pageId = await setUp.pageNode.getAttribute('data-node-id') as string;

                await editorHelper.closeMoveingHandle();

                // メニュー展開とエージェントウィンドウ表示をリトライ付きで確実に行う
                console.log('[DEBUG] snapshot: Opening AI Agent window...');
                await expect(async () => {
                    const agentWindow = editorPage.locator('agent-chat-window');

                    // 既に開いていれば何もしないで抜ける
                    if (await agentWindow.isVisible().catch(() => false)) {
                        return;
                    }

                    const bottomMenu = editorPage.locator('#platformBottomMenu');
                    // メニューが開いていなければ開く
                    if (!(await bottomMenu.isVisible().catch(() => false))) {
                        await editorPage.locator('#fab-bottom-menu-box').evaluate((el: HTMLElement) => el.click());
                        await expect(bottomMenu).toBeVisible({ timeout: 2000 });
                    }

                    await bottomMenu.getByText('AIエージェント').evaluate((el: HTMLElement) => el.click());
                    await expect(agentWindow).toBeVisible({ timeout: 2000 });
                }).toPass({ timeout: 15000, intervals: [1000] });

                await editorPage.waitForTimeout(1000); // ウィンドウが安定するのを待つ
                
                const agentWindow = editorPage.locator('agent-chat-window');

                await agentWindow.locator('button[title="添付"]').evaluate((el: HTMLElement) => el.click());
                await editorPage.waitForTimeout(500); // メニューが開くのを待つ
                await agentWindow.locator('.attachment-menu button', { hasText: 'スナップショット保存' }).evaluate((el: HTMLElement) => el.click());

                await editorPage.waitForTimeout(1000); // モーダルが開くのを待つ
                const modal = agentWindow.locator('.modal-dialog');
                await expect(modal).toBeVisible();
                await modal.locator('#snapshot-name').fill(snapshotName);

                console.log('[DEBUG] snapshot: Clicking create button in modal...');
                await editorPage.waitForTimeout(500);
                const createBtn = modal.locator('button', { hasText: '作成' });
                await createBtn.evaluate((el: HTMLElement) => el.click()).catch(() => createBtn.click({ force: true }));

                const snapshotItem = agentWindow.locator(`.snapshot-body:has-text("${snapshotName}")`);
                await expect(snapshotItem).toBeVisible({ timeout: 45000 });

                await agentWindow.locator('.close-btn').evaluate((el: HTMLElement) => el.click());
                await expect(agentWindow).toBeHidden({ timeout: 5000 });
            });

            await test.step('4. 破壊的な変更を加える（要素の削除）', async () => {
                await editorHelper.openMoveingHandle('left');
                const domTree = editorHelper.getDomTree();
                const buttonNode = domTree.locator('.node[data-node-type="ons-button"]').first();

                await buttonNode.locator('.clear-icon').click();
                await buttonNode.locator('.clear-icon').click();

                await expect(buttonNode).toBeHidden();
            });

            await test.step('5. スナップショット管理画面から復元を実行', async () => {
                await editorHelper.closeMoveingHandle();

                // スナップショット管理画面の展開も確実に行う
                console.log('[DEBUG] snapshot: Opening Snapshot Manager...');
                await expect(async () => {
                    const manager = editorPage.locator('snapshot-manager');
                    // Playwrightの判定回避のため、ShadowDOM内部の実体コンテナで可視性をチェック
                    const managerContainer = manager.locator('.container');

                    if (await managerContainer.isVisible().catch(() => false)) {
                        return;
                    }

                    const bottomMenu = editorPage.locator('#platformBottomMenu');
                    if (!(await bottomMenu.isVisible().catch(() => false))) {
                        await editorPage.locator('#fab-bottom-menu-box').evaluate((el: HTMLElement) => el.click());
                        await expect(bottomMenu).toBeVisible({ timeout: 2000 });
                    }

                    await bottomMenu.getByText('スナップショット管理').evaluate((el: HTMLElement) => el.click());
                    await expect(managerContainer).toBeVisible({ timeout: 2000 });
                }).toPass({ timeout: 15000, intervals: [1000] });

                const manager = editorPage.locator('snapshot-manager');
                const item = manager.locator('.snapshot-item', { hasText: snapshotName });
                await expect(item).toBeVisible({ timeout: 10000 });

                let alertDismissed = false;
                const dialogHandler = async (dialog: any) => {
                    const msg = dialog.message();
                    console.log(`[DEBUG] dialog event: ${dialog.type()} - ${msg}`);
                    if (msg.includes('現在の編集内容は破棄され')) {
                        await dialog.accept(); // confirm を承認
                    } else if (msg.includes('復元しました')) {
                        alertDismissed = true;
                        await dialog.accept(); // alert を閉じる
                    } else {
                        await dialog.accept();
                    }
                };

                editorPage.on('dialog', dialogHandler);

                try {
                    console.log('[DEBUG] snapshot: Clicking restore button...');
                    const restoreBtn = item.getByRole('button', { name: '復元' });
                    // インターセプトを防ぐために evaluate を使用
                    await restoreBtn.evaluate((node: HTMLElement) => node.click());

                    await expect(manager.locator('.container')).toBeHidden({ timeout: 15000 });

                    // アラートが表示・処理されたことを確認
                    await expect.poll(() => alertDismissed, { timeout: 10000 }).toBeTruthy();

                } finally {
                    editorPage.off('dialog', dialogHandler);
                }
            });

            await test.step('6. 削除した要素が復活していることを確認', async () => {
                await editorHelper.switchTopLevelTemplate(pageId);
                const domTree = editorHelper.getDomTree();
                await expect(domTree.locator('.node[data-node-type="ons-button"]')).toBeVisible();
            });
        } finally {
            console.log('[DEBUG] snapshot-and-aiagent: finally block started. Closing editorPage...');
            try {
                await editorPage.close();
                console.log('[DEBUG] snapshot-and-aiagent: editorPage closed successfully. Bringing dashboard page to front...');
                await page.bringToFront();
                console.log('[DEBUG] snapshot-and-aiagent: bringToFront completed.');
            } catch (e) {
                console.error('[DEBUG ERROR] snapshot-and-aiagent: Error in finally block:', e);
            }
        }
    });
});