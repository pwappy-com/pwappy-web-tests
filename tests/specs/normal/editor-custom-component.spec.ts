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
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appKey = `test-key-${uniqueId}`.slice(0, 30); // ※ファイルごとのプレフィックスに合わせる

        const tSetup = Date.now();
        await createApp(page, appName, appKey);
        const editorPage = await openEditor(page, context, appName);
        console.log(`[Fixture:${appName}] Setup completed in ${Date.now() - tSetup}ms`);

        // =========================================================
        // 【原因究明用ログ】 ネットワークリクエストのトラッキング
        // =========================================================
        const pendingRequests = new Map<string, string>(); // url -> method
        editorPage.on('request', req => pendingRequests.set(req.url(), req.method()));
        editorPage.on('requestfinished', req => pendingRequests.delete(req.url()));
        editorPage.on('requestfailed', req => pendingRequests.delete(req.url()));

        await use(editorPage);

        console.log(`[Fixture:${appName}] Teardown started`);
        console.log(`[Fixture:${appName}] Pending requests: ${pendingRequests.size}`);
        if (pendingRequests.size > 0) {
            console.log(`[Fixture:${appName}] Pending URLs:`);
            pendingRequests.forEach((method, url) => {
                console.log(`  - [${method}] ${url}`);
            });
        }

        const tClose = Date.now();
        console.log(`[Fixture:${appName}] Calling editorPage.close()...`);
        await editorPage.close();
        console.log(`[Fixture:${appName}] editorPage.close() took ${Date.now() - tClose}ms`);

        const tDelete = Date.now();
        await page.bringToFront();
        await deleteApp(page, appKey);
        console.log(`[Fixture:${appName}] deleteApp took ${Date.now() - tDelete}ms`);
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

            const customItem = toolBox.locator('tool-box-item', { hasText: componentName });
            await expect(customItem).toBeVisible();
        });

        await test.step('3. ドラッグ＆ドロップで画面に配置する', async () => {
            // ベースとなるページを追加
            await editorHelper.addPage();

            // 左パネルを開いてD&Dの準備
            await editorHelper.openMoveingHandle('left');

            const contentAreaLocator = editorPage.locator('#dom-tree div[data-node-explain="コンテンツ"]');
            const toolBoxItem = editorPage.locator('tool-box-item', { hasText: componentName });

            // カスタムコンポーネントをD&Dで追加
            // 注: addComponentヘルパーは「追加したアイテム名」と「タグ名」が一致することを期待するため、ここでは手動でドラッグ＆ドロップする
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
});