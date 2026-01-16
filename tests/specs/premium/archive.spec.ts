/**
 * @file アプリケーション管理機能（新規作成、編集、削除、アーカイブなど）に関するE2Eテストです。
 * 各テストケースは、ダッシュボード上でのユーザー操作をシミュレートし、
 * 機能が正しく動作することを検証します。
 */
import { test, expect, Page } from '@playwright/test';
import 'dotenv/config';
import {
    createApp,
    deleteApp,
    navigateToTab,
    expectAppVisibility
} from '../../tools/dashboard-helpers';

test.describe.configure({ mode: 'serial' });

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

test.describe('アーカイブ E2Eシナリオ', () => {

    // 各テストの実行前に認証情報を設定し、ダッシュボードの初期ページに遷移します。
    test.beforeEach(async ({ page, context }) => {
        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        const domain = testUrl.hostname;
        await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/' },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/' },
            { name: 'pwappy_login', value: '1', domain: domain, path: '/' },
        ]);
        await page.goto(String(process.env.PWAPPY_TEST_BASE_URL), { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: 'アプリケーション一覧' })).toBeVisible();
    });

    test('WB-APP-ARC & AR-APP-REST: アプリケーションのアーカイブと復元', async ({ page }) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appName = `アーカイブテスト-${uniqueId}`.slice(0, 30);
        const appKey = `archive-app-${uniqueId}`.slice(0, 30);

        await test.step('セットアップ: アーカイブ対象のアプリを作成', async () => {
            await createApp(page, appName, appKey);
            await expectAppVisibility(page, appKey, true);
        });

        await test.step('テスト: アプリケーションをアーカイブする', async () => {
            const appRow = page.locator('.app-list tbody tr', { hasText: appName });
            await appRow.getByRole('button', { name: 'アーカイブ' }).click();

            // アーカイブ確認ダイアログで実行します。
            const confirmDialog = page.locator('message-box#archive-confirm');
            await expect(confirmDialog).toBeVisible();
            await confirmDialog.getByRole('button', { name: 'アーカイブ' }).click();

            await expect(page.locator('dashboard-loading-overlay')).toBeHidden({ timeout: 150000 });

            // 成功メッセージが表示され、ワークベンチの一覧から消えることを確認します。
            const alertDialog = page.locator('alert-component');
            await expect(alertDialog).toBeVisible();
            await expect(alertDialog).toContainText(`アプリ「${appKey}」をアーカイブしました`);
            await alertDialog.getByRole('button', { name: '閉じる' }).click();

            await expectAppVisibility(page, appKey, false);
        });

        await test.step('テスト: アーカイブタブで表示されることを確認', async () => {
            await navigateToTab(page, 'archive');
            await expectAppVisibility(page, appKey, true);
        });

        await test.step('テスト: アーカイブから復元する', async () => {
            await navigateToTab(page, 'archive');

            const archiveRow = page.locator('.app-list tbody tr', { hasText: appName });
            await archiveRow.getByRole('button', { name: 'ワークベンチに復元' }).click();

            // 復元確認ダイアログで実行します。
            const confirmDialog = page.locator('message-box#restore-confirm');
            await expect(confirmDialog).toBeVisible();
            await confirmDialog.getByRole('button', { name: '復元' }).click();

            await expect(page.locator('dashboard-loading-overlay')).toBeHidden({ timeout: 150000 });

            // 成功メッセージが表示されることを確認します。
            const alertDialog = page.locator('alert-component');
            await expect(alertDialog).toBeVisible();
            await expect(alertDialog).toContainText(`アプリ「${appKey}」をアーカイブからワークベンチに復元しました`);
            await alertDialog.getByRole('button', { name: '閉じる' }).click();

            // アーカイブタブの一覧から消えることを確認します。
            await navigateToTab(page, 'archive');
            await expectAppVisibility(page, appKey, false);
        });

        await test.step('クリーンアップ: 復元後、ワークベンチで削除する', async () => {
            await navigateToTab(page, 'workbench');
            await expectAppVisibility(page, appKey, true);
            await deleteApp(page, appKey);
            await expectAppVisibility(page, appKey, false);
        });
    });
});