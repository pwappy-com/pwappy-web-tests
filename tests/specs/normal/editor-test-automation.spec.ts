import { test as base, expect, Page } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';
import { STORAGE_STATE } from '../../constants';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

let appName: string;
let appKey: string;

type EditorFixtures = {
    editorPage: Page;
    editorHelper: EditorHelper;
};

const test = base.extend<EditorFixtures>({
    editorPage: async ({ page, context }, use) => {
        await gotoDashboard(page);
        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });

        // 作成済みの共有アプリ詳細画面へ移動
        const appRow = page.locator('.app-card', { has: page.locator('.app-key', { hasText: appKey }) }).first();
        await expect(appRow).toBeVisible({ timeout: 15000 });
        await appRow.click({ force: true });
        await expect(page.locator('.detail-tab.active')).toBeVisible({ timeout: 10000 });

        const editorPage = await openEditor(page, context, appName);
        await use(editorPage);
        await editorPage.close();
    },
    editorHelper: async ({ editorPage, isMobile }, use) => {
        const helper = new EditorHelper(editorPage, isMobile);
        await use(helper);
    },
});

// テスト全体の開始前に、アプリを1回だけ作成する
test.beforeAll(async ({ browser }) => {
    const reversedTimestamp = Date.now().toString().split('').reverse().join('');
    const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
    appName = `test-auto-${uniqueId}`.slice(0, 30);
    appKey = `test-auto-key-${uniqueId}`.slice(0, 30);

    // 認証済みの状態を引き継ぐためのコンテキストを作成（STORAGE_STATE定数を使用）
    const context = await browser.newContext({ storageState: STORAGE_STATE });
    const page = await context.newPage();

    await gotoDashboard(page);
    await createApp(page, appName, appKey);

    await context.close();
});

// すべてのテストが終了した後に、アプリを1回だけ削除する
test.afterAll(async ({ browser }) => {
    if (appKey) {
        const context = await browser.newContext({ storageState: STORAGE_STATE });
        const page = await context.newPage();

        await gotoDashboard(page);
        await deleteApp(page, appKey);

        await context.close();
    }
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

            const senarioNameInput = modal.locator('#scenario-name');
            const senarioDescInput = modal.locator('#scenario-desc');
            await expect(senarioNameInput).toBeEditable();
            await expect(senarioDescInput).toBeEditable();
            await senarioNameInput.fill(scenarioName);
            await senarioDescInput.fill('ログイン画面の正常系テスト');

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

            const senarioNameInput = modal.locator('#scenario-name');
            await expect(senarioNameInput).toBeEditable();
            await senarioNameInput.fill(editedName);
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
            // モバイル対応: クラスセレクタでの要素存在確認
            await expect(testContainer.locator('.add-btn')).toBeVisible();
        });

        await test.step('2. APIモックの追加', async () => {
            await testContainer.locator('.add-btn').click();

            const modal = testContainer.locator('.modal-dialog');
            await expect(modal).toBeVisible();

            const pathInput = modal.locator('#mock-path');
            const patternInput = modal.locator('#mock-pattern');
            const responseInput = modal.locator('#mock-response');
            await expect(pathInput).toBeEditable();
            await expect(patternInput).toBeEditable();
            await expect(responseInput).toBeEditable();

            await pathInput.fill(mockPath);
            await patternInput.fill(mockName);
            await responseInput.fill(JSON.stringify({ status: 'success', data: [] }));

            await modal.getByRole('button', { name: '設定を保存' }).click();
            await expect(modal).toBeHidden();

            const mockItem = testContainer.locator('.mock-item', { hasText: mockName });
            await expect(mockItem).toBeVisible();
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

        await test.step('4. APIモックの削除', async () => {
            const mockItem = testContainer.locator('.mock-item', { hasText: mockName });
            // 削除アイコンをクリックし、確認ダイアログをOKする
            editorPage.once('dialog', dialog => dialog.accept());
            await mockItem.locator('.action-icon.delete').click();

            await expect(mockItem).toBeHidden();
        });
    });
});