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
        var domain: string = testUrl.hostname;
        if (domain !== 'localhost') {
            domain = '.' + domain;
        }
        await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 },
            { name: 'pwappy_login', value: process.env.PWAPPY_LOGIN!, domain: domain, path: '/', secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 },
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

            // UIの不安定さを吸収するため、toPassでリトライ可能にする
            await expect(async () => {
                const alert = page.locator('alert-component');
                if (await alert.isVisible().catch(() => false)) {
                    await alert.getByRole('button', { name: '閉じる' }).click().catch(() => { });
                }

                // force: true で確実なクリックを発火
                await appRow.getByRole('button', { name: 'アーカイブ' }).click({ force: true, timeout: 2000 });

                // アーカイブ確認ダイアログで実行します。
                const confirmDialog = page.locator('message-box#archive-confirm');
                await expect(confirmDialog).toBeVisible({ timeout: 5000 });
                await confirmDialog.getByRole('button', { name: 'アーカイブ' }).click({ force: true, timeout: 2000 });

                // ダイアログが閉じるのを待つ
                await expect(confirmDialog).toBeHidden({ timeout: 5000 });
            }).toPass({ timeout: 20000, intervals: [1000] });

            await expect(page.locator('dashboard-loading-overlay')).toBeHidden({ timeout: 150000 });

            // 成功メッセージが表示され、ワークベンチの一覧から消えることを確認します。
            const alertDialog = page.locator('alert-component');
            await expect(alertDialog).toBeVisible();
            await expect(alertDialog).toContainText(`アプリ「${appKey}」をアーカイブしました`);
            await alertDialog.getByRole('button', { name: '閉じる' }).click();
            await expect(alertDialog).toBeHidden();

            await expectAppVisibility(page, appKey, false);
        });

        await test.step('テスト: アーカイブタブで表示されることを確認', async () => {
            // SPAの自然な遷移に任せ、不要なリロードは行わない
            await navigateToTab(page, 'archive');
            await expectAppVisibility(page, appKey, true);
        });

        await test.step('テスト: アーカイブから復元する', async () => {
            const archiveRow = page.locator('.app-list tbody tr', { hasText: appName });

            // UIの不安定さ（not stable -> not visible のエラー）を吸収するため、toPassでリトライ可能にする
            await expect(async () => {
                const alert = page.locator('alert-component');
                if (await alert.isVisible().catch(() => false)) {
                    await alert.getByRole('button', { name: '閉じる' }).click().catch(() => { });
                }

                // force: true で確実なクリックを発火
                await archiveRow.getByRole('button', { name: 'ワークベンチに復元' }).click({ force: true, timeout: 2000 });

                // 復元確認ダイアログで実行します。
                const confirmDialog = page.locator('message-box#restore-confirm');
                await expect(confirmDialog).toBeVisible({ timeout: 5000 });
                await confirmDialog.getByRole('button', { name: '復元' }).click({ force: true, timeout: 2000 });

                // ダイアログが閉じるのを待つ（クリック成功の証）
                await expect(confirmDialog).toBeHidden({ timeout: 5000 });
            }).toPass({ timeout: 20000, intervals: [1000] });

            await expect(page.locator('dashboard-loading-overlay')).toBeHidden({ timeout: 150000 });

            // 成功メッセージが表示されることを確認します。
            const alertDialog = page.locator('alert-component');
            await expect(alertDialog).toBeVisible();
            await expect(alertDialog).toContainText(`アプリ「${appKey}」をアーカイブからワークベンチに復元しました`);
            await alertDialog.getByRole('button', { name: '閉じる' }).click();
            await expect(alertDialog).toBeHidden();

            // 復元直後はまだアーカイブタブを開いているため、そのままリストから消えたことを確認します。
            await expectAppVisibility(page, appKey, false);
        });

        await test.step('クリーンアップ: 復元後、ワークベンチで削除する', async () => {
            // モバイル環境特有のタブ遷移不具合や、URLハッシュの残存を完全に防ぐため、
            // トップページ（Workbench）へ直接gotoしてクリーンな初期状態にリセットします。
            await page.goto(String(process.env.PWAPPY_TEST_BASE_URL), { waitUntil: 'domcontentloaded' });
            await expect(page.locator('dashboard-loading-overlay')).toBeHidden({ timeout: 30000 });

            await expectAppVisibility(page, appKey, true);
            await deleteApp(page, appKey);
            await expectAppVisibility(page, appKey, false);
        });
    });
});