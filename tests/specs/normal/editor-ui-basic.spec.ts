import { test as base, expect, Page, Locator, CDPSession, Dialog } from '@playwright/test';
import * as path from 'path';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor, addVersion } from '../../tools/dashboard-helpers';
import { EditorHelper, normalizeWhitespace } from '../../tools/editor-helpers';
import { getStorageStatePath } from '../../constants';

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

    // workerIndex を取得
    const workerIndex = test.info().workerIndex;
    const storageStatePath = getStorageStatePath(workerIndex);

    const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
    appName = `ui-auto-${uniqueId}`.slice(0, 30);
    appKey = `auto-key-${uniqueId}`.slice(0, 30);

    // ワーカー固有のセッションファイルを指定してコンテキストを作成
    const context = await browser.newContext({ storageState: storageStatePath });
    const page = await context.newPage();

    await gotoDashboard(page);
    await createApp(page, appName, appKey);

    await context.close();
});

// すべてのテストが終了した後に、アプリを削除する
test.afterAll(async ({ browser }) => {
    if (appKey) {
        // 現在のワーカーのインデックスを取得
        const workerIndex = test.info().workerIndex;
        // ワーカー固有のセッションファイルのパスを取得
        const storageStatePath = getStorageStatePath(workerIndex);

        const context = await browser.newContext({ storageState: storageStatePath });
        const page = await context.newPage();

        await gotoDashboard(page);
        await deleteApp(page, appKey);

        await context.close();
    }
});

/**
 * 共有ヘルパー関数: 指定した入力欄をマウスでドラッグする
 */
async function dragInput(editorPage: Page, inputLocator: Locator, deltaX: number, deltaY: number, shiftKey: boolean = false) {
    const box = await inputLocator.boundingBox();
    if (!box) throw new Error('Input bounding box not found');

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    // WebKit環境のShadow DOMにおける誤検知（インターセプト判定）を回避するため、force: true を適用します
    await inputLocator.click({ force: true });
    await editorPage.waitForTimeout(100);

    await editorPage.mouse.move(startX, startY);

    if (shiftKey) await editorPage.keyboard.down('Shift');
    await editorPage.mouse.down();

    let finalDeltaX = deltaX;
    let finalDeltaY = deltaY;
    if (deltaX === 0 && deltaY !== 0) {
        finalDeltaX = -deltaY;
        finalDeltaY = 0;
    }

    await editorPage.mouse.move(startX + finalDeltaX, startY + finalDeltaY, { steps: 10 });
    await editorPage.mouse.up();
    if (shiftKey) await editorPage.keyboard.up('Shift');
}

const logTime = (msg: string) => {
    const now = new Date();
    console.log(`[TourTest:Time] ${now.toISOString()} - ${msg}`);
};

// =========================================================================
// Merged from: tests/specs/normal/editor-events.spec.ts
// =========================================================================

