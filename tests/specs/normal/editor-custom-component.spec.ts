import { test as base, expect, Page } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, openEditor } from '../../tools/dashboard-helpers';
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
        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        var domain: string = testUrl.hostname;
        if (domain !== 'localhost') {
            domain = '.' + domain;
        }
        // 先にクッキーを削除
      await context.clearCookies();
      await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 },
            { name: 'pwappy_login', value: process.env.PWAPPY_LOGIN!, domain: domain, path: '/', secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 },
        ]);
        await page.goto(String(process.env.PWAPPY_TEST_BASE_URL), { waitUntil: 'domcontentloaded' });
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
            await itemEditor.locator('#component-name').fill(componentName);

            // Monacoエディタにコードを設定
            const monacoEditor = itemEditor.locator('.code-editor-container textarea').first();
            await monacoEditor.fill(componentCode);

            // 保存ボタンをクリック
            await itemEditor.locator('#save-button').click();
            await expect(itemEditor).toBeHidden();
        });

        await test.step('2. ツールボックスにコンポーネントが表示されることを確認', async () => {
            const toolBox = editorPage.locator('tool-box');

            // 検索ボックスで絞り込み
            await toolBox.locator('#filter-input').fill('my-custom');

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