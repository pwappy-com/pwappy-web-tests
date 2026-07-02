import { test as base, expect, Page, Locator, CDPSession, Dialog } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor, addVersion } from '../../tools/dashboard-helpers';
import { EditorHelper, normalizeWhitespace } from '../../tools/editor-helpers';
import { getStorageStatePath } from '../../constants';

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

        // アプリケーションカードが出現するまで、必要に応じてリロードを挟みながら待機
        await expect(async () => {
            const count = await appRow.count();
            if (count === 0) {
                // カードが見つからない場合は、ダッシュボードの表示を更新して再検索を試みます
                await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => { });
                await page.locator('dashboard-loading-overlay').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => { });
            }
            await expect(appRow).toBeVisible({ timeout: 2000 });
        }).toPass({
            timeout: 30000,     // 最大30秒間リトライを繰り返す
            intervals: [3000]   // リロード後の表示を考慮し、3秒間隔でリトライ
        });

        // 確実に対象のアプリ詳細画面を開く
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

    // workerIndex を取得
    const workerIndex = test.info().workerIndex;
    const storageStatePath = getStorageStatePath(workerIndex);

    const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
    appName = `ui-prop1-${uniqueId}`.slice(0, 30);
    appKey = `prop1-key-${uniqueId}`.slice(0, 30);

    // ワーカー固有のセッションファイルを指定してコンテキストを作成
    const context = await browser.newContext({ storageState: storageStatePath });
    const page = await context.newPage();

    await gotoDashboard(page);
    await createApp(page, appName, appKey);

    await context.close();
});

// すべてのテストが終了した後に、アプリを削除する
test.afterAll(async ({ browser }) => {
    if (appKey) {
        // 現在のワーカーのインデックスを取得
        const workerIndex = test.info().workerIndex;
        // ワーカー固有のセッションファイルのパスを取得
        const storageStatePath = getStorageStatePath(workerIndex);

        const context = await browser.newContext({ storageState: storageStatePath });
        const page = await context.newPage();

        await gotoDashboard(page);
        await deleteApp(page, appKey);

        await context.close();
    }
});

/**
 * 共有ヘルパー関数: 指定した入力欄をマウスでドラッグする（ハイブリッド動作版）
 */
async function dragInput(editorPage: Page, inputLocator: Locator, deltaX: number, deltaY: number, shiftKey: boolean = false) {
    const isMobile = editorPage.viewportSize() ? editorPage.viewportSize()!.width < 768 : false;
    const browserName = editorPage.context().browser()?.browserType().name();

    // WebKit環境またはモバイル環境の場合（物理ドラッグがエミュレータ/CI側で制限される環境）
    if (isMobile || browserName === 'webkit') {
        let finalDeltaX = deltaX;
        if (deltaX === 0 && deltaY !== 0) {
            finalDeltaX = -deltaY;
        }

        // 疑似イベント方式で、値の増減ロジックやクランプ処理が正しく動いているか検証
        await inputLocator.evaluate((el: HTMLInputElement, { dx, shift }) => {
            el.focus();
            const rect = el.getBoundingClientRect();
            const startX = rect.left + rect.width / 2;
            const startY = rect.top + rect.height / 2;

            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: startX, clientY: startY, shiftKey: shift }));
            window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: startX + dx, clientY: startY, shiftKey: shift }));
            window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: startX + dx, clientY: startY, shiftKey: shift }));
        }, { dx: finalDeltaX, shift: shiftKey });

        await editorPage.waitForTimeout(300);

    } else {
        // PC環境（Chromium / Firefoxなど）の場合
        // 従来通り、Playwrightの「本物の物理マウス操作」を行い、UIの遮蔽バグなども厳密に検証
        const box = await inputLocator.boundingBox();
        if (!box) throw new Error('Input bounding box not found');

        const startX = box.x + box.width / 2;
        const startY = box.y + box.height / 2;

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
}

const logTime = (msg: string) => {
    // デバッグ時以外は不要なのでコメント化
    // const now = new Date();
    // console.log(`[TourTest:Time] ${now.toISOString()} - ${msg}`);
};

// =========================================================================
// Merged from: tests/specs/normal/editor-navigation.spec.ts
// =========================================================================