test.describe('エディタ内イベント＆スクリプト機能のUIテスト（保存なし）', () => {

    test('カスタムイベントを定義できる', async ({ editorPage, editorHelper }) => {
        const listenerTarget = 'element';
        const eventName = 'test-event';
        const comment = 'テストコメント';

        await test.step('1. 新しいイベント定義を追加する', async () => {
            await editorHelper.addCustomEventDefinition({
                listenerTarget,
                eventName,
                comment,
            });
        });
    });

    test('サービスワーカータブでカスタムイベントを定義できる', async ({ editorPage, editorHelper }) => {
        const eventName = 'new-serviceworker-event';
        const comment = '新しいサービスワーカーイベント';

        await test.step('1. 新しいサービスワーカーイベント定義を追加する', async () => {
            await editorHelper.addCustomServiceWorkerEventDefinition({
                eventName,
                comment,
            });
        });
    });

    test('スクリプトエラーがある場合、タブ移動と保存がブロックされる', async ({ editorPage, editorHelper }) => {
        const scriptName = 'errorScript';
        const invalidScript = 'const 0a = 1;'; // 不正な変数名
        const expectedDialogMessage = 'スクリプトのエラーを修正してください';

        await test.step('セットアップ: エラーのあるスクリプトを入力する', async () => {
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await editorHelper.addNewScript(scriptName, 'function');
            // ヘルパーメソッドを使って、保存せずに不正なスクリプトを入力
            await editorHelper.fillScriptContent(scriptName, invalidScript);
        });

        await test.step('検証: 他のタブに移動しようとするとダイアログが表示されブロックされる', async () => {
            const scriptContainer = editorPage.locator('script-container');
            const monacoEditor = scriptContainer.locator('.monaco-editor[role="code"]');
            const alertDialog = editorPage.locator('alert-component');

            // テスト対象のタブ（イベント、サービスワーカー）
            const tabsToTest = ['イベント', 'サービスワーカー'];

            for (const tabName of tabsToTest) {
                // タブをクリック
                await scriptContainer.locator('.tab', { hasText: tabName }).click();

                // ダイアログを検証
                await expect(alertDialog).toBeVisible();
                await expect(alertDialog).toContainText(expectedDialogMessage);
                await alertDialog.getByRole('button', { name: '閉じる' }).click();
                await expect(alertDialog).toBeHidden();

                // エディタ（Monaco）が表示されたままであることを確認
                await expect(monacoEditor).toBeVisible();
                // 対応するタブのコンテナが表示されていないことを確認
                if (tabName === 'イベント') {
                    await expect(scriptContainer.locator('event-container')).toBeHidden();
                } else if (tabName === 'サービスワーカー') {
                    await expect(scriptContainer.locator('service-worker-container')).toBeHidden();
                }
            }
        });

        await test.step('検証: 保存しようとするとダイアログが表示されブロックされる', async () => {
            const scriptContainer = editorPage.locator('script-container');
            const monacoEditor = scriptContainer.locator('.monaco-editor[role="code"]');
            const saveButton = scriptContainer.locator('#fab-save');
            const alertDialog = editorPage.locator('alert-component');

            // 保存ボタンをクリック
            await saveButton.click();

            // ダイアログを検証
            await expect(alertDialog).toBeVisible();
            await expect(alertDialog).toContainText(expectedDialogMessage);
            await alertDialog.getByRole('button', { name: '閉じる' }).click();
            await expect(alertDialog).toBeHidden();

            // エディタ（Monaco）が表示されたままであることを確認
            await expect(monacoEditor).toBeVisible();
        });
    });
});
// =========================================================================
// Merged from: tests/specs/normal/editor-structure.spec.ts
// =========================================================================

