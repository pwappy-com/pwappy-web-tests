import { test as base, expect, Page, BrowserContext, Locator } from '@playwright/test';
import 'dotenv/config';

import { createApp, deleteApp, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

/**
 * テストフィクスチャを拡張し、各テストでエディタページを自動的にセットアップ・クリーンアップします。
 */
type EditorFixtures = {
    editorPage: Page;
    appName: string;
    editorHelper: EditorHelper;
};
const test = base.extend<EditorFixtures>({
    // 各テストでユニークなアプリケーション名を提供するフィクスチャ
    appName: async ({ }, use) => {
        const timestamp = Date.now().toString();
        const uniqueId = `${testRunSuffix}-${timestamp}`;
        await use(`test-app-${uniqueId}`.slice(0, 30));
    },
    // アプリ作成からエディタを開くまでを自動化し、テスト終了後に自動でクリーンアップするフィクスチャ
    editorPage: async ({ page, context, appName }, use) => {
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
        const appKey = `test-key-${uniqueId}`.slice(0, 30);
        await createApp(page, appName, appKey);
        const editorPage = await openEditor(page, context, appName);

        // テスト本体（use）に準備した editorPage を渡す
        await use(editorPage);

        // テスト終了後のクリーンアップ処理
        await editorPage.close();
        await deleteApp(page, appName);
    },
    editorHelper: async ({ editorPage, isMobile }, use) => {
        const helper = new EditorHelper(editorPage, isMobile);
        await use(helper);
    },
});

// --- テストスイート ---
test.describe('エディタ内機能のテスト', () => {
    /**
     * 各テストの実行前に認証とダッシュボードへのアクセスを行います。
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

    test('コンポーネントのプロパティを編集できる', async ({ editorPage, editorHelper }) => {
        let buttonNode: Locator;
        let pageNode: Locator;
        await test.step('セットアップ: ページとボタンをエディタに追加', async () => {
            // ヘルパー関数でセットアップを簡潔に
            const setup = await editorHelper.setupPageWithButton();
            pageNode = setup.pageNode;
            buttonNode = setup.buttonNode;
        });

        await test.step('検証: DOMツリーのノード選択に応じてプロパティ表示が追従すること', async () => {
            editorHelper.openMoveingHandle('left');
            const domTree = editorPage.locator('#dom-tree');
            editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            const propertyIdInput = propertyContainer.locator('input[data-attribute-type="domId"]');

            // 「コンテンツ」ノードのテキスト部分をクリックし、対応するプロパティが表示されるか確認
            editorHelper.openMoveingHandle('left');
            const contentNode = domTree.locator('div[data-node-explain="コンテンツ"]');
            await contentNode.getByText('コンテンツ', { exact: true }).click();

            editorHelper.openMoveingHandle('right');
            await propertyContainer.getByText('属性', { exact: true }).click();
            await expect(propertyIdInput).toHaveValue('div2');

            editorHelper.openMoveingHandle('left');
            // 次に「ボタン」ノードをクリックし、プロパティ表示が切り替わるか確認
            await domTree.locator('.node[data-node-type="ons-button"]').click();
            await expect(propertyIdInput).toHaveValue('ons-button1');
        });

        await test.step('検証: 属性(text)の変更がプレビューに反映されること', async () => {
            editorHelper.closeMoveingHandle();
            const propertyTextInput = editorPage.locator('property-container input[data-attribute-type="text"]');
            const previewButton = editorPage.locator('#renderzone').contentFrame().locator('ons-button');

            editorHelper.openMoveingHandle('right');
            await propertyTextInput.fill('Button2');
            await propertyTextInput.press('Enter');

            await expect(previewButton).toHaveText('Button2');
        });

        await test.step('検証: スタイル(CSS)の変更がプレビューに反映されること', async () => {
            const propertyContainer = editorPage.locator('property-container');

            // スタイルタブに切り替え
            await propertyContainer.getByText('スタイル', { exact: true }).click();

            // Monaco Editorの要素を特定
            const styleEditor = propertyContainer.locator('#style-container > .monaco-editor');
            await expect(styleEditor).toBeVisible();
            const styleEditorContent = styleEditor.locator('.view-lines');

            // Monaco Editorを精密に操作する
            await styleEditor.locator('div:nth-child(2) > span > .mtk1').click();
            await editorPage.keyboard.press('Control+A');
            await editorPage.keyboard.press('Backspace');

            // 現在のブラウザ名を取得
            const browserName = editorPage.context().browser()?.browserType().name();


            //await styleEditor.getByRole('textbox').fill('element.style {\n    background : red;');
            const styleValue = 'element.style {\n    background : red;';
            if (browserName === 'chromium') {
                // Chrome (Chromium) の場合の処理
                // Monaco Editorは内部的に<textarea>を持っているので、それに対してfillするのが速くて確実
                await styleEditor.locator('textarea').fill(styleValue);
            } else if (browserName === 'webkit') {
                await styleEditor.locator('textarea').fill(styleValue);
            } else if (browserName === 'firefox') {
                // Firefox の場合の処理
                // Firefoxではfillが効かないことがあるため、キーボード入力をシミュレートする
                const viewLine = styleEditor.locator('.view-line').first(); // 確実に最初の行を掴む
                await expect(viewLine).toBeVisible();
                await viewLine.pressSequentially(styleValue); // 安定させるために少しdelayを入れるのも有効
            } else {
                // その他のブラウザ用のフォールバック（Firefoxと同じ方法を試す）
                console.warn(`Unsupported browser for optimized fill: ${browserName}. Falling back to pressSequentially.`);
                const viewLine = styleEditor.locator('.view-line').first();
                await expect(viewLine).toBeVisible();
                await viewLine.pressSequentially(styleValue);
            }


            // プレビューのボタンにスタイルが適用されていることを最終確認
            const previewButton = editorPage.locator('#renderzone').contentFrame().locator('ons-button');
            await expect(previewButton).toHaveCSS('background-color', 'rgb(255, 0, 0)');
        });
    });

    test('属性のinput[text]を「要素に」追加した場合のライフサイクル検証', async ({ editorPage, editorHelper }) => {
        const attrName = 'element-specific-attr';
        const attrValue = 'element-value';
        let buttonNode: Locator;

        await test.step('セットアップ: ページとボタンを追加', async () => {
            const setup = await editorHelper.setupPageWithButton();
            buttonNode = setup.buttonNode;
            await editorHelper.selectNodeInDomTree(buttonNode);
        });

        await test.step('検証: 属性の追加、値の変更、空文字設定、クリアボタンの動作', async () => {
            editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            const previewButton = editorPage.locator('#renderzone').contentFrame().locator('ons-button');

            await propertyContainer.getByTitle('属性を編集').click();
            await propertyContainer.getByRole('button', { name: '要素に追加' }).click();
            await propertyContainer.getByRole('combobox', { name: '属性名:' }).fill(attrName);
            await propertyContainer.getByRole('button', { name: '追加' }).click();

            const targetInput = propertyContainer.locator(`input[data-attribute-type="${attrName}"]`);
            await expect(targetInput).toBeVisible();

            // 値を設定し、プレビューに反映される
            await targetInput.fill(attrValue);
            await targetInput.press('Enter');
            await expect(previewButton).toHaveAttribute(attrName, attrValue);

            // 値を手動で空文字にした場合の動作検証
            await targetInput.fill('');
            await targetInput.press('Enter');
            await expect(targetInput).toHaveValue('');
            await expect(previewButton).toHaveAttribute(attrName, '');

            // クリアボタンをクリックすると、入力欄自体が非表示になる
            // 属性編集モーダルがもし表示されていたら、それが閉じるのを待つ
            await expect(editorPage.locator('#attributeList')).toBeHidden();

            const clearButton = targetInput.locator('+ .clear-button');
            // ボタンがクリック可能になるまで待機（念のため）
            await expect(clearButton).toBeEnabled();
            // クリックを実行
            await clearButton.click();
            await expect(previewButton).not.toHaveAttribute(attrName);
            await expect(targetInput).toBeHidden();
        });

        await test.step('検証: 属性定義自体を削除できること', async () => {
            const propertyContainer = editorPage.locator('property-container');

            // 削除フローをテストするため、再度同じ属性を追加する
            await propertyContainer.getByTitle('属性を編集').click();
            await propertyContainer.getByRole('button', { name: '要素に追加' }).click();
            await propertyContainer.getByRole('combobox', { name: '属性名:' }).fill(attrName);
            await propertyContainer.getByRole('button', { name: '追加' }).click();

            // 属性を削除するために、まず属性編集モーダルを開き直す
            await propertyContainer.getByTitle('属性を編集').click();
            const attrList = propertyContainer.locator('#attributeList');
            await expect(attrList).toBeVisible();

            const deleteTargetContainer = attrList.locator('div', { hasText: attrName }).locator('..');
            await deleteTargetContainer.locator('> .edit-icon > .fa-solid').click();
            editorPage.once('dialog', dialog => dialog.accept());
            await editorPage.getByRole('button', { name: '削除' }).click();

            await expect(propertyContainer.locator(`input[data-attribute-type="${attrName}"]`)).toBeHidden();
        });
    });

    test('属性のinput[text]を「タグに」追加した場合のライフサイクル検証', async ({ editorPage, editorHelper }) => {
        const attrName = 'tag-specific-attr';
        const attrValue = 'tag-value';

        await test.step('セットアップ: ページとボタンを追加し、属性をタグレベルで定義', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openAttributeEditor();
            await editorHelper.addAttributeDefinition({ name: attrName, template: 'input[text]', scope: 'tag' });
            //await editorPage.locator('property-container').getByTitle('属性を編集').click(); // モーダルを閉じる
        });

        await test.step('検証: 属性の値の変更、空文字設定、クリアができること', async () => {
            const propertyContainer = editorPage.locator('property-container');
            const previewButton = editorPage.locator('#renderzone').contentFrame().locator('ons-button');
            const targetInput = propertyContainer.locator(`input[data-attribute-type="${attrName}"]`);
            await expect(targetInput).toBeVisible();

            await targetInput.fill(attrValue);
            await targetInput.press('Enter');
            await expect(previewButton).toHaveAttribute(attrName, attrValue);

            // 値を手動で空文字にした場合の動作検証
            await targetInput.fill('');
            await targetInput.press('Enter');
            await expect(targetInput).toHaveValue('');
            await expect(previewButton).toHaveAttribute(attrName, '');

            // 「タグに」追加した属性の場合、クリアボタンは値を空にするだけで、入力欄は消えない
            // 属性編集モーダルがもし表示されていたら、それが閉じるのを待つ
            await editorPage.locator('property-container').click();
            await expect(editorPage.locator('#attributeList')).toBeHidden();

            const clearButton = targetInput.locator('+ .clear-button');
            // ボタンがクリック可能になるまで待機（念のため）
            await expect(clearButton).toBeEnabled();
            // クリックを実行
            await clearButton.click();
            await expect(previewButton).not.toHaveAttribute(attrName);
            await expect(targetInput).toHaveValue('');
            await expect(targetInput).toBeVisible();
        });

        await test.step('検証: 属性定義自体を削除できること', async () => {
            const propertyContainer = editorPage.locator('property-container');

            await propertyContainer.getByTitle('属性を編集').click();
            const attrList = propertyContainer.locator('#attributeList');
            await expect(attrList).toBeVisible();

            const deleteTargetContainer = attrList.locator('div', { hasText: attrName }).locator('..');
            await deleteTargetContainer.locator('> .edit-icon > .fa-solid').click();
            editorPage.once('dialog', dialog => dialog.accept());
            await editorPage.getByRole('button', { name: '削除' }).click();

            await expect(propertyContainer.locator(`input[data-attribute-type="${attrName}"]`)).toBeHidden();
        });
    });

    test('属性の優先順位とUIハイライトの検証', async ({ editorPage, editorHelper }) => {
        const attrName = 'priority-test-attr';
        let buttonNode: Locator;

        await test.step('セットアップ: ページとボタンを追加', async () => {
            const setup = await editorHelper.setupPageWithButton();
            buttonNode = setup.buttonNode;
            await editorHelper.selectNodeInDomTree(buttonNode);
        });

        await test.step('検証: 「要素に」属性を追加するとUIがハイライトされる', async () => {
            editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');

            await propertyContainer.getByTitle('属性を編集').click();
            await propertyContainer.getByRole('button', { name: '要素に追加' }).click();
            await propertyContainer.getByRole('combobox', { name: '属性名:' }).fill(attrName);
            await propertyContainer.getByRole('button', { name: '追加' }).click();

            const targetInput = propertyContainer.locator(`input[data-attribute-type="${attrName}"]`);
            await expect(targetInput).toBeVisible();

            // Shadow DOM内の要素のスタイルを取得して検証
            const backgroundColor = await targetInput.evaluate(el => {
                const root = el.getRootNode();
                if (!(root instanceof ShadowRoot)) return null; // 型安全のためのガード
                const hostElement = root.host;
                const editorRow = hostElement.closest('.editor-row');
                return editorRow ? window.getComputedStyle(editorRow).backgroundColor : null;
            });
            expect(backgroundColor).toBe('rgba(0, 112, 255, 0.11)');
        });

        await test.step('検証: 「タグに」同名属性を追加するとハイライトが消える', async () => {
            const propertyContainer = editorPage.locator('property-container');
            const targetInput = propertyContainer.locator(`input[data-attribute-type="${attrName}"]`);

            // タグレベルで同じ名前の属性を定義
            await propertyContainer.getByTitle('属性を編集').click();
            await propertyContainer.getByRole('button', { name: 'タグに追加' }).click();
            await propertyContainer.getByRole('combobox', { name: '属性名:' }).fill(attrName);
            await propertyContainer.getByRole('combobox', { name: 'テンプレート:' }).fill('input[text]');
            await propertyContainer.getByRole('button', { name: '追加' }).click();

            // ハイライトが消え、デフォルトの背景色に戻ることを確認
            const backgroundColor = await targetInput.evaluate(el => {
                const root = el.getRootNode();
                if (!(root instanceof ShadowRoot)) return null;
                const hostElement = root.host;
                const editorRow = hostElement.closest('.editor-row');
                return editorRow ? window.getComputedStyle(editorRow).backgroundColor : null;
            });
            expect(backgroundColor).toBe('rgba(0, 0, 0, 0)');
        });
    });

    test('エディタ内で新しいページを追加できる', async ({ editorPage, editorHelper }) => {
        const newPageExplain = 'ページ';
        await editorHelper.addPage(); // ヘルパー関数に置き換え
        await expect(editorPage.locator('#dom-tree > .node[data-node-type="page"]')).toHaveCount(1);
        await editorHelper.expectPageInTemplateList(newPageExplain);
    });

    test('ツールボックスからコンポーネントをD&Dできる', async ({ editorPage, editorHelper }) => {
        const pageNode = await editorHelper.addPage(); // ヘルパー関数に置き換え
        const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
        await editorHelper.addComponent('ons-button', contentAreaSelector);
    });

    test('属性(input[checkbox])を追加・編集・削除できる', async ({ editorPage, editorHelper }) => {
        const attrName = 'sample-check-attr';
        const { buttonNode } = await editorHelper.setupPageWithButton();
        await editorHelper.selectNodeInDomTree(buttonNode);

        await editorHelper.openAttributeEditor();
        await editorHelper.addAttributeDefinition({ name: attrName, template: 'input[checkbox]', scope: 'tag' });

        const previewButton = editorPage.locator('#renderzone').contentFrame().locator('ons-button');
        const targetInput = editorPage.locator(`input[data-attribute-type="${attrName}"]`);
        await targetInput.check();
        await expect(previewButton).toHaveAttribute(attrName, '');
        await targetInput.uncheck();
        await expect(previewButton).not.toHaveAttribute(attrName);
    });

    test('属性(select[])を追加・編集・削除できる', async ({ editorPage, editorHelper }) => {
        const attrName = 'sample-select-attr';
        const template = 'select[ selectA selectB selectC]';
        const previewSelector = 'ons-button';

        await test.step('セットアップ', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openAttributeEditor();
            await editorHelper.addAttributeDefinition({ name: attrName, template, scope: 'tag' });
            await editorHelper.getPropertyContainer().getByTitle('属性を編集').click(); // モーダルを閉じる
        });

        await test.step('検証', async () => {
            const targetInput = editorHelper.getPropertyInput(attrName);
            const selectList = targetInput.locator('.select');

            await selectList.click();
            await editorPage.getByText('selectA').click();
            await editorHelper.expectPreviewElementAttribute({ selector: previewSelector, attributeName: attrName, value: 'selectA' });

            await selectList.click();
            await editorPage.getByText('selectB').click();
            await editorHelper.expectPreviewElementAttribute({ selector: previewSelector, attributeName: attrName, value: 'selectB' });

            await selectList.click();
            await targetInput.locator('.select-popup > .select-option').first().click();
            await expect(targetInput).toBeEmpty();
            await expect(targetInput).toBeVisible();
            await editorHelper.expectPreviewElementAttribute({ selector: previewSelector, attributeName: attrName, value: null });
        });

        await test.step('削除', async () => {
            const targetInput = editorHelper.getPropertyInput(attrName);
            await targetInput.locator('.select').click();
            await editorPage.getByText('selectC').click(); // 削除前に値がある状態にする
            await editorHelper.expectPreviewElementAttribute({ selector: previewSelector, attributeName: attrName, value: 'selectC' });

            await editorHelper.openAttributeEditor();
            await editorHelper.deleteAttributeDefinition(attrName);

            await expect(targetInput).toBeHidden();
            await editorHelper.expectPreviewElementAttribute({ selector: previewSelector, attributeName: attrName, value: null });
        });
    });

    test('属性(multiselect[])を追加・編集・削除できる', async ({ editorPage, editorHelper }) => {
        const attrName = 'sample-mulselect-attr';
        const template = 'multiselect[selectA selectB selectC]';
        const previewSelector = 'ons-button';

        await test.step('セットアップ', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openAttributeEditor();
            await editorHelper.addAttributeDefinition({ name: attrName, template, scope: 'tag' });
        });

        await test.step('検証', async () => {
            const targetInput = editorHelper.getPropertyInput(attrName);
            const selectList = targetInput.locator('.select');
            const popup = targetInput.locator('.select-popup');

            await selectList.click();
            await popup.getByText('selectA').click();
            await selectList.click();
            await editorHelper.expectPreviewElementAttribute({ selector: previewSelector, attributeName: attrName, value: 'selectA' });

            await selectList.click();
            await popup.getByText('selectB').click();
            await selectList.click();
            await editorHelper.expectPreviewElementAttribute({ selector: previewSelector, attributeName: attrName, value: 'selectA selectB' });

            await selectList.click();
            await popup.getByText('selectA').click();
            await popup.getByText('selectB').click();
            await selectList.click();
            await expect(targetInput).toBeEmpty();
            await editorHelper.expectPreviewElementAttribute({ selector: previewSelector, attributeName: attrName, value: null });
        });

        await test.step('削除', async () => {
            const targetInput = editorHelper.getPropertyInput(attrName);
            const selectList = targetInput.locator('.select');
            const popup = targetInput.locator('.select-popup');

            await selectList.click();
            await popup.getByText('selectC').click(); // 削除前に値がある状態にする
            await selectList.click();

            await editorHelper.openAttributeEditor();
            await editorHelper.deleteAttributeDefinition(attrName);

            await expect(targetInput).toBeHidden();
            await editorHelper.expectPreviewElementAttribute({ selector: previewSelector, attributeName: attrName, value: null });
        });
    });

    test('属性(textarea)を追加・編集・削除できる', async ({ editorPage, editorHelper }) => {
        const attrName = 'sample-textarea-attr';
        const attrValue = 'textarea';
        const previewSelector = 'ons-button';

        await test.step('セットアップ', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openAttributeEditor();
            await editorHelper.addAttributeDefinition({ name: attrName, template: 'textarea', scope: 'tag' });
        });

        await test.step('検証', async () => {
            const targetInput = editorHelper.getPropertyInput(attrName).locator('textarea');

            await targetInput.fill(attrValue);
            await targetInput.press('Tab');
            await editorHelper.expectPreviewElementAttribute({ selector: previewSelector, attributeName: attrName, value: attrValue });

            await targetInput.fill('');
            await targetInput.press('Tab');
            await editorHelper.expectPreviewElementAttribute({ selector: previewSelector, attributeName: attrName, value: '' });

            // 属性編集モーダルがもし表示されていたら、それが閉じるのを待つ
            await expect(editorPage.locator('#attributeList')).toBeHidden();

            const clearButton = targetInput.locator('+ .clear-button');
            // ボタンがクリック可能になるまで待機（念のため）
            await expect(clearButton).toBeEnabled();
            // クリックを実行
            await clearButton.click();
            await expect(targetInput).toBeVisible();
            await editorHelper.expectPreviewElementAttribute({ selector: previewSelector, attributeName: attrName, value: null });
        });

        await test.step('削除', async () => {
            await editorHelper.openAttributeEditor();

            await editorHelper.deleteAttributeDefinition(attrName);
            await expect(editorHelper.getPropertyInput(attrName)).toBeHidden();
        });
    });

    test('属性(style-flex)を追加・編集・削除できる', async ({ editorPage, editorHelper }) => {
        const attrName = 'style-flex';
        const nodeType = 'sample-flex-tag';

        await test.step('セットアップ', async () => {
            const pageNode = await editorHelper.addPage();
            const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
            const containerNode = await editorHelper.addComponentAsHtmlTag(nodeType, contentAreaSelector);
            await editorHelper.selectNodeInDomTree(containerNode);
            await editorHelper.openAttributeEditor();
            await editorHelper.addAttributeDefinition({ name: attrName, template: 'style-flex', scope: 'tag' });
        });

        await test.step('検証', async () => {
            const targetInput = editorHelper.getPropertyInput(attrName);
            const checkbox = targetInput.locator('input[type="checkbox"]');

            await checkbox.check();
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'display', value: 'flex' });

            await targetInput.locator('select[name="flex-direction"]').selectOption('column');
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'flex-direction', value: 'column' });

            await targetInput.locator('select[name="flex-wrap"]').selectOption('wrap');
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'flex-wrap', value: 'wrap' });

            await targetInput.locator('select[name="align-content"]').selectOption('Center');
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'align-content', value: 'center' });

            await targetInput.locator('select[name="justify-content"]').selectOption('Center');
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'justify-content', value: 'center' });

            await targetInput.locator('select[name="align-items"]').selectOption('Baseline');
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'align-items', value: 'baseline' });

            await checkbox.uncheck();
            await editorHelper.expectPreviewElementAttribute({ selector: nodeType, attributeName: 'style', value: null });
        });

        await test.step('削除', async () => {
            await editorHelper.openAttributeEditor();
            await editorHelper.deleteAttributeDefinition(attrName);
            await expect(editorHelper.getPropertyInput(attrName)).toBeHidden();
        });
    });

    test('属性(style-flexitem)を追加・編集・削除できる', async ({ editorPage, editorHelper }) => {
        const attrName = 'style-flexitem';
        const nodeType = 'flex-item';
        let itemNode: Locator;

        await test.step('セットアップ', async () => {
            const setup = await editorHelper.setupFlexContainerWithItem();
            itemNode = setup.itemNode;
        });

        await test.step('検証', async () => {
            await editorHelper.openMoveingHandle('left');
            await editorHelper.selectNodeInDomTree(itemNode);

            // style-flex-item のプロパティパネル全体が表示されていることを確認
            await editorHelper.openMoveingHandle('right');
            const targetInputPanel = editorHelper.getPropertyInput('style-flex-item');
            await expect(targetInputPanel).toBeVisible();

            // --- 'flex-grow' の操作 ---
            const flexGrowInput = targetInputPanel.locator('input[id="flex-grow"]');
            await expect(flexGrowInput).toBeVisible();
            await flexGrowInput.fill('1');
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'flex-grow', value: '1' });

            // --- 'flex-shrink' の操作 ---
            const flexShrinkInput = targetInputPanel.locator('input[id="flex-shrink"]');
            await expect(flexShrinkInput).toBeVisible();
            await flexShrinkInput.fill('2');
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'flex-shrink', value: '2' });

            // --- 'flex-basis' の操作 ---
            const flexBasisInput = targetInputPanel.locator('input[id="flex-basis"]');
            await expect(flexBasisInput).toBeVisible();
            await flexBasisInput.fill('100%');
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'flex-basis', value: '100%' });

            // --- 'order' の操作 ---
            const orderInput = targetInputPanel.locator('input[id="order"]');
            await expect(orderInput).toBeVisible();
            await orderInput.fill('10');
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'order', value: '10' });

            // --- 'align-self' の操作 ---
            const alignSelfSelect = targetInputPanel.locator('select[name="align-self"]');
            await expect(alignSelfSelect).toBeVisible();

            await alignSelfSelect.selectOption('Center');
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'align-self', value: 'center' });
        });

        await test.step('削除', async () => {
            // 削除前にも、対象ノードが選択されていることを保証する
            await editorHelper.openMoveingHandle('left');
            await editorHelper.selectNodeInDomTree(itemNode);

            await editorHelper.openAttributeEditor();
            await editorHelper.deleteAttributeDefinition(attrName);
            await expect(editorHelper.getPropertyInput(attrName)).toBeHidden();

            await editorHelper.expectPreviewElementAttribute({ selector: nodeType, attributeName: 'style', value: null });
        });
    });
});