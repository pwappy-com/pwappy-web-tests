import { test as base, expect, Page, Locator } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

/**
 * テストフィクスチャの設定
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
        await use(`script-adv-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName }, use) => {
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
        const appKey = `adv-key-${uniqueId}`.slice(0, 30);
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

test.describe('エディタ内：スクリプト高度機能・連携テスト', () => {

    test.beforeEach(async ({ page, context }) => {
        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        const domain = testUrl.hostname;
        await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/' },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/' },
            { name: 'pwappy_login', value: '1', domain: domain, path: '/' },
        ]);
        await page.goto(String(process.env.PWAPPY_TEST_BASE_URL), { waitUntil: 'domcontentloaded' });
        // 起動時のローディング待機
        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });
    });

    test('サービスワーカー管理：イベント定義、スクリプト紐付け、削除', async ({ editorPage, editorHelper }) => {
        const swEventName = 'pushDummy';
        const scriptName = 'handlePushNotification';
        const scriptContent = `
/**
 * @param {Event} event
 */
function ${scriptName}(event) {
    console.log('Push received');
}
        `;

        await test.step('1. サービスワーカー用のスクリプトを作成', async () => {
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await editorHelper.addNewScript(scriptName, 'function');
            await editorHelper.editScriptContent(scriptName, scriptContent);
        });

        await test.step('2. サービスワーカーイベントを定義してスクリプトを紐付け', async () => {
            // Service Workerタブへ切り替え、イベント定義を追加
            await editorHelper.addCustomServiceWorkerEventDefinition({
                eventName: swEventName,
                comment: 'Push通知受信時'
            });

            const swContainer = editorPage.locator('serviceworker-container');
            const eventRow = swContainer.locator(`.editor-row:has-text("${swEventName}")`);

            // スクリプト追加ボタンをクリック
            await eventRow.getByTitle('スクリプトの追加').click();

            // メニューからスクリプトを選択して追加
            const addMenu = swContainer.locator('#scriptAddMenu');
            await expect(addMenu).toBeVisible();
            await addMenu.locator('#script-name').fill(scriptName);
            await addMenu.getByRole('button', { name: '追加' }).click();
            await expect(addMenu).toBeHidden();

            // 紐付けられたスクリプトが表示されているか確認
            await expect(eventRow.locator('.editor-row-right-item', { hasText: scriptName })).toBeVisible();
        });

        await test.step('3. 紐付けの解除（削除）', async () => {
            const swContainer = editorPage.locator('serviceworker-container');
            const eventRow = swContainer.locator(`.editor-row:has-text("${swEventName}")`);

            // 削除ボタン（ゴミ箱アイコン）をクリック
            const scriptItem = eventRow.locator('.editor-row-right-item', { hasText: scriptName });
            const deleteBtn = scriptItem.getByTitle('スクリプトの削除');

            // 1回目：削除予約（アイコンがチェックに変わる）
            await deleteBtn.click();
            await expect(deleteBtn.locator('i')).toHaveClass(/fa-check/);

            // 2回目：削除確定
            await deleteBtn.click();

            // 行からスクリプト名が消えていることを確認
            await expect(scriptItem).toBeHidden();
        });
    });

    test('スクリプト削除時のクリーンアップ：依存関係（イベント紐付け）の自動解除', async ({ editorPage, editorHelper }) => {
        const scriptName = 'clickBtnHandler';

        await test.step('1. セットアップ：ボタン配置とスクリプト作成、紐付け', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();

            // スクリプト作成
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await editorHelper.addNewScript(scriptName);

            // ボタンのクリックイベントに紐付け
            await editorHelper.addScriptToNodeEvent({
                nodeLocator: buttonNode,
                eventName: 'click',
                scriptName: scriptName
            });
        });

        await test.step('2. スクリプトを削除（ゴミ箱へ移動）', async () => {
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');

            const scriptRow = scriptContainer.locator('.editor-row', { hasText: scriptName });
            const deleteBtn = scriptRow.getByTitle('ゴミ箱に移動');

            // 1回目クリック（予約）
            await deleteBtn.click();
            // 2回目クリック（実行）
            await deleteBtn.click();

            // リストから消えたことを確認
            await expect(scriptRow).toBeHidden();
        });

        await test.step('3. イベント紐付けが自動解除されていることを検証', async () => {
            // イベントタブに戻る
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'イベント');
            const eventContainer = scriptContainer.locator('event-container');

            // clickイベント行を探す
            const eventRow = eventContainer.locator(`.editor-row:has(div.label:text-is("click"))`);

            // 削除したスクリプト名が表示されていないことを確認
            await expect(eventRow.locator('.editor-row-right-item', { hasText: scriptName })).toBeHidden();
        });
    });

    test('スクリプトの復元とWeb Component（Toolbox）同期', async ({ editorPage, editorHelper }) => {
        const componentTagName = 'my-custom-btn';
        const scriptName = 'MyCustomBtn';
        const componentScript = `
/**
 * @customElement ${componentTagName}
 */