test.describe('エディタ内：UI構造操作の高度なテスト', () => {

    test.beforeEach(async ({ page, context }) => {
        await gotoDashboard(page);
        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });
    });

    test('要素のコピー＆ペースト：同一ページ内および異なるページ間での複製', async ({ editorPage, editorHelper }) => {
        test.setTimeout(120000);

        let page1Id: string;
        let page2Id: string;

        await test.step('1. セットアップ：2つのページを作成', async () => {
            const setup = await editorHelper.setupPageWithButton();
            page1Id = await setup.pageNode.getAttribute('data-node-id') as string;

            const page2 = await editorHelper.addPage();
            page2Id = await page2.getAttribute('data-node-id') as string;

            await editorHelper.switchTopLevelTemplate(page1Id);
        });

        await test.step('2. 同一ページ内でのコピー＆ペースト', async () => {
            const page1Content = editorPage.locator(`div[data-node-id="${page1Id}"] div[data-node-explain="コンテンツ"]`);
            const button1 = page1Content.locator('.node[data-node-dom-id="ons-button1"]');

            await editorHelper.selectNodeInDomTree(button1);
            const copyIcon = button1.locator('.copy-icon');
            await copyIcon.click();

            await expect(copyIcon.locator('i')).toHaveClass(/fa-paste/);
            await copyIcon.click();

            const buttons = page1Content.locator('> .node[data-node-type="ons-button"]');
            await expect(buttons).toHaveCount(2);
            await expect(buttons.filter({ hasText: 'ons-button2' })).toBeVisible();
        });

        await test.step('3. 異なるページへのコピー＆ペースト（間接兄弟として挿入）', async () => {
            const page1Content = editorPage.locator(`div[data-node-id="${page1Id}"] div[data-node-explain="コンテンツ"]`);
            const button1 = page1Content.locator('.node[data-node-dom-id="ons-button1"]');

            await editorHelper.selectNodeInDomTree(button1);
            await button1.locator('.copy-icon').click();

            await editorHelper.switchTopLevelTemplate(page2Id);

            const page2Content = editorPage.locator(`div[data-node-id="${page2Id}"] div[data-node-explain="コンテンツ"]`);
            await editorHelper.selectNodeInDomTree(page2Content);

            const page2PasteIcon = page2Content.locator('.copy-icon');
            await expect(page2PasteIcon.locator('i')).toHaveClass(/fa-paste/);
            await page2PasteIcon.click();

            await expect(page2Content.locator('~ .node[data-node-type="ons-button"]')).toBeVisible();
        });
    });

    test('ゴミ箱（Trash Box）のライフサイクル：削除、表示確認、空にする', async ({ editorPage, editorHelper }) => {
        let buttonNode: Locator;
        const domTree = editorHelper.getDomTree();
        const trashBox = editorPage.locator('.template-trash-box');

        await test.step('1. 要素をゴミ箱へ移動', async () => {
            const setup = await editorHelper.setupPageWithButton();
            buttonNode = setup.buttonNode;
            const buttonId = await buttonNode.getAttribute('data-node-id');

            await buttonNode.locator('.clear-icon').click();
            await expect(buttonNode).toHaveAttribute('data-delete-reserve', 'true');
            await buttonNode.locator('.clear-icon').click();

            await expect(domTree.locator(`[data-node-id="${buttonId}"]`)).toBeHidden();
        });

        await test.step('2. ゴミ箱の中身を確認', async () => {
            await editorHelper.openMoveingHandle('left');
            const layoutTrashBtn = editorPage.locator('template-container #fab-trash-box');

            await expect(async () => {
                if (!await trashBox.isVisible()) {
                    await layoutTrashBtn.click();
                }
                await expect(trashBox.locator('.template-trash-box-node').first()).toBeVisible({ timeout: 2000 });
            }).toPass({ timeout: 10000, intervals: [1000] });
        });

        await test.step('3. ゴミ箱を完全に空にする', async () => {
            const emptyButton = trashBox.locator('button').filter({ hasText: '空にする' });
            const emptyMessage = trashBox.getByText('ゴミ箱は空です');

            // ダイアログが出たら承認するハンドラを定義
            const dialogHandler = async (dialog: any) => {
                await dialog.accept();
            };

            // ステップ開始時にリスナーを登録
            editorPage.on('dialog', dialogHandler);

            try {
                // 開く確認からクリック、完了確認までを1セットとしてリトライする
                await expect(async () => {
                    // 1. 閉じてしまっていたら開き直す
                    if (!await trashBox.isVisible()) {
                        await editorPage.locator('template-container #fab-trash-box').click();
                    }

                    // 2. すでに空になっているならクリック処理は不要（リトライ時の考慮）
                    if (await emptyMessage.isVisible()) {
                        return;
                    }

                    // 3. ボタンが表示されるのを待ってクリック
                    await expect(emptyButton).toBeVisible({ timeout: 2000 });
                    await emptyButton.click({ timeout: 2000 });

                    // 4. 処理完了のメッセージが表示されるか確認
                    await expect(emptyMessage).toBeVisible({ timeout: 3000 });

                }).toPass({
                    timeout: 20000,   // 最大20秒間試行
                    intervals: [1000] // 1秒間隔でリトライ
                });

            } finally {
                // リスナーを解除
                editorPage.off('dialog', dialogHandler);
            }

            // 最後にゴミ箱の外（タイトルなど）をクリックして閉じる
            await editorPage.locator('template-container .title-bar').click();
            await expect(trashBox).toBeHidden();
        });
    });

    test('テンプレート検索：IDと説明文による要素の特定', async ({ editorPage, editorHelper }) => {
        await test.step('1. セットアップ：キーワード付き要素を作成', async () => {
            await editorHelper.addPage();
            const targetPage = await editorHelper.addPage();
            const contentArea = targetPage.locator('div[data-node-explain="コンテンツ"]');
            const targetButton = await editorHelper.addComponent('ons-button', contentArea);

            await editorHelper.selectNodeInDomTree(targetButton);
            await editorHelper.openMoveingHandle('right');

            const explainInput = editorHelper.getPropertyInput('explain').locator('input');
            await expect(explainInput).toBeEditable();
            await explainInput.fill('秘密のボタン');
            await explainInput.press('Enter');
            await editorPage.waitForTimeout(500);
        });

        await test.step('2. 検索とジャンプ', async () => {
            await editorHelper.openMoveingHandle('left');
            await editorPage.locator('.title-icon-bar-button[title="レイアウト検索"]').click();
            const searchWindow = editorPage.locator('template-search-sub-window');
            await expect(searchWindow).toBeVisible();

            const filterInput = searchWindow.locator('input.filter-box');
            await expect(filterInput).toBeEditable();
            await filterInput.fill('秘密');

            const resultItem = searchWindow.locator('template-search-result').first();
            await resultItem.locator('.fa-arrow-up-right-from-square').click();

            await expect(searchWindow).toBeHidden();
            const selectedNode = editorPage.locator('.node-select');
            await expect(selectedNode).toContainText('秘密のボタン');
        });
    });

    test('ドラッグ＆ドロップ：座標操作による要素の順序入れ替え', async ({ editorPage, editorHelper, isMobile }) => {

        test.skip(!!process.env.CI, 'CI環境ではマウス座標によるドラッグ＆ドロップが不安定なためスキップします。');

        await editorHelper.handleSnapshotRestoreDialog();

        // --- デバッグ用：画面上に操作ポイントを可視化する関数 ---
        const drawDebugPoint = async (x: number, y: number, color: string = 'red') => {
            await editorPage.evaluate(({ x, y, color }) => {
                const div = document.createElement('div');
                div.style.position = 'fixed';
                div.style.left = `${x}px`;
                div.style.top = `${y}px`;
                div.style.width = '10px';
                div.style.height = '10px';
                div.style.backgroundColor = color;
                div.style.borderRadius = '50%';
                div.style.zIndex = '100000';
                div.style.pointerEvents = 'none';
                div.classList.add('debug-pointer');
                document.body.appendChild(div);
                setTimeout(() => div.remove(), 2000);
            }, { x, y, color });
        };

        // モバイル環境（Chromium）の場合は CDP を使用してタッチイベントを直接送る
        let cdpSession: CDPSession | null = null;
        if (isMobile && editorPage.context().browser()?.browserType().name() === 'chromium') {
            cdpSession = await editorPage.context().newCDPSession(editorPage);
        }

        const pointerAction = {
            down: async (x: number, y: number) => {
                await drawDebugPoint(x, y, 'red');
                if (isMobile && cdpSession) {
                    await cdpSession.send('Input.dispatchTouchEvent', {
                        type: 'touchStart',
                        touchPoints: [{ x: Math.round(x), y: Math.round(y) }]
                    });
                } else {
                    await editorPage.mouse.move(x, y);
                    await editorPage.mouse.down();
                }
            },
            move: async (fromX: number, fromY: number, toX: number, toY: number, steps: number = 10) => {
                const stepX = (toX - fromX) / steps;
                const stepY = (toY - fromY) / steps;

                for (let i = 1; i <= steps; i++) {
                    const currentX = fromX + stepX * i;
                    const currentY = fromY + stepY * i;
                    if (isMobile && cdpSession) {
                        await cdpSession.send('Input.dispatchTouchEvent', {
                            type: 'touchMove',
                            touchPoints: [{ x: Math.round(currentX), y: Math.round(currentY) }]
                        });
                    } else {
                        await editorPage.mouse.move(currentX, currentY);
                    }
                    await editorPage.waitForTimeout(20);
                }
            },
            up: async (x?: number, y?: number) => {
                if (x !== undefined && y !== undefined) {
                    await drawDebugPoint(x, y, 'blue');
                }
                if (isMobile && cdpSession) {
                    await cdpSession.send('Input.dispatchTouchEvent', {
                        type: 'touchEnd',
                        touchPoints: []
                    });
                } else {
                    await editorPage.mouse.up();
                }
            }
        };

        /**
         * ツールボックスからコンポーネントを探し、DOMツリーへドラッグ＆ドロップする内部関数
         */
        const dragComponentFromToolbox = async (componentName: string, targetLocator: Locator) => {
            const toolbox = editorPage.locator('tool-box');
            const toolboxContainer = toolbox.locator('.container');
            const toolboxItem = toolbox.locator(`tool-box-item[data-item-type="${componentName}"]`);
            const layoutPanel = editorPage.locator('template-container .panel');

            await editorHelper.openMoveingHandle('left');

            await test.step(`ツールボックス内で ${componentName} を探す`, async () => {
                const maxScrollAttempts = 20;
                for (let i = 0; i < maxScrollAttempts; i++) {
                    const itemBox = await toolboxItem.boundingBox();
                    const containerBox = await toolboxContainer.boundingBox();

                    if (itemBox && containerBox) {
                        const itemCenterY = itemBox.y + itemBox.height / 2;
                        const containerTop = containerBox.y;
                        const containerBottom = containerBox.y + containerBox.height;

                        const isInView = (itemCenterY >= containerTop + 5) && (itemCenterY <= containerBottom - 5);

                        if (isInView) {
                            break;
                        }
                    }

                    await toolboxContainer.evaluate(el => el.scrollTop += 80);
                    await editorPage.waitForTimeout(300);

                    if (i === maxScrollAttempts - 1) {
                        throw new Error(`ツールボックス内で ${componentName} を見つけることができませんでした。`);
                    }
                }
            });

            const sourceBox = await toolboxItem.boundingBox();
            if (!sourceBox) throw new Error(`${componentName} の座標が取得できません`);

            const startX = sourceBox.x + sourceBox.width / 2;
            const startY = sourceBox.y + sourceBox.height / 2;

            await pointerAction.down(startX, startY);

            await editorPage.waitForTimeout(600);

            const ghostExists = await editorPage.evaluate(() => !!document.querySelector('.custom-drag-image'));

            let currentX = startX;
            let currentY = startY;

            for (let i = 0; i < 100; i++) {
                const pBox = await layoutPanel.boundingBox();
                const tBox = await targetLocator.boundingBox();
                if (!pBox || !tBox) break;

                const destX = tBox.x + 20;
                const destY = tBox.y + 15;

                const isTargetVisible = destY > pBox.y + 30 && destY < pBox.y + pBox.height - 30;

                if (isTargetVisible) {
                    await pointerAction.move(currentX, currentY, destX, destY, 15);
                    currentX = destX;
                    currentY = destY;
                    break;
                } else {
                    const hoverY = destY >= pBox.y + pBox.height - 30 ? pBox.y + pBox.height - 15 : pBox.y + 15;
                    await pointerAction.move(currentX, currentY, destX, hoverY, 10);
                    currentX = destX;
                    currentY = hoverY;
                    await editorPage.waitForTimeout(200);
                }
            }

            const finalBox = await targetLocator.boundingBox();
            if (finalBox) {
                await pointerAction.move(currentX, currentY, finalBox.x + 20, finalBox.y + 15, 5);
                currentX = finalBox.x + 20;
                currentY = finalBox.y + 15;
            }
            await editorPage.waitForTimeout(300);
            await pointerAction.up(finalBox?.x, finalBox?.y);
            await editorPage.waitForTimeout(500);
        };

        // =============================================================
        // テストステップ実行
        // =============================================================

        await test.step('1. ページを追加し、ツールボックスからボタンを2つドラッグ＆ドロップで配置', async () => {
            await editorHelper.addPage();
            const contentArea = editorPage.locator('template-container .node[data-node-explain="コンテンツ"]');

            await dragComponentFromToolbox('ons-button', contentArea);
            await dragComponentFromToolbox('ons-button', contentArea);

            const buttons = editorPage.locator('template-container .node[data-node-type="ons-button"]');
            await expect(buttons).toHaveCount(2);
            await expect(buttons.nth(0)).toHaveAttribute('data-node-dom-id', 'ons-button2');
            await expect(buttons.nth(1)).toHaveAttribute('data-node-dom-id', 'ons-button1');
        });

        await test.step('2. ドラッグ操作による順序反転（再進入スクロール発火版）', async () => {
            const btnTop = editorPage.locator('template-container .node[data-node-dom-id="ons-button2"]');
            const btnBottom = editorPage.locator('template-container .node[data-node-dom-id="ons-button1"]');
            const layoutPanel = editorPage.locator('template-container .panel');
            const targetInsertPoint = editorPage.locator('template-container .node[data-node-dom-id="ons-button1"] + .node-add-point');

            await btnTop.scrollIntoViewIfNeeded();
            const startBox = await btnTop.boundingBox();
            if (!startBox) throw new Error('btnTopが見つかりません');

            await pointerAction.down(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
            await editorPage.waitForTimeout(600);

            let currentX = startBox.x + startBox.width / 2;
            let currentY = startBox.y + startBox.height / 2;

            for (let i = 0; i < 100; i++) {
                const pBox = await layoutPanel.boundingBox();
                const tBox = await btnBottom.boundingBox();
                if (!pBox || !tBox) break;

                const destX = tBox.x + tBox.width / 2;
                const destY = tBox.y + tBox.height - 5;

                const isTargetVisible = destY > pBox.y + 30 && destY < pBox.y + pBox.height - 30;

                if (isTargetVisible) {
                    await pointerAction.move(currentX, currentY, destX, destY, 15);
                    currentX = destX;
                    currentY = destY;
                    break;
                } else {
                    const hoverY = destY >= pBox.y + pBox.height - 30 ? pBox.y + pBox.height - 15 : pBox.y + 15;
                    await pointerAction.move(currentX, currentY, destX, hoverY, 10);
                    currentX = destX;
                    currentY = hoverY;
                    await editorPage.waitForTimeout(200);
                }
            }

            const finalBox = await btnBottom.boundingBox();
            if (finalBox) {
                const finalDestY = finalBox.y + finalBox.height - 5;
                await pointerAction.move(currentX, currentY, finalBox.x + finalBox.width / 2, finalDestY, 5);
                currentX = finalBox.x + finalBox.width / 2;
                currentY = finalDestY;
            }
            await editorPage.waitForTimeout(400);
            await pointerAction.up(finalBox?.x, finalBox?.y);
            await editorPage.waitForTimeout(500);

            const finalNodes = editorPage.locator('template-container .node[data-node-type="ons-button"]');
            await expect(finalNodes.nth(0)).toHaveAttribute('data-node-dom-id', 'ons-button1');
            await expect(finalNodes.nth(1)).toHaveAttribute('data-node-dom-id', 'ons-button2');
        });
    });
});
// =========================================================================
// Merged from: tests/specs/normal/editor-html-tag-dialog.spec.ts
// =========================================================================

