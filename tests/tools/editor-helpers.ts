import { expect, type Page, type Locator, FrameLocator } from '@playwright/test';

/**
 * Playwrightテスト用のエディタ操作ヘルパークラス。
 * エディタのPageオブジェクトとモバイルフラグを状態として保持し、
 * 各操作メソッドの引数をシンプルにします。
 * 
 * @example
 * // テストコードでの利用例
 * test.beforeEach(async ({ page, isMobile }) => {
 *   await page.goto('/editor');
 *   const helper = new EditorHelper(page, isMobile);
 *   // ...
 * });
 */
export class EditorHelper {
    private readonly page: Page;
    private readonly isMobile: boolean;

    /**
     * EditorHelperのインスタンスを生成します。
     * @param page エディタのPageオブジェクト
     * @param isMobile モバイルビューポートでテストを実行しているかどうかのフラグ
     */
    constructor(page: Page, isMobile: boolean) {
        this.page = page;
        this.isMobile = isMobile;
    }

    // =================================================================
    // 基本アクション
    // =================================================================

    /**
     * エディタ内で新しいページを追加します。
     * @returns 追加された新しいページノードのLocator
     */
    async addPage(): Promise<Locator> {
        await this.page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });
        await this.openMoveingHandle('left');
        const humburgerButton = this.page.locator('template-container #hamburger');
        await expect(humburgerButton).toBeVisible();
        await this.page.locator('template-container #hamburger').click();
        await expect(this.page.locator('#contextMenu')).toBeVisible();
        await this.page.locator('#contextMenu').getByText('ページ追加').click();
        const newPageNode = this.page.locator('#dom-tree > .node[data-node-type="page"]').last();
        await expect(newPageNode).toBeVisible();
        return newPageNode;
    }

    /**
     * ツールボックスからコンポーненトをDOMツリーの指定場所にドラッグ＆ドロップします。
     * (オーバーロード)
     * @param componentName Toolboxに表示されているコンポーネント名
     * @param targetSelector D&Dのドロップ先となる要素の「セレクタ文字列」
     */
    async addComponent(componentName: string, targetSelector: string): Promise<Locator>;
    /**
     * ツールボックスからコンポーненトをDOMツリーの指定場所にドラッグ＆ドロップします。
     * (オーバーロード)
     * @param componentName Toolboxに表示されているコンポーネント名
     * @param targetLocator D&Dのドロップ先となる要素の「Locatorオブジェクト」
     */
    async addComponent(componentName: string, targetLocator: Locator): Promise<Locator>;
    /**
     * ツールボックスからコンポーネントをDOMツリーの指定場所にドラッグ＆ドロップします。
     * @param componentName Toolboxに表示されているコンポーネント名
     * @param target D&Dのドロップ先（セレクタ文字列またはLocatorオブジェクト）
     */
    async addComponent(componentName: string, target: string | Locator): Promise<Locator> {
        await this.openMoveingHandle('left');
        const targetLocator = typeof target === 'string' ? this.page.locator(target) : target;
        await this.page.locator('tool-box-item', { hasText: componentName }).dragTo(targetLocator, { targetPosition: { x: 10, y: 10 } });
        const newComponentNode = targetLocator.locator(`> .node[data-node-type="${componentName}"]`);
        await expect(newComponentNode).toBeVisible();
        return newComponentNode;
    }

    /**
     * ツールボックスから「HTML Tag」をドラッグ＆ドロップします。
     * @param htmlTagName 作成するHTMLタグ名
     * @param targetSelector D&Dのドロップ先となる要素のセレクタ文字列
     * @returns 追加されたHTMLタグノードのLocator
     */
    async addComponentAsHtmlTag(htmlTagName: string, targetSelector: string): Promise<Locator> {
        await this.openMoveingHandle('left');
        this.page.once('dialog', async dialog => {
            expect(dialog.message()).toBe('追加するタグ名を入れてください');
            await dialog.accept(htmlTagName);
        });

        const targetLocator = this.page.locator(targetSelector);
        await this.page.locator('tool-box-item', { hasText: 'HTML Tag' }).dragTo(targetLocator);

        const newHtmlTagNode = targetLocator.locator(`> .node[data-node-type="${htmlTagName}"]`);
        await expect(newHtmlTagNode).toBeVisible({ timeout: 5000 });
        return newHtmlTagNode;
    }

    /**
     * DOMツリー内の指定したノードをクリックして選択状態にします。
     * @param nodeLocator 選択したいノードのLocator
     */
    async selectNodeInDomTree(nodeLocator: Locator): Promise<void> {
        await nodeLocator.click({ position: { x: 0, y: 10 } });
        await expect(nodeLocator).toHaveClass(/node-select/);
    }

    /**
     * プロパティパネルの「属性を編集」ボタン（歯車アイコン）をクリックしてモーダルを開きます。
     */
    async openAttributeEditor(): Promise<void> {
        await this.openMoveingHandle('right');
        await this.page.locator('property-container').getByTitle('属性を編集').click();
        await expect(this.page.locator('#attributeList')).toBeVisible();
    }

    /**
     * 属性編集モーダルで新しい属性定義を追加します。
     * @param name 属性名
     * @param template テンプレート文字列 (例: 'input[text]', 'style-flex')
     * @param scope 'element' (要素に) または 'tag' (タグに)
     */
    async addAttributeDefinition({ name, template, scope }: { name: string; template: string; scope: 'element' | 'tag' }): Promise<void> {
        const propertyContainer = this.getPropertyContainer();
        const scopeButtonName = scope === 'element' ? '要素に追加' : 'タグに追加';
        await propertyContainer.getByRole('button', { name: scopeButtonName }).click();

        await propertyContainer.getByRole('combobox', { name: '属性名:' }).fill(name);
        await propertyContainer.getByRole('combobox', { name: 'テンプレート:' }).fill(template);
        await propertyContainer.getByRole('button', { name: '追加' }).click();

        await expect(propertyContainer.locator('#attributeList')).toBeHidden();
        const newPropertyRow = propertyContainer.locator('.editor-row', { hasText: name });
        await expect(newPropertyRow).toBeVisible();
    }

    /**
     * 属性編集モーダルで指定した属性定義を削除します。
     * @param name 削除する属性名
     */
    async deleteAttributeDefinition(name: string): Promise<void> {
        const propertyContainer = this.getPropertyContainer();
        const attrList = propertyContainer.locator('#attributeList');

        const targetRow = attrList.locator('div.attribute-item', { hasText: name });
        await targetRow.locator('.edit-icon').click();

        this.page.once('dialog', dialog => dialog.accept());
        await propertyContainer.getByRole('button', { name: '削除' }).click();
        await expect(targetRow).toBeHidden();
    }

    /**
     * 新しいページを追加し、そのコンテンツエリアに`ons-button`を1つ配置します。
     * @returns ページとボタンのノードLocator { pageNode: Locator, buttonNode: Locator }
     */
    async setupPageWithButton(): Promise<{ pageNode: Locator; buttonNode: Locator }> {
        const pageNode = await this.addPage();
        const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
        const buttonNode = await this.addComponent('ons-button', contentAreaSelector);
        return { pageNode, buttonNode };
    }

    /**
     * Flexコンテナと、その子要素となるFlexアイテムを配置し、それぞれに必要な属性を定義します。
     * @returns コンテナとアイテムのノードLocator { containerNode: Locator, itemNode: Locator }
     */
    async setupFlexContainerWithItem(): Promise<{ containerNode: Locator; itemNode: Locator }> {
        await this.addPage();
        const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';

        const containerNode = await this.addComponentAsHtmlTag('flex-container', contentAreaSelector);
        await this.selectNodeInDomTree(containerNode);
        await this.openAttributeEditor();
        await this.addAttributeDefinition({ name: 'style-flex', template: 'style-flex', scope: 'tag' });
        await this.getPropertyInput('style-flex').locator('input[type="checkbox"]').check();

        const containerId = await containerNode.getAttribute('data-node-id');
        const containerSelector = `#dom-tree div[data-node-id="${containerId}"]`;

        const itemNode = await this.addComponentAsHtmlTag('flex-item', containerSelector);
        await this.selectNodeInDomTree(itemNode);
        await this.openAttributeEditor();
        await this.addAttributeDefinition({ name: 'style-flexitem', template: 'style-flex-item', scope: 'tag' });

        return { containerNode, itemNode };
    }

    /**
     * エディタ内のトップテンプレートリストに特定のページが表示されているか確認します。
     * @param pageName 確認するページ名
     */
    async expectPageInTemplateList(pageName: string): Promise<void> {
        await this.page.locator('template-container').locator('.select').click();
        const topTemplateList = this.page.locator('template-container').locator('#top-template-list');
        await expect(topTemplateList).toBeVisible();
        await expect(topTemplateList.locator('.top-template-item', { hasText: pageName })).toBeVisible();
        await this.page.locator('template-container').locator('.title-bar').click();
        await expect(topTemplateList).toBeHidden();
    };

    /**
     * エディタのプレビューエリア（iframe）のFrameLocatorを取得します。
     * @returns プレビューエリアのFrameLocator
     */
    getPreviewFrame(): FrameLocator {
        return this.page.locator('#renderzone').contentFrame();
    }

    /**
     * エディタのプロパティパネルのLocatorを取得します。
     * @returns プロパティパネルのLocator
     */
    getPropertyContainer(): Locator {
        return this.page.locator('property-container');
    }

    /**
     * エディタのDOMツリーのLocatorを取得します。
     * @returns DOMツリーのLocator
     */
    getDomTree(): Locator {
        return this.page.locator('#dom-tree');
    }

    /**
     * プレビューエリア内の指定された要素のLocatorを取得します。
     * @param selector プレビュー内で探す要素のCSSセレクタ
     * @returns 指定された要素のLocator
     */
    getPreviewElement(selector: string): Locator {
        return this.getPreviewFrame().locator(selector);
    }

    /**
     * プロパティパネル内の指定された属性のUI要素（入力欄やカスタム要素）を取得します。
     * @param attributeNameOrTagName 属性名またはカスタムタグ名 (例: 'text', 'style-flex-item')
     * @returns 指定された属性UI要素のLocator
     */
    getPropertyInput(attributeNameOrTagName: string): Locator {
        const propertyContainer = this.getPropertyContainer();
        const byAttribute = `[data-attribute-type="${attributeNameOrTagName}"]`;
        const byTagName = attributeNameOrTagName;
        return propertyContainer.locator(`${byAttribute}, ${byTagName}`);
    }

    /**
     * 指定したハンドルをタップして開きます (モバイル時のみ動作)。
     * @param handleType 'right' | 'left'
     */
    async openMoveingHandle(handleType: 'right' | 'left'): Promise<void> {
        if (!this.isMobile) return;

        const leftHandle = this.page.locator(`#leftMovingHandle`);
        const rightHandle = this.page.locator(`#rightMovingHandle`);
        await expect(leftHandle).toBeVisible();
        await expect(rightHandle).toBeVisible();

        const handle = this.page.locator(`#${handleType}MovingHandle`);
        const targetContainer = (handleType === 'right')
            ? this.page.locator('script-container')
            : this.page.locator('template-container');

        if (!await targetContainer.isVisible()) {
            await expect(async () => {
                await handle.tap();
                await handle.tap();
                await expect(targetContainer).toBeVisible({ timeout: 1000 });
            }).toPass({
                timeout: 10000
            });
        }
    }

    /**
     * ハンドルを閉じる (モバイル時のみ動作)。
     */
    async closeMoveingHandle(): Promise<void> {
        if (!this.isMobile) return;

        const templateContainer = this.page.locator('template-container');
        const scriptContainer = this.page.locator('script-container');

        if (await scriptContainer.isVisible()) {
            const handle = this.page.locator(`#rightMovingHandle`);
            await handle.tap();
            await handle.tap();
        }

        if (!await templateContainer.isVisible()) {
            const handle = this.page.locator(`#leftMovingHandle`);
            await handle.tap();
            await handle.tap();
        }
    }

    /**
     * 指定されたコンテナ内のタブを切り替えます。
     * @param containerLocator タブ要素を持つコンテナのLocator
     * @param tabName '属性', 'スタイル', 'イベント' など
     */
    async switchTabInContainer(containerLocator: Locator, tabName: string): Promise<void> {
        const tabLocator = containerLocator.locator('.tab', { hasText: tabName });
        await tabLocator.click();
    }

    /**
     * プレビュー内の要素のCSSプロパティを検証します。
     * @param selector プレビュー内で探す要素のCSSセレクタ
     * @param property 検証するCSSプロパティ名 (例: 'background-color')
     * @param value 期待するCSSプロパティの値 (例: 'rgb(255, 0, 0)')
     */
    async expectPreviewElementCss({ selector, property, value }: { selector: string; property: string; value: string | RegExp }): Promise<void> {
        const element = this.getPreviewElement(selector);
        await expect(element).toHaveCSS(property, value);
    }

    /**
     * プレビュー内の要素の属性を検証します。
     * @param selector プレビュー内で探す要素のCSSセレクタ
     * @param attributeName 検証する属性名
     * @param value 期待する属性の値。値がないこと(属性が存在しないこと)を検証する場合は `null` を渡す。
     */
    async expectPreviewElementAttribute({ selector, attributeName, value }: { selector: string; attributeName: string; value: string | null }): Promise<void> {
        const element = this.getPreviewElement(selector);
        if (value === null) {
            await expect(element).not.toHaveAttribute(attributeName, /.*/);
        } else {
            await expect(element).toHaveAttribute(attributeName, value);
        }
    }

    /**
     * プロパティ入力欄の行がハイライトされているか（特定の背景色か）を検証します。
     * @param propertyInputLocator 検証対象のプロパティ入力欄のLocator
     * @param expectedColor 期待する背景色 (例: 'rgba(0, 112, 255, 0.11)')。色がついていないことを期待する場合は null を渡す。
     */
    async expectPropertyHighlight(propertyInputLocator: Locator, expectedColor: string | null): Promise<void> {
        const backgroundColor = await propertyInputLocator.evaluate(el => {
            const root = el.getRootNode();
            if (!(root instanceof ShadowRoot)) return null;
            const hostElement = root.host;
            const editorRow = hostElement.closest('.editor-row');
            return editorRow ? window.getComputedStyle(editorRow).backgroundColor : null;
        });

        if (expectedColor) {
            expect(backgroundColor).toBe(expectedColor);
        } else {
            expect(backgroundColor).toBe('rgba(0, 0, 0, 0)');
        }
    }

    /**
     * 動作モードに切り替え、必要に応じてアラートを検証します。
     * @param options オプション
     * @param options.expectedAlertText 検証したいアラートのテキスト（指定しない場合はアラート検証をスキップ）
     */
    async switchToRunModeAndVerify(options: { expectedAlertText?: string } = {}): Promise<void> {
        const platformSwitcher = this.page.locator('platform-switcher');
        await platformSwitcher.locator('.screen-rotete-container').click();
        const menu = platformSwitcher.locator('#platformEditMenu');
        await expect(menu).toBeVisible();

        await menu.getByText('動作').click();
        await platformSwitcher.locator('.screen-rotete-container').click();
        await expect(menu).toBeHidden();

        if (options.expectedAlertText) {
            const previewFrame = this.getPreviewFrame();
            const alertDialog = previewFrame.locator('ons-alert-dialog');
            await expect(alertDialog).toBeVisible();
            await expect(alertDialog).toContainText(options.expectedAlertText);
            const alertDialogButton = alertDialog.locator('ons-alert-dialog-button');
            await alertDialogButton.click();
            await expect(alertDialog).toBeHidden();
        }
    }

    /**
     * エディタの内容を保存し、QRコードから実機テストページを新しいタブで開きます。
     * @returns 開かれた実機テストページのPageオブジェクト
     */
    async saveAndOpenTestPage(): Promise<Page> {
        const menuButton = this.page.locator('#fab-bottom-menu-box');
        await expect(menuButton).toBeVisible();
        await expect(menuButton).toBeEnabled();
        await menuButton.click();

        const platformBottomMenu = this.page.locator('#platformBottomMenu');
        await expect(platformBottomMenu).toBeVisible();

        await platformBottomMenu.getByText('保存', { exact: true }).click();
        await this.page.waitForTimeout(500);

        await menuButton.click();
        await expect(platformBottomMenu).toBeVisible();

        const testPagePromise = this.page.context().waitForEvent('page');
        await this.page.locator('#qrcode').click();
        const testPage = await testPagePromise;

        return testPage;
    }

    /**
     * DOMツリー内で、特定のデータ属性を持つノードを選択します。
     * @param attributeName 'data-node-id' や 'data-node-type' などの属性名
     * @param attributeValue 属性の値
     * @returns 選択されたノードのLocator
     */
    async selectNodeByAttribute(attributeName: string, attributeValue: string): Promise<Locator> {
        const domTree = this.getDomTree();
        const node = domTree.locator(`div[${attributeName}="${attributeValue}"]`);
        await this.selectNodeInDomTree(node);
        return node;
    }

    /**
     * DOMツリーで選択中のコンテキスト（トップレベルテンプレート）を切り替えます。
     * @param templateId 'アプリケーション' またはページのdata-template-id
     */
    async switchTopLevelTemplate(templateId: string): Promise<void> {
        await this.openMoveingHandle('left');
        const topContainer = this.page.locator('.top-container');
        await topContainer.click();
        const topTemplateListContainer = topContainer.locator('#top-template-list');
        await expect(topTemplateListContainer).toBeVisible();

        const targetToplistItem = topTemplateListContainer.locator(`div.top-template-item[data-template-id="${templateId}"]`);
        await expect(targetToplistItem).toBeVisible();
        await expect(targetToplistItem).toBeEnabled();
        await targetToplistItem.click();
        await expect(topTemplateListContainer).toBeHidden();
    }

    /**
     * 指定したイベントに、新しいスクリプトを特定の名前で追加します。
     * @param eventName イベント名 (例: 'DOMContentLoaded', 'click')
     * @param scriptName 作成するスクリプト名 (例: 'sample001')
     */
    async addScriptToEvent(
        { eventName, scriptName }: { eventName: string; scriptName: string }
    ): Promise<void> {
        const scriptContainer = this.page.locator('script-container');
        await expect(scriptContainer).toBeVisible();

        const eventRow = scriptContainer.locator(`div.editor-row:has(div.label:text-is("${eventName}"))`);
        await expect(eventRow).toBeVisible();

        await eventRow.getByTitle('スクリプトの追加').click();

        const scriptAddMenu = this.page.locator('event-container #scriptAddMenu');
        await expect(scriptAddMenu).toBeVisible();

        await scriptAddMenu.locator('#script-name').fill(scriptName);
        await expect(scriptAddMenu).toBeVisible();
        await expect(scriptAddMenu).toBeEnabled();
        await scriptAddMenu.locator('#edit-add-script').click();
        await expect(scriptAddMenu).toBeHidden();

        await expect(eventRow.getByText(scriptName)).toBeVisible();
    }

    /**
     * イベントに関連付けられたスクリプトを編集し、保存します。
     * @param eventName イベント名
     * @param scriptName 編集するスクリプト名
     * @param scriptContent 新しいスクリプトのコード内容
     */
    async editScript(
        { eventName, scriptName, scriptContent }: { eventName: string; scriptName: string; scriptContent: string }
    ): Promise<void> {
        await this.openMoveingHandle('right');
        const scriptContainer = this.page.locator('script-container');
        await expect(scriptContainer).toBeVisible();
        const eventContainer = scriptContainer.locator('event-container');
        await expect(eventContainer).toBeVisible();

        const eventRow = eventContainer.locator(`div.editor-row:has(div.label:text-is("${eventName}"))`);
        await expect(eventRow).toBeVisible();

        const scriptRow = eventRow.locator(`div.editor-row-right-item`).filter({ hasText: scriptName });
        await expect(scriptRow).toBeVisible();
        await scriptRow.getByTitle('スクリプトの編集').click();

        const monacoEditor = scriptContainer.locator('.monaco-editor[role="code"]');
        await expect(monacoEditor).toBeVisible();

        const viewLines = monacoEditor.locator('.view-lines');
        await expect(viewLines).toBeVisible();
        const firstLine = viewLines.locator('.view-line').first();
        await firstLine.click();
        await this.page.keyboard.press('ControlOrMeta+A');
        await this.page.keyboard.press('Delete');

        const browserName = this.page.context().browser()?.browserType().name();

        if (browserName === 'chromium' || browserName === 'webkit') {
            await monacoEditor.locator('textarea').fill(scriptContent);
        } else if (browserName === 'firefox') {
            const viewLine = monacoEditor.locator('.view-line').first();
            await expect(viewLine).toBeVisible();
            await viewLine.pressSequentially(scriptContent);
        } else {
            console.warn(`Unsupported browser for optimized fill: ${browserName}. Falling back to pressSequentially.`);
            const viewLine = monacoEditor.locator('.view-line').first();
            await expect(viewLine).toBeVisible();
            await viewLine.pressSequentially(scriptContent);
        }

        const saveButton = scriptContainer.getByTitle('スクリプトの保存');
        const saveIcon = saveButton.locator('i');
        await expect(saveIcon).toHaveAttribute("class", "fa-solid fa-floppy-disk shake-save-button");
        await saveButton.click();
        await expect(saveIcon).toHaveAttribute("class", "fa-solid fa-floppy-disk");
    }

    /**
     * プレビュー（Renderzone）内の<script>タグを調べ、期待するコードが含まれているか検証します。
     * @param expectedContent 期待するスクリプト文字列
     */
    async verifyScriptInPreview(expectedContent: string): Promise<void> {
        const previewFrame = this.getPreviewFrame();
        await previewFrame.locator('body').waitFor({ state: 'visible' });
        const scripts = previewFrame.locator('script');
        const allScriptsContent = await scripts.allTextContents();
        const combinedText = allScriptsContent.join('\n');

        const normalizedReceived = normalizeWhitespace(combinedText);
        const normalizedExpected = normalizeWhitespace(expectedContent);
        expect(normalizedReceived).toContain(normalizedExpected);
    }

    /**
     * 指定したノードの特定のイベントに、新しいスクリプトを追加します。
     * @param nodeLocator イベントを追加する対象のノード (例: ページノード)
     * @param eventName イベント名 (例: 'init', 'show')
     * @param scriptName 作成するスクリプト名
     */
    async addScriptToNodeEvent(
        { nodeLocator, eventName, scriptName }: { nodeLocator: Locator, eventName: string, scriptName: string }
    ): Promise<void> {
        await this.openMoveingHandle("left");
        await this.selectNodeInDomTree(nodeLocator);

        const scriptContainer = this.page.locator('script-container');
        await this.openMoveingHandle("right");
        await this.switchTabInContainer(scriptContainer, 'イベント');

        await this.addScriptToEvent({ eventName, scriptName });
    }

    /**
     * ページまたはプレビューフレーム内で、特定の順番でアラートが表示され、
     * それぞれを閉じることを安定的に検証します。
     * @param pageOrFrame PageオブジェクトまたはFrameLocatorオブジェクト
     * @param expectedText 期待するアラートのテキスト
     */
    async verifyAndCloseAlert(
        pageOrFrame: Page | FrameLocator,
        expectedText: string
    ): Promise<void> {
        const alertDialog = pageOrFrame.locator('ons-alert-dialog').filter({ hasText: expectedText });
        await expect(alertDialog).toBeVisible({ timeout: 10000 });
        await expect(alertDialog).toContainText(expectedText);

        const alertButton = alertDialog.locator('ons-alert-dialog-button');
        await expect(alertButton).toBeVisible();
        await expect(alertButton).toBeEnabled();
        await alertButton.click();

        await expect(async () => {
            await expect(alertDialog).toBeHidden();
        }).toPass();
    }

    /**
     * 新しいスクリプトを追加します。
     * @param scriptName - 追加するスクリプトの名前
     * @param scriptType - 'function' または 'class'
     */
    async addNewScript(scriptName: string, scriptType: 'function' | 'class' = 'function'): Promise<void> {
        const scriptContainer = this.page.locator('script-container');
        const scriptListContainer = scriptContainer.locator('#script-list-container');
        const scriptAddButton = scriptListContainer.getByTitle("スクリプトの追加");
        await scriptAddButton.click();

        const addMenu = scriptListContainer.locator('#scriptAddMenu');
        await expect(addMenu).toBeVisible();
        await addMenu.locator(`input[type="radio"][value="${scriptType}"]`).check();
        await addMenu.locator('input#script-name').fill(scriptName);
        await addMenu.locator('button:has-text("追加")').click();
        await expect(addMenu).toBeHidden();
        await expect(scriptContainer.locator(`.editor-row-left:has-text("${scriptName}")`)).toBeVisible();
    }

    /**
     * 既存のスクリプトの内容を書き換えます。
     * @param scriptName - 編集するスクリプトの名前
     * @param scriptContent - 新しいスクリプトのコード内容
     */
    async editScriptContent(scriptName: string, scriptContent: string): Promise<void> {
        const scriptContainer = this.page.locator('script-container');
        const scriptRow = scriptContainer.locator('.editor-row', { hasText: scriptName });
        await scriptRow.getByTitle('スクリプトの編集').click();

        const editorContainer = scriptContainer.locator('#script-container');
        await expect(editorContainer).toBeVisible();
        const monacoEditor = editorContainer.locator('.monaco-editor[role="code"]');
        await expect(monacoEditor).toBeVisible();

        await monacoEditor.locator('.view-lines').click();
        await this.page.keyboard.press('ControlOrMeta+A');
        await this.page.keyboard.press('Delete');

        const browserName = this.page.context().browser()?.browserType().name();
        if (browserName === 'chromium' || browserName === 'webkit') {
            await monacoEditor.locator('textarea').fill(scriptContent);
        } else if (browserName === 'firefox') {
            const viewLine = monacoEditor.locator('.view-line').first();
            await expect(viewLine).toBeVisible();
            await viewLine.pressSequentially(scriptContent);
            await viewLine.press('Shift+Control+End');
            await viewLine.press('Delete');
        } else {
            console.warn(`Unsupported browser for optimized fill: ${browserName}. Falling back to pressSequentially.`);
            const viewLine = monacoEditor.locator('.view-line').first();
            await expect(viewLine).toBeVisible();
            await viewLine.pressSequentially(scriptContent);
            await viewLine.press('Shift+Control+End');
            await viewLine.press('Delete');
        }

        await scriptContainer.locator('#fab-save').click();
    }

    /**
     * イベントパネルで新しいカスタムイベント定義を追加します。
     * @param listenerTarget イベント登録先 (例: 'element', 'document')
     * @param eventName イベント名 (例: 'test-event')
     * @param comment イベントのコメント
     */
    async addCustomEventDefinition(
        { listenerTarget, eventName, comment }: { listenerTarget: string, eventName: string, comment: string }
    ): Promise<void> {
        // 右側のサブウィンドウを表示し、イベントタブに切り替える
        await this.openMoveingHandle('right');
        const scriptContainer = this.page.locator('script-container');
        await expect(scriptContainer).toBeVisible();
        await this.switchTabInContainer(scriptContainer, 'イベント');
        const eventContainer = scriptContainer.locator('event-container');
        await expect(eventContainer).toBeVisible();

        // 「イベントを編集」ボタンをクリック
        await eventContainer.locator('button#fab-edit[title="イベントを編集"]').click();

        // イベントリストポップアップが表示されるのを待つ
        const eventListPopup = eventContainer.locator('#eventList');
        await expect(eventListPopup).toBeVisible();

        // 「追加」ボタンをクリック
        await eventListPopup.getByRole('button', { name: '追加' }).click();

        // イベント追加ポップアップが表示されるのを待つ
        const eventAddPopup = eventContainer.locator('#eventEditMenu');
        await expect(eventAddPopup).toBeVisible();

        // 各項目を入力
        await eventAddPopup.locator('input#event-target').fill(listenerTarget);
        await eventAddPopup.locator('input#event-name').fill(eventName);
        await eventAddPopup.locator('input#comment-value').fill(comment);

        // 「追加」ボタンをクリックしてイベントを登録
        await eventAddPopup.getByRole('button', { name: '追加' }).click();

        // ポップアップが閉じるのを待つ
        await expect(eventAddPopup).toBeHidden();
        await expect(eventListPopup).toBeHidden();

        // イベントがリストに追加されたことを確認
        const newEventRow = eventContainer.locator(`.editor-row:has-text("${eventName}")`);
        await expect(newEventRow).toBeVisible();
        await expect(newEventRow.locator('.comment')).toHaveText(comment);
    }

    /**
     * サービスワーカーパネルで新しいカスタムイベント定義を追加します。
     * @param eventName イベント名 (例: 'new-sw-event')
     * @param comment イベントのコメント
     */
    async addCustomServiceWorkerEventDefinition(
        { eventName, comment }: { eventName: string; comment: string }
    ): Promise<void> {
        // 右側のサブウィンドウを表示し、サービスワーカータブに切り替える
        await this.openMoveingHandle('right');
        const scriptContainer = this.page.locator('script-container');
        await expect(scriptContainer).toBeVisible();
        await this.switchTabInContainer(scriptContainer, 'サービスワーカー');
        const serviceWorkerContainer = scriptContainer.locator('serviceworker-container');
        await expect(serviceWorkerContainer).toBeVisible();

        // 「イベントを編集」ボタンをクリック
        await serviceWorkerContainer.locator('button#fab-edit[title="イベントを編集"]').click();

        // イベントリストポップアップが表示されるのを待つ
        const eventListPopup = serviceWorkerContainer.locator('#eventList');
        await expect(eventListPopup).toBeVisible();

        // 「追加」ボタンをクリック
        await eventListPopup.getByRole('button', { name: '追加' }).click();

        // イベント追加ポップアップが表示されるのを待つ
        const eventAddPopup = serviceWorkerContainer.locator('#eventEditMenu');
        await expect(eventAddPopup).toBeVisible();

        // 各項目を入力 (イベント登録先はサービスワーカータブにはない)
        await eventAddPopup.locator('input#event-name').fill(eventName);
        await eventAddPopup.locator('input#comment-value').fill(comment);

        // 「追加」ボタンをクリックしてイベントを登録
        await eventAddPopup.getByRole('button', { name: '追加' }).click();

        // ポップアップが閉じるのを待つ
        await expect(eventAddPopup).toBeHidden();
        await expect(eventListPopup).toBeHidden();

        // イベントがリストに追加されたことを確認
        const newEventRow = serviceWorkerContainer.locator(`.editor-row:has-text("${eventName}")`);
        await expect(newEventRow).toBeVisible();
        await expect(newEventRow.locator('.comment')).toHaveText(comment);
    }

    /**
     * 既存のスクリプトの内容を書き換えますが、保存はしません。
     * Monaco Editorにフォーカスがある状態になります。
     * @param scriptName - 編集するスクリプトの名前
     * @param scriptContent - 新しいスクリプトのコード内容
     */
    async fillScriptContent(scriptName: string, scriptContent: string): Promise<void> {
        const scriptContainer = this.page.locator('script-container');
        const scriptRow = scriptContainer.locator('.editor-row', { hasText: scriptName });
        await scriptRow.getByTitle('スクリプトの編集').click();

        const editorContainer = scriptContainer.locator('#script-container');
        await expect(editorContainer).toBeVisible();
        const monacoEditor = editorContainer.locator('.monaco-editor[role="code"]');
        await expect(monacoEditor).toBeVisible();

        await monacoEditor.locator('.view-lines').click();
        await this.page.keyboard.press('ControlOrMeta+A');
        await this.page.keyboard.press('Delete');

        const browserName = this.page.context().browser()?.browserType().name();
        if (browserName === 'chromium' || browserName === 'webkit') {
            await monacoEditor.locator('textarea').fill(scriptContent);
        } else if (browserName === 'firefox') {
            const viewLine = monacoEditor.locator('.view-line').first();
            await expect(viewLine).toBeVisible();
            await viewLine.pressSequentially(scriptContent);
        } else {
            console.warn(`Unsupported browser for optimized fill: ${browserName}. Falling back to pressSequentially.`);
            const viewLine = monacoEditor.locator('.view-line').first();
            await expect(viewLine).toBeVisible();
            await viewLine.pressSequentially(scriptContent);
        }
    }

    /**
     * Monaco Editorの現在のテキストコンテンツを取得します。
     * @returns エディタの現在のテキスト
     */
    async getMonacoEditorContent(): Promise<string> {
        // スクリプトコンテナ内のエディタに絞り込む
        const scriptContainer = this.page.locator('script-container');
        const monacoEditor = scriptContainer.locator('.monaco-editor[role="code"]');

        // Monaco Editor の内部にある入力用のtextareaは常に存在し、
        // ユーザーには見えないが値は持っている。これを直接ターゲットにする。
        // これにより、エディタ全体の表示状態に依存せず値を取得できる。
        const textArea = monacoEditor.locator('textarea.inputarea');

        // textAreaがDOMに存在することを確認する
        await expect(textArea).toBeAttached();

        // 隠されたtextareaから直接値を取得する
        return await textArea.inputValue();
    }

    /**
     * スクリプト一覧から指定された名前のスクリプトを探し、編集画面を開きます。
     * @param scriptName 編集したいスクリプトの名前
     */
    async openScriptForEditing(scriptName: string): Promise<void> {
        const scriptContainer = this.page.locator('script-container');
        // 指定された名前を持つスクリプトの行を探す
        const scriptRow = scriptContainer.locator('.editor-row', { hasText: scriptName });
        await expect(scriptRow).toBeVisible();

        // その行にある「編集」ボタンをクリックする
        await scriptRow.getByTitle('スクリプトの編集').click();

        // 編集画面（Monaco Editor）が表示されたことを確認する
        await expect(scriptContainer.locator('.monaco-editor[role="code"]')).toBeVisible();
    }

    /**
     * スクリプト編集画面でAIコーディングウィンドウを開きます。
     * このメソッドはスクリプト編集画面が開かれていることを前提とします。
     */
    async openAiCodingWindow(): Promise<void> {
        // 1. Shadow DOMのホスト要素である <script-container> をまず特定する
        const scriptContainer = this.page.locator('script-container');

        // 2. ホスト要素からチェインして、そのShadow DOM内部のボタンを探す
        const aiButton = scriptContainer.locator('button#aiButton');

        await expect(aiButton).toBeVisible();
        await aiButton.click();

        const aiWindow = this.page.locator('ai-coder-window');
        await expect(aiWindow).toBeVisible();
    }

    /**
     * AIコーディング機能を使ってコードを生成し、エディタの内容を置き換えます。
     * @param prompt AIに送信するプロンプト文字列
     * @param options AIモデルなどのオプション
     */
    async generateCodeWithAi(prompt: string, options: { model?: string } = {}): Promise<void> {
        // 1. AIコーディングウィンドウを開く
        await this.openAiCodingWindow();
        const aiWindow = this.page.locator('ai-coder-window');

        // 2. (オプション) 設定でモデルを変更する
        if (options.model) {
            await aiWindow.locator('button#setting-btn').click();
            const settingsWindow = aiWindow.locator('div#setting-window');
            await expect(settingsWindow).toBeVisible();
            await settingsWindow.locator('select').selectOption({ value: options.model });
            await settingsWindow.locator('button#close-btn').click();
            await expect(settingsWindow).toBeHidden();
        }

        // 3. プロンプトを入力して送信し、応答を待つ
        await aiWindow.locator('textarea#user-input').fill(prompt);
        await aiWindow.locator('button#send-btn').click();

        // 「生成中」の表示を待つ
        const pendingMessage = aiWindow.locator('.message-content.pending');
        await expect(pendingMessage).toBeVisible({ timeout: 5000 });

        // 応答が完了するのを待つ (AIの応答は時間がかかるためタイムアウトを長く設定)
        await expect(pendingMessage).toBeHidden({ timeout: 120000 });

        // 4. 最新の応答メッセージを取得し、「置き換え」ボタンをクリック
        const lastBotMessage = aiWindow.locator('.message.bot').last();
        await expect(lastBotMessage).toBeVisible();
        await lastBotMessage.getByRole('button', { name: '置き換え' }).click();

        // 5. AIコーディングウィンドウが閉じるのを待つ
        await expect(aiWindow).toBeHidden();
    }
}

