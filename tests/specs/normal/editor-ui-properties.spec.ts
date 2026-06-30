import { test as base, expect, Page, Locator, CDPSession, Dialog } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor, addVersion } from '../../tools/dashboard-helpers';
import { EditorHelper, normalizeWhitespace } from '../../tools/editor-helpers';
import { STORAGE_STATE } from '../../constants';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

let appName: string;
let appKey: string;

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
    appName = `ui-prop-${uniqueId}`.slice(0, 30);
    appKey = `prop-key-${uniqueId}`.slice(0, 30);

    const context = await browser.newContext({ storageState: STORAGE_STATE });
    const page = await context.newPage();

    await gotoDashboard(page);
    await createApp(page, appName, appKey);

    await context.close();
});

// すべてのテストが終了した後に、アプリを削除する
test.afterAll(async ({ browser }) => {
    if (appKey) {
        const context = await browser.newContext({ storageState: STORAGE_STATE });
        const page = await context.newPage();

        await gotoDashboard(page);
        await deleteApp(page, appKey);

        await context.close();
    }
});

/**
 * 共有ヘルパー関数: 指定した入力欄をマウスでドラッグする
 */
async function dragInput(editorPage: Page, inputLocator: Locator, deltaX: number, deltaY: number, shiftKey: boolean = false) {
    const box = await inputLocator.boundingBox();
    if (!box) throw new Error('Input bounding box not found');

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    // WebKit環境のShadow DOMにおける誤検知（インターセプト判定）を回避するため、force: true を適用します
    await inputLocator.click({ force: true });
    await editorPage.waitForTimeout(100);

    await editorPage.mouse.move(startX, startY);

    if (shiftKey) await editorPage.keyboard.down('Shift');
    await editorPage.mouse.down();

    let finalDeltaX = deltaX;
    let finalDeltaY = deltaY;
    if (deltaX === 0 && deltaY !== 0) {
        finalDeltaX = -deltaY;
        finalDeltaY = 0;
    }

    await editorPage.mouse.move(startX + finalDeltaX, startY + finalDeltaY, { steps: 10 });
    await editorPage.mouse.up();
    if (shiftKey) await editorPage.keyboard.up('Shift');
}

const logTime = (msg: string) => {
    const now = new Date();
    console.log(`[TourTest:Time] ${now.toISOString()} - ${msg}`);
};

// =========================================================================
// Merged from: tests/specs/normal/editor-navigation.spec.ts
// =========================================================================