class ${scriptName} extends HTMLElement {
    constructor() { super(); }
}
customElements.define('${componentTagName}', ${scriptName});
        `;

        await test.step('1. Web Component定義スクリプトを作成', async () => {
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');

            await editorHelper.addNewScript(scriptName, 'class');
            await editorHelper.editScriptContent(scriptName, componentScript);
        });

        await test.step('2. Toolboxにコンポーネントが追加されていることを確認', async () => {
            await editorHelper.openMoveingHandle('left');
            const toolBox = editorPage.locator('tool-box');
            await expect(toolBox.locator('tool-box-item', { hasText: componentTagName })).toBeVisible();
        });

        await test.step('3. スクリプトを削除し、Toolboxからも消えることを確認', async () => {
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');

            // エディタが開いている状態なので、スクリプトタブをクリックしてリスト表示に戻る
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');

            const scriptRow = scriptContainer.locator('.editor-row', { hasText: scriptName });

            // 削除実行
            const deleteBtn = scriptRow.getByTitle('ゴミ箱に移動');
            await deleteBtn.click(); // 予約
            await deleteBtn.click(); // 確定

            await expect(scriptRow).toBeHidden();

            // Toolbox確認
            await editorHelper.openMoveingHandle('left');
            const toolBox = editorPage.locator('tool-box');
            await expect(toolBox.locator('tool-box-item', { hasText: componentTagName })).toBeHidden();
        });

        await test.step('4. スクリプトを復元し、Toolboxに復活することを確認', async () => {
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');

            // ゴミ箱を開く
            await scriptContainer.locator('#fab-trash-box').click();
            const trashBox = scriptContainer.locator('.script-trash-box');
            await expect(trashBox).toBeVisible();

            // 復元ボタン（回転矢印アイコン）をクリック
            const restoreBtn = trashBox.locator('.script-trash-box-item-button[title="戻す"]');
            await restoreBtn.click();

            // ゴミ箱を閉じる（外部クリック扱いにするため、別の場所をクリック）
            // await editorPage.locator('.title-bar .title').first().click();
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');

            // スクリプト一覧に戻っているか
            const scriptRow = scriptContainer.locator('.editor-row', { hasText: scriptName });
            await expect(scriptRow).toBeVisible();

            // Toolboxに復活しているか
            await editorHelper.openMoveingHandle('left');
            const toolBox = editorPage.locator('tool-box');
            await expect(toolBox.locator('tool-box-item', { hasText: componentTagName })).toBeVisible();
        });
    });

    test('コーディング支援：IDペーストと影響範囲検索', async ({ editorPage, editorHelper }) => {
        const scriptName = 'testIdPaste';
        const buttonId = 'target-btn';

        await test.step('1. セットアップ：ID付きボタンとスクリプトを作成', async () => {
            // ページとボタン作成
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            // プロパティでIDを設定
            await editorHelper.openMoveingHandle('right');
            const idInput = editorHelper.getPropertyInput('domId').locator('input');
            await idInput.fill(buttonId);
            await idInput.press('Enter');

            // スクリプト作成
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await editorHelper.addNewScript(scriptName);
        });

        await test.step('2. エディタへのIDペースト機能の検証', async () => {
            // スクリプト編集画面を開く
            await editorHelper.openScriptForEditing(scriptName);

            // プロパティタブ（属性）を開き、ID行にあるペーストボタンをクリック
            await editorHelper.switchTabInContainer(editorPage.locator('property-container'), '属性');
            const propertyContainer = editorHelper.getPropertyContainer();

            // IDラベルの横にある「スクリプトにIDを貼り付け」ボタン（fa-codeアイコン）を探す
            // 構造: .editor-row-left-item > .label(ID) + button
            const idRow = propertyContainer.locator('.editor-row-left-item', { hasText: 'ID' });
            const pasteBtn = idRow.locator('button[title="スクリプトにIDを貼り付け"]');

            await expect(pasteBtn).toBeVisible();
            await pasteBtn.click();

            // エディタの内容を取得し、ID取得コードが挿入されているか確認
            const editorContent = await editorHelper.getMonacoEditorContent();
            expect(editorContent).toContain(`const targetBtn = document.getElementById('${buttonId}');`);

            // エディタを閉じる（保存して戻る）
            await editorPage.locator('script-container #fab-save').click();

            // エディタが開いている状態なので、スクリプトタブをクリックしてリスト表示に戻る
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');

            await editorPage.locator('script-container #script-list-container').waitFor({ state: 'visible' });
        });

        await test.step('3. スクリプトの影響範囲（使用箇所）検索機能の検証', async () => {
            // 事前準備：スクリプトをイベントに紐付けておく
            const buttonNode = (await editorHelper.selectNodeByAttribute('data-node-dom-id', buttonId));
            await editorHelper.addScriptToNodeEvent({
                nodeLocator: buttonNode,
                eventName: 'click',
                scriptName: scriptName
            });

            // スクリプト一覧に戻る
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');

            // 影響範囲ボタン（目のアイコン）をクリック
            const scriptRow = scriptContainer.locator('.editor-row', { hasText: scriptName });
            const usageBtn = scriptRow.getByTitle('割り当てられているイベント');
            await usageBtn.click();

            // サブウィンドウが表示され、紐付け情報が出ているか確認
            const subWindow = editorPage.locator('event-attach-script-search-sub-window');
            await expect(subWindow).toBeVisible();

            // 検索結果にイベント名とコンポーネント名が含まれているか
            await expect(subWindow).toContainText('click');
            await expect(subWindow).toContainText(buttonId); // IDが表示されるはず

            // 閉じる（外部クリック）
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await expect(subWindow).toBeHidden();
        });
    });

});