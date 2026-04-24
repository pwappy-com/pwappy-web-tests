import { test as base, expect, Page } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor, setAiCoding } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

type EditorFixtures = {
    editorPage: Page;
    appName: string;
    editorHelper: EditorHelper;
};

const test = base.extend<EditorFixtures>({
    appName: async ({ }, use) => {
        const workerIndex = test.info().workerIndex;
        const uniqueId = `${testRunSuffix}-${workerIndex}-${Date.now()}`;
        await use(`agent-protect-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName }, use) => {
        await gotoDashboard(page);
        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });

        try {
            await setAiCoding(page, true);
        } catch (e) {
            console.warn('[Warning] setAiCoding failed/timed out, continuing test...', e);
        }

        const appKey = `protect-key-${Date.now().toString().slice(-6)}`;
        await createApp(page, appName, appKey);
        const editorPage = await openEditor(page, context, appName);
        await use(editorPage);
        await editorPage.close();
        await page.bringToFront();
        await deleteApp(page, appKey);
    },
    editorHelper: async ({ editorPage, isMobile }, use) => {
        const helper = new EditorHelper(editorPage, isMobile);
        await use(helper);
    },
});

test.describe('AIエージェント：エラーリカバリと保護機能（ロック）の検証', () => {

    test('修復不能なJSONの連続受信時、リトライ上限で停止し手動修正から再開できる', async ({ editorPage, editorHelper }) => {
        let isProcessing1 = false;
        await editorPage.route(/.*agent.*/, async route => {
            const request = route.request();
            if (request.method() === 'POST') {
                isProcessing1 = true;
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ code: 200, details: { ticket: 'mock-ticket-1' } })
                });
            } else if (request.method() === 'GET') {
                if (!isProcessing1) {
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({ code: 200, details: { aiAgentRequests: [] } })
                    });
                    return;
                }
                // 即座に完了状態かつ不正なJSONを返却し、ポーリング待機時間をカットする
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        code: 200,
                        details: { aiAgentRequests: [{ status: "completed", responsePayload: `THIS IS NOT A JSON AT ALL. SYSTEM MUST FAIL.` }] }
                    })
                });
            } else {
                await route.continue();
            }
        });

        await test.step('1. AIにリクエストを送信', async () => {
            await editorHelper.closeMoveingHandle();
            // console.log('[DEBUG] agent-protection: Opening bottom menu...');
            await editorPage.locator('#fab-bottom-menu-box').click({ force: true });

            const bottomMenu = editorPage.locator('#platformBottomMenu');
            await expect(bottomMenu).toBeVisible({ timeout: 10000 });

            // console.log('[DEBUG] agent-protection: Clicking AI Agent button...');
            await bottomMenu.getByText('AIエージェント').click({ force: true });
            const userInput = editorPage.locator('agent-chat-window textarea.user-input');
            await expect(userInput).toBeEditable();
            await userInput.fill('テスト');
            await editorPage.locator('agent-chat-window #send-button').click({ force: true });
        });

        await test.step('2. リトライ上限到達と手動修正モードへの移行を確認', async () => {
            const agentWindow = editorPage.locator('agent-chat-window');
            // 高速にループが回るため、タイムアウトを20秒程度に短縮しても十分間に合う
            await expect(agentWindow.getByText('構築エラーが発生しました')).toBeVisible({ timeout: 20000 });
            await expect(agentWindow.getByText('自動修復の試行回数が')).toBeVisible();
            const manualButton = editorPage.getByRole('button', { name: ' 手動' });
            await manualButton.click();
            await expect(manualButton).toBeFocused();
            await agentWindow.getByRole('button', { name: 'AIに修正を依頼する' }).click({ force: true });
        });

        await test.step('3. 正しいJSONを手動で入力して続行し、正常に反映されるか確認', async () => {

            await editorPage.unroute(/.*agent.*/);
            const validJson = JSON.stringify({
                blueprint: {
                    pages: [{ template_id: "manual-home.html", content: "<ons-page id='manual-page' explain='手動修正ページ'></ons-page>" }]
                },
                thought: "手動で修正しました。"
            }, null, 2);

            const responseInput = editorPage.locator('agent-chat-window #manual-response-input');
            await expect(responseInput).toBeEditable();
            await responseInput.fill(validJson);
            await editorPage.locator('agent-chat-window').getByRole('button', { name: '処理を続行' }).click({ force: true });

            // 重要：反映完了のログが出るのを待つ
            await expect(editorPage.locator('agent-chat-window').getByText('システム構成を更新しました')).toBeVisible({ timeout: 20000 });
            await editorPage.locator('agent-chat-window .close-btn').click({ force: true });

            // 適用されたページが表示されるよう、トップレベルテンプレートを切り替える
            await editorHelper.openMoveingHandle('left');
            const templateContainer = editorPage.locator('template-container');

            // リスト表示のポーリングを強化
            await expect(async () => {
                const selectBox = templateContainer.locator('.select');
                await selectBox.click({ force: true });
                await expect(templateContainer.locator('#top-template-list')).toBeVisible({ timeout: 2000 });
            }).toPass({ timeout: 15000 });

            // アイテムを確実にクリック
            const listItem = templateContainer.locator('.top-template-item', { hasText: '手動修正ページ' });
            await listItem.scrollIntoViewIfNeeded();
            await listItem.click({ force: true });

            const domTree = editorPage.locator('#dom-tree');
            await expect(domTree.locator('.label-explain').filter({ hasText: /^手動修正ページ$/ }).first()).toBeVisible({ timeout: 15000 });
        });
    });

    test('実行時エラー（Syntax Error）の自動検知とエラー状態の維持', async ({ editorPage, editorHelper }) => {
        const { buttonNode } = await editorHelper.setupPageWithButton();
        await editorHelper.openMoveingHandle('right');
        const scriptContainer = editorPage.locator('script-container');
        await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
        await editorHelper.addNewScript('goodScript');

        let isProcessing2 = false;
        await editorPage.route(/.+\/ai-.+/, async route => {
            const request = route.request();
            if (request.method() === 'POST') {
                isProcessing2 = true;
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ code: 200, details: { ticket: 'mock-ticket-2' } })
                });
            } else if (request.method() === 'GET') {
                if (!isProcessing2) {
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({ code: 200, details: { aiAgentRequests: [] } })
                    });
                    return;
                }
                // 即座に完了状態を返す
                const mockPayload = JSON.stringify({
                    blueprint: {
                        scripts: [{
                            name: "badScript",
                            // スクリプト追加時の即時評価で確実にSyntaxErrorを発生させるための不正な構文
                            content: "function badScript() { \n const a = ; // SyntaxError \n }",
                            description: "バグ"
                        }]
                    },
                    thought: "バグ入り追加"
                });
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        code: 200,
                        details: { aiAgentRequests: [{ status: "completed", responsePayload: mockPayload }] }
                    })
                });
            } else {
                await route.continue();
            }
        });

        await test.step('1. バグ入りスクリプトをAIに生成させる', async () => {
            await editorHelper.closeMoveingHandle();
            // console.log('[DEBUG] agent-protection: Opening bottom menu...');
            await editorPage.locator('#fab-bottom-menu-box').click({ force: true });

            const bottomMenu = editorPage.locator('#platformBottomMenu');
            await expect(bottomMenu).toBeVisible({ timeout: 10000 });

            // console.log('[DEBUG] agent-protection: Clicking AI Agent button...');
            await bottomMenu.getByText('AIエージェント').click({ force: true });
            const userInput = editorPage.locator('agent-chat-window textarea.user-input');
            await expect(userInput).toBeEditable();
            await userInput.fill('バグを作って');
            await editorPage.locator('agent-chat-window #send-button').click({ force: true });
        });

        await test.step('2. 実行時エラーがフックされ、構築エラーUIが出ることを確認', async () => {
            const agentWindow = editorPage.locator('agent-chat-window');
            await expect(agentWindow.getByText('構築エラーが発生しました')).toBeVisible({ timeout: 20000 });
            await expect(agentWindow.locator('.message-agent').filter({ hasText: 'SyntaxError' })).toBeVisible();
        });

        await test.step('3. エラー状態が維持されることの検証（バグ入りデータが残っていること）', async () => {
            const agentWindow = editorPage.locator('agent-chat-window');
            await agentWindow.locator('.close-btn').click({ force: true });

            await editorHelper.openMoveingHandle('right');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            // 新仕様では自動ロールバックされず、エラーの原因となった badScript がそのまま残る
            await expect(scriptContainer.locator('.editor-row', { hasText: 'badScript' })).toBeVisible();
            await expect(scriptContainer.locator('.editor-row', { hasText: 'goodScript' })).toBeVisible();
        });
    });

    test('保護機能（ロック）：AIによる削除・上書き命令のシステム的ブロック', async ({ editorPage, editorHelper }) => {
        const targetPageName = '保護対象ページ';
        const targetScriptName = 'lockedScript';

        await test.step('1. ページとスクリプトを作成し、アプリ設定からロックする', async () => {
            const pageNode = await editorHelper.addPage();
            await editorHelper.selectNodeInDomTree(pageNode);
            await editorHelper.openMoveingHandle('right');
            const explainInput = editorHelper.getPropertyInput('explain').locator('input');
            await expect(explainInput).toBeEditable();
            await explainInput.fill(targetPageName);
            await explainInput.press('Enter');

            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await editorHelper.addNewScript(targetScriptName);

            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, 'アプリ設定');
            const appSettingContainer = editorPage.locator('appsetting-container');

            const pageRow = appSettingContainer.locator('tr', { hasText: targetPageName });
            await pageRow.scrollIntoViewIfNeeded();
            await pageRow.locator('.lock-btn').click({ force: true });
            await expect(pageRow.locator('.lock-btn')).toHaveClass(/locked/);

            const scriptRow = appSettingContainer.locator('tr', { hasText: targetScriptName });
            await scriptRow.scrollIntoViewIfNeeded();
            await scriptRow.locator('.lock-btn').click({ force: true });
            await expect(scriptRow.locator('.lock-btn')).toHaveClass(/locked/);
        });

        await test.step('2. AIにロック対象の削除と上書きを命じる', async () => {
            let isProcessing3 = false;
            await editorPage.route(/.*agent.*/, async route => {
                const request = route.request();
                if (request.method() === 'POST') {
                    isProcessing3 = true;
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({ code: 200, details: { ticket: 'mock-ticket-3' } })
                    });
                } else if (request.method() === 'GET') {
                    if (!isProcessing3) {
                        await route.fulfill({
                            status: 200,
                            contentType: 'application/json',
                            body: JSON.stringify({ code: 200, details: { aiAgentRequests: [] } })
                        });
                        return;
                    }
                    // 即座に完了状態を返す
                    const mockPayload = JSON.stringify({
                        blueprint: {
                            deleted_items: { pages: ["application", "home.html", "page2.html"] },
                            scripts: [{ name: targetScriptName, content: "function lockedScript() { console.log('Hacked!'); }", description: "Hacked" }]
                        },
                        thought: "削除と上書き"
                    });
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            code: 200,
                            details: { aiAgentRequests: [{ status: "completed", responsePayload: mockPayload }] }
                        })
                    });
                } else {
                    await route.continue();
                }
            });

            await editorHelper.closeMoveingHandle();

            // console.log('[DEBUG] agent-protection: Opening AI Agent window...');
            await expect(async () => {
                await editorPage.locator('#fab-bottom-menu-box').click({ force: true });
                const bottomMenu = editorPage.locator('#platformBottomMenu');
                await expect(bottomMenu).toBeVisible({ timeout: 2000 });
                await bottomMenu.getByText('AIエージェント').click({ force: true });
                const agentWindow = editorPage.locator('agent-chat-window');
                await expect(agentWindow).toBeVisible({ timeout: 2000 });
            }).toPass({ timeout: 15000, intervals: [1000] });

            const userInput = editorPage.locator('agent-chat-window textarea.user-input');
            await expect(userInput).toBeEditable();
            await userInput.fill('命令');
            await editorPage.locator('agent-chat-window #send-button').click({ force: true });

            await expect(editorPage.locator('agent-chat-window').getByText('システム構成を更新しました')).toBeVisible({ timeout: 20000 });
            await editorPage.locator('agent-chat-window .close-btn').click({ force: true });
        });

        await test.step('3. ロックされたリソースが守られているか検証', async () => {
            await editorHelper.openMoveingHandle('left');
            const domTree = editorPage.locator('#dom-tree');
            await expect(domTree.locator('.label-explain').filter({ hasText: new RegExp(`^${targetPageName}$`) }).first()).toBeVisible();

            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await editorHelper.openScriptForEditing(targetScriptName);

            const editorContent = await editorHelper.getMonacoEditorContent();
            expect(editorContent).not.toContain("Hacked!");
        });
    });
});