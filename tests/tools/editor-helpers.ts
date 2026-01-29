import { test, expect, type Page, type Locator, FrameLocator } from '@playwright/test';

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
     * エディタ起動時に表示される可能性のある「スナップショット復元ダイアログ」を処理します。
     * リスナーを事前に登録することで、ブラウザ標準ダイアログのハンドリングを安定させます。
     */
    async handleSnapshotRestoreDialog(): Promise<void> {
        // 1. どんなダイアログが出ても自動でOKを押すリスナーを登録
        const dialogHandler = async (dialog: any) => {
            console.log(`[Auto Dialog Handler] Accepted: ${dialog.message()}`);
            await dialog.accept().catch(() => { });
        };
        this.page.on('dialog', dialogHandler);

        try {
            await test.step('スナップショット復元ダイアログのチェックとクリーンアップ', async () => {
                // ローディングオーバーレイが完全に消えるのを待つ
                const loadingOverlay = this.page.locator('app-container-loading-overlay');
                await expect(loadingOverlay).toBeHidden({ timeout: 30000 });

                const snapshotConfirmDialog = this.page.locator('message-box', {
                    hasText: '前回正常に終了されなかった可能性'
                });

                // ダイアログが表示されるか確認
                if (await snapshotConfirmDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
                    // --- 1. 最初のダイアログ: 「破棄する」をクリック ---
                    await snapshotConfirmDialog.getByRole('button', { name: '破棄する' }).click();

                    // --- 2. 再確認ダイアログが表示されるのを待つ ---
                    const discardConfirmDialog = this.page.locator('message-box', {
                        hasText: 'すべてのスナップショットを破棄しますか？'
                    });
                    await expect(discardConfirmDialog).toBeVisible({ timeout: 5000 });

                    // --- 3. 「はい、破棄します」をクリック ---
                    // これにより、アプリ側で alert() が実行されるが、冒頭のリスナーが自動で閉じる
                    await discardConfirmDialog.getByRole('button', { name: 'はい、破棄します' }).click();

                    // 4. すべてのモーダルが消え去るのを待つ
                    await expect(snapshotConfirmDialog).toBeHidden();
                    await expect(discardConfirmDialog).toBeHidden();

                    // 処理後の安定化待ち
                    await this.page.waitForTimeout(500);
                }
            });
        } finally {
            // 他のテストに影響を与えないよう、リスナーを解除
            this.page.off('dialog', dialogHandler);
        }
    }

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
     * ツールボックスからコンポーネントをDOMツリーの指定場所にドラッグ＆ドロップします。
     * (オーバーロード)
     * @param componentName Toolboxに表示されているコンポーネント名
     * @param targetSelector D&Dのドロップ先となる要素の「セレクタ文字列」
     */
    async addComponent(componentName: string, targetSelector: string): Promise<Locator>;
    /**
     * ツールボックスからコンポーネントをDOMツリーの指定場所にドラッグ＆ドロップします。
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
        const newComponentNode = targetLocator.locator(`> .node[data-node-type="${componentName}"]`).first();
        await expect(newComponentNode).toBeVisible({ timeout: 10000 });
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
        // 左ハンドルをオープン
        await this.openMoveingHandle('left');

        await nodeLocator.click({ position: { x: 0, y: 10 } });
        await expect(nodeLocator).toHaveClass(/node-select/);
    }

    /**
     * 高精度なドラッグ＆ドロップを行います。
     * 標準のdragToでは速度が速すぎてアプリ側の並び替えイベントが発火しない場合に有効です。
     * マウスの動きをステップ分けしてシミュレートします。
     * 
     * @param sourceLocator ドラッグ開始要素
     * @param targetLocator ドロップ対象要素
     * @param steps 移動にかけるステップ数（多いほどゆっくり移動し、イベントが発火しやすくなる）
     */
    async dragAndDropManually(sourceLocator: Locator, targetLocator: Locator, steps: number = 20): Promise<void> {
        const sourceBox = await sourceLocator.boundingBox();
        const targetBox = await targetLocator.boundingBox();
        if (!sourceBox || !targetBox) {
            throw new Error('dragAndDropManually: 要素のBoundingBoxが取得できませんでした');
        }

        // 要素の中心座標を計算
        const srcX = sourceBox.x + sourceBox.width / 2;
        const srcY = sourceBox.y + sourceBox.height / 2;
        const dstX = targetBox.x + targetBox.width / 2;
        const dstY = targetBox.y + targetBox.height / 2;

        // マウス操作のシミュレーション
        await this.page.mouse.move(srcX, srcY);
        await this.page.mouse.down();
        // stepsを指定することで、時間をかけて移動させ dragover を確実に発火させる
        await this.page.mouse.move(dstX, dstY, { steps: steps });
        await this.page.mouse.up();

        // DOMの更新を少し待つ
        await this.page.waitForTimeout(500);
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
        return this.page.locator('#ios-container #renderzone').contentFrame();
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
        const propertyContainer = this.page.locator('property-container');
        // ホスト要素（attribute-input等）を特定。内部のinputとの重複を避けるため.first()を適用
        return propertyContainer.locator(`[data-attribute-type="${attributeNameOrTagName}"], ${attributeNameOrTagName}`).first();
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

        if (await templateContainer.isVisible()) {
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
        const platformBottomMenu = this.page.locator('#platformBottomMenu');
        const alert = this.page.locator('alert-component'); // アラートを定義

        await expect(menuButton).toBeVisible();
        await expect(menuButton).toBeEnabled();
        await menuButton.click();
        await expect(platformBottomMenu).toBeVisible();

        // 保存をクリック
        await platformBottomMenu.getByText('保存', { exact: true }).click();

        // 処理中が消えるのを待つ
        await this.page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });

        // 保存成功のアラートが出ていたら閉じる ---
        // これをしないと、この後の menuButton.click() がアラートに遮られて失敗します
        if (await alert.isVisible({ timeout: 5000 }).catch(() => false)) {
            await alert.getByRole('button', { name: '閉じる' }).click();
            await expect(alert).toBeHidden();
        }

        // 保存後にメニューが閉じていたら再度開く
        if (!await platformBottomMenu.isVisible()) {
            await menuButton.click();
            await expect(platformBottomMenu).toBeVisible();
        }

        const testPagePromise = this.page.context().waitForEvent('page');
        // QRコードをクリック（これもアラートがあると遮られます）
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

        const browserName = this.page.context().browser()?.browserType().name();

        // APIを使用して値を設定（補完干渉回避のため優先）
        const apiResult = await this.setMonacoValue(monacoEditor, scriptContent);

        // Safari(WebKit)用のデバッグと再試行
        if (browserName === 'webkit') {
            if (!apiResult.success || apiResult.actual.trim() !== scriptContent.trim()) {
                console.warn(`[Safari Debug] API setValue mismatch. Expected starting with: ${scriptContent.substring(0, 50)}... Actual starting with: ${apiResult.actual.substring(0, 50)}...`);

                const textarea = monacoEditor.locator('textarea.inputarea');
                await textarea.focus();
                await this.page.keyboard.press('Escape');

                // 物理的な削除の徹底 (Meta+A -> Backspace)
                await textarea.press('Meta+a');
                await textarea.press('Backspace');
                await this.page.waitForTimeout(300);

                // Safariでは自動補完を避けるため一括のfillを使用
                await textarea.fill(scriptContent);

                const finalCheck = await this.getMonacoEditorContent();
                if (finalCheck.trim() !== scriptContent.trim()) {
                    console.error(`[Safari Debug] Final check failed after fallback fill.
                    Actual content: ${finalCheck}`);
                }
            }
        } else if (!apiResult.success) {
            // APIが失敗した他ブラウザのフォールバック
            const textarea = monacoEditor.locator('textarea.inputarea');
            await monacoEditor.locator('.view-lines').click();
            await textarea.focus();
            await textarea.press('Control+A');
            await textarea.press('Delete');
            await textarea.pressSequentially(scriptContent, { delay: 10 });
        }

        const saveButton = scriptContainer.getByTitle('スクリプトの保存');
        const saveIcon = saveButton.locator('i');

        // 保存前に「変更あり」のクラス（shake-save-button）が付くのを待つ
        await expect(saveIcon).toHaveClass(/shake-save-button/);
        await saveButton.click();

        // 保存完了の判定
        const alert = this.page.locator('alert-component');
        // 保存に成功してアラートが出たら閉じる
        if (await alert.isVisible({ timeout: 8000 }).catch(() => false)) {
            // もしエラー内容（「修正してください」など）が含まれていたらテストを落とす
            const msg = await alert.textContent();
            if (msg?.includes('エラー') || msg?.includes('修正')) {
                throw new Error(`スクリプト保存エラー: ${msg}`);
            }
            await alert.getByRole('button', { name: '閉じる' }).click();
            await expect(alert).toBeHidden();
        }

        // アイコンが通常状態に戻るのを待つ
        await expect(saveIcon).not.toHaveClass(/shake-save-button/);
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
        await addMenu.getByRole('button', { name: '追加' }).click();
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

        const browserName = this.page.context().browser()?.browserType().name();

        // APIを使用して値を設定（優先実行）
        const apiResult = await this.setMonacoValue(monacoEditor, scriptContent);

        if (browserName === 'webkit') {
            if (!apiResult.success || apiResult.actual.trim() !== scriptContent.trim()) {
                console.warn(`[Safari Debug] editScriptContent API mismatch. Actual starting with: ${apiResult.actual.substring(0, 50)}...`);

                const textarea = monacoEditor.locator('textarea.inputarea');
                await textarea.focus();
                await this.page.keyboard.press('Escape');

                // 全選択して削除 (Mac対応)
                await textarea.press('Meta+a');
                await textarea.press('Backspace');
                await this.page.waitForTimeout(300);

                // Safari(WebKit)の場合は補完干渉を防ぐためfillを使用
                await textarea.fill(scriptContent);
            }
        } else if (!apiResult.success) {
            const textarea = monacoEditor.locator('textarea.inputarea');
            await monacoEditor.locator('.view-lines').click();
            await textarea.focus();
            await this.page.keyboard.press('Escape');

            await textarea.press('Control+A');
            await textarea.press('Delete');

            if (browserName === 'chromium') {
                await textarea.fill(scriptContent);
            } else {
                await textarea.pressSequentially(scriptContent, { delay: 10 });
            }
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

        const browserName = this.page.context().browser()?.browserType().name();

        // APIを使用して値を設定（優先実行）
        const apiResult = await this.setMonacoValue(monacoEditor, scriptContent);

        if (browserName === 'webkit') {
            if (!apiResult.success || apiResult.actual.trim() !== scriptContent.trim()) {
                console.warn(`[Safari Debug] fillScriptContent API mismatch. Actual starting with: ${apiResult.actual.substring(0, 50)}...`);

                const textarea = monacoEditor.locator('textarea.inputarea');
                await textarea.focus();
                await this.page.keyboard.press('Escape');

                // 全選択して削除 (Mac対応)
                await textarea.press('Meta+a');
                await textarea.press('Backspace');
                await this.page.waitForTimeout(300);

                // 入力
                await textarea.fill(scriptContent);
            }
        } else if (!apiResult.success) {
            const textarea = monacoEditor.locator('textarea.inputarea');
            await monacoEditor.locator('.view-lines').click();
            await textarea.focus();
            await this.page.keyboard.press('Escape');

            await textarea.press('Control+A');
            await textarea.press('Delete');

            if (browserName === 'webkit' || browserName === 'chromium') {
                await textarea.fill(scriptContent);
            } else {
                await textarea.pressSequentially(scriptContent, { delay: 10 });
            }
        }
    }

    /**
     * Monaco Editorの現在のテキストコンテンツを取得します。
     * モバイル/デスクトップ問わず、Monacoの内部Modelから直接値を取得します。
     * @returns エディタの現在のテキスト
     */
    async getMonacoEditorContent(): Promise<string> {
        const scriptContainer = this.page.locator('script-container');
        const monacoEditor = scriptContainer.locator('.monaco-editor[role="code"]');

        // エディタが表示されるのを待つ
        await expect(monacoEditor).toBeVisible();

        // 方法1: Monaco EditorのAPIを叩いて、Modelから直接値を取得する（推奨）
        // HTML属性からURIを取得し、それに対応するModelを探します
        const uri = await monacoEditor.getAttribute('data-uri');

        const contentFromApi = await this.page.evaluate((targetUri) => {
            // @ts-ignore
            const monaco = window.monaco;
            if (monaco && monaco.editor) {
                const models = monaco.editor.getModels();

                // data-uri属性がある場合は特定する
                if (targetUri) {
                    const model = models.find((m: any) => m.uri.toString() === targetUri);
                    if (model) return model.getValue();
                }

                // URIで特定できない、または見つからない場合は、
                // 現在フォーカスがある、または最初のモデルを返す
                if (models.length > 0) {
                    return models[0].getValue();
                }
            }
            return null;
        }, uri);

        if (contentFromApi !== null) {
            return contentFromApi;
        }

        // 方法2: APIが使えない場合のフォールバック（モバイル向け）
        // .view-lines の見た目のテキストを取得する
        // 注意: ファイルが非常に長い場合、仮想化により画面外の行が取得できない可能性があります
        const viewLines = monacoEditor.locator('.view-lines');
        if (await viewLines.isVisible()) {
            return await viewLines.innerText();
        }

        // 方法3: 最後の手段として textarea を確認（デスクトップ向け）
        const textArea = monacoEditor.locator('textarea.inputarea');
        return await textArea.inputValue();
    }

    /**
     * Monaco Editorの値をAPI経由で設定し、設定後の値を返します。
     * @param editorLocator エディタのLocator
     * @param value 設定する値
     * @returns { success: boolean, actual: string } 
     */
    async setMonacoValue(editorLocator: Locator, value: string): Promise<{ success: boolean; actual: string }> {
        try {
            const uri = await editorLocator.getAttribute('data-uri');
            return await this.page.evaluate(({ uri, value }) => {
                // @ts-ignore
                const monaco = window.monaco;
                if (!monaco || !monaco.editor) return { success: false, actual: '' };

                const models = monaco.editor.getModels();
                let model;
                if (uri) {
                    model = models.find((m: any) => m.uri.toString() === uri);
                }

                // URIで特定できない、または見つからない場合は最初のモデルを対象とする
                if (!model && models.length > 0) {
                    model = models[0];
                }

                if (model) {
                    model.setValue(value);
                    return { success: true, actual: model.getValue() };
                }
                return { success: false, actual: '' };
            }, { uri, value });
        } catch (e) {
            return { success: false, actual: '' };
        }
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

            // モデル選択 (modern-selectクラス)
            await settingsWindow.locator('select.modern-select').selectOption({ value: options.model });

            // 「設定を適用して戻る」ボタン
            await settingsWindow.locator('button#close-btn').click();
            await expect(settingsWindow).toBeHidden();
        }

        // 3. プロンプトを入力して送信し、応答を待つ
        const inputArea = aiWindow.locator('textarea#user-input');
        await inputArea.fill(prompt);
        await aiWindow.locator('button#send-btn').click();

        // 「生成中」の表示を待つ
        const pendingMessage = aiWindow.getByText('コード生成中');
        await expect(pendingMessage).toBeVisible({ timeout: 10000 });

        // 応答が完了するのを待つ
        await expect(pendingMessage).toBeHidden({ timeout: 120000 });

        // 4. 最新の応答メッセージを取得し、「置き換え」ボタンをクリック
        const lastBotMessage = aiWindow.locator('.message.bot').last();
        await expect(lastBotMessage).toBeVisible();

        // 刷新されたボタンクラス（.paste-btn または .bottom-btn）に対応
        const replaceBtn = lastBotMessage.locator('button').filter({ hasText: '置き換え' });
        await replaceBtn.click();

        // 5. AIコーディングウィンドウが閉じるのを待つ
        await expect(aiWindow).toBeHidden();
    }

    /**
     * ファイルエクスプローラーを開きます。
     */
    async openFileExplorer(): Promise<void> {
        const alert = this.page.locator('alert-component');
        if (await alert.isVisible().catch(() => false)) {
            await alert.getByRole('button', { name: '閉じる' }).click();
            await expect(alert).toBeHidden();
        }

        // メニューボタンをクリック
        await this.page.locator('#fab-bottom-menu-box').click();

        // メニューが表示されるのを待つ
        const menu = this.page.locator('#platformBottomMenu');
        await expect(menu).toBeVisible();

        // 「ファイル管理」をクリック
        await menu.getByText('ファイル管理').click();

        // ファイルエクスプローラーが表示されるのを待つ
        const fileExplorerContainer = this.page.locator('file-explorer .file-explorer-container');
        await expect(fileExplorerContainer).toBeVisible({ timeout: 10000 });

        // ロード完了を待つ
        await this.waitForFileExplorerLoading();
    }

    /**
     * ファイルエクスプローラーのローディングが消え、ファイルリストが表示されるのを待ちます。
     */
    async waitForFileExplorerLoading(): Promise<void> {
        const loading = this.page.locator('file-explorer-loading-overlay');

        // 1. もしローディングが表示されかけているなら、確実に表示されるまで少し待つ
        try {
            await loading.waitFor({ state: 'visible', timeout: 500 });
        } catch (e) {
            // 表示されなければ、既にロード済みか、一瞬で終わったとみなす
        }

        // 2. ローディングが非表示になるのを待つ
        await expect(loading).toBeHidden({ timeout: 15000 });

        // 3. 【重要】ファイルリスト（または空メッセージ）がレンダリングされるのを待つ
        // これにより、ロードオーバーレイが消えた直後の「中身が空」の状態を回避する
        const explorerContent = this.page.locator('file-explorer .file-explorer-content');
        await expect(explorerContent).toBeVisible();
    }

    /**
     * ファイルエクスプローラー内で新規ディレクトリを作成します。
     */
    async createDirectory(name: string): Promise<void> {
        // performFileOperation を利用してメニュー操作を共通化
        await this.performFileOperation('新規ディレクトリ');

        // 入力ダイアログの実体（.modal）が表示されるのを待つ
        const dialog = this.page.locator('file-explorer-edit-directory-menu .modal');
        await expect(dialog).toBeVisible();

        // 名前を入力
        const input = dialog.locator('.input-field');
        await input.fill(name);

        // 作成ボタンをクリック
        await dialog.locator('#ok-button').click();

        // ダイアログが閉じて、リストの更新が終わるのを待つ
        await expect(dialog).toBeHidden();
        await this.waitForFileExplorerLoading();

        // 画面上にディレクトリが出現したことを検証
        await expect(this.page.locator('file-explorer .directory', { hasText: name })).toBeVisible();
    }

    /**
     * ファイルまたはディレクトリを選択（クリック）します。
     * @param name 対象の名前
     */
    async selectFileExplorerItem(name: string): Promise<void> {
        const item = this.page.locator('file-explorer .directory, file-explorer .file').filter({ hasText: name });
        await expect(item).toBeVisible();
        await item.click();

        // 選択状態になるまで少し待つ（アプリ側の200msタイマー考慮）
        await expect(item).toHaveClass(/selected/, { timeout: 5000 });
    }

    /**
     * ディレクトリをダブルクリックして中に入ります。
     */
    async enterDirectory(name: string): Promise<void> {
        const explorer = this.page.locator('file-explorer');
        // 名前でフィルタリングしたディレクトリ要素
        const dir = explorer.locator('.directory').filter({ hasText: name });
        await expect(dir).toBeVisible();

        // 現在のパンくずの数を取得
        const beforeCount = await explorer.locator('.path-link').count();

        // 【修正】アクションと検証をセットでリトライする（Flaky対策）
        await expect(async () => {
            const links = explorer.locator('.path-link');
            const currentCount = await links.count();

            // まだ遷移していない（パンくずが増えていない）場合のみアクションを実行
            if (currentCount <= beforeCount) {
                // ディレクトリが見えていればダブルクリックを試行
                if (await dir.isVisible()) {
                    // delay: クリック間隔を少し空けてダブルクリックとして認識されやすくする
                    // force: 重なりなどを無視して強制的にクリックを試みる
                    await dir.dblclick({ delay: 50, force: true });
                }

                // クリック後のロード完了を待つ
                // (クリックが不発だった場合はローディングが出ずにここを通過し、下のexpectで失敗してリトライされる)
                await this.waitForFileExplorerLoading();
            }

            // --- 検証 ---
            const afterCount = await links.count();

            // 1. 数が増えていること
            expect(afterCount).toBeGreaterThan(beforeCount);

            // 2. 最後のパンくずにディレクトリ名が含まれること
            const lastLinkText = await links.last().innerText();
            expect(lastLinkText).toContain(name);

        }).toPass({
            timeout: 15000,   // 何度かリトライできるよう長めに時間を確保
            intervals: [1000] // 1秒間隔でチェック
        });
    }

    /**
     * パンくずリストを使ってルートディレクトリ（アプリのルート）に戻ります。
     */
    async goBackToRoot(): Promise<void> {
        const links = this.page.locator('file-explorer .path-link');

        // アプリのルートはパンくずの 1番目（/[AppKey]）なので nth(0)
        const rootLink = links.first();
        await expect(rootLink).toBeVisible();

        // クリック実行
        await rootLink.click();

        // 1. ローディングを待つ
        await this.waitForFileExplorerLoading();

        // 2. 【修正】パンくずリストがルートの長さ（1つ）になるまで待機する
        // パスが "/AppKey" の状態なら、path-link は1つだけになるはずです
        await expect(async () => {
            const count = await links.count();
            expect(count).toBe(1);
        }).toPass({ timeout: 5000 });

        // 念のため、DOMの安定を待つ
        await this.page.waitForTimeout(300);
    }

    /**
     * サイドバーのボタンをクリックします。
     * @param label 「アップロード」「ダウンロード」「全選択/全解除」「閉じる」
     */
    async clickSidebarButton(label: string): Promise<void> {
        const btn = this.page.locator('file-explorer .sidebar-icon').filter({ hasText: label });
        await expect(btn).toBeVisible();
        // 無効化（sidebar-icon-disable）が解除されるのを待つ
        await expect(btn).not.toHaveClass(/sidebar-icon-disable/, { timeout: 5000 });
        await btn.click();
    }

    /**
     * 操作メニューからアクションを実行します。
     * @param action 'コピー' | '切り取り' | '貼り付け' | '削除' | '名前変更' | 'パスをコピー' | '新規ディレクトリ'
     */
    async performFileOperation(action: string): Promise<void> {
        const explorer = this.page.locator('file-explorer');
        await explorer.locator('#menu-operation').click();

        // メニューの ul 自体はサイズを持っているのでOK
        const popupList = explorer.locator('file-explorer-popup-menu ul');
        await expect(popupList).toBeVisible();

        let targetItem: Locator;
        if (action === '貼り付け') {
            targetItem = popupList.locator('.menu-text').filter({ hasText: '貼り付け' });
        } else {
            targetItem = popupList.locator('.menu-text').getByText(action, { exact: true });
        }

        await expect(targetItem).toBeVisible();
        await targetItem.click();

        // ポップアップが消えるのを待つ（ul を待つのが確実）
        await expect(popupList).toBeHidden();

        if (action === '削除') {
            const confirmDialog = explorer.locator('#delete-confirm');
            // 表示確認は Shadow DOM 内のコンテンツで行う
            const dialogBox = confirmDialog.locator('.message-box-content');
            await expect(dialogBox).toBeVisible();

            // 重要: #delete-ok は Light DOM (Slotted) 要素なので、
            // Shadow内の dialogBox からではなく、host である confirmDialog から直接探す
            const okButton = confirmDialog.locator('#delete-ok');
            await expect(okButton).toBeVisible();
            await okButton.click();

            await expect(dialogBox).toBeHidden();
        }

        if (['貼り付け', '削除', '名前変更', '新規ディレクトリ'].includes(action)) {
            await this.waitForFileExplorerLoading();
        }
    }

    /**
     * ファイルエクスプローラーを閉じます。
     */
    async closeFileExplorer(): Promise<void> {
        const closeBtn = this.page.locator('file-explorer .sidebar-icon', { hasText: '閉じる' });
        await closeBtn.click();
        await expect(this.page.locator('file-explorer')).toBeHidden();
    }

    /**
     * サイドバーの「全選択/全解除」ボタンをクリックします。
     */
    async toggleAllSelect(): Promise<void> {
        const explorer = this.page.locator('file-explorer');
        const btn = explorer.locator('.sidebar-icon', { hasText: '全選択/全解除' });
        await btn.click();
    }

    /**
     * 選択したアイテムの名前を変更します。
     * (既にアイテムが選択されている前提)
     */
    async renameSelectedItem(newName: string): Promise<void> {
        await this.performFileOperation('名前変更');

        const dialog = this.page.locator('file-explorer-edit-directory-menu .modal');
        await expect(dialog).toBeVisible();

        const input = dialog.locator('.input-field');
        await input.fill(newName);
        await dialog.locator('#ok-button').click();

        await expect(dialog).toBeHidden();
        await this.waitForFileExplorerLoading();
    }

    /**
     * ファイルをアップロードします。
     * @param filePaths アップロードするファイルのローカルパス（配列）
     */
    async uploadFiles(filePaths: string[]): Promise<void> {
        const explorer = this.page.locator('file-explorer');
        // 隠しinput要素にファイルをセット
        const fileChooserPromise = this.page.waitForEvent('filechooser');
        await explorer.locator('.sidebar-icon', { hasText: 'アップロード' }).click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(filePaths);

        // アップロード完了（ローディング消去）を待つ
        await this.waitForFileExplorerLoading();
    }

    /**
     * 表示されているトーストメッセージを確認します。
     */
    async expectToastMessage(message: string | RegExp): Promise<void> {
        // 重要：ホスト要素ではなく、中の黒い背景部分（.popup-text）を直接待つ
        const toastInner = this.page.locator('file-explorer .file-explorer-container popup-message-element .popup-text')
            .filter({ hasText: message });

        // この .popup-text はサイズを持っているので toBeVisible が通る
        await expect(toastInner).toBeVisible({ timeout: 10000 });
    }

    /**
     * 選択中のアイテムをダウンロードします。
     */
    async downloadSelectedItems(): Promise<void> {
        const explorer = this.page.locator('file-explorer');

        // 1. 割り込みアラート（「コピーしました」など）があれば閉じる
        // これがないとサイドバーのクリックがブロックされる場合があります
        const globalAlert = this.page.locator('alert-component');
        if (await globalAlert.isVisible()) {
            await globalAlert.getByRole('button', { name: '閉じる' }).click();
            await expect(globalAlert).toBeHidden();
        }

        // 2. サイドバーの「ダウンロード」ボタンをクリック
        const downloadBtn = explorer.locator('.sidebar-icon').filter({ hasText: 'ダウンロード' });
        await expect(downloadBtn).toBeVisible();
        await expect(downloadBtn).not.toHaveClass(/sidebar-icon-disable/);
        await downloadBtn.click();

        // 3. 確認ダイアログの「中身（.message-box-content）」が表示されるのを待つ
        // ID指定で特定のメニュー（#download-confirm）を狙い撃ちします
        const confirmDialog = explorer.locator('file-explorer-confirm-menu#download-confirm');
        const dialogBox = confirmDialog.locator('.message-box-content');

        // 前回のログで element not found だったのは、ホスト要素だけを見ていた可能性があります。
        // コンテンツ (.message-box-content) が見えるまで最大15秒待機します。
        await expect(dialogBox).toBeVisible({ timeout: 15000 });

        // 4. ダイアログ内の「ダウンロード」ボタンをクリック
        // このボタンは Light DOM (スロット) にあるため、ホストから直接 locator で指定します
        const okButton = confirmDialog.locator('button.confirm-download-button');
        await expect(okButton).toBeVisible();
        await okButton.click();

        // 5. ダイアログが消えるのを待つ
        await expect(dialogBox).toBeHidden();
        await this.waitForFileExplorerLoading();
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