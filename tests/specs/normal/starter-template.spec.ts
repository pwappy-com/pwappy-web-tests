import { test as base, expect, Page } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor, setAiCoding } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

// 各テストでユニークなアプリを作成し、スターターモーダルを意図的に表示させるフィクスチャ
type StarterFixtures = {
    editorPage: Page;
    appName: string;
    appKey: string;
    editorHelper: EditorHelper;
};

const test = base.extend<StarterFixtures>({
    appName: async ({ }, use) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        await use(`starter-${uniqueId}`.slice(0, 30));
    },
    appKey: async ({ }, use) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        await use(`str-key-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName, appKey }, use) => {
        await gotoDashboard(page);
        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });

        await createApp(page, appName, appKey);

        // 【重要】 { skipStarterModal: false } を指定して、モーダルを閉じずにそのままにする
        const editorPage = await openEditor(page, context, appName, '1.0.0', { skipStarterModal: false });

        await use(editorPage);

        // テスト終了後のクリーンアップ
        await editorPage.close();
        await page.bringToFront();
        await deleteApp(page, appKey);
    },
    editorHelper: async ({ editorPage, isMobile }, use) => {
        const helper = new EditorHelper(editorPage, isMobile);
        await use(helper);
    },
});

test.describe('スターターテンプレート（骨組み）機能の検証', () => {

    test('Navigator（基本の画面遷移）の骨組みを適用できる', async ({ editorPage, editorHelper }) => {
        test.setTimeout(120000); // ロード・処理が重なるため十分な時間を設定します
        const modal = editorPage.locator('starter-template-modal');
        await expect(modal).toBeVisible();

        await test.step('1. モーダルから「基本の画面遷移」を選択', async () => {
            const navCard = modal.locator('.card', { hasText: '基本の画面遷移' });
            await expect(navCard).toBeVisible();
            await navCard.click();

            // 選択後、モーダルが非表示になるのを待機
            await expect(modal).toBeHidden();
        });

        let homePageUuid: string | null = null;

        await test.step('2. 適用後のDOMツリーと2つの追加ページ（ホーム・詳細）を検証', async () => {
            await editorHelper.openMoveingHandle('left');
            const domTree = editorHelper.getDomTree();

            // app直下にons-navigatorがあること
            const navigatorNode = domTree.locator('.node[data-node-type="ons-navigator"]');
            await expect(navigatorNode).toBeVisible();

            // テンプレートリストに「ホーム画面」と新仕様の「詳細画面」が存在するか確認
            await editorHelper.expectPageInTemplateList('ホーム画面');
            await editorHelper.expectPageInTemplateList('詳細画面');

            // 遷移元ボタンの紐付け状態を確認するため、ホーム画面のUUIDを取得
            const topContainer = editorPage.locator('.top-container');
            await topContainer.locator('.select').click();
            const topTemplateListContainer = editorPage.locator('#top-template-list');
            await expect(topTemplateListContainer).toBeVisible();

            const homeItem = topTemplateListContainer.locator('div.top-template-item', { hasText: 'ホーム画面' });
            homePageUuid = await homeItem.getAttribute('data-template-id');
            if (!homePageUuid) throw new Error('home_page UUID not found');

            await editorPage.keyboard.press('Escape');
            await expect(topTemplateListContainer).toBeHidden();
        });

        await test.step('3. 自動生成されたスクリプトおよびボタンイベントのバインド検証', async () => {
            // ホーム画面テンプレートに切り替え
            if (homePageUuid) {
                await editorHelper.switchTopLevelTemplate(homePageUuid);
            }

            // ホーム画面内の ons-button (push_button) を選択
            const pushButtonNode = await editorHelper.selectNodeByAttribute('data-node-dom-id', 'push_button');
            await expect(pushButtonNode).toBeVisible();

            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');

            // スクリプト一覧タブ：pushDetail が登録されていること
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            // strict mode violation (重複検知) を回避するため、検索範囲をスクリプト一覧コンテナ (#script-list-container) に限定します
            const scriptListContainer = scriptContainer.locator('#script-list-container');
            await expect(scriptListContainer.locator('.editor-row', { hasText: 'pushDetail' })).toBeVisible();

            // イベントタブ：ons-button の click イベントに pushDetail が紐づいていること
            await editorHelper.switchTabInContainer(scriptContainer, 'イベント');
            const eventContainer = scriptContainer.locator('event-container');
            const clickEventRow = eventContainer.locator('.editor-row', { hasText: 'click' });
            await expect(clickEventRow.locator('.editor-row-right-item', { hasText: 'pushDetail' }).first()).toBeVisible({ timeout: 10000 });
        });
    });

    test('Tab Bar（タブメニュー）の骨組みを適用できる', async ({ editorPage, editorHelper }) => {
        const modal = editorPage.locator('starter-template-modal');
        await expect(modal).toBeVisible();

        await test.step('1. モーダルから「タブメニュー」を選択', async () => {
            const tabCard = modal.locator('.card', { hasText: 'タブメニュー' });
            await expect(tabCard).toBeVisible();
            await tabCard.click();
            await expect(modal).toBeHidden();
        });

        await test.step('2. DOMツリーにTab Barが追加されたことを検証', async () => {
            await editorHelper.openMoveingHandle('left');
            const domTree = editorHelper.getDomTree();

            // app直下にons-tabbarがあること
            const tabbarNode = domTree.locator('.node[data-node-type="ons-tabbar"]');
            await expect(tabbarNode).toBeVisible();

            // タブの中身(ons-tab)が2つ生成されていること
            const tabs = tabbarNode.locator('.node[data-node-type="ons-tab"]');
            await expect(tabs).toHaveCount(2);
        });

        await test.step('3. 必要なページがテンプレートリストに追加されたことを検証', async () => {
            await editorHelper.expectPageInTemplateList('ホーム画面');
            await editorHelper.expectPageInTemplateList('設定画面');
        });
    });

    test('Splitter（サイドメニュー）の適用とスクリプトの自動バインドを検証する', async ({ editorPage, editorHelper }) => {
        test.setTimeout(120000); // 処理が多いため長めに設定
        const modal = editorPage.locator('starter-template-modal');
        await expect(modal).toBeVisible();

        await test.step('1. モーダルから「サイドメニュー」を選択', async () => {
            const splCard = modal.locator('.card', { hasText: 'サイドメニュー' });
            await expect(splCard).toBeVisible();
            await splCard.click();
            await expect(modal).toBeHidden();
        });

        await test.step('2. DOMツリーにSplitterが追加されたことを検証', async () => {
            await editorHelper.openMoveingHandle('left');
            const domTree = editorHelper.getDomTree();

            await expect(domTree.locator('.node[data-node-type="ons-splitter"]')).toBeVisible();
            await expect(domTree.locator('.node[data-node-type="ons-splitter-side"]')).toBeVisible();
            await expect(domTree.locator('.node[data-node-type="ons-splitter-content"]')).toBeVisible();
        });

        await test.step('3. 自動生成されたスクリプトの検証', async () => {
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');

            // スクリプトが3つ追加されていることを確認
            await expect(scriptContainer.locator('.editor-row', { hasText: 'openMenu' })).toBeVisible();
            await expect(scriptContainer.locator('.editor-row', { hasText: 'gotoHome' })).toBeVisible();
            await expect(scriptContainer.locator('.editor-row', { hasText: 'gotoSettings' })).toBeVisible();
        });

        await test.step('4. スクリプトのイベント紐付け（バインド）を検証', async () => {
            await editorHelper.openMoveingHandle('left');

            // テンプレート選択リストを展開し、ホーム画面とメニュー画面のUUIDを取得
            const topContainer = editorPage.locator('.top-container');
            await topContainer.locator('.select').click();

            const topTemplateListContainer = editorPage.locator('#top-template-list');
            await expect(topTemplateListContainer).toBeVisible({ timeout: 10000 });

            const homeItem = topTemplateListContainer.locator('div.top-template-item', { hasText: 'ホーム画面' });
            const homePageUuid = await homeItem.getAttribute('data-template-id');
            if (!homePageUuid) throw new Error('home_page UUID not found');

            const menuItem = topTemplateListContainer.locator('div.top-template-item', { hasText: 'サイドメニュー画面' });
            const menuPageUuid = await menuItem.getAttribute('data-template-id');
            if (!menuPageUuid) throw new Error('menu_page UUID not found');

            // リストを閉じる
            await editorPage.keyboard.press('Escape');
            await expect(topTemplateListContainer).toBeHidden();

            // 4-1. ホーム画面テンプレートに切り替え、メニューボタンを選択
            await editorHelper.switchTopLevelTemplate(homePageUuid);
            const menuButtonNode = await editorHelper.selectNodeByAttribute('data-node-dom-id', 'menu_button');

            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'イベント');
            const eventContainer = scriptContainer.locator('event-container');

            // ツールバーボタン（menu_button）の click イベントに openMenu が紐づいていることを確認
            const clickEventRow = eventContainer.locator('.editor-row', { hasText: 'click' });
            await expect(clickEventRow.locator('.editor-row-right-item', { hasText: 'openMenu' }).first()).toBeVisible({ timeout: 10000 });

            // 4-2. サイドメニュー画面に切り替え、ホーム項目を選択
            await editorHelper.switchTopLevelTemplate(menuPageUuid);
            const homeItemNode = await editorHelper.selectNodeByAttribute('data-node-dom-id', 'menu_home_item');

            await editorHelper.openMoveingHandle('right');
            // ホームリスト項目（menu_home_item）の click イベントに gotoHome が紐づいていることを確認
            const clickEventRowForHome = eventContainer.locator('.editor-row', { hasText: 'click' });
            await expect(clickEventRowForHome.locator('.editor-row-right-item', { hasText: 'gotoHome' }).first()).toBeVisible({ timeout: 10000 });
        });
    });

    test('「閉じて一から自分で作る（スキップ）」を選択すると空のままエディタを利用できる', async ({ editorPage, editorHelper }) => {
        const modal = editorPage.locator('starter-template-modal');
        await expect(modal).toBeVisible();

        await test.step('1. スキップボタンをクリック', async () => {
            const skipBtn = modal.locator('.btn-skip');
            await skipBtn.click();
            await expect(modal).toBeHidden();
        });

        await test.step('2. DOMツリーが空（app配下に何もない状態）であることを検証', async () => {
            await editorHelper.openMoveingHandle('left');
            const domTree = editorHelper.getDomTree();

            // Appノードの直下の子要素コンテナが空であるか
            const appChildList = domTree.locator('> .node-child-container > .node-child-list > .node');
            await expect(appChildList).toHaveCount(0);
        });
    });

    // -------------------------------------------------------------------------
    // 以下は AIコーディング機能の有効化状態に依存するテストのため、
    // フィクスチャを使わずに、テスト内で独自に設定とアプリの起動を行います。
    // -------------------------------------------------------------------------
    test('AI機能が有効な場合、「AIに作ってもらう」カードが表示され、AIエージェントが起動する', async ({ page, context, isMobile }) => {
        test.setTimeout(120000);
        await gotoDashboard(page);

        await test.step('1. AIコーディング機能を有効化', async () => {
            await setAiCoding(page, true);
        });

        const uniqueId = `ai-star-${Date.now().toString().slice(-6)}`;
        const appName = `ai-starter-${uniqueId}`;

        let editorPage: Page;
        try {
            await test.step('2. アプリを作成してエディタを起動（スターターモーダル表示）', async () => {
                await createApp(page, appName, uniqueId);
                editorPage = await openEditor(page, context, appName, '1.0.0', { skipStarterModal: false });
            });

            await test.step('3. モーダルに「AIに作ってもらう」カードが存在することを確認しクリック', async () => {
                const modal = editorPage.locator('starter-template-modal');
                await expect(modal).toBeVisible();

                const aiCard = modal.locator('.card.ai-card', { hasText: 'AIに作ってもらう' });
                await expect(aiCard).toBeVisible();

                // カードをクリック
                await aiCard.click();
            });

            await test.step('4. モーダルが閉じ、AIエージェントウィンドウが開くことを検証', async () => {
                const modal = editorPage.locator('starter-template-modal');
                await expect(modal).toBeHidden();

                const agentWindow = editorPage.locator('agent-chat-window');
                await expect(agentWindow).toBeVisible({ timeout: 10000 });
            });
        } finally {
            await test.step('クリーンアップ', async () => {
                if (editorPage) await editorPage.close();
                await page.bringToFront();
                await deleteApp(page, uniqueId);
                // 他のテストに影響を与えないようAI機能をオフに戻す
                await setAiCoding(page, false);
            });
        }
    });

});