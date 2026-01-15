import { test as base, expect, Page, Locator } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';

/**
 * テスト実行ごとに一意の識別子を生成するための定数。
 * ローカル実行時やCI環境でのリソース競合を避けるために使用します。
 */
const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

/**
 * Playwrightのテストフィクスチャを拡張し、各テストで独立したアプリケーション名と
 * エディタ操作ヘルパーを提供します。
 */
type EditorFixtures = {
    editorPage: Page;
    appName: string;
    editorHelper: EditorHelper;
};

const test = base.extend<EditorFixtures>({
    appName: async ({ }, use) => {
        // 時刻を逆順にした文字列とサフィックスを組み合わせ、重複しにくいアプリ名を作成
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        await use(`snap-test-app-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName }, use) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appKey = `snap-key-${uniqueId}`.slice(0, 30);

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

/**
 * スナップショット管理および自動復旧機能のテストスイート。
 */
test.describe('スナップショットと自動復旧機能の統合テスト', () => {

    /**
     * 各テスト実行前の共通セットアップ処理。
     */
    test.beforeEach(async ({ page, context }) => {
        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        const domain = testUrl.hostname;

        // 環境変数から認証情報を取得してCookieを設定
        await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/' },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/' },
            { name: 'pwappy_login', value: '1', domain: domain, path: '/' },
        ]);

        // ダッシュボードページへ移動
        await page.goto(String(process.env.PWAPPY_TEST_BASE_URL), { waitUntil: 'domcontentloaded' });

        // ログイン成功を確認
        await expect(page.getByRole('heading', { name: 'アプリケーション一覧' })).toBeVisible();

        // 初期ローディング完了を待つ
        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });
    });

    /**
     * 各テスト実行後の共通処理。
     */
    test.afterEach(async ({ page }) => {

    });

    /**
     * 手動でのスナップショット作成、変更、および復元フローを検証します。
     * （旧 snapshots.spec.ts より）
     */
    test('スナップショットの作成と復元ができる', async ({ editorPage, isMobile, appName, editorHelper }) => {
        const uniqueSnapshotName = `test-snapshot-${Date.now()}`;

        // 手動保存・復元のフロー
        try {
            await test.step('1. 新しいスナップショットを保存', async () => {
                const menuButton = editorPage.locator('#fab-bottom-menu-box');
                await menuButton.click();

                const platformBottomMenu = editorPage.locator('#platformBottomMenu');
                await platformBottomMenu.getByText('スナップショット管理').click();

                const snapshotManager = editorPage.locator('snapshot-manager');
                await expect(snapshotManager.locator('.container')).toBeVisible();

                await snapshotManager.getByRole('button', { name: '新規スナップショット' }).click();

                const saveDialog = editorPage.locator('snapshot-save-dialog');
                await saveDialog.locator('#snapshot-name').fill(uniqueSnapshotName);
                await saveDialog.locator('#snapshot-description').fill('E2E Test Snapshot');
                await saveDialog.getByRole('button', { name: '保存' }).click();

                await expect(saveDialog).toBeHidden();
                await expect(snapshotManager.locator('.snapshot-item', { hasText: uniqueSnapshotName })).toBeVisible();

                // 管理画面を一度閉じる
                await snapshotManager.locator('.close-btn').click();
            });

            await test.step('2. アプリケーションを編集（ボタンを追加）', async () => {
                await editorHelper.addPage();
                const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
                await editorHelper.addComponent('ons-button', contentAreaSelector);

                // プレビュー上にボタンが存在することを確認
                const previewButton = editorHelper.getPreviewElement('ons-button');
                await expect(previewButton).toBeVisible();
            });

            await test.step('3. スナップショットから復元を実行', async () => {
                const menuButton = editorPage.locator('#fab-bottom-menu-box');
                await menuButton.click();
                await editorPage.locator('#platformBottomMenu').getByText('スナップショット管理').click();

                const snapshotManager = editorPage.locator('snapshot-manager');
                const snapshotItem = snapshotManager.locator('.snapshot-item', { hasText: uniqueSnapshotName });
                const restoreButton = snapshotItem.getByRole('button', { name: '復元' });

                // ダイアログハンドリングの準備（確認ダイアログと完了アラート）
                editorPage.once('dialog', async confirmDialog => {
                    expect(confirmDialog.message()).toContain('現在の編集内容は破棄され');
                    editorPage.once('dialog', async alertDialog => {
                        expect(alertDialog.message()).toBe('スナップショットを復元しました。');
                        await alertDialog.dismiss();
                    });
                    await confirmDialog.accept();
                });

                await restoreButton.click({ noWaitAfter: true });
                await expect(snapshotManager).toBeHidden();
            });

            await test.step('4. 復元後の状態確認（追加したボタンが消えていること）', async () => {
                const previewButton = editorHelper.getPreviewElement('ons-button');
                await expect(previewButton).toBeHidden();
            });
        } finally {
            // フィクスチャで閉じるため、ここでの明示的な close は省略可能だが、元の構造を維持
        }
    });

    /**
     * 未保存の状態でのリロードによる自動復旧を検証します。
     */
    test('自動復旧フロー：未保存でのリロード後に「スナップショットから復元」ができるか', async ({ editorPage, editorHelper }) => {
        test.setTimeout(120000);

        const testButtonText = 'RECOVERY_TEST_BUTTON';
        let pageNodeId: string;

        await test.step('1. データを変更し、保存せずにページを離脱する', async () => {
            const setup = await editorHelper.setupPageWithButton();
            pageNodeId = await setup.pageNode.getAttribute('data-node-id') as string;

            await editorHelper.selectNodeInDomTree(setup.buttonNode);
            await editorHelper.openMoveingHandle('right');

            // プロパティ変更
            const textInput = editorHelper.getPropertyInput('text').locator('input');
            await textInput.fill(testButtonText);
            await textInput.press('Enter');

            // プレビュー反映確認
            const previewFrame = editorHelper.getPreviewFrame();
            await expect(previewFrame.locator('ons-button')).toHaveText(testButtonText);

            // リロード（beforeunloadイベントをトリガーして自動保存させる）
            await editorPage.evaluate(() => window.location.reload());
        });

        await test.step('2. 起動時の復旧ダイアログで「復元する」を選択', async () => {
            // ダイアログが表示されるのを待つ
            const restoreDialog = editorPage.locator('message-box', { hasText: '前回正常に終了されなかった可能性' });
            await expect(restoreDialog).toBeVisible({ timeout: 20000 });

            await restoreDialog.getByRole('button', { name: '復元する' }).click();
            // pageNodeを表示する
            await editorHelper.switchTopLevelTemplate(pageNodeId);
        });

        await test.step('3. データが完全に復元されていることを検証', async () => {
            const domTree = editorHelper.getDomTree();
            // ツリーが再描画されるのを待つ
            await expect(domTree.locator('.node')).not.toHaveCount(0);

            const buttonNode = domTree.locator('.node[data-node-type="ons-button"]');
            await expect(buttonNode).toBeVisible();

            // プレビュー上の表示も復元されているか
            const previewFrame = editorHelper.getPreviewFrame();
            await expect(previewFrame.locator('ons-button')).toHaveText(testButtonText);
        });
    });

    /**
     * スナップショットの破棄フローを検証します。
     */
    test('スナップショットの削除と「破棄」フローの検証', async ({ editorPage, editorHelper }) => {
        // --- 事前クリーンアップ（既存データの破棄） ---
        await test.step('0. 事前クリーンアップ', async () => {
            await editorPage.reload({ waitUntil: 'domcontentloaded' });
            // ダイアログが出たら破棄するヘルパー
            await editorHelper.handleSnapshotRestoreDialog();
        });

        await test.step('1. スナップショットを作成', async () => {
            await editorHelper.addPage();
            // リロードして自動スナップショットを作成させる
            await editorPage.evaluate(() => window.location.reload());
        });

        await test.step('2. 起動時の復旧ダイアログで「破棄」を選択', async () => {
            const restoreDialog = editorPage.locator('message-box', { hasText: '前回正常に終了されなかった可能性' });
            await expect(restoreDialog).toBeVisible({ timeout: 20000 });

            await restoreDialog.getByRole('button', { name: '破棄する' }).click();

            // 確認ダイアログ
            const discardConfirm = editorPage.locator('message-box', { hasText: 'すべてのスナップショットを破棄しますか？' });
            await expect(discardConfirm).toBeVisible();
            await discardConfirm.getByRole('button', { name: 'はい、破棄します' }).click();

            // // 完了メッセージ（非同期処理待ちのため toPass を使用）
            // await expect(async () => {
            //     const alert = editorPage.locator('alert-component');
            //     await expect(alert).toBeVisible();
            //     await expect(alert).toContainText('不要なスナップショットを破棄しました');
            // }).toPass({ timeout: 15000 });

            // await editorPage.locator('alert-component').getByRole('button', { name: '閉じる' }).click();
        });

        await test.step('3. スナップショット管理画面の状態確認', async () => {
            await editorPage.locator('#fab-bottom-menu-box').click();
            await editorPage.locator('#platformBottomMenu').getByText('スナップショット管理').click();

            const manager = editorPage.locator('snapshot-manager');
            const managerTitle = editorPage.locator('h3', { hasText: 'スナップショット管理' });
            await expect(managerTitle).toBeVisible();

            const listItems = manager.locator('.snapshot-item');

            // 検証:
            // 1. リロード前に作成されたはずの「自動保存 - 未保存」などの古いスナップショットは消えていること
            // 2. 仕様により「自動保存 - エディタ読み込み完了」は1つ残っていること
            await expect(listItems).toHaveCount(1);
            await expect(listItems.first()).toContainText('自動保存 - エディタ読み込み完了');
        });
    });
});