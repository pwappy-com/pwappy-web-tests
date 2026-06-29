/**
 * @fileoverview スクリプト並べ替え機能の検証テスト
 * 
 * 【テスト概要】
 * エディタのスクリプト一覧において、ドラッグ＆ドロップによる順序変更が正しく動作することを検証します。
 * 
 * 【主な検証項目】
 * 1. スクリプト追加時のUI遷移:
 *    - スクリプトが0件の場合（直接追加メニュー表示）
 *    - スクリプトが存在する場合（管理リスト経由での追加）
 * 2. ドラッグ＆ドロップによる並べ替え:
 *    - PC環境: マウスイベント（mousedown -> move -> up）による操作
 *    - モバイル環境: CDP (Chrome DevTools Protocol) を使用した厳密なタッチイベント
 *      (touchstart -> 300ms待機 -> touchmove -> touchend) のシミュレーション
 * 3. 表示の同期確認:
 *    - 並べ替え用ポップアップ内での順序反映
 *    - メインリスト（エディタ背面）への順序反映
 * 
 * 【技術的注意点】
 * ScriptContainer.jsの実装にある「300msの長押し判定」をパスするため、
 * モバイルエミュレーション時は通常のclick/drag操作ではなく、CDP経由で低レイヤーのイベントを送信しています。
 */

import { test as base, expect, Page, CDPSession } from '@playwright/test';
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

        try { await editorPage.evaluate(() => window.stop()); } catch (e) { }
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
    appName = `reorder-test-${uniqueId}`.slice(0, 30);
    appKey = `re-key-${uniqueId}`.slice(0, 30);

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

test.describe('スクリプトの並べ替えテスト', () => {

    test('スクリプト編集メニューからドラッグ＆ドロップで順序を変更できる', async ({ editorPage, editorHelper, isMobile }) => {
        const scriptContainer = editorPage.locator('script-container');
        const listContainer = scriptContainer.locator('#script-list-container');
        const addMenu = listContainer.locator('#scriptAddMenu');
        const scriptListPopup = scriptContainer.locator('#scriptList');
        const scriptNames = ['scriptA', 'scriptB', 'scriptC'];

        // --- モバイル用のタッチ操作シミュレーター ---
        let cdpSession: CDPSession | null = null;
        if (isMobile && editorPage.context().browser()?.browserType().name() === 'chromium') {
            cdpSession = await editorPage.context().newCDPSession(editorPage);
        }

        await test.step('1. スクリプトを3つ作成する', async () => {
            await editorHelper.openMoveingHandle('right');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await expect(listContainer).toBeVisible();

            for (const name of scriptNames) {
                await listContainer.locator('#fab-edit').click();
                if (await scriptListPopup.isVisible()) {
                    await scriptListPopup.locator('#add-attr').click();
                }
                await expect(addMenu).toBeVisible();
                const scriptNameInput = addMenu.locator('input#script-name');
                await expect(scriptNameInput).toBeEditable();
                await scriptNameInput.fill(name);
                await addMenu.locator('button#script-add-button').click();
                await expect(addMenu).toBeHidden();
            }
        });

        await test.step('2. 初期順序を確認', async () => {
            const mainListNames = scriptContainer.locator('.editor .label-script-name');
            await expect(mainListNames.nth(0)).toHaveText('scriptA');
            await expect(mainListNames.nth(1)).toHaveText('scriptB');
            await expect(mainListNames.nth(2)).toHaveText('scriptC');
        });

        await test.step('3. ドラッグ＆ドロップで並べ替え (AをCの下へ)', async () => {
            await listContainer.locator('#fab-edit').click();
            await expect(scriptListPopup).toBeVisible();

            const itemA = scriptListPopup.locator('.script-item', { hasText: 'scriptA' });
            const itemC = scriptListPopup.locator('.script-item', { hasText: 'scriptC' });
            const handleA = itemA.locator('.drag-handle');

            const boxA = await handleA.boundingBox();
            const boxC = await itemC.boundingBox();

            if (!boxA || !boxC) throw new Error('座標取得失敗');

            const startX = Math.round(boxA.x + boxA.width / 2);
            const startY = Math.round(boxA.y + boxA.height / 2);
            const endX = Math.round(boxC.x + boxC.width / 2);
            const endY = Math.round(boxC.y + boxC.height + 10); // Cの下側

            if (isMobile && cdpSession) {
                // --- モバイル: 厳密な TouchEvent シミュレーション ---
                await cdpSession.send('Input.dispatchTouchEvent', {
                    type: 'touchStart',
                    touchPoints: [{ x: startX, y: startY }]
                });

                // ScriptContainer.js の 300ms タイマー（長押し判定）を待機
                await editorPage.waitForTimeout(500);

                const steps = 10;
                for (let i = 1; i <= steps; i++) {
                    const moveX = startX + (endX - startX) * (i / steps);
                    const moveY = startY + (endY - startY) * (i / steps);
                    await cdpSession.send('Input.dispatchTouchEvent', {
                        type: 'touchMove',
                        touchPoints: [{ x: Math.round(moveX), y: Math.round(moveY) }]
                    });
                    await editorPage.waitForTimeout(20);
                }

                await editorPage.waitForTimeout(200);
                await cdpSession.send('Input.dispatchTouchEvent', {
                    type: 'touchEnd',
                    touchPoints: []
                });
            } else {
                // --- PC: マウス操作シミュレーション ---
                await handleA.hover();
                await editorPage.mouse.down();
                await editorPage.waitForTimeout(500);
                await editorPage.mouse.move(endX, endY, { steps: 15 });
                await editorPage.waitForTimeout(200);
                await editorPage.mouse.up();
            }

            await editorPage.waitForTimeout(1000);
        });

        await test.step('4. 結果の検証', async () => {
            const popupNames = scriptListPopup.locator('.script-name');
            const namesInPopup = await popupNames.allInnerTexts();

            await expect(popupNames.nth(0)).toHaveText('scriptB');
            await expect(popupNames.nth(1)).toHaveText('scriptC');
            await expect(popupNames.nth(2)).toHaveText('scriptA');

            await editorPage.mouse.click(10, 10);
            await expect(scriptListPopup).toBeHidden();

            const mainListNames = scriptContainer.locator('.editor .label-script-name');
            await expect(mainListNames.nth(0)).toHaveText('scriptB');
            await expect(mainListNames.nth(1)).toHaveText('scriptC');
            await expect(mainListNames.nth(2)).toHaveText('scriptA');
        });
    });
});