test.describe('エディタ内機能のテスト (前半)', () => {

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
            await expect(async () => {
                await expect(previewButton).not.toHaveAttribute(attrName);
            }).toPass({ timeout: 5000, intervals: [500] });
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
            await expect(async () => {
                await expect(previewButton).not.toHaveAttribute(attrName);
            }).toPass({ timeout: 5000, intervals: [500] });
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
        await expect(async () => {
            await expect(previewButton).not.toHaveAttribute(attrName);
        }).toPass({ timeout: 5000, intervals: [500] });
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

            // 1. 配置方向 (direction) を「縦並び (上から下)」に変更
            await targetInput.locator('button.visual-btn[title="縦並び"]').click();
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'flex-direction', value: 'column' });

            // 2. 折り返し (wrap) を「折り返す」に変更
            await targetInput.locator('button.visual-btn[title="折り返す"]').click();
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'flex-wrap', value: 'wrap' });

            // 3. 水平配置 (justify-content) を「中央揃え」に変更
            await targetInput.locator('button.visual-btn[title="中央揃え"]').first().click(); // 複数の中央揃えボタンがあるため first() などで絞り込む
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'justify-content', value: 'center' });

            // 4. 垂直配置 (align-items) を「ベースライン揃え」に変更
            await targetInput.locator('button.visual-btn[title="ベースライン揃え"]').click();
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

            // 1. Grow (伸長) の変更と確定
            const flexGrowInput = targetInputPanel.locator('.option-col', { hasText: 'Grow' }).locator('input');
            await expect(flexGrowInput).toBeVisible();
            await expect(flexGrowInput).toBeEditable();
            await flexGrowInput.fill('1');
            await flexGrowInput.press('Enter'); // 💡 changeイベントを発火させて値を確定する
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'flex-grow', value: '1' });

            // 2. Shrink (縮小) の変更と確定
            const flexShrinkInput = targetInputPanel.locator('.option-col', { hasText: 'Shrink' }).locator('input');
            await expect(flexShrinkInput).toBeVisible();
            await expect(flexShrinkInput).toBeEditable();
            await flexShrinkInput.fill('2');
            await flexShrinkInput.press('Enter');
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'flex-shrink', value: '2' });

            // 3. Basis (基準幅) の変更と確定
            const flexBasisInput = targetInputPanel.locator('.option-col', { hasText: 'Basis' }).locator('input');
            await expect(flexBasisInput).toBeVisible();
            await expect(flexBasisInput).toBeEditable();
            await flexBasisInput.fill('100%');
            await flexBasisInput.press('Enter');
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'flex-basis', value: '100%' });

            // 4. Order (表示順) の変更と確定
            const orderInput = targetInputPanel.locator('.option-col', { hasText: 'Order' }).locator('input');
            await expect(orderInput).toBeVisible();
            await expect(orderInput).toBeEditable();
            await orderInput.fill('10');
            await orderInput.press('Enter');
            await editorHelper.expectPreviewElementCss({ selector: nodeType, property: 'order', value: '10' });

            // 5. align-self の変更 (これはボタンクリックなので Enter は不要)
            const alignSelfGroup = targetInputPanel.locator('.button-group').last();
            const centerAlignSelfBtn = alignSelfGroup.locator('button.visual-btn[title="中央揃え"]');

            await expect(centerAlignSelfBtn).toBeVisible();
            await centerAlignSelfBtn.click();

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

    test('モバイル環境でのカラー属性の変更と反映（正常に同期されること）', async ({ editorPage, editorHelper }) => {
        const previewSelector = 'ons-button';

        await test.step('1. セットアップ: ページとボタンを追加し、属性パネルを開く', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorPage.locator('property-container');
            await editorHelper.switchTabInContainer(propertyContainer, '属性');
        });

        await test.step('2. 背景 / 装飾（style-background）エディタを取得', async () => {
            const propertyContainer = editorHelper.getPropertyContainer();
            const bgEditor = propertyContainer.locator('style-background-editor');
            await expect(bgEditor).toBeVisible();

            const colorInput = bgEditor.locator('input[type="color"]').first();
            await expect(colorInput).toBeAttached();
        });

        await test.step('3. モバイル環境の挙動を模して change イベントのみを送信し、値が同期・反映されるか検証', async () => {
            const propertyContainer = editorHelper.getPropertyContainer();
            const bgEditor = propertyContainer.locator('style-background-editor');
            const colorInput = bgEditor.locator('input[type="color"]').first();

            // input[type="color"] に新値を設定して change イベントを発生させる
            await colorInput.evaluate((el: HTMLInputElement) => {
                el.value = '#00ff00';
                el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            });

            // 修正された live() ディレクティブと quick-editor-save のリスナーにより、
            // @inputだけでなく @change だけのトリガーでも属性とプレビューが即時同期します
            await editorHelper.expectPreviewElementCss({
                selector: previewSelector,
                property: 'background-color',
                value: 'rgb(0, 255, 0)'
            });
        });
    });
});