import { test as base, expect, Page, BrowserContext, Locator } from '@playwright/test';
import 'dotenv/config';

import { createApp, deleteApp, gotoDashboard, openEditor } from '../../tools/dashboard-helpers';
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
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        await use(`test-app-${uniqueId}`.slice(0, 30));
    },
    // アプリ作成からエディタを開くまでを自動化し、テスト終了後に自動でクリーンアップするフィクスチャ
    editorPage: async ({ page, context, appName }, use) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appKey = `test-key-${uniqueId}`.slice(0, 30);
        await createApp(page, appName, appKey);
        const editorPage = await openEditor(page, context, appName);

        // テスト本体（use）に準備した editorPage を渡す
        await use(editorPage);

        // テスト終了後のクリーンアップ処理
        await editorPage.close();
        await deleteApp(page, appKey);
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
        await gotoDashboard(page);
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
            await editorHelper.openMoveingHandle('left');
            const domTree = editorPage.locator('#dom-tree');
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            const propertyIdInput = propertyContainer.locator('input[data-attribute-type="domId"]');

            // 「コンテンツ」ノードのテキスト部分をクリックし、対応するプロパティが表示されるか確認
            await editorHelper.openMoveingHandle('left');
            const contentNode = domTree.locator('div[data-node-explain="コンテンツ"]');
            await contentNode.getByText('コンテンツ', { exact: true }).click();

            await editorHelper.openMoveingHandle('right');
            await propertyContainer.getByText('属性', { exact: true }).click();
            await expect(propertyIdInput).toHaveValue('div2');

            await editorHelper.openMoveingHandle('left');
            // 次に「ボタン」ノードをクリックし、プロパティ表示が切り替わるか確認
            await domTree.locator('.node[data-node-type="ons-button"]').click();
            await expect(propertyIdInput).toHaveValue('ons-button1');
        });

        await test.step('検証: 属性(text)の変更がプレビューに反映されること', async () => {
            editorHelper.closeMoveingHandle();
            const propertyTextInput = editorPage.locator('property-container input[data-attribute-type="text"]');
            const previewButton = editorPage.locator('#ios-container #renderzone').contentFrame().locator('ons-button');

            await editorHelper.openMoveingHandle('right');
            await expect(propertyTextInput).toBeEditable();
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

            // Monaco Editor に API 経由で値をセットする
            const styleValue = 'element.style {\n    background : red;\n}';
            await editorHelper.setMonacoValue(styleEditor, styleValue);

            // プレビューのボタンにスタイルが適用されていることを最終確認
            const previewButton = editorPage.locator('#ios-container #renderzone').contentFrame().locator('ons-button');
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
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            const previewButton = editorPage.locator('#ios-container #renderzone').contentFrame().locator('ons-button');

            await expect(propertyContainer).toBeVisible();

            const editAttrButton = propertyContainer.getByTitle('属性を編集');
            await expect(editAttrButton).toBeVisible();
            await expect(editAttrButton).toBeEnabled(); // 押せる状態かチェック
            await editAttrButton.click();

            const addElementButton = propertyContainer.getByRole('button', { name: '要素に追加' });
            await expect(addElementButton).toBeVisible();
            await expect(addElementButton).toBeEnabled();
            await addElementButton.click();

            const attrNameInput = propertyContainer.getByRole('combobox', { name: '属性名:' });
            await expect(attrNameInput).toBeVisible();
            await expect(attrNameInput).toBeEditable(); // 入力可能（Readonlyでない）かチェック
            await attrNameInput.fill(attrName);

            const addButton = propertyContainer.getByRole('button', { name: '追加' });
            await expect(addButton).toBeVisible();
            await expect(addButton).toBeEnabled();
            await addButton.click();

            const targetInput = propertyContainer.locator(`input[data-attribute-type="${attrName}"]`);
            await expect(targetInput).toBeVisible();
            await expect(targetInput).toBeEditable();

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

            // --- 1. 属性の再追加フロー ---
            const editAttrButton = propertyContainer.getByTitle('属性を編集');
            await expect(editAttrButton).toBeVisible();
            await editAttrButton.click();

            const addElementButton = propertyContainer.getByRole('button', { name: '要素に追加' });
            await expect(addElementButton).toBeVisible();
            await expect(addElementButton).toBeEnabled();
            await addElementButton.click();

            const attrInput = propertyContainer.getByRole('combobox', { name: '属性名:' });
            await expect(attrInput).toBeEditable();
            await attrInput.fill(attrName);

            const addButton = propertyContainer.getByRole('button', { name: '追加' });
            await expect(addButton).toBeEnabled();
            await addButton.click();

            // --- 2. 属性の削除フロー ---
            // 再度モーダルを開く
            await expect(editAttrButton).toBeVisible();
            await editAttrButton.click();

            const attrList = propertyContainer.locator('#attributeList');
            await expect(attrList).toBeVisible();

            // 削除対象のコンテナと削除アイコンの特定
            const deleteTargetContainer = attrList.locator('div', { hasText: attrName }).locator('..');
            const deleteIcon = deleteTargetContainer.locator('> .edit-icon > .fa-solid');

            // 削除アイコンが表示されているか確認
            await expect(deleteIcon).toBeVisible();

            // ダイアログのハンドリング（クリックの直前にセット）
            editorPage.once('dialog', dialog => dialog.accept());

            // 削除アイコンをクリック
            await deleteIcon.click();

            // モーダル内の最終的な「削除」ボタンの状態を確認してクリック
            const finalDeleteButton = editorPage.getByRole('button', { name: '削除' });
            await expect(finalDeleteButton).toBeVisible();
            await expect(finalDeleteButton).toBeEnabled();
            await finalDeleteButton.click();

            // 最終検証: 対象の属性入力欄が消えていること
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
        });

        await test.step('検証: 属性の値の変更、空文字設定、クリアができること', async () => {
            const propertyContainer = editorPage.locator('property-container');
            const previewButton = editorPage.locator('#ios-container #renderzone').contentFrame().locator('ons-button');
            const targetInput = propertyContainer.locator(`input[data-attribute-type="${attrName}"]`);
            await expect(targetInput).toBeVisible();
            await expect(targetInput).toBeEditable();

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
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');

            // 1. 「属性を編集」ボタンのチェックとクリック
            const editAttrButton = propertyContainer.getByTitle('属性を編集');
            await expect(editAttrButton).toBeVisible();
            await editAttrButton.click();

            // 2. 「要素に追加」ボタンのチェックとクリック
            const addElementButton = propertyContainer.getByRole('button', { name: '要素に追加' });
            await expect(addElementButton).toBeVisible();
            await expect(addElementButton).toBeEnabled();
            await addElementButton.click();

            // 3. 「属性名」入力欄のチェックと入力
            const attrInput = propertyContainer.getByRole('combobox', { name: '属性名:' });
            await expect(attrInput).toBeVisible();
            await expect(attrInput).toBeEditable();
            await attrInput.fill(attrName);

            // 4. 「追加」ボタンのチェックとクリック
            const addButton = propertyContainer.getByRole('button', { name: '追加' });
            await expect(addButton).toBeVisible();
            await expect(addButton).toBeEnabled();
            await addButton.click();

            // 5. 追加された属性の入力欄が表示されるまで待機
            const targetInput = propertyContainer.locator(`input[data-attribute-type="${attrName}"]`);
            await expect(targetInput).toBeVisible();

            // 6. Shadow DOM内の要素のスタイルを取得してハイライトを検証
            // evaluate の前に、対象の要素がアタッチされていることを保証
            const backgroundColor = await targetInput.evaluate(el => {
                const root = el.getRootNode();
                if (!(root instanceof ShadowRoot)) return null; // 型安全のためのガード
                const hostElement = root.host;
                // 親方向にある .editor-row を探す
                const editorRow = hostElement.closest('.editor-row');
                return editorRow ? window.getComputedStyle(editorRow).backgroundColor : null;
            });

            // ハイライト色の検証
            expect(backgroundColor).toBe('rgba(0, 112, 255, 0.11)');
        });

        await test.step('検証: 「タグに」同名属性を追加するとハイライトが消える', async () => {
            const propertyContainer = editorPage.locator('property-container');
            const targetInput = propertyContainer.locator(`input[data-attribute-type="${attrName}"]`);

            // 事前確認: 対象の入力欄がまだ表示されていること
            await expect(targetInput).toBeVisible();

            // 1. 「属性を編集」ボタンのチェックとクリック
            const editAttrButton = propertyContainer.getByTitle('属性を編集');
            await expect(editAttrButton).toBeVisible();
            await editAttrButton.click();

            // 2. 「タグに追加」ボタンのチェックとクリック
            const addTagButton = propertyContainer.getByRole('button', { name: 'タグに追加' });
            await expect(addTagButton).toBeVisible();
            await expect(addTagButton).toBeEnabled();
            await addTagButton.click();

            // 3. 「属性名」入力欄のチェックと入力
            const nameInput = propertyContainer.getByRole('combobox', { name: '属性名:' });
            await expect(nameInput).toBeVisible();
            await expect(nameInput).toBeEditable();
            await nameInput.fill(attrName);

            // 4. 「テンプレート」入力欄のチェックと入力
            const templateInput = propertyContainer.getByRole('combobox', { name: 'テンプレート:' });
            await expect(templateInput).toBeVisible();
            await expect(templateInput).toBeEditable();
            await templateInput.fill('input[text]');

            // 5. 「追加」ボタンのチェックとクリック
            const addButton = propertyContainer.getByRole('button', { name: '追加' });
            await expect(addButton).toBeVisible();
            await expect(addButton).toBeEnabled();
            await addButton.click();

            // --- 検証フェーズ ---

            // 背景色が更新されるまでわずかに待機が必要な場合があるため、
            // evaluate を実行する前に対象要素が操作可能な状態であることを再確認
            await expect(targetInput).toBeVisible();

            // ハイライトが消え、デフォルトの背景色（透明など）に戻ることを確認
            const backgroundColor = await targetInput.evaluate(el => {
                const root = el.getRootNode();
                if (!(root instanceof ShadowRoot)) return null;
                const hostElement = root.host;
                const editorRow = hostElement.closest('.editor-row');
                return editorRow ? window.getComputedStyle(editorRow).backgroundColor : null;
            });

            // 透明（rgba(0, 0, 0, 0)）になっていることを検証
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

        const previewButton = editorPage.locator('#ios-container #renderzone').contentFrame().locator('ons-button');
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
            await expect(targetInput).toBeEditable();
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

    test('属性(icon)を追加・編集・削除できる（アイコンピッカーの連動検証）', async ({ editorPage, editorHelper }) => {
        const attrName = 'icon';
        const previewSelector = 'ons-button';

        await test.step('セットアップ', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openAttributeEditor();
            await editorHelper.addAttributeDefinition({ name: attrName, template: 'input[text]', scope: 'tag' });
        });

        await test.step('検証: アイコンピッカーを介してアイコンを設定できること', async () => {
            const propertyContainer = editorHelper.getPropertyContainer();
            const picker = propertyContainer.locator('attribute-icon-picker[data-attribute-type="icon"]');
            await expect(picker).toBeVisible();

            // ピッカーのモーダルを開く
            await picker.locator('.picker-button').click();
            const modal = picker.locator('.modal-overlay');
            await expect(modal).toHaveClass(/active/);

            // 検索ワードを入力してフィルタリング
            const searchInput = modal.locator('.modal-search input');
            await expect(searchInput).toBeVisible();
            await searchInput.fill('star');

            const starLabel = modal.locator('.icon-name', { hasText: /^star$/ }).first();
            await expect(starLabel).toBeVisible({ timeout: 15000 });

            const starItem = starLabel.locator('..');
            await starItem.click({ force: true });

            // モーダルが閉じて値がインプットとプレビューに反映される
            await expect(modal).not.toHaveClass(/active/);

            const targetInput = picker.locator('input[data-attribute-type="icon"]');
            await expect(targetInput).toHaveValue('fa-star');
            await editorHelper.expectPreviewElementAttribute({ selector: previewSelector, attributeName: attrName, value: 'fa-star' });
        });

        await test.step('検証: クリアボタンによる属性の削除', async () => {
            const propertyContainer = editorHelper.getPropertyContainer();
            const picker = propertyContainer.locator('attribute-icon-picker[data-attribute-type="icon"]');
            const targetInput = picker.locator('input[data-attribute-type="icon"]');

            // 「×」クリアボタンをクリック
            await picker.locator('.clear-button').click();
            await expect(targetInput).toHaveValue('');
            await editorHelper.expectPreviewElementAttribute({ selector: previewSelector, attributeName: attrName, value: null });
        });

        await test.step('削除: 属性定義自体を削除', async () => {
            const propertyContainer = editorHelper.getPropertyContainer();
            const picker = propertyContainer.locator('attribute-icon-picker[data-attribute-type="icon"]');

            await editorHelper.openAttributeEditor();
            await editorHelper.deleteAttributeDefinition(attrName);
            await expect(picker).toBeHidden();
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
            await expect(flexGrowInput).toBeEditable();
            await flexGrowInput.fill('1');
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'flex-grow', value: '1' });

            // --- 'flex-shrink' の操作 ---
            const flexShrinkInput = targetInputPanel.locator('input[id="flex-shrink"]');
            await expect(flexShrinkInput).toBeVisible();
            await expect(flexShrinkInput).toBeEditable();
            await flexShrinkInput.fill('2');
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'flex-shrink', value: '2' });

            // --- 'flex-basis' の操作 ---
            const flexBasisInput = targetInputPanel.locator('input[id="flex-basis"]');
            await expect(flexBasisInput).toBeVisible();
            await expect(flexBasisInput).toBeEditable();
            await flexBasisInput.fill('100%');
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'flex-basis', value: '100%' });

            // --- 'order' の操作 ---
            const orderInput = targetInputPanel.locator('input[id="order"]');
            await expect(orderInput).toBeVisible();
            await expect(orderInput).toBeEditable();
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

    test('属性(style-spacing)を編集・クリアできる', async ({ editorPage, editorHelper }) => {
        const previewSelector = 'ons-button';

        await test.step('セットアップ: ページとボタンを追加', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openMoveingHandle('right');
        });

        await test.step('検証: 余白(style-spacing)を設定しプレビューに反映されること', async () => {
            const propertyContainer = editorHelper.getPropertyContainer();
            const targetInputPanel = editorHelper.getPropertyInput('style-spacing');
            await expect(targetInputPanel).toBeVisible();

            // 直系子要素のみを指定して margin-top をピンポイントで取得
            const marginTopInput = targetInputPanel.locator('.margin-box > .top');
            await expect(marginTopInput).toBeVisible();
            await expect(marginTopInput).toBeEditable();
            await marginTopInput.fill('20px');
            await marginTopInput.blur(); // フォーカスを外して変更を適用・確定

            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'margin-top', value: '20px' });

            // 直系子要素のみを指定して padding-left をピンポイントで取得
            const paddingLeftInput = targetInputPanel.locator('.padding-box > .left');
            await expect(paddingLeftInput).toBeVisible();
            await expect(paddingLeftInput).toBeEditable();
            await paddingLeftInput.fill('15px');
            await paddingLeftInput.blur(); // フォーカスを外して変更を適用・確定

            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'padding-left', value: '15px' });
        });

        await test.step('検証: 入力値を空にして余白設定がクリアされること', async () => {
            const targetInputPanel = editorHelper.getPropertyInput('style-spacing');
            const marginTopInput = targetInputPanel.locator('.margin-box > .top');
            const paddingLeftInput = targetInputPanel.locator('.padding-box > .left');

            await marginTopInput.fill('');
            await marginTopInput.blur();
            await paddingLeftInput.fill('');
            await paddingLeftInput.blur();

            // すべての余白設定が解除され、style属性自体が完全に消去されていることを検証
            await editorHelper.expectPreviewElementAttribute({ selector: previewSelector, attributeName: 'style', value: null });
        });
    });

    test('属性(style-spacing)が表示され、ユーザーが並べ替えると位置が保持される', async ({ editorPage, editorHelper, isMobile }) => {
        // ドラッグ＆ドロップによる並べ替え操作を含むため、安定したマウス操作が可能なデスクトップ環境でのみ実行
        test.skip(isMobile, 'ドラッグ＆ドロップ操作が含まれるためデスクトップ環境で実行します。');

        let originalIndex = -1;

        await test.step('セットアップ: ページとボタンを追加し、属性パネルを開く', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
        });

        await test.step('検証: デフォルト状態でstyle-spacingが表示されていること', async () => {
            const propertyContainer = editorPage.locator('property-container');

            const attributeTypes = await propertyContainer.locator('[data-attribute-type]').evaluateAll(els => {
                const types = els.map(el => el.getAttribute('data-attribute-type')).filter(t => t !== null);
                // 重複を除去してDOM上の出現順に並べる
                return Array.from(new Set(types));
            });

            expect(attributeTypes).toContain('style-spacing');
            originalIndex = attributeTypes.indexOf('style-spacing');
        });

        await test.step('操作: 属性編集モーダルを開き、style-spacingをドラッグ＆ドロップで並び替える', async () => {
            const propertyContainer = editorPage.locator('property-container');

            const editAttrButton = propertyContainer.getByTitle('属性を編集');
            await expect(editAttrButton).toBeVisible();
            await editAttrButton.click();

            const attrList = editorPage.locator('#attributeList');
            await expect(attrList).toBeVisible();

            // テキスト部分一致（hasText）から、データ属性による確実な指定へ変更
            const spacingItem = attrList.locator('div.attribute-item[data-attribute-key="style-spacing"]').first();
            await expect(spacingItem).toBeVisible();

            // 要素を一番下までスクロールして表示させる
            await spacingItem.scrollIntoViewIfNeeded();
            await editorPage.waitForTimeout(500);

            // 画面外に出てしまう一番上ではなく、同じ画面内に収まっているすぐ上の要素(style-flex)を移動先に指定
            const targetItem = attrList.locator('div.attribute-item[data-attribute-key="style-flex"]').first();
            await expect(targetItem).toBeVisible();

            const dragSource = spacingItem.locator('.drag-handle').first();
            const sourceBox = await dragSource.boundingBox();
            const targetBox = await targetItem.boundingBox();

            if (sourceBox && targetBox) {
                const startX = sourceBox.x + sourceBox.width / 2;
                const startY = sourceBox.y + sourceBox.height / 2;
                const endX = targetBox.x + targetBox.width / 2;
                const endY = targetBox.y + 5;

                // マウス制御でドラッグ
                await editorPage.mouse.move(startX, startY);
                await editorPage.mouse.down();
                await editorPage.waitForTimeout(600); // ドラッグ開始の待機

                await editorPage.mouse.move(endX, endY, { steps: 20 });
                await editorPage.waitForTimeout(200);
                await editorPage.mouse.up();
            }

            // ドラッグ終了後、安全な位置に戻してマウストラップを解除
            await editorPage.mouse.move(0, 0);
            await editorPage.mouse.up().catch(() => { });
            await editorPage.keyboard.press('Escape'); // ドラッグ操作時の残存フォーカス/キー入力を完全解除
            await editorPage.waitForTimeout(500); // 状態が落ち着くまで待機

            // モーダルを閉じる：モーダル（#attributeList）の下端よりさらに下にある「コンテナ内空白領域」を動的に計算してクリックします。
            const attrListBox = await attrList.boundingBox();
            const propBox = await propertyContainer.boundingBox();

            if (attrListBox && propBox) {
                const clickX = propBox.x + 30; // プロパティコンテナの左端から30px（コンテナ内部）
                // モーダルの下端より50px下の位置。もしそれがコンテナ全体の高さを超える場合は、コンテナの下端から30px上の位置に調整
                let clickY = attrListBox.y + attrListBox.height + 50;
                if (clickY >= propBox.y + propBox.height) {
                    clickY = propBox.y + propBox.height - 30;
                }
                await editorPage.mouse.click(clickX, clickY);
            } else {
                // 万が一計測に失敗した場合の安全なフォールバッククリック
                await propertyContainer.click({ position: { x: 5, y: 400 }, force: true });
            }

            await editorPage.waitForTimeout(500);

            await expect(attrList).toBeHidden({ timeout: 5000 });
            await editorPage.waitForTimeout(300);
        });

        await test.step('検証: 並び替え後、style-spacingが移動した位置に保持されていること', async () => {
            const propertyContainer = editorPage.locator('property-container');

            const attributeTypes = await propertyContainer.locator('[data-attribute-type]').evaluateAll(els => {
                const types = els.map(el => el.getAttribute('data-attribute-type')).filter(t => t !== null);
                return Array.from(new Set(types));
            });

            expect(attributeTypes).toContain('style-spacing');
            // 並べ替え前とインデックス位置が異なっていることを確認
            const newIndex = attributeTypes.indexOf('style-spacing');
            expect(newIndex).not.toBe(originalIndex);
        });
    });

    test('トップテンプレートリストをキーボード（上下キー）で移動すると即座にテンプレートが切り替わる', async ({ editorPage, editorHelper }) => {
        let page1Id: string;
        let page2Id: string;

        await test.step('セットアップ: ページを2つ追加', async () => {
            // 左側のハンドルを開く
            await editorHelper.openMoveingHandle('left');

            // ページを2つ追加
            const page1Node = await editorHelper.addPage();
            page1Id = await page1Node.getAttribute('data-node-id') as string;

            const page2Node = await editorHelper.addPage();
            page2Id = await page2Node.getAttribute('data-node-id') as string;

            // 初期状態はpage2 (2番目に追加したもの) が選択されているはず
        });

        await test.step('検証: 上下キーによる即時切り替え', async () => {
            const topContainer = editorPage.locator('.top-container');
            const selectBox = topContainer.locator('.select');

            // リストを開く
            await selectBox.click();

            const topTemplateListContainer = editorPage.locator('#top-template-list');
            await expect(topTemplateListContainer).toBeVisible({ timeout: 5000 });

            // 現在の選択要素を確認
            const items = topTemplateListContainer.locator('.top-template-item');
            await expect(items).toHaveCount(3);

            // アプリケーション（ルート）の template-id は items の最初 (nth(0)) から取得
            const appId = await items.nth(0).getAttribute('data-template-id');
            expect(appId).not.toBeNull();

            // 下キーを押す -> page2 の次は application (先頭に戻る) のはず
            await editorPage.keyboard.press('ArrowDown');

            // 選択要素が変わったか確認 (appId)
            const selectedItem1 = topTemplateListContainer.locator('.selected-template');
            await expect(selectedItem1).toBeVisible();
            expect(await selectedItem1.getAttribute('data-template-id')).toBe(appId);

            // 上キーを押す -> 先頭から最後（page2）へ
            await editorPage.keyboard.press('ArrowUp');
            const selectedItem2 = topTemplateListContainer.locator('.selected-template');
            await expect(selectedItem2).toBeVisible();
            expect(await selectedItem2.getAttribute('data-template-id')).toBe(page2Id);

            // 上キーをもう一度押す -> page1
            await editorPage.keyboard.press('ArrowUp');
            const selectedItem3 = topTemplateListContainer.locator('.selected-template');
            await expect(selectedItem3).toBeVisible();
            expect(await selectedItem3.getAttribute('data-template-id')).toBe(page1Id);

            // Enterを押して閉じる
            await editorPage.keyboard.press('Enter');

            // リストが閉じたことを確認
            await expect(topTemplateListContainer).toBeHidden();
        });

        await test.step('検証: Escapeによるキャンセル（閉じる動作）', async () => {
            const topContainer = editorPage.locator('.top-container');
            const selectBox = topContainer.locator('.select');

            // リストを開く
            await selectBox.click();

            const topTemplateListContainer = editorPage.locator('#top-template-list');
            await expect(topTemplateListContainer).toBeVisible({ timeout: 5000 });

            // Escapeを押して閉じる
            await editorPage.keyboard.press('Escape');

            // リストが閉じたことを確認
            await expect(topTemplateListContainer).toBeHidden();
        });
    });

    test('属性(style-typography)による文字装飾の編集とプレビュー反映', async ({ editorPage, editorHelper }) => {
        const previewSelector = 'ons-button';

        await test.step('セットアップ: ページとボタンを追加し、属性パネルを開く', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
        });

        await test.step('検証: 文字装飾(style-typography)を設定しプレビューに反映されること', async () => {
            const targetInputPanel = editorHelper.getPropertyInput('style-typography');
            await expect(targetInputPanel).toBeVisible();

            // フォントサイズの入力・反映検証（キャメルケース表記も考慮して頑健化）
            const fontSizeInput = targetInputPanel.locator('input[name="font-size"], input[name="fontSize"], input#font-size').first();
            await expect(fontSizeInput).toBeVisible();
            await expect(fontSizeInput).toBeEditable();
            await fontSizeInput.fill('24px');
            await fontSizeInput.blur();
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'font-size', value: '24px' });

            // 文字色の入力・反映検証（input[type="color"]や、独自カラーコンポーネント attribute-color 内の input も対象に含める）
            const colorInput = targetInputPanel.locator('input[type="color"], attribute-color input, input[name="color"], input#color, .color input').first();
            await expect(colorInput).toBeVisible();
            await expect(colorInput).toBeEditable();
            await colorInput.fill('#ff0000');
            await colorInput.blur();
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'color', value: 'rgb(255, 0, 0)' });
        });

        await test.step('検証: 入力値を空にして文字装飾設定がクリアされること', async () => {
            const targetInputPanel = editorHelper.getPropertyInput('style-typography');
            const fontSizeInput = targetInputPanel.locator('input[name="font-size"], input[name="fontSize"], input#font-size').first();

            // フォントサイズをクリア
            await fontSizeInput.fill('');
            await fontSizeInput.blur();

            // HTMLの <input type="color"> は仕様上、値を完全に空（null）にできず常に #rrggbb を返すため、
            // style 属性そのものが消滅すること（value: null）を期待すると環境によってテストが失敗します。
            // したがって、「クリアしたプロパティ（font-size）が style 属性から確実に取り除かれていること」を検証します。
            const previewElement = editorHelper.getPreviewElement(previewSelector);

            // プレビュー要素がアタッチされ、属性の更新が反映されるのを少し待機する
            await editorPage.waitForTimeout(300);
            const styleAttr = await previewElement.getAttribute('style') || '';

            // font-size の記述が style 内に存在しないことをアサート
            expect(styleAttr).not.toContain('font-size:');
            expect(styleAttr).not.toContain('24px');
        });
    });

    test('テキスト非対応要素(img)では文字装飾(style-typography)が表示されないこと', async ({ editorPage, editorHelper }) => {
        await test.step('セットアップ: ページを追加し、imgタグを配置して選択する', async () => {
            await editorHelper.addPage();
            const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
            // img は標準HTMLタグのため、addComponentAsHtmlTag を使用して配置します
            const imgNode = await editorHelper.addComponentAsHtmlTag('img', contentAreaSelector);
            await editorHelper.selectNodeInDomTree(imgNode);
            await editorHelper.openMoveingHandle('right');
        });

        await test.step('検証: プロパティパネルに文字装飾(style-typography)が表示されないこと', async () => {
            const targetInputPanel = editorHelper.getPropertyInput('style-typography');
            // 表示されない（または非表示属性が効いている）ことを確認
            await expect(targetInputPanel).toBeHidden();
        });
    });

    test('属性(style-border)によるボーダー・角丸の編集、クリア、および異常系の検証', async ({ editorPage, editorHelper }) => {
        const previewSelector = 'ons-button';

        await test.step('セットアップ: ページとボタンを追加し、属性パネルを開く', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
        });

        await test.step('正常系: ボーダー・角丸（style-border）を設定し、プレビューに反映されること', async () => {
            const targetInputPanel = editorHelper.getPropertyInput('style-border');
            await expect(targetInputPanel).toBeVisible();

            // 角丸を設定
            const radiusInput = targetInputPanel.locator('input[name="borderRadius"], input[name="border-radius"], input#border-radius').first();
            await expect(radiusInput).toBeVisible();
            await expect(radiusInput).toBeEditable();
            await radiusInput.fill('15px');
            await radiusInput.blur();
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-radius', value: '15px' });

            // ボーダー幅を設定
            const widthInput = targetInputPanel.locator('input[name="borderWidth"], input[name="border-width"], input#border-width').first();
            await expect(widthInput).toBeVisible();
            await expect(widthInput).toBeEditable();
            await widthInput.fill('3px');
            await widthInput.blur();
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-width', value: '3px' });

            // ボーダースタイルを設定
            const styleSelect = targetInputPanel.locator('select[name="borderStyle"], select[name="border-style"], select#border-style').first();
            await expect(styleSelect).toBeVisible();
            await styleSelect.selectOption('dashed');
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-style', value: 'dashed' });

            // ボーダー色を設定
            const colorInput = targetInputPanel.locator('input[type="color"], attribute-color input, input[name="borderColor"], input#border-color, .color input').first();
            await expect(colorInput).toBeVisible();
            await expect(colorInput).toBeEditable();
            await colorInput.fill('#0000ff');
            await colorInput.blur();
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-color', value: 'rgb(0, 0, 255)' });
        });

        await test.step('異常系: 無効な値（不正な文字列）が入力されてもエディタが破損せず出力されること', async () => {
            const targetInputPanel = editorHelper.getPropertyInput('style-border');
            const radiusInput = targetInputPanel.locator('input[name="borderRadius"], input[name="border-radius"], input#border-radius').first();

            // 不正な文字列を入力
            await radiusInput.fill('invalid_value');
            await radiusInput.blur();

            const previewElement = editorHelper.getPreviewElement(previewSelector);
            await expect(previewElement).toHaveAttribute('style', /border-radius:\s*invalid_value/);
        });

        await test.step('正常系: 入力値を空にしてボーダー設定が部分的にクリアされること', async () => {
            const targetInputPanel = editorHelper.getPropertyInput('style-border');
            const radiusInput = targetInputPanel.locator('input[name="borderRadius"], input[name="border-radius"], input#border-radius').first();

            // 空にする
            await radiusInput.fill('');
            await radiusInput.blur();

            // プレビューのstyleからborder-radiusプロパティが消えていることを確認
            const previewElement = editorHelper.getPreviewElement(previewSelector);
            await editorPage.waitForTimeout(300);
            const styleAttr = await previewElement.getAttribute('style') || '';
            expect(styleAttr).not.toContain('border-radius:');
        });

        await test.step('異常系: 他のスタイルが既に存在する場合、上書き・破壊せずに更新できること', async () => {
            // スタイルタブ（Monaco Editor）に切り替え、他の無関係なスタイルを仕込む
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, 'スタイル');

            const styleEditor = propertyContainer.locator('#style-container > .monaco-editor');
            await expect(styleEditor).toBeVisible();

            const presetStyle = 'element.style {\n    color: rgb(0, 128, 0);\n    padding: 12px;\n}';
            await editorHelper.setMonacoValue(styleEditor, presetStyle);

            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'color', value: 'rgb(0, 128, 0)' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'padding', value: '12px' });

            // 属性タブに切り替えて style-border を編集
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
            const targetInputPanel = editorHelper.getPropertyInput('style-border');
            const widthInput = targetInputPanel.locator('input[name="borderWidth"], input[name="border-width"], input#border-width').first();

            await widthInput.fill('5px');
            await widthInput.blur();

            // 1. 新たに設定したボーダー幅が適用されていること
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-width', value: '5px' });

            // 2. 元々あった無関係なスタイルが破壊されず残っていること
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'color', value: 'rgb(0, 128, 0)' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'padding', value: '12px' });
        });

        await test.step('異常系: セミコロンのない崩れた手動スタイルがあっても、クラッシュせずに解析できること', async () => {
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, 'スタイル');

            const styleEditor = propertyContainer.locator('#style-container > .monaco-editor');
            await expect(styleEditor).toBeVisible();

            // セミコロンをわざと抜いた崩れたCSSを設定
            const brokenStyle = 'element.style {\n    border-radius: 8px\n}';
            await editorHelper.setMonacoValue(styleEditor, brokenStyle);

            // 属性タブに戻り、クラッシュせずに解析できていることを確認
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
            const targetInputPanel = editorHelper.getPropertyInput('style-border');
            await expect(targetInputPanel).toBeVisible();

            const radiusInput = targetInputPanel.locator('input[name="borderRadius"], input[name="border-radius"], input#border-radius').first();
            // セミコロンが欠落しているため現在の仕様上は解析できず空文字（""）になるが、
            // JSエラー等による画面のクラッシュがなく、安全に初期化されて描画が維持されることを検証
            await expect(radiusInput).toHaveValue('');
        });
    });

    /**
     * 【正常系テスト】
     * 属性（style-sizing）「サイズ / 表示制御」の編集、プレビュー反映、および部分クリアが
     * 正しく機能することを確認します。
     */
    test('属性(style-sizing)を編集・クリアできる', async ({ editorPage, editorHelper }) => {
        const previewSelector = 'ons-button';

        await test.step('セットアップ: ページとボタンを追加し、属性パネルを開く', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
        });

        await test.step('検証: サイズ / 表示制御(style-sizing)を設定しプレビューに反映されること', async () => {
            const targetInputPanel = editorHelper.getPropertyInput('style-sizing');
            await expect(targetInputPanel).toBeVisible();

            // 内部実装のID命名差異を避けるため、コンポーネント内のinput要素を順番（インデックス）で特定します。
            // 1番目のinput: width, 2番目のinput: height
            const widthInput = targetInputPanel.locator('input').nth(0);
            const heightInput = targetInputPanel.locator('input').nth(1);

            // LitElementのShadow DOM内部のレンダリング完了をポーリング待機します。
            await expect(async () => {
                await expect(widthInput).toBeVisible();
                await expect(widthInput).toBeEditable();
            }).toPass({ timeout: 10000, intervals: [500] });

            // 1. 幅(width)の設定と反映検証
            await widthInput.fill('200px');
            await widthInput.blur();
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'width', value: '200px' });

            // 2. 高さ(height)の設定と反映検証
            await expect(heightInput).toBeVisible();
            await heightInput.fill('100px');
            await heightInput.blur();
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'height', value: '100px' });

            // 3. 表示制御(overflow)の設定と反映検証
            // セレクトボックスも同様に、コンポーネント内の最初のselect要素として特定します
            const overflowSelect = targetInputPanel.locator('select').first();
            await expect(overflowSelect).toBeVisible();
            await overflowSelect.selectOption('scroll');
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'overflow', value: 'scroll' });
        });

        await test.step('検証: 入力値を空にしてサイズ設定が部分的にクリアされること', async () => {
            const targetInputPanel = editorHelper.getPropertyInput('style-sizing');
            const widthInput = targetInputPanel.locator('input').nth(0);

            // widthの値を空にする
            await widthInput.fill('');
            await widthInput.blur();

            const previewElement = editorHelper.getPreviewElement(previewSelector);
            await editorPage.waitForTimeout(300);
            const styleAttr = await previewElement.getAttribute('style') || '';

            // widthプロパティのみがstyle属性から消去され、残りのheightとoverflowが維持されていることを検証
            expect(styleAttr).not.toContain('width:');
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'height', value: '100px' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'overflow', value: 'scroll' });
        });
    });

    /**
     * 【異常系テスト】
     * 1. 類似プロパティ名（width / max-width）の競合によるパース干渉が起きないこと
     * 2. セミコロンがない手動CSS記述があってもシステムがクラッシュしないこと
     * 3. 無効な文字列が入力されてもエディタが破損しないこと
     * をそれぞれ検証します。
     */
    test('属性(style-sizing)における干渉防止と異常系の解析検証', async ({ editorPage, editorHelper }) => {
        const previewSelector = 'ons-button';

        await test.step('セットアップ: ページとボタンを追加する', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
        });

        await test.step('異常系1: max-widthが記述されていてもwidthが引きずられないことの干渉検証', async () => {
            // モバイル環境に備え、まず右側パネルを確実に展開します
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, 'スタイル');

            const styleEditor = propertyContainer.locator('#style-container > .monaco-editor');
            await expect(styleEditor).toBeVisible();

            // max-widthとmax-heightを設定し、通常のwidth/heightは未設定（空）にします
            const targetStyle = 'element.style {\n    max-width: 500px;\n    max-height: 400px;\n}';
            await editorHelper.setMonacoValue(styleEditor, targetStyle);

            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'max-width', value: '500px' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'max-height', value: '400px' });

            // 属性タブに切り替え、部分一致する通常のwidth/height入力欄に誤って値が解析・反映されていないか検証
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
            const targetInputPanel = editorHelper.getPropertyInput('style-sizing');
            await expect(targetInputPanel).toBeVisible();

            // インデックス指定で各inputを補足します
            const widthInput = targetInputPanel.locator('input').nth(0);
            const heightInput = targetInputPanel.locator('input').nth(1);

            // データの解析が落ち着くまで短い同期待機を挟みます
            await editorPage.waitForTimeout(1000);

            // ルックアハインドによる干渉防止が効き、通常のwidthとheightのフィールドは空（未指定）のままであるべき
            await expect(widthInput).toHaveValue('');
            await expect(heightInput).toHaveValue('');
        });

        await test.step('異常系2: セミコロンが欠落した手動CSSが存在してもシステムがクラッシュしないことの検証', async () => {
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, 'スタイル');

            const styleEditor = propertyContainer.locator('#style-container > .monaco-editor');
            await expect(styleEditor).toBeVisible();

            // 故意に末尾のセミコロンを省いた手動スタイルを設定
            const brokenStyle = 'element.style {\n    width: 300px\n}';
            await editorHelper.setMonacoValue(styleEditor, brokenStyle);

            // 属性タブに切り替えた際、JSエラーで画面が崩壊せず、安全に入力パネルが表示されること
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
            const targetInputPanel = editorHelper.getPropertyInput('style-sizing');
            await expect(targetInputPanel).toBeVisible();

            const widthInput = targetInputPanel.locator('input').nth(0);
            await expect(widthInput).toBeVisible();
        });

        await test.step('異常系3: 無効なCSS値が入力されてもエディタが破損せずそのまま適用されることの検証', async () => {
            const targetInputPanel = editorHelper.getPropertyInput('style-sizing');
            const widthInput = targetInputPanel.locator('input').nth(0);

            // 無効な文字列を入力
            await widthInput.fill('invalid_value_test');
            await widthInput.blur();

            // エディタ側で例外が発生せず、インラインスタイルにそのまま記述として反映されること
            const previewElement = editorHelper.getPreviewElement(previewSelector);
            await expect(previewElement).toHaveAttribute('style', /width:\s*invalid_value_test/);
        });
    });

    test('属性(style-shadow)によるシャドウ・奥行きの編集、既存スタイル競合防止、およびクリアの検証', async ({ editorPage, editorHelper }) => {
        const previewSelector = 'ons-button';

        await test.step('1. セットアップ: ページとボタンを追加し、属性パネルを開く', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
        });

        await test.step('2. 正常系: シャドウ・奥行き（style-shadow）を設定し、プレビューに反映されること', async () => {
            const targetInputPanel = editorHelper.getPropertyInput('style-shadow');
            await expect(targetInputPanel).toBeVisible();

            // 内部UIの実装に依存しないよう、コンポーネントから直接変更イベントをディスパッチ
            await targetInputPanel.evaluate((el) => {
                el.dispatchEvent(new CustomEvent('change', {
                    detail: {
                        boxShadow: '3px 3px 6px rgb(0, 0, 0)',
                        textShadow: '1px 1px 2px rgb(255, 0, 0)'
                    }
                }));
            });

            // プレビューにおけるCSSの反映を確認
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'box-shadow', value: 'rgb(0, 0, 0) 3px 3px 6px 0px' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'text-shadow', value: 'rgb(255, 0, 0) 1px 1px 2px' });
        });

        await test.step('3. 正常系: 既存のスタイル設定と競合せず、追記・維持されること', async () => {
            const propertyContainer = editorPage.locator('property-container');

            // スタイルタブ（Monaco Editor）に切り替え、他の無関係なスタイル（color, padding）を事前に登録
            await editorHelper.switchTabInContainer(propertyContainer, 'スタイル');
            const styleEditor = propertyContainer.locator('#style-container > .monaco-editor');
            await expect(styleEditor).toBeVisible();

            const presetStyle = 'element.style {\n    color: rgb(0, 128, 0);\n    padding: 15px;\n}';
            await editorHelper.setMonacoValue(styleEditor, presetStyle);

            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'color', value: 'rgb(0, 128, 0)' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'padding', value: '15px' });

            // 属性タブに戻り、シャドウを更新設定
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
            const targetInputPanel = editorHelper.getPropertyInput('style-shadow');
            await expect(targetInputPanel).toBeVisible();

            await targetInputPanel.evaluate((el) => {
                el.dispatchEvent(new CustomEvent('change', {
                    detail: {
                        boxShadow: '4px 4px 8px rgb(0, 0, 255)',
                        textShadow: ''
                    }
                }));
            });

            // 既存のスタイル（color, padding）が破壊されず維持されたまま、シャドウが正しく更新されていることを検証
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'color', value: 'rgb(0, 128, 0)' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'padding', value: '15px' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'box-shadow', value: 'rgb(0, 0, 255) 4px 4px 8px 0px' });
        });

        await test.step('4. 正常系: 値を空に更新した際、対象のシャドウスタイルのみが削除され、他は残ること', async () => {
            const targetInputPanel = editorHelper.getPropertyInput('style-shadow');
            await expect(targetInputPanel).toBeVisible();

            // 値を空にしてイベントを送信
            await targetInputPanel.evaluate((el) => {
                el.dispatchEvent(new CustomEvent('change', {
                    detail: {
                        boxShadow: '',
                        textShadow: ''
                    }
                }));
            });

            // プレビューのインラインスタイル属性からシャドウのみが除去されていることを確認
            const previewElement = editorHelper.getPreviewElement(previewSelector);
            await editorPage.waitForTimeout(500);
            const styleAttr = await previewElement.getAttribute('style') || '';
            expect(styleAttr).not.toContain('box-shadow:');
            expect(styleAttr).not.toContain('text-shadow:');

            // 既存の他のスタイル（color, padding）は残っていること
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'color', value: 'rgb(0, 128, 0)' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'padding', value: '15px' });
        });

        await test.step('5. 異常系: セミコロンのない崩れた手動スタイルが存在しても、クラッシュせずに解析・描画されること', async () => {
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, 'スタイル');

            const styleEditor = propertyContainer.locator('#style-container > .monaco-editor');
            await expect(styleEditor).toBeVisible();

            // セミコロンをわざと抜いた崩れたCSSを設定
            const brokenStyle = 'element.style {\n    box-shadow: 2px 2px 2px black\n}';
            await editorHelper.setMonacoValue(styleEditor, brokenStyle);

            // 属性タブに戻り、解析中にクラッシュせず安全に入力パネルが描画されることを検証
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
            const targetInputPanel = editorHelper.getPropertyInput('style-shadow');
            await expect(targetInputPanel).toBeVisible();
        });
    });
});