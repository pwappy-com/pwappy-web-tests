import { test as base, expect, Page, BrowserContext, Locator } from '@playwright/test';
import 'dotenv/config';

import { createApp, deleteApp, openEditor } from '../../tools/dashboard-helpers';
import {
    addPage,
    addComponent,
    addComponentAsHtmlTag,
    selectNodeInDomTree,
    openAttributeEditor,
    addAttributeDefinition,
    deleteAttributeDefinition,
    setupPageWithButton,
    setupFlexContainerWithItem,
    expectPageInTemplateList,
    getPropertyInput,
    expectPreviewElementCss,
    expectPreviewElementAttribute,
    getPropertyContainer,
} from '../../tools/editor-helpers';

/**
 * テストフィクスチャを拡張し、各テストでエディタページを自動的にセットアップ・クリーンアップします。
 */
type EditorFixtures = {
    editorPage: Page;
    appName: string;
};
const test = base.extend<EditorFixtures>({
    // 各テストでユニークなアプリケーション名を提供するフィクスチャ
    appName: async ({ }, use) => {
        await use(`test-app-${Date.now()}`);
    },
    // アプリ作成からエディタを開くまでを自動化し、テスト終了後に自動でクリーンアップするフィクスチャ
    editorPage: async ({ page, context, appName }, use) => {
        const appKey = `test-key-${Date.now()}`;
        await createApp(page, appName, appKey);
        const editorPage = await openEditor(page, context, appName);

        // テスト本体（use）に準備した editorPage を渡す
        await use(editorPage);

        // テスト終了後のクリーンアップ処理
        await editorPage.close();
        await deleteApp(page, appName);
    },
});

