import { test as base, expect, Page, Locator } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper, verifyScriptInTestPage } from '../../tools/editor-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

/**
 * テストフィクスチャを定義します。
 * 各テストの前に自動的にアプリケーションを作成し、エディタを開きます。
 * テスト終了後にはアプリケーションを削除し、クリーンな状態を保ちます。
 */
type EditorFixtures = {
    editorPage: Page;
    appName: string;
    editorHelper: EditorHelper;
};

const test = base.extend<EditorFixtures>({
    appName: async ({ }, use) => {
        // 各テストでユニークなアプリケーション名とキーを生成
        const timestamp = Date.now().toString();
        const uniqueId = `${testRunSuffix}-${timestamp}`;
        await use(`test-app-prop-parse-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName }, use) => {
        const timestamp = Date.now().toString();
        const uniqueId = `${testRunSuffix}-${timestamp}`;
        const appKey = `test-key-prop-parse-${uniqueId}`.slice(0, 30);
        await createApp(page, appName, appKey);
        const editorPage = await openEditor(page, context, appName);

        // テスト本体にエディタページを渡す
        await use(editorPage);

        // テスト終了後のクリーンアップ
        await editorPage.close();
        await deleteApp(page, appName);
    },
    editorHelper: async ({ editorPage, isMobile }, use) => {
        const helper = new EditorHelper(editorPage, isMobile);
        await use(helper);
    },
});

// --- テストスイート ---
test.describe('JSDocからのプロパティ解析機能のテスト', () => {
    /**
     * 各テストの実行前に、認証とダッシュボードへのアクセスを行います。
     */
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

    /**
     * Web ComponentのJSDocに定義された@propertyが、
     * プロパティパネルで正しいUIとしてレンダリングされるかを検証します。
     */
    test('JSDocの@propertyがプロパティパネルに正しく反映される', async ({ editorPage, editorHelper }) => {

        test.setTimeout(120000);

        const scriptName = 'MyTestComponent';
        const tagName = 'my-test-component';

        // Web Componentのコード。JSDocに各種プロパティを定義
        const componentScript = `
/**
 * @customElement ${tagName}
 * @property {string} str-prop - 文字列プロパティ
 * @property {number} num-prop - 数値プロパティ
 * @property {boolean} bool-prop - ブールプロパティ
 * @property {("A" | "B" | "C")} select-prop - 選択プロパティ
 * @property {("A" | "B" | "C")[]} mulselect-prop - 複数選択プロパティ
 */
class ${scriptName} extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        
        // JSDocのプロパティに対応するデフォルト値を設定
        this['str-prop'] = 'default string';
        this['num-prop'] = 123;
        this['bool-prop'] = false;
        this['select-prop'] = 'A';
        this['mulselect-prop'] = [];
    }

    connectedCallback() {
        this.render();
    }

    // observedAttributesとattributeChangedCallbackを定義して属性の変更を監視
    static get observedAttributes() {
        return ['str-prop', 'num-prop', 'bool-prop', 'select-prop', 'mulselect-prop'];
    }

    attributeChangedCallback(name, oldValue, newValue) {
        // ここではレンダリングの更新は不要（テスト目的のため）
        // 必要に応じてプロパティを更新するロジックを追加
    }

    render() {
        if (this.shadowRoot) {
            this.shadowRoot.innerHTML = \`<div>Test Component Content</div>\`;
        }
    }
}
customElements.define('${tagName}', ${scriptName});
        `;

        await test.step('1. Web Componentのスクリプトを作成・編集する', async () => {
            // スクリプトタブに切り替える
            editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');

            // 新しいクラスタイプのスクリプトを追加
            await editorHelper.addNewScript(scriptName, 'class');

            // 作成したスクリプトをWeb Componentのコードに書き換える
            await editorHelper.editScriptContent(scriptName, componentScript);
        });

        await test.step('2. 作成したコンポーネントを配置し、プロパティパネルを検証する', async () => {
            // appノードを取得
            const appNode = editorPage.locator('#dom-tree > div[data-node-type="app"]');

            // ツールボックスから作成したコンポーネントをappノードに追加
            const componentNode = await editorHelper.addComponent(tagName, appNode);

            // 追加したコンポーネントを選択
            await editorHelper.selectNodeInDomTree(componentNode);

            // プロパティコンテナを取得
            editorHelper.openMoveingHandle('right');
            const propertyContainer = editorHelper.getPropertyContainer();
            await expect(propertyContainer).toBeVisible();

            // 各プロパティに対応する入力UIが存在し、正しいタイプであることを検証
            await expect(propertyContainer.locator('attribute-input[data-attribute-type="str-prop"]')).toBeVisible();
            await expect(propertyContainer.locator('attribute-input[data-attribute-type="num-prop"]')).toBeVisible();
            await expect(propertyContainer.locator('input[type="checkbox"][data-attribute-type="bool-prop"]')).toBeVisible();

            // selectプロパティの検証
            const selectProp = propertyContainer.locator('attribute-select[data-attribute-type="select-prop"]');
            await expect(selectProp).toBeVisible();
            await expect(selectProp).not.toHaveAttribute('multiple'); // multiple属性がないことを確認

            // multiselectプロパティの検証
            const multiSelectProp = propertyContainer.locator('attribute-select[data-attribute-type="mulselect-prop"]');
            await expect(multiSelectProp).toBeVisible();
            await expect(multiSelectProp).toHaveAttribute('multiple'); // multiple属性があることを確認
        });
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
            //await eventRow.getByRole('button', { name: 'スクリプトの追加' }).click();
            await eventRow.getByRole('button').click();

            // スクリプト名を入力して追加
            const addMenu = eventContainer.locator('#scriptAddMenu');
            await expect(addMenu).toBeVisible();
            await addMenu.locator('input#script-name').fill(attachedScriptName);
            await addMenu.getByRole('button', { name: '追加' }).click();
            await expect(addMenu).toBeHidden();

            // 追加したスクリプトを編集
            await editorHelper.editScript({ eventName: eventName, scriptName: attachedScriptName, scriptContent: `function ${attachedScriptName}(event) {\nons.notification.alert('${alertText}');` });

            // 動作モードに切り替え
            await editorHelper.closeMoveingHandle();
            await editorHelper.switchToRunModeAndVerify();

            const previewFrame = editorPage.frameLocator('#renderzone');

            // Web Component内のボタンをクリックしてイベントを発火させる
            await previewFrame.locator(tagName).getByRole('button', { name: 'Fire Event' }).click();

            // 割り当てたスクリプトが実行され、アラートが表示されることを確認
            await editorHelper.verifyAndCloseAlert(previewFrame, alertText);
        });

        await test.step('4. 動作検証(実機テストページ): ページ遷移と生成されたJSを確認', async () => {
            const testPage = await editorHelper.saveAndOpenTestPage();
            await testPage.waitForLoadState('domcontentloaded');

            // --- イベントリスナーが正しく設定されているかを確認 ---
            const expectedScripts = [
                // スクリプト自体の定義
                `function ${attachedScriptName}(event) {`,
                `ons.notification.alert('${alertText}');`,
                // イベントリスナーの登録
                `myeventcomponent1_element.addEventListener('${eventName}', ${attachedScriptName});`
            ];
            await verifyScriptInTestPage(testPage, expectedScripts);

            // --- 実際の動作確認 ---
            await testPage.locator(tagName).getByRole('button', { name: 'Fire Event' }).click();
            await editorHelper.verifyAndCloseAlert(testPage, alertText);

            await testPage.close();
        });
    });
});