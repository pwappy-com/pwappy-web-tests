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
    expectAppVisibility
} from '../../tools/dashboard-helpers';
const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

test.describe('アプリケーション管理 E2Eシナリオ', () => {

    // 各テストの実行前に認証情報を設定し、ダッシュボードの初期ページに遷移します。
    test.beforeEach(async ({ page, context }) => {
        // ブラウザ内のコンソールログ（エラー・警告）をターミナルに出力する
        page.on('console', msg => {
            if (msg.type() === 'error' || msg.type() === 'warning') {
                console.log(`[Browser ${msg.type()}]: ${msg.text()}`);
            }
        });
        // 未処理の例外もキャッチする
        page.on('pageerror', exception => {
            console.log(`[Browser Exception]: ${exception.message}`);
        });

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

    test('WB-APP-NEW: アプリケーションの新規作成とバリデーション', async ({ page }) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appName = `新規作成テスト-${uniqueId}`.slice(0, 30);
        const appKey = `new-app-${uniqueId}`.slice(0, 30);
        const existingAppName = `既存アプリ-${uniqueId}`.slice(0, 30);
        const existingAppKey = `existing-key-${uniqueId}`.slice(0, 30);

        await test.step('セットアップ: 重複キーテスト用のアプリを作成', async () => {
            await createApp(page, existingAppName, existingAppKey);
            await expectAppVisibility(page, existingAppName, true);
        });

        await test.step('テスト: バリデーションと正常作成', async () => {
            await page.getByTitle('アプリケーションの追加').click();

            const modal = page.locator('dashboard-modal-window#appModal');
            // モーダルダイアログが完全に表示されるのを待機します。
            await expect(modal.getByRole('heading', { name: 'アプリケーションの追加' })).toBeVisible();

            // 必須項目（アプリケーション名）が未入力の場合にエラーが表示されることを検証します。
            await modal.getByRole('button', { name: '保存' }).click();
            await expect(modal.locator('#error-app-name')).toContainText('必須項目です');

            // アプリケーションキーに不正な文字を入力した場合にエラーが表示されることを検証します。
            const appNameInput = modal.getByLabel('アプリケーション名');
            //const appKeyInput = modal.getByLabel('アプリケーションキー');
            const appKeyInput = modal.locator('#input-app-key');
            await appNameInput.fill('不正キーテスト');
            await appKeyInput.fill('Invalid-KEY!');
            await modal.getByRole('button', { name: '保存' }).click();
            const errorAppKey = modal.locator('#error-app-key');
            await expect(errorAppKey).toBeVisible();
            await expect(errorAppKey).toContainText('英小文字、数字、ハイフン、アンダーバーのみ入力可能です');

            // 既存のアプリケーションキーと重複した場合にエラーが表示されることを検証します。
            await appKeyInput.fill(existingAppKey);
            await modal.getByRole('button', { name: '保存' }).click();
            const alertDialog = page.locator('alert-component');
            await expect(alertDialog).toBeVisible();
            await expect(alertDialog).toContainText('アプリケーションキーが重複しています');
            await alertDialog.getByRole('button', { name: '閉じる' }).click();

            // 正しい値を入力した場合にアプリケーションが正常に作成されることを検証します。
            await appNameInput.fill(appName);
            await appKeyInput.fill(appKey);
            await modal.getByRole('button', { name: '保存' }).click();
            await expect(modal).toBeHidden();
            await expectAppVisibility(page, appName, true);
        });

        await test.step('クリーンアップ: 作成したアプリを削除', async () => {
            await deleteApp(page, appKey);
            await deleteApp(page, existingAppKey);
            await expectAppVisibility(page, appName, false);
            await expectAppVisibility(page, existingAppName, false);
        });
    });

    test('WB-APP-EDIT & DEL: アプリケーションの編集と削除', async ({ page }) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appName = `編集削除テスト-${uniqueId}`.slice(0, 30);
        const appKey = `edit-del-app-${uniqueId}`.slice(0, 30);
        const editedAppName = `${appName}-編集後`.slice(0, 30);

        await test.step('セットアップ: 編集・削除対象のアプリを作成', async () => {
            await createApp(page, appName, appKey);
            await expectAppVisibility(page, appName, true);
        });

        await test.step('テスト: アプリケーションを編集する', async () => {
            const appRow = page.locator('.app-list tbody tr', { hasText: appName });
            await appRow.getByRole('button', { name: '編集' }).click();

            const modal = page.locator('dashboard-modal-window#appModal');
            // モーダルダイアログが完全に表示されるのを待機します。
            await expect(modal.getByRole('heading', { name: 'アプリケーションの編集' })).toBeVisible();

            // アプリケーション名を変更し、保存します。
            await modal.getByLabel('アプリケーション名').fill(editedAppName);
            await modal.getByRole('button', { name: '保存' }).click();

            // 編集が反映され、一覧の表示が更新されることを確認します。
            await expect(page.locator('dashboard-loading-overlay')).toBeHidden({ timeout: 150000 });
            await expectAppVisibility(page, editedAppName, true);
            await expectAppVisibility(page, appName, false);
        });

        await test.step('クリーンアップ: アプリケーションを削除する', async () => {
            await deleteApp(page, appKey);
            await expectAppVisibility(page, editedAppName, false);
        });
    });

    // -----------------------------------------
    // アーカイブと復元はpremiumに移動
    // -----------------------------------------
    // test('WB-APP-ARC & AR-APP-REST: アプリケーションのアーカイブと復元', async ({ page }) => {
    //     const timestamp = Date.now().toString();
    //     const appName = `アーカイブテスト-${timestamp}`.slice(0, 30);
    //     const appKey = `archive-app-${timestamp}`.slice(0, 30);

    //     await test.step('セットアップ: アーカイブ対象のアプリを作成', async () => {
    //         await createApp(page, appName, appKey);
    //         await expectAppVisibility(page, appName, true);
    //     });

    //     await test.step('テスト: アプリケーションをアーカイブする', async () => {
    //         const appRow = page.locator('.app-list tbody tr', { hasText: appName });
    //         await appRow.getByRole('button', { name: 'アーカイブ' }).click();

    //         // アーカイブ確認ダイアログで実行します。
    //         const confirmDialog = page.locator('message-box#archive-confirm');
    //         await expect(confirmDialog).toBeVisible();
    //         await confirmDialog.getByRole('button', { name: 'アーカイブ' }).click();

    //         await expect(page.locator('dashboard-loading-overlay')).toBeHidden({ timeout: 150000 });

    //         // 成功メッセージが表示され、ワークベンチの一覧から消えることを確認します。
    //         const alertDialog = page.locator('alert-component');
    //         await expect(alertDialog).toBeVisible();
    //         await expect(alertDialog).toContainText(`アプリ「${appKey}」をアーカイブしました`);
    //         await alertDialog.getByRole('button', { name: '閉じる' }).click();

    //         await expectAppVisibility(page, appName, false);
    //     });

    //     await test.step('テスト: アーカイブタブで表示されることを確認', async () => {
    //         await navigateToTab(page, 'archive');
    //         await expectAppVisibility(page, appName, true);
    //     });

    //     await test.step('テスト: アーカイブから復元する', async () => {
    //         await navigateToTab(page, 'archive');

    //         const archiveRow = page.locator('.app-list tbody tr', { hasText: appName });
    //         await archiveRow.getByRole('button', { name: 'ワークベンチに復元' }).click();

    //         // 復元確認ダイアログで実行します。
    //         const confirmDialog = page.locator('message-box#restore-confirm');
    //         await expect(confirmDialog).toBeVisible();
    //         await confirmDialog.getByRole('button', { name: '復元' }).click();

    //         await expect(page.locator('dashboard-loading-overlay')).toBeHidden({ timeout: 150000 });

    //         // 成功メッセージが表示されることを確認します。
    //         const alertDialog = page.locator('alert-component');
    //         await expect(alertDialog).toBeVisible();
    //         await expect(alertDialog).toContainText(`アプリ「${appKey}」をアーカイブからワークベンチに復元しました`);
    //         await alertDialog.getByRole('button', { name: '閉じる' }).click();

    //         // アーカイブタブの一覧から消えることを確認します。
    //         await navigateToTab(page, 'archive');
    //         await expectAppVisibility(page, appName, false);
    //     });

    //     await test.step('クリーンアップ: 復元後、ワークベンチで削除する', async () => {
    //         await navigateToTab(page, 'workbench');
    //         await expectAppVisibility(page, appName, true);
    //         await deleteApp(page, appName);
    //         await expectAppVisibility(page, appName, false);
    //     });
    // });

    test('WB-APP-EDIT (Abnormal): 編集時のバリデーションをテストする', async ({ page }) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appName = `編集バリデーションテスト-${uniqueId}`.slice(0, 30);
        const appKey = `edit-validation-${uniqueId}`.slice(0, 30);

        await test.step('セットアップ: テスト対象のアプリを作成', async () => {
            await createApp(page, appName, appKey);
            await expectAppVisibility(page, appName, true);
        });

        await test.step('テスト: 編集ダイアログでバリデーションエラーを確認', async () => {
            const appRow = page.locator('.app-list tbody tr', { hasText: appName });
            await appRow.getByRole('button', { name: '編集' }).click();

            const modal = page.locator('dashboard-modal-window#appModal');
            // モーダルダイアログが完全に表示されるのを待機します。
            await expect(modal.getByRole('heading', { name: 'アプリケーションの編集' })).toBeVisible();

            const appNameInput = page.locator('#input-app-name');
            await expect(appNameInput).toBeEditable({ timeout: 10000 });

            const appKeyInput = page.locator('#input-app-key');
            await expect(appKeyInput).toBeEditable({ timeout: 10000 });

            // アプリケーション名を空にして保存し、エラーが表示されることを確認します。
            await appNameInput.fill('');
            await expect(appNameInput).toHaveValue('');
            await modal.getByRole('button', { name: '保存' }).click();
            await expect(modal.locator('#error-app-name')).toContainText('必須項目です');

            // アプリケーションキーを空にして保存し、エラーが表示されることを確認します。
            await appNameInput.fill(appName);
            await appKeyInput.fill('');
            await expect(appNameInput).toHaveValue(appName);
            await expect(appKeyInput).toHaveValue('');
            await modal.getByRole('button', { name: '保存' }).click();
            await expect(modal.locator('#error-app-key')).toContainText('必須項目です');

            // アプリケーションキーが最大文字数（30文字）を超えて入力できないことを確認します。
            await appKeyInput.fill('a'.repeat(31));
            const appKeyValue = await appKeyInput.inputValue();
            expect(appKeyValue.length).toBeLessThanOrEqual(30);

            await modal.getByRole('button', { name: 'キャンセル' }).click();
            await expect(modal).toBeHidden();

            // WebKitではなぜかダイアログが消えないことがあるのでリロード
            await page.reload({ waitUntil: 'domcontentloaded' });
            // リロード後、メインコンテンツが表示されるのを待つ
            await expect(page.getByRole('heading', { name: 'アプリケーション一覧' })).toBeVisible();
        });

        await test.step('クリーンアップ: 作成したアプリを削除', async () => {
            await deleteApp(page, appKey);
            await expectAppVisibility(page, appName, false);
        });
    });

    // -------------------------------------------------------------------------------
    // delete-and-edit-guard.spec.tsで同様のテストをしているのでこちらはコメントアウト
    // -------------------------------------------------------------------------------
    // test('WB-APP-DEL (Abnormal): 公開中のアプリが削除できないことをテストする', async ({ page }) => {
    //     // バージョンの公開・非公開には審査待ち時間が発生する可能性があるため、テストのタイムアウトを延長します。
    //     test.setTimeout(180000);
    //     const timestamp = Date.now().toString();
    //     const appName = `公開中アプリ削除テスト-${timestamp}`.slice(0, 30);
    //     const appKey = `published-app-${timestamp}`.slice(0, 30);
    //     const version = '1.0.0';

    //     await test.step('セットアップ: アプリを作成しバージョンを公開状態にする', async () => {
    //         await createApp(page, appName, appKey);
    //         await publishVersion(page, appName, version);
    //     });

    //     await test.step('テスト: ワークベンチで削除ボタンが非活性であることを確認', async () => {
    //         await navigateToTab(page, 'workbench');
    //         const appRow = page.locator('.app-list tbody tr', { hasText: appName });
    //         const deleteButton = appRow.getByRole('button', { name: '削除' });
    //         await expect(deleteButton).toBeDisabled();
    //     });

    //     await test.step('クリーンアップ: バージョンを非公開にしてからアプリを削除する', async () => {
    //         // 公開中のバージョンを非公開にします。
    //         await unpublishVersion(page, appName, version);

    //         // ワークベンチに戻り、削除ボタンが活性化していることを確認します。
    //         await navigateToTab(page, 'workbench');
    //         const appRowWorkbench = page.locator('.app-list tbody tr', { hasText: appName });
    //         const deleteButton = appRowWorkbench.getByRole('button', { name: '削除' });
    //         await expect(deleteButton).toBeEnabled();

    //         // アプリを削除します。
    //         await deleteApp(page, appName);
    //         await expectAppVisibility(page, appName, false);
    //     });
    // });

    test('WB-APP-EDIT-010: 編集時にキーが他のアプリと重複するとエラーになる', async ({ page }) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appA_Name = `アプリA-${uniqueId}`.slice(0, 30);
        const appA_Key = `app-a-${uniqueId}`.slice(0, 30);
        const appB_Name = `アプリB-${uniqueId}`.slice(0, 30);
        const appB_Key = `app-b-${uniqueId}`.slice(0, 30);

        await test.step('セットアップ: 2つのアプリを作成する', async () => {
            await createApp(page, appA_Name, appA_Key);
            await createApp(page, appB_Name, appB_Key);
            await expectAppVisibility(page, appA_Name, true);
            await expectAppVisibility(page, appB_Name, true);
        });

        await test.step('テスト: アプリAのキーをアプリBのキーに変更してエラーを確認', async () => {
            const appARow = page.locator('.app-list tbody tr', { hasText: appA_Name });
            await appARow.getByRole('button', { name: '編集' }).click();

            const modal = page.locator('dashboard-modal-window#appModal');
            // モーダルダイアログが完全に表示されるのを待機します。
            await expect(modal.getByRole('heading', { name: 'アプリケーションの編集' })).toBeVisible();

            // アプリAのキーを、既存のアプリBのキーに変更します。
            await modal.getByLabel('アプリケーションキー').fill(appB_Key);
            await modal.getByRole('button', { name: '保存' }).click();

            // 重複エラーのアラートが表示されることを確認します。
            const alertDialog = page.locator('alert-component');
            await expect(alertDialog).toBeVisible();
            await expect(alertDialog).toContainText('アプリケーションキーが重複しています');
            await alertDialog.getByRole('button', { name: '閉じる' }).click();

            // モーダルをキャンセルで閉じます。
            await modal.getByRole('button', { name: 'キャンセル' }).click();
            await expect(modal).toBeHidden();
        });

        await test.step('クリーンアップ: 作成した2つのアプリを削除', async () => {
            await deleteApp(page, appA_Key);
            await deleteApp(page, appB_Key);
            await expectAppVisibility(page, appA_Name, false);
            await expectAppVisibility(page, appB_Name, false);
        });
    });

    test('WB-APP-DEL-004: アプリケーション削除をキャンセルする', async ({ page }) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appName = `削除キャンセルテスト-${uniqueId}`.slice(0, 30);
        const appKey = `del-cancel-test-${uniqueId}`.slice(0, 30);

        await test.step('セットアップ: テスト対象のアプリを作成', async () => {
            await createApp(page, appName, appKey);
            await expectAppVisibility(page, appName, true);
        });

        await test.step('テスト: 削除確認ダイアログでキャンセルを押し、アプリが削除されないことを確認', async () => {
            const appRow = page.locator('.app-list tbody tr', { hasText: appName });
            await appRow.getByRole('button', { name: '削除' }).click();

            // 削除確認ダイアログで「キャンセル」ボタンをクリックします。
            const confirmDialog = page.locator('message-box#delete-confirm');
            await expect(confirmDialog).toBeVisible();
            await confirmDialog.getByRole('button', { name: 'キャンセル' }).click();
            await expect(confirmDialog).toBeHidden();

            // アプリが削除されずに残っていることを確認します。
            await expectAppVisibility(page, appName, true);
        });

        await test.step('クリーンアップ: 作成したアプリを削除', async () => {
            await deleteApp(page, appKey);
            await expectAppVisibility(page, appName, false);
        });
    });
});