test.describe('エディタ内機能のテスト', () => {

    test('コンポーネントのプロパティを編集できる', async ({ editorPage, editorHelper }) => {
        let buttonNode: Locator;
        let pageNode: Locator;
        await test.step('セットアップ: ページとボタンをエディタに追加', async () => {
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

            await editorHelper.openMoveingHandle('left');
            const contentNode = domTree.locator('div[data-node-explain="コンテンツ"]');
            await contentNode.getByText('コンテンツ', { exact: true }).click();

            await editorHelper.openMoveingHandle('right');
            await propertyContainer.getByText('属性', { exact: true }).click();
            await expect(propertyIdInput).toHaveValue('div2');

            await editorHelper.openMoveingHandle('left');
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
            await propertyContainer.getByText('スタイル', { exact: true }).click();

            const styleEditor = propertyContainer.locator('#style-container > .monaco-editor');
            await expect(styleEditor).toBeVisible();

            await styleEditor.locator('div:nth-child(2) > span > .mtk1').click();
            await editorPage.keyboard.press('Control+A');
            await editorPage.keyboard.press('Backspace');

            const styleValue = 'element.style {\n    background : red;\n}';
            await editorHelper.setMonacoValue(styleEditor, styleValue);

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
            await expect(editAttrButton).toBeEnabled();
            await editAttrButton.click();

            const addElementButton = propertyContainer.getByRole('button', { name: '要素に追加' });
            await expect(addElementButton).toBeVisible();
            await expect(addElementButton).toBeEnabled();
            await addElementButton.click();

            const attrNameInput = propertyContainer.getByRole('combobox', { name: '属性名:' });
            await expect(attrNameInput).toBeVisible();
            await expect(attrNameInput).toBeEditable();
            await attrNameInput.fill(attrName);

            const addButton = propertyContainer.getByRole('button', { name: '追加' });
            await expect(addButton).toBeVisible();
            await expect(addButton).toBeEnabled();
            await addButton.click();

            const targetInput = propertyContainer.locator(`input[data-attribute-type="${attrName}"]`);
            await expect(targetInput).toBeVisible();
            await expect(targetInput).toBeEditable();

            await targetInput.fill(attrValue);
            await targetInput.press('Enter');
            await expect(previewButton).toHaveAttribute(attrName, attrValue);

            await targetInput.fill('');
            await targetInput.press('Enter');
            await expect(targetInput).toHaveValue('');
            await expect(previewButton).toHaveAttribute(attrName, '');

            await expect(editorPage.locator('#attributeList')).toBeHidden();

            const clearButton = targetInput.locator('+ .clear-button');
            await expect(clearButton).toBeEnabled();
            await clearButton.click();
            await expect(previewButton).not.toHaveAttribute(attrName);
            await expect(targetInput).toBeHidden();
        });

        await test.step('検証: 属性定義自体を削除できること', async () => {
            const propertyContainer = editorPage.locator('property-container');

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

            await expect(editAttrButton).toBeVisible();
            await editAttrButton.click();

            const attrList = propertyContainer.locator('#attributeList');
            await expect(attrList).toBeVisible();

            const deleteTargetContainer = attrList.locator('div', { hasText: attrName }).locator('..');
            const deleteIcon = deleteTargetContainer.locator('> .edit-icon > .fa-solid');

            await expect(deleteIcon).toBeVisible();

            editorPage.once('dialog', dialog => dialog.accept());
            await deleteIcon.click();

            const finalDeleteButton = editorPage.getByRole('button', { name: '削除' });
            await expect(finalDeleteButton).toBeVisible();
            await expect(finalDeleteButton).toBeEnabled();
            await finalDeleteButton.click();

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

            await targetInput.fill('');
            await targetInput.press('Enter');
            await expect(targetInput).toHaveValue('');
            await expect(previewButton).toHaveAttribute(attrName, '');

            await editorPage.locator('property-container').click();
            await expect(editorPage.locator('#attributeList')).toBeHidden();

            const clearButton = targetInput.locator('+ .clear-button');
            await expect(clearButton).toBeEnabled();
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

            const editAttrButton = propertyContainer.getByTitle('属性を編集');
            await expect(editAttrButton).toBeVisible();
            await editAttrButton.click();

            const addElementButton = propertyContainer.getByRole('button', { name: '要素に追加' });
            await expect(addElementButton).toBeVisible();
            await expect(addElementButton).toBeEnabled();
            await addElementButton.click();

            const attrInput = propertyContainer.getByRole('combobox', { name: '属性名:' });
            await expect(attrInput).toBeVisible();
            await expect(attrInput).toBeEditable();
            await attrInput.fill(attrName);

            const addButton = propertyContainer.getByRole('button', { name: '追加' });
            await expect(addButton).toBeVisible();
            await expect(addButton).toBeEnabled();
            await addButton.click();

            const targetInput = propertyContainer.locator(`input[data-attribute-type="${attrName}"]`);
            await expect(targetInput).toBeVisible();

            const backgroundColor = await targetInput.evaluate(el => {
                const root = el.getRootNode();
                if (!(root instanceof ShadowRoot)) return null;
                const hostElement = root.host;
                const editorRow = hostElement.closest('.editor-row');
                return editorRow ? window.getComputedStyle(editorRow).backgroundColor : null;
            });

            expect(backgroundColor).toBe('rgba(0, 112, 255, 0.11)');
        });

        await test.step('検証: 「タグに」同名属性を追加するとハイライトが消える', async ({ }) => {
            const propertyContainer = editorPage.locator('property-container');
            const targetInput = propertyContainer.locator(`input[data-attribute-type="${attrName}"]`);

            await expect(targetInput).toBeVisible();

            const editAttrButton = propertyContainer.getByTitle('属性を編集');
            await expect(editAttrButton).toBeVisible();
            await editAttrButton.click();

            const addTagButton = propertyContainer.getByRole('button', { name: 'タグに追加' });
            await expect(addTagButton).toBeVisible();
            await expect(addTagButton).toBeEnabled();
            await addTagButton.click();

            const nameInput = propertyContainer.getByRole('combobox', { name: '属性名:' });
            await expect(nameInput).toBeVisible();
            await expect(nameInput).toBeEditable();
            await nameInput.fill(attrName);

            const templateInput = propertyContainer.getByRole('combobox', { name: 'テンプレート:' });
            await expect(templateInput).toBeVisible();
            await expect(templateInput).toBeEditable();
            await templateInput.fill('input[text]');

            const addButton = propertyContainer.getByRole('button', { name: '追加' });
            await expect(addButton).toBeVisible();
            await expect(addButton).toBeEnabled();
            await addButton.click();

            await expect(targetInput).toBeVisible();

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
        await editorHelper.addPage();
        await expect(editorPage.locator('#dom-tree > .node[data-node-type="page"]')).toHaveCount(1);
        await editorHelper.expectPageInTemplateList(newPageExplain);
    });

    test('ツールボックスからコンポーネントをD&Dできる', async ({ editorPage, editorHelper }) => {
        await editorHelper.addPage();
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
            await editorHelper.getPropertyContainer().getByTitle('属性を編集').click();
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
            await editorPage.getByText('selectC').click();
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
            await popup.getByText('selectC').click();
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

            await expect(editorPage.locator('#attributeList')).toBeHidden();

            const clearButton = targetInput.locator('+ .clear-button');
            await expect(clearButton).toBeEnabled();
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

            await picker.locator('.picker-button').click();
            const modal = picker.locator('.modal-overlay');
            await expect(modal).toHaveClass(/active/);

            const searchInput = modal.locator('.modal-search input');
            await expect(searchInput).toBeVisible();
            await searchInput.fill('star');

            const starLabel = modal.locator('.icon-name', { hasText: /^star$/ }).first();
            await expect(starLabel).toBeVisible({ timeout: 15000 });

            const starItem = starLabel.locator('..');
            await starItem.click({ force: true });

            await expect(modal).not.toHaveClass(/active/);

            const targetInput = picker.locator('input[data-attribute-type="icon"]');
            await expect(targetInput).toHaveValue('fa-star');
            await editorHelper.expectPreviewElementAttribute({ selector: previewSelector, attributeName: attrName, value: 'fa-star' });
        });

        await test.step('検証: クリアボタンによる属性の削除', async () => {
            const propertyContainer = editorHelper.getPropertyContainer();
            const picker = propertyContainer.locator('attribute-icon-picker[data-attribute-type="icon"]');
            const targetInput = picker.locator('input[data-attribute-type="icon"]');

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
            await editorHelper.addPage();
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

            await targetInput.locator('select[name="align-content"]').selectOption({ value: 'center' });
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'align-content', value: 'center' });

            await targetInput.locator('select[name="justify-content"]').selectOption({ value: 'center' });
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'justify-content', value: 'center' });

            await targetInput.locator('select[name="align-items"]').selectOption({ value: 'baseline' });
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

            await editorHelper.openMoveingHandle('right');
            const targetInputPanel = editorHelper.getPropertyInput('style-flex-item');
            await expect(targetInputPanel).toBeVisible();

            const flexGrowInput = targetInputPanel.locator('input[id="flex-grow"]');
            await expect(flexGrowInput).toBeVisible();
            await expect(flexGrowInput).toBeEditable();
            await flexGrowInput.fill('1');
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'flex-grow', value: '1' });

            const flexShrinkInput = targetInputPanel.locator('input[id="flex-shrink"]');
            await expect(flexShrinkInput).toBeVisible();
            await expect(flexShrinkInput).toBeEditable();
            await flexShrinkInput.fill('2');
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'flex-shrink', value: '2' });

            const flexBasisInput = targetInputPanel.locator('input[id="flex-basis"]');
            await expect(flexBasisInput).toBeVisible();
            await expect(flexBasisInput).toBeEditable();
            await flexBasisInput.fill('100%');
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'flex-basis', value: '100%' });

            const orderInput = targetInputPanel.locator('input[id="order"]');
            await expect(orderInput).toBeVisible();
            await expect(orderInput).toBeEditable();
            await orderInput.fill('10');
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'order', value: '10' });

            const alignSelfSelect = targetInputPanel.locator('select[name="align-self"]');
            await expect(alignSelfSelect).toBeVisible();

            await alignSelfSelect.selectOption({ value: 'center' });
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'align-self', value: 'center' });
        });

        await test.step('削除', async () => {
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
            const targetInputPanel = editorHelper.getPropertyInput('style-spacing');
            await expect(targetInputPanel).toBeVisible();

            const marginTopInput = targetInputPanel.locator('.margin-box > .top');
            await expect(marginTopInput).toBeVisible();
            await expect(marginTopInput).toBeEditable();
            await marginTopInput.fill('20px');
            await marginTopInput.blur();

            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'margin-top', value: '20px' });

            const paddingLeftInput = targetInputPanel.locator('.padding-box > .left');
            await expect(paddingLeftInput).toBeVisible();
            await expect(paddingLeftInput).toBeEditable();
            await paddingLeftInput.fill('15px');
            await paddingLeftInput.blur();

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

            await editorHelper.expectPreviewElementAttribute({ selector: previewSelector, attributeName: 'style', value: null });
        });
    });

    test('属性(style-spacing)が表示され、ユーザーが並べ替えると位置が保持される', async ({ editorPage, editorHelper, isMobile }) => {
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

            const spacingItem = attrList.locator('div.attribute-item[data-attribute-key="style-spacing"]').first();
            await expect(spacingItem).toBeVisible();

            await spacingItem.scrollIntoViewIfNeeded();
            await editorPage.waitForTimeout(500);

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

                await editorPage.mouse.move(startX, startY);
                await editorPage.mouse.down();
                await editorPage.waitForTimeout(600);

                await editorPage.mouse.move(endX, endY, { steps: 20 });
                await editorPage.waitForTimeout(200);
                await editorPage.mouse.up();
            }

            await editorPage.mouse.move(0, 0);
            await editorPage.mouse.up().catch(() => { });
            await editorPage.keyboard.press('Escape');
            await editorPage.waitForTimeout(500);

            const attrListBox = await attrList.boundingBox();
            const propBox = await propertyContainer.boundingBox();

            if (attrListBox && propBox) {
                const clickX = propBox.x + 30;
                let clickY = attrListBox.y + attrListBox.height + 50;
                if (clickY >= propBox.y + propBox.height) {
                    clickY = propBox.y + propBox.height - 30;
                }
                await editorPage.mouse.click(clickX, clickY);
            } else {
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
            const newIndex = attributeTypes.indexOf('style-spacing');
            expect(newIndex).not.toBe(originalIndex);
        });
    });

    test('トップテンプレートリストをキーボード（上下キー）で移動すると即座にテンプレートが切り替わる', async ({ editorPage, editorHelper }) => {
        let page1Id: string;
        let page2Id: string;

        await test.step('セットアップ: ページを2つ追加', async () => {
            await editorHelper.openMoveingHandle('left');

            const page1Node = await editorHelper.addPage();
            page1Id = await page1Node.getAttribute('data-node-id') as string;

            const page2Node = await editorHelper.addPage();
            page2Id = await page2Node.getAttribute('data-node-id') as string;
        });

        await test.step('検証: 上下キーによる即時切り替え', async () => {
            const topContainer = editorPage.locator('.top-container');
            const selectBox = topContainer.locator('.select');

            await selectBox.click();

            const topTemplateListContainer = editorPage.locator('#top-template-list');
            await expect(topTemplateListContainer).toBeVisible({ timeout: 5000 });

            const items = topTemplateListContainer.locator('.top-template-item');
            await expect(items).toHaveCount(3);

            const appId = await items.nth(0).getAttribute('data-template-id');
            expect(appId).not.toBeNull();

            await editorPage.keyboard.press('ArrowDown');

            const selectedItem1 = topTemplateListContainer.locator('.selected-template');
            await expect(selectedItem1).toBeVisible();
            expect(await selectedItem1.getAttribute('data-template-id')).toBe(appId);

            await editorPage.keyboard.press('ArrowUp');
            const selectedItem2 = topTemplateListContainer.locator('.selected-template');
            await expect(selectedItem2).toBeVisible();
            expect(await selectedItem2.getAttribute('data-template-id')).toBe(page2Id);

            await editorPage.keyboard.press('ArrowUp');
            const selectedItem3 = topTemplateListContainer.locator('.selected-template');
            await expect(selectedItem3).toBeVisible();
            expect(await selectedItem3.getAttribute('data-template-id')).toBe(page1Id);

            await editorPage.keyboard.press('Enter');

            await expect(topTemplateListContainer).toBeHidden();
        });

        await test.step('検証: Escapeによるキャンセル（閉じる動作）', async () => {
            const topContainer = editorPage.locator('.top-container');
            const selectBox = topContainer.locator('.select');

            await selectBox.click();

            const topTemplateListContainer = editorPage.locator('#top-template-list');
            await expect(topTemplateListContainer).toBeVisible({ timeout: 5000 });

            await editorPage.keyboard.press('Escape');

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

            const fontSizeInput = targetInputPanel.locator('input[name="font-size"], input[name="fontSize"], input#font-size').first();
            await expect(fontSizeInput).toBeVisible();
            await expect(fontSizeInput).toBeEditable();
            await fontSizeInput.fill('24px');
            await fontSizeInput.blur();
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'font-size', value: '24px' });

            const colorInput = targetInputPanel.locator('input[type="color"], attribute-color input, input[name="color"], input#color, .color input').first();
            await expect(colorInput).toBeVisible();
            await expect(colorInput).toBeEditable();
            await colorInput.fill('#ff0000');
            await colorInput.blur();
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'color', value: 'rgb(255, 0, 0)' });
        });

        await test.step('検証: 入力値を空にして文字装飾設定がクリアされること', async ({ }) => {
            const targetInputPanel = editorHelper.getPropertyInput('style-typography');
            const fontSizeInput = targetInputPanel.locator('input[name="font-size"], input[name="fontSize"], input#font-size').first();

            await fontSizeInput.fill('');
            await fontSizeInput.blur();

            const previewElement = editorHelper.getPreviewElement(previewSelector);

            await editorPage.waitForTimeout(300);
            const styleAttr = await previewElement.getAttribute('style') || '';

            expect(styleAttr).not.toContain('font-size:');
            expect(styleAttr).not.toContain('24px');
        });
    });

    test('テキスト非対応要素(img)では文字装飾(style-typography)が表示されないこと', async ({ editorPage, editorHelper }) => {
        await test.step('セットアップ: ページを追加し、imgタグを配置して選択する', async () => {
            await editorHelper.addPage();
            const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
            const imgNode = await editorHelper.addComponentAsHtmlTag('img', contentAreaSelector);
            await editorHelper.selectNodeInDomTree(imgNode);
            await editorHelper.openMoveingHandle('right');
        });

        await test.step('検証: プロパティパネルに文字装飾(style-typography)が表示されないこと', async () => {
            const targetInputPanel = editorHelper.getPropertyInput('style-typography');
            await expect(targetInputPanel).toBeHidden();
        });
    });

    test('属性(style-sizing)における干渉防止と異常系の解析検証', async ({ editorPage, editorHelper }) => {
        const previewSelector = 'ons-button';

        await test.step('セットアップ: ページとボタンを追加する', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
        });

        await test.step('異常系1: max-widthが記述されていてもwidthが引きずられないことの干渉検証', async ({ }) => {
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, 'スタイル');

            const styleEditor = propertyContainer.locator('#style-container > .monaco-editor');
            await expect(styleEditor).toBeVisible();

            const targetStyle = 'element.style {\n    max-width: 500px;\n    max-height: 400px;\n}';
            await editorHelper.setMonacoValue(styleEditor, targetStyle);

            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'max-width', value: '500px' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'max-height', value: '400px' });

            await editorHelper.switchTabInContainer(propertyContainer, '属性');
            const targetInputPanel = editorHelper.getPropertyInput('style-sizing');
            await expect(targetInputPanel).toBeVisible();

            const widthInput = targetInputPanel.locator('input').nth(0);
            const heightInput = targetInputPanel.locator('input').nth(1);

            await editorPage.waitForTimeout(1000);

            await expect(widthInput).toHaveValue('');
            await expect(heightInput).toHaveValue('');
        });

        await test.step('異常系2: セミコロンが欠落した手動CSSが存在してもシステムがクラッシュしないことの検証', async ({ }) => {
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, 'スタイル');

            const styleEditor = propertyContainer.locator('#style-container > .monaco-editor');
            await expect(styleEditor).toBeVisible();

            const brokenStyle = 'element.style {\n    width: 300px\n}';
            await editorHelper.setMonacoValue(styleEditor, brokenStyle);

            await editorHelper.switchTabInContainer(propertyContainer, '属性');
            const targetInputPanel = editorHelper.getPropertyInput('style-sizing');
            await expect(targetInputPanel).toBeVisible();

            const widthInput = targetInputPanel.locator('input').nth(0);
            await expect(widthInput).toBeVisible();
        });

        await test.step('異常系3: 無効なCSS値が入力されてもエディタが破損せずそのまま適用されることの検証', async () => {
            const targetInputPanel = editorHelper.getPropertyInput('style-sizing');
            const widthInput = targetInputPanel.locator('input').nth(0);

            await widthInput.fill('invalid_value_test');
            await widthInput.blur();

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

            await targetInputPanel.evaluate((el) => {
                el.dispatchEvent(new CustomEvent('change', {
                    detail: {
                        boxShadow: '3px 3px 6px rgb(0, 0, 0)',
                        textShadow: '1px 1px 2px rgb(255, 0, 0)'
                    }
                }));
            });

            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'box-shadow', value: 'rgb(0, 0, 0) 3px 3px 6px 0px' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'text-shadow', value: 'rgb(255, 0, 0) 1px 1px 2px' });
        });

        await test.step('3. 正常系: 既存のスタイル設定と競合せず、追記・維持されること', async ({ }) => {
            const propertyContainer = editorPage.locator('property-container');

            await editorHelper.switchTabInContainer(propertyContainer, 'スタイル');
            const styleEditor = propertyContainer.locator('#style-container > .monaco-editor');
            await expect(styleEditor).toBeVisible();

            const presetStyle = 'element.style {\n    color: rgb(0, 128, 0);\n    padding: 15px;\n}';
            await editorHelper.setMonacoValue(styleEditor, presetStyle);

            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'color', value: 'rgb(0, 128, 0)' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'padding', value: '15px' });

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

            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'color', value: 'rgb(0, 128, 0)' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'padding', value: '15px' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'box-shadow', value: 'rgb(0, 0, 255) 4px 4px 8px 0px' });
        });

        await test.step('4. 正常系: 値を空に更新した際、対象のシャドウスタイルのみが削除され、他は残ること', async ({ }) => {
            const targetInputPanel = editorHelper.getPropertyInput('style-shadow');
            await expect(targetInputPanel).toBeVisible();

            await targetInputPanel.evaluate((el) => {
                el.dispatchEvent(new CustomEvent('change', {
                    detail: {
                        boxShadow: '',
                        textShadow: ''
                    }
                }));
            });

            const previewElement = editorHelper.getPreviewElement(previewSelector);
            await editorPage.waitForTimeout(500);
            const styleAttr = await previewElement.getAttribute('style') || '';
            expect(styleAttr).not.toContain('box-shadow:');
            expect(styleAttr).not.toContain('text-shadow:');

            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'color', value: 'rgb(0, 128, 0)' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'padding', value: '15px' });
        });

        await test.step('5. 異常系: セミコロンのない崩れた手動スタイルが存在しても、クラッシュせずに解析・描画されること', async ({ }) => {
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, 'スタイル');

            const styleEditor = propertyContainer.locator('#style-container > .monaco-editor');
            await expect(styleEditor).toBeVisible();

            const brokenStyle = 'element.style {\n    box-shadow: 2px 2px 2px black\n}';
            await editorHelper.setMonacoValue(styleEditor, brokenStyle);

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

            const accordionHeader = targetInputPanel.locator('.accordion-header').first();
            await accordionHeader.click();
            await expect(targetInputPanel.locator('.accordion-content').first()).toHaveClass(/expanded/);

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

            await expect(dragBadge).toHaveText(/50%/, { timeout: 5000 });
        });

        await test.step('4. マウスの上方向ドラッグで不透明度が増加すること', async ({ }) => {
            await dragBadge.evaluate((badgeEl) => {
                const rect = badgeEl.getBoundingClientRect();
                const startX = rect.left + rect.width / 2;
                const startY = rect.top + rect.height / 2;

                badgeEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: startX, clientY: startY }));
                window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: startX + 60, clientY: startY }));
                window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: startX + 60, clientY: startY }));
            });

            await expect(async () => {
                const text = await dragBadge.innerText();
                const val = parseInt(text.replace('%', ''), 10);

                expect(val).toBeGreaterThan(50);
                expect(val).toBeLessThan(100);
            }).toPass({ timeout: 5000, intervals: [100, 200] });

            await expect(dragBadge).not.toHaveClass(/dragging/);

            const styleAttr = await editorHelper.getPreviewElement(previewSelector).getAttribute('style') || '';
            expect(styleAttr).toMatch(/box-shadow:.*rgba?\(0,\s*0,\s*0,\s*0\.[6-9]\d*\)/);

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
            await expect(targetInputPanel).toBeVisible();

            const bgColorInput = targetInputPanel.locator('input[name*="color" i], input[id*="color" i], input[type="color"]').first();
            const bgImageInput = targetInputPanel.locator('input[name*="image" i], input[id*="image" i], input[placeholder*="image" i], input[placeholder*="画像" i], input[name="backgroundImage"]').first();
            const opacityInput = targetInputPanel.locator('input[name*="opacity" i], input[id*="opacity" i], input[type="range"], input[type="number"], input[placeholder*="opacity" i], input').last();

            await expect(bgColorInput).toBeVisible();
            await expect(bgColorInput).toBeEditable();
            await bgColorInput.fill('#00ff00');
            await bgColorInput.blur();
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'background-color', value: 'rgb(0, 255, 0)' });

            await expect(bgImageInput).toBeVisible();
            await expect(bgImageInput).toBeEditable();
            await bgImageInput.fill('images/icon-192x192.webp');
            await bgImageInput.blur();
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'background-image', value: /url\(.*images\/icon-192x192\.webp.*\)/ });

            await expect(opacityInput).toBeVisible();
            await expect(opacityInput).toBeEditable();
            await opacityInput.fill('0.5');
            await opacityInput.blur();
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'opacity', value: '0.5' });
        });

        await test.step('正常系: 入力値を空にして背景設定が部分的にクリアされること', async ({ }) => {
            const targetInputPanel = editorHelper.getPropertyInput('style-background');
            const bgImageInput = targetInputPanel.locator('input[name*="image" i], input[id*="image" i], input[placeholder*="image" i], input[placeholder*="画像" i], input[name="backgroundImage"]').first();

            await bgImageInput.fill('');
            await bgImageInput.blur();

            const previewElement = editorHelper.getPreviewElement(previewSelector);
            await editorPage.waitForTimeout(300);
            const styleAttr = await previewElement.getAttribute('style') || '';
            expect(styleAttr).not.toContain('background-image:');

            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'background-color', value: 'rgb(0, 255, 0)' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'opacity', value: '0.5' });
        });

        await test.step('異常系: 他のスタイルが既に存在する場合、上書き・破壊せずに更新できること', async ({ }) => {
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, 'スタイル');

            const styleEditor = propertyContainer.locator('#style-container > .monaco-editor');
            await expect(styleEditor).toBeVisible();

            const presetStyle = 'element.style {\n    color: rgb(255, 255, 255);\n    padding: 20px;\n}';
            await editorHelper.setMonacoValue(styleEditor, presetStyle);

            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'color', value: 'rgb(255, 255, 255)' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'padding', value: '20px' });

            await editorHelper.switchTabInContainer(propertyContainer, '属性');
            const targetInputPanel = editorHelper.getPropertyInput('style-background');
            const bgImageInput = targetInputPanel.locator('input[name*="image" i], input[id*="image" i], input[placeholder*="image" i], input[placeholder*="画像" i], input[name="backgroundImage"]').first();

            await bgImageInput.fill('images/icon-192x192.webp');
            await bgImageInput.blur();

            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'background-image', value: /url\(.*images\/icon-192x192\.webp.*\)/ });

            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'color', value: 'rgb(255, 255, 255)' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'padding', value: '20px' });
        });

        await test.step('異常系: セミコロンのない崩れた手動スタイルがあっても、クラッシュせずに解析できること', async ({ }) => {
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, 'スタイル');

            const styleEditor = propertyContainer.locator('#style-container > .monaco-editor');
            await expect(styleEditor).toBeVisible();

            const brokenStyle = 'element.style {\n    background-image: url("images/icon-192x192.webp")\n}';
            await editorHelper.setMonacoValue(styleEditor, brokenStyle);

            await editorHelper.switchTabInContainer(propertyContainer, '属性');
            const targetInputPanel = editorHelper.getPropertyInput('style-background');
            await expect(targetInputPanel).toBeVisible();

            const bgImageInput = targetInputPanel.locator('input[name*="image" i], input[id*="image" i], input[placeholder*="image" i], input[placeholder*="画像" i], input[name="backgroundImage"]').first();
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

            contentNodeId = await contentNode.getAttribute('data-node-id') as string;

            const buttonNode = await editorHelper.addComponent('ons-button', contentAreaSelector);
            buttonId = await buttonNode.getAttribute('data-node-id') as string;
        });

        await test.step('1. ボタンを選択し、グラデーションを有効にする', async () => {
            await editorHelper.selectNodeByAttribute('data-node-id', buttonId);

            await editorHelper.openMoveingHandle('right');
            await editorHelper.switchTabInContainer(propertyContainer, '属性');

            const targetInputPanel = editorHelper.getPropertyInput('style-background');
            await expect(targetInputPanel).toBeVisible();

            const gradientCheckbox = targetInputPanel.locator('.accordion-header input[type="checkbox"]');
            await expect(gradientCheckbox).toBeVisible();
            await gradientCheckbox.check();

            const accordionContent = targetInputPanel.locator('.accordion-content');
            await expect(accordionContent).toHaveClass(/expanded/);
        });

        await test.step('2. コンテンツエリア（非グラデーション要素）に選択を切り替える', async () => {
            await editorHelper.selectNodeByAttribute('data-node-id', contentNodeId);

            await editorHelper.openMoveingHandle('right');

            const targetInputPanel = editorHelper.getPropertyInput('style-background');
            await expect(targetInputPanel).toBeVisible();

            await expect(async () => {
                const gradientCheckbox = targetInputPanel.locator('.accordion-header input[type="checkbox"]');
                await expect(gradientCheckbox).not.toBeChecked();

                const accordionContent = targetInputPanel.locator('.accordion-content');
                await expect(accordionContent).not.toHaveClass(/expanded/);
            }).toPass({ timeout: 5000, intervals: [500] });
        });

        await test.step('3. 再びボタンを選択し、グラデーションセクションが自動で展開されることを確認', async () => {
            await editorHelper.openMoveingHandle('left');
            await editorHelper.selectNodeByAttribute('data-node-id', buttonId);

            await editorHelper.openMoveingHandle('right');

            const targetInputPanel = editorHelper.getPropertyInput('style-background');
            await expect(targetInputPanel).toBeVisible();

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

            await dragInput(editorPage, fontSizeInput, 0, -50);

            const val = parseInt(await fontSizeInput.inputValue());
            expect(val).toBeGreaterThan(16);
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'font-size', value: `${val}px` });
        });

        await test.step('検証: マウスの下方向ドラッグによる減少と、0未満へのクランプ処理', async () => {
            await dragInput(editorPage, fontSizeInput, 0, 150);

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

            await dragInput(editorPage, lineHeightInput, 0, -30);
            const val = parseFloat(await lineHeightInput.inputValue());

            expect(val).toBeGreaterThan(1.5);
            expect(val % 1).not.toBe(0);
        });

        await test.step('検証: 文字間隔（letter-spacing）の負の値の許容', async () => {
            await letterSpacingInput.fill('0px');
            await letterSpacingInput.blur();

            await dragInput(editorPage, letterSpacingInput, 0, 50);
            const val = parseFloat(await letterSpacingInput.inputValue());

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

            await dragInput(editorPage, fontSizeInput, 0, -20, false);
            const normalDiff = parseInt(await fontSizeInput.inputValue()) - 10;

            await fontSizeInput.fill('10px');
            await fontSizeInput.blur();

            await dragInput(editorPage, fontSizeInput, 0, -20, true);
            const shiftDiff = parseInt(await fontSizeInput.inputValue()) - 10;

            expect(shiftDiff).toBeGreaterThan(normalDiff * 5);
        });

        await test.step('検証: 横ブレや微小な動き（デッドゾーン）による誤検知防止', async () => {
            await fontSizeInput.fill('15px');
            await fontSizeInput.blur();

            await dragInput(editorPage, fontSizeInput, 5, 0, false);

            await expect(fontSizeInput).toHaveValue('15px');
        });
    });

    test('属性(style-typography)でのタッチイベントによるドラッグ検証（モバイル環境用）', async ({ editorPage, editorHelper, isMobile }) => {
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

            await fontSizeInput.evaluate((el: HTMLInputElement) => {
                el.focus();

                const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
                Object.defineProperty(touchStart, 'touches', { value: [{ clientX: 100, clientY: 200 }] });
                el.dispatchEvent(touchStart);

                const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
                Object.defineProperty(touchMove, 'touches', { value: [{ clientX: 150, clientY: 200 }] });
                window.dispatchEvent(touchMove);

                const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
                window.dispatchEvent(touchEnd);
            });

            const val = parseInt(await fontSizeInput.inputValue());
            expect(val).toBeGreaterThan(16);
        });
    });

    test('属性(style-background)でのドラッグによる不透明度調整', async ({ editorPage, editorHelper, isMobile }) => {
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

        const bgColorInput = targetInputPanel.locator('input[name*="color" i], input[id*="color" i], input[type="color"]').first();
        await bgColorInput.fill('#ff0000');
        await bgColorInput.blur();

        if (isMobile) {
            await test.step('モバイル検証: 左右スワイプによる色の不透明度・全体の不透明度の調整', async () => {
                const bgAlphaBadge = targetInputPanel.locator('.drag-badge[data-drag-type="bg-alpha"]');
                const elementOpacityBadge = targetInputPanel.locator('.drag-badge[data-drag-type="element-opacity"]');

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

            const radiusInput = targetInputPanel.locator('input[name="borderRadius"], input[name="border-radius"], input#border-radius').first();
            await expect(radiusInput).toBeVisible();
            await expect(radiusInput).toBeEditable();
            await radiusInput.fill('15px');
            await radiusInput.blur();
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-radius', value: '15px' });

            const widthInput = targetInputPanel.locator('input[name="borderWidth"], input[name="border-width"], input#border-width').first();
            await expect(widthInput).toBeVisible();
            await expect(widthInput).toBeEditable();
            await widthInput.fill('3px');
            await widthInput.blur();
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-width', value: '3px' });

            const styleSelect = targetInputPanel.locator('select[name="borderStyle"], select[name="border-style"], select#border-style').first();
            await expect(styleSelect).toBeVisible();
            await styleSelect.selectOption('dashed');
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-style', value: 'dashed' });

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

            await radiusInput.fill('invalid_value');
            await radiusInput.blur();

            const previewElement = editorHelper.getPreviewElement(previewSelector);
            await expect(previewElement).toHaveAttribute('style', /border-radius:\s*invalid_value/);
        });

        await test.step('4. 正常系: 入力値を空にしてボーダー設定が部分的にクリアされること', async () => {
            const targetInputPanel = editorHelper.getPropertyInput('style-border');
            const radiusInput = targetInputPanel.locator('input[name="borderRadius"], input[name="border-radius"], input#border-radius').first();

            await radiusInput.fill('');
            await radiusInput.blur();

            const previewElement = editorHelper.getPreviewElement(previewSelector);
            await editorPage.waitForTimeout(300);
            const styleAttr = await previewElement.getAttribute('style') || '';
            expect(styleAttr).not.toContain('border-radius:');
        });

        await test.step('5. 異常系: 他のスタイルが既に存在する場合、上書き・破壊せずに更新できること', async ({ }) => {
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, 'スタイル');

            const styleEditor = propertyContainer.locator('#style-container > .monaco-editor');
            await expect(styleEditor).toBeVisible();

            const presetStyle = 'element.style {\n    color: rgb(0, 128, 0);\n    padding: 12px;\n}';
            await editorHelper.setMonacoValue(styleEditor, presetStyle);

            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'color', value: 'rgb(0, 128, 0)' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'padding', value: '12px' });

            await editorHelper.switchTabInContainer(propertyContainer, '属性');
            const targetInputPanel = editorHelper.getPropertyInput('style-border');
            const widthInput = targetInputPanel.locator('input[name="borderWidth"], input[name="border-width"], input#border-width').first();

            await widthInput.fill('5px');
            await widthInput.blur();

            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-width', value: '5px' });

            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'color', value: 'rgb(0, 128, 0)' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'padding', value: '12px' });
        });

        await test.step('6. 異常系: セミコロンのない崩れた手動スタイルがあっても、クラッシュせずに解析できること', async ({ }) => {
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, 'スタイル');

            const styleEditor = propertyContainer.locator('#style-container > .monaco-editor');
            await expect(styleEditor).toBeVisible();

            const brokenStyle = 'element.style {\n    border-radius: 8px\n}';
            await editorHelper.setMonacoValue(styleEditor, brokenStyle);

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

                await editorPage.waitForTimeout(300);
                await radiusInput.click({ force: true });
                await editorPage.waitForTimeout(200);

                await radiusInput.evaluate((el: HTMLInputElement) => {
                    el.focus();

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

                await widthInput.fill('2px');
                await widthInput.blur();

                await editorPage.waitForTimeout(300);
                await widthInput.click({ force: true });
                await editorPage.waitForTimeout(200);

                await widthInput.evaluate((el: HTMLInputElement) => {
                    el.focus();

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

            await expect(widthInput).toBeVisible();
            await expect(widthInput).toBeEditable();
            await widthInput.fill('100px');
            await widthInput.blur();
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'width', value: '100px' });

            await expect(heightInput).toBeVisible();
            await expect(heightInput).toBeEditable();
            await heightInput.fill('50px');
            await heightInput.blur();
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'height', value: '50px' });
        });

        await test.step('検証: 入力値を空にして背景設定が部分的にクリアされること', async ({ }) => {
            const targetInputPanel = editorHelper.getPropertyInput('style-sizing');
            const widthInput = targetInputPanel.locator('input').nth(0);

            await widthInput.fill('');
            await widthInput.blur();

            const previewElement = editorHelper.getPreviewElement(previewSelector);
            await editorPage.waitForTimeout(300);
            const styleAttr = await previewElement.getAttribute('style') || '';
            expect(styleAttr).not.toContain('width:');

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

                await editorPage.waitForTimeout(300);
                await widthInput.click({ force: true });
                await editorPage.waitForTimeout(200);

                await widthInput.evaluate((el: HTMLInputElement) => {
                    el.focus();

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

                await editorPage.waitForTimeout(300);
                await heightInput.click({ force: true });
                await editorPage.waitForTimeout(200);

                await heightInput.evaluate((el: HTMLInputElement) => {
                    el.focus();

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
            await editorHelper.closeMoveingHandle();

            const platformSwitcher = editorPage.locator('platform-switcher');
            const toggleHighlightBtn = platformSwitcher.locator('button[title*="選択枠を非表示にする"]');
            await expect(toggleHighlightBtn).toBeVisible();
            await toggleHighlightBtn.click({ force: true });
        });

        await test.step('4. プレビュー内の選択枠（.layout-selected）が消えていることを検証', async () => {
            const previewFrame = editorHelper.getPreviewFrame();
            const selectedBorder = previewFrame.locator('.layout-selected');
            await expect(selectedBorder).toBeHidden({ timeout: 5000 });
        });

        await test.step('5. 再び目ボタンをクリックして選択枠を再表示にする', async () => {
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

// =========================================================================
// Merged from: tests/specs/normal/editor-style-increment.spec.ts
// =========================================================================

test.describe('CSSエディタ：数値のインテリジェント増減機能のテスト', () => {

    test.beforeEach(async ({ editorPage, editorHelper }) => {
        // 右ハンドルを展開し、プロパティパネルの「スタイル」タブに切り替え
        await editorHelper.openMoveingHandle('right');
        const propertyContainer = editorPage.locator('property-container');
        await propertyContainer.locator('#tab-style').click();
        await expect(propertyContainer.locator('#style-container')).toBeVisible();
    });

    /**
     * Monaco Editor内での増減操作をシミュレートするヘルパー関数
     * @param editorPage 
     * @param css 初期状態のCSS文字列
     * @param line 操作対象の行番号
     * @param column 操作対象の列番号（カーソル位置）
     * @param key 使用するキー ('ArrowUp' | 'ArrowDown')
     * @param shift Shiftキーを同時押しするか
     * @returns 操作後のエディタの内容
     */
    async function testIncrement(
        editorPage: Page,
        initialCSS: string,
        line: number,
        column: number,
        key: 'ArrowUp' | 'ArrowDown',
        shift: boolean = false
    ) {
        console.log(`[StyleInc:DEBUG] styleEditor の初期化完了を計測開始します...`);
        const startTime = Date.now();
        let isReady = false;

        // 最大10秒（100ms * 100回）状態を監視
        for (let i = 0; i < 100; i++) {
            const check = await editorPage.evaluate(() => {
                const container = document.querySelector('app-container');
                const host = container?.shadowRoot?.querySelector('property-container') as any;
                return !!(host && host.styleEditor);
            });
            if (check) {
                isReady = true;
                console.log(`[StyleInc:DEBUG] styleEditor の初期化を確認。所要時間: ${Date.now() - startTime}ms`);
                break;
            }
            await editorPage.waitForTimeout(100);
        }

        if (!isReady) {
            console.log(`[StyleInc:DEBUG] 10秒待機しても styleEditor は初期化されませんでした。`);
        }

        // Shadow DOM経由でMonaco Editorのインスタンスに直接アクセスして状態を設定
        await editorPage.evaluate(({ css }) => {
            const container = document.querySelector('app-container');
            const host = container?.shadowRoot?.querySelector('property-container') as any;
            if (host && host.styleEditor) {
                host.styleEditor.setValue(css);
            }
        }, { css: initialCSS });

        // カーソル位置の設定とエディタへのフォーカス
        await editorPage.evaluate(({ l, c }) => {
            const container = document.querySelector('app-container');
            const host = container?.shadowRoot?.querySelector('property-container') as any;
            if (host && host.styleEditor) {
                host.styleEditor.setPosition({ lineNumber: l, column: c });
                host.styleEditor.focus();
            }
        }, { l: line, c: column });

        // キーボード操作のシミュレーション
        if (shift) await editorPage.keyboard.down('Shift');
        await editorPage.keyboard.press(key);
        if (shift) await editorPage.keyboard.up('Shift');

        // エラーを投げる可能性のある箇所
        return await editorPage.evaluate(() => {
            const container = document.querySelector('app-container');
            const host = container?.shadowRoot?.querySelector('property-container') as any;
            return host ? host.styleEditor.getValue() : '';
        });
    }

    test('基本：1px単位の増減 (font-size)', async ({ editorPage }) => {
        const css = 'element.style {\n    font-size: 16px;\n}';
        const result = await testIncrement(editorPage, css, 2, 17, 'ArrowUp');
        expect(result).toContain('font-size: 17px;');
    });

    test('インテリジェントステップ：0.1単位 (opacity)', async ({ editorPage }) => {
        const css = 'element.style {\n    opacity: 0.5;\n}';
        const result = await testIncrement(editorPage, css, 2, 15, 'ArrowUp');
        expect(result).toContain('opacity: 0.6;');
    });

    test('インテリジェントステップ：100単位 (font-weight)', async ({ editorPage }) => {
        const css = 'element.style {\n    font-weight: 400;\n}';
        const result = await testIncrement(editorPage, css, 2, 18, 'ArrowDown');
        expect(result).toContain('font-weight: 300;');
    });

    test('Shiftキーによる加速：1px -> 10px (width)', async ({ editorPage }) => {
        const css = 'element.style {\n    width: 100px;\n}';
        const result = await testIncrement(editorPage, css, 2, 13, 'ArrowUp', true);
        expect(result).toContain('width: 110px;');
    });

    /**
     * line-height等の小数を許容するプロパティにおいて、
     * Shift加速(ステップ1.0)適用時にMath.roundによる整数化が行われる現行仕様の検証。
     */
    test('Shiftキーによる加速（小数プロパティ）：0.1 -> 1.0 (line-height)', async ({ editorPage }) => {
        const css = 'element.style {\n    line-height: 1.2;\n}';
        const result = await testIncrement(editorPage, css, 2, 18, 'ArrowUp', true);
        // 現在の実装仕様: 1.2 + 1.0 = 2.2 -> Math.round(2.2) = 2 となる挙動を確認
        expect(result).toContain('line-height: 2;');
    });

    test('負の値と単位の維持 (margin-top)', async ({ editorPage }) => {
        const css = 'element.style {\n    margin-top: -10px;\n}';
        const result = await testIncrement(editorPage, css, 2, 17, 'ArrowUp');
        expect(result).toContain('margin-top: -9px;');
    });

    /**
     * カーソルが数値上にない場合、カスタムロジックが介入せず
     * エディタ標準の挙動（この場合は行移動）が維持されることを確認。
     */
    test('数値以外の場所では標準の行移動が行われること', async ({ editorPage }) => {
        console.log(`[StyleInc:DEBUG] 数値以外テスト: styleEditor の初期化完了を計測開始します...`);
        const startTime = Date.now();
        let isReady = false;

        for (let i = 0; i < 100; i++) {
            const check = await editorPage.evaluate(() => {
                const container = document.querySelector('app-container');
                const host = container?.shadowRoot?.querySelector('property-container') as any;
                return !!(host && host.styleEditor);
            });
            if (check) {
                isReady = true;
                console.log(`[StyleInc:DEBUG] 数値以外テスト: styleEditor の初期化を確認。所要時間: ${Date.now() - startTime}ms`);
                break;
            }
            await editorPage.waitForTimeout(100);
        }

        await editorPage.evaluate(() => {
            const container = document.querySelector('app-container');
            const host = container?.shadowRoot?.querySelector('property-container') as any;
            if (host && host.styleEditor) {
                host.styleEditor.setValue('element.style {\n    color: red;\n    display: block;\n}');
                host.styleEditor.setPosition({ lineNumber: 2, column: 14 }); // 'red'の末尾
                host.styleEditor.focus();
            }
        });

        await editorPage.keyboard.press('ArrowDown');

        const finalPos = await editorPage.evaluate(() => {
            const container = document.querySelector('app-container');
            const host = container?.shadowRoot?.querySelector('property-container') as any;
            return host ? host.styleEditor.getPosition() : { lineNumber: 0 };
        });

        // 独自の増減処理が走らず、標準の「下の行への移動」が行われたことを検証
        expect(finalPos.lineNumber).toBe(3);
    });
});
// =========================================================================
// Merged from: tests/specs/normal/editor-property-parsing.spec.ts
// =========================================================================

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