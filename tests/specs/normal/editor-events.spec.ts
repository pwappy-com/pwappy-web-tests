import { test as base, expect, Page, Locator } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper, verifyScriptInTestPage } from '../../tools/editor-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

/**
 * テストフィクスチャ
 */
type EditorFixtures = {
    editorPage: Page;
    appName: string;
    editorHelper: EditorHelper;
};
const test = base.extend<EditorFixtures>({
    appName: async ({ }, use) => {
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
        await use(`test-app-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName }, use) => {
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
        const appKey = `test-key-${uniqueId}`.slice(0, 30);
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


// --- テストスイート ---
test.describe('エディタ内イベント＆スクリプト機能のテスト', () => {
    test.beforeEach(async ({ page, context, isMobile }) => {
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

    test('アプリケーションのDOMContentLoadedイベントにスクリプトを割り当て', async ({ editorPage, editorHelper }) => {

        // --- テストデータと期待値の定義 ---
        const eventName = 'DOMContentLoaded';
        const scriptName = 'testDomContentLoadScript';
        const alertText = 'domContentLoaded';
        const scriptBody = `function ${scriptName}(event) {\nons.notification.alert('${alertText}');`;
        const layoutModeExpectedScript = `${scriptBody}\n}`;
        const runModeExpectedScript = `document.addEventListener('${eventName}', ${scriptName});`;
        const testPageExpectedScripts = [
            `function ${scriptName}(event) {`,
            `ons.notification.alert('${alertText}')`,
            runModeExpectedScript,
        ];

        // --- テストシナリオの実行 ---

        await test.step('1. イベントにスクリプトを追加し、編集する', async () => {

            // 右側のサブウィンドウを表示
            await editorHelper.openMoveingHandle("right");

            // イベントタブに切り替える
            const scriptContainer = editorPage.locator('script-container');
            await expect(scriptContainer).toBeVisible();
            await editorHelper.switchTabInContainer(scriptContainer, 'イベント');
            // DOMContentLoadedイベントに 'sample001' という名前でスクリプトを追加
            await editorHelper.addScriptToEvent({ eventName, scriptName });
            // 追加したスクリプトを編集して保存
            await editorHelper.editScript({ eventName, scriptName, scriptContent: scriptBody });

            // 右側のサブウィンドウを非表示
            await editorHelper.closeMoveingHandle();
        });

        await test.step('2. レイアウトモードのプレビューを検証する', async () => {
            // プレビュー内のscriptタグに、編集したコードが反映されているか検証
            await editorHelper.verifyScriptInPreview(layoutModeExpectedScript);
        });

        await test.step('3. 動作モードを検証する', async () => {
            // 「動作」モードに切り替えて、アラートが表示・操作できることを検証
            await editorHelper.switchToRunModeAndVerify({ expectedAlertText: alertText });
            // 動作モードのプレビューに、イベントリスナー登録のコードが追加されているか検証
            await editorHelper.verifyScriptInPreview(runModeExpectedScript);
        });

        await test.step('4. 実機テストページを検証する', async () => {
            // 保存してテストページを開く
            const testPage = await editorHelper.saveAndOpenTestPage();
            // 開いたページのmain.jsの中身を検証
            await verifyScriptInTestPage(testPage, testPageExpectedScripts);
            // テストページを閉じる
            await testPage.close();
        });
    });

    test('アプリケーションのloadイベントにスクリプトを割り当て', async ({ editorPage, editorHelper }) => {

        const eventName = 'load';
        const scriptName = 'testLoadScript';
        const alertText = 'loadScript';
        const scriptBody = `function ${scriptName}(event) {\nons.notification.alert('${alertText}');`;
        const layoutModeExpectedScript = `${scriptBody}\n}`;
        const runModeExpectedScript = `window.addEventListener('${eventName}', ${scriptName});`;
        const testPageExpectedScripts = [
            `function ${scriptName}(event) {`,
            `ons.notification.alert('${alertText}')`,
            runModeExpectedScript,
        ];

        // --- テストシナリオの実行 ---

        await test.step('1. イベントにスクリプトを追加し、編集する', async () => {
            // 右側のサブウィンドウを表示
            await editorHelper.openMoveingHandle("right");
            // イベントタブに切り替える
            const scriptContainer = editorPage.locator('script-container');
            await expect(scriptContainer).toBeVisible();
            await editorHelper.switchTabInContainer(scriptContainer, 'イベント');
            // イベントに スクリプトを追加
            await editorHelper.addScriptToEvent({ eventName, scriptName });
            // 追加したスクリプトを編集して保存
            await editorHelper.editScript({ eventName, scriptName, scriptContent: scriptBody });
            // 右側のサブウィンドウを非表示
            await editorHelper.closeMoveingHandle();
        });

        await test.step('2. レイアウトモードのプレビューを検証する', async () => {
            // プレビュー内のscriptタグに、編集したコードが反映されているか検証
            await editorHelper.verifyScriptInPreview(layoutModeExpectedScript);
        });

        await test.step('3. 動作モードを検証する', async () => {
            // 「動作」モードに切り替えて、アラートが表示・操作できることを検証
            await editorHelper.switchToRunModeAndVerify({ expectedAlertText: alertText });
            // 動作モードのプレビューに、イベントリスナー登録のコードが追加されているか検証
            await editorHelper.verifyScriptInPreview(runModeExpectedScript);
        });

        await test.step('4. 実機テストページを検証する', async () => {
            // 保存してテストページを開く
            const testPage = await editorHelper.saveAndOpenTestPage();
            // 開いたページのmain.jsの中身を検証
            await verifyScriptInTestPage(testPage, testPageExpectedScripts);
            // テストページを閉じる
            await testPage.close();
        });
    });

    /**
     * ons-navigatorを使ったページ遷移（push/pop）に伴う、
     * ページのライフサイクルイベント（init, show, hide, destroy）をテストします。
     */
    test('ページのライフサイクルイベント(init/show/hide/destroy)にスクリプトを割り当て', async ({ editorPage, editorHelper }) => {
        // このテストは時間がかかるのでタイムアウトを伸ばす
        test.setTimeout(120000);

        let appNode: Locator, page1Node: Locator, page2Node: Locator;
        let appId: string, page1Id: string, page2Id: string;

        await test.step('セットアップ: 2つのページとons-navigator、ボタンを配置する', async () => {
            // 左側のサブウィンドウを表示
            await editorHelper.openMoveingHandle("left");

            // レイアウトが表示されていることを確認
            const templateContainer = editorPage.locator('template-container');
            // appのnode-idを取得
            appNode = editorPage.locator('#dom-tree > div[data-node-type="app"]');
            const rawAppId = await appNode.getAttribute('data-node-id')!;
            expect(rawAppId, 'Appのdata-node-idが取得できませんでした').not.toBeNull();
            appId = rawAppId!;

            // 1ページ目と2ページ目を追加
            page1Node = await editorHelper.addPage();
            const rawPage1Id = await page1Node.getAttribute('data-node-id');
            expect(rawPage1Id, 'Page 1のdata-node-idが取得できませんでした').not.toBeNull();
            page1Id = rawPage1Id!; // Non-null assertion operator `!` で string型であることを明示

            page2Node = await editorHelper.addPage();
            const rawPage2Id = await page2Node.getAttribute('data-node-id');
            expect(rawPage2Id, 'Page 2のdata-node-idが取得できませんでした').not.toBeNull();
            page2Id = rawPage2Id!; // Non-null assertion operator `!` で string型であることを明示
        });

        await test.step('スクリプト設定: 各イベントにアラートを表示するスクリプトを追加', async () => {
            // トップレベルをappに切り替え
            await editorHelper.switchTopLevelTemplate(appId);

            // appにons-navigatorを追加
            const navigatorNode = await editorHelper.addComponent('ons-navigator', appNode);
            await editorHelper.openMoveingHandle('right');
            // navigatorNodeのpage属性にpage1.htmlを設定
            const navigatorPageAttribute = editorHelper.getPropertyInput('page');
            await navigatorPageAttribute.locator("input").fill('page1.html');

            // トップレベルをPage2に切り替え
            await editorHelper.switchTopLevelTemplate(page2Id);
            //const page2Contents = page2Node.locator("div.label-explain").filter({ hasText: "コンテンツ" });
            const page2Contents = page2Node.locator("div.node").filter({ hasText: "コンテンツ" });
            // コンテンツにons-back-buttonを追加
            const backButtonLocator = await editorHelper.addComponent('ons-back-button', page2Contents);

            const templateContainer = editorPage.locator('template-container');
            // 左側のサブウィンドウを非表示
            await editorHelper.closeMoveingHandle();

            // Page2の各イベントにスクリプトを追加
            // console.log(`page2NodeInner: ${await page2Node.innerHTML()}`)
            // await editorPage.waitForTimeout(500000)
            await editorHelper.addScriptToNodeEvent({ nodeLocator: page2Node, eventName: 'init', scriptName: 'page2Init' });
            await editorHelper.editScript({ eventName: 'init', scriptName: 'page2Init', scriptContent: "function page2Init(event) {\n    ons.notification.alert('page2_init');\n" });

            await editorHelper.addScriptToNodeEvent({ nodeLocator: page2Node, eventName: 'show', scriptName: 'page2Show' });
            await editorHelper.editScript({ eventName: 'show', scriptName: 'page2Show', scriptContent: "function page2Show(event) {\n    ons.notification.alert('page2_show');\n" });

            await editorHelper.addScriptToNodeEvent({ nodeLocator: page2Node, eventName: 'hide', scriptName: 'page2Hide' });
            await editorHelper.editScript({ eventName: 'hide', scriptName: 'page2Hide', scriptContent: "function page2Hide(event) {\n    ons.notification.alert('page2_hide');\n" });

            await editorHelper.addScriptToNodeEvent({ nodeLocator: page2Node, eventName: 'destroy', scriptName: 'page2Destroy' });
            await editorHelper.editScript({ eventName: 'destroy', scriptName: 'page2Destroy', scriptContent: "function page2Destroy(event) {\n    ons.notification.alert('page2_destroy');\n" });

            // トップレベルをPage1に切り替え
            await editorHelper.switchTopLevelTemplate(page1Id);
            const page1Contents = page1Node.locator("div.node").filter({ hasText: "コンテンツ" });

            // page1Contentsにons-buttonを追加
            // await selectNodeInDomTree(page1Contents);
            // Page1のボタンのclickイベントにページ遷移スクリプトを追加
            const button1Locator = await editorHelper.addComponent('ons-button', page1Contents);

            await editorHelper.addScriptToNodeEvent({ nodeLocator: button1Locator, eventName: 'click', scriptName: 'pushPage2' });
            await editorHelper.editScript({ eventName: 'click', scriptName: 'pushPage2', scriptContent: "function pushPage2(event) {\ndocument.querySelector('ons-navigator').pushPage('page2.html');" });
        });

        await test.step('動作検証: ページ遷移とイベント発火を検証', async () => {

            // ハンドルを閉じる
            editorHelper.closeMoveingHandle();

            // 動作モードに切り替え
            const platformSwitcher = editorPage.locator('platform-switcher');
            await platformSwitcher.locator('.screen-rotete-container').click();
            await platformSwitcher.locator('#platformEditMenu').getByText('動作').click();
            await platformSwitcher.locator('.screen-rotete-container').click();

            const previewFrame = editorPage.frameLocator('#renderzone');
            // 1. ページ1の初期表示でアラートが出ないことを確認
            await expect(editorPage.frameLocator('#renderzone').locator('ons-alert-dialog')).toBeHidden();

            // ボタンをクリックしてページ遷移を開始
            await previewFrame.locator('ons-button').click();

            // --- ループを使わずに、各アラートを個別に検証 ---
            await editorHelper.verifyAndCloseAlert(previewFrame, 'page2_show');
            await editorHelper.verifyAndCloseAlert(previewFrame, 'page2_init');

            // 戻るボタンをクリック
            const backButton = previewFrame.locator('ons-back-button');
            await expect(backButton).toBeVisible();
            await expect(backButton).toBeEnabled();
            await previewFrame.locator('ons-back-button').click();

            // --- こちらも個別に検証 ---
            await editorHelper.verifyAndCloseAlert(previewFrame, 'page2_destroy');
            await editorHelper.verifyAndCloseAlert(previewFrame, 'page2_hide');

        });

        await test.step('動作検証(実機テストページ): ページ遷移と生成されたJSを確認', async () => {
            // 1. 保存して実機テストページを開く
            const testPage = await editorHelper.saveAndOpenTestPage();
            await testPage.waitForLoadState('domcontentloaded');

            await testPage.locator('ons-button').click();

            // --- ループを使わずに、各アラートを個別に検証 ---
            await editorHelper.verifyAndCloseAlert(testPage, 'page2_show');
            await editorHelper.verifyAndCloseAlert(testPage, 'page2_init');

            await testPage.locator('ons-back-button').click();

            // --- こちらも個別に検証 ---
            await editorHelper.verifyAndCloseAlert(testPage, 'page2_destroy');
            await editorHelper.verifyAndCloseAlert(testPage, 'page2_hide');


            // 3. main.js の内容を検証
            const expectedScripts = [
                // スクリプト関数の定義が存在することを確認
                "function page2Init(event) {",
                "ons.notification.alert('page2_init');",
                "function page2Show(event) {",
                "ons.notification.alert('page2_show');",
                "function page2Hide(event) {",
                "ons.notification.alert('page2_hide');",
                "function page2Destroy(event) {",
                "ons.notification.alert('page2_destroy');",
                "function pushPage2(event) {",
                `document.querySelector('ons-navigator').pushPage('page2.html');`,

                // page2 の init イベントハンドラが存在することを確認
                "document.addEventListener('init', (event) => {",
                `if (page.id === 'ons-page2') {`,
                "page2Init(event);",
                "page.addEventListener('show', page2Show);",
                "page.addEventListener('hide', page2Hide);",
                "page.addEventListener('destroy', page2Destroy);",
                // クリーンアップ処理の存在も確認
                "page.addEventListener('destroy', function(event) {",
                "page.removeEventListener('show', page2Show);",
            ];
            await verifyScriptInTestPage(testPage, expectedScripts);

            // 4. テストページを閉じる
            await testPage.close();
        });
    });

    test('カスタムイベントを定義できる', async ({ editorPage, editorHelper }) => {
        const listenerTarget = 'element';
        const eventName = 'test-event';
        const comment = 'テストコメント';

        await test.step('1. 新しいイベント定義を追加する', async () => {
            await editorHelper.addCustomEventDefinition({
                listenerTarget,
                eventName,
                comment,
            });
        });
    });

    test('サービスワーカータブでカスタムイベントを定義できる', async ({ editorPage, editorHelper }) => {
        const eventName = 'new-serviceworker-event';
        const comment = '新しいサービスワーカーイベント';

        await test.step('1. 新しいサービスワーカーイベント定義を追加する', async () => {
            await editorHelper.addCustomServiceWorkerEventDefinition({
                eventName,
                comment,
            });
        });
    });
    
    test('スクリプトエラーがある場合、タブ移動と保存がブロックされる', async ({ editorPage, editorHelper }) => {
        const scriptName = 'errorScript';
        const invalidScript = 'const 0a = 1;'; // 不正な変数名
        const expectedDialogMessage = 'スクリプトのエラーを修正してください';

        await test.step('セットアップ: エラーのあるスクリプトを入力する', async () => {
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await editorHelper.addNewScript(scriptName, 'function');
            // ヘルパーメソッドを使って、保存せずに不正なスクリプトを入力
            await editorHelper.fillScriptContent(scriptName, invalidScript);
        });

        await test.step('検証: 他のタブに移動しようとするとダイアログが表示されブロックされる', async () => {
            const scriptContainer = editorPage.locator('script-container');
            const monacoEditor = scriptContainer.locator('.monaco-editor[role="code"]');
            const alertDialog = editorPage.locator('alert-component');

            // テスト対象のタブ（イベント、サービスワーカー）
            const tabsToTest = ['イベント', 'サービスワーカー'];

            for (const tabName of tabsToTest) {
                // タブをクリック
                await scriptContainer.locator('.tab', { hasText: tabName }).click();

                // ダイアログを検証
                await expect(alertDialog).toBeVisible();
                await expect(alertDialog).toContainText(expectedDialogMessage);
                await alertDialog.getByRole('button', { name: '閉じる' }).click();
                await expect(alertDialog).toBeHidden();

                // エディタ（Monaco）が表示されたままであることを確認
                await expect(monacoEditor).toBeVisible();
                // 対応するタブのコンテナが表示されていないことを確認
                if (tabName === 'イベント') {
                    await expect(scriptContainer.locator('event-container')).toBeHidden();
                } else if (tabName === 'サービスワーカー') {
                    await expect(scriptContainer.locator('service-worker-container')).toBeHidden();
                }
            }
        });

        await test.step('検証: 保存しようとするとダイアログが表示されブロックされる', async () => {
            const scriptContainer = editorPage.locator('script-container');
            const monacoEditor = scriptContainer.locator('.monaco-editor[role="code"]');
            const saveButton = scriptContainer.locator('#fab-save');
            const alertDialog = editorPage.locator('alert-component');

            // 保存ボタンをクリック
            await saveButton.click();

            // ダイアログを検証
            await expect(alertDialog).toBeVisible();
            await expect(alertDialog).toContainText(expectedDialogMessage);
            await alertDialog.getByRole('button', { name: '閉じる' }).click();
            await expect(alertDialog).toBeHidden();

            // エディタ（Monaco）が表示されたままであることを確認
            await expect(monacoEditor).toBeVisible();
        });
    });
});