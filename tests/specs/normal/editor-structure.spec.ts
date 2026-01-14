import { test as base, expect, Page, Locator } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';
import { transcode } from 'buffer';

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
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
        await use(`struct-test-app-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName }, use) => {
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
        const appKey = `struct-key-${uniqueId}`.slice(0, 30);
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
        const layoutTrashBtn = editorPage.locator('template-container #fab-trash-box');

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
            await expect(layoutTrashBtn).toBeVisible();
            await expect(layoutTrashBtn).toBeEnabled();

            await layoutTrashBtn.click();

            const trashBox = editorPage.locator('.template-trash-box');
            await expect(trashBox).toBeVisible();
            await expect(trashBox.locator('.template-trash-box-node').first()).toBeVisible();
        });

        await test.step('3. ゴミ箱を完全に空にする', async () => {
            const trashBox = editorPage.locator('.template-trash-box');
            editorPage.once('dialog', dialog => dialog.accept());
            await trashBox.getByText('空にする').click();
            await expect(trashBox.getByText('ゴミ箱は空です')).toBeVisible();
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
        await test.step('1. ページと2つのボタンを配置', async () => {
            await editorHelper.addPage();
            const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';

            // ボタンを2回追加
            await editorHelper.addComponent('ons-button', contentAreaSelector);
            await editorHelper.addComponent('ons-button', contentAreaSelector);

            // ボタンのIDを確認（初期状態）
            // アプリ仕様：新しい要素が上(index 0)に追加されるため、nth(0)がons-button2となる
            const buttons = editorPage.locator('.node[data-node-type="ons-button"]');
            await expect(buttons).toHaveCount(2);
            await expect(buttons.nth(0)).toHaveAttribute('data-node-dom-id', 'ons-button2');
            await expect(buttons.nth(1)).toHaveAttribute('data-node-dom-id', 'ons-button1');
        });

        await test.step('2. ドラッグ操作による順序反転', async () => {
            const btnTop = editorPage.locator('.node[data-node-dom-id="ons-button2"]');
            const btnBottom = editorPage.locator('.node[data-node-dom-id="ons-button1"]');

            // 下のボタンを確実に表示させて座標を取得（先にスクロールをしないと座標がずれるので必ず必要な処理、省略してはいけない
            await btnBottom.scrollIntoViewIfNeeded();

            const boxTop = await btnTop.boundingBox();

            if (boxTop) {
                // 上のボタンの中心付近を掴む
                await editorPage.mouse.move(boxTop.x + boxTop.width / 2, boxTop.y + boxTop.height / 2);
                await editorPage.mouse.down();
                await editorPage.waitForTimeout(600);


                const boxBottomUpdated = await btnBottom.boundingBox();

                if (boxBottomUpdated) {
                    // 下のボタンの「内側の下端ギリギリ」を狙って移動（stepsを増やして移動を検知させる）
                    // 要素の外ではなく、要素内の「中心より下」にポインタを置くことで、その要素の「後ろ」への挿入が発火する
                    await editorPage.mouse.move(
                        boxBottomUpdated.x + boxBottomUpdated.width / 2,
                        boxBottomUpdated.y + boxBottomUpdated.height - 2 + 10,
                        { steps: 20 }
                    );
                    await editorPage.waitForTimeout(300); // ドラッグ先の判定確定を待つ
                    await editorPage.mouse.up();
                }
            }

            // 順序が入れ替わったことを検証
            const finalNodes = editorPage.locator('.node[data-node-type="ons-button"]');
            await expect(finalNodes.nth(0)).toHaveAttribute('data-node-dom-id', 'ons-button1');
            await expect(finalNodes.nth(1)).toHaveAttribute('data-node-dom-id', 'ons-button2');
        });
    });
});