test.describe('HTMLタグ選択ダイアログ機能のテスト', () => {

    test('プリセットボタンからHTMLタグを追加できること', async ({ editorPage, editorHelper }) => {
        await editorHelper.addPage();
        const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
        const targetLocator = editorPage.locator(contentAreaSelector);

        // 1. ドラッグ＆ドロップを実行してダイアログを表示
        await editorHelper.openMoveingHandle('left');
        await editorPage.locator('tool-box-item', { hasText: 'HTML Tag' }).dragTo(targetLocator);

        const dialog = editorPage.locator('message-box#html-tag-select-dialog').first();
        await expect(dialog).toBeVisible({ timeout: 5000 });

        // 2. プリセットから「span」を選択 (preset-tag-button に更新)
        const spanButton = dialog.locator('button.preset-tag-button', { hasText: /^span$/ });
        await spanButton.click();

        // 3. ダイアログが閉じて、エディタのツリー上に要素が追加されたことを確認
        await expect(dialog).toBeHidden();
        const newHtmlTagNode = targetLocator.locator('> .node[data-node-type="span"]');
        await expect(newHtmlTagNode).toBeVisible();

        // 中身が空のタグは幅や高さが0になり visibility 判定で落ちるため、Attached で検証
        const previewElement = editorHelper.getPreviewElement('span');
        await expect(previewElement).toBeAttached();
    });

    test('手入力欄からカスタムタグを入力して追加できること', async ({ editorPage, editorHelper }) => {
        await editorHelper.addPage();
        const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
        const targetLocator = editorPage.locator(contentAreaSelector);

        await editorHelper.openMoveingHandle('left');
        await editorPage.locator('tool-box-item', { hasText: 'HTML Tag' }).dragTo(targetLocator);

        const dialog = editorPage.locator('message-box#html-tag-select-dialog').first();
        await expect(dialog).toBeVisible();

        // 1. 手入力欄にカスタムタグ「section」を入力してEnterで決定
        const input = dialog.locator('input#custom-tag-input');
        await expect(input).toBeEditable();
        await input.fill('section');
        await input.press('Enter');

        // 2. ダイアログが閉じて、エディタのツリー上に要素が追加されたことを確認
        await expect(dialog).toBeHidden();
        const newHtmlTagNode = targetLocator.locator('> .node[data-node-type="section"]');
        await expect(newHtmlTagNode).toBeVisible();

        // 中身が空のタグは幅や高さが0になり visibility 判定で落ちるため、Attached で検証
        const previewElement = editorHelper.getPreviewElement('section');
        await expect(previewElement).toBeAttached();
    });

    test('ダイアログでキャンセルボタンを押したとき、タグが追加されないこと', async ({ editorPage, editorHelper }) => {
        await editorHelper.addPage();
        const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
        const targetLocator = editorPage.locator(contentAreaSelector);

        await editorHelper.openMoveingHandle('left');
        await editorPage.locator('tool-box-item', { hasText: 'HTML Tag' }).dragTo(targetLocator);

        const dialog = editorPage.locator('message-box#html-tag-select-dialog').first();
        await expect(dialog).toBeVisible();

        // 1. キャンセルボタンをクリック
        const cancelBtn = dialog.locator('[slot="cancel-slot"]');
        await cancelBtn.click();

        // 2. ダイアログが閉じる
        await expect(dialog).toBeHidden();

        // 3. 要素が追加されていないことを検証
        const childNodes = targetLocator.locator('> .node');
        await expect(childNodes).toHaveCount(0);
    });

    test('ダイアログのオーバーレイ（背景）をクリックしたとき、キャンセル扱いになりタグが追加されないこと', async ({ editorPage, editorHelper }) => {
        await editorHelper.addPage();
        const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
        const targetLocator = editorPage.locator(contentAreaSelector);

        await editorHelper.openMoveingHandle('left');
        await editorPage.locator('tool-box-item', { hasText: 'HTML Tag' }).dragTo(targetLocator);

        const dialog = editorPage.locator('message-box#html-tag-select-dialog').first();
        await expect(dialog).toBeVisible();

        // 1. オーバーレイ（背景）をクリック (evaluateによるクリックでビューポート外エラーを回避)
        const overlay = dialog.locator('.overlay');
        await overlay.evaluate((el: HTMLElement) => el.click());

        // 2. ダイアログが閉じる
        await expect(dialog).toBeHidden();

        // 3. 要素が追加されていないことを検証
        const childNodes = targetLocator.locator('> .node');
        await expect(childNodes).toHaveCount(0);
    });

    test('不適切なタグ名を入力した際、エラーアラートが表示され追加がブロックされること', async ({ editorPage, editorHelper }) => {
        await editorHelper.addPage();
        const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
        const targetLocator = editorPage.locator(contentAreaSelector);

        await editorHelper.openMoveingHandle('left');
        await editorPage.locator('tool-box-item', { hasText: 'HTML Tag' }).dragTo(targetLocator);

        const dialog = editorPage.locator('message-box#html-tag-select-dialog').first();
        await expect(dialog).toBeVisible();

        // 1. 不適切な文字列（タグ名に使えない記号など）を入力して追加
        const input = dialog.locator('input#custom-tag-input');
        await expect(input).toBeEditable();
        await input.fill('invalid<tag>');

        const okBtn = dialog.locator('[slot="ok-slot"]');
        await okBtn.click();

        // 2. ダイアログは一旦閉じる
        await expect(dialog).toBeHidden();

        // 3. バリデーションアラート（alert-component）が立ち上がることを検証
        const alert = editorPage.locator('alert-component');
        await expect(alert).toBeVisible();
        await expect(alert).toContainText('タグとして不適切な文字列です');

        // 4. アラートを閉じる
        await alert.getByRole('button', { name: '閉じる' }).click();
        await expect(alert).toBeHidden();

        // 5. タグが追加されていないことを検証
        const childNodes = targetLocator.locator('> .node');
        await expect(childNodes).toHaveCount(0);
    });
});

