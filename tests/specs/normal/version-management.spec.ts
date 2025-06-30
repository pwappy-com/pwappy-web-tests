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
} from '../../tools/dashboard-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

// --- テストシナリオ ---
test.describe('バージョン管理 E2Eシナリオ', () => {

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

    test('バージョンのライフサイクル（自動作成確認、編集、複製、削除）', async ({ page }) => {
        const timestamp = Date.now().toString();
        const uniqueId = `${testRunSuffix}-${timestamp}`;
        const appName = `バージョン管理テスト-${uniqueId}`.slice(0, 30);
        const appKey = `ver-test-${uniqueId}`.slice(0, 30);
        const autoCreatedVersion = '1.0.0';
        const editedVersion = '1.0.1';
        const duplicatedVersion = '1.0.2';

        await test.step('セットアップ: アプリを作成し、バージョン管理画面を開く', async () => {
            await createApp(page, appName, appKey);
            const appRow = page.locator('.app-list tbody tr', { hasText: appName });
            await expect(appRow).toBeVisible();
            await appRow.getByRole('button', { name: '選択' }).click();
            await expect(page.getByRole('heading', { name: 'バージョン管理' })).toBeVisible();
            await expectVersionVisibility(page, autoCreatedVersion, true);
        });

        await test.step('WB-VER-NEW: バージョンのバリデーションをテストする', async () => {
            await page.getByTitle('バージョンの追加').click();
            const modal = page.locator('dashboard-modal-window#versionModal');
            await expect(modal.getByRole('heading', { name: 'バージョンの追加' })).toBeVisible();

            const versionInput = modal.getByLabel('バージョン');

            // 重複エラー
            await versionInput.fill(autoCreatedVersion);
            await modal.getByRole('button', { name: '保存' }).click();
            const alertDialog = page.locator('alert-component');
            await expect(alertDialog).toContainText('同じバージョンがすでに存在しています');
            await alertDialog.getByRole('button', { name: '閉じる' }).click();

            // 不正文字エラー
            await versionInput.fill('Invalid+Version');
            await modal.getByRole('button', { name: '保存' }).click();
            await expect(modal.locator('#error-version')).toContainText('英小文字、数字、ハイフン、アンダーバー、ドットのみ入力可能です');

            // 空入力エラー
            await versionInput.fill('');
            await modal.getByRole('button', { name: '保存' }).click();
            await expect(modal.locator('#error-version')).toContainText('必須項目です');

            await modal.getByRole('button', { name: 'キャンセル' }).click();
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
            await deleteApp(page, appName);
        });
    });

    test('WB-VER-DUP-008: 複製時にバージョンが重複する場合、次の番号にインクリメントされる', async ({ page }) => {
        const timestamp = Date.now().toString().slice(-10);
        const appName = `複製インクリメントテスト-${timestamp}`;
        const appKey = `inc-dup-ver-test-${timestamp}`;
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
            await deleteApp(page, appName);
        });
    });

    test('WB-VER-EDIT-005: 編集時にバージョンが重複するとエラーになる', async ({ page }) => {
        const timestamp = Date.now().toString().slice(-10);
        const appName = `編集重複テスト-${timestamp}`;
        const appKey = `edit-dup-ver-test-${timestamp}`;
        const initialVersions = ['1.0.0', '1.1.0'];

        await test.step('セットアップ: 2つのバージョンを持つアプリを作成', async () => {
            await setupAppWithVersions(page, { appName, appKey, versions: initialVersions });
        });

        await test.step('テスト: 1.0.0を1.1.0に編集しようとするとエラーになる', async () => {
            const versionRow = page.locator('.version-list tbody tr', { hasText: '1.0.0' });
            await versionRow.getByRole('button', { name: '編集' }).click();

            const modal = page.locator('dashboard-modal-window#versionModal');
            await expect(modal.getByRole('heading', { name: 'バージョンの編集' })).toBeVisible();
            await modal.getByLabel('バージョン').fill('1.1.0');
            await modal.getByRole('button', { name: '保存' }).click();

            const alertDialog = page.locator('alert-component');
            await expect(alertDialog).toContainText('指定されたバージョンは既に存在します');
            await alertDialog.getByRole('button', { name: '閉じる' }).click();

            await modal.getByRole('button', { name: 'キャンセル' }).click();
            await expect(modal).toBeHidden();
        });

        await test.step('クリーンアップ: 作成したアプリを削除', async () => {
            await deleteApp(page, appName);
        });
    });

    test('WB-VER-EDIT (Abnormal): バージョン編集時のバリデーションをテストする', async ({ page }) => {
        const timestamp = Date.now().toString();
        const appName = `バージョン編集バリデーション-${timestamp}`.slice(0, 30);
        const appKey = `ver-edit-validation-${timestamp}`.slice(0, 30);
        const initialVersion = '1.0.0';

        await test.step('セットアップ: テスト対象のアプリとバージョンを作成', async () => {
            await setupAppWithVersions(page, { appName, appKey, versions: [initialVersion] });
        });

        await test.step('テスト: 編集ダイアログで各種バリデーションエラーを確認', async () => {
            const versionRow = page.locator('.version-list tbody tr', { hasText: initialVersion });
            await versionRow.getByRole('button', { name: '編集' }).click();

            const modal = page.locator('dashboard-modal-window#versionModal');
            await expect(modal.getByRole('heading', { name: 'バージョンの編集' })).toBeVisible();

            const versionInput = modal.getByLabel('バージョン');

            await versionInput.fill('');
            await modal.getByRole('button', { name: '保存' }).click();
            await expect(modal.locator('#error-version')).toContainText('必須項目です');

            await versionInput.fill('invalid-version+');
            await modal.getByRole('button', { name: '保存' }).click();
            await expect(modal.locator('#error-version')).toContainText('英小文字、数字、ハイフン、アンダーバー、ドットのみ入力可能です');

            await versionInput.fill('a'.repeat(31));
            expect(await versionInput.inputValue()).toHaveLength(30);

            await modal.getByRole('button', { name: 'キャンセル' }).click();
            await expect(modal).toBeHidden();
        });

        await test.step('クリーンアップ: 作成したアプリを削除', async () => {
            await deleteApp(page, appName);
        });
    });

    test('WB-VER-DUP-006: 複製後に文字数制限を超える場合はエラーになる', async ({ page }) => {
        const timestamp = Date.now().toString().slice(-10);
        const appName = `複製文字数テスト-${timestamp}`.slice(0, 30);
        const appKey = `dup-len-test-${timestamp}`.slice(0, 30);
        const tooLongVersion = 'a'.repeat(30);

        await test.step('セットアップ: 文字数制限いっぱいのバージョンを持つアプリを作成', async () => {
            await setupAppWithVersions(page, { appName, appKey, versions: ['1.0.0'] });
            await deleteVersion(page, '1.0.0');
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
            await deleteApp(page, appName);
        });
    });
});