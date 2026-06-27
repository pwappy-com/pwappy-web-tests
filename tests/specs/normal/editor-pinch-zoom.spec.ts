import { test as base, expect, Page } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

type EditorFixtures = {
    editorPage: Page;
    appName: string;
    appKey: string;
    editorHelper: EditorHelper;
};

const test = base.extend<EditorFixtures>({
    appName: async ({ isMobile }, use) => {
        // 【最適化】非モバイル環境時はセットアップ文字列の生成もスキップ
        if (!isMobile) {
            await use('');
            return;
        }
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        await use(`pinch-zoom-${uniqueId}`.slice(0, 30));
    },
    appKey: async ({ isMobile }, use) => {
        if (!isMobile) {
            await use('');
            return;
        }
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        await use(`pz-key-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName, appKey, isMobile }, use) => {
        // 【最適化】モバイルでない場合はアプリ作成・エディタ起動などの重い処理を100%スキップして早期リターン
        if (!isMobile) {
            await use(null as any);
            return;
        }

        await gotoDashboard(page);
        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });

        await createApp(page, appName, appKey);

        const editorPage = await openEditor(page, context, appName);
        await use(editorPage);

        await editorPage.close();
        await page.bringToFront();
        await deleteApp(page, appKey);
    },
    editorHelper: async ({ editorPage, isMobile }, use) => {
        if (!isMobile) {
            await use(null as any);
            return;
        }
        const helper = new EditorHelper(editorPage, isMobile);
        await use(helper);
    },
});

test.describe('Monacoエディタにおける2本指ピンチによるフォントサイズ変更テスト（モバイル）', () => {

    test.beforeEach(async ({ isMobile }) => {
        // モバイル環境以外（PCブラウザテスト時など）は自動的にスキップ
        test.skip(!isMobile, 'This test is exclusive to mobile browser environments.');
    });

    test('スクリプトエディタ上でピンチアウト操作を行うと、フォントサイズが拡大する', async ({ editorPage, editorHelper }) => {
        await test.step('セットアップ: スクリプトを新規作成して編集画面を開く', async () => {
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await editorHelper.addNewScript('testPinch');
            await editorHelper.openScriptForEditing('testPinch');
        });

        // 状態確認用ヘルパー関数：Monacoエディタの現在のフォントサイズを直接取得する
        const getEditorFontSize = async () => {
            return await editorPage.evaluate(() => {
                const appContainer = document.querySelector('app-container');
                const scriptContainer = appContainer?.shadowRoot?.querySelector('script-container') as any;
                if (scriptContainer && scriptContainer.styleEditor) {
                    return scriptContainer.styleEditor.getOption(scriptContainer.monaco.editor.EditorOption.fontSize);
                }
                return null;
            });
        };

        let initialFontSize: number | null = null;

        await test.step('初期フォントサイズを取得', async () => {
            initialFontSize = await getEditorFontSize();
            expect(initialFontSize).not.toBeNull();
            console.log(`[PinchTest] 初期フォントサイズ: ${initialFontSize}px`);
        });

        await test.step('2本指ピンチアウト（拡大）操作を擬似的に発行する', async () => {
            // タッチ配列オブジェクトの厳密な型チェック例外を回避するため、
            // Event に対して Object.defineProperty で touches プロパティを後挿入してディスパッチします
            await editorPage.evaluate(() => {
                const appContainer = document.querySelector('app-container');
                const scriptContainer = appContainer?.shadowRoot?.querySelector('script-container');
                const editorElement = scriptContainer?.shadowRoot?.querySelector('#script-container');

                if (!editorElement) throw new Error('Editor element not found');

                // 1. touchstart (2本指の間隔: 100px = |200 - 100|)
                const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
                Object.defineProperty(touchStart, 'touches', {
                    value: [
                        { clientX: 100, clientY: 100 },
                        { clientX: 200, clientY: 100 }
                    ],
                    writable: false
                });
                editorElement.dispatchEvent(touchStart);

                // 2. touchmove (2本指の間隔を広げる: 200px = |250 - 50| -> スケール 2.0 倍)
                const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
                Object.defineProperty(touchMove, 'touches', {
                    value: [
                        { clientX: 50, clientY: 100 },
                        { clientX: 250, clientY: 100 }
                    ],
                    writable: false
                });
                editorElement.dispatchEvent(touchMove);

                // 3. touchend
                const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
                editorElement.dispatchEvent(touchEnd);
            });
        });

        await test.step('フォントサイズが想定通り拡大されたことを検証', async () => {
            const updatedFontSize = await getEditorFontSize();
            expect(updatedFontSize).not.toBeNull();
            console.log(`[PinchTest] ピンチアウト後のフォントサイズ: ${updatedFontSize}px`);

            // スケール2.0に拡大しているため、初期サイズよりも確実に大きくなっていることをアサート
            expect(updatedFontSize!).toBeGreaterThan(initialFontSize!);
        });
    });
});