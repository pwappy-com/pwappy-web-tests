import { test as base, expect, Page, Locator } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

/**
 * テストフィクスチャの設定
 */
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
        await use(`test-app-struct-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName }, use) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appKey = `key-struct-${uniqueId}`.slice(0, 30);
        await createApp(page, appName, appKey);
        const editorPage = await openEditor(page, context, appName);
        await use(editorPage);
        await editorPage.close();
        await deleteApp(page, appKey);
    },
    editorHelper: async ({ editorPage, isMobile }, use) => {
        const helper = new EditorHelper(editorPage, isMobile);
        await use(helper);
    },
});

test.describe('エディタ内：UI構造操作の高度なテスト', () => {

    test.beforeEach(async ({ page, context }) => {
        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        const domain = testUrl.hostname;
        await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/' },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/' },
            { name: 'pwappy_login', value: '1', domain: domain, path: '/' },
        ]);
        await page.goto(String(process.env.PWAPPY_TEST_BASE_URL), { waitUntil: 'domcontentloaded' });
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
                    // （タイムアウトを短く設定し、ダメなら catch させて再試行させる）
                    await expect(emptyButton).toBeVisible({ timeout: 2000 });
                    await emptyButton.click({ timeout: 2000 });

                    // 4. 処理完了のメッセージが表示されるか確認
                    await expect(emptyMessage).toBeVisible({ timeout: 3000 });

                }).toPass({
                    timeout: 20000,   // 最大20秒間試行
                    intervals: [1000] // 1秒間隔でリトライ
                });

            } finally {
                // リスナーを解除（他のテストに影響させないため）
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
            await explainInput.fill('秘密のボタン');
            await explainInput.press('Enter');
            await editorPage.waitForTimeout(500);
        });

        await test.step('2. 検索とジャンプ', async () => {
            editorHelper.openMoveingHandle('left');
            await editorPage.locator('.title-icon-bar-button[title="レイアウト検索"]').click();
            const searchWindow = editorPage.locator('template-search-sub-window');
            await expect(searchWindow).toBeVisible();

            await searchWindow.locator('input.filter-box').fill('秘密');

            const resultItem = searchWindow.locator('template-search-result').first();
            await resultItem.locator('.fa-arrow-up-right-from-square').click();

            await expect(searchWindow).toBeHidden();
            const selectedNode = editorPage.locator('.node-select');
            await expect(selectedNode).toContainText('秘密のボタン');
        });
    });

    test('ドラッグ＆ドロップ：座標操作による要素の順序入れ替え', async ({ editorPage, editorHelper }) => {

        test.skip(!!process.env.CI, 'CI環境ではマウス座標によるドラッグ＆ドロップが不安定なためスキップします。ローカルでは実行されます。');

        await editorHelper.handleSnapshotRestoreDialog();

        /**
         * ツールボックスからコンポーネントを探し（必要ならスクロール）、
         * DOMツリーのターゲットへ自動スクロールを監視しながら手動でドラッグ＆ドロップする内部関数
         */
        const dragComponentFromToolbox = async (componentName: string, targetLocator: Locator) => {
            const toolbox = editorPage.locator('tool-box');
            const toolboxContainer = toolbox.locator('.container');
            const toolboxItem = toolbox.locator(`tool-box-item[data-item-type="${componentName}"]`);
            const layoutPanel = editorPage.locator('template-container .panel');

            // --- 1. ツールボックスからアイテムを探す（スクロール探索） ---
            await editorHelper.openMoveingHandle('left');

            await test.step(`ツールボックス内で ${componentName} をスクロールして探す`, async () => {
                const maxScrollAttempts = 15;
                for (let i = 0; i < maxScrollAttempts; i++) {
                    const itemBox = await toolboxItem.boundingBox();
                    const containerBox = await toolboxContainer.boundingBox();

                    if (itemBox && containerBox) {
                        // アイテムがコンテナの表示範囲内（Y座標）にあるか厳密に判定
                        const isInView = (itemBox.y >= containerBox.y) &&
                            (itemBox.y + itemBox.height <= containerBox.y + containerBox.height);

                        if (isInView) {
                            console.log(`Found ${componentName} in view.`);
                            break;
                        }
                    }

                    console.log(`${componentName} not in view, scrolling toolbox...`);
                    // 100pxずつスクロールさせて探す
                    await toolboxContainer.evaluate(el => el.scrollTop += 100);
                    await editorPage.waitForTimeout(200);

                    if (i === maxScrollAttempts - 1) {
                        throw new Error(`ツールボックス内で ${componentName} を見つけることができませんでした。`);
                    }
                }
            });

            // --- 2. アイテムを掴む ---
            const sourceBox = await toolboxItem.boundingBox();
            if (!sourceBox) throw new Error(`${componentName} の座標が取得できません`);

            await editorPage.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
            await editorPage.mouse.down();
            await editorPage.waitForTimeout(400); // 長押し判定待ち

            // --- 3. ターゲット（DOMツリー内のノード）へ追尾移動 ---
            let lastTargetY = 0;
            let stagnationCount = 0;
            const scrollThreshold = 30;

            for (let i = 0; i < 150; i++) {
                const pBox = await layoutPanel.boundingBox();
                const tBox = await targetLocator.boundingBox();

                if (!pBox || !tBox) break;

                const panelTop = pBox.y;
                const panelBottom = pBox.y + pBox.height;

                // 目的地：ターゲットノードの内側（上から15px）
                const destX = tBox.x + 20;
                const destY = tBox.y + 15;

                // スクロール監視
                if (Math.abs(tBox.y - lastTargetY) < 0.5) {
                    stagnationCount++;
                } else {
                    stagnationCount = 0;
                }
                lastTargetY = tBox.y;

                // ターゲットがパネルの可視エリア内にいるか
                const isTargetVisible = destY > panelTop + scrollThreshold && destY < panelBottom - scrollThreshold;

                if (isTargetVisible) {
                    await editorPage.mouse.move(destX, destY, { steps: 5 });
                    if (Math.abs(destY - destY) < 5) break;
                } else {
                    const isScrollingDown = destY >= panelBottom - scrollThreshold;
                    if (stagnationCount > 3) {
                        // 【再進入フォールバック】一度スクロールエリア外へ戻ってから入り直す
                        const resetY = isScrollingDown ? (panelBottom - 60) : (panelTop + 60);
                        await editorPage.mouse.move(destX, resetY, { steps: 5 });
                        await editorPage.waitForTimeout(100);
                        const retryY = isScrollingDown ? (panelBottom - 15) : (panelTop + 15);
                        await editorPage.mouse.move(destX, retryY, { steps: 5 });
                        stagnationCount = 0;
                    } else {
                        const hoverY = isScrollingDown ? (panelBottom - 15) : (panelTop + 15);
                        await editorPage.mouse.move(destX, hoverY, { steps: 2 });
                    }
                }
                await editorPage.waitForTimeout(100);
            }

            // --- 4. ドロップ ---
            const finalBox = await targetLocator.boundingBox();
            if (finalBox) {
                await editorPage.mouse.move(finalBox.x + 20, finalBox.y + 15, { steps: 5 });
            }
            await editorPage.waitForTimeout(200);
            await editorPage.mouse.up();
            await editorPage.waitForTimeout(500);
        };

        // =============================================================
        // 実際のテストステップ実行
        // =============================================================

        await test.step('1. ページを追加し、ツールボックスからボタンを2つドラッグ＆ドロップで配置', async () => {
            // 新しいページを作成
            await editorHelper.addPage();

            // DOMツリー内のドロップ先（コンテンツエリア）を特定
            const contentArea = editorPage.locator('template-container .node[data-node-explain="コンテンツ"]');

            // 【重要】ここで定義した手動ドラッグ関数を呼び出す
            await dragComponentFromToolbox('ons-button', contentArea);
            await dragComponentFromToolbox('ons-button', contentArea);

            // 初期状態の確認（新しい要素が上に挿入される仕様を検証）
            const buttons = editorPage.locator('template-container .node[data-node-type="ons-button"]');
            await expect(buttons).toHaveCount(2);
            await expect(buttons.nth(0)).toHaveAttribute('data-node-dom-id', 'ons-button2');
            await expect(buttons.nth(1)).toHaveAttribute('data-node-dom-id', 'ons-button1');
        });

        await test.step('2. ドラッグ操作による順序反転（再進入スクロール発火版）', async () => {
            // 操作対象のノード
            const btnTop = editorPage.locator('template-container .node[data-node-dom-id="ons-button2"]');
            const btnBottom = editorPage.locator('template-container .node[data-node-dom-id="ons-button1"]');
            const layoutPanel = editorPage.locator('template-container .panel');
            const targetInsertPoint = editorPage.locator('template-container .node[data-node-dom-id="ons-button1"] + .node-add-point');

            // --- 1. ドラッグ開始 ---
            await btnTop.scrollIntoViewIfNeeded();
            const startBox = await btnTop.boundingBox();
            if (!startBox) throw new Error('btnTopが見つかりません');

            let currentX = startBox.x + startBox.width / 2;
            let currentY = startBox.y + startBox.height / 2;

            await editorPage.mouse.move(currentX, currentY);
            await editorPage.mouse.down();
            await editorPage.waitForTimeout(400);

            // --- 2. ターゲット追尾・スクロール監視ループ ---
            let lastTargetY = 0;
            let stagnationCount = 0;
            const scrollThreshold = 30;

            for (let i = 0; i < 150; i++) {
                const pBox = await layoutPanel.boundingBox();
                const tBox = await btnBottom.boundingBox();
                const iBox = await targetInsertPoint.boundingBox();

                if (!pBox || !tBox) break;

                const panelTop = pBox.y;
                const panelBottom = pBox.y + pBox.height;

                const destX = tBox.x + tBox.width / 2;
                const destY = (iBox && iBox.height > 2) ? (iBox.y + iBox.height / 2) : (tBox.y + tBox.height + 10);

                if (Math.abs(tBox.y - lastTargetY) < 0.5) {
                    stagnationCount++;
                } else {
                    stagnationCount = 0;
                }
                lastTargetY = tBox.y;

                const isTargetVisible = destY > panelTop + scrollThreshold && destY < panelBottom - scrollThreshold;

                if (isTargetVisible) {
                    currentX = destX;
                    currentY = destY;
                    await editorPage.mouse.move(currentX, currentY, { steps: 5 });
                    if (Math.abs(currentY - destY) < 5) break;
                } else {
                    const isScrollingDown = destY >= panelBottom - scrollThreshold;
                    if (stagnationCount > 3) {
                        const resetY = isScrollingDown ? (panelBottom - 60) : (panelTop + 60);
                        await editorPage.mouse.move(destX, resetY, { steps: 5 });
                        await editorPage.waitForTimeout(100);
                        currentY = isScrollingDown ? (panelBottom - 15) : (panelTop + 15);
                        await editorPage.mouse.move(destX, currentY, { steps: 5 });
                        stagnationCount = 0;
                    } else {
                        currentY = isScrollingDown ? (panelBottom - 15) : (panelTop + 15);
                        await editorPage.mouse.move(destX, currentY, { steps: 2 });
                    }
                }
                await editorPage.waitForTimeout(100);
            }

            // --- 3. 最終位置調整とドロップ ---
            const finalBox = await targetInsertPoint.boundingBox() || await btnBottom.boundingBox();
            if (finalBox) {
                await editorPage.mouse.move(finalBox.x + finalBox.width / 2, finalBox.y + finalBox.height / 2, { steps: 5 });
            }
            await editorPage.waitForTimeout(400);
            await editorPage.mouse.up();
            await editorPage.waitForTimeout(500);

            // 検証
            const finalNodes = editorPage.locator('template-container .node[data-node-type="ons-button"]');
            await expect(finalNodes.nth(0)).toHaveAttribute('data-node-dom-id', 'ons-button1');
            await expect(finalNodes.nth(1)).toHaveAttribute('data-node-dom-id', 'ons-button2');
        });
    });
});