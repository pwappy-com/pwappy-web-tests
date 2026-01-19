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
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        await use(`ai-test-app-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName }, use) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appKey = `ai-key-${uniqueId}`.slice(0, 30);
        await createApp(page, appName, appKey);
        const editorPage = await openEditor(page, context, appName);
        await use(editorPage);
        await editorPage.close();
        await deleteApp(page, appKey);
    },
    editorHelper: async ({ editorPage, isMobile }, use) => {
        const helper = new EditorHelper(editorPage, isMobile);
        await use(helper);
    },
});

test.describe('AIエージェント機能：UI・連携・コマンド反映テスト（モック実行）', () => {

    test.beforeEach(async ({ page, context }) => {
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
    });

    test.afterEach(async ({ page }) => {
        await setAiCoding(page, false);
    });

    test('エージェントウィンドウ：基本UI、リサイズ、および設定変更', async ({ editorPage, editorHelper }) => {
        await test.step('1. AIエージェントウィンドウを起動', async () => {
            // メニューからAIエージェントを開く
            await editorPage.locator('#fab-bottom-menu-box').click();
            await editorPage.locator('#platformBottomMenu').getByText('AIエージェント').click();

            const agentWindow = editorPage.locator('agent-chat-window');
            await expect(agentWindow).toBeVisible();
        });

        await test.step('2. パネルのリサイズ操作を検証', async () => {
            // Shadow DOM内も含めたスコープでチャットパネルを特定
            const chatPanel = editorPage.locator('agent-chat-window .chat-panel');
            // ToolBoxItemEditor内のリサイザーと区別するため、agent-chat-window内のリサイザーを特定
            const resizer = editorPage.locator('agent-chat-window .resizer');

            const initialBox = await chatPanel.boundingBox();
            const resizerBox = await resizer.boundingBox();

            if (initialBox && resizerBox) {
                // リサイズハンドルを掴んで右に100px移動
                await editorPage.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + resizerBox.height / 2);
                await editorPage.mouse.down();
                await editorPage.mouse.move(resizerBox.x + 100, resizerBox.y + resizerBox.height / 2);
                await editorPage.mouse.up();

                const updatedBox = await chatPanel.boundingBox();
                // 幅が広がっていることを確認 (微小な誤差は許容)
                expect(updatedBox!.width).toBeGreaterThan(initialBox.width + 50);
            }
        });

        await test.step('3. モデル設定モーダルの操作', async () => {
            const agentWindow = editorPage.locator('agent-chat-window');
            await agentWindow.locator('.settings-btn').click();

            const modal = agentWindow.locator('.modal-dialog:has-text("AIエージェント設定")');
            await expect(modal).toBeVisible();

            // モデルの選択変更
            const select = modal.locator('#agent-model-select');
            await select.selectOption('gemini-2.5-pro');
            await expect(select).toHaveValue('gemini-2.5-pro');

            // キャンセルして閉じる
            await modal.getByRole('button', { name: 'キャンセル' }).click();
            await expect(modal).toBeHidden();
        });
    });

    test('ウェルカム画面：アーキテクチャ・テンプレートの選択と反映', async ({ editorPage }) => {
        await test.step('1. 初期表示のテンプレート選択カードを確認', async () => {
            await editorPage.locator('#fab-bottom-menu-box').click();
            await editorPage.locator('#platformBottomMenu').getByText('AIエージェント').click();

            const agentWindow = editorPage.locator('agent-chat-window');
            const welcome = agentWindow.locator('.welcome-screen');
            await expect(welcome).toBeVisible();

            // Navigator（必須）のカード
            await expect(welcome.locator('.template-card', { hasText: 'Stack Navigation' })).toHaveClass(/mandatory/);

            // Tab Bar カードを選択
            const tabCard = welcome.locator('.template-card', { hasText: 'Tab Bar' });
            await tabCard.click();
            await expect(tabCard).toHaveClass(/selected/);
        });

        await test.step('2. 選択解除の動作確認', async () => {
            const tabCard = editorPage.locator('agent-chat-window .template-card', { hasText: 'Tab Bar' });
            await tabCard.click();
            await expect(tabCard).not.toHaveClass(/selected/);
        });
    });

    test('APIモック実行：AI応答（設計図）の受信から画面構築（Build）までの自動反映', async ({ editorPage, editorHelper }) => {
        test.setTimeout(120000); // タイムアウト延長

        // AI APIの呼び出しをフックして、ダミーの設計図JSONを返す
        await editorPage.route('**/ai-agent', async route => {
            const mockResponse = {
                code: 200,
                details: {
                    text: JSON.stringify({
                        blueprint: {
                            root_html: '<ons-navigator id="appNavigator" page="home.html"></ons-navigator>',
                            pages: [
                                {
                                    template_id: "home.html",
                                    content: '<ons-page id="home-page" explain="ホーム画面" template-id="home.html"><div class="page__background"></div><div class="page__content"><ons-button id="hello-btn" explain="挨拶ボタン">Hello AI</ons-button></div></ons-page>'
                                }
                            ],
                            global_css: "ons-button { color: red; }",
                            scripts: [
                                {
                                    name: "sayHello",
                                    content: "function sayHello() { ons.notification.alert('Hello from Mock!'); }",
                                    description: "挨拶を表示します"
                                }
                            ],
                            event_bindings: [
                                { target_dom_id: "hello-btn", event_type: "click", script_name: "sayHello" }
                            ]
                        },
                        thought: "モックデータを使用してTODOアプリの骨格を作成しました。"
                    })
                }
            };
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockResponse) });
        });

        await test.step('1. 指示を送信してモック応答をトリガー', async () => {
            await editorPage.locator('#fab-bottom-menu-box').click();
            await editorPage.locator('#platformBottomMenu').getByText('AIエージェント').click();

            const textarea = editorPage.locator('agent-chat-window textarea.user-input');
            await textarea.fill('TODOアプリを作って');

            // 自動実行モードに設定（.mode-selector経由で特定）
            const autoBtn = editorPage.locator('agent-chat-window .mode-selector button').filter({ hasText: '自動' });
            await expect(autoBtn).toBeVisible();
            await autoBtn.click();

            await editorPage.locator('agent-chat-window #send-button').click();
        });

        await test.step('2. 設計図に基づいた画面構築の完了を確認', async () => {
            const agentWindow = editorPage.locator('agent-chat-window');

            // AIの思考メッセージが表示されるのを待つ
            // .message-agent クラスが存在しない可能性があるため、テキストで検索するように変更
            await expect(agentWindow.getByText('モックデータを使用して')).toBeVisible({ timeout: 30000 });

            // 構築完了後のフィードバックUIが表示されているか
            await expect(agentWindow.locator('.ideation-controls')).toContainText('アプリの更新が完了しました');

            // AIエージェント画面を閉じる
            await agentWindow.locator('.close-btn').click();

            // --- 修正箇所: ページの切り替えと検証 ---
            await editorHelper.openMoveingHandle('left');

            // テンプレートリスト（プルダウン）を開く
            await editorPage.locator('template-container .select').click();

            // "ホーム画面" (explain属性) がリストに追加されていることを確認
            const homePageItem = editorPage.locator('.top-template-item').filter({ hasText: 'ホーム画面' });
            await expect(homePageItem).toBeVisible();

            // "ホーム画面" をクリックして表示を切り替える
            await homePageItem.click();
            await editorPage.waitForTimeout(500); // 描画待ち

            // ページが切り替わり、DOMツリーにボタンが表示されていることを確認
            const domTree = editorHelper.getDomTree();
            await expect(domTree.getByText('id:hello-btn 挨拶ボタン id: hello-')).toBeVisible();
        });

        await test.step('3. スクリプトとイベント紐付けの検証', async () => {
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');

            // スクリプトが作成されているか
            await expect(scriptContainer.locator('.editor-row', { hasText: 'sayHello' })).toBeVisible();

            // イベント紐付けがされているか（属性パネルで確認）
            // 直前のステップで "ホーム画面" に切り替えているため、ここからボタンを選択可能
            const button = await editorHelper.selectNodeByAttribute('data-node-dom-id', 'hello-btn');
            await editorHelper.switchTabInContainer(scriptContainer, 'イベント');
            await expect(editorPage.locator('event-container').locator('.editor-row-right-item', { hasText: 'sayHello' })).toBeVisible();
        });
    });

    test('手動実行モード：プロンプトのコピーと応答の貼り付けUI', async ({ editorPage }) => {

        // CI環境（GitHub Actionsなど）の場合のみスキップ
        test.skip(!!process.env.CI, 'CI環境ではクリップボード権限の制限によりテストが失敗するためスキップします。ローカルでは実行されます。');

        await test.step('1. 手動モードで指示を開始', async () => {
            await editorPage.locator('#fab-bottom-menu-box').click();
            await editorPage.locator('#platformBottomMenu').getByText('AIエージェント').click();

            // 手動モードを選択（.mode-selector経由）
            const manualBtn = editorPage.locator('agent-chat-window .mode-selector button').filter({ hasText: '手動' });
            await expect(manualBtn).toBeVisible();
            await manualBtn.click();

            await editorPage.locator('agent-chat-window textarea.user-input').fill('テスト指示');
            await editorPage.locator('agent-chat-window #send-button').click();
        });

        await test.step('2. 手動プロンプト実行モーダルの検証', async () => {
            const modal = editorPage.locator('agent-chat-window .modal-dialog:has-text("手動プロンプト実行")');
            await expect(modal).toBeVisible();

            // コピーボタンの存在
            const copyBtn = modal.locator('#copy-combined-btn');
            await expect(copyBtn).toBeVisible();

            // コピー実行（クリップボード操作の権限許可が必要な場合があるためクリックのみ検証）
            await copyBtn.click();
            await expect(copyBtn).toContainText('コピー完了');

            // 貼り付けエリアの存在
            const responseArea = modal.locator('#manual-response-input');
            await expect(responseArea).toBeVisible();

            // キャンセルして閉じる
            await modal.getByRole('button', { name: 'キャンセル' }).click();
            await expect(modal).toBeHidden();
        });
    });

});