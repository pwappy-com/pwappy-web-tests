import { test as base, expect, Page } from '@playwright/test';
import 'dotenv/config';
import {
    createApp,
    deleteApp,
    gotoDashboard,
    openEditor,
    expectAppVisibility // 必要に応じて追加
} from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';
import * as path from 'path';
import { text } from 'stream/consumers';

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

        // 1. アプリケーション作成
        await createApp(page, appName, appKey);

        // 【修正ポイント】新規作成後は詳細画面 (dashboard-app-detail) に自動遷移するため、
        // その表示を待機してからエディタを開く動作に移る
        await expect(page.locator('dashboard-app-detail')).toBeVisible({ timeout: 15000 });

        // 2. エディタを開く
        // openEditorの実装が「詳細画面のボタンを押す」もしくは「ワークベンチから探す」の
        // いずれであっても動作するように、必要なら遷移を挟む（ここでは詳細画面から開く想定）
        const editorPage = await openEditor(page, context, appName);

        await use(editorPage);

        // 3. クリーンアップ
        await editorPage.close();

        // 【修正ポイント】削除を行う前に、確実にダッシュボード（ワークベンチ）の状態に戻す
        await gotoDashboard(page);
        await deleteApp(page, appKey);
    },
    editorHelper: async ({ editorPage, isMobile }, use) => {
        const helper = new EditorHelper(editorPage, isMobile);
        await use(helper);
    },
});

test.describe('プロジェクトのバックアップ・インポート統合テスト', () => {

    test.beforeEach(async ({ page }) => {
        // フィクスチャで作成した後のメインページの状態を整える
        await gotoDashboard(page);
    });

    test('エクスポートしたバックアップファイルから要素を完全に復元できる', async ({ editorPage, editorHelper }, testInfo) => {
        const testButtonText = 'BACKUP_VERIFY_BUTTON';
        const downloadPath = path.join(testInfo.outputDir, 'test-project.pwappy');
        let targetPageUuid: string | null = null;

        await test.step('1. 要素を追加してプロジェクトを書き出す', async () => {
            const setup = await editorHelper.setupPageWithButton();
            targetPageUuid = await setup.pageNode.getAttribute('data-node-id');

            await editorHelper.selectNodeInDomTree(setup.buttonNode);
            await editorHelper.openMoveingHandle('right');

            // プロパティ入力のセレクターがエディタ側で変更されていないか注意が必要ですが、
            // 現状は既存のヘルパーを利用します
            const textInput = editorHelper.getPropertyInput('text').locator('input');
            await expect(textInput).toBeEditable();
            await textInput.fill(testButtonText);
            await textInput.press('Enter');

            await expect(editorHelper.getPreviewElement('ons-button')).toHaveText(testButtonText);

            const download = await editorHelper.exportProjectFile();
            await download.saveAs(downloadPath);
        });

        await test.step('2. 要素を削除する（破壊的変更）', async () => {
            await editorHelper.openMoveingHandle('left');
            const buttonNode = editorHelper.getDomTree().locator('.node[data-node-type="ons-button"]');
            // 要素削除の操作
            await buttonNode.locator('.clear-icon').click();
            await buttonNode.locator('.clear-icon').click();
            await expect(buttonNode).toBeHidden();
        });

        await test.step('3. バックアップファイルをインポートする', async () => {
            await editorHelper.importProjectFile(downloadPath);

            // インポート後のオーバーレイ非表示を待機
            const loading = editorPage.locator('app-container-loading-overlay');
            await expect(loading).toBeHidden({ timeout: 20000 });

            await editorPage.waitForTimeout(2000);
        });

        await test.step('4. 検証：削除した要素が復活していること', async () => {
            if (targetPageUuid) {
                await editorHelper.switchTopLevelTemplate(targetPageUuid);
            }

            const restoredButton = editorHelper.getDomTree().locator('.node[data-node-type="ons-button"]');
            await expect(restoredButton).toBeVisible({ timeout: 10000 });

            const previewButton = editorHelper.getPreviewElement('ons-button');
            await expect(previewButton).toHaveText(testButtonText, { timeout: 15000 });
        });

        await test.step('5. 検証：インポート直前の自動スナップショットが作成されていること', async () => {
            await editorHelper.closeMoveingHandle();
            // 下部メニューの操作
            await editorPage.locator('#fab-bottom-menu-box').click();
            const bottomMenu = editorPage.locator('#platformBottomMenu');
            await expect(bottomMenu).toBeVisible();
            await bottomMenu.getByText('スナップショット管理').click();

            const snapshotManager = editorPage.locator('snapshot-manager');
            await expect(snapshotManager.locator('.snapshot-item', { hasText: '自動保存 - インポート実行前' })).toBeVisible();
        });
    });
});