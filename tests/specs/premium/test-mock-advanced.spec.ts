import { test as base, expect, Page } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper, normalizeWhitespace } from '../../tools/editor-helpers';

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
        await use(`mock-adv-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName }, use) => {
        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        const domain = testUrl.hostname;
        await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/' },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/' },
            { name: 'pwappy_login', value: '1', domain: domain, path: '/' },
        ]);
        await page.goto(String(process.env.PWAPPY_TEST_BASE_URL), { waitUntil: 'domcontentloaded' });
        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });

        const appKey = `mock-adv-${Date.now().toString().slice(-6)}`;
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

test.describe('テスト＆モック：高度なブラウザAPIモックとアサーション詳細表示', () => {

    test('テスト失敗時の詳細なエラー理由とDOMスナップショット（ダンプ）の表示', async ({ editorPage, editorHelper }) => {
        const scenarioName = '故意に失敗させるテスト';

        await test.step('1. 意図的に失敗するテストシナリオを作成', async () => {
            // D&D（setupPageWithButton）を省き、直接テストタブを開く
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'テスト');

            const testContainer = editorPage.locator('test-container');
            await testContainer.locator('.add-btn').click({ force: true });
            const modal = editorPage.locator('test-scenario-editor .modal');
            await modal.locator('#scenario-name').fill(scenarioName);

            const badTestCode = `export default async function runTest() { throw new Error('FAIL_MARKER_007'); }`;
            const monacoEditorLocator = modal.locator('.monaco-editor[role="code"]');

            await monacoEditorLocator.evaluate((el: any, code) => {
                const host = (el.getRootNode() as ShadowRoot).host as any;
                if (host && host.monacoEditor) { host.monacoEditor.setValue(code); }
            }, badTestCode);

            const textarea = monacoEditorLocator.locator('textarea').first();
            await textarea.focus();
            await editorPage.keyboard.press('End');
            await editorPage.keyboard.type(' ');
            await editorPage.keyboard.press('Backspace');

            await modal.getByRole('button', { name: '保存' }).click({ force: true });
            await expect(modal).toBeHidden();
        });

        await test.step('2. テストを実行し、詳細な失敗理由を確認する', async () => {
            const testContainer = editorPage.locator('test-container');
            const scenarioRow = testContainer.locator('.scenario-item', { hasText: scenarioName });
            await scenarioRow.locator('.run-btn').click({ force: true });

            await expect(async () => {
                if (await scenarioRow.locator('.badge.pass').isVisible()) {
                    throw new Error('Test passed unexpectedly. Code not saved.');
                }
                await expect(scenarioRow.locator('.badge.fail')).toBeVisible({ timeout: 2000 });
            }).toPass({ timeout: 45000, intervals: [2000] });

            await scenarioRow.locator('.scenario-header').click({ force: true });
            const errorText = await scenarioRow.locator('.error-reason pre').innerText();
            expect(errorText).toContain('FAIL_MARKER_007');
        });
    });

    test('3種類のブラウザモック（同期、非同期、プロパティ）と関数の連鎖(IIFE)の実行', async ({ editorPage, editorHelper }) => {
        await editorHelper.openMoveingHandle('right');
        const scriptContainer = editorPage.locator('script-container');
        await editorHelper.switchTabInContainer(scriptContainer, 'テスト');

        const testContainer = editorPage.locator('test-container');

        await test.step('1. 各種ブラウザモックを定義する', async () => {
            await testContainer.locator('.tab', { hasText: 'APIモック' }).click({ force: true });

            // プロパティモック
            await testContainer.locator('.add-btn').click({ force: true });
            let modal = testContainer.locator('.modal-dialog');
            await modal.locator('#mock-type').selectOption('browser');
            await modal.locator('#mock-browser-type').selectOption('property');
            await modal.locator('#mock-path').fill('navigator.userAgent');
            await modal.locator('#mock-pattern').fill('CustomAgent');
            await modal.locator('#mock-response').fill('"PwappyTestBrowser"');
            await modal.getByRole('button', { name: '設定を保存' }).click({ force: true });

            // 同期関数モック (Date.nowは無限ループの原因になるため、btoaを使用)
            await testContainer.locator('.add-btn').click({ force: true });
            modal = testContainer.locator('.modal-dialog');
            await modal.locator('#mock-type').selectOption('browser');
            await modal.locator('#mock-browser-type').selectOption('sync_function');
            await modal.locator('#mock-path').fill('window.btoa');
            await modal.locator('#mock-pattern').fill('FixedBase64');
            await modal.locator('#mock-response').fill('"MOCKED_BASE64"');
            await modal.getByRole('button', { name: '設定を保存' }).click({ force: true });

            // 非同期・関数連鎖モック (IIFE)
            await testContainer.locator('.add-btn').click({ force: true });
            modal = testContainer.locator('.modal-dialog');
            await modal.locator('#mock-type').selectOption('browser');
            await modal.locator('#mock-browser-type').selectOption('async_function');
            await modal.locator('#mock-path').fill('navigator.mediaDevices.getUserMedia');
            await modal.locator('#mock-pattern').fill('CameraMock');
            const iifeCode = `(function() { return { getTracks: function() { return [{ stop: function() { window.__cameraStopped = true; } }]; } }; })()`;
            await modal.locator('#mock-response').fill(iifeCode);
            await modal.getByRole('button', { name: '設定を保存' }).click({ force: true });
        });

        await test.step('2. プレビュー環境(iframe)内でモックが正しく機能しているか直接検証する', async () => {
            
            // ハンドルを閉じる（モバイル環境でのクリック阻害対策）
            await editorHelper.closeMoveingHandle();

            // モックを有効にするため「動作モード」に切り替える
            // force: true で、万が一他の要素（プロパティパネル等）と重なっていても強制的にクリックする
            const platformSwitcher = editorPage.locator('platform-switcher');
            await platformSwitcher.locator('.screen-rotete-container').click({ force: true });
            const editMenu = editorPage.locator('#platformEditMenu');
            await expect(editMenu).toBeVisible();
            await editMenu.getByText('動作').click({ force: true });
            await platformSwitcher.locator('.screen-rotete-container').click({ force: true });
            await expect(editMenu).toBeHidden();

            await editorPage.waitForTimeout(3000);

            const previewFrame = editorPage.frameLocator('#ios-container #renderzone');
            await previewFrame.locator('body').waitFor({ state: 'attached' });

            const mockResults = await previewFrame.locator('body').evaluate(async () => {
                const results = { ua: '', b64: '', cameraStopped: false, error: null as string | null };

                try {
                    // 1. プロパティモックの検証
                    results.ua = navigator.userAgent;

                    // 2. 同期関数の検証
                    results.b64 = window.btoa('test_string');

                    // 3. 非同期関数と連鎖呼び出しの検証
                    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                    stream.getTracks()[0].stop();
                    results.cameraStopped = (window as any).__cameraStopped === true;
                } catch (e: any) {
                    results.error = e.message;
                }
                return results;
            });

            await editorPage.waitForTimeout(1000);
            
            // Playwright側でアサーションを実行
            expect(mockResults.error).toBeNull();
            expect(mockResults.ua).toBe('PwappyTestBrowser');
            expect(mockResults.b64).toBe('MOCKED_BASE64');
            expect(mockResults.cameraStopped).toBe(true);
        });
    });
});