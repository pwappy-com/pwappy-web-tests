import { test as base, expect, Page } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor, navigateToTab } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

type EditorFixtures = {
    editorPage: Page;
    appName: string;
    appKey: string;
    editorHelper: EditorHelper;
};

// 各テストごとにアプリを作成し、エディタを別タブで開くフィクスチャ
const test = base.extend<EditorFixtures>({
    appName: async ({ }, use) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        await use(`del-sync-${uniqueId}`.slice(0, 30));
    },
    appKey: async ({ }, use) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        await use(`del-sync-key-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName, appKey }, use) => {
        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        var domain: string = testUrl.hostname;
        if (domain !== 'localhost') {
            domain = '.' + domain;
        }

        // ログイン状態のセットアップ
        await context.clearCookies();
        await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 },
            { name: 'pwappy_login', value: process.env.PWAPPY_LOGIN!, domain: domain, path: '/', secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 },
        ]);
        await gotoDashboard(page);
        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });

        // アプリを作成し、エディタを新しいタブで開く
        await createApp(page, appName, appKey);
        const editorPage = await openEditor(page, context, appName);

        await use(editorPage);

        // テスト終了時のクリーンアップ
        await editorPage.close();
        await page.bringToFront();
        await deleteApp(page, appKey);
    },
    editorHelper: async ({ editorPage, isMobile }, use) => {
        const helper = new EditorHelper(editorPage, isMobile);
        await use(helper);
    },
});

test.describe('エディタ内：バックグラウンドでの削除同期テスト', () => {

    test('【保存アクション検知】エディタを開いたままアプリが削除された場合、エラーダイアログが表示される', async ({ page, editorPage, appKey }) => {
        await test.step('ダッシュボードでアプリを削除する', async () => {
            // ダッシュボード側のタブをアクティブにしてアプリを削除
            await page.bringToFront();
            await deleteApp(page, appKey);
        });

        await test.step('エディタ画面に戻り、保存操作でアプリケーション削除が検知されることを確認', async () => {
            // エディタのタブに戻る
            await editorPage.bringToFront();

            // API通信を発生させて削除を検知させるため、保存を実行する
            const menuButton = editorPage.locator('#fab-bottom-menu-box');
            await menuButton.click();
            const platformBottomMenu = editorPage.locator('#platformBottomMenu');
            await expect(platformBottomMenu).toBeVisible();
            await platformBottomMenu.getByText('保存', { exact: true }).click();

            // アラートにメッセージが出るか確認
            const alert = editorPage.locator('alert-component');
            await expect(alert).toBeVisible({ timeout: 15000 });
            await expect(alert).toContainText(/アプリケーションが見つかりません/);

            // ダイアログを閉じる
            await alert.getByRole('button', { name: '閉じる' }).click();
        });
    });

    test('【リロード時検知】アプリ削除後にエディタをリロードした場合、エラーダイアログが表示される', async ({ page, editorPage, appKey }) => {
        await test.step('ダッシュボードでアプリを削除する', async () => {
            await page.bringToFront();
            await deleteApp(page, appKey);
        });

        await test.step('エディタ画面をリロードし、アプリケーション削除が検知されることを確認', async () => {
            await editorPage.bringToFront();

            // ページをリロードする
            await editorPage.reload({ waitUntil: 'domcontentloaded' });

            // リロード直後の初期化通信でエラーになるため、アラートが表示されるか確認
            const alert = editorPage.locator('alert-component');
            await expect(alert).toBeVisible({ timeout: 15000 });
            await expect(alert).toContainText(/アプリケーションが見つかりません/);
        });
    });

    test('【保存アクション検知】エディタを開いたままバージョンが削除された場合、エラーダイアログが表示される', async ({ page, editorPage, appName }) => {
        await test.step('ダッシュボードで現在開いているバージョンを削除する', async () => {
            await page.bringToFront();

            // バージョン管理画面を開く
            await navigateToTab(page, 'workbench');
            const appRow = page.locator('.app-list tbody tr', { hasText: appName }).first();
            await appRow.getByRole('button', { name: '選択' }).click();
            await expect(page.getByRole('heading', { name: 'バージョン管理' })).toBeVisible();

            // 開いているバージョン（1.0.0）を削除する
            const versionRow = page.locator('.version-list tbody tr', { hasText: '1.0.0' }).first();
            await versionRow.getByRole('button', { name: '削除' }).click();

            const confirmDialog = page.locator('message-box#delete-confirm');
            await expect(confirmDialog).toBeVisible();
            await confirmDialog.getByRole('button', { name: '削除する' }).click();

            await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
            await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
        });

        await test.step('エディタ画面に戻り、保存操作でバージョン削除が検知されることを確認', async () => {
            await editorPage.bringToFront();

            // 保存を実行してAPI通信を発生させる
            const menuButton = editorPage.locator('#fab-bottom-menu-box');
            await menuButton.click();
            const platformBottomMenu = editorPage.locator('#platformBottomMenu');
            await expect(platformBottomMenu).toBeVisible();
            await platformBottomMenu.getByText('保存', { exact: true }).click();

            // アラートにメッセージが出るか確認
            const alert = editorPage.locator('alert-component');
            await expect(alert).toBeVisible({ timeout: 15000 });
            await expect(alert).toContainText(/バージョンが見つかりません/);

            await alert.getByRole('button', { name: '閉じる' }).click();
        });
    });

    test('【リロード時検知】バージョン削除後にエディタをリロードした場合、エラーダイアログが表示される', async ({ page, editorPage, appName }) => {
        await test.step('ダッシュボードで現在開いているバージョンを削除する', async () => {
            await page.bringToFront();

            await navigateToTab(page, 'workbench');
            const appRow = page.locator('.app-list tbody tr', { hasText: appName }).first();
            await appRow.getByRole('button', { name: '選択' }).click();
            await expect(page.getByRole('heading', { name: 'バージョン管理' })).toBeVisible();

            const versionRow = page.locator('.version-list tbody tr', { hasText: '1.0.0' }).first();
            await versionRow.getByRole('button', { name: '削除' }).click();

            const confirmDialog = page.locator('message-box#delete-confirm');
            await expect(confirmDialog).toBeVisible();
            await confirmDialog.getByRole('button', { name: '削除する' }).click();

            await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
            await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
        });

        await test.step('エディタ画面をリロードし、バージョン削除が検知されることを確認', async () => {
            await editorPage.bringToFront();

            // ページをリロードする
            await editorPage.reload({ waitUntil: 'domcontentloaded' });

            // リロード直後の初期化通信でエラーになるため、アラートが表示されるか確認
            const alert = editorPage.locator('alert-component');
            await expect(alert).toBeVisible({ timeout: 15000 });
            await expect(alert).toContainText(/バージョンが見つかりません/);
        });
    });

});