// --- テストスイート ---
test.describe('エディタ内機能のテスト', () => {

    /**
     * 各テストの実行前に認証とダッシュボードへのアクセスを行います。
     */
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

    test('コンポーネントのプロパティを編集できる', async ({ editorPage }) => {
        let buttonNode: Locator;
        let pageNode: Locator;
        await test.step('セットアップ: ページとボタンをエディタに追加', async () => {
            // ヘルパー関数でセットアップを簡潔に
            const setup = await setupPageWithButton(editorPage);
            pageNode = setup.pageNode;
            buttonNode = setup.buttonNode;
        });

        await test.step('検証: DOMツリーのノード選択に応じてプロパティ表示が追従すること', async () => {
            const domTree = editorPage.locator('#dom-tree');
            const propertyContainer = editorPage.locator('property-container');
            const propertyIdInput = propertyContainer.locator('input[data-attribute-type="domId"]');

            // 「コンテンツ」ノードのテキスト部分をクリックし、対応するプロパティが表示されるか確認
            const contentNode = domTree.locator('div[data-node-explain="コンテンツ"]');
            await contentNode.getByText('コンテンツ', { exact: true }).click();

            await propertyContainer.getByText('属性', { exact: true }).click();
            await expect(propertyIdInput).toHaveValue('div2');

            // 次に「ボタン」ノードをクリックし、プロパティ表示が切り替わるか確認
            await domTree.locator('.node[data-node-type="ons-button"]').click();
            await expect(propertyIdInput).toHaveValue('ons-button1');
        });

        await test.step('検証: 属性(text)の変更がプレビューに反映されること', async () => {
            const propertyTextInput = editorPage.locator('property-container input[data-attribute-type="text"]');
            const previewButton = editorPage.locator('#renderzone').contentFrame().locator('ons-button');

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

    test('属性のinput[text]を「要素に」追加した場合のライフサイクル検証', async ({ editorPage }) => {
        const attrName = 'element-specific-attr';
        const attrValue = 'element-value';
        let buttonNode: Locator;

        await test.step('セットアップ: ページとボタンを追加', async () => {
            const setup = await setupPageWithButton(editorPage);
            buttonNode = setup.buttonNode;
            await selectNodeInDomTree(buttonNode);
        });

        await test.step('検証: 属性の追加、値の変更、空文字設定、クリアボタンの動作', async () => {
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
            await targetInput.locator('+ .clear-button').click();
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

    test('属性のinput[text]を「タグに」追加した場合のライフサイクル検証', async ({ editorPage }) => {
        const attrName = 'tag-specific-attr';
        const attrValue = 'tag-value';

        await test.step('セットアップ: ページとボタンを追加し、属性をタグレベルで定義', async () => {
            const { buttonNode } = await setupPageWithButton(editorPage);
            await selectNodeInDomTree(buttonNode);
            await openAttributeEditor(editorPage);
            await addAttributeDefinition(editorPage, { name: attrName, template: 'input[text]', scope: 'tag' });
            await editorPage.locator('property-container').getByTitle('属性を編集').click(); // モーダルを閉じる
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
            await targetInput.locator('+ .clear-button').click();
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

    test('属性の優先順位とUIハイライトの検証', async ({ editorPage }) => {
        const attrName = 'priority-test-attr';
        let buttonNode: Locator;

        await test.step('セットアップ: ページとボタンを追加', async () => {
            const setup = await setupPageWithButton(editorPage);
            buttonNode = setup.buttonNode;
            await selectNodeInDomTree(buttonNode);
        });

        await test.step('検証: 「要素に」属性を追加するとUIがハイライトされる', async () => {
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

    test('エディタ内で新しいページを追加できる', async ({ editorPage }) => {
        const newPageExplain = 'ページ';
        await addPage(editorPage); // ヘルパー関数に置き換え
        await expect(editorPage.locator('#dom-tree > .node[data-node-type="page"]')).toHaveCount(1);
        await expectPageInTemplateList(editorPage, newPageExplain);
    });

    test('ツールボックスからコンポーネントをD&Dできる', async ({ editorPage }) => {
        const pageNode = await addPage(editorPage); // ヘルパー関数に置き換え
        const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
        await addComponent(editorPage, 'ons-button', contentAreaSelector);
    });

    test('属性(input[checkbox])を追加・編集・削除できる', async ({ editorPage }) => {
        const attrName = 'sample-check-attr';
        const { buttonNode } = await setupPageWithButton(editorPage);
        await selectNodeInDomTree(buttonNode);

        await openAttributeEditor(editorPage);
        await addAttributeDefinition(editorPage, { name: attrName, template: 'input[checkbox]', scope: 'tag' });

        const previewButton = editorPage.locator('#renderzone').contentFrame().locator('ons-button');
        const targetInput = editorPage.locator(`input[data-attribute-type="${attrName}"]`);
        await targetInput.check();
        await expect(previewButton).toHaveAttribute(attrName, '');
        await targetInput.uncheck();
        await expect(previewButton).not.toHaveAttribute(attrName);
    });

    test('属性(select[])を追加・編集・削除できる', async ({ editorPage }) => {
        const attrName = 'sample-select-attr';
        const template = 'select[ selectA selectB selectC]';
        const previewSelector = 'ons-button';

        await test.step('セットアップ', async () => {
            const { buttonNode } = await setupPageWithButton(editorPage);
            await selectNodeInDomTree(buttonNode);
            await openAttributeEditor(editorPage);
            await addAttributeDefinition(editorPage, { name: attrName, template, scope: 'tag' });
            await getPropertyContainer(editorPage).getByTitle('属性を編集').click(); // モーダルを閉じる
        });

        await test.step('検証', async () => {
            const targetInput = getPropertyInput(editorPage, attrName);
            const selectList = targetInput.locator('.select');

            await selectList.click();
            await editorPage.getByText('selectA').click();
            await expectPreviewElementAttribute(editorPage, { selector: previewSelector, attributeName: attrName, value: 'selectA' });

            await selectList.click();
            await editorPage.getByText('selectB').click();
            await expectPreviewElementAttribute(editorPage, { selector: previewSelector, attributeName: attrName, value: 'selectB' });

            await selectList.click();
            await targetInput.locator('.select-popup > .select-option').first().click();
            await expect(targetInput).toBeEmpty();
            await expect(targetInput).toBeVisible();
            await expectPreviewElementAttribute(editorPage, { selector: previewSelector, attributeName: attrName, value: null });
        });

        await test.step('削除', async () => {
            const targetInput = getPropertyInput(editorPage, attrName);
            await targetInput.locator('.select').click();
            await editorPage.getByText('selectC').click(); // 削除前に値がある状態にする
            await expectPreviewElementAttribute(editorPage, { selector: previewSelector, attributeName: attrName, value: 'selectC' });

            await openAttributeEditor(editorPage);
            await deleteAttributeDefinition(editorPage, attrName);

            await expect(targetInput).toBeHidden();
            await expectPreviewElementAttribute(editorPage, { selector: previewSelector, attributeName: attrName, value: null });
        });
    });

    test('属性(multiselect[])を追加・編集・削除できる', async ({ editorPage }) => {
        const attrName = 'sample-mulselect-attr';
        const template = 'multiselect[selectA selectB selectC]';
        const previewSelector = 'ons-button';

        await test.step('セットアップ', async () => {
            const { buttonNode } = await setupPageWithButton(editorPage);
            await selectNodeInDomTree(buttonNode);
            await openAttributeEditor(editorPage);
            await addAttributeDefinition(editorPage, { name: attrName, template, scope: 'tag' });
        });

        await test.step('検証', async () => {
            const targetInput = getPropertyInput(editorPage, attrName);
            const selectList = targetInput.locator('.select');
            const popup = targetInput.locator('.select-popup');

            await selectList.click();
            await popup.getByText('selectA').click();
            await selectList.click();
            await expectPreviewElementAttribute(editorPage, { selector: previewSelector, attributeName: attrName, value: 'selectA' });

            await selectList.click();
            await popup.getByText('selectB').click();
            await selectList.click();
            await expectPreviewElementAttribute(editorPage, { selector: previewSelector, attributeName: attrName, value: 'selectA selectB' });

            await selectList.click();
            await popup.getByText('selectA').click();
            await popup.getByText('selectB').click();
            await selectList.click();
            await expect(targetInput).toBeEmpty();
            await expectPreviewElementAttribute(editorPage, { selector: previewSelector, attributeName: attrName, value: null });
        });

        await test.step('削除', async () => {
            const targetInput = getPropertyInput(editorPage, attrName);
            const selectList = targetInput.locator('.select');
            const popup = targetInput.locator('.select-popup');

            await selectList.click();
            await popup.getByText('selectC').click(); // 削除前に値がある状態にする
            await selectList.click();

            await openAttributeEditor(editorPage);
            await deleteAttributeDefinition(editorPage, attrName);

            await expect(targetInput).toBeHidden();
            await expectPreviewElementAttribute(editorPage, { selector: previewSelector, attributeName: attrName, value: null });
        });
    });

    test('属性(textarea)を追加・編集・削除できる', async ({ editorPage }) => {
        const attrName = 'sample-textarea-attr';
        const attrValue = 'textarea';
        const previewSelector = 'ons-button';

        await test.step('セットアップ', async () => {
            const { buttonNode } = await setupPageWithButton(editorPage);
            await selectNodeInDomTree(buttonNode);
            await openAttributeEditor(editorPage);
            await addAttributeDefinition(editorPage, { name: attrName, template: 'textarea', scope: 'tag' });
        });

        await test.step('検証', async () => {
            const targetInput = getPropertyInput(editorPage, attrName).locator('textarea');

            await targetInput.fill(attrValue);
            await targetInput.press('Tab');
            await expectPreviewElementAttribute(editorPage, { selector: previewSelector, attributeName: attrName, value: attrValue });

            await targetInput.fill('');
            await targetInput.press('Tab');
            await expectPreviewElementAttribute(editorPage, { selector: previewSelector, attributeName: attrName, value: '' });

            await targetInput.locator('+ .clear-button').click();
            await expect(targetInput).toBeVisible();
            await expectPreviewElementAttribute(editorPage, { selector: previewSelector, attributeName: attrName, value: null });
        });

        await test.step('削除', async () => {
            await openAttributeEditor(editorPage);

            await deleteAttributeDefinition(editorPage, attrName);
            await expect(getPropertyInput(editorPage, attrName)).toBeHidden();
        });
    });

    test('属性(style-flex)を追加・編集・削除できる', async ({ editorPage }) => {
        const attrName = 'style-flex';
        const nodeType = 'sample-flex-tag';

        await test.step('セットアップ', async () => {
            const pageNode = await addPage(editorPage);
            const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
            const containerNode = await addComponentAsHtmlTag(editorPage, nodeType, contentAreaSelector);
            await selectNodeInDomTree(containerNode);
            await openAttributeEditor(editorPage);
            await addAttributeDefinition(editorPage, { name: attrName, template: 'style-flex', scope: 'tag' });
        });

        await test.step('検証', async () => {
            const targetInput = getPropertyInput(editorPage, attrName);
            const checkbox = targetInput.locator('input[type="checkbox"]');

            await checkbox.check();
            await expectPreviewElementCss(editorPage, { selector: nodeType, property: 'display', value: 'flex' });

            await targetInput.locator('select[name="flex-direction"]').selectOption('column');
            await expectPreviewElementCss(editorPage, { selector: nodeType, property: 'flex-direction', value: 'column' });

            await targetInput.locator('select[name="flex-wrap"]').selectOption('wrap');
            await expectPreviewElementCss(editorPage, { selector: nodeType, property: 'flex-wrap', value: 'wrap' });

            await targetInput.locator('select[name="align-content"]').selectOption('Center');
            await expectPreviewElementCss(editorPage, { selector: nodeType, property: 'align-content', value: 'center' });

            await targetInput.locator('select[name="justify-content"]').selectOption('Center');
            await expectPreviewElementCss(editorPage, { selector: nodeType, property: 'justify-content', value: 'center' });

            await targetInput.locator('select[name="align-items"]').selectOption('Baseline');
            await expectPreviewElementCss(editorPage, { selector: nodeType, property: 'align-items', value: 'baseline' });

            await checkbox.uncheck();
            await expectPreviewElementAttribute(editorPage, { selector: nodeType, attributeName: 'style', value: null });
        });

        await test.step('削除', async () => {
            await openAttributeEditor(editorPage);
            await deleteAttributeDefinition(editorPage, attrName);
            await expect(getPropertyInput(editorPage, attrName)).toBeHidden();
        });
    });

    test('属性(style-flexitem)を追加・編集・削除できる', async ({ editorPage }) => {
        const attrName = 'style-flexitem';
        const nodeType = 'flex-item';
        let itemNode: Locator;

        await test.step('セットアップ', async () => {
            const setup = await setupFlexContainerWithItem(editorPage);
            itemNode = setup.itemNode;
        });

        await test.step('検証', async () => {
            await selectNodeInDomTree(itemNode);

            // style-flex-item のプロパティパネル全体が表示されていることを確認
            const targetInputPanel = getPropertyInput(editorPage, 'style-flex-item');
            await expect(targetInputPanel).toBeVisible();

            // --- 'flex-grow' の操作 ---
            const flexGrowInput = targetInputPanel.locator('input[id="flex-grow"]');
            await expect(flexGrowInput).toBeVisible();
            await flexGrowInput.fill('1');
            await expectPreviewElementCss(editorPage, { selector: nodeType, property: 'flex-grow', value: '1' });

            // --- 'flex-shrink' の操作 ---
            const flexShrinkInput = targetInputPanel.locator('input[id="flex-shrink"]');
            await expect(flexShrinkInput).toBeVisible();
            await flexShrinkInput.fill('2');
            await expectPreviewElementCss(editorPage, { selector: nodeType, property: 'flex-shrink', value: '2' });

            // --- 'flex-basis' の操作 ---
            const flexBasisInput = targetInputPanel.locator('input[id="flex-basis"]');
            await expect(flexBasisInput).toBeVisible();
            await flexBasisInput.fill('100%');
            await expectPreviewElementCss(editorPage, { selector: nodeType, property: 'flex-basis', value: '100%' });

            // --- 'order' の操作 ---
            const orderInput = targetInputPanel.locator('input[id="order"]');
            await expect(orderInput).toBeVisible();
            await orderInput.fill('10');
            await expectPreviewElementCss(editorPage, { selector: nodeType, property: 'order', value: '10' });

            // --- 'align-self' の操作 ---
            const alignSelfSelect = targetInputPanel.locator('select[name="align-self"]');
            await expect(alignSelfSelect).toBeVisible();

            await alignSelfSelect.selectOption('Center');
            await expectPreviewElementCss(editorPage, { selector: nodeType, property: 'align-self', value: 'center' });
        });

        await test.step('削除', async () => {
            // 削除前にも、対象ノードが選択されていることを保証する
            await selectNodeInDomTree(itemNode);

            await openAttributeEditor(editorPage);
            await deleteAttributeDefinition(editorPage, attrName);
            await expect(getPropertyInput(editorPage, attrName)).toBeHidden();

            await expectPreviewElementAttribute(editorPage, { selector: nodeType, attributeName: 'style', value: null });
        });
    });
});