/**
 * 実機テストページを開き、その中の main.js の内容を検証します。
 * この関数は `testPage` を受け取るため、EditorHelper クラスの外部に定義します。
 * @param testPage 実機テストページのPageオブジェクト
 * @param expectedContents 期待するスクリプト文字列、またはその配列
 */
export async function verifyScriptInTestPage(testPage: Page, expectedContents: string | string[]): Promise<void> {
    await testPage.waitForLoadState('domcontentloaded');

    const mainJsContent = await testPage.evaluate(async () => {
        const scriptElement = document.querySelector<HTMLScriptElement>('script[src*="main.js"]');
        if (!scriptElement) return null;
        const response = await fetch(scriptElement.src);
        return response.ok ? response.text() : null;
    });

    expect(mainJsContent, '実機テストページのmain.jsが見つからないか、取得に失敗しました。').not.toBeNull();

    const normalizedReceived = normalizeWhitespace(mainJsContent || '');
    if (Array.isArray(expectedContents)) {
        for (const content of expectedContents) {
            const normalizedExpected = normalizeWhitespace(content);
            expect(normalizedReceived).toContain(normalizedExpected);
        }
    } else {
        const normalizedExpected = normalizeWhitespace(expectedContents);
        expect(normalizedReceived).toContain(normalizedExpected);
    }
}

/**
 * 文字列から改行を削除し、連続する空白を1つのスペースに変換します。
 * @param str 対象の文字列
 * @returns 正規化された文字列
 */
export const normalizeWhitespace = (str: string): string => {
    return str.replace(/\s+/g, ' ').trim();
};