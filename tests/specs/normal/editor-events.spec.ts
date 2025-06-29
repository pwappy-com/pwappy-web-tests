import { test as base, expect, Page, Locator } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, openEditor } from '../../tools/dashboard-helpers';
// 作成した新しいヘルパー関数もインポートします
import {
    switchTabInContainer,
    switchToRunModeAndVerify,
    saveAndOpenTestPage,
    switchTopLevelTemplate,
    addComponent,
    addPage,
    getPropertyInput,
} from '../../tools/editor-helpers';
import {
    addScriptToEvent,
    addScriptToNodeEvent,
    editScript,
    verifyAndCloseAlert,
    verifyScriptInPreview,
    verifyScriptInTestPage,
} from '../../tools/script-helpers';


/**
 * テストフィクスチャ
 */
type EditorFixtures = {
    editorPage: Page;
    appName: string;
};
const test = base.extend<EditorFixtures>({
    appName: async ({ }, use) => {
        await use(`test-app-${Date.now()}`);
    },
    editorPage: async ({ page, context, appName }, use) => {
        const appKey = `test-key-${Date.now()}`;
        await createApp(page, appName, appKey);
        const editorPage = await openEditor(page, context, appName);
        await use(editorPage);
        await editorPage.close();
        await deleteApp(page, appName);
    },
});


