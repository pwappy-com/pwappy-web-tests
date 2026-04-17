import { test, expect } from '@playwright/test';
import 'dotenv/config';
import {
    createApp,
    deleteApp,
    addVersion,
    editVersion,
    duplicateVersion,
    deleteVersion,
    setupAppWithVersions,
    expectVersionVisibility,
    gotoDashboard,
} from '../../tools/dashboard-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

test.describe('バージョン管理 E2Eシナリオ', () => {

    test.beforeEach(async ({ page, context }) => {
        await gotoDashboard(page);
    });

    test('バージョンのライフサイクル（自動作成確認、編集、複製、削除）', async ({ page }) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appName = `バージョン管理テスト-${uniqueId}`.slice(0, 30);
        const appKey = `ver-test-${uniqueId}`.slice(0, 30);
        const autoCreatedVersion = '1.0.0';
        const editedVersion = '1.0.1';
        const duplicatedVersion = '1.0.2';

        await test.step('セットアップ: アプリを作成し、詳細画面（バージョン一覧）を確認', async () => {
            await createApp(page, appName, appKey);
            await expectVersionVisibility(page, autoCreatedVersion, true);
        });

        await test.step('WB-VER-NEW: バージョンのバリデーションをテストする', async () => {
            const newVersionBtn =  page.getByRole('button', { name: '+ 新規バージョン' });
            await newVersionBtn.click();
            await page.waitForTimeout(500);
            const modal = page.locator('dashboard-modal-window#versionModal');
            await expect(modal.locator('span[slot="header-title"]')).toContainText('バージョンの追加');

            const versionInput = modal.locator('#input-version');

            await versionInput.fill(autoCreatedVersion);
            await modal.locator('.submit-button').click({ force: true });

            const alertDialog = page.locator('alert-component');
            await expect(alertDialog).toContainText('同じバージョンがすでに存在しています', { timeout: 5000 }).catch(async () => {
                await expect(modal.locator('#error-version')).toContainText('重複しています');
            });
            if (await alertDialog.isVisible().catch(() => false)) {
                await alertDialog.getByRole('button', { name: '閉じる' }).click();
            }

            await versionInput.fill('Invalid+Version');
            await modal.locator('.submit-button').click({ force: true });
            await expect(modal.locator('#error-version')).toContainText('英小文字、数字、ハイフン、アンダーバー、ドットのみ入力可能です');

            await versionInput.fill('');
            await modal.locator('.submit-button').click({ force: true });
            await expect(modal.locator('#error-version')).toContainText('必須項目です');

            await modal.locator('.cancel-button').click({ force: true });
            await expect(modal).toBeHidden();
        });

        await test.step('WB-VER-EDIT: 自動作成されたバージョンを編集する', async () => {
            await editVersion(page, autoCreatedVersion, editedVersion);
            await expectVersionVisibility(page, editedVersion, true);
            await expectVersionVisibility(page, autoCreatedVersion, false);
        });

        await test.step('WB-VER-DUP: 編集後のバージョンを複製する', async () => {
            await duplicateVersion(page, editedVersion);
            await expectVersionVisibility(page, duplicatedVersion, true);
        });

        await test.step('クリーンアップ: 作成したアプリケーションを削除する', async () => {
            await deleteApp(page, appKey);
        });
    });

    test('WB-VER-DUP-008: 複製時にバージョンが重複する場合、次の番号にインクリメントされる', async ({ page }) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appName = `複製インクリメントテスト-${uniqueId}`.slice(0, 30);
        const appKey = `inc-dup-ver-test-${uniqueId}`.slice(0, 30);
        const initialVersions = ['1.0.0', '1.0.1'];
        const expectedDuplicatedVersion = '1.0.2';

        await test.step('セットアップ: 1.0.0と1.0.1を持つアプリを作成', async () => {
            await setupAppWithVersions(page, { appName, appKey, versions: initialVersions });
        });

        await test.step('テスト: 1.0.0を複製すると、1.0.2が作成されることを確認', async () => {
            await duplicateVersion(page, '1.0.0');
            await expect(page.locator('alert-component')).toBeHidden();
            await expectVersionVisibility(page, expectedDuplicatedVersion, true);
        });

        await test.step('クリーンアップ: 作成したアプリを削除', async () => {
            await deleteApp(page, appKey);
        });
    });

    test('WB-VER-EDIT-005: 編集時にバージョンが重複するとエラーになる', async ({ page }) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appName = `編集重複テスト-${uniqueId}`.slice(0, 30);
        const appKey = `edit-dup-ver-test-${uniqueId}`.slice(0, 30);
        const initialVersions = ['1.0.0', '1.1.0'];

        await test.step('セットアップ: 2つのバージョンを持つアプリを作成', async () => {
            await setupAppWithVersions(page, { appName, appKey, versions: initialVersions });
        });

        await test.step('テスト: 1.0.0を1.1.0に編集しようとするとエラーになる', async () => {
            const versionRow = page.locator('.version-card', { hasText: '1.0.0' });
            await versionRow.locator('.btn-icon').filter({ has: page.locator('.fa-pen') }).click();

            const modal = page.locator('dashboard-modal-window#versionModal');
            await expect(modal.locator('span[slot="header-title"]')).toContainText('バージョンの編集');

            await modal.locator('#input-version').fill('1.1.0');
            await modal.locator('.submit-button').click({ force: true });

            const alertDialog = page.locator('alert-component');
            await expect(alertDialog).toContainText('指定されたバージョンは既に存在します').catch(async () => {
                await expect(modal.locator('#error-version')).toContainText('重複しています');
            });
            if (await alertDialog.isVisible().catch(() => false)) {
                await alertDialog.getByRole('button', { name: '閉じる' }).click();
            }

            await modal.locator('.cancel-button').click({ force: true });
            await expect(modal).toBeHidden();
        });

        await test.step('クリーンアップ: 作成したアプリを削除', async () => {
            await deleteApp(page, appKey);
        });
    });

    test('WB-VER-EDIT (Abnormal): バージョン編集時のバリデーションをテストする', async ({ page }) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appName = `バージョン編集バリデーション-${uniqueId}`.slice(0, 30);
        const appKey = `ver-edit-validation-${uniqueId}`.slice(0, 30);
        const initialVersion = '1.0.0';

        await test.step('セットアップ: テスト対象のアプリとバージョンを作成', async () => {
            await setupAppWithVersions(page, { appName, appKey, versions: [initialVersion] });
        });

        await test.step('テスト: 編集ダイアログで各種バリデーションエラーを確認', async () => {
            const versionRow = page.locator('.version-card', { hasText: initialVersion });
            await versionRow.locator('.btn-icon').filter({ has: page.locator('.fa-pen') }).click();

            const modal = page.locator('dashboard-modal-window#versionModal');
            await expect(modal.locator('span[slot="header-title"]')).toContainText('バージョンの編集');

            const versionInput = modal.locator('#input-version');

            await versionInput.fill('');
            await modal.locator('.submit-button').click({ force: true });
            await expect(modal.locator('#error-version')).toContainText('必須項目です');

            await versionInput.fill('invalid-version+');
            await modal.locator('.submit-button').click({ force: true });
            await expect(modal.locator('#error-version')).toContainText('英小文字、数字、ハイフン、アンダーバー、ドットのみ入力可能です');

            await versionInput.fill('a'.repeat(31));
            expect(await versionInput.inputValue()).toHaveLength(30);

            await modal.locator('.cancel-button').click({ force: true });
            await expect(modal).toBeHidden();
        });

        await test.step('クリーンアップ: 作成したアプリを削除', async () => {
            await deleteApp(page, appKey);
        });
    });

    test('WB-VER-DUP-006: 複製後に文字数制限を超える場合はエラーになる', async ({ page }) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appName = `複製文字数テスト-${uniqueId}`.slice(0, 30);
        const appKey = `dup-len-test-${uniqueId}`.slice(0, 30);
        const tooLongVersion = 'a'.repeat(30);

        await test.step('セットアップ: 文字数制限いっぱいのバージョンを持つアプリを作成', async () => {
            await setupAppWithVersions(page, { appName, appKey, versions: ['1.0.0'] });
            await deleteVersion(page, '1.0.0');
            await page.waitForLoadState('networkidle');
            await page.waitForTimeout(500);
            await addVersion(page, tooLongVersion);
            await expectVersionVisibility(page, tooLongVersion, true);
        });

        await test.step('テスト: 30文字のバージョンを複製しようとするとエラーになる', async () => {
            await duplicateVersion(page, tooLongVersion);
            const alertDialog = page.locator('alert-component');
            await expect(alertDialog).toContainText(/複製後のバージョン名が30文字を超えます/);
            await alertDialog.getByRole('button', { name: '閉じる' }).click();
        });

        await test.step('クリーンアップ: 作成したアプリを削除', async () => {
            await deleteApp(page, appKey);
        });
    });
});