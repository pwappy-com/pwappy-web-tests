import { test as base, expect, Page } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, openEditor, setAiCoding } from '../../tools/dashboard-helpers';
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
        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        const domain = testUrl.hostname;
        await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/' },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/' },
            { name: 'pwappy_login', value: '1', domain: domain, path: '/' },
        ]);
        await page.goto(String(process.env.PWAPPY_TEST_BASE_URL), { waitUntil: 'domcontentloaded' });
        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });
        await setAiCoding(page, true);

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
        await editorPage.route('**/ai-agent', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    code: 200,
                    details: { text: `THIS IS NOT A JSON AT ALL. SYSTEM MUST FAIL.` }
                })
            });
        });

        await test.step('1. AIにリクエストを送信', async () => {
            await editorHelper.closeMoveingHandle();
            await editorPage.locator('#fab-bottom-menu-box').click({ force: true });
            await editorPage.locator('#platformBottomMenu').getByText('AIエージェント').click({ force: true });
            await editorPage.locator('agent-chat-window textarea.user-input').fill('テスト');
            await editorPage.locator('agent-chat-window #send-button').click({ force: true });
        });

        await test.step('2. リトライ上限到達と手動修正モードへの移行を確認', async () => {
            const agentWindow = editorPage.locator('agent-chat-window');
            await expect(agentWindow.getByText('致命的なエラーが発生しました')).toBeVisible({ timeout: 45000 });
            await agentWindow.getByRole('button', { name: '手動モードに切り替えて対応する' }).click({ force: true });
            await expect(agentWindow.getByText('手動実行の待機中')).toBeVisible();
        });

        await test.step('3. 正しいJSONを手動で入力して続行し、正常に反映されるか確認', async () => {
            await editorPage.unroute('**/ai-agent');
            const validJson = JSON.stringify({
                blueprint: {
                    pages: [{ template_id: "manual-home.html", content: "<ons-page id='manual-page' explain='手動修正ページ'></ons-page>" }]
                },
                thought: "手動で修正しました。"
            }, null, 2);

            await editorPage.locator('agent-chat-window #manual-response-input').fill(validJson);
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

    test('実行時エラー（Syntax Error）の自動検知とクリーンなロールバック', async ({ editorPage, editorHelper }) => {
        const { buttonNode } = await editorHelper.setupPageWithButton();
        await editorHelper.openMoveingHandle('right');
        const scriptContainer = editorPage.locator('script-container');
        await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
        await editorHelper.addNewScript('goodScript');

        await editorPage.route('**/ai-agent', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    code: 200,
                    details: {
                        text: JSON.stringify({
                            blueprint: {
                                scripts: [{ name: "badScript", content: "function badScript() { const a = ; }", description: "バグ" }]
                            },
                            thought: "バグ入り追加"
                        })
                    }
                })
            });
        });

        await test.step('1. バグ入りスクリプトをAIに生成させる', async () => {
            await editorHelper.closeMoveingHandle();
            await editorPage.locator('#fab-bottom-menu-box').click({ force: true });
            await editorPage.locator('#platformBottomMenu').getByText('AIエージェント').click({ force: true });
            await editorPage.locator('agent-chat-window textarea.user-input').fill('バグを作って');
            await editorPage.locator('agent-chat-window #send-button').click({ force: true });
        });

        await test.step('2. 実行時エラーがフックされ、構築エラーUIが出ることを確認', async () => {
            const agentWindow = editorPage.locator('agent-chat-window');
            await expect(agentWindow.getByText('構築エラーが発生しました')).toBeVisible({ timeout: 20000 });
            await expect(agentWindow.locator('.message-agent').filter({ hasText: 'SyntaxError' })).toBeVisible();
        });

        await test.step('3. ロールバックの検証（不完全なデータが残っていないこと）', async () => {
            const agentWindow = editorPage.locator('agent-chat-window');
            await agentWindow.locator('.close-btn').click({ force: true });

            await editorHelper.openMoveingHandle('right');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await expect(scriptContainer.locator('.editor-row', { hasText: 'badScript' })).toBeHidden();
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
            await editorPage.route('**/ai-agent', async route => {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        code: 200,
                        details: {
                            text: JSON.stringify({
                                blueprint: {
                                    deleted_items: { pages: ["application", "home.html", "page2.html"] },
                                    scripts: [{ name: targetScriptName, content: "function lockedScript() { console.log('Hacked!'); }", description: "Hacked" }]
                                },
                                thought: "削除と上書き"
                            })
                        }
                    })
                });
            });

            await editorHelper.closeMoveingHandle();
            await editorPage.locator('#fab-bottom-menu-box').click({ force: true });
            await editorPage.locator('#platformBottomMenu').getByText('AIエージェント').click({ force: true });
            await editorPage.locator('agent-chat-window textarea.user-input').fill('命令');
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