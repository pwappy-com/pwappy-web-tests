import { test as base, expect, Page, Locator } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper, verifyScriptInTestPage } from '../../tools/editor-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

/**
 * テストフィクスチャを定義します。（テストごとに個別に作成・削除）
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
        await use(`app-prop-bld-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName }, use) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appKey = `key-prop-bld-${uniqueId}`.slice(0, 30);
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
test.describe('JSDocからのプロパティ解析機能のテスト（保存・実機連携あり）', () => {
    test.beforeEach(async ({ page }) => {
        await gotoDashboard(page);
    });

    /**
     * Web ComponentのJSDocに定義された@firesが、
     * イベントパネルにカスタムイベントとして正しく表示されるかを検証します。
     */
    test('JSDocの@firesがイベントパネルに正しく反映される', async ({ editorPage, editorHelper }) => {
        test.setTimeout(120000);

        const scriptName = 'MyEventComponent';
        const tagName = 'my-event-component';
        const eventName = 'my-custom-event';
        const eventComment = 'カスタムイベントの発火';
        const attachedScriptName = 'handleMyEvent';
        const alertText = 'Custom Event Fired!';

        // Web Componentのコード。JSDocに@firesディレクティブを定義
        const componentScript = `
/**
 * @customElement ${tagName}
 * @fires ${eventName} - ${eventComment}
 */
class ${scriptName} extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        this.render();
    }

    // クリック時にカスタムイベントを発火させるボタン
    fireEvent() {
        const event = new CustomEvent('${eventName}', {
            detail: { message: 'Hello from custom event!' },
            bubbles: true,
            composed: true
        });
        this.dispatchEvent(event);
    }

    render() {
        if (!this.shadowRoot) return;

        this.shadowRoot.innerHTML = \'<button>Fire Event</button>\';
        const button = this.shadowRoot.querySelector(\'button\');
        if (button) {
            button.addEventListener(\'click\', this.fireEvent.bind(this));
        }
    }
}
customElements.define('${tagName}', ${scriptName});
        `;

        await test.step('1. @firesを持つWeb Componentのスクリプトを作成する', async () => {
            // スクリプトタブに切り替える
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');

            // 新しいクラスタイプのスクリプトを追加
            await editorHelper.addNewScript(scriptName, 'class');

            // 作成したスクリプトをWeb Componentのコードに書き換える
            await editorHelper.editScriptContent(scriptName, componentScript);
        });

        await test.step('2. 作成したコンポーネントを配置し、イベントパネルを検証する', async () => {
            await editorHelper.openMoveingHandle('left');
            const appNode = editorPage.locator('#dom-tree > div[data-node-type="app"]');

            // ツールボックスから作成したコンポーネントをappノードに追加
            const componentNode = await editorHelper.addComponent(tagName, appNode);

            // 追加したコンポーネントを選択
            await editorHelper.selectNodeInDomTree(componentNode);

            // イベントタブに切り替える
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'イベント');

            // イベントコンテナを取得
            const eventContainer = scriptContainer.locator('event-container');

            // @firesで定義したイベントがリストに表示されていることを検証
            const eventRow = eventContainer.locator('.editor-row', { hasText: eventName });
            await expect(eventRow).toBeVisible();
            await expect(eventRow.locator('.comment')).toHaveText(eventComment);
        });

        await test.step('3. カスタムイベントにスクリプトを割り当てて動作を検証する', async () => {
            const scriptContainer = editorPage.locator('script-container');
            const eventContainer = scriptContainer.locator('event-container');
            const eventRow = eventContainer.locator('.editor-row', { hasText: eventName });

            // イベント行の「+」ボタンをクリックしてスクリプト追加メニューを開く
            await eventRow.getByRole('button').click();

            // スクリプト名を入力して追加
            const addMenu = eventContainer.locator('#scriptAddMenu');
            await expect(addMenu).toBeVisible();
            const scriptNameInput = addMenu.locator('input#script-name');
            await expect(scriptNameInput).toBeEditable();
            await scriptNameInput.fill(attachedScriptName);
            await addMenu.getByRole('button', { name: '追加' }).click();
            await expect(addMenu).toBeHidden();

            // 追加したスクリプトを編集
            await editorHelper.editScript({ eventName: eventName, scriptName: attachedScriptName, scriptContent: `function ${attachedScriptName}(event) {\n    ons.notification.alert('${alertText}');\n}` });

            // 動作モードに切り替え
            await editorHelper.closeMoveingHandle();
            await editorHelper.switchToRunModeAndVerify();

            const previewFrame = editorPage.frameLocator('#ios-container #renderzone');

            // Web Component内のボタンをクリックしてイベントを発火させる
            await previewFrame.locator(tagName).getByRole('button', { name: 'Fire Event' }).click();

            // 割り当てたスクリプトが実行され、アラートが表示されることを確認
            await editorHelper.verifyAndCloseAlert(previewFrame, alertText);
        });

        await test.step('4. 動作検証(実機テストページ): ページ遷移と生成されたJSを確認', async () => {
            const testPage = await editorHelper.saveAndOpenTestPage();

            testPage.on('console', msg => console.log(`[TestPage Console] ${msg.type()}: ${msg.text()}`));
            testPage.on('pageerror', err => console.error(`[TestPage Error] ${err.message}`));

            const expectedScripts = [
                `function ${attachedScriptName}(event) {`,
                `ons.notification.alert('${alertText}');`,
                `myeventcomponent1_element.addEventListener('${eventName}', ${attachedScriptName});`
            ];

            // 1. デプロイ完了待ち
            await verifyScriptInTestPage(testPage, expectedScripts);

            // 2. キャッシュを回避してロード
            const currentUrl = new URL(testPage.url());
            currentUrl.searchParams.set('cb', Date.now().toString());
            await testPage.goto(currentUrl.toString(), { waitUntil: 'domcontentloaded' });

            // 3. 実際の動作確認
            const fireEventButton = testPage.locator(tagName).getByRole('button', { name: 'Fire Event' });
            await expect(fireEventButton).toBeVisible({ timeout: 15000 });

            await fireEventButton.click({ force: true });
            await editorHelper.verifyAndCloseAlert(testPage, alertText);

            await testPage.close();
        });
    });
});