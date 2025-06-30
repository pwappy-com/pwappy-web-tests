import { test, expect } from '@playwright/test';
import 'dotenv/config';
import {
    createApp,
    deleteApp,
    navigateToTab,
    startPublishPreparation,
    completePublication,
    unpublishVersion,
    expectVersionStatus,
} from '../../tools/dashboard-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

/**
 * 公開管理機能に関するE2Eテストスイートです。
 * アプリケーションバージョンの公開状態遷移を主に検証します。
 */
test.describe('公開管理 E2Eシナリオ', () => {

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
     * バージョンの公開ステータスが「非公開」→「公開準備中」→「公開準備完了」→「公開中」→「非公開」と
     * 正しく遷移することを一気通貫でテストします。
     */
    test('公開状態の遷移をテストする', async ({ page }) => {
        const timestamp = Date.now().toString();
        const uniqueId = `${testRunSuffix}-${timestamp}`;
        const appName = `公開テスト-${uniqueId}`;
        const appKey = `publish-test-${uniqueId}`;
        const version = '1.0.0';

        await test.step('セットアップ: テスト用のアプリケーションを作成する', async () => {
            await createApp(page, appName, appKey);
        });

        await test.step('事前確認: 公開タブで初期状態が「非公開」であることを確認', async () => {
            await navigateToTab(page, 'publish');
            const appRow = page.locator('.app-list tbody tr', { hasText: appName });
            await appRow.getByRole('button', { name: '選択' }).click();
            await expect(page.getByRole('heading', { name: `公開設定: ${appName}` })).toBeVisible();
            await expectVersionStatus(page, version, '非公開');
        });

        await test.step('状態遷移(1): バージョンを「公開準備中」にする', async () => {
            await startPublishPreparation(page, appName, version);

            // 状態遷移後のUIを検証
            await expectVersionStatus(page, version, '公開準備中');
            const versionRowAfter = page.locator('.publish-list tbody tr', { hasText: version });
            await expect(versionRowAfter.locator('.progress-circle-small')).toBeVisible(); // 進行中インジケータ
        });

        await test.step('状態遷移(2): 「公開準備完了」を経て「公開中」にし、その後「非公開」に戻す', async () => {
            test.setTimeout(120000); // 審査待ちが発生するためタイムアウトを延長

            // 「公開準備完了」を経て「公開中」への遷移
            await completePublication(page, appName, version);
            await expectVersionStatus(page, version, '公開中');

            // 「公開中」から「非公開」への遷移
            await unpublishVersion(page, appName, version);
            await expectVersionStatus(page, version, '非公開');
        });

        await test.step('クリーンアップ: 作成したアプリケーションを削除する', async () => {
            await deleteApp(page, appName);
            await navigateToTab(page, 'workbench');
            await expect(page.locator('.app-list tbody tr', { hasText: appName })).toBeHidden();
        });
    });
});