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
    gotoDashboard,
} from '../../tools/dashboard-helpers';

test.describe.configure({ mode: 'serial' });

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
        await gotoDashboard(page);
        await expect(page.getByRole('heading', { name: 'アプリケーション一覧' })).toBeVisible();
    });

    /**
     * バージョンの公開ステータスが「非公開」→「公開準備中」→「公開準備完了」→「公開中」→「非公開」と
     * 正しく遷移することを一気通貫でテストします。
     */
    test('公開状態の遷移をテストする', async ({ page }) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appName = (`公開テスト-${uniqueId}`).slice(0, 30);
        const appKey = (`publish-test-${uniqueId}`).slice(0, 30);
        const version = '1.0.0';

        await test.step('セットアップ: テスト用のアプリケーションを作成する', async () => {
            await createApp(page, appName, appKey);
        });

        await test.step('事前確認: 公開タブで初期状態が「非公開」であることを確認', async () => {
            await navigateToTab(page, 'publish');
            const appRow = page.locator('.app-card', { hasText: appName });
            await appRow.getByRole('button', { name: /選択/ }).click();
            await expect(page.getByRole('heading', { name: new RegExp(`公開設定:.*${appName}`) })).toBeVisible();
            await expectVersionStatus(page, version, '非公開');
        });

        await test.step('状態遷移(1): バージョンを「公開準備中」にする', async () => {
            await startPublishPreparation(page, appName, version);

            // 状態遷移後のUIを検証
            await expectVersionStatus(page, version, '公開準備中');
            const versionRowAfter = page.locator('.version-card', { hasText: version });
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
            await deleteApp(page, appKey);
            await navigateToTab(page, 'workbench');
            await expect(page.locator('.app-card', { hasText: appName })).toBeHidden();
        });
    });
});