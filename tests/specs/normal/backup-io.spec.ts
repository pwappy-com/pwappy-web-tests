import { test as base, expect, Page } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';
import * as path from 'path';

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
        await use(`io-test-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName }, use) => {
        const uniqueId = Date.now().toString().slice(-6);
        const appKey = `io-key-${uniqueId}`;
        await createApp(page, appName, appKey);
        const editorPage = await openEditor(page, context, appName);
        await use(editorPage);
        await editorPage.close();
        await deleteApp(page, appKey);
    },
    editorHelper: async ({ editorPage, isMobile }, use) => {
        const helper = new EditorHelper(editorPage, isMobile);
        await use(helper);
    },
});

test.describe('プロジェクトのバックアップ・インポート統合テスト', () => {

    test.beforeEach(async ({ page, context }) => {
        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        const domain = testUrl.hostname;
        await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/' },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/' },
            { name: 'pwappy_login', value: '1', domain: domain, path: '/' },
        ]);
        await page.goto(String(process.env.PWAPPY_TEST_BASE_URL), { waitUntil: 'domcontentloaded' });
    });

    test('エクスポートしたバックアップファイルから要素を完全に復元できる', async ({ editorPage, editorHelper }, testInfo) => {
        const testButtonText = 'BACKUP_VERIFY_BUTTON';
        const downloadPath = path.join(testInfo.outputDir, 'test-project.pwappy');
        let targetPageUuid: string | null = null; // 名前ではなくUUIDで管理

        await test.step('1. 要素を追加してプロジェクトを書き出す', async () => {
            const setup = await editorHelper.setupPageWithButton();

            // ページの UUID を取得して保持する (インポート後も維持される)
            targetPageUuid = await setup.pageNode.getAttribute('data-node-id');
            console.log(`[Test] Captured Target Page UUID: ${targetPageUuid}`);

            await editorHelper.selectNodeInDomTree(setup.buttonNode);
            await editorHelper.openMoveingHandle('right');
            const textInput = editorHelper.getPropertyInput('text').locator('input');
            await textInput.fill(testButtonText);
            await textInput.press('Enter');

            await expect(editorHelper.getPreviewElement('ons-button')).toHaveText(testButtonText);

            const download = await editorHelper.exportProjectFile();
            await download.saveAs(downloadPath);
        });

        await test.step('2. 要素を削除する（破壊的変更）', async () => {
            await editorHelper.openMoveingHandle('left');
            const buttonNode = editorHelper.getDomTree().locator('.node[data-node-type="ons-button"]');
            await buttonNode.locator('.clear-icon').click();
            await buttonNode.locator('.clear-icon').click();
            await expect(buttonNode).toBeHidden();
        });

        await test.step('3. バックアップファイルをインポートする', async () => {
            await editorHelper.importProjectFile(downloadPath);

            // インポート後は内部状態が大きく書き換わるため、ローディングが消えるのをしっかり待つ
            const loading = editorPage.locator('app-container-loading-overlay');
            await expect(loading).toBeHidden({ timeout: 20000 });

            // UIのプロパティ（select-text等）が更新されるまでのバッファ
            await editorPage.waitForTimeout(2000);
            console.log(`[Test] Import process completed.`);
        });

        await test.step('4. 検証：削除した要素が復活していること', async () => {
            if (targetPageUuid) {
                console.log(`[Test] Restoring view using UUID: ${targetPageUuid}`);
                await editorHelper.switchTopLevelTemplate(targetPageUuid);
            }

            // ボタンの復活確認
            const restoredButton = editorHelper.getDomTree().locator('.node[data-node-type="ons-button"]');
            await expect(restoredButton).toBeVisible({ timeout: 10000 });

            const previewButton = editorHelper.getPreviewElement('ons-button');
            await expect(previewButton).toHaveText(testButtonText, { timeout: 15000 });
        });

        await test.step('5. 検証：インポート直前の自動スナップショットが作成されていること', async () => {
            await editorHelper.closeMoveingHandle();
            await editorPage.locator('#fab-bottom-menu-box').click();
            await editorPage.locator('#platformBottomMenu').getByText('スナップショット管理').click();
            const snapshotManager = editorPage.locator('snapshot-manager');
            await expect(snapshotManager.locator('.snapshot-item', { hasText: '自動保存 - インポート実行前' })).toBeVisible();
        });
    });
});