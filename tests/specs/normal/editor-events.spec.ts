import { test as base, expect, Page } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';
import { STORAGE_STATE } from '../../constants';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

let appName: string;
let appKey: string;

/**
 * テストフィクスチャ
 */
type EditorFixtures = {
    editorPage: Page;
    editorHelper: EditorHelper;
};
const test = base.extend<EditorFixtures>({
    editorPage: async ({ page, context }, use) => {
        await gotoDashboard(page);
        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });

        // 作成済みの共有アプリ詳細画面へ移動
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

// テスト全体の開始前に、アプリを1回だけ作成する
test.beforeAll(async ({ browser }) => {
    const reversedTimestamp = Date.now().toString().split('').reverse().join('');
    const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
    appName = `test-evt-ui-${uniqueId}`.slice(0, 30);
    appKey = `evt-ui-key-${uniqueId}`.slice(0, 30);

    // 認証済みの状態を引き継ぐためのコンテキストを作成（STORAGE_STATE定数を使用）
    const context = await browser.newContext({ storageState: STORAGE_STATE });
    const page = await context.newPage();

    await gotoDashboard(page);
    await createApp(page, appName, appKey);

    await context.close();
});

// すべてのテストが終了した後に、アプリを1回だけ削除する
test.afterAll(async ({ browser }) => {
    if (appKey) {
        const context = await browser.newContext({ storageState: STORAGE_STATE });
        const page = await context.newPage();

        await gotoDashboard(page);
        await deleteApp(page, appKey);

        await context.close();
    }
});

// --- テストスイート ---
test.describe('エディタ内イベント＆スクリプト機能のUIテスト（保存なし）', () => {

    test('カスタムイベントを定義できる', async ({ editorPage, editorHelper }) => {
        const listenerTarget = 'element';
        const eventName = 'test-event';
        const comment = 'テストコメント';

        await test.step('1. 新しいイベント定義を追加する', async () => {
            await editorHelper.addCustomEventDefinition({
                listenerTarget,
                eventName,
                comment,
            });
        });
    });

    test('サービスワーカータブでカスタムイベントを定義できる', async ({ editorPage, editorHelper }) => {
        const eventName = 'new-serviceworker-event';
        const comment = '新しいサービスワーカーイベント';

        await test.step('1. 新しいサービスワーカーイベント定義を追加する', async () => {
            await editorHelper.addCustomServiceWorkerEventDefinition({
                eventName,
                comment,
            });
        });
    });

    test('スクリプトエラーがある場合、タブ移動と保存がブロックされる', async ({ editorPage, editorHelper }) => {
        const scriptName = 'errorScript';
        const invalidScript = 'const 0a = 1;'; // 不正な変数名
        const expectedDialogMessage = 'スクリプトのエラーを修正してください';

        await test.step('セットアップ: エラーのあるスクリプトを入力する', async () => {
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await editorHelper.addNewScript(scriptName, 'function');
            // ヘルパーメソッドを使って、保存せずに不正なスクリプトを入力
            await editorHelper.fillScriptContent(scriptName, invalidScript);
        });

        await test.step('検証: 他のタブに移動しようとするとダイアログが表示されブロックされる', async () => {
            const scriptContainer = editorPage.locator('script-container');
            const monacoEditor = scriptContainer.locator('.monaco-editor[role="code"]');
            const alertDialog = editorPage.locator('alert-component');

            // テスト対象のタブ（イベント、サービスワーカー）
            const tabsToTest = ['イベント', 'サービスワーカー'];

            for (const tabName of tabsToTest) {
                // タブをクリック
                await scriptContainer.locator('.tab', { hasText: tabName }).click();

                // ダイアログを検証
                await expect(alertDialog).toBeVisible();
                await expect(alertDialog).toContainText(expectedDialogMessage);
                await alertDialog.getByRole('button', { name: '閉じる' }).click();
                await expect(alertDialog).toBeHidden();

                // エディタ（Monaco）が表示されたままであることを確認
                await expect(monacoEditor).toBeVisible();
                // 対応するタブのコンテナが表示されていないことを確認
                if (tabName === 'イベント') {
                    await expect(scriptContainer.locator('event-container')).toBeHidden();
                } else if (tabName === 'サービスワーカー') {
                    await expect(scriptContainer.locator('service-worker-container')).toBeHidden();
                }
            }
        });

        await test.step('検証: 保存しようとするとダイアログが表示されブロックされる', async () => {
            const scriptContainer = editorPage.locator('script-container');
            const monacoEditor = scriptContainer.locator('.monaco-editor[role="code"]');
            const saveButton = scriptContainer.locator('#fab-save');
            const alertDialog = editorPage.locator('alert-component');

            // 保存ボタンをクリック
            await saveButton.click();

            // ダイアログを検証
            await expect(alertDialog).toBeVisible();
            await expect(alertDialog).toContainText(expectedDialogMessage);
            await alertDialog.getByRole('button', { name: '閉じる' }).click();
            await expect(alertDialog).toBeHidden();

            // エディタ（Monaco）が表示されたままであることを確認
            await expect(monacoEditor).toBeVisible();
        });
    });
});