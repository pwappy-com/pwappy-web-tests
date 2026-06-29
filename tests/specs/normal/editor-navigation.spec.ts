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

/**
 * 指定した入力欄をマウスでドラッグするヘルパー関数
 */
async function dragInput(editorPage: Page, inputLocator: Locator, deltaX: number, deltaY: number, shiftKey: boolean = false) {
    const box = await inputLocator.boundingBox();
    if (!box) throw new Error('Input bounding box not found');

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    // 製品の新仕様（フォーカス時のみドラッグを受け付ける）に合わせ、事前にクリックしてフォーカスを取得
    await inputLocator.click();
    await editorPage.waitForTimeout(100);

    await editorPage.mouse.move(startX, startY);

    if (shiftKey) await editorPage.keyboard.down('Shift');
    await editorPage.mouse.down();

    // 新仕様に沿ってドラッグ方向を調整
    // Y軸（縦）方向のみの入力だった場合は、縦スワイプによるキャンセルを避けるため自動的にX軸（横）方向の動きに補正します
    let finalDeltaX = deltaX;
    let finalDeltaY = deltaY;
    if (deltaX === 0 && deltaY !== 0) {
        finalDeltaX = -deltaY; // 上方向へのスライド（deltaY < 0）を右スライド（finalDeltaX > 0）に変換
        finalDeltaY = 0;
    }

    // 遊び（10px）の閾値判定を通過させつつ、なめらかに移動する
    await editorPage.mouse.move(startX + finalDeltaX, startY + finalDeltaY, { steps: 10 });
    await editorPage.mouse.up();
    if (shiftKey) await editorPage.keyboard.up('Shift');
}

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

    // test('属性(style-border)によるボーダー・角丸の編集、クリア、および異常系の検証', async ({ editorPage, editorHelper }) => {
    //     const previewSelector = 'ons-button';

    //     await test.step('セットアップ: ページとボタンを追加し、属性パネルを開く', async () => {
    //         const { buttonNode } = await editorHelper.setupPageWithButton();
    //         await editorHelper.selectNodeInDomTree(buttonNode);
    //         await editorHelper.openMoveingHandle('right');
    //         const propertyContainer = editorPage.locator('property-container');
    //         await editorHelper.switchTabInContainer(propertyContainer, '属性');
    //     });

    //     await test.step('正常系: ボーダー・角丸（style-border）を設定し、プレビューに反映されること', async () => {
    //         const targetInputPanel = editorHelper.getPropertyInput('style-border');
    //         await expect(targetInputPanel).toBeVisible();

    //         // 角丸を設定
    //         const radiusInput = targetInputPanel.locator('input[name="borderRadius"], input[name="border-radius"], input#border-radius').first();
    //         await expect(radiusInput).toBeVisible();
    //         await expect(radiusInput).toBeEditable();
    //         await radiusInput.fill('15px');
    //         await radiusInput.blur();
    //         await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-radius', value: '15px' });

    //         // ボーダー幅を設定
    //         const widthInput = targetInputPanel.locator('input[name="borderWidth"], input[name="border-width"], input#border-width').first();
    //         await expect(widthInput).toBeVisible();
    //         await expect(widthInput).toBeEditable();
    //         await widthInput.fill('3px');
    //         await widthInput.blur();
    //         await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-width', value: '3px' });

    //         // ボーダースタイルを設定
    //         const styleSelect = targetInputPanel.locator('select[name="borderStyle"], select[name="border-style"], select#border-style').first();
    //         await expect(styleSelect).toBeVisible();
    //         await styleSelect.selectOption('dashed');
    //         await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-style', value: 'dashed' });

    //         // ボーダー色を設定
    //         const colorInput = targetInputPanel.locator('input[type="color"], attribute-color input, input[name="borderColor"], input#border-color, .color input').first();
    //         await expect(colorInput).toBeVisible();
    //         await expect(colorInput).toBeEditable();
    //         await colorInput.fill('#0000ff');
    //         await colorInput.blur();
    //         await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-color', value: 'rgb(0, 0, 255)' });
    //     });

    //     await test.step('異常系: 無効な値（不正な文字列）が入力されてもエディタが破損せず出力されること', async () => {
    //         const targetInputPanel = editorHelper.getPropertyInput('style-border');
    //         const radiusInput = targetInputPanel.locator('input[name="borderRadius"], input[name="border-radius"], input#border-radius').first();

    //         // 不正な文字列を入力
    //         await radiusInput.fill('invalid_value');
    //         await radiusInput.blur();

    //         const previewElement = editorHelper.getPreviewElement(previewSelector);
    //         await expect(previewElement).toHaveAttribute('style', /border-radius:\s*invalid_value/);
    //     });

    //     await test.step('正常系: 入力値を空にしてボーダー設定が部分的にクリアされること', async () => {
    //         const targetInputPanel = editorHelper.getPropertyInput('style-border');
    //         const radiusInput = targetInputPanel.locator('input[name="borderRadius"], input[name="border-radius"], input#border-radius').first();

    //         // 空にする
    //         await radiusInput.fill('');
    //         await radiusInput.blur();

    //         // プレビューのstyleからborder-radiusプロパティが消えていることを確認
    //         const previewElement = editorHelper.getPreviewElement(previewSelector);
    //         await editorPage.waitForTimeout(300);
    //         const styleAttr = await previewElement.getAttribute('style') || '';
    //         expect(styleAttr).not.toContain('border-radius:');
    //     });

    //     await test.step('異常系: 他のスタイルが既に存在する場合、上書き・破壊せずに更新できること', async () => {
    //         // スタイルタブ（Monaco Editor）に切り替え、他の無関係なスタイルを仕込む
    //         const propertyContainer = editorPage.locator('property-container');
    //         await editorHelper.switchTabInContainer(propertyContainer, 'スタイル');

    //         const styleEditor = propertyContainer.locator('#style-container > .monaco-editor');
    //         await expect(styleEditor).toBeVisible();

    //         const presetStyle = 'element.style {\n    color: rgb(0, 128, 0);\n    padding: 12px;\n}';
    //         await editorHelper.setMonacoValue(styleEditor, presetStyle);

    //         await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'color', value: 'rgb(0, 128, 0)' });
    //         await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'padding', value: '12px' });

    //         // 属性タブに切り替えて style-border を編集
    //         await editorHelper.switchTabInContainer(propertyContainer, '属性');
    //         const targetInputPanel = editorHelper.getPropertyInput('style-border');
    //         const widthInput = targetInputPanel.locator('input[name="borderWidth"], input[name="border-width"], input#border-width').first();

    //         await widthInput.fill('5px');
    //         await widthInput.blur();

    //         // 1. 新たに設定したボーダー幅が適用されていること
    //         await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-width', value: '5px' });

    //         // 2. 元々あった無関係なスタイルが破壊されず残っていること
    //         await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'color', value: 'rgb(0, 128, 0)' });
    //         await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'padding', value: '12px' });
    //     });

    //     await test.step('異常系: セミコロンのない崩れた手動スタイルがあっても、クラッシュせずに解析できること', async () => {
    //         const propertyContainer = editorPage.locator('property-container');
    //         await editorHelper.switchTabInContainer(propertyContainer, 'スタイル');

    //         const styleEditor = propertyContainer.locator('#style-container > .monaco-editor');
    //         await expect(styleEditor).toBeVisible();

    //         // セミコロンをわざと抜いた崩れたCSSを設定
    //         const brokenStyle = 'element.style {\n    border-radius: 8px\n}';
    //         await editorHelper.setMonacoValue(styleEditor, brokenStyle);

    //         // 属性タブに戻り、クラッシュせずに解析できていることを確認
    //         await editorHelper.switchTabInContainer(propertyContainer, '属性');
    //         const targetInputPanel = editorHelper.getPropertyInput('style-border');
    //         await expect(targetInputPanel).toBeVisible();

    //         const radiusInput = targetInputPanel.locator('input[name="borderRadius"], input[name="border-radius"], input#border-radius').first();
    //         // セミコロンが欠落しているため現在の仕様上は解析できず空文字（""）になるが、
    //         // JSエラー等による画面のクラッシュがなく、安全に初期化されて描画が維持されることを検証
    //         await expect(radiusInput).toHaveValue('');
    //     });
    // });

    // /**
    //  * 【正常系テスト】
    //  * 属性（style-sizing）「サイズ / 表示制御」の編集、プレビュー反映、および部分クリアが
    //  * 正しく機能することを確認します。
    //  */
    // test('属性(style-sizing)を編集・クリアできる', async ({ editorPage, editorHelper }) => {
    //     const previewSelector = 'ons-button';

    //     await test.step('セットアップ: ページとボタンを追加し、属性パネルを開く', async () => {
    //         const { buttonNode } = await editorHelper.setupPageWithButton();
    //         await editorHelper.selectNodeInDomTree(buttonNode);
    //         await editorHelper.openMoveingHandle('right');
    //         const propertyContainer = editorPage.locator('property-container');
    //         await editorHelper.switchTabInContainer(propertyContainer, '属性');
    //     });

    //     await test.step('検証: サイズ / 表示制御(style-sizing)を設定しプレビューに反映されること', async () => {
    //         const targetInputPanel = editorHelper.getPropertyInput('style-sizing');
    //         await expect(targetInputPanel).toBeVisible();

    //         // 内部実装のID命名差異を避けるため、コンポーネント内のinput要素を順番（インデックス）で特定します。
    //         // 1番目のinput: width, 2番目のinput: height
    //         const widthInput = targetInputPanel.locator('input').nth(0);
    //         const heightInput = targetInputPanel.locator('input').nth(1);

    //         // LitElementのShadow DOM内部のレンダリング完了をポーリング待機します。
    //         await expect(async () => {
    //             await expect(widthInput).toBeVisible();
    //             await expect(widthInput).toBeEditable();
    //         }).toPass({ timeout: 10000, intervals: [500] });

    //         // 1. 幅(width)の設定と反映検証
    //         await widthInput.fill('200px');
    //         await widthInput.blur();
    //         await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'width', value: '200px' });

    //         // 2. 高さ(height)の設定と反映検証
    //         await expect(heightInput).toBeVisible();
    //         await heightInput.fill('100px');
    //         await heightInput.blur();
    //         await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'height', value: '100px' });

    //         // 3. 表示制御(overflow)の設定と反映検証
    //         // セレクトボックスも同様に、コンポーネント内の最初のselect要素として特定します
    //         const overflowSelect = targetInputPanel.locator('select').first();
    //         await expect(overflowSelect).toBeVisible();
    //         await overflowSelect.selectOption('scroll');
    //         await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'overflow', value: 'scroll' });
    //     });

    //     await test.step('検証: 入力値を空にしてサイズ設定が部分的にクリアされること', async () => {
    //         const targetInputPanel = editorHelper.getPropertyInput('style-sizing');
    //         const widthInput = targetInputPanel.locator('input').nth(0);

    //         // widthの値を空にする
    //         await widthInput.fill('');
    //         await widthInput.blur();

    //         const previewElement = editorHelper.getPreviewElement(previewSelector);
    //         await editorPage.waitForTimeout(300);
    //         const styleAttr = await previewElement.getAttribute('style') || '';

    //         // widthプロパティのみがstyle属性から消去され、残りのheightとoverflowが維持されていることを検証
    //         expect(styleAttr).not.toContain('width:');
    //         await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'height', value: '100px' });
    //         await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'overflow', value: 'scroll' });
    //     });
    // });

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

    test('属性(style-shadow)での不透明度ドラッグバッジによる微調整とShift加速の検証', async ({ editorPage, editorHelper }) => {
        const previewSelector = 'ons-button';

        await test.step('1. セットアップ: ページとボタンを追加し、属性パネルを開く', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
        });

        const targetInputPanel = editorHelper.getPropertyInput('style-shadow');
        const dragBadge = targetInputPanel.locator('.drag-badge').first();

        await test.step('2. ボックスシャドウを展開し、初期値を設定する', async () => {
            await expect(targetInputPanel).toBeVisible();

            // アコーディオンを開く
            const accordionHeader = targetInputPanel.locator('.accordion-header').first();
            await accordionHeader.click();
            await expect(targetInputPanel.locator('.accordion-content').first()).toHaveClass(/expanded/);

            // 内部UIに依存せず、changeイベントで初期シャドウ（不透明度 50%）を適用
            await targetInputPanel.evaluate((el) => {
                el.dispatchEvent(new CustomEvent('change', {
                    detail: {
                        boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.5)',
                        textShadow: ''
                    }
                }));
            });
        });

        await test.step('3. バッジの初期表示とツールチップの検証', async () => {
            await expect(dragBadge).toBeVisible();
            await expect(dragBadge).toHaveAttribute('title', '左右スワイプで微調整できます');

            // ポーリングを挟んで確実に初期値が 50% に更新されるのを待つ
            await expect(dragBadge).toHaveText(/50%/, { timeout: 5000 });
        });

        await test.step('4. マウスの上方向ドラッグで不透明度が増加すること', async () => {
            // 右方向へ 60px スライド移動 (startX + 60)
            await dragBadge.evaluate((badgeEl) => {
                const rect = badgeEl.getBoundingClientRect();
                const startX = rect.left + rect.width / 2;
                const startY = rect.top + rect.height / 2;

                // mousedown
                badgeEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: startX, clientY: startY }));
                // mousemove (左右方向スライドへ統合されたため、clientX を変化させる)
                window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: startX + 60, clientY: startY }));
                // mouseup
                window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: startX + 60, clientY: startY }));
            });

            await expect(async () => {
                const text = await dragBadge.innerText();
                const val = parseInt(text.replace('%', ''), 10);

                expect(val).toBeGreaterThan(50);
                expect(val).toBeLessThan(100);
            }).toPass({ timeout: 5000, intervals: [100, 200] });

            // ドラッグ終了後に .dragging クラスが外れていること
            await expect(dragBadge).not.toHaveClass(/dragging/);

            // プレビューの style 属性のアルファ値が増加していることを検証
            const styleAttr = await editorHelper.getPreviewElement(previewSelector).getAttribute('style') || '';
            expect(styleAttr).toMatch(/box-shadow:.*rgba?\(0,\s*0,\s*0,\s*0\.[6-9]\d*\)/);

            // 次の検証のために 50% にリセット
            await targetInputPanel.evaluate((el) => {
                el.dispatchEvent(new CustomEvent('change', {
                    detail: {
                        boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.5)',
                        textShadow: ''
                    }
                }));
            });
            await expect(dragBadge).toHaveText(/50%/, { timeout: 5000 });
        });

        await test.step('5. Shiftキー併用時の加速効果の検証', async () => {
            // 右方向へ 30px スライド移動 (startX + 30)
            await dragBadge.evaluate((badgeEl) => {
                const rect = badgeEl.getBoundingClientRect();
                const startX = rect.left + rect.width / 2;
                const startY = rect.top + rect.height / 2;

                badgeEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: startX, clientY: startY }));
                window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: startX + 30, clientY: startY, shiftKey: true }));
                window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: startX + 30, clientY: startY, shiftKey: true }));
            });

            await expect(async () => {
                const text = await dragBadge.innerText();
                const valWithShift = parseInt(text.replace('%', ''), 10);

                expect(valWithShift).toBeGreaterThan(75);
            }).toPass({ timeout: 5000, intervals: [100, 200] });
        });

        await test.step('6. 0%未満、100%超への境界値（クランプ）処理の検証', async () => {
            // 右方向へ過剰にドラッグ (startX + 300) -> 100% でクランプされること
            await dragBadge.evaluate((badgeEl) => {
                const rect = badgeEl.getBoundingClientRect();
                const startX = rect.left + rect.width / 2;
                const startY = rect.top + rect.height / 2;

                badgeEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: startX, clientY: startY }));
                window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: startX + 300, clientY: startY }));
                window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: startX + 300, clientY: startY }));
            });
            await expect(async () => {
                await expect(dragBadge).toHaveText(/100%/);
            }).toPass({ timeout: 5000 });

            // 左方向へ過剰にドラッグ (startX - 300) -> 0% でクランプされること
            await dragBadge.evaluate((badgeEl) => {
                const rect = badgeEl.getBoundingClientRect();
                const startX = rect.left + rect.width / 2;
                const startY = rect.top + rect.height / 2;

                badgeEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: startX, clientY: startY }));
                window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: startX - 300, clientY: startY }));
                window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: startX - 300, clientY: startY }));
            });
            await expect(async () => {
                await expect(dragBadge).toHaveText(/0%/);
            }).toPass({ timeout: 5000 });

            await expect(dragBadge).not.toHaveClass(/dragging/);
        });
    });

    test('属性(style-background)による背景・装飾の編集、クリア、および異常系の検証', async ({ editorPage, editorHelper }) => {
        const previewSelector = 'ons-button';

        await test.step('セットアップ: ページとボタンを追加し、属性パネルを開く', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
        });

        await test.step('正常系: 背景・装飾（style-background）が表示され、設定がプレビューに反映されること', async () => {
            const targetInputPanel = editorHelper.getPropertyInput('style-background');
            // 表示されていることを確認
            await expect(targetInputPanel).toBeVisible();

            // 属性名やID、要素タイプから各入力フィールドを確実に特定
            const bgColorInput = targetInputPanel.locator('input[name*="color" i], input[id*="color" i], input[type="color"]').first();
            const bgImageInput = targetInputPanel.locator('input[name*="image" i], input[id*="image" i], input[placeholder*="image" i], input[placeholder*="画像" i], input[name="backgroundImage"]').first();
            const opacityInput = targetInputPanel.locator('input[name*="opacity" i], input[id*="opacity" i], input[type="range"], input[type="number"], input[placeholder*="opacity" i], input').last();

            // 背景色を設定
            await expect(bgColorInput).toBeVisible();
            await expect(bgColorInput).toBeEditable();
            await bgColorInput.fill('#00ff00');
            await bgColorInput.blur();
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'background-color', value: 'rgb(0, 255, 0)' });

            // 背景画像を設定 (生パスのみを指定)
            await expect(bgImageInput).toBeVisible();
            await expect(bgImageInput).toBeEditable();
            await bgImageInput.fill('images/icon-192x192.webp');
            await bgImageInput.blur();
            // ブラウザ側で絶対パスに解決されるため、正規表現でアサーションを行います
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'background-image', value: /url\(.*images\/icon-192x192\.webp.*\)/ });

            // 透明度を設定
            await expect(opacityInput).toBeVisible();
            await expect(opacityInput).toBeEditable();
            await opacityInput.fill('0.5');
            await opacityInput.blur();
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'opacity', value: '0.5' });
        });

        await test.step('正常系: 入力値を空にして背景設定が部分的にクリアされること', async () => {
            const targetInputPanel = editorHelper.getPropertyInput('style-background');
            // スライダーでのfill('')エラーを回避するため、背景画像テキスト欄を空にする
            const bgImageInput = targetInputPanel.locator('input[name*="image" i], input[id*="image" i], input[placeholder*="image" i], input[placeholder*="画像" i], input[name="backgroundImage"]').first();

            // 背景画像を空にする
            await bgImageInput.fill('');
            await bgImageInput.blur();

            // プレビューのstyleからbackground-imageプロパティが消えていることを確認
            const previewElement = editorHelper.getPreviewElement(previewSelector);
            await editorPage.waitForTimeout(300);
            const styleAttr = await previewElement.getAttribute('style') || '';
            expect(styleAttr).not.toContain('background-image:');

            // 他の設定（背景色や不透明度）は残っていること
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'background-color', value: 'rgb(0, 255, 0)' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'opacity', value: '0.5' });
        });

        await test.step('異常系: 他のスタイルが既に存在する場合、上書き・破壊せずに更新できること', async () => {
            // スタイルタブ（Monaco Editor）に切り替え、他の無関係なスタイルを仕込む
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, 'スタイル');

            const styleEditor = propertyContainer.locator('#style-container > .monaco-editor');
            await expect(styleEditor).toBeVisible();

            const presetStyle = 'element.style {\n    color: rgb(255, 255, 255);\n    padding: 20px;\n}';
            await editorHelper.setMonacoValue(styleEditor, presetStyle);

            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'color', value: 'rgb(255, 255, 255)' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'padding', value: '20px' });

            // 属性タブに切り替えて style-background を編集
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
            const targetInputPanel = editorHelper.getPropertyInput('style-background');
            const bgImageInput = targetInputPanel.locator('input[name*="image" i], input[id*="image" i], input[placeholder*="image" i], input[placeholder*="画像" i], input[name="backgroundImage"]').first();

            await bgImageInput.fill('images/icon-192x192.webp');
            await bgImageInput.blur();

            // 1. 新たに設定した背景画像が適用されていること
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'background-image', value: /url\(.*images\/icon-192x192\.webp.*\)/ });

            // 2. 元々あった無関係なスタイルが破壊されず残っていること
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'color', value: 'rgb(255, 255, 255)' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'padding', value: '20px' });
        });

        await test.step('異常系: セミコロンのない崩れた手動スタイルがあっても、クラッシュせずに解析できること', async () => {
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, 'スタイル');

            const styleEditor = propertyContainer.locator('#style-container > .monaco-editor');
            await expect(styleEditor).toBeVisible();

            // セミコロンをわざと抜いた崩れたCSSを設定 (背景画像を対象)
            const brokenStyle = 'element.style {\n    background-image: url("images/icon-192x192.webp")\n}';
            await editorHelper.setMonacoValue(styleEditor, brokenStyle);

            // 属性タブに戻り、クラッシュせずに解析できていることを確認
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
            const targetInputPanel = editorHelper.getPropertyInput('style-background');
            await expect(targetInputPanel).toBeVisible();

            const bgImageInput = targetInputPanel.locator('input[name*="image" i], input[id*="image" i], input[placeholder*="image" i], input[placeholder*="画像" i], input[name="backgroundImage"]').first();
            // セミコロンが欠落しているため現在の仕様上は解析できず空文字（""）になるが、
            // JSエラー等による画面のクラッシュがなく、安全に初期化されて描画が維持されることを検証
            await expect(bgImageInput).toHaveValue('');
        });
    });

    test('属性(style-background)のグラデーション設定時の要素切り替えによるアコーディオン展開状態の同期検証', async ({ editorPage, editorHelper }) => {
        let buttonId: string;
        let contentNodeId: string;

        const propertyContainer = editorHelper.getPropertyContainer();

        await test.step('セットアップ: ページとボタンを追加し、各ノードのIDを取得する', async () => {
            await editorHelper.addPage();
            const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
            const contentNode = editorPage.locator(contentAreaSelector);

            // 切り替え対象となるコンテンツエリア（親ノード）のIDを取得
            contentNodeId = await contentNode.getAttribute('data-node-id') as string;

            // グラデーションを設定するボタンノードを追加してIDを取得
            const buttonNode = await editorHelper.addComponent('ons-button', contentAreaSelector);
            buttonId = await buttonNode.getAttribute('data-node-id') as string;
        });

        await test.step('1. ボタンを選択し、グラデーションを有効にする', async () => {
            // ボタンを選択
            await editorHelper.selectNodeByAttribute('data-node-id', buttonId);

            // モバイル用に右パネルを展開し、属性タブへ移動
            await editorHelper.openMoveingHandle('right');
            await editorHelper.switchTabInContainer(propertyContainer, '属性');

            const targetInputPanel = editorHelper.getPropertyInput('style-background');
            await expect(targetInputPanel).toBeVisible();

            // 「グラデーションを使用する」チェックボックスをONにする
            const gradientCheckbox = targetInputPanel.locator('.accordion-header input[type="checkbox"]');
            await expect(gradientCheckbox).toBeVisible();
            await gradientCheckbox.check();

            // アコーディオンのコンテンツエリアが展開表示（expandedクラスを保持）されていることを確認
            const accordionContent = targetInputPanel.locator('.accordion-content');
            await expect(accordionContent).toHaveClass(/expanded/);
        });

        await test.step('2. コンテンツエリア（非グラデーション要素）に選択を切り替える', async () => {
            // 親のコンテンツエリアに選択を切り替え
            await editorHelper.selectNodeByAttribute('data-node-id', contentNodeId);

            // 要素切り替えによって閉じられた右パネルをモバイル環境向けに再展開
            await editorHelper.openMoveingHandle('right');

            const targetInputPanel = editorHelper.getPropertyInput('style-background');
            await expect(targetInputPanel).toBeVisible();

            // Litの再描画ラグを考慮し、チェックが外れ、アコーディオンが閉じていることをポーリング待機して検証
            await expect(async () => {
                const gradientCheckbox = targetInputPanel.locator('.accordion-header input[type="checkbox"]');
                await expect(gradientCheckbox).not.toBeChecked();

                const accordionContent = targetInputPanel.locator('.accordion-content');
                await expect(accordionContent).not.toHaveClass(/expanded/);
            }).toPass({ timeout: 5000, intervals: [500] });
        });

        await test.step('3. 再びボタンを選択し、グラデーションセクションが自動で展開されることを確認', async () => {
            // 左パネルを開いて、再度グラデーション設定済みのボタンを選択
            await editorHelper.openMoveingHandle('left');
            await editorHelper.selectNodeByAttribute('data-node-id', buttonId);

            // 右パネルを展開
            await editorHelper.openMoveingHandle('right');

            const targetInputPanel = editorHelper.getPropertyInput('style-background');
            await expect(targetInputPanel).toBeVisible();

            // 【不具合修正の検証】再びアコーディオンが自動で展開状態に戻っていることを検証
            await expect(async () => {
                const gradientCheckbox = targetInputPanel.locator('.accordion-header input[type="checkbox"]');
                await expect(gradientCheckbox).toBeChecked();

                const accordionContent = targetInputPanel.locator('.accordion-content');
                await expect(accordionContent).toHaveClass(/expanded/);
            }).toPass({ timeout: 5000, intervals: [500] });
        });
    });

    test('属性(style-typography)でのマウスドラッグによる数値増減とクランプ処理の検証', async ({ editorPage, editorHelper }) => {
        const previewSelector = 'ons-button';

        await test.step('セットアップ: ページとボタンを追加し、属性パネルを開く', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
        });

        const targetInputPanel = editorHelper.getPropertyInput('style-typography');
        const fontSizeInput = targetInputPanel.locator('input[name="font-size"], input[name="fontSize"], input#font-size').first();

        await test.step('検証: マウスの上方向ドラッグでフォントサイズが増加すること', async () => {
            await fontSizeInput.fill('16px');
            await fontSizeInput.blur();

            // 上方向へ50pxドラッグ (Y軸マイナス方向)
            await dragInput(editorPage, fontSizeInput, 0, -50);

            const val = parseInt(await fontSizeInput.inputValue());
            expect(val).toBeGreaterThan(16);
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'font-size', value: `${val}px` });
        });

        await test.step('検証: マウスの下方向ドラッグによる減少と、0未満へのクランプ処理', async () => {
            // 下方向へ大きくドラッグして負の値の領域に持っていく
            await dragInput(editorPage, fontSizeInput, 0, 150);

            // フォントサイズは0未満にならない（0pxに留まる）設計を検証
            await expect(fontSizeInput).toHaveValue('0px');
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'font-size', value: '0px' });
        });
    });

    test('属性(style-typography)での小数ステップ（行高）と負の値許容（文字間隔）のドラッグ検証', async ({ editorPage, editorHelper }) => {
        const previewSelector = 'ons-button';

        await test.step('セットアップ: ページとボタンを追加し、属性パネルを開く', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
        });

        const targetInputPanel = editorHelper.getPropertyInput('style-typography');
        const lineHeightInput = targetInputPanel.locator('input#line-height').first();
        const letterSpacingInput = targetInputPanel.locator('input#letter-spacing').first();

        await test.step('検証: 行高（line-height）の小数ステップの増減', async () => {
            await lineHeightInput.fill('1.5');
            await lineHeightInput.blur();

            // 上へドラッグして増やす
            await dragInput(editorPage, lineHeightInput, 0, -30);
            const val = parseFloat(await lineHeightInput.inputValue());

            // 1.5より増加し、かつ小数の増減（例: 2.1など）になっているか検証
            expect(val).toBeGreaterThan(1.5);
            expect(val % 1).not.toBe(0);
        });

        await test.step('検証: 文字間隔（letter-spacing）の負の値の許容', async () => {
            await letterSpacingInput.fill('0px');
            await letterSpacingInput.blur();

            // 下へドラッグして減らす
            await dragInput(editorPage, letterSpacingInput, 0, 50);
            const val = parseFloat(await letterSpacingInput.inputValue());

            // 負の値（マイナス）に到達していることを検証
            expect(val).toBeLessThan(0);
        });
    });

    test('属性(style-typography)でのShiftキー併用加速とデッドゾーン誤検知防止の検証', async ({ editorPage, editorHelper }) => {
        await test.step('セットアップ: ページとボタンを追加し、属性パネルを開く', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
        });

        const targetInputPanel = editorHelper.getPropertyInput('style-typography');
        const fontSizeInput = targetInputPanel.locator('input[name="font-size"], input[name="fontSize"], input#font-size').first();

        await test.step('検証: Shiftキー押下時の変化量の加速効果', async () => {
            await fontSizeInput.fill('10px');
            await fontSizeInput.blur();

            // 通常のドラッグ（上へ20px）
            await dragInput(editorPage, fontSizeInput, 0, -20, false);
            const normalDiff = parseInt(await fontSizeInput.inputValue()) - 10;

            await fontSizeInput.fill('10px');
            await fontSizeInput.blur();

            // Shiftキーを押しながらのドラッグ（上へ20px）
            await dragInput(editorPage, fontSizeInput, 0, -20, true);
            const shiftDiff = parseInt(await fontSizeInput.inputValue()) - 10;

            // 加速により、通常時の変化量より大幅に大きくなっていることを検証
            expect(shiftDiff).toBeGreaterThan(normalDiff * 5);
        });

        await test.step('検証: 横ブレや微小な動き（デッドゾーン）による誤検知防止', async () => {
            await fontSizeInput.fill('15px');
            await fontSizeInput.blur();

            // 新仕様：横方向（X軸）に 5px の微小な移動（遊び 10px 未満のためドラッグが開始されず値が変化しない）
            await dragInput(editorPage, fontSizeInput, 5, 0, false);

            // ドラッグ操作として判定されず、値が変化しないことを検証
            await expect(fontSizeInput).toHaveValue('15px');
        });
    });

    test('属性(style-typography)でのタッチイベントによるドラッグ検証（モバイル環境用）', async ({ editorPage, editorHelper, isMobile }) => {
        // モバイルビューポートでのテスト時のみ活性化
        test.skip(!isMobile, 'This test is exclusive to mobile browser environments.');

        await test.step('セットアップ: ページとボタンを追加し、属性パネルを開く', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
        });

        const targetInputPanel = editorHelper.getPropertyInput('style-typography');
        const fontSizeInput = targetInputPanel.locator('input[name="font-size"], input[name="fontSize"], input#font-size').first();

        await test.step('検証: touchstart/touchmove/touchend イベントによるフォントサイズの増減', async () => {
            await fontSizeInput.fill('16px');
            await fontSizeInput.blur();

            // evaluate を介してタッチジェスチャーのイベントシーケンスを直接ディスパッチ
            await fontSizeInput.evaluate((el: HTMLInputElement) => {
                // タッチ開始前に、対象の要素に確実にフォーカスを当てる
                el.focus();

                const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
                Object.defineProperty(touchStart, 'touches', { value: [{ clientX: 100, clientY: 200 }] });
                el.dispatchEvent(touchStart);

                const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
                // clientXを 100 から 150 に増やす（右方向への横スライドによるインクリメント）
                Object.defineProperty(touchMove, 'touches', { value: [{ clientX: 150, clientY: 200 }] });
                window.dispatchEvent(touchMove);

                const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
                window.dispatchEvent(touchEnd);
            });

            const val = parseInt(await fontSizeInput.inputValue());
            expect(val).toBeGreaterThan(16);
        });
    });

    test('属性(style-background)でのドラッグによる不透明度調整の検証', async ({ editorPage, editorHelper, isMobile }) => {
        const previewSelector = 'ons-button';

        await test.step('セットアップ: ページとボタンを追加し、属性パネルを開く', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
        });

        const targetInputPanel = editorHelper.getPropertyInput('style-background');
        await expect(targetInputPanel).toBeVisible();

        // 基準色として赤（#ff0000）を設定
        const bgColorInput = targetInputPanel.locator('input[name*="color" i], input[id*="color" i], input[type="color"]').first();
        await bgColorInput.fill('#ff0000');
        await bgColorInput.blur();

        if (isMobile) {
            await test.step('モバイル検証: 左右スワイプによる色の不透明度・全体の不透明度の調整', async () => {
                const bgAlphaBadge = targetInputPanel.locator('.drag-badge[data-drag-type="bg-alpha"]');
                const elementOpacityBadge = targetInputPanel.locator('.drag-badge[data-drag-type="element-opacity"]');

                // 1. 色の不透明度のスライド（要素の現在位置を動的に計算して左へ50pxスライド）
                await bgAlphaBadge.evaluate((el: HTMLElement) => {
                    const rect = el.getBoundingClientRect();
                    const startX = rect.left + rect.width / 2;
                    const startY = rect.top + rect.height / 2;

                    const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
                    Object.defineProperty(touchStart, 'touches', { value: [{ clientX: startX, clientY: startY }] });
                    el.dispatchEvent(touchStart);

                    const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
                    Object.defineProperty(touchMove, 'touches', { value: [{ clientX: startX - 50, clientY: startY }] });
                    window.dispatchEvent(touchMove);

                    const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
                    window.dispatchEvent(touchEnd);
                });

                await expect(async () => {
                    const text = await bgAlphaBadge.innerText();
                    const val = parseInt(text.replace('%', ''), 10);
                    expect(val).toBeLessThan(100);
                }).toPass({ timeout: 5000 });

                // 2. 全体の不透明度のスライド（要素の現在位置を動的に計算して左へ50pxスライド）
                await elementOpacityBadge.evaluate((el: HTMLElement) => {
                    const rect = el.getBoundingClientRect();
                    const startX = rect.left + rect.width / 2;
                    const startY = rect.top + rect.height / 2;

                    const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
                    Object.defineProperty(touchStart, 'touches', { value: [{ clientX: startX, clientY: startY }] });
                    el.dispatchEvent(touchStart);

                    const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
                    Object.defineProperty(touchMove, 'touches', { value: [{ clientX: startX - 50, clientY: startY }] });
                    window.dispatchEvent(touchMove);

                    const touchEnd = new Event('touchend', { bubbles: true, composed: true });
                    Object.defineProperty(touchEnd, 'changedTouches', { value: [{ clientX: startX - 50, clientY: startY }] });
                    window.dispatchEvent(touchEnd);
                });

                await expect(async () => {
                    const text = await elementOpacityBadge.innerText();
                    const val = parseInt(text.replace('%', ''), 10);
                    expect(val).toBeLessThan(100);
                }).toPass({ timeout: 5000 });
            });
        } else {
            const targetInputPanel = editorHelper.getPropertyInput('style-background');
            const elementOpacityBadge = targetInputPanel.locator('span[data-drag-type="element-opacity"]');
            await expect(elementOpacityBadge).toBeVisible();
        }
    });

    test('属性(style-border)によるボーダー・角丸の編集、クリア、および異常系の検証', async ({ editorPage, editorHelper }) => {
        const previewSelector = 'ons-button';

        await test.step('1. セットアップ: ページとボタンを追加し、属性パネルを開く', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
        });

        await test.step('2. 正常系: ボーダー・角丸（style-border）を設定し、プレビューに反映されること', async () => {
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

        await test.step('3. 異常系: 無効な値（不正な文字列）が入力されてもエディタが破損せず出力されること', async () => {
            const targetInputPanel = editorHelper.getPropertyInput('style-border');
            const radiusInput = targetInputPanel.locator('input[name="borderRadius"], input[name="border-radius"], input#border-radius').first();

            // 不正な文字列を入力
            await radiusInput.fill('invalid_value');
            await radiusInput.blur();

            const previewElement = editorHelper.getPreviewElement(previewSelector);
            await expect(previewElement).toHaveAttribute('style', /border-radius:\s*invalid_value/);
        });

        await test.step('4. 正常系: 入力値を空にしてボーダー設定が部分的にクリアされること', async () => {
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

        await test.step('5. 異常系: 他のスタイルが既に存在する場合、上書き・破壊せずに更新できること', async () => {
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

        await test.step('6. 異常系: セミコロンのない崩れた手動スタイルがあっても、クラッシュせずに解析できること', async () => {
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
            await expect(radiusInput).toHaveValue('');
        });
    });

    test('属性(style-border)でのドラッグによる角丸と太さの調整検証', async ({ editorPage, editorHelper, isMobile }) => {
        await test.step('セットアップ: ページとボタンを追加し、属性パネルを開く', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
        });

        const targetInputPanel = editorHelper.getPropertyInput('style-border');
        await expect(targetInputPanel).toBeVisible();

        const radiusInput = targetInputPanel.locator('input[data-property="borderRadius"]');
        const widthInput = targetInputPanel.locator('input[data-property="borderWidth"]');

        if (isMobile) {
            await test.step('モバイル検証: 左右スワイプによる角丸・太さの増減', async () => {
                await radiusInput.fill('10px');
                await radiusInput.blur();

                // 安定化待機をしてからクリックしてフォーカス
                await editorPage.waitForTimeout(300);
                await radiusInput.click({ force: true });
                await editorPage.waitForTimeout(200);

                // 右方向へ50pxスライドさせて値を増やす
                await radiusInput.evaluate((el: HTMLInputElement) => {
                    el.focus(); // 内部でも重ねてフォーカスを確定

                    const rect = el.getBoundingClientRect();
                    const startX = rect.left + rect.width / 2;
                    const startY = rect.top + rect.height / 2;

                    const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
                    Object.defineProperty(touchStart, 'touches', { value: [{ clientX: startX, clientY: startY }] });
                    el.dispatchEvent(touchStart);

                    const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
                    Object.defineProperty(touchMove, 'touches', { value: [{ clientX: startX + 50, clientY: startY }] });
                    window.dispatchEvent(touchMove);

                    const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
                    window.dispatchEvent(touchEnd);
                });

                const rVal = parseInt(await radiusInput.inputValue(), 10);
                expect(rVal).toBeGreaterThan(10);

                // 太さも同様に右方向へスライドして増やす
                await widthInput.fill('2px');
                await widthInput.blur();

                // DOM状態とスクロールが落ち着くまで 300ms 待機し、確実にフォーカスを確定
                await editorPage.waitForTimeout(300);
                await widthInput.click({ force: true });
                await editorPage.waitForTimeout(200);

                await widthInput.evaluate((el: HTMLInputElement) => {
                    el.focus(); // 内部でも重ねてフォーカスを確定

                    const rect = el.getBoundingClientRect();
                    const startX = rect.left + rect.width / 2;
                    const startY = rect.top + rect.height / 2;

                    const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
                    Object.defineProperty(touchStart, 'touches', { value: [{ clientX: startX, clientY: startY }] });
                    el.dispatchEvent(touchStart);

                    const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
                    Object.defineProperty(touchMove, 'touches', { value: [{ clientX: startX + 50, clientY: startY }] });
                    window.dispatchEvent(touchMove);

                    const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
                    window.dispatchEvent(touchEnd);
                });

                const wVal = parseInt(await widthInput.inputValue(), 10);
                expect(wVal).toBeGreaterThan(2);
            });
        } else {
            await test.step('PC検証: マウス上下ドラッグによる角丸・太さの増減', async () => {
                await radiusInput.fill('10px');
                await radiusInput.blur();

                await dragInput(editorPage, radiusInput, 0, -30);
                const rVal = parseInt(await radiusInput.inputValue(), 10);
                expect(rVal).toBeGreaterThan(10);

                await widthInput.fill('2px');
                await widthInput.blur();

                await dragInput(editorPage, widthInput, 0, -30);
                const wVal = parseInt(await widthInput.inputValue(), 10);
                expect(wVal).toBeGreaterThan(2);
            });
        }
    });

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

            const widthInput = targetInputPanel.locator('input').nth(0);
            const heightInput = targetInputPanel.locator('input').nth(1);

            await expect(async () => {
                await expect(widthInput).toBeVisible();
                await expect(widthInput).toBeEditable();
            }).toPass({ timeout: 10000, intervals: [500] });

            // 背景色を設定
            await expect(widthInput).toBeVisible();
            await expect(widthInput).toBeEditable();
            await widthInput.fill('100px');
            await widthInput.blur();
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'width', value: '100px' });

            // 背景画像を設定 (生パスのみを指定)
            await expect(heightInput).toBeVisible();
            await expect(heightInput).toBeEditable();
            await heightInput.fill('50px');
            await heightInput.blur();
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'height', value: '50px' });
        });

        await test.step('検証: 入力値を空にして背景設定が部分的にクリアされること', async () => {
            const targetInputPanel = editorHelper.getPropertyInput('style-sizing');
            const widthInput = targetInputPanel.locator('input').nth(0);

            // 背景画像を空にする
            await widthInput.fill('');
            await widthInput.blur();

            // プレビューのstyleからwidthプロパティが消えていることを確認
            const previewElement = editorHelper.getPreviewElement(previewSelector);
            await editorPage.waitForTimeout(300);
            const styleAttr = await previewElement.getAttribute('style') || '';
            expect(styleAttr).not.toContain('width:');

            // 他の設定（高さ）は残っていること
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'height', value: '50px' });
        });
    });

    test('属性(style-sizing)でのドラッグによる幅と高さの調整検証', async ({ editorPage, editorHelper, isMobile }) => {
        await test.step('セットアップ: ページとボタンを追加し、属性パネルを開く', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
        });

        const targetInputPanel = editorHelper.getPropertyInput('style-sizing');
        await expect(targetInputPanel).toBeVisible();

        const widthInput = targetInputPanel.locator('input[data-property="width"]');
        const heightInput = targetInputPanel.locator('input[data-property="height"]');

        if (isMobile) {
            await test.step('モバイル検証: 左右スワイプによる幅と高さの調整', async () => {
                await widthInput.fill('100px');
                await widthInput.blur();

                // 1. スクロールとDOMを落ち着かせてから確実にフォーカス
                await editorPage.waitForTimeout(300);
                await widthInput.click({ force: true });
                await editorPage.waitForTimeout(200);

                // 右方向へ50pxスライド
                await widthInput.evaluate((el: HTMLInputElement) => {
                    el.focus(); // 重ねてフォーカスを確定

                    const rect = el.getBoundingClientRect();
                    const startX = rect.left + rect.width / 2;
                    const startY = rect.top + rect.height / 2;

                    const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
                    Object.defineProperty(touchStart, 'touches', { value: [{ clientX: startX, clientY: startY }] });
                    el.dispatchEvent(touchStart);

                    const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
                    Object.defineProperty(touchMove, 'touches', { value: [{ clientX: startX + 50, clientY: startY }] });
                    window.dispatchEvent(touchMove);

                    const touchEnd = new Event('touchend', { bubbles: true, composed: true });
                    Object.defineProperty(touchEnd, 'changedTouches', { value: [{ clientX: startX + 50, clientY: startY }] });
                    window.dispatchEvent(touchEnd);
                });

                const wVal = parseInt(await widthInput.inputValue(), 10);
                expect(wVal).toBeGreaterThan(100);

                await heightInput.fill('50px');
                await heightInput.blur();

                // 2. 幅操作の描画更新が落ち着くまで 300ms 待機し、確実にフォーカス
                await editorPage.waitForTimeout(300);
                await heightInput.click({ force: true });
                await editorPage.waitForTimeout(200);

                // 高さを右スライド
                await heightInput.evaluate((el: HTMLInputElement) => {
                    el.focus(); // 重ねてフォーカスを確定

                    const rect = el.getBoundingClientRect();
                    const startX = rect.left + rect.width / 2;
                    const startY = rect.top + rect.height / 2;

                    const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
                    Object.defineProperty(touchStart, 'touches', { value: [{ clientX: startX, clientY: startY }] });
                    el.dispatchEvent(touchStart);

                    const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
                    Object.defineProperty(touchMove, 'touches', { value: [{ clientX: startX + 50, clientY: startY }] });
                    window.dispatchEvent(touchMove);

                    const touchEnd = new Event('touchend', { bubbles: true, composed: true });
                    Object.defineProperty(touchEnd, 'changedTouches', { value: [{ clientX: startX + 50, clientY: startY }] });
                    window.dispatchEvent(touchEnd);
                });

                const hVal = parseInt(await heightInput.inputValue(), 10);
                expect(hVal).toBeGreaterThan(50);
            });
        } else {
            await test.step('PC検証: マウス上下ドラッグによる幅・高さの調整', async () => {
                await widthInput.fill('100px');
                await widthInput.blur();

                await dragInput(editorPage, widthInput, 0, -30);
                const wVal = parseInt(await widthInput.inputValue(), 10);
                expect(wVal).toBeGreaterThan(100);

                await heightInput.fill('100px');
                await heightInput.blur();

                await dragInput(editorPage, heightInput, 0, -30);
                const hVal = parseInt(await heightInput.inputValue(), 10);
                expect(hVal).toBeGreaterThan(100);
            });
        }
    });

    test('選択枠（ハイライト）の表示・非表示の切り替え（showHighlight）機能を検証する', async ({ editorPage, editorHelper }) => {
        await test.step('1. セットアップ: ページとボタンを追加し、ボタンを選択状態にする', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
        });

        await test.step('2. プレビューの iframe 内に選択枠（.layout-selected）が表示されていることを検証', async () => {
            const previewFrame = editorHelper.getPreviewFrame();
            const selectedBorder = previewFrame.locator('.layout-selected');
            await expect(selectedBorder).toBeVisible({ timeout: 5000 });
        });

        await test.step('3. 目ボタンをクリックして選択枠を非表示にする', async () => {
            // モバイル環境での要素の重なりを防ぐため、移動ハンドルを閉じる
            await editorHelper.closeMoveingHandle();

            const platformSwitcher = editorPage.locator('platform-switcher');
            const toggleHighlightBtn = platformSwitcher.locator('button[title*="選択枠を非表示にする"]');
            await expect(toggleHighlightBtn).toBeVisible();
            // 重なりによるインターセプトを防ぐため force: true を指定
            await toggleHighlightBtn.click({ force: true });
        });

        await test.step('4. プレビュー内の選択枠（.layout-selected）が消えていることを検証', async () => {
            const previewFrame = editorHelper.getPreviewFrame();
            const selectedBorder = previewFrame.locator('.layout-selected');
            await expect(selectedBorder).toBeHidden({ timeout: 5000 });
        });

        await test.step('5. 再び目ボタンをクリックして選択枠を再表示にする', async () => {
            // 移動ハンドルを念のため閉じる
            await editorHelper.closeMoveingHandle();

            const platformSwitcher = editorPage.locator('platform-switcher');
            const toggleHighlightBtn = platformSwitcher.locator('button[title*="選択枠を表示する"]');
            await expect(toggleHighlightBtn).toBeVisible();
            await toggleHighlightBtn.click({ force: true });
        });

        await test.step('6. 選択枠が再表示されることを検証', async () => {
            const previewFrame = editorHelper.getPreviewFrame();
            const selectedBorder = previewFrame.locator('.layout-selected');
            await expect(selectedBorder).toBeVisible({ timeout: 5000 });
        });
    });
});