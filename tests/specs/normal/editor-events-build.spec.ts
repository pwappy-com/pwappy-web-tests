import { test as base, expect, Page, Locator } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper, verifyScriptInTestPage } from '../../tools/editor-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

/**
 * テストフィクスチャ（各テストごとに独立したアプリを構築・クリーンアップ）
 */
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
        await use(`test-evt-bld-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName }, use) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appKey = `evt-bld-key-${uniqueId}`.slice(0, 30);
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

test.describe('エディタ内イベント＆スクリプト機能のビルド・実機連携テスト', () => {
    test.beforeEach(async ({ page }) => {
        await gotoDashboard(page);
    });

    test('アプリケーションのDOMContentLoadedイベントにスクリプトを割り当て', async ({ editorPage, editorHelper }) => {
        const eventName = 'DOMContentLoaded';
        const scriptName = 'testDomContentLoadScript';
        const alertText = 'domContentLoaded';
        const scriptBody = `function ${scriptName}(event) {\n    ons.notification.alert('${alertText}');\n}`;
        const layoutModeExpectedScript = scriptBody;
        const runModeExpectedScript = `document.addEventListener('${eventName}', ${scriptName});`;
        const testPageExpectedScripts = [
            `function ${scriptName}(event) {`,
            `ons.notification.alert('${alertText}')`,
            runModeExpectedScript,
        ];

        await test.step('1. イベントにスクリプトを追加し、編集する', async () => {
            await editorHelper.openMoveingHandle("right");
            const scriptContainer = editorPage.locator('script-container');
            await expect(scriptContainer).toBeVisible();
            await editorHelper.switchTabInContainer(scriptContainer, 'イベント');
            await editorHelper.addScriptToEvent({ eventName, scriptName });
            await editorHelper.editScript({ eventName, scriptName, scriptContent: scriptBody });
            await editorHelper.closeMoveingHandle();
        });

        await test.step('2. レイアウトモードのプレビューを検証する', async () => {
            await editorHelper.verifyScriptInPreview(layoutModeExpectedScript);
        });

        await test.step('3. 動作モードを検証する', async () => {
            await editorHelper.switchToRunModeAndVerify({ expectedAlertText: alertText });
            await editorHelper.verifyScriptInPreview(runModeExpectedScript);
        });

        await test.step('4. 実機テストページを検証する', async () => {
            const testPage = await editorHelper.saveAndOpenTestPage();
            await testPage.waitForTimeout(5000);

            testPage.on('console', msg => console.log(`[TestPage Console] ${msg.type()}: ${msg.text()}`));
            testPage.on('pageerror', err => console.error(`[TestPage Error] ${err.message}`));

            await verifyScriptInTestPage(testPage, testPageExpectedScripts);

            const currentUrl = new URL(testPage.url());
            currentUrl.searchParams.set('cb', Date.now().toString());
            await testPage.goto(currentUrl.toString(), { waitUntil: 'domcontentloaded' });

            const alertDialog = testPage.locator('ons-alert-dialog').filter({ hasText: alertText }).last();
            await expect(alertDialog).toBeVisible({ timeout: 15000 });

            await alertDialog.locator('ons-alert-dialog-button').click({ force: true });
            await testPage.close();
        });
    });

    test('アプリケーションのloadイベントにスクリプトを割り当て', async ({ editorPage, editorHelper }) => {
        const eventName = 'load';
        const scriptName = 'testLoadScript';
        const alertText = 'loadScript';
        const scriptBody = `function ${scriptName}(event) {\n    ons.notification.alert('${alertText}');\n}`;
        const layoutModeExpectedScript = scriptBody;
        const runModeExpectedScript = `window.addEventListener('${eventName}', ${scriptName});`;
        const testPageExpectedScripts = [
            `function ${scriptName}(event) {`,
            `ons.notification.alert('${alertText}')`,
            runModeExpectedScript,
        ];

        await test.step('1. イベントにスクリプトを追加し、編集する', async () => {
            await editorHelper.openMoveingHandle("right");
            const scriptContainer = editorPage.locator('script-container');
            await expect(scriptContainer).toBeVisible();
            await editorHelper.switchTabInContainer(scriptContainer, 'イベント');
            await editorHelper.addScriptToEvent({ eventName, scriptName });
            await editorHelper.editScript({ eventName, scriptName, scriptContent: scriptBody });
            await editorHelper.closeMoveingHandle();
        });

        await test.step('2. レイアウトモードのプレビューを検証する', async () => {
            await editorHelper.verifyScriptInPreview(layoutModeExpectedScript);
        });

        await test.step('3. 動作モードを検証する', async () => {
            await editorHelper.switchToRunModeAndVerify({ expectedAlertText: alertText });
            await editorHelper.verifyScriptInPreview(runModeExpectedScript);
        });

        await test.step('4. 実機テストページを検証する', async () => {
            const testPage = await editorHelper.saveAndOpenTestPage();

            testPage.on('console', msg => console.log(`[TestPage Console] ${msg.type()}: ${msg.text()}`));
            testPage.on('pageerror', err => console.error(`[TestPage Error] ${err.message}`));

            await verifyScriptInTestPage(testPage, testPageExpectedScripts);

            const currentUrl = new URL(testPage.url());
            currentUrl.searchParams.set('cb', Date.now().toString());
            await testPage.goto(currentUrl.toString(), { waitUntil: 'domcontentloaded' });

            const alertDialog = testPage.locator('ons-alert-dialog').filter({ hasText: alertText }).last();
            await expect(alertDialog).toBeVisible({ timeout: 15000 });

            await alertDialog.locator('ons-alert-dialog-button').click({ force: true });
            await testPage.close();
        });
    });

    test('ページのライフサイクルイベント(init/show/hide/destroy)にスクリプトを割り当て', async ({ editorPage, editorHelper }) => {
        test.setTimeout(120000);

        let appNode: Locator, page1Node: Locator, page2Node: Locator;
        let appId: string, page1Id: string, page2Id: string;

        await test.step('セットアップ: 2つのページとons-navigator、ボタンを配置する', async () => {
            await editorHelper.openMoveingHandle("left");
            appNode = editorPage.locator('#dom-tree > div[data-node-type="app"]');
            const rawAppId = await appNode.getAttribute('data-node-id')!;
            expect(rawAppId).not.toBeNull();
            appId = rawAppId!;

            page1Node = await editorHelper.addPage();
            const rawPage1Id = await page1Node.getAttribute('data-node-id');
            expect(rawPage1Id).not.toBeNull();
            page1Id = rawPage1Id!;

            page2Node = await editorHelper.addPage();
            const rawPage2Id = await page2Node.getAttribute('data-node-id');
            expect(rawPage2Id).not.toBeNull();
            page2Id = rawPage2Id!;
        });

        await test.step('スクリプト設定: 各イベントにアラートを表示するスクリプトを追加', async () => {
            await editorHelper.switchTopLevelTemplate(appId);
            const navigatorNode = await editorHelper.addComponent('ons-navigator', appNode);
            await editorHelper.openMoveingHandle('right');
            const navigatorPageAttribute = editorHelper.getPropertyInput('page');
            const navAttInput = navigatorPageAttribute.locator("input");
            await expect(navAttInput).toBeEditable();
            await navAttInput.fill('page1.html');

            await editorHelper.switchTopLevelTemplate(page2Id);
            const page2Contents = page2Node.locator("div.node").filter({ hasText: "コンテンツ" });
            const backButtonLocator = await editorHelper.addComponent('ons-back-button', page2Contents);

            await editorHelper.closeMoveingHandle();

            await editorHelper.addScriptToNodeEvent({ nodeLocator: page2Node, eventName: 'init', scriptName: 'page2Init' });
            await editorHelper.editScript({ eventName: 'init', scriptName: 'page2Init', scriptContent: "function page2Init(event) {\n    ons.notification.alert('page2_init');\n}" });
            await editorHelper.addScriptToNodeEvent({ nodeLocator: page2Node, eventName: 'show', scriptName: 'page2Show' });
            await editorHelper.editScript({ eventName: 'show', scriptName: 'page2Show', scriptContent: "function page2Show(event) {\n    ons.notification.alert('page2_show');\n}" });
            await editorHelper.addScriptToNodeEvent({ nodeLocator: page2Node, eventName: 'hide', scriptName: 'page2Hide' });
            await editorHelper.editScript({ eventName: 'hide', scriptName: 'page2Hide', scriptContent: "function page2Hide(event) {\n    ons.notification.alert('page2_hide');\n}" });
            await editorHelper.addScriptToNodeEvent({ nodeLocator: page2Node, eventName: 'destroy', scriptName: 'page2Destroy' });
            await editorHelper.editScript({ eventName: 'destroy', scriptName: 'page2Destroy', scriptContent: "function page2Destroy(event) {\n    ons.notification.alert('page2_destroy');\n}" });

            await editorHelper.switchTopLevelTemplate(page1Id);
            const page1Contents = page1Node.locator("div.node").filter({ hasText: "コンテンツ" });
            const button1Locator = await editorHelper.addComponent('ons-button', page1Contents);

            await editorHelper.addScriptToNodeEvent({ nodeLocator: button1Locator, eventName: 'click', scriptName: 'pushPage2' });
            await editorHelper.editScript({ eventName: 'click', scriptName: 'pushPage2', scriptContent: "function pushPage2(event) {\n    document.querySelector('ons-navigator').pushPage('page2.html');\n}" });
        });

        await test.step('動作検証: ページ遷移とイベント発火を検証', async () => {
            editorHelper.closeMoveingHandle();

            const platformSwitcher = editorPage.locator('platform-switcher');
            await platformSwitcher.locator('.screen-rotete-container').click();
            const editMenu = editorPage.locator('#platformEditMenu');
            await expect(editMenu).toBeVisible();
            await editMenu.getByText('動作').click();
            await platformSwitcher.locator('.screen-rotete-container').click();

            const previewFrame = editorPage.frameLocator('#ios-container #renderzone');
            await expect(previewFrame.locator('ons-alert-dialog')).toBeHidden();

            await previewFrame.locator('ons-button').click();

            await editorHelper.verifyAndCloseAlert(previewFrame, 'page2_init');
            await editorHelper.verifyAndCloseAlert(previewFrame, 'page2_show');

            const backButton = previewFrame.locator('ons-back-button');
            await expect(backButton).toBeVisible();
            await expect(backButton).toBeEnabled();
            await previewFrame.locator('ons-back-button').click({ force: true });

            await editorHelper.verifyAndCloseAlert(previewFrame, 'page2_hide');
            await editorHelper.verifyAndCloseAlert(previewFrame, 'page2_destroy');
        });

        await test.step('動作検証(実機テストページ): ページ遷移と生成されたJSを確認', async () => {
            const testPage = await editorHelper.saveAndOpenTestPage();

            testPage.on('console', msg => console.log(`[TestPage Console] ${msg.type()}: ${msg.text()}`));
            testPage.on('pageerror', err => console.error(`[TestPage Error] ${err.message}`));

            const expectedScripts = [
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
                "document.addEventListener('init', (event) => {",
                `if (page.id === 'ons-page2') {`,
                "page2Init(event);",
                "page.addEventListener('show', page2Show);",
                "page.addEventListener('hide', page2Hide);",
                "page.addEventListener('destroy', page2Destroy);",
                "page.addEventListener('destroy', function(event) {",
                "page.removeEventListener('show', page2Show);",
            ];

            await verifyScriptInTestPage(testPage, expectedScripts);

            const currentUrl = new URL(testPage.url());
            currentUrl.searchParams.set('cb', Date.now().toString());
            await testPage.goto(currentUrl.toString(), { waitUntil: 'domcontentloaded' });

            const firstButton = testPage.locator('ons-button').first();
            await expect(firstButton).toBeVisible({ timeout: 15000 });

            await firstButton.click({ force: true });

            await editorHelper.verifyAndCloseAlert(testPage, 'page2_init');
            await editorHelper.verifyAndCloseAlert(testPage, 'page2_show');

            await testPage.locator('ons-back-button').click({ force: true });

            await editorHelper.verifyAndCloseAlert(testPage, 'page2_hide');
            await editorHelper.verifyAndCloseAlert(testPage, 'page2_destroy');

            await testPage.close();
        });
    });
});