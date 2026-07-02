import { test as base, expect, Locator, Page } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';
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

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
    const reversedTimestamp = Date.now().toString().split('').reverse().join('');
    const workerIndex = test.info().workerIndex;
    const storageStatePath = getStorageStatePath(workerIndex);

    const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
    appName = `quick-editor-test-${uniqueId}`.slice(0, 30);
    appKey = `qe-test-key-${uniqueId}`.slice(0, 30);

    const context = await browser.newContext({ storageState: storageStatePath });
    const page = await context.newPage();
    await gotoDashboard(page);
    await createApp(page, appName, appKey);
    await context.close();
});

test.afterAll(async ({ browser }) => {
    if (appKey) {
        const workerIndex = test.info().workerIndex;
        const storageStatePath = getStorageStatePath(workerIndex);
        const context = await browser.newContext({ storageState: storageStatePath });
        const page = await context.newPage();
        await gotoDashboard(page);
        await deleteApp(page, appKey);
        await context.close();
    }
});

test.describe('クイックプロパティエディタ（QuickPropertyEditor）の高度な連動テスト', () => {

    test('フローティングエディタでの変更と、キャンセル時の安全なロールバックがプレビューおよび属性タブと完全同期すること', async ({ editorPage, editorHelper }) => {
        const previewSelector = 'ons-button';

        await test.step('1. セットアップ: ボタンを配置して選択', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);

            // クイックツールバーがマウントされていることを確認
            const quickToolbar = editorPage.locator('quick-property-editor .quick-toolbar');
            await expect(quickToolbar).toBeAttached({ timeout: 10000 });
        });

        let originalBgColor: string;

        await test.step('2. ツールバーから背景色を変更（仮適用状態の確認）', async () => {
            const quickToolbar = editorPage.locator('quick-property-editor .quick-toolbar');
            const bgBtn = quickToolbar.locator('button[title*="背景色変更"]');

            await bgBtn.dispatchEvent('click');

            const modal = editorPage.locator('#pwappy-quick-editor-root .quick-editor-modal');
            await expect(modal).toBeVisible();

            // 変更前の色を保持
            originalBgColor = await editorHelper.getPreviewElement(previewSelector).evaluate(el => window.getComputedStyle(el).backgroundColor);

            // 緑色に変更
            const colorInput = modal.locator('input[type="color"]');
            await colorInput.fill('#00ff00');
            await colorInput.blur();

            // 💡 初期値が transparent (不透明度 0) のため、不透明度スライダーを 100 (100%) に移動して可視化させます
            const alphaSlider = modal.locator('input[type="range"]');
            await alphaSlider.fill('100');
            await alphaSlider.dispatchEvent('input');

            await editorHelper.expectPreviewElementCss({
                selector: previewSelector,
                property: 'background-color',
                value: 'rgb(0, 255, 0)'
            });
        });

        await test.step('3. キャンセルしてロールバックされるか検証', async () => {
            const modal = editorPage.locator('#pwappy-quick-editor-root .quick-editor-modal');

            // キャンセルボタンをクリックして閉じる
            await modal.locator('button', { hasText: 'キャンセル' }).dispatchEvent('click');
            await expect(modal).toBeHidden();

            // 元の色に戻っていること
            await editorHelper.expectPreviewElementCss({
                selector: previewSelector,
                property: 'background-color',
                value: originalBgColor
            });
        });

        await test.step('4. 再度背景色を変更し、「閉じる (確定)」時の AttributesContainer 同期を検証', async () => {
            const quickToolbar = editorPage.locator('quick-property-editor .quick-toolbar');
            const bgBtn = quickToolbar.locator('button[title*="背景色変更"]');
            await bgBtn.dispatchEvent('click');

            const modal = editorPage.locator('#pwappy-quick-editor-root .quick-editor-modal');
            await expect(modal).toBeVisible();

            // 青色に設定
            const colorInput = modal.locator('input[type="color"]');
            await colorInput.fill('#0000ff');
            await colorInput.blur();

            // 💡 再度不透明度を 100% に設定
            const alphaSlider = modal.locator('input[type="range"]');
            await alphaSlider.fill('100');
            await alphaSlider.dispatchEvent('input');

            // 「閉じる (確定)」をクリックして仮変更を確定・保存
            await modal.locator('button', { hasText: '確定' }).dispatchEvent('click');
            await expect(modal).toBeHidden();

            // プレビューが青になっていること
            await editorHelper.expectPreviewElementCss({
                selector: previewSelector,
                property: 'background-color',
                value: 'rgb(0, 0, 255)'
            });

            // 属性パネルを開く
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorHelper.getPropertyContainer();
            await editorHelper.switchTabInContainer(propertyContainer, '属性');

            const bgEditor = propertyContainer.locator('style-background-editor');
            await expect(bgEditor).toBeVisible();
            const bgEditorColorInput = bgEditor.locator('input[type="text"]').first();

            // 'quick-editor-save' イベントにより、属性パネル側の入力値も即座に同期されていることを検証
            await expect(bgEditorColorInput).toHaveValue(/rgba?\(0,\s*0,\s*255,\s*1\)/);
        });
    });

    test('カラーピッカー: 確定前の属性タブへのリアルタイム反映と、2度変更した後のキャンセル時に完璧に最初の状態にロールバックされること', async ({ editorPage, editorHelper }) => {
        const previewSelector = 'ons-button';

        await test.step('1. セットアップ: 属性タブを開いて準備', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);

            // 右側の属性タブを開いて配置を確認
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorHelper.getPropertyContainer();
            await editorHelper.switchTabInContainer(propertyContainer, '属性');

            const bgEditor = propertyContainer.locator('style-background-editor');
            await expect(bgEditor).toBeVisible();
        });

        const propertyContainer = editorHelper.getPropertyContainer();
        const bgEditorColorTextInput = propertyContainer.locator('style-background-editor input[type="text"]').first();
        const quickToolbar = editorPage.locator('quick-property-editor .quick-toolbar');
        const modal = editorPage.locator('#pwappy-quick-editor-root .quick-editor-modal');

        await test.step('2. クイック背景色エディタを開く', async () => {
            const bgBtn = quickToolbar.locator('button[title*="背景色変更"]');
            await bgBtn.dispatchEvent('click');
            await expect(modal).toBeVisible();
        });

        await test.step('3. 1回目の変更（赤）: 確定ボタンを押さなくても属性タブにリアルタイム反映されることを検証', async () => {
            const colorInput = modal.locator('input[type="color"]');
            await colorInput.fill('#ff0000'); // 赤
            await colorInput.blur();

            const alphaSlider = modal.locator('input[type="range"]');
            await alphaSlider.fill('100');
            await alphaSlider.dispatchEvent('input');

            // 💡 確定ボタンを押す「前」に、AttributesContainer（属性タブ）の入力値が即座に赤色に追従していることを検証
            await expect(bgEditorColorTextInput).toHaveValue(/rgba?\(255,\s*0,\s*0,\s*1\)/, { timeout: 5000 });
        });

        await test.step('4. 2回目の変更（青）: さらに別の色に変更', async () => {
            const colorInput = modal.locator('input[type="color"]');
            await colorInput.fill('#0000ff'); // 青
            await colorInput.blur();

            // 属性タブが青に追従していることを確認
            await expect(bgEditorColorTextInput).toHaveValue(/rgba?\(0,\s*0,\s*255,\s*1\)/, { timeout: 5000 });
        });

        await test.step('5. キャンセルを実行し、1回目の変更（赤）ではなく、完全に最初の状態（透明）にロールバックされることを検証', async () => {
            // キャンセルボタンをクリックして閉じる
            await modal.locator('button', { hasText: 'キャンセル' }).dispatchEvent('click');
            await expect(modal).toBeHidden();

            // プレビューが最初の透明状態に戻っていること
            await editorHelper.expectPreviewElementAttribute({
                selector: previewSelector,
                attributeName: 'style',
                value: null // style属性自体が完全に消え去っていることを期待
            });

            // 属性タブ側の値も、赤でも青でもなく、完全に空（透明）に戻っていることを検証
            await expect(bgEditorColorTextInput).toHaveValue('');
        });
    });

    test('Flex/FlexItem: 属性の有無による活性制御と、要素切り替え時の「Flex checkbox無効化」および「FlexItemモーダルの自動閉鎖」仕様の検証', async ({ editorPage, editorHelper }) => {
        let containerNodeId: string;
        let nonFlexNodeId: string;

        await test.step('1. セットアップ: Flexboxコンテナ（親）と、Flex属性を一切持たない独自タグ <non-flex-tag> を配置', async () => {
            const setup = await editorHelper.setupFlexContainerWithItem();
            containerNodeId = await setup.containerNode.getAttribute('data-node-id') as string;

            await editorHelper.openMoveingHandle('left');
            const domTree = editorHelper.getDomTree();
            const containerNode = domTree.locator(`.node[data-node-id="${containerNodeId}"]`);

            // 💡 ツールボックスから「HTML Tag」をドラッグしてコンテナに追加するプロセスを手動で確実に行います
            await editorPage.locator('tool-box-item', { hasText: 'HTML Tag' }).dragTo(containerNode);

            // ダイアログが出現するのを待機
            const dialog = editorPage.locator('message-box#html-tag-select-dialog').first();
            await expect(dialog).toBeVisible({ timeout: 5000 });

            // 入力欄に独自タグ名「non-flex-tag」を入力してEnterで決定
            const input = dialog.locator('input#custom-tag-input');
            await expect(input).toBeEditable();
            await input.fill('non-flex-tag');
            await input.press('Enter');
            await expect(dialog).toBeHidden();

            // 💡 直下指定（>）を避け、コンテナ内のすべての子ノードから最後に追加されたものを取得します
            const nonFlexNode = containerNode.locator('.node[data-node-type="non-flex-tag"]').last();
            await expect(nonFlexNode).toBeVisible({ timeout: 5000 });

            nonFlexNodeId = await nonFlexNode.getAttribute('data-node-id') as string;
        });

        const quickToolbar = editorPage.locator('quick-property-editor .quick-toolbar');
        const modal = editorPage.locator('#pwappy-quick-editor-root .quick-editor-modal');

        await test.step('2. 属性なし独自要素選択時: flexおよびflexitemのクイック編集ボタンが非活性（disabled）になっていること', async () => {
            await editorHelper.openMoveingHandle('left');
            const nonFlexNode = editorHelper.getDomTree().locator(`.node[data-node-id="${nonFlexNodeId}"]`);
            await editorHelper.selectNodeInDomTree(nonFlexNode);

            // 厳格モード（strict mode）違反を避けるため、レイアウトと配置（子要素）のタイトル部分一致を厳密に区別
            const flexBtn = quickToolbar.locator('button[title*="Flexboxレイアウト"]').first();
            const flexItemBtn = quickToolbar.locator('button[title*="Flexbox配置"]').first();

            await expect(flexBtn).toBeDisabled();
            await expect(flexItemBtn).toBeDisabled();
        });

        await test.step('3. Flexコンテナ選択時: flexボタンが活性化し、クイック編集を開けること', async () => {
            await editorHelper.openMoveingHandle('left');
            const containerNode = editorHelper.getDomTree().locator(`.node[data-node-id="${containerNodeId}"]`);
            await editorHelper.selectNodeInDomTree(containerNode);

            const flexBtn = quickToolbar.locator('button[title*="Flexboxレイアウト"]').first();
            await expect(flexBtn).toBeEnabled();

            // クイック編集画面を開く
            await flexBtn.dispatchEvent('click');
            await expect(modal).toBeVisible();
            await expect(modal.locator('.qe-header')).toContainText('Flexboxレイアウトの編集');
        });

        await test.step('4. Flex画面を開いたまま属性なし独自要素へ切り替え: モーダルは閉じずに、チェックボックス等の操作が非活性（disabled）に切り替わること（便利機能）', async () => {
            // Flex画面を開いたまま、プレビュー上の追加した独自タグ（non-flex-tag）をクリックして切り替える
            const previewFrame = editorHelper.getPreviewFrame();

            // 空のタグはサイズを持たないため force: true と、必要なら evaluate クリックを併用
            const targetEl = previewFrame.locator('non-flex-tag');
            await expect(targetEl).toBeAttached();
            await targetEl.evaluate((el: HTMLElement) => el.click());

            // 画面（モーダル）は閉じずに開いたままになっていること
            await expect(modal).toBeVisible();

            // モーダル内部のスタイルエディタのUI（チェックボックスなど）が disabled に切り替わっていることを検証
            const flexCheckbox = modal.locator('input#flex');
            await expect(flexCheckbox).toBeDisabled();

            // モーダルを一旦閉じる
            await modal.locator('button', { hasText: '確定' }).dispatchEvent('click');
            await expect(modal).toBeHidden();
        });

        await test.step('5. FlexItem画面を開いたまま属性なし独自要素へ切り替え: flexitem属性がないため、エディタ画面が自動的に閉じること', async () => {
            // 再びFlexコンテナを選択
            await editorHelper.openMoveingHandle('left');
            const containerNode = editorHelper.getDomTree().locator(`.node[data-node-id="${containerNodeId}"]`);
            await editorHelper.selectNodeInDomTree(containerNode);

            // Flexitem編集を起動するために、flex-item属性を持つ子要素の選択に切り替えます
            const itemNode = editorHelper.getDomTree().locator('.node[data-node-type="flex-item"]').first();
            await editorHelper.selectNodeInDomTree(itemNode);

            // FlexItemのクイック編集を開く
            const flexItemBtn = quickToolbar.locator('button[title*="Flexbox配置"]').first();
            await expect(flexItemBtn).toBeEnabled();
            await flexItemBtn.dispatchEvent('click');
            await expect(modal).toBeVisible();
            await expect(modal.locator('.qe-header')).toContainText('Flexbox配置');

            // 開いたまま、プレビュー上の追加した独自タグ（non-flex-tag：flexitem属性なし）をクリックして切り替える
            const previewFrame = editorHelper.getPreviewFrame();
            await previewFrame.locator('non-flex-tag').evaluate((el: HTMLElement) => el.click());

            // 仕様: 切り替えた要素にflexitem属性がないため、編集画面が自動的に閉じます
            await expect(modal).toBeHidden({ timeout: 5000 });
        });
    });

    test('基本情報編集: 保存を押さずに要素を切り替えた時の「一括自動保存」と「ID重複防止ガード」が機能すること', async ({ editorPage, editorHelper }) => {
        test.setTimeout(90000); // 💡 モバイルの低速実行に対応するため、タイムアウトを90秒に設定
        let node1Id: string;
        let node2Id: string;

        const uniqueSuffix = Date.now().toString().slice(-4);
        const node1TargetId = `btn-uniq-1-${uniqueSuffix}`;
        const node2TargetId = `btn-uniq-2-${uniqueSuffix}`;

        await test.step('1. セットアップ: 競合のない一意な属性を指定して、ons-toolbarとボタンを手動配置しIDを設定する', async () => {
            // ページを追加
            const pageNode = await editorHelper.addPage();

            // 一意のセレクタを指定して、ons-toolbar をドラッグ＆ドロップで追加
            const toolboxToolbarItem = editorPage.locator('tool-box-item[data-item-type="ons-toolbar"]');
            await expect(toolboxToolbarItem).toBeVisible();
            await toolboxToolbarItem.dragTo(pageNode);

            // 追加されたons-toolbarノードをツリー上で特定
            const toolbarNode = pageNode.locator('.node[data-node-type="ons-toolbar"]').first();
            await expect(toolbarNode).toBeVisible({ timeout: 5000 });
            await editorPage.waitForTimeout(500);

            // ons-button を「コンテンツ」エリアに手動追加
            const contentArea = pageNode.locator('div[data-node-explain="コンテンツ"]').first();
            const buttonNode = await editorHelper.addComponent('ons-button', contentArea);
            await editorPage.waitForTimeout(1000);

            // 確実に追加されている ons-toolbar（toolbarNode）自体を要素1に指定
            const toolBtn = toolbarNode;
            node1Id = await toolBtn.getAttribute('data-node-id') as string;

            await editorHelper.selectNodeInDomTree(toolBtn);
            await editorHelper.openMoveingHandle('right');
            const idInput = editorHelper.getPropertyInput('domId').locator('input');
            await expect(idInput).toBeVisible();
            await idInput.fill(node1TargetId);
            await idInput.blur(); // フォーカスアウトで確定
            await editorPage.waitForTimeout(500);

            // [要素2] ons-button を選択してIDを登録
            await editorHelper.selectNodeInDomTree(buttonNode);
            node2Id = await buttonNode.getAttribute('data-node-id') as string;

            await editorHelper.openMoveingHandle('right');
            await expect(idInput).toBeVisible();
            await idInput.fill(node2TargetId);
            await idInput.blur();
            await editorPage.waitForTimeout(500);

            await editorHelper.closeMoveingHandle();
        });

        const quickToolbar = editorPage.locator('quick-property-editor .quick-toolbar');
        const modal = editorPage.locator('#pwappy-quick-editor-root .quick-editor-modal');

        await test.step('2. 要素1を選択してクイック基本情報（テキスト）編集を開き、各種値を書き換える', async () => {
            await editorHelper.openMoveingHandle('left');
            const button1Node = editorHelper.getDomTree().locator(`.node[data-node-id="${node1Id}"]`);
            await editorHelper.selectNodeInDomTree(button1Node);

            const textBtn = quickToolbar.locator('button[title*="テキスト変更"]');
            await textBtn.dispatchEvent('click');
            await expect(modal).toBeVisible();

            // 各項目を入力し、コミット（確定）させる
            const domIdInput = modal.locator('#qe-meta-domid');
            await domIdInput.fill(`${node1TargetId}-edited`);
            await domIdInput.blur();

            const explainInput = modal.locator('#qe-meta-explain');
            await explainInput.fill('自動保存のテスト説明');
            await explainInput.blur();

            const classInput = modal.locator('#qe-meta-class');
            await classInput.fill('class-auto-save');
            await classInput.blur();

            const textInput = modal.locator('#qe-meta-text');
            await textInput.fill('自動保存テキスト');
            await textInput.blur();
        });

        await test.step('3. 確定せずにプレビュー上の要素2（ボタン）を選択し、自動で一括保存されていることを検証', async () => {
            const previewFrame = editorHelper.getPreviewFrame();

            // プレビュー（Renderzone）上のコンテンツ内のボタン2（IDはbtn-uniq-2-xxxx）を特定
            const previewButton2 = previewFrame.locator(`#${node2TargetId}`);
            await expect(previewButton2).toBeAttached({ timeout: 10000 });

            // ツールバーの透明領域によるクリック遮蔽（インターセプト）を避けるため、dispatchEventで安全にタップを送信
            await previewButton2.dispatchEvent('click');

            // 💡 モバイル等での重い状態同期・Reduxディスパッチ・ツリー全体の再描画の完了を確実に待ちます
            await editorPage.waitForTimeout(2500);

            // 選択が切り替わった直前に、要素1の変更内容が裏側で自動保存されていることを検証
            const savedButton1Node = editorHelper.getDomTree().locator(`.node[data-node-id="${node1Id}"]`);
            await expect(savedButton1Node).toHaveAttribute('data-node-dom-id', `${node1TargetId}-edited`);

            // 子ノード（left, center等）のラベルとの競合を避けるため、.first() を適用して親ノード自体の説明文を特定します
            await expect(savedButton1Node.locator('.label-explain').first()).toHaveText('自動保存のテスト説明');
        });

        await test.step('4. 異常系（ID重複ガード）: 再び要素1の編集を開き、要素2と「同じID」へ書き換えてプレビュー切り替え', async () => {
            // プレビュー上の要素1（ツールバー。IDはedited付き）を特定し、dispatchEventで選択を戻す
            const previewFrame = editorHelper.getPreviewFrame();
            const previewButton1 = previewFrame.locator(`#${node1TargetId}-edited`);
            await expect(previewButton1).toBeAttached({ timeout: 5000 });
            await previewButton1.dispatchEvent('click');

            const textBtn = quickToolbar.locator('button[title*="テキスト変更"]');
            await textBtn.dispatchEvent('click');
            await expect(modal).toBeVisible();

            // ID部分を、要素2が持っているID「btn-uniq-2-xxxx」にわざと重複して設定し確定
            const domIdInput = modal.locator('#qe-meta-domid');
            await domIdInput.fill(node2TargetId);
            await domIdInput.blur();

            // 他の説明項目も変更して確定
            const explainInput = modal.locator('#qe-meta-explain');
            await explainInput.fill('重複によりIDだけ保存されないはずの説明');
            await explainInput.blur();

            // プレビュー上の要素2（ボタン2）を特定し、dispatchEventで切り替え
            const previewButton2 = previewFrame.locator(`#${node2TargetId}`);
            await expect(previewButton2).toBeAttached({ timeout: 5000 });
            await previewButton2.dispatchEvent('click');

            // 💡 状態同期完了を待つ
            await editorPage.waitForTimeout(2500);

            // 検証: IDは重複しているためガードされ、書き換える前の「btn-uniq-1-xxxx-edited」が維持されていることを属性値で検証
            const finalButton1Node = editorHelper.getDomTree().locator(`.node[data-node-id="${node1Id}"]`);
            await expect(finalButton1Node).toHaveAttribute('data-node-dom-id', `${node1TargetId}-edited`);

            // 検証: ただしID以外の「説明（explain）」は重複していないため、正常に自動更新されていること
            await expect(finalButton1Node.locator('.label-explain').first()).toHaveText('重複によりIDだけ保存されないはずの説明');

            // 残っているモーダルを閉じる
            await modal.locator('button', { hasText: 'キャンセル' }).dispatchEvent('click');
        });
    });

    test('クイック削除: クイックツールバーからの削除、およびappルートの削除防止ガードが機能すること', async ({ editorPage, editorHelper }) => {
        test.setTimeout(60000);
        const quickToolbar = editorPage.locator('quick-property-editor .quick-toolbar');

        await test.step('1. 異常系: 起動直後の初期状態（appが自動選択中）で削除ボタンを押した際、警告が出て削除が防止されること', async () => {
            // 💡 起動直後はデフォルトで最上位の app（application）が選択されています。
            // ツールバーの削除ボタンを特定（モバイルははみ出すため、dispatchEventで安全にクリック）
            const delBtn = quickToolbar.locator('button.btn-delete');
            await expect(delBtn).toBeAttached({ timeout: 10000 });

            let alertTriggered = false;
            editorPage.once('dialog', async dialog => {
                // 💡 正しく app に対する削除防止警告「アプリケーションのルート要素は削除できません。」が発火することを検証
                expect(dialog.message()).toContain('ルート要素は削除できません');
                alertTriggered = true;
                await dialog.accept(); // アラートを閉じる
            });

            await delBtn.dispatchEvent('click');

            // アラートが正しくトリガーされたことを検証
            expect(alertTriggered).toBe(true);
        });

        let pageNodeId: string;
        let buttonNodeId: string;

        await test.step('2. 正常系セットアップ: ページとボタンを追加する', async () => {
            const pageNode = await editorHelper.addPage();
            pageNodeId = await pageNode.getAttribute('data-node-id') as string;

            const contentArea = pageNode.locator('div[data-node-explain="コンテンツ"]').first();
            const buttonNode = await editorHelper.addComponent('ons-button', contentArea);
            buttonNodeId = await buttonNode.getAttribute('data-node-id') as string;
        });

        await test.step('3. 正常系: 追加したボタンを選択し、削除を実行してツリーから抹消されることを検証', async () => {
            await editorHelper.openMoveingHandle('left');
            const buttonNode = editorHelper.getDomTree().locator(`.node[data-node-id="${buttonNodeId}"]`);
            await editorHelper.selectNodeInDomTree(buttonNode);

            const delBtn = quickToolbar.locator('button.btn-delete');
            await expect(delBtn).toBeAttached();

            // 削除確認ダイアログの受託
            let confirmTriggered = false;
            editorPage.once('dialog', async dialog => {
                expect(dialog.message()).toContain('選択した要素を削除しますか？');
                confirmTriggered = true;
                await dialog.accept(); // 削除を承認
            });

            await delBtn.dispatchEvent('click');
            expect(confirmTriggered).toBe(true);

            // 💡 検証: ツリー上からボタンが完全に消えていること
            await expect(buttonNode).toBeHidden({ timeout: 5000 });
        });
    });

    // 特定のボーダー入力項目をモーダル内から一意に特定するための内部ヘルパー関数
    function borderEditorInput(container: Locator, property: 'borderRadius' | 'borderWidth' | 'borderColor'): Locator {
        if (property === 'borderColor') {
            // 💡 プレースホルダーの "#" をフックしてカラーコード入力欄（text）を一意に特定します
            return container.locator('style-border-editor input[placeholder*="#"]').first();
        }
        if (property === 'borderRadius') {
            return container.locator('style-border-editor input#border-radius').first();
        }
        if (property === 'borderWidth') {
            return container.locator('style-border-editor input#border-width').first();
        }
        return container.locator('style-border-editor input').first();
    }

    // 💡 確実に値を入力してフォーカスを外す（changeイベントをトリガーする）ヘルパー
    async function radiusInForm(input: Locator, value: string) {
        await expect(input).toBeVisible();
        await expect(input).toBeEditable();
        await input.fill(value);
        await input.blur();
    }

    test('ボーダー調整: クイックボーダー編集の全項目（角丸、太さ、線種、色）がプレビューおよび属性タブとリアルタイム同期し、確定時に正常に保存されること', async ({ editorPage, editorHelper }) => {
        test.setTimeout(60000);
        const previewSelector = 'ons-button';

        await test.step('1. セットアップ: ボタンを配置して選択し、右側の属性タブを開いて準備', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);

            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorHelper.getPropertyContainer();
            await editorHelper.switchTabInContainer(propertyContainer, '属性');

            const borderEditor = propertyContainer.locator('style-border-editor');
            await expect(borderEditor).toBeVisible();
        });

        const quickToolbar = editorPage.locator('quick-property-editor .quick-toolbar');
        const modal = editorPage.locator('#pwappy-quick-editor-root .quick-editor-modal');

        await test.step('2. クイックツールバーから「ボーダー / 角丸 調整」を開く', async () => {
            const borderBtn = quickToolbar.locator('button[title*="ボーダー / 角丸"]').first();
            await borderBtn.dispatchEvent('click');
            await expect(modal).toBeVisible();
            await expect(modal.locator('.qe-header')).toContainText('ボーダー / 角丸');
        });

        await test.step('3. 各種ボーダープロパティをリアルタイムで変更し、プレビューに同期反映されることを検証', async () => {
            // 💡 3-1. 先に枠線のスタイル（borderStyle）を dashed に変更して、プレビュー上に枠線を確実に可視化（出現）させます
            const styleSelect = modal.locator('style-border-editor select[name="borderStyle"], style-border-editor select#border-style').first();
            await styleSelect.selectOption('dashed');
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-style', value: 'dashed' });

            // 💡 3-2. 枠線が存在しているため、角丸（borderRadius）の計算値変更がブラウザ側で100%正確に評価されるようになります
            const radiusInModal = borderEditorInput(modal, 'borderRadius');
            await radiusInForm(radiusInModal, '15px');
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-radius', value: '15px' });

            // 💡 3-3. 枠線の太さ（borderWidth）を 3px に設定して検証
            const widthInput = borderEditorInput(modal, 'borderWidth');
            await radiusInForm(widthInput, '3px');
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-width', value: '3px' });

            // 💡 3-4. 枠線の色（borderColor）を青 (#0000ff) に変更して検証
            const colorInput = borderEditorInput(modal, 'borderColor');
            await radiusInForm(colorInput, '#0000ff');
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-color', value: 'rgb(0, 0, 255)' });
        });

        await test.step('4. 「閉じる (確定)」ボタンを押した後に、属性タブ側へすべての値が同期・保存されていることを検証', async () => {
            await modal.locator('button', { hasText: '確定' }).dispatchEvent('click');
            await expect(modal).toBeHidden();

            // プレビュー側のCSSが正しく反映されていること
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-radius', value: '15px' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-width', value: '3px' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-style', value: 'dashed' });
            await editorHelper.expectPreviewElementCss({ selector: previewSelector, property: 'border-color', value: 'rgb(0, 0, 255)' });

            // 💡 属性パネル側の入力欄も、正しい実体ID属性（#border-radius, #border-width, #border-style）を指定して同期保存されていることを検証します
            const propertyContainer = editorHelper.getPropertyContainer();
            const borderEditorInTab = propertyContainer.locator('style-border-editor');

            await expect(borderEditorInTab.locator('input#border-radius')).toHaveValue('15px');
            await expect(borderEditorInTab.locator('input#border-width')).toHaveValue('3px');
            await expect(borderEditorInTab.locator('select#border-style')).toHaveValue('dashed');
            await expect(borderEditorInTab.locator('input[type="text"]').last()).toHaveValue('#0000ff');
        });
    });

    test('クイック削除時の選択状態フォールバック: トップレベルテンプレートや一般要素を削除した際、自動的にappルートが選択状態になること', async ({ editorPage, editorHelper }) => {
        test.setTimeout(60000);
        const quickToolbar = editorPage.locator('quick-property-editor .quick-toolbar');
        const domTree = editorHelper.getDomTree();

        let pageNodeId: string;
        let buttonNodeId: string;

        await test.step('1. セットアップ: ページとボタンを追加する', async () => {
            const pageNode = await editorHelper.addPage();
            pageNodeId = await pageNode.getAttribute('data-node-id') as string;

            const contentArea = pageNode.locator('div[data-node-explain="コンテンツ"]').first();
            const buttonNode = await editorHelper.addComponent('ons-button', contentArea);
            buttonNodeId = await buttonNode.getAttribute('data-node-id') as string;
        });

        await test.step('2. 一般要素（ボタン）の削除検証: ボタンを選択・削除し、削除後に自動でappノードが選択状態になることを検証', async () => {
            await editorHelper.openMoveingHandle('left');
            const buttonNode = domTree.locator(`.node[data-node-id="${buttonNodeId}"]`);
            await editorHelper.selectNodeInDomTree(buttonNode);

            const delBtn = quickToolbar.locator('button.btn-delete');
            await expect(delBtn).toBeAttached();

            // 削除確認ダイアログの受託
            editorPage.once('dialog', async dialog => {
                expect(dialog.message()).toContain('選択した要素を削除しますか？');
                await dialog.accept(); // 削除を承認
            });

            await delBtn.dispatchEvent('click');

            // 検証: ボタンが完全に消えていること
            await expect(buttonNode).toBeHidden({ timeout: 5000 });

            // 💡 削除後のエディタ再構築（「処理中」オーバーレイ）が完全に消えるのを確実に待ちます
            const loading = editorPage.locator('app-container-loading-overlay');
            await expect(loading).toBeHidden({ timeout: 15000 });

            // 💡 リビルド完了後のDOM安定化のための微小待機
            await editorPage.waitForTimeout(500);

            // 検証: プロパティウィンドウのタグ名が「app」になっていることで選択状態を確認
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorHelper.getPropertyContainer();
            
            // 💡 property-container 内の「属性」タブを直接強制クリックしてパネルを活性化させます
            await propertyContainer.getByText('属性', { exact: true }).click({ force: true });
            
            // 💡 attribute-input[data-attribute-type="tagName"] の data-origin-value 属性が "app" であることを検証します
            const tagNameInput = propertyContainer.locator('attribute-input[data-attribute-type="tagName"]');
            await expect(tagNameInput).toHaveAttribute('data-origin-value', 'app', { timeout: 5000 });
        });

        await test.step('3. トップテンプレート（ページ）の削除検証: ページを選択・削除し、削除後に自動でappノードが選択状態になることを検証', async () => {
            await editorHelper.openMoveingHandle('left');
            const pageNode = domTree.locator(`.node[data-node-id="${pageNodeId}"]`);
            await editorHelper.selectNodeInDomTree(pageNode);

            const delBtn = quickToolbar.locator('button.btn-delete');
            await expect(delBtn).toBeAttached();

            // 削除確認ダイアログの受託
            editorPage.once('dialog', async dialog => {
                expect(dialog.message()).toContain('選択した要素を削除しますか？');
                await dialog.accept(); // 削除を承認
            });

            await delBtn.dispatchEvent('click');

            // 検証: ページが完全に消えていること
            await expect(pageNode).toBeHidden({ timeout: 5000 });

            // 💡 削除後のエディタ再構築（「処理中」オーバーレイ）が完全に消えるのを確実に待ちます
            const loading = editorPage.locator('app-container-loading-overlay');
            await expect(loading).toBeHidden({ timeout: 15000 });

            // 💡 リビルド完了後のDOM安定化のための微小待機
            await editorPage.waitForTimeout(500);

            // 検証: プロパティウィンドウのタグ名が「app」になっていることで選択状態を確認
            await editorHelper.openMoveingHandle('right');
            const propertyContainer = editorHelper.getPropertyContainer();
            
            // 💡 property-container 内の「属性」タブを直接強制クリックしてパネルを活性化させます
            await propertyContainer.getByText('属性', { exact: true }).click({ force: true });
            
            // 💡 attribute-input[data-attribute-type="tagName"] の data-origin-value 属性が "app" であることを検証します
            const tagNameInput = propertyContainer.locator('attribute-input[data-attribute-type="tagName"]');
            await expect(tagNameInput).toHaveAttribute('data-origin-value', 'app', { timeout: 5000 });
        });
    });
});