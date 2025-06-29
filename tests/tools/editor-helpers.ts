import { expect, type Page, type Locator, FrameLocator } from '@playwright/test';

// =================================================================
// 提案1: 汎用的なエディタ操作ヘルパー関数群 (基本アクション)
// =================================================================

/**
 * エディタ内で新しいページを追加します。
 * @param editorPage エディタのPageオブジェクト
 * @returns 追加された新しいページノードのLocator
 */
export async function addPage(editorPage: Page): Promise<Locator> {
    await editorPage.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });
    const humburgerButton = editorPage.locator('template-container #hamburger');
    await expect(humburgerButton).toBeVisible();
    await editorPage.locator('template-container #hamburger').click();
    await expect(editorPage.locator('#contextMenu')).toBeVisible();
    await editorPage.locator('#contextMenu').getByText('ページ追加').click();
    const newPageNode = editorPage.locator('#dom-tree > .node[data-node-type="page"]').last();
    await expect(newPageNode).toBeVisible();
    return newPageNode;
}

// /**
//  * ツールボックスからコンポーネントをDOMツリーの指定場所にドラッグ＆ドロップします。
//  * dragTo を使用し、セレクタの解決タイミングを最適化することで安定性を確保します。
//  * @param editorPage エディタのPageオブジェクト
//  * @param componentName Toolboxに表示されているコンポーネント名
//  * @param targetSelector D&Dのドロップ先となる要素の「セレクタ文字列」
//  * @returns 追加されたコンポーネントノードのLocator
//  */
// export async function addComponent(editorPage: Page, componentName: string, targetSelector: string): Promise<Locator> {
//     const targetLocator = editorPage.locator(targetSelector);
//     await editorPage.locator('tool-box-item', { hasText: componentName }).dragTo(targetLocator);
//     const newComponentNode = targetLocator.locator(`> .node[data-node-type="${componentName}"]`);
//     await expect(newComponentNode).toBeVisible({ timeout: 5000 });
//     return newComponentNode;
// }

/**
 * ツールボックスからコンポーненトをDOMツリーの指定場所にドラッグ＆ドロップします。
 * (オーバーロード)
 * @param editorPage エディタのPageオブジェクト
 * @param componentName Toolboxに表示されているコンポーネント名
 * @param targetSelector D&Dのドロップ先となる要素の「セレクタ文字列」
 */
export async function addComponent(
    editorPage: Page,
    componentName: string,
    targetSelector: string
): Promise<Locator>;

/**
 * ツールボックスからコンポーненトをDOMツリーの指定場所にドラッグ＆ドロップします。
 * (オーバーロード)
 * @param editorPage エディタのPageオブジェクト
 * @param componentName Toolboxに表示されているコンポーネント名
 * @param targetLocator D&Dのドロップ先となる要素の「Locatorオブジェクト」
 */
export async function addComponent(
    editorPage: Page,
    componentName: string,
    targetLocator: Locator
): Promise<Locator>;

/**
 * ツールボックスからコンポーネントをDOMツリーの指定場所にドラッグ＆ドロップします。
 * 
 * @param editorPage エディタのPageオブジェクト
 * @param componentName Toolboxに表示されているコンポーネント名
 * @param target D&Dのドロップ先（セレクタ文字列またはLocatorオブジェクト）
 */
export async function addComponent(
    editorPage: Page,
    componentName: string,
    target: string | Locator
): Promise<Locator> {
    // 引数 'target' が文字列型かLocator型かを判定
    const targetLocator = typeof target === 'string' ? editorPage.locator(target) : target;

    await editorPage.locator('tool-box-item', { hasText: componentName }).dragTo(targetLocator, { targetPosition: { x: 10, y: 10 } }); // 位置を左上より少し中央よりにする
    //console.log(`componentName:${componentName}`)
    //console.log(`targetLocatorInnerHTML:${await targetLocator.innerHTML()}`)
    const newComponentNode = targetLocator.locator(`> .node[data-node-type="${componentName}"]`);
    await expect(newComponentNode).toBeVisible();
    return newComponentNode;
}

