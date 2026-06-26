import { test, expect, Page } from '@playwright/test';
import 'dotenv/config';
import {
    createApp,
    deleteApp,
    expectAppVisibility,
    gotoDashboard,
    startPublishPreparation,
    completePublication,
    unpublishVersion,
} from '../../tools/dashboard-helpers';

test.describe.configure({ mode: 'serial' });

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

test.describe('アーカイブ E2Eシナリオ', () => {

    test.beforeEach(async ({ page, context }) => {
        page.on('console', msg => {
            if (msg.text().includes('[ArchiveTest:') || msg.type() === 'error') {
                console.log(`[ArchiveTest:Console] ${msg.type()}: ${msg.text()}`);
            }
        });

        page.on('response', async response => {
            const url = response.url();
            // アーカイブ関連API、またはエラーレスポンスを全てキャプチャ
            if (url.includes('application/archive') || url.includes('application/restore') || response.status() >= 400) {
                console.log(`\n[ArchiveTest:Network] === API Response ===`);
                console.log(`[ArchiveTest:Network] URL: ${response.request().method()} ${url}`);
                console.log(`[ArchiveTest:Network] Status: ${response.status()}`);
                try {
                    const reqBody = response.request().postData();
                    console.log(`[ArchiveTest:Network] Request Body: ${reqBody}`);
                } catch (e) { }
                try {
                    console.log(`[ArchiveTest:Network] Response Body: ${await response.text()}`);
                } catch (e) { }
                console.log(`[ArchiveTest:Network] ====================\n`);
            }
        });

        await gotoDashboard(page);

        // クリックが何回発火しているかをブラウザ内部で監視するリスナーを設置
        await page.evaluate(() => {
            (window as any).__archiveClickCount = 0;
            (window as any).__restoreClickCount = 0;
            document.body.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                if (!target) return;

                // Shadow DOM の内部ボタンも検知できるよう composedPath を使用
                const path = e.composedPath() as HTMLElement[];
                for (const el of path) {
                    if (el.classList && el.classList.contains('confirm-ok-button') && el.innerText.includes('アーカイブ')) {
                        (window as any).__archiveClickCount++;
                        console.log(`[ArchiveTest:ClickEvent] 「アーカイブ」確認ボタンがクリックされました。累計: ${(window as any).__archiveClickCount}回`);
                        break;
                    }
                    if (el.classList && (el.classList.contains('confirm-restore-button') || el.innerText.includes('復元'))) {
                        (window as any).__restoreClickCount++;
                        console.log(`[ArchiveTest:ClickEvent] 「復元」確認ボタンがクリックされました。累計: ${(window as any).__restoreClickCount}回`);
                        break;
                    }
                }
            });
        });
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
                await page.waitForTimeout(500);

                await page.getByRole('button', { name: ' アーカイブする' }).click();
                const confirmDialog = page.locator('message-box#archive-confirm');
                await page.waitForTimeout(500);
                await expect(confirmDialog).toBeVisible({ timeout: 5000 });

                console.log(`[ArchiveTest:Action] アーカイブ実行ボタンをクリックします`);
                await page.getByRole('button', { name: 'アーカイブ', exact: true }).click();
                await page.waitForTimeout(500);

                const closeBtn = page.getByRole('button', { name: '閉じる' });
                if (await closeBtn.isVisible().catch(() => false)) {
                    await closeBtn.click();
                }

                await expect(confirmDialog).toBeHidden({ timeout: 5000 });
            }).toPass({ timeout: 20000, intervals: [1000] });

            await expect(page.locator('dashboard-loading-overlay')).toBeHidden({ timeout: 150000 });
            await expectAppVisibility(page, appKey, false);
        });

        await test.step('テスト: アーカイブタブで表示されることを確認', async () => {
            const alert = page.locator('alert-component');
            if (await alert.isVisible().catch(() => false)) {
                await alert.getByRole('button', { name: '閉じる' }).click({ force: true }).catch(() => { });
            }

            await page.getByRole('button', { name: ' アーカイブ' }).click({ force: true });
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

                console.log(`[ArchiveTest:Action] 復元実行ボタンをクリックします`);
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

    test('WB-APP-ARC-PUB: 公開済みのアプリをアーカイブした場合、QRコードなどのメニューが表示される', async ({ page }) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appName = `公開アーカイブ-${uniqueId}`.slice(0, 30);
        const appKey = `pub-arc-${uniqueId}`.slice(0, 30);
        const version = '1.0.0';

        await test.step('セットアップ: アプリを作成し、公開状態にする', async () => {
            await createApp(page, appName, appKey);
            await startPublishPreparation(page, appName, version);
            await completePublication(page, appName, version);
        });

        await test.step('テスト: アプリケーションをアーカイブする', async () => {
            await expect(async () => {
                const alert = page.locator('alert-component');
                if (await alert.isVisible().catch(() => false)) {
                    await alert.getByRole('button', { name: '閉じる' }).click().catch(() => { });
                }

                const appSettingBtn = page.getByText('アプリ設定');
                await appSettingBtn.click();
                await page.waitForTimeout(500);

                await page.getByRole('button', { name: ' アーカイブする' }).click();
                const confirmDialog = page.locator('message-box#archive-confirm');
                await page.waitForTimeout(500);
                await expect(confirmDialog).toBeVisible({ timeout: 5000 });

                console.log(`[ArchiveTest:Action] アーカイブ実行ボタンをクリックします`);
                await page.getByRole('button', { name: 'アーカイブ', exact: true }).click();
                await page.waitForTimeout(500);

                const closeBtn = page.getByRole('button', { name: '閉じる' });
                if (await closeBtn.isVisible().catch(() => false)) {
                    await closeBtn.click();
                }

                await expect(confirmDialog).toBeHidden({ timeout: 5000 });
            }).toPass({ timeout: 20000, intervals: [1000] });

            await expect(page.locator('dashboard-loading-overlay')).toBeHidden({ timeout: 150000 });
            await expectAppVisibility(page, appKey, false);
        });

        await test.step('テスト: アーカイブタブでメニューグループ（QRコード等）が表示されることを確認', async () => {
            const alert = page.locator('alert-component');
            if (await alert.isVisible().catch(() => false)) {
                await alert.getByRole('button', { name: '閉じる' }).click({ force: true }).catch(() => { });
            }

            await page.getByRole('button', { name: ' アーカイブ' }).click({ force: true });

            const archivedAppCard = page.locator('.app-card', { has: page.locator('.app-key', { hasText: appKey }) });
            await expect(archivedAppCard).toBeVisible({ timeout: 10000 });

            // dashboard-app-menu-group がマウントされ、表示されていることを確認
            const menuGroup = archivedAppCard.locator('dashboard-app-menu-group');
            await expect(menuGroup).toBeVisible();
        });

        await test.step('クリーンアップ: アプリを復元し、非公開にして削除する', async () => {
            const archiveRow = page.locator('.app-card', { has: page.locator('.app-key', { hasText: appKey }) });

            await expect(async () => {
                const alert = page.locator('alert-component');
                if (await alert.isVisible().catch(() => false)) {
                    await alert.getByRole('button', { name: '閉じる' }).click().catch(() => { });
                }

                await archiveRow.getByRole('button', { name: /復元/ }).click({ force: true, timeout: 2000 });

                const confirmDialog = page.locator('message-box#restore-confirm');
                await expect(confirmDialog).toBeVisible({ timeout: 5000 });

                console.log(`[ArchiveTest:Action] 復元実行ボタンをクリックします`);
                await confirmDialog.locator('.confirm-restore-button, .confirm-ok-button').click({ force: true, timeout: 2000 });

                await expect(confirmDialog).toBeHidden({ timeout: 5000 });
            }).toPass({ timeout: 20000, intervals: [1000] });

            await expect(page.locator('dashboard-loading-overlay')).toBeHidden({ timeout: 150000 });

            const alertDialog = page.locator('alert-component');
            await expect(alertDialog).toBeVisible();
            await alertDialog.getByRole('button', { name: '閉じる' }).click();
            await expect(alertDialog).toBeHidden();

            await page.getByRole('button', { name: ' ワークベンチに戻る' }).click();
            await expectAppVisibility(page, appKey, true);

            // アプリを選択して詳細を開く
            const appRow = page.locator('.app-card', { has: page.locator('.app-key', { hasText: appKey }) });
            await appRow.click({ force: true });

            // バージョン管理から非公開にする
            await expect(page.locator('.detail-tab.active')).toContainText('バージョン管理', { timeout: 10000 });
            await unpublishVersion(page, appName, '1.0.0');

            // アプリを完全に削除する
            await deleteApp(page, appKey);
            await expectAppVisibility(page, appKey, false);
        });
    });
});