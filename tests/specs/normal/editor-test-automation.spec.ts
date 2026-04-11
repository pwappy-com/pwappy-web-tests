import { test as base, expect, Page } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

type EditorFixtures = {
    editorPage: Page;
    appName: string;
    editorHelper: EditorHelper;
};

const test = base.extend<EditorFixtures>({
    appName: async ({ }, use) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        await use(`test-auto-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName }, use) => {
        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        var domain: string = testUrl.hostname;
        if (domain !== 'localhost') {
            domain = '.' + domain;
        }
        // 先にクッキーを削除
      await context.clearCookies();
      await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 },
            { name: 'pwappy_login', value: process.env.PWAPPY_LOGIN!, domain: domain, path: '/', secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 },
        ]);
        await page.goto(String(process.env.PWAPPY_TEST_BASE_URL), { waitUntil: 'domcontentloaded' });
        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });

        const appKey = `test-auto-key-${Date.now().toString().slice(-6)}`;
        await createApp(page, appName, appKey);
        const editorPage = await openEditor(page, context, appName);
        await use(editorPage);
        await editorPage.close();
        await page.bringToFront();
        await deleteApp(page, appKey);
    },
    editorHelper: async ({ editorPage, isMobile }, use) => {
        const helper = new EditorHelper(editorPage, isMobile);
        await use(helper);
    },
});

test.describe('エディタ内：テスト自動化（テストシナリオとAPIモック）の検証', () => {

    test.beforeEach(async ({ editorPage, editorHelper }) => {
        // 右ハンドルを展開
        await editorHelper.openMoveingHandle('right');
        const scriptContainer = editorPage.locator('script-container');

        // strict mode violation を回避するため、IDで直接「テスト」タブを指定してクリック
        await expect(async () => {
            const alert = editorPage.locator('alert-component');
            if (await alert.isVisible().catch(() => false)) {
                await alert.getByRole('button', { name: '閉じる' }).click().catch(() => { });
            }
            await editorPage.keyboard.press('Escape'); // サジェスト消去用
            await scriptContainer.locator('#tab-test').click({ timeout: 2000 });
        }).toPass({ timeout: 15000, intervals: [1000] });

        await expect(scriptContainer.locator('test-container')).toBeVisible();
    });

    test('テストシナリオの追加・編集・削除ができる', async ({ editorPage }) => {
        const testContainer = editorPage.locator('test-container');
        const scenarioName = '新規ログインテスト';
        const editedName = '編集後ログインテスト';

        await test.step('1. シナリオの追加', async () => {
            // モバイル対応: getByRole ではなく クラスセレクタ (.add-btn) でクリックする
            await testContainer.locator('.add-btn').click();

            const modal = editorPage.locator('test-scenario-editor .modal');
            await expect(modal).toBeVisible();

            await modal.locator('#scenario-name').fill(scenarioName);
            await modal.locator('#scenario-desc').fill('ログイン画面の正常系テスト');

            // モーダル内のボタンはモバイルでもテキストが表示されるので getByRole が使える
            await modal.getByRole('button', { name: '保存' }).click();
            await expect(modal).toBeHidden();

            // 一覧に追加されたか確認
            const scenarioItem = testContainer.locator('.scenario-item', { hasText: scenarioName });
            await expect(scenarioItem).toBeVisible();
        });

        await test.step('2. シナリオの編集', async () => {
            const scenarioItem = testContainer.locator('.scenario-item', { hasText: scenarioName });
            await scenarioItem.locator('.action-icon.fa-pen').click();

            const modal = editorPage.locator('test-scenario-editor .modal');
            await expect(modal).toBeVisible();

            await modal.locator('#scenario-name').fill(editedName);
            await modal.getByRole('button', { name: '保存' }).click();
            await expect(modal).toBeHidden();

            await expect(testContainer.locator('.scenario-item', { hasText: editedName })).toBeVisible();
        });

        await test.step('3. シナリオの削除', async () => {
            const scenarioItem = testContainer.locator('.scenario-item', { hasText: editedName });

            // 削除アイコンをクリックし、確認ダイアログをOKする
            editorPage.once('dialog', dialog => dialog.accept());
            await scenarioItem.locator('.action-icon.delete').click();

            await expect(scenarioItem).toBeHidden();
        });
    });

    test('APIモックの追加・ON/OFFトグル・削除ができる', async ({ editorPage }) => {
        const testContainer = editorPage.locator('test-container');
        const mockPath = '/api/v1/users';
        const mockName = 'ユーザー取得成功';

        await test.step('1. APIモックタブへ切り替え', async () => {
            await testContainer.locator('.tab', { hasText: 'APIモック' }).click();
            // モバイル対応: クラスセレクタで存在確認
            await expect(testContainer.locator('.add-btn')).toBeVisible();
        });

        await test.step('2. モックの追加', async () => {
            // モバイル対応: クラスセレクタでクリック
            await testContainer.locator('.add-btn').click();

            const modal = testContainer.locator('.modal-dialog');
            await expect(modal).toBeVisible();

            await modal.locator('#mock-path').fill(mockPath);
            await modal.locator('#mock-pattern').fill(mockName);
            await modal.locator('#mock-response').fill('{ "status": "ok" }');

            await modal.getByRole('button', { name: '設定を保存' }).click();
            await expect(modal).toBeHidden();

            // 一覧に追加されたか確認
            const mockGroup = testContainer.locator('.mock-group', { hasText: mockPath });
            await expect(mockGroup).toBeVisible();
            await expect(mockGroup.locator('.mock-item', { hasText: mockName })).toBeVisible();
        });

        await test.step('3. モックのON/OFFトグル', async () => {
            const mockItem = testContainer.locator('.mock-item', { hasText: mockName });
            const toggleInput = mockItem.locator('input[type="checkbox"]');

            // 初期はON
            await expect(toggleInput).toBeChecked();

            // トグルクリック (inputは不可視なのでlabel.toggle-switchをクリック)
            await mockItem.locator('label.toggle-switch').click();
            await expect(toggleInput).not.toBeChecked();

            await mockItem.locator('label.toggle-switch').click();
            await expect(toggleInput).toBeChecked();
        });

        await test.step('4. モックの削除', async () => {
            const mockItem = testContainer.locator('.mock-item', { hasText: mockName });

            // 削除アイコンをクリックし、確認ダイアログをOKする
            editorPage.once('dialog', dialog => dialog.accept());
            await mockItem.locator('.action-icon.delete').click();

            await expect(testContainer.locator('.mock-group', { hasText: mockPath })).toBeHidden();
        });
    });
});