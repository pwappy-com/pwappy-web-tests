import { test, expect } from '@playwright/test';
import 'dotenv/config';
import {
    createApp,
    deleteApp,
    navigateToTab,
    startPublishPreparation,
    completePublication,
    unpublishVersion
} from '../../tools/dashboard-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

/**
 * アプリケーションやバージョンが特定の公開状態にある場合に、
 * 編集や削除が適切に制限（ガード）されるかを検証するテストスイートです。
 */
test.describe('削除・編集のガード条件テスト', () => {

    /**
     * 各テストの実行前に、認証とダッシュボードへのアクセスを行います。
     */
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

    /**
     * アプリのバージョンが「公開準備中」および「公開中」の状態において、
     * アプリ本体とバージョンの編集・削除ボタンが期待通りに非活性化されることをテストします。
     */
    test('公開準備中および公開中のアプリ/バージョンは編集・削除できない', async ({ page }) => {
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
        const appName = `ガード条件テスト-${uniqueId}`.slice(0, 30);
        const appKey = `guard-test-${uniqueId}`.slice(0, 30);
        const version = '1.0.0';

        await test.step('セットアップ: アプリを作成しバージョンを「公開準備中」にする', async () => {
            await createApp(page, appName, appKey);
            await startPublishPreparation(page, appName, version);
        });

        await test.step('テスト(公開準備中): アプリとバージョンの編集/削除ボタンの状態を確認', async () => {
            // ワークベンチタブでアプリのボタン状態を確認
            await navigateToTab(page, 'workbench');
            const appRow = page.locator('.app-list tbody tr', { hasText: appName });
            await expect(appRow.getByRole('button', { name: '編集' })).toBeDisabled();
            await expect(appRow.getByRole('button', { name: '削除' })).toBeEnabled(); // 公開準備中はアプリ削除が可能

            // バージョン管理画面でバージョンのボタン状態を確認
            await appRow.getByRole('button', { name: '選択' }).click();
            await expect(page.getByRole('heading', { name: 'バージョン管理' })).toBeVisible();
            const versionRow = page.locator('.version-list tbody tr', { hasText: version });
            await expect(versionRow.getByRole('button', { name: '編集' })).toBeDisabled();
            await expect(versionRow.getByRole('button', { name: '削除' })).toBeEnabled(); // 公開準備中はバージョン削除が可能
        });

        await test.step('状態遷移: バージョンを「公開中」にする', async () => {
            test.setTimeout(120000); // 審査待ちが発生するためタイムアウトを延長
            await completePublication(page, appName, version);
        });

        await test.step('テスト(公開中): アプリとバージョンの編集/削除ボタンが非活性であることを確認', async () => {
            // ワークベンチタブでアプリのボタン状態を確認
            await navigateToTab(page, 'workbench');
            const appRow = page.locator('.app-list tbody tr', { hasText: appName });
            await expect(appRow.getByRole('button', { name: '編集' })).toBeDisabled();
            await expect(appRow.getByRole('button', { name: '削除' })).toBeDisabled();

            // バージョン管理画面でバージョンのボタン状態を確認
            await appRow.getByRole('button', { name: '選択' }).click();
            await expect(page.getByRole('heading', { name: 'バージョン管理' })).toBeVisible();
            const versionRow = page.locator('.version-list tbody tr', { hasText: version });
            await expect(versionRow.getByRole('button', { name: '編集' })).toBeDisabled();
            await expect(versionRow.getByRole('button', { name: '削除' })).toBeDisabled();
        });

        await test.step('クリーンアップ: バージョンを非公開にし、アプリを削除する', async () => {
            await unpublishVersion(page, appName, version);

            // 削除ボタンが活性化したことを確認してから削除を実行
            await navigateToTab(page, 'workbench');
            const appRowWorkbench = page.locator('.app-list tbody tr', { hasText: appName });
            await expect(appRowWorkbench.getByRole('button', { name: '削除' })).toBeEnabled();
            await deleteApp(page, appName);

            // 最終的にリストから消えたことを確認
            const appNameCell = page.locator('.app-list tbody tr td:first-child', { hasText: new RegExp(`^${appName}$`) });
            await expect(appNameCell).toBeHidden();
        });
    });
});