/**
 * ツールボックスから「HTML Tag」をドラッグ＆ドロップします。
 * @param editorPage エディタのPageオブジェクト
 * @param htmlTagName 作成するHTMLタグ名
 * @param targetLocator D&Dのドロップ先となる要素のLocator
 * @returns 追加されたHTMLタグノードのLocator
 */
export async function addComponentAsHtmlTag(editorPage: Page, htmlTagName: string, targetSelector: string): Promise<Locator> {
    editorPage.once('dialog', async dialog => {
        expect(dialog.message()).toBe('追加するタグ名を入れてください');
        await dialog.accept(htmlTagName);
    });

    const targetLocator = editorPage.locator(targetSelector);
    await editorPage.locator('tool-box-item', { hasText: 'HTML Tag' }).dragTo(targetLocator);

    const newHtmlTagNode = targetLocator.locator(`> .node[data-node-type="${htmlTagName}"]`);
    await expect(newHtmlTagNode).toBeVisible({ timeout: 5000 });
    return newHtmlTagNode;
}

/**
 * DOMツリー内の指定したノードをクリックして選択状態にします。
 * @param nodeLocator 選択したいノードのLocator
 */
export async function selectNodeInDomTree(nodeLocator: Locator): Promise<void> {
    //console.log(`nodeLocator:${await nodeLocator.innerHTML()}`)
    await nodeLocator.click({ position: { x: 0, y: 10 } });
    await expect(nodeLocator).toHaveClass(/node-select/);
}

/**
 * プロパティパネルの「属性を編集」ボタン（歯車アイコン）をクリックしてモーダルを開きます。
 * @param editorPage エディタのPageオブジェクト
 */
export async function openAttributeEditor(editorPage: Page): Promise<void> {
    await editorPage.locator('property-container').getByTitle('属性を編集').click();
    await expect(editorPage.locator('#attributeList')).toBeVisible();
}

/**
 * 属性編集モーダルで新しい属性定義を追加します。
 * @param editorPage エディタのPageオブジェクト
 * @param name 属性名
 * @param template テンプレート文字列 (例: 'input[text]', 'style-flex')
 * @param scope 'element' (要素に) または 'tag' (タグに)
 */
export async function addAttributeDefinition(
    editorPage: Page,
    { name, template, scope }: { name: string; template: string; scope: 'element' | 'tag' }
): Promise<void> {
    const propertyContainer = editorPage.locator('property-container');
    const scopeButtonName = scope === 'element' ? '要素に追加' : 'タグに追加';
    await propertyContainer.getByRole('button', { name: scopeButtonName }).click();

    await propertyContainer.getByRole('combobox', { name: '属性名:' }).fill(name);
    await propertyContainer.getByRole('combobox', { name: 'テンプレート:' }).fill(template);
    await propertyContainer.getByRole('button', { name: '追加' }).click();

    // モーダルが閉じて、新しい属性の入力欄が表示されるのを待つ
    await expect(propertyContainer.locator('#attributeList')).toBeHidden();
    const newPropertyRow = propertyContainer.locator('.editor-row', { hasText: name });
    await expect(newPropertyRow).toBeVisible();
}

/**
 * 属性編集モーダルで指定した属性定義を削除します。
 * @param editorPage エディタのPageオブジェクト
 * @param name 削除する属性名
 */
export async function deleteAttributeDefinition(editorPage: Page, name: string): Promise<void> {
    const propertyContainer = editorPage.locator('property-container');
    const attrList = propertyContainer.locator('#attributeList');

    // 属性リスト内の削除対象の行を探す
    const targetRow = attrList.locator('div.attribute-item', { hasText: name });
    // 編集アイコンをクリックして削除ボタンを表示させる
    await targetRow.locator('.edit-icon').click();

    // 確認ダイアログを自動で承諾するように設定
    editorPage.once('dialog', dialog => dialog.accept());
    // 削除ボタンをクリック
    await propertyContainer.getByRole('button', { name: '削除' }).click();

    // 属性がリストから消えるのを待つ
    await expect(targetRow).toBeHidden();
}