// =========================================================================
// Merged from: tests/specs/normal/editor-edge-hover.spec.ts
// =========================================================================

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

// =========================================================================
// tests/specs/normal/backup-io.spec.ts (統合部分)
// =========================================================================
test.describe('プロジェクトのバックアップ・インポート統合テスト', () => {

    test('エクスポートしたバックアップファイルから要素を完全に復元できる', async ({ editorPage, editorHelper }, testInfo) => {
        const testButtonText = 'BACKUP_VERIFY_BUTTON';
        const downloadPath = path.join(testInfo.outputDir, 'test-project.pwappy');
        let targetPageUuid: string | null = null;

        await test.step('1. 要素を追加してプロジェクトを書き出す', async () => {
            const setup = await editorHelper.setupPageWithButton();
            targetPageUuid = await setup.pageNode.getAttribute('data-node-id');

            await editorHelper.selectNodeInDomTree(setup.buttonNode);
            await editorHelper.openMoveingHandle('right');

            const textInput = editorHelper.getPropertyInput('text').locator('input');
            await expect(textInput).toBeEditable();
            await textInput.fill(testButtonText);
            await textInput.press('Enter');

            await expect(editorHelper.getPreviewElement('ons-button')).toHaveText(testButtonText);

            const download = await editorHelper.exportProjectFile();
            await download.saveAs(downloadPath);
        });

        await test.step('2. 要素を削除する（破壊的変更）', async () => {
            await editorHelper.openMoveingHandle('left');
            const buttonNode = editorHelper.getDomTree().locator('.node[data-node-type="ons-button"]');
            // 要素削除の操作
            await buttonNode.locator('.clear-icon').click();
            await buttonNode.locator('.clear-icon').click();
            await expect(buttonNode).toBeHidden();
        });

        await test.step('3. バックアップファイルをインポートする', async () => {
            await editorHelper.importProjectFile(downloadPath);

            // インポート後のオーバーレイ非表示を待機
            const loading = editorPage.locator('app-container-loading-overlay');
            await expect(loading).toBeHidden({ timeout: 20000 });

            await editorPage.waitForTimeout(2000);
        });

        await test.step('4. 検証：削除した要素が復活していること', async () => {
            if (targetPageUuid) {
                await editorHelper.switchTopLevelTemplate(targetPageUuid);
            }

            const restoredButton = editorHelper.getDomTree().locator('.node[data-node-type="ons-button"]');
            await expect(restoredButton).toBeVisible({ timeout: 10000 });

            const previewButton = editorHelper.getPreviewElement('ons-button');
            await expect(previewButton).toHaveText(testButtonText, { timeout: 15000 });
        });

        await test.step('5. 検証：インポート直前の自動スナップショットが作成されていること', async () => {
            await editorHelper.closeMoveingHandle();
            // 下部メニューの操作
            await editorPage.locator('#fab-bottom-menu-box').click();
            const bottomMenu = editorPage.locator('#platformBottomMenu');
            await expect(bottomMenu).toBeVisible();
            await bottomMenu.getByText('スナップショット').click();

            const snapshotManager = editorPage.locator('snapshot-manager');
            await expect(snapshotManager.locator('.snapshot-item', { hasText: '自動保存 - インポート実行前' })).toBeVisible();
        });
    });
});
