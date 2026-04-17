import { test, expect, Page } from '@playwright/test';
import 'dotenv/config';
import {
    createApp,
    deleteApp,
    expectAppVisibility,
    gotoDashboard,
} from '../../tools/dashboard-helpers';

test.describe.configure({ mode: 'serial' });

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

test.describe('アーカイブ E2Eシナリオ', () => {

    test.beforeEach(async ({ page, context }) => {
        await gotoDashboard(page);
    });

    test('WB-APP-ARC & AR-APP-REST: アプリケーションのアーカイブと復元', async ({ page }) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appName = `アーカイブテスト-${uniqueId}`.slice(0, 30);
        const appKey = `archive-app-${uniqueId}`.slice(0, 30);

        await test.step('セットアップ: アーカイブ対象のアプリを作成', async () => {
            await createApp(page, appName, appKey);
        });

        await test.step('テスト: アプリケーションをアーカイブする', async () => {
            const appRow = page.locator('.app-card', { hasText: appName }).first();

            await expect(async () => {
                const alert = page.locator('alert-component');
                if (await alert.isVisible().catch(() => false)) {
                    await alert.getByRole('button', { name: '閉じる' }).click().catch(() => { });
                }

                const appSettingBtn = page.getByText('アプリ設定');
                await appSettingBtn.click();

                await page.getByRole('button', { name: ' アーカイブする' }).click();
                const confirmDialog = page.locator('message-box#archive-confirm');
                await page.waitForTimeout(500);
                await expect(confirmDialog).toBeVisible({ timeout: 5000 });
                await page.getByRole('button', { name: 'アーカイブ', exact: true }).click();
                await page.waitForTimeout(500);
                await page.getByRole('button', { name: '閉じる' }).click();

                await expect(confirmDialog).toBeHidden({ timeout: 5000 });
            }).toPass({ timeout: 20000, intervals: [1000] });

            await expect(page.locator('dashboard-loading-overlay')).toBeHidden({ timeout: 150000 });

            await expectAppVisibility(page, appKey, false);
        });

        await test.step('テスト: アーカイブタブで表示されることを確認', async () => {
            await page.getByRole('button', { name: ' アーカイブ' }).click();
            const archivedAppCard = page.locator('.app-card', { has: page.locator('.app-key', { hasText: appKey }) });
            await expect(archivedAppCard).toBeVisible({ timeout: 10000 });
        });

        await test.step('テスト: アーカイブから復元する', async () => {
            const archiveRow = page.locator('.app-card', { hasText: appName });

            await expect(async () => {
                const alert = page.locator('alert-component');
                if (await alert.isVisible().catch(() => false)) {
                    await alert.getByRole('button', { name: '閉じる' }).click().catch(() => { });
                }

                await archiveRow.getByRole('button', { name: /復元/ }).click({ force: true, timeout: 2000 });

                const confirmDialog = page.locator('message-box#restore-confirm');
                await expect(confirmDialog).toBeVisible({ timeout: 5000 });
                await confirmDialog.locator('.confirm-restore-button, .confirm-ok-button').click({ force: true, timeout: 2000 });

                await expect(confirmDialog).toBeHidden({ timeout: 5000 });
            }).toPass({ timeout: 20000, intervals: [1000] });

            await expect(page.locator('dashboard-loading-overlay')).toBeHidden({ timeout: 150000 });

            const alertDialog = page.locator('alert-component');
            await expect(alertDialog).toBeVisible();
            await expect(alertDialog).toContainText(`復元しました`);
            await alertDialog.getByRole('button', { name: '閉じる' }).click();
            await expect(alertDialog).toBeHidden();
        });

        await test.step('クリーンアップ: 復元後、ワークベンチで削除する', async () => {
            await page.getByRole('button', { name: ' ワークベンチに戻る' }).click();
            await expectAppVisibility(page, appKey, true);
            await deleteApp(page, appKey);
            await expectAppVisibility(page, appKey, false);
        });
    });
});