/**
 * 新しいページを追加し、そのコンテンツエリアに`ons-button`を1つ配置します。
 * @param editorPage エディタのPageオブジェクト
 * @returns { pageNode: Locator, buttonNode: Locator } ページとボタンのノードLocator
 */
export async function setupPageWithButton(editorPage: Page): Promise<{ pageNode: Locator; buttonNode: Locator }> {
    const pageNode = await addPage(editorPage);
    const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';

    // addComponentには、この安定した「セレクタ文字列」を渡す
    const buttonNode = await addComponent(editorPage, 'ons-button', contentAreaSelector);

    // pageNodeは後続のテストで使うかもしれないので返す
    return { pageNode, buttonNode };
}

/**
 * Flexコンテナと、その子要素となるFlexアイテムを配置し、それぞれに必要な属性を定義します。
 * @param editorPage エディタのPageオブジェクト
 * @returns { containerNode: Locator, itemNode: Locator } コンテナとアイテムのノードLocator
 */
export async function setupFlexContainerWithItem(editorPage: Page): Promise<{ containerNode: Locator; itemNode: Locator }> {
    await addPage(editorPage);
    const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';

    const containerNode = await addComponentAsHtmlTag(editorPage, 'flex-container', contentAreaSelector);
    await selectNodeInDomTree(containerNode);
    await openAttributeEditor(editorPage);
    await addAttributeDefinition(editorPage, { name: 'style-flex', template: 'style-flex', scope: 'tag' });
    await getPropertyInput(editorPage, 'style-flex').locator('input[type="checkbox"]').check();

    const containerId = await containerNode.getAttribute('data-node-id');
    const containerSelector = `#dom-tree div[data-node-id="${containerId}"]`;

    const itemNode = await addComponentAsHtmlTag(editorPage, 'flex-item', containerSelector);
    await selectNodeInDomTree(itemNode);
    await openAttributeEditor(editorPage);
    await addAttributeDefinition(editorPage, { name: 'style-flexitem', template: 'style-flex-item', scope: 'tag' });

    return { containerNode, itemNode };
}

/**
 * ヘルパー関数: エディタ内のトップテンプレートリストに特定のページが表示されているか確認します。
 * @param page エディタのPageオブジェクト
 * @param pageName 確認するページ名
 */
export const expectPageInTemplateList = async (page: Page, pageName: string) => { // export を追加
    await page.locator('template-container').locator('.select').click();
    const topTemplateList = page.locator('template-container').locator('#top-template-list');
    await expect(topTemplateList).toBeVisible();
    await expect(topTemplateList.locator('.top-template-item', { hasText: pageName })).toBeVisible();
    // 検証後はリストを閉じる操作も入れておくと、後続のテストに影響しにくい
    await page.locator('template-container').locator('.title-bar').click();
    await expect(topTemplateList).toBeHidden();
};

/**
 * エディタのプレビューエリア（iframe）のFrameLocatorを取得します。
 * @param editorPage エディタのPageオブジェクト
 * @returns プレビューエリアのFrameLocator
 */
export function getPreviewFrame(editorPage: Page): FrameLocator {
    return editorPage.locator('#renderzone').contentFrame();
}

/**
 * エディタのプロパティパネルのLocatorを取得します。
 * @param editorPage エディタのPageオブジェクト
 * @returns プロパティパネルのLocator
 */
export function getPropertyContainer(editorPage: Page): Locator {
    return editorPage.locator('property-container');
}

/**
 * エディタのDOMツリーのLocatorを取得します。
 * @param editorPage エディタのPageオブジェクト
 * @returns DOMツリーのLocator
 */
export function getDomTree(editorPage: Page): Locator {
    return editorPage.locator('#dom-tree');
}

/**
 * プレビューエリア内の指定された要素のLocatorを取得します。
 * @param editorPage エディタのPageオブジェクト
 * @param selector プレビュー内で探す要素のCSSセレクタ
 * @returns 指定された要素のLocator
 */
export function getPreviewElement(editorPage: Page, selector: string): Locator {
    return getPreviewFrame(editorPage).locator(selector);
}

