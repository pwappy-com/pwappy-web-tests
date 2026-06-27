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
        if (!isMobile) {
            await use('');
            return;
        }
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        await use(`starter-${uniqueId}`.slice(0, 30));
    },
    appKey: async ({ isMobile }, use) => {
        if (!isMobile) {
            await use('');
            return;
        }
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        await use(`str-key-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName, appKey, isMobile }, use) => {
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

test.describe('画面エッジホバーによるパネル自動開閉テスト（モバイル）', () => {

    test.beforeEach(async ({ isMobile, editorHelper, editorPage }) => {
        // モバイルのテスト時（isMobile フィクスチャが真）のみ活性化し、PCテスト時は安全にスキップ
        test.skip(!isMobile, 'This test is exclusive to mobile viewports with side panels.');

        // スタート時点では両方のパネルが閉じている状態にする
        await editorHelper.closeMoveingHandle();

        // 完全に閉じるまで少し待機
        await editorPage.waitForTimeout(500);
    });

    test('要素のドラッグ中に右端にホバーすると右パネルが自動展開される', async ({ editorPage }) => {
        const appContainer = editorPage.locator('app-container');
        const rightEdgeTrigger = appContainer.locator('.edge-trigger.right');
        const scriptContainer = editorPage.locator('script-container');

        await test.step('1. ドラッグの開始状態をシミュレートする', async () => {
            // AppContainer にドラッグ開始を認識させるため、グローバル変数とイベントを発行
            await editorPage.evaluate(() => {
                (window as any).dragItemType = 'node-id';
                window.dispatchEvent(new CustomEvent('app-drag-start'));
            });

            // ドラッグ中フラグが立ち、エッジトリガーが active になっているか検証
            await expect(rightEdgeTrigger).toHaveClass(/active/);
        });

        await test.step('2. 画面の右端にマウスポインター（タッチ）を移動してホバーする', async () => {
            const viewport = editorPage.viewportSize();
            if (!viewport) throw new Error('Viewport size not set');

            // 画面の右端（幅の10px手前）、高さの中央にポインターを移動
            const targetX = viewport.width - 10;
            const targetY = viewport.height / 2;

            // マウス移動により handleGlobalDragMove をトリガー
            await editorPage.mouse.move(targetX, targetY);

            // 右のトリガーが hover 状態になるか検証
            await expect(rightEdgeTrigger).toHaveClass(/hover/);
        });

        await test.step('3. ホバーを維持すると右パネル（サブウィンドウ）が展開される', async () => {
            // AppContainer側のタイマー設定（800ms）を確実に経過させるため1.5秒待機
            await editorPage.waitForTimeout(1500);

            // 右パネル（script-containerなど）が表示状態になっていることを検証
            await expect(scriptContainer).toBeVisible();
        });

        await test.step('4. ドラッグの終了状態をシミュレートする', async () => {
            await editorPage.evaluate(() => {
                window.dispatchEvent(new CustomEvent('app-drag-end'));
                (window as any).dragItemType = '';
            });

            // エッジトリガーの active 状態が解除されることを検証
            await expect(rightEdgeTrigger).not.toHaveClass(/active/);
        });
    });

    test('要素のドラッグ中に左端にホバーすると左パネルが自動展開される', async ({ editorPage }) => {
        const appContainer = editorPage.locator('app-container');
        const leftEdgeTrigger = appContainer.locator('.edge-trigger.left');
        const templateContainer = editorPage.locator('template-container');

        await test.step('1. ドラッグの開始状態をシミュレートする', async () => {
            await editorPage.evaluate(() => {
                (window as any).dragItemType = 'node-id';
                window.dispatchEvent(new CustomEvent('app-drag-start'));
            });

            await expect(leftEdgeTrigger).toHaveClass(/active/);
        });

        await test.step('2. 画面の左端にマウスポインター（タッチ）を移動してホバーする', async () => {
            const viewport = editorPage.viewportSize();
            if (!viewport) throw new Error('Viewport size not set');

            // 画面の左端（10px）、高さの中央にポインターを移動
            const targetX = 10;
            const targetY = viewport.height / 2;

            await editorPage.mouse.move(targetX, targetY);

            // 左のトリガーが hover 状態になるか検証
            await expect(leftEdgeTrigger).toHaveClass(/hover/);
        });

        await test.step('3. ホバーを維持すると左パネル（レイアウトウィンドウ）が展開される', async () => {
            // タイマー（800ms）を待機
            await editorPage.waitForTimeout(1500);

            // 左パネルが表示状態になっていることを検証
            await expect(templateContainer).toBeVisible();
        });

        await test.step('4. ドラッグの終了状態をシミュレートする', async () => {
            await editorPage.evaluate(() => {
                window.dispatchEvent(new CustomEvent('app-drag-end'));
                (window as any).dragItemType = '';
            });

            await expect(leftEdgeTrigger).not.toHaveClass(/active/);
        });
    });
});