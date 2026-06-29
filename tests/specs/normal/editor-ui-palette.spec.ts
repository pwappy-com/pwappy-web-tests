import { test as base, expect, Page } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper, normalizeWhitespace } from '../../tools/editor-helpers';
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
    appName = `ui-palette-${uniqueId}`.slice(0, 30);
    appKey = `pl-key-${uniqueId}`.slice(0, 30);

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

test.describe('UIアクションパレット機能の検証', () => {

    test.beforeEach(async ({ page }) => {
        await gotoDashboard(page);
    });

    test('DOM要素のドロップからパレットを起動し、コードを生成できる', async ({ isMobile, editorPage, editorHelper }) => {
        let buttonId: string;
        await test.step('セットアップ: ページとボタンを追加し、スクリプトエディタを開く', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();
            buttonId = await buttonNode.getAttribute('data-node-id') as string;

            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await editorHelper.addNewScript('testScript');
            await editorHelper.openScriptForEditing('testScript');

            // Monaco Editor の JS/TS 言語サービス(フォーマッター)の初期化完了を確実に待ち、
            // 挿入完了時のフォーマット例外によるハングアップを回避する
            await editorPage.waitForTimeout(3000);
        });

        await test.step('パレットの起動: ドロップイベントをシミュレートする', async () => {
            // D&D操作の座標ズレによるテスト不安定化を防ぐため、
            // 内部でリスニングされている drop-to-script-editor イベントを意図的に発火させてパレットを起動します
            await editorPage.evaluate((nodeId) => {
                window.dispatchEvent(new CustomEvent('drop-to-script-editor', {
                    detail: { nodeId, clientX: 100, clientY: 100 }
                }));
            }, buttonId);

            const paletteOverlay = editorPage.locator('#paletteOverlay-teleported');
            await expect(paletteOverlay).toHaveClass(/active/);
        });

        await test.step('メソッドの選択と引数入力: setText を選んで挿入', async () => {
            const paletteOverlay = editorPage.locator('#paletteOverlay-teleported');

            // 検索ボックスにテキストを入力してアクションを絞り込む
            const input = paletteOverlay.locator('#paletteInput');
            await expect(input).toBeVisible();
            await input.fill('テキストを変更');

            const methodItem = paletteOverlay.locator('.palette-item', { hasText: 'テキストを変更' }).first();
            await methodItem.click();

            // 引数入力画面に遷移したことを確認
            const hint = paletteOverlay.locator('.arg-hint');
            await expect(hint).toHaveClass(/active/);

            // 引数を入力
            await input.fill('パレットからのテスト文字');

            // UI上の挿入ボタンのレイアウトに依存せず確実に挿入を決定するため、エディタに Enter キーを送信
            await editorPage.keyboard.press('Enter');

            // --- デバイス環境ごとに、完了後のパレット状態をアサートして完全に閉じる ---
            if (isMobile) {
                // モバイル時: パレットが自動的に「最小化（minimized）」される
                await expect(paletteOverlay.locator('.palette-box')).toHaveClass(/minimized/);
            } else {
                // デスクトップ時: プレースホルダーが「挿入完了」に更新される
                await expect(input).toHaveAttribute('placeholder', /挿入完了/);
            }

            // 閉じるボタン（✖）をクリックして完全に閉じる
            await paletteOverlay.locator('#btnClose').click();
            await expect(paletteOverlay).not.toHaveClass(/active/);
        });

        await test.step('エディタ内容の検証: 生成されたコードが挿入されているか', async () => {
            const editorContent = await editorHelper.getMonacoEditorContent();
            const normalizedContent = normalizeWhitespace(editorContent);

            // 変数宣言と、指定した文字列をセットするコードが含まれているか検証
            expect(normalizedContent).toContain('const onsButton1 = document.querySelector');
            expect(normalizedContent).toContain('onsButton1.textContent = \'パレットからのテスト文字\';');
        });
    });

    test('コンテキストメニューから起動し、キーボード操作で画面遷移・キャンセルができる', async ({ editorPage, editorHelper }) => {
        await test.step('セットアップ', async () => {
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await editorHelper.addNewScript('testKeyboard');
            await editorHelper.openScriptForEditing('testKeyboard');
        });

        await test.step('右クリックでコンテキストメニューを開き、パレットを起動する', async () => {
            const monacoEditor = editorPage.locator('script-container .monaco-editor[role="code"]');
            const viewLine = monacoEditor.locator('.view-line').first();
            const paletteOverlay = editorPage.locator('#paletteOverlay-teleported');

            // メニューの描画・イベントバインド遅延によるクリックの空振りを防ぐため、toPassによる自動リトライを導入
            await expect(async () => {
                // 1. 状態リセット: 前回のリトライで残ったメニュー等があれば一度エディタをクリックして閉じる
                await viewLine.click({ force: true }).catch(() => { });
                await editorPage.waitForTimeout(300);

                // 2. 右クリック
                await viewLine.click({ button: 'right' });

                // 3. コンテキストメニューが表示されるのを待機
                const contextMenu = editorPage.locator('.context-view.monaco-menu-container');
                await expect(contextMenu).toBeVisible({ timeout: 5000 });

                // 4. メニューアイテムを特定
                const actionItem = contextMenu.locator('.action-item', { hasText: /アクションパレット/ }).first();
                await actionItem.scrollIntoViewIfNeeded();

                // Monacoのアニメーションやイベントアタッチのタイムラグを吸収するための微小待機
                await editorPage.waitForTimeout(300);

                // 5. クリック実行
                await actionItem.click({ force: true });

                // 6. 最終的な結果（パレットの起動）を短いタイムアウトで検証。
                // 失敗した場合は、例外が投げられて toPass() により 1. から再試行される
                await expect(paletteOverlay).toHaveClass(/active/, { timeout: 3000 });

            }).toPass({
                timeout: 20000,    // 全体で最大20秒間試行する
                intervals: [1000]  // 失敗した場合は1秒間隔を空けてリトライ
            });
        });

        await test.step('キーボードナビゲーションの検証', async () => {
            const paletteOverlay = editorPage.locator('#paletteOverlay-teleported');

            // --- 下キーを押して選択を移動し、Enter で決定 ---
            await editorPage.keyboard.press('ArrowDown');
            await editorPage.keyboard.press('ArrowDown');
            await editorPage.keyboard.press('Enter');

            // --- メソッド選択画面に遷移したことを確認 ---
            const input = paletteOverlay.locator('#paletteInput');
            await expect(input).toHaveAttribute('placeholder', /アクションを検索/);

            // --- 戻る(◀)ボタンを物理クリックして前の画面(コンポーネント選択)に戻る ---
            const backBtn = paletteOverlay.locator('#btnBack');
            await expect(backBtn).toBeVisible();
            await backBtn.click();
            await expect(input).toHaveAttribute('placeholder', /操作する要素を検索/);

            // --- Escapeキーでパレットを完全に閉じる ---
            await editorPage.keyboard.press('Escape');
            await expect(paletteOverlay).not.toHaveClass(/active/);
        });
    });

    test('引数入力画面で変数やテンプレートIDのサジェストが機能する', async ({ isMobile, editorPage, editorHelper }) => {
        let appNodeId: string;
        await test.step('セットアップ: エディタにダミー変数を宣言し、確実に存在するappノードのUUIDを取得する', async () => {
            await editorHelper.openMoveingHandle('left');
            const domTree = editorHelper.getDomTree();

            // ドラッグのタイムアウトやFlaky化を防ぐため、必ずツリーのトップに初期生成されている app ノードを活用
            const appNode = domTree.locator('.node[data-node-type="app"]').first();
            appNodeId = await appNode.getAttribute('data-node-id') as string;

            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await editorHelper.addNewScript('testSuggest');
            await editorHelper.openScriptForEditing('testSuggest');

            // エディタに手動でダミー変数を定義
            const monacoEditor = scriptContainer.locator('.monaco-editor[role="code"]');
            await editorHelper.setMonacoValue(monacoEditor, 'const myDummyVar = "dummy";\n');
        });

        await test.step('パレットを起動し、appの単一引数メソッドを選択', async () => {
            await editorPage.evaluate((nodeId) => {
                window.dispatchEvent(new CustomEvent('drop-to-script-editor', {
                    detail: { nodeId, clientX: 100, clientY: 100 }
                }));
            }, appNodeId);

            const paletteOverlay = editorPage.locator('#paletteOverlay-teleported');
            await expect(paletteOverlay).toHaveClass(/active/);

            // サジェスト候補を確実に表示させるため、複数引数ではなく、単一引数の「属性の値を取得 (getAttribute)」を選択
            await paletteOverlay.locator('#paletteInput').fill('属性の値を取得');
            await paletteOverlay.locator('.palette-item').first().click();

            // 単一引数の入力画面に切り替わる
            await expect(paletteOverlay.locator('.arg-hint')).toHaveClass(/active/);
        });

        await test.step('サジェストに定義済みの変数が表示されることを検証', async () => {
            const paletteOverlay = editorPage.locator('#paletteOverlay-teleported');

            // リスト内にさきほど定義した変数（@myDummyVar）が存在するか
            const varSuggest = paletteOverlay.locator('.palette-item', { hasText: '@myDummyVar' });
            await expect(varSuggest).toBeVisible();

            // 変数のサジェストをクリックして挿入
            await varSuggest.click();

            // --- 決定後のパレット状態をデバイス別に判定し、最後は閉じるボタンで閉じる ---
            if (isMobile) {
                await expect(paletteOverlay.locator('.palette-box')).toHaveClass(/minimized/);
            } else {
                const input = paletteOverlay.locator('#paletteInput');
                await expect(input).toHaveAttribute('placeholder', /挿入完了/);
            }

            // ✖ ボタンで完全に閉じる
            await paletteOverlay.locator('#btnClose').click();
            await expect(paletteOverlay).not.toHaveClass(/active/);

            const editorContent = await editorHelper.getMonacoEditorContent();
            const normalizedContent = normalizeWhitespace(editorContent);

            // 引数として、生（クォーテーションなし）の変数名が正しく挿入されているか検証
            expect(normalizedContent).toContain('getAttribute(myDummyVar)');
        });
    });

});