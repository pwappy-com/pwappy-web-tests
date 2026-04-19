import { test, expect } from '@playwright/test';
import 'dotenv/config';
import {
    createApp,
    deleteApp,
    startPublishPreparation,
    completePublication,
    unpublishVersion,
    gotoDashboard,
} from '../../tools/dashboard-helpers';

test.describe.configure({ mode: 'serial' });

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

test.describe('削除・編集のガード条件テスト', () => {

    test.beforeEach(async ({ page, context }) => {
        await gotoDashboard(page);
    });

    test('公開準備中および公開中のアプリ/バージョンは編集・削除できない', async ({ page }) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appName = `ガード条件テスト-${uniqueId}`.slice(0, 30);
        const appKey = `guard-test-${uniqueId}`.slice(0, 30);
        const version = '1.0.0';

        await test.step('セットアップ: アプリを作成しバージョンを「公開準備中」にする', async () => {
            await createApp(page, appName, appKey);
            await startPublishPreparation(page, appName, version);
        });

        await test.step('テスト(公開準備中): アプリとバージョンの編集/削除ボタンの状態を確認', async () => {
            const versionRow = page.locator('.version-card', { hasText: version }).first();

            await expect(versionRow).toContainText('審査待ち');
            await expect(versionRow).toContainText('準備完了', { timeout: 120000 });

            await expect(versionRow.locator('.btn-icon').filter({ has: page.locator('.fa-pen') })).toBeVisible({ visible: false });
            await expect(versionRow.locator('.btn-icon').filter({ has: page.locator('.fa-trash') })).toBeVisible({ visible: false });
        });

        await test.step('状態遷移: バージョンを「公開中」にする', async () => {
            await completePublication(page, appName, version);
        });

        await test.step('テスト(公開中): アプリとバージョンの編集/削除ボタンが非活性であることを確認', async () => {
            const versionRow = page.locator('.version-card', { hasText: version }).first();

            await expect(versionRow.locator('.btn-icon').filter({ has: page.locator('.fa-pen') })).toBeVisible({ visible: false });
            await expect(versionRow.locator('.btn-icon').filter({ has: page.locator('.fa-trash') })).toBeVisible({ visible: false });

            await page.getByText('アプリ設定').click();

            const delBtn = page.getByRole('button', { name: '削除する' });
            await expect(delBtn).toBeDisabled();
        });

        await test.step('クリーンアップ: バージョンを非公開にし、アプリを削除する', async () => {
            await page.getByText('バージョン管理').click();
            await unpublishVersion(page, appName, version);

            const versionRow = page.locator('.version-card', { hasText: version }).first();
            await expect(versionRow.locator('.btn-icon').filter({ has: page.locator('.fa-download') })).toBeVisible();
            await expect(versionRow.locator('.btn-icon').filter({ has: page.locator('.fa-pen') })).toBeVisible();
            await expect(versionRow.locator('.btn-icon').filter({ has: page.locator('.fa-copy') })).toBeVisible();
            await expect(versionRow.locator('.btn-icon').filter({ has: page.locator('.fa-trash') })).toBeVisible();

            await deleteApp(page, appKey);
            const appNameCell = page.locator('.app-card .app-name', { hasText: new RegExp(`^${appName}$`) });
            await expect(appNameCell).toBeHidden();
        });
    });
});