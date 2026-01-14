import { test as base, expect, Page, Locator } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, openEditor, setAiCoding } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

type EditorFixtures = {
    editorPage: Page;
    appName: string;
    editorHelper: EditorHelper;
};

const test = base.extend<EditorFixtures>({
    appName: async ({ }, use) => {
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
        await use(`snap-test-app-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName }, use) => {
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
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

test.describe('エディタ内：スナップショットと自動復旧機能のテスト', () => {

    test.beforeEach(async ({ page, context }) => {
        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        const domain = testUrl.hostname;
        await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/' },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/' },
            { name: 'pwappy_login', value: '1', domain: domain, path: '/' },
        ]);
        await page.goto(String(process.env.PWAPPY_TEST_BASE_URL), { waitUntil: 'domcontentloaded' });

        await setAiCoding(page, true);

        // 初期ローディング完了を待つ
        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });
    });

    test.afterEach(async ({ page }) => {
        await setAiCoding(page, false);
    });

    test('自動復旧フロー：未保存でのリロード後に「スナップショットから復元」ができるか', async ({ editorPage, editorHelper }) => {
        test.setTimeout(120000);

        const testButtonText = 'RECOVERY_TEST_BUTTON';
        let pageNode: Locator;
        let buttonNode: Locator;
        let pageNodeId: string;

        await test.step('1. データを変更し、保存せずにページを離脱する', async () => {
            //const { pageNode, buttonNode } = await editorHelper.setupPageWithButton();
            const setup = await editorHelper.setupPageWithButton();
            pageNode = setup.pageNode;
            pageNodeId = await pageNode.getAttribute('data-node-id') as string;
            buttonNode = setup.buttonNode;

            await editorHelper.selectNodeInDomTree(buttonNode);
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

    test('手動スナップショット：破壊的な変更をスナップショットで元に戻す', async ({ page, editorPage, editorHelper, appName }) => {
        // AIエージェントの起動を伴うためタイムアウトを延長
        test.setTimeout(150000);

        const snapshotName = '破壊的前のスナップショット';
        let pageId: string;

        await test.step('1. 正常な状態で手動スナップショットを作成', async () => {
            const setUp = await editorHelper.setupPageWithButton();
            pageId = await setUp.pageNode.getAttribute('data-node-id') as string;

            // AIエージェント画面を開く
            await editorPage.locator('#fab-bottom-menu-box').click();
            await editorPage.locator('#platformBottomMenu').getByText('AIエージェント').click();
            const agentWindow = editorPage.locator('agent-chat-window');
            await expect(agentWindow).toBeVisible();

            // 添付メニュー -> スナップショット保存
            await agentWindow.locator('button[title="添付"]').click();
            await agentWindow.locator('.attachment-menu button', { hasText: 'スナップショット保存' }).click();

            // 名前を入力して作成
            const modal = agentWindow.locator('.modal-dialog');
            await expect(modal).toBeVisible();
            await modal.locator('#snapshot-name').fill(snapshotName);
            await modal.getByRole('button', { name: '作成' }).click();

            // 履歴にスナップショットが表示されるのを待つ
            const snapshotItem = agentWindow.locator(`.snapshot-body:has-text("${snapshotName}")`);
            await expect(snapshotItem).toBeVisible({ timeout: 30000 });

            // エージェント画面を閉じる
            await agentWindow.locator('.close-btn').click();
        });

        await test.step('2. 破壊的な変更を加える（要素の削除）', async () => {
            const domTree = editorHelper.getDomTree();
            const buttonNode = domTree.locator('.node[data-node-type="ons-button"]').first();

            // 2回クリックで確実に削除
            await buttonNode.locator('.clear-icon').click();
            await buttonNode.locator('.clear-icon').click();

            await expect(buttonNode).toBeHidden();
        });

        await test.step('3. スナップショット管理画面から復元を実行', async () => {
            await editorPage.locator('#fab-bottom-menu-box').click();
            await editorPage.locator('#platformBottomMenu').getByText('スナップショット管理').click();

            const manager = editorPage.locator('snapshot-manager');
            await expect(manager.locator('h3', { hasText: 'スナップショット管理' })).toBeVisible();

            const item = manager.locator('.snapshot-item', { hasText: snapshotName });
            await expect(item).toBeVisible();

            // 復元実行
            editorPage.once('dialog', dialog => dialog.accept());
            await item.getByRole('button', { name: '復元' }).click();

        });

        await test.step('4. 削除した要素が復活していることを確認', async () => {
            // 復元対象のページに切り替え
            await editorHelper.switchTopLevelTemplate(pageId);
            const domTree = editorHelper.getDomTree();
            await expect(domTree.locator('.node[data-node-type="ons-button"]')).toBeVisible();
        });
    });

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

            // 検証:
            // 1. リロード前に作成されたはずの「自動保存 - 未保存」などの古いスナップショットは消えていること
            // 2. 仕様により「自動保存 - エディタ読み込み完了」は1つ残っていること
            // したがって、「保存されているスナップショットはありません」は表示されず、リストが表示される

            const listItems = manager.locator('.snapshot-item');

            // アイテム数が1つだけであることを確認（読み込み完了時の自動保存のみ）
            // ※環境によっては複数残る可能性もゼロではないため、少なくとも「未保存」系が消えていることを確認する方針でも良いが、
            //   ここでは「破棄」直後なので1件（初期化時作成）のみと想定する。
            await expect(listItems).toHaveCount(1);

            // 残っている1件が「エディタ読み込み完了」であることを確認
            await expect(listItems.first()).toContainText('自動保存 - エディタ読み込み完了');
        });
    });
});