/**
 * プロパティパネル内の指定された属性のUI要素（入力欄やカスタム要素）を取得します。
 * data-attribute-type属性とカスタムタグ名の両方に対応します。
 * @param editorPage エディタのPageオブジェクト
 * @param attributeNameOrTagName 属性名またはカスタムタグ名 (例: 'text', 'style-flex-item')
 * @returns 指定された属性UI要素のLocator
 */
export function getPropertyInput(editorPage: Page, attributeNameOrTagName: string): Locator {
    const propertyContainer = getPropertyContainer(editorPage);
    const byAttribute = `[data-attribute-type="${attributeNameOrTagName}"]`;
    const byTagName = attributeNameOrTagName;
    return propertyContainer.locator(`${byAttribute}, ${byTagName}`);
}

/**
 * 指定されたコンテナ内のタブを切り替えます。
 * @param containerLocator タブ要素を持つコンテナのLocator
 * @param tabName '属性', 'スタイル', 'イベント' など
 */
export async function switchTabInContainer(containerLocator: Locator, tabName: string): Promise<void> {
    const tabLocator = containerLocator.locator('.tab', { hasText: tabName });
    await tabLocator.click();
    //await containerLocator.getByText(tabName, { exact: true }).click();
}

/**
 * プレビュー内の要素のCSSプロパティを検証します。
 * @param editorPage エディタのPageオブジェクト
 * @param selector プレビュー内で探す要素のCSSセレクタ
 * @param property 検証するCSSプロパティ名 (例: 'background-color')
 * @param value 期待するCSSプロパティの値 (例: 'rgb(255, 0, 0)')
 */
export async function expectPreviewElementCss(
    editorPage: Page,
    { selector, property, value }: { selector: string; property: string; value: string | RegExp }
): Promise<void> {
    const element = getPreviewElement(editorPage, selector);
    await expect(element).toHaveCSS(property, value);
}

/**
 * プレビュー内の要素の属性を検証します。
 * @param editorPage エディタのPageオブジェクト
 * @param selector プレビュー内で探す要素のCSSセレクタ
 * @param attributeName 検証する属性名
 * @param value 期待する属性の値。値がないこと(属性が存在しないこと)を検証する場合は `null` を渡す。
 */
export async function expectPreviewElementAttribute(
    editorPage: Page,
    { selector, attributeName, value }: { selector: string; attributeName: string; value: string | null }
): Promise<void> {
    const element = getPreviewElement(editorPage, selector);
    if (value === null) {
        await expect(element).not.toHaveAttribute(attributeName, /.*/); // 属性が存在しないことを確認
    } else {
        await expect(element).toHaveAttribute(attributeName, value);
    }
}

/**
 * プロパティ入力欄の行がハイライトされているか（特定の背景色か）を検証します。
 * @param propertyInputLocator 検証対象のプロパティ入力欄のLocator
 * @param expectedColor 期待する背景色 (例: 'rgba(0, 112, 255, 0.11)')。色がついていないことを期待する場合は null を渡す。
 */
export async function expectPropertyHighlight(
    propertyInputLocator: Locator,
    expectedColor: string | null
): Promise<void> {
    const backgroundColor = await propertyInputLocator.evaluate(el => {
        // Shadow DOMを探索して親の .editor-row を見つけ、その背景色を返す
        const root = el.getRootNode();
        if (!(root instanceof ShadowRoot)) return null;
        const hostElement = root.host;
        const editorRow = hostElement.closest('.editor-row');
        return editorRow ? window.getComputedStyle(editorRow).backgroundColor : null;
    });

    if (expectedColor) {
        expect(backgroundColor).toBe(expectedColor);
    } else {
        // ハイライトがない場合、通常は透明か白など決まった色のはず
        // ここでは 'rgba(0, 0, 0, 0)' (透明) を期待値とする
        expect(backgroundColor).toBe('rgba(0, 0, 0, 0)');
    }
}