// --- テストスイート ---
test.describe('エディタ内イベント＆スクリプト機能のテスト', () => {

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

    test('アプリケーションのDOMContentLoadedイベントにスクリプトを割り当て', async ({ editorPage }) => {

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
            // イベントタブに切り替える
            const scriptContainer = editorPage.locator('script-container');
            await switchTabInContainer(scriptContainer, 'イベント');
            // DOMContentLoadedイベントに 'sample001' という名前でスクリプトを追加
            await addScriptToEvent(editorPage, { eventName, scriptName });
            // 追加したスクリプトを編集して保存
            await editScript(editorPage, { eventName, scriptName, scriptContent: scriptBody });
        });

        await test.step('2. レイアウトモードのプレビューを検証する', async () => {
            // プレビュー内のscriptタグに、編集したコードが反映されているか検証
            await verifyScriptInPreview(editorPage, layoutModeExpectedScript);
        });

        await test.step('3. 動作モードを検証する', async () => {
            // 「動作」モードに切り替えて、アラートが表示・操作できることを検証
            await switchToRunModeAndVerify(editorPage, { expectedAlertText: alertText });
            // 動作モードのプレビューに、イベントリスナー登録のコードが追加されているか検証
            await verifyScriptInPreview(editorPage, runModeExpectedScript);
        });

        await test.step('4. 実機テストページを検証する', async () => {
            // 保存してテストページを開く
            const testPage = await saveAndOpenTestPage(editorPage);
            // 開いたページのmain.jsの中身を検証
            await verifyScriptInTestPage(testPage, testPageExpectedScripts);
            // テストページを閉じる
            await testPage.close();
        });
    });

    test('アプリケーションのloadイベントにスクリプトを割り当て', async ({ editorPage }) => {

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
            // イベントタブに切り替える
            const scriptContainer = editorPage.locator('script-container');
            await switchTabInContainer(scriptContainer, 'イベント');
            // イベントに スクリプトを追加
            await addScriptToEvent(editorPage, { eventName, scriptName });
            // 追加したスクリプトを編集して保存
            await editScript(editorPage, { eventName, scriptName, scriptContent: scriptBody });
        });

        await test.step('2. レイアウトモードのプレビューを検証する', async () => {
            // プレビュー内のscriptタグに、編集したコードが反映されているか検証
            await verifyScriptInPreview(editorPage, layoutModeExpectedScript);
        });

        await test.step('3. 動作モードを検証する', async () => {
            // 「動作」モードに切り替えて、アラートが表示・操作できることを検証
            await switchToRunModeAndVerify(editorPage, { expectedAlertText: alertText });
            // 動作モードのプレビューに、イベントリスナー登録のコードが追加されているか検証
            await verifyScriptInPreview(editorPage, runModeExpectedScript);
        });

        await test.step('4. 実機テストページを検証する', async () => {
            // 保存してテストページを開く
            const testPage = await saveAndOpenTestPage(editorPage);
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
    test('ページのライフサイクルイベント(init/show/hide/destroy)にスクリプトを割り当て', async ({ editorPage }) => {
        // このテストは時間がかかるのでタイムアウトを伸ばす
        test.setTimeout(120000);

        let appNode: Locator, page1Node: Locator, page2Node: Locator;
        let appId: string, page1Id: string, page2Id: string;

        await test.step('セットアップ: 2つのページとons-navigator、ボタンを配置する', async () => {
            // appのnode-idを取得
            appNode = editorPage.locator('#dom-tree > div[data-node-type="app"]');
            const rawAppId = await appNode.getAttribute('data-node-id')!;
            expect(rawAppId, 'Appのdata-node-idが取得できませんでした').not.toBeNull();
            appId = rawAppId!;

            // 1ページ目と2ページ目を追加
            page1Node = await addPage(editorPage);
            const rawPage1Id = await page1Node.getAttribute('data-node-id');
            expect(rawPage1Id, 'Page 1のdata-node-idが取得できませんでした').not.toBeNull();
            page1Id = rawPage1Id!; // Non-null assertion operator `!` で string型であることを明示

            page2Node = await addPage(editorPage);
            const rawPage2Id = await page2Node.getAttribute('data-node-id');
            expect(rawPage2Id, 'Page 2のdata-node-idが取得できませんでした').not.toBeNull();
            page2Id = rawPage2Id!; // Non-null assertion operator `!` で string型であることを明示
        });

        await test.step('スクリプト設定: 各イベントにアラートを表示するスクリプトを追加', async () => {
            // トップレベルをappに切り替え
            await switchTopLevelTemplate(editorPage, appId);

            // appにons-navigatorを追加
            const navigatorNode = await addComponent(editorPage, 'ons-navigator', appNode);
            // navigatorNodeのpage属性にpage1.htmlを設定
            const navigatorPageAttribute = getPropertyInput(editorPage, 'page');
            await navigatorPageAttribute.locator("input").fill('page1.html');

            // トップレベルをPage2に切り替え
            await switchTopLevelTemplate(editorPage, page2Id);
            //const page2Contents = page2Node.locator("div.label-explain").filter({ hasText: "コンテンツ" });
            const page2Contents = page2Node.locator("div.node").filter({ hasText: "コンテンツ" });
            // コンテンツにons-back-buttonを追加
            const backButtonLocator = await addComponent(editorPage, 'ons-back-button', page2Contents);

            // Page2の各イベントにスクリプトを追加
            // console.log(`page2NodeInner: ${await page2Node.innerHTML()}`)
            // await editorPage.waitForTimeout(500000)
            await addScriptToNodeEvent(editorPage, { nodeLocator: page2Node, eventName: 'init', scriptName: 'page2Init' });
            await editScript(editorPage, { eventName: 'init', scriptName: 'page2Init', scriptContent: "function page2Init(event) {\n    ons.notification.alert('page2_init');\n" });

            await addScriptToNodeEvent(editorPage, { nodeLocator: page2Node, eventName: 'show', scriptName: 'page2Show' });
            await editScript(editorPage, { eventName: 'show', scriptName: 'page2Show', scriptContent: "function page2Show(event) {\n    ons.notification.alert('page2_show');\n" });

            await addScriptToNodeEvent(editorPage, { nodeLocator: page2Node, eventName: 'hide', scriptName: 'page2Hide' });
            await editScript(editorPage, { eventName: 'hide', scriptName: 'page2Hide', scriptContent: "function page2Hide(event) {\n    ons.notification.alert('page2_hide');\n" });

            await addScriptToNodeEvent(editorPage, { nodeLocator: page2Node, eventName: 'destroy', scriptName: 'page2Destroy' });
            await editScript(editorPage, { eventName: 'destroy', scriptName: 'page2Destroy', scriptContent: "function page2Destroy(event) {\n    ons.notification.alert('page2_destroy');\n" });

            // トップレベルをPage1に切り替え
            await switchTopLevelTemplate(editorPage, page1Id);
            const page1Contents = page1Node.locator("div.node").filter({ hasText: "コンテンツ" });

            // page1Contentsにons-buttonを追加
            // await selectNodeInDomTree(page1Contents);
            // Page1のボタンのclickイベントにページ遷移スクリプトを追加
            const button1Locator = await addComponent(editorPage, 'ons-button', page1Contents);

            await addScriptToNodeEvent(editorPage, { nodeLocator: button1Locator, eventName: 'click', scriptName: 'pushPage2' });
            await editScript(editorPage, { eventName: 'click', scriptName: 'pushPage2', scriptContent: "function pushPage2(event) {\ndocument.querySelector('ons-navigator').pushPage('page2.html');" });
        });

        await test.step('動作検証: ページ遷移とイベント発火を検証', async () => {
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
            await verifyAndCloseAlert(previewFrame, 'page2_show');
            await verifyAndCloseAlert(previewFrame, 'page2_init');

            // 戻るボタンをクリック
            await previewFrame.locator('ons-back-button').click();

            // --- こちらも個別に検証 ---
            await verifyAndCloseAlert(previewFrame, 'page2_destroy');
            await verifyAndCloseAlert(previewFrame, 'page2_hide');

        });

        await test.step('動作検証(実機テストページ): ページ遷移と生成されたJSを確認', async () => {
            // 1. 保存して実機テストページを開く
            const testPage = await saveAndOpenTestPage(editorPage);
            await testPage.waitForLoadState('domcontentloaded');

            await testPage.locator('ons-button').click();

            // --- ループを使わずに、各アラートを個別に検証 ---
            await verifyAndCloseAlert(testPage, 'page2_show');
            await verifyAndCloseAlert(testPage, 'page2_init');

            await testPage.locator('ons-back-button').click();

            // --- こちらも個別に検証 ---
            await verifyAndCloseAlert(testPage, 'page2_destroy');
            await verifyAndCloseAlert(testPage, 'page2_hide');


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
});