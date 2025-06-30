import { test, expect } from '@playwright/test';
import 'dotenv/config';
import {
    createApp,
    deleteApp,
    startPublishPreparation,
    completePublication,
    unpublishVersion,
    expectVersionStatus,
    downloadVersion,
    expectAppVisibility
} from '../../tools/dashboard-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

// --- テストシナリオ ---
test.describe('公開管理 E2Eシナリオ', () => {

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

    test('公開状態の遷移とダウンロード機能をテストする', async ({ page }) => {
        const timestamp = Date.now().toString();
        const uniqueId = `${testRunSuffix}-${timestamp}`;
        const appName = `公開機能テスト-${uniqueId}`.slice(0, 30);
        const appKey = `publish-test-${uniqueId}`.slice(0, 30);
        const version = '1.0.0';

        await test.step('セットアップ: テスト用のアプリケーションを作成する', async () => {
            await createApp(page, appName, appKey);
        });

        await test.step('テスト: 公開状態の遷移（非公開 -> 準備中 -> 準備完了 -> 公開 -> 非公開）', async () => {
            test.setTimeout(120000);

            // 公開準備を開始
            await startPublishPreparation(page, appName, version);
            await expectVersionStatus(page, version, '公開準備中');

            // 公開準備完了を経て公開中にする
            await completePublication(page, appName, version);
            await expectVersionStatus(page, version, '公開中');

            // 非公開に戻す
            await unpublishVersion(page, appName, version);
            await expectVersionStatus(page, version, '非公開');
        });

        await test.step('テスト: ダウンロード機能を確認する', async () => {
            await downloadVersion(page, { appName, appKey, version });
        });

        await test.step('クリーンアップ: 作成したアプリケーションを削除する', async () => {
            await deleteApp(page, appName);
            await expectAppVisibility(page, appName, false); // 汎用ヘルパーで確認
        });
    });
});