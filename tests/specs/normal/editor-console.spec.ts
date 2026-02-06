import { test as base, expect, Page, Locator } from '@playwright/test';
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
        const uniqueId = `${testRunSuffix}-${workerIndex}-${Date.now()}`;
        await use(`console-test-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName }, use) => {
        // --- ここでログインと遷移を行う ---
        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        const domain = testUrl.hostname;

        await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/' },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/' },
            { name: 'pwappy_login', value: '1', domain: domain, path: '/' },
        ]);

        // ダッシュボードへ移動
        await page.goto(String(process.env.PWAPPY_TEST_BASE_URL));

        // アプリ作成とエディタ起動
        const uniqueId = Date.now().toString().slice(-6);
        const appKey = `con-key-${uniqueId}`;

        await createApp(page, appName, appKey);
        const editorPage = await openEditor(page, context, appName);

        await use(editorPage);

        // クリーンアップ
        await editorPage.close();
        await deleteApp(page, appKey);
    },
    editorHelper: async ({ editorPage, isMobile }, use) => {
        const helper = new EditorHelper(editorPage, isMobile);
        await use(helper);
    },
});

test.describe('エディタ内：コンソール機能のテスト', () => {

    test.beforeEach(async ({ page, context, browserName, editorPage, editorHelper }) => {
        // クリップボード操作の権限を付与 (Chromiumのみ)
        if (browserName === 'chromium') {
            await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        }

        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        const domain = testUrl.hostname;
        await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/' },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/' },
            { name: 'pwappy_login', value: '1', domain: domain, path: '/' },
        ]);

        // 右側のサブウィンドウを開く
        await editorHelper.openMoveingHandle('right');

        // コンソールタブに切り替える
        const scriptContainer = editorPage.locator('script-container');
        await expect(scriptContainer).toBeVisible();
        await scriptContainer.locator('#tab-console').click();
        await expect(scriptContainer.locator('console-container')).toBeVisible();
    });

    test('ログレベルフィルタリング機能の検証', async ({ editorPage }) => {
        const consoleContainer = editorPage.locator('script-container console-container');

        // 1. 各種ログを出力させる (RenderZoneController経由で捕捉される)
        // プレビューフレーム内で実行する必要があるため、iframeを特定
        const previewFrame = editorPage.frameLocator('#ios-container #renderzone');

        await test.step('各種ログを出力', async () => {
            await previewFrame.locator('body').waitFor({ state: 'visible' });

            await previewFrame.locator('body').evaluate(() => {
                console.log('Test Info Log');
                console.warn('Test Warning Log');
                console.error('Test Error Log');
                console.debug('Test Debug Log');
                console.trace('Test Trace Log');
            });

            await expect(consoleContainer.locator('.log-item')).toHaveCount(3);
        });

        await test.step('フィルタメニューの開閉確認', async () => {
            const filterBtn = consoleContainer.locator('.filter-toggle-btn');
            const filterMenu = consoleContainer.locator('.filter-menu');

            await expect(filterMenu).toBeHidden();
            await filterBtn.click();
            await expect(filterMenu).toBeVisible();

            // 閉じる (バックドロップクリック)
            await consoleContainer.locator('.backdrop').click();
            await expect(filterMenu).toBeHidden();
        });

        await test.step('各レベルのフィルタリング動作確認', async () => {
            const filterBtn = consoleContainer.locator('.filter-toggle-btn');
            await filterBtn.click();
            const filterMenu = consoleContainer.locator('.filter-menu');

            // --- Info をOFFにする ---
            await filterMenu.locator('.filter-item', { hasText: '情報' }).click();
            // 'Test Info Log' が消えていること
            await expect(consoleContainer.locator('.log-item.info')).toBeHidden();
            // 他は残っていること
            await expect(consoleContainer.locator('.log-item.error')).toBeVisible();

            // --- Error をOFFにする ---
            await filterMenu.locator('.filter-item', { hasText: 'エラー' }).click();
            await expect(consoleContainer.locator('.log-item.error')).toBeHidden();

            // --- Warning をOFFにする ---
            await filterMenu.locator('.filter-item', { hasText: '警告' }).click();
            await expect(consoleContainer.locator('.log-item.warn')).toBeHidden();

            // デフォルトでOFFの Verbose (Debug/Trace) をONにする
            await filterMenu.locator('.filter-item', { hasText: '詳細' }).click();
            await expect(consoleContainer.locator('.log-item.debug')).toBeVisible();
            await expect(consoleContainer.locator('.log-item.trace')).toBeVisible();

            // フィルタメニューを閉じる
            await consoleContainer.locator('.backdrop').click();
        });

        await test.step('全非表示時のメッセージ確認', async () => {
            const filterBtn = consoleContainer.locator('.filter-toggle-btn');
            await filterBtn.click();
            const filterMenu = consoleContainer.locator('.filter-menu');

            // VerboseもOFFにする（これで全てOFF）
            await filterMenu.locator('.filter-item', { hasText: '詳細' }).click();

            await expect(consoleContainer.locator('.log-item')).toHaveCount(0);
            await expect(consoleContainer.getByText('フィルタによりすべてのログが非表示になっています')).toBeVisible();
        });
    });

    test('クリップボードコピー機能の検証', async ({ editorPage, browserName }) => {
        const consoleContainer = editorPage.locator('script-container console-container');
        const copyButton = consoleContainer.locator('button.toolbar-btn[title="表示中のログをコピー"]');

        await test.step('ログ出力とコピー実行', async () => {
            const previewFrame = editorPage.frameLocator('#ios-container #renderzone');
            await previewFrame.locator('body').waitFor({ state: 'visible' });

            await previewFrame.locator('body').evaluate(() => {
                console.log('Copy Test Log 1');
                console.error('Copy Test Log 2');
            });

            await expect(consoleContainer.locator('.log-item')).toHaveCount(2);

            // コピーボタンをクリック
            await copyButton.click();
        });

        await test.step('アラートの確認', async () => {
            const alert = editorPage.locator('alert-component');
            await expect(alert).toBeVisible();
            await expect(alert).toContainText('コンソールログをコピーしました');
            await alert.getByRole('button', { name: '閉じる' }).click();
        });

        // クリップボード読み取りはChromiumのみサポート
        if (browserName === 'chromium') {
            await test.step('クリップボード内容の検証', async () => {
                // ブラウザからクリップボードのテキストを読み取る
                const clipboardText = await editorPage.evaluate(() => navigator.clipboard.readText());

                // ConsoleContainer.js は console.log を "LOG:" という接頭辞で出力するため、LOG: を期待する
                expect(clipboardText).toContain('LOG: Copy Test Log 1');
                expect(clipboardText).toContain('ERROR: Copy Test Log 2');

                // タイムスタンプ形式の正規表現を [12:34:56] に対応するように修正
                expect(clipboardText).toMatch(/^\[\d{1,2}:\d{2}:\d{2}\]/);
            });
        }
    });

    test('ログクリアとUI配置の検証', async ({ editorPage }) => {
        const consoleContainer = editorPage.locator('script-container console-container');
        const clearButton = consoleContainer.locator('button.toolbar-btn[title="コンソールをクリア"]');
        const copyButton = consoleContainer.locator('button.toolbar-btn[title="表示中のログをコピー"]');

        await test.step('初期状態（ログ空）でのボタン状態確認', async () => {
            // 初期状態ではログは空のはず（システムログが出る可能性はあるが、空メッセージが出るか確認）
            // システムログが出ている場合はクリアしてから確認
            if (await consoleContainer.locator('.log-item').count() > 0) {
                await clearButton.click();
            }

            await expect(consoleContainer.getByText('コンソールは空です')).toBeVisible();
            await expect(copyButton).toBeDisabled();
        });

        await test.step('ログ出力後のクリア動作確認', async () => {
            const previewFrame = editorPage.frameLocator('#ios-container #renderzone');
            await previewFrame.locator('body').waitFor({ state: 'visible' });
            await previewFrame.locator('body').evaluate(() => console.log('Log to clear'));

            await expect(consoleContainer.locator('.log-item')).toHaveCount(1);
            await expect(copyButton).toBeEnabled();

            await clearButton.click();

            await expect(consoleContainer.locator('.log-item')).toHaveCount(0);
            await expect(consoleContainer.getByText('コンソールは空です')).toBeVisible();
            await expect(copyButton).toBeDisabled();
        });

        await test.step('UI配置の検証', async () => {
            // クリアボタンが左側(.toolbar-left)にあること
            const leftToolbar = consoleContainer.locator('.toolbar-left');
            await expect(leftToolbar.locator('button.toolbar-btn[title="コンソールをクリア"]')).toBeVisible();

            // コピーボタンとフィルタが右側(.toolbar-right)にあること
            const rightToolbar = consoleContainer.locator('.toolbar-right');
            await expect(rightToolbar.locator('button.toolbar-btn[title="表示中のログをコピー"]')).toBeVisible();
            await expect(rightToolbar.locator('.filter-dropdown')).toBeVisible();
        });
    });

});