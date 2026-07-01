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

    test('グローバルなイベント委譲による特定要素(pタグ)へのクリックイベントで、イベントオブジェクト(PointerEvent)が正しく引き渡されること', async ({ editorPage, editorHelper }) => {
        test.setTimeout(120000);

        let pageNode: Locator;
        let targetPTagId: string;
        const scriptName = 'handlePClick';
        const alertSuccessText = 'pointer_event_received';
        const alertFailText = 'pointer_event_undefined';
        const eventComment = 'pタグへの委譲クリック';

        // 割り当てるスクリプト。標準の alert() を使って安全にPointerEventを検証します
        const scriptBody = `function ${scriptName}(event) {
    if (event.target.closest('ons-alert-dialog')) return;
    if (event && (event.type === 'click' || event.type === 'pointerdown' || event.type === 'pointerup')) {
        alert('${alertSuccessText}');
    } else {
        alert('${alertFailText}');
    }
}`;

        await test.step('1. セットアップ: ページを作成し、ons-navigatorに起動ページとして設定して表示を保証する', async () => {
            await editorHelper.openMoveingHandle('left');
            const appNode = editorPage.locator('#dom-tree > div[data-node-type="app"]');
            const rawAppId = await appNode.getAttribute('data-node-id');
            expect(rawAppId).not.toBeNull();
            const appId = rawAppId as string;

            pageNode = await editorHelper.addPage();
            const rawPageId = await pageNode.getAttribute('data-node-id');
            expect(rawPageId).not.toBeNull();
            const pageId = rawPageId as string;

            await editorHelper.selectNodeInDomTree(pageNode);
            await editorHelper.openMoveingHandle('right');
            const idInput = editorHelper.getPropertyInput('domId').locator('input');
            await expect(idInput).toBeEditable();
            await idInput.blur();
            await editorHelper.closeMoveingHandle();

            await editorHelper.switchTopLevelTemplate(appId);
            await editorHelper.selectNodeInDomTree(appNode);

            const navigatorNode = await editorHelper.addComponent('ons-navigator', appNode);
            await editorHelper.openMoveingHandle('right');
            const navigatorPageAttribute = editorHelper.getPropertyInput('page');
            const navAttInput = navigatorPageAttribute.locator("input");
            await expect(navAttInput).toBeEditable();

            await navAttInput.fill('page1.html');
            await navAttInput.press('Enter');
            await navAttInput.blur();
            await editorHelper.closeMoveingHandle();

            await editorHelper.switchTopLevelTemplate(pageId);

            const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
            const pNode = await editorHelper.addComponentAsHtmlTag('p', contentAreaSelector);

            const rawPId = await pNode.getAttribute('data-node-dom-id');
            expect(rawPId).not.toBeNull();
            targetPTagId = rawPId as string;

            await editorHelper.selectNodeInDomTree(pNode);

            const loadingOverlay = editorPage.locator('app-container-loading-overlay');
            await expect(loadingOverlay).toBeHidden({ timeout: 30000 });
            await editorPage.waitForLoadState('networkidle');
        });

        await test.step('2. イベント委譲を定義: ターゲット「document」、イベント「click」', async () => {
            await editorHelper.addCustomEventDefinition({
                listenerTarget: 'document',
                eventName: 'click',
                comment: eventComment
            });

            const scriptContainer = editorPage.locator('script-container');
            const eventContainer = scriptContainer.locator('event-container');
            const eventRow = eventContainer.locator('.editor-row', { hasText: 'click' })
                .filter({ hasText: eventComment });

            await eventRow.getByTitle('スクリプトの追加').click();
            const addMenu = eventContainer.locator('#scriptAddMenu');
            await expect(addMenu).toBeVisible();
            const scriptNameInput = addMenu.locator('input#script-name');
            await expect(scriptNameInput).toBeEditable();
            await scriptNameInput.fill(scriptName);
            await addMenu.getByRole('button', { name: '追加' }).click();
            await expect(addMenu).toBeHidden();

            await editorHelper.editScript({
                eventName: 'click',
                scriptName: scriptName,
                scriptContent: scriptBody
            });
            await editorHelper.closeMoveingHandle();
        });

        await test.step('3. プレビュー環境での動作確認', async () => {
            let alertReceived = false;
            editorPage.once('dialog', async dialog => {
                expect(dialog.message()).toBe(alertSuccessText);
                alertReceived = true;
                await dialog.accept(); // ダイアログを閉じる
            });

            await editorHelper.switchToRunModeAndVerify();

            const previewFrame = editorHelper.getPreviewFrame();
            const targetP = previewFrame.locator(`#${targetPTagId}`);

            // 【変更点】物理サイズが0になる空タグのため、toBeVisibleではなくtoBeAttachedを使用
            await expect(targetP).toBeAttached({ timeout: 15000 });

            // 【変更点】サイズ0の要素からでも確実にイベントを発火させるため、JSネイティブのクリックを利用
            await targetP.evaluate((el: HTMLElement) => el.click());

            await expect.poll(() => alertReceived).toBe(true);
        });

        await test.step('4. 動作検証(実機テストページ): 生成コードの検証', async () => {
            const testPage = await editorHelper.saveAndOpenTestPage();

            let testAlertReceived = false;
            testPage.once('dialog', async dialog => {
                expect(dialog.message()).toBe(alertSuccessText);
                testAlertReceived = true;
                await dialog.accept();
            });

            const expectedScripts = [
                `function ${scriptName}(event) {`,
                `document.addEventListener('click', function(event, ...args) {`,
                `if(event.target.closest('#${targetPTagId}')) {`,
                `${scriptName}(event, ...args);`
            ];

            await verifyScriptInTestPage(testPage, expectedScripts);

            // キャッシュを回避して再ロード
            const currentUrl = new URL(testPage.url());
            currentUrl.searchParams.set('cb', Date.now().toString());
            await testPage.goto(currentUrl.toString(), { waitUntil: 'domcontentloaded' });

            const targetPInTest = testPage.locator(`#${targetPTagId}`);

            // 【変更点】実機テスト環境でも同様に Attached と evaluate click を使用
            await expect(targetPInTest).toBeAttached({ timeout: 15000 });
            await targetPInTest.evaluate((el: HTMLElement) => el.click());

            await expect.poll(() => testAlertReceived).toBe(true);
            await testPage.close();
        });
    });
});