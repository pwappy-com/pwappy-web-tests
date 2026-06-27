import { test as base, expect, Page } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

type EditorFixtures = {
    editorPage: Page;
    appName: string;
    editorHelper: EditorHelper;
};

const test = base.extend<EditorFixtures>({
    appName: async ({ }, use) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        await use(`test-comp-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName }, use) => {
        await gotoDashboard(page);
        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });

        const appKey = `test-comp-key-${Date.now().toString().slice(-6)}`;
        await createApp(page, appName, appKey);
        const editorPage = await openEditor(page, context, appName);
        await use(editorPage);
        await editorPage.close();
        await page.bringToFront();
        await deleteApp(page, appKey);
    },
    editorHelper: async ({ editorPage, isMobile }, use) => {
        const helper = new EditorHelper(editorPage, isMobile);
        await use(helper);
    },
});

test.describe('エディタ内：カスタムコンポーネント（ツールボックス）機能の検証', () => {

    test('新しいコンポーネントを作成し、ツールボックスから配置できる', async ({ editorPage, editorHelper }) => {
        const componentName = 'my-custom-card';
        const componentCode = `<div class="my-card" style="padding:10px; background:lightblue;">\n  <h2>カスタムカード</h2>\n</div>`;

        await test.step('1. コンポーネントエディタを開き、新しいコンポーネントを作成', async () => {
            await editorHelper.openMoveingHandle('left');
            const toolBox = editorPage.locator('tool-box');

            // コンポーネントエディタを開くアイコンをクリック
            await toolBox.locator('.title-icon-bar-button').click();

            const itemEditor = editorPage.locator('tool-box-item-editor');
            await expect(itemEditor).toBeVisible();

            // 名前とコードの入力
            const componentNameInput = itemEditor.locator('#component-name');
            await expect(componentNameInput).toBeEditable();
            await componentNameInput.fill(componentName);

            // Monacoエディタにコードを設定
            const monacoEditor = itemEditor.locator('.code-editor-container textarea').first();
            await expect(monacoEditor).toBeEditable();
            await monacoEditor.fill(componentCode);

            // 保存ボタンをクリック
            await itemEditor.locator('#save-button').click();
            await expect(itemEditor).toBeHidden();
        });

        await test.step('2. ツールボックスにコンポーネントが表示されることを確認', async () => {
            const toolBox = editorPage.locator('tool-box');

            // 検索ボックスで絞り込み
            const filterInput = toolBox.locator('#filter-input');
            await expect(filterInput).toBeEditable();
            await filterInput.fill('my-custom');

            const customItem = toolBox.locator(`tool-box-item[data-item-type="${componentName}"]`);
            await expect(customItem).toBeVisible();
        });

        await test.step('3. ドラッグ＆ドロップで画面に配置する', async () => {
            // ベースとなるページを追加
            await editorHelper.addPage();

            // 左パネルを開いてD&Dの準備
            await editorHelper.openMoveingHandle('left');

            const contentAreaLocator = editorPage.locator('#dom-tree div[data-node-explain="コンテンツ"]');
            const toolBoxItem = editorPage.locator(`tool-box-item[data-item-type="${componentName}"]`);

            // カスタムコンポーネントをD&Dで追加
            await toolBoxItem.dragTo(contentAreaLocator, { targetPosition: { x: 10, y: 10 } });

            // 配置されたノードのタイプが元のHTMLタグ (div) になっていることを確認（リストの最後に追加されるため last() で取得）
            const newNode = contentAreaLocator.locator('> .node[data-node-type="div"]').last();
            await expect(newNode).toBeVisible({ timeout: 10000 });

            // プレビュー画面上に要素がレンダリングされていることを確認
            const previewElement = editorHelper.getPreviewElement('div.my-card');
            await expect(previewElement).toBeVisible({ timeout: 10000 });
            await expect(previewElement).toHaveText('カスタムカード');
        });
    });

    test('作成したカスタムコンポーネントを編集（更新）できる', async ({ editorPage, editorHelper }) => {
        const componentName = 'my-custom-card';
        const componentCode = `<div class="my-card" style="padding:10px; background:lightblue;">\n  <h2>カスタムカード</h2>\n</div>`;
        const editedComponentName = 'my-custom-card-edited';
        const editedComponentCode = `<div class="my-card" style="padding:10px; background:lightgreen;">\n  <h2>編集済みカスタムカード</h2>\n</div>`;

        await test.step('1. 新しいカスタムコンポーネントを事前作成', async () => {
            await editorHelper.openMoveingHandle('left');
            const toolBox = editorPage.locator('tool-box');

            await toolBox.locator('.title-icon-bar-button').click();

            const itemEditor = editorPage.locator('tool-box-item-editor');
            await expect(itemEditor).toBeVisible();

            const componentNameInput = itemEditor.locator('#component-name');
            await expect(componentNameInput).toBeEditable();
            await componentNameInput.fill(componentName);

            const monacoEditor = itemEditor.locator('.code-editor-container textarea').first();
            await expect(monacoEditor).toBeEditable();
            await monacoEditor.fill(componentCode);

            await itemEditor.locator('#save-button').click();
            await expect(itemEditor).toBeHidden();
        });

        await test.step('2. ツールボックスから作成したコンポーネントの編集を起動する', async () => {
            const toolBox = editorPage.locator('tool-box');

            const filterInput = toolBox.locator('#filter-input');
            await expect(filterInput).toBeEditable();
            await filterInput.fill(componentName);

            const customItem = toolBox.locator(`tool-box-item[data-item-type="${componentName}"]`);
            await expect(customItem).toBeVisible();

            // 新規作成時と同じ「追加ボタン」エリア (.title-icon-bar-button) をドラッグ＆ドロップ先にする
            const editButtonZone = toolBox.locator('.title-icon-bar-button');

            // 登録したコンポーネントを、追加の時に使用したボタンの場所へドラッグ＆ドロップして編集を起動する
            await customItem.dragTo(editButtonZone);

            const itemEditor = editorPage.locator('tool-box-item-editor');
            await expect(itemEditor).toBeVisible({ timeout: 15000 });
        });

        await test.step('3. コンポーネント情報（名前・コード）を変更して保存する', async () => {
            const itemEditor = editorPage.locator('tool-box-item-editor');

            // 新しい名前を入力
            const componentNameInput = itemEditor.locator('#component-name');
            await expect(componentNameInput).toBeEditable();
            await componentNameInput.fill(editedComponentName);

            // 新しいコードを入力
            const monacoEditor = itemEditor.locator('.code-editor-container textarea').first();
            await expect(monacoEditor).toBeEditable();
            await monacoEditor.fill(editedComponentCode);

            // 保存を実行
            await itemEditor.locator('#save-button').click();
            await expect(itemEditor).toBeHidden();
        });

        await test.step('4. ツールボックスに編集内容が正常に同期・更新されていることを検証する', async () => {
            const toolBox = editorPage.locator('tool-box');

            const filterInput = toolBox.locator('#filter-input');
            await expect(filterInput).toBeEditable();

            // 新しい名前で検索してヒットすることを確認 (完全一致)
            await filterInput.fill(editedComponentName);
            const editedItem = toolBox.locator(`tool-box-item[data-item-type="${editedComponentName}"]`);
            await expect(editedItem).toBeVisible();

            // 古い名前で検索した場合はヒットしないことを確認 (完全一致)
            await filterInput.fill(componentName);
            const oldItem = toolBox.locator(`tool-box-item[data-item-type="${componentName}"]`);
            await expect(oldItem).toBeHidden();
        });
    });
});