/**
 * 動作モードに切り替え、必要に応じてアラートを検証します。
 * @param page - Pageオブジェクト
 * @param options - オプション
 * @param options.expectedAlertText - 検証したいアラートのテキスト（指定しない場合はアラート検証をスキップ）
 */
export async function switchToRunModeAndVerify(page: Page, options: { expectedAlertText?: string } = {}) {
    const platformSwitcher = page.locator('platform-switcher');

    // メニューを開く
    await platformSwitcher.locator('.screen-rotete-container').click();
    const menu = platformSwitcher.locator('#platformEditMenu');
    await expect(menu).toBeVisible();

    // 「動作」モードをクリック
    await menu.getByText('動作').click();

    // メニューを閉じる
    await platformSwitcher.locator('.screen-rotete-container').click();
    await expect(menu).toBeHidden();

    if (options.expectedAlertText) {
        // アラートのテキストが指定されている場合のみ検証
        const previewFrame = page.frameLocator('#renderzone');
        const alertDialog = previewFrame.locator('ons-alert-dialog');
        await expect(alertDialog).toBeVisible();
        await expect(alertDialog).toContainText(options.expectedAlertText);
        //await alertDialog.getByRole('button').click();
        const alertDialogButton = alertDialog.locator('ons-alert-dialog-button');
        await alertDialogButton.click();
        await expect(alertDialog).toBeHidden();
    }
}

/**
 * エディタの内容を保存し、QRコードから実機テストページを新しいタブで開きます。
 * @param editorPage エディタのPageオブジェクト
 * @returns 開かれた実機テストページのPageオブジェクト
 */
export async function saveAndOpenTestPage(editorPage: Page): Promise<Page> {
    const menuButton = editorPage.locator('#fab-bottom-menu-box');
    await expect(menuButton).toBeVisible();
    await expect(menuButton).toBeEnabled();
    await menuButton.click();

    const platformBottomMenu = editorPage.locator('#platformBottomMenu');
    await expect(platformBottomMenu).toBeVisible();

    // 保存を実行
    await platformBottomMenu.getByText('保存', { exact: true }).click();
    // 保存完了を待つ（必要に応じて、より確実な待機処理を追加）
    await editorPage.waitForTimeout(500); // UIの反応を待つための短い待機

    // 再度メニューを開き、テストページを開く
    await menuButton.click();
    await expect(platformBottomMenu).toBeVisible();

    const testPagePromise = editorPage.context().waitForEvent('page');
    await editorPage.locator('#qrcode').click();
    const testPage = await testPagePromise;

    return testPage;
}

/**
 * DOMツリー内で、特定のデータ属性を持つノードを選択します。
 * @param editorPage エディタのPageオブジェクト
 * @param attributeName 'data-node-id' や 'data-node-type' などの属性名
 * @param attributeValue 属性の値
 * @returns 選択されたノードのLocator
 */
export async function selectNodeByAttribute(editorPage: Page, attributeName: string, attributeValue: string): Promise<Locator> {
    const domTree = getDomTree(editorPage);
    const node = domTree.locator(`div[${attributeName}="${attributeValue}"]`);
    await selectNodeInDomTree(node); // 既存のヘルパーを再利用
    return node;
}

/**
 * DOMツリーで選択中のコンテキスト（トップレベルテンプレート）を切り替えます。
 * 例：アプリケーション全体 -> page1 -> page2
 * @param editorPage エディタのPageオブジェクト
 * @param templateNodeId 'アプリケーション' またはページのdata-template-id
 */
export async function switchTopLevelTemplate(editorPage: Page, templateId: string): Promise<void> {
    const topContainer = editorPage.locator('.top-container');
    await topContainer.click();
    const topTemplateListContainer = topContainer.locator('#top-template-list');
    await expect(topTemplateListContainer).toBeVisible();

    // console.log(`templateId: ${templateId}`)
    const targetToplistItem = topTemplateListContainer.locator(
        ` div.top-template-item[data-template-id="${templateId}"]`
    );
    await expect(targetToplistItem).toBeVisible();
    await expect(targetToplistItem).toBeEnabled();
    await targetToplistItem.click();
    await expect(topTemplateListContainer).toBeHidden();
}