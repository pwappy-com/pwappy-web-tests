import { test as base, expect, Page } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';
import { STORAGE_STATE } from '../../constants';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

let appName: string;
let appKey: string;

/**
 * テストフィクスチャを定義します。
 */
type EditorFixtures = {
    editorPage: Page;
    editorHelper: EditorHelper;
};

const test = base.extend<EditorFixtures>({
    editorPage: async ({ page, context }, use) => {
        await gotoDashboard(page);
        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });

        // 作成済みの共有アプリ詳細画面へ移動
        const appRow = page.locator('.app-card', { has: page.locator('.app-key', { hasText: appKey }) }).first();
        await expect(appRow).toBeVisible({ timeout: 15000 });
        await appRow.click({ force: true });
        await expect(page.locator('.detail-tab.active')).toBeVisible({ timeout: 10000 });

        const editorPage = await openEditor(page, context, appName);
        await use(editorPage);
        await editorPage.close();
    },
    editorHelper: async ({ editorPage, isMobile }, use) => {
        const helper = new EditorHelper(editorPage, isMobile);
        await use(helper);
    },
});

// テスト全体の開始前に、アプリを1回だけ作成する
test.beforeAll(async ({ browser }) => {
    const reversedTimestamp = Date.now().toString().split('').reverse().join('');
    const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
    appName = `app-prop-par-${uniqueId}`.slice(0, 30);
    appKey = `key-prop-par-${uniqueId}`.slice(0, 30);

    // 認証済みの状態を引き継ぐためのコンテキストを作成（STORAGE_STATE定数を使用）
    const context = await browser.newContext({ storageState: STORAGE_STATE });
    const page = await context.newPage();

    await gotoDashboard(page);
    await createApp(page, appName, appKey);

    await context.close();
});

// すべてのテストが終了した後に、アプリを1回だけ削除する
test.afterAll(async ({ browser }) => {
    if (appKey) {
        const context = await browser.newContext({ storageState: STORAGE_STATE });
        const page = await context.newPage();

        await gotoDashboard(page);
        await deleteApp(page, appKey);

        await context.close();
    }
});

// --- テストスイート ---
test.describe('JSDocからのプロパティ解析機能のテスト（保存なし）', () => {
    /**
     * 各テストの実行前に、認証とダッシュボードへのアクセスを行います。
     */
    test.beforeEach(async ({ page, context, isMobile }) => {
        await gotoDashboard(page);
    });

    /**
     * Web ComponentのJSDocに定義された@propertyが、
     * プロパティパネルで正しいUIとしてレンダリングされるかを検証します。
     */
    test('JSDocの@propertyがプロパティパネルに正しく反映される', async ({ editorPage, editorHelper }) => {

        test.setTimeout(120000);

        const scriptName = 'MyTestComponent';
        const tagName = 'my-test-component';

        // Web Component of JSDoc properties defined
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
            await editorHelper.openMoveingHandle('right');
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
            await editorHelper.openMoveingHandle('right');
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
});