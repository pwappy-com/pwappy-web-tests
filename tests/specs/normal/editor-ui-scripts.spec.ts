import { test as base, expect, Page, Locator, CDPSession, Dialog } from '@playwright/test';
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
    // デバッグ時以外は不要なのでコメント化
    // const now = new Date();
    // console.log(`[TourTest:Time] ${now.toISOString()} - ${msg}`);
};

// =========================================================================
// Merged from: tests/specs/normal/editor-console.spec.ts
// =========================================================================

test.describe('エディタ内：コンソール機能のテスト', () => {

    test.beforeEach(async ({ page, context, browserName, editorPage, editorHelper }) => {
        // クリップボード操作の権限を付与 (Chromiumのみ)
        if (browserName === 'chromium') {
            await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        }
        // 右側のサブウィンドウを開く
        await editorHelper.openMoveingHandle('right');

        // コンソールタブに切り替える
        const scriptContainer = editorPage.locator('script-container');
        await expect(scriptContainer).toBeVisible();
        await expect(async () => {
            const alert = editorPage.locator('alert-component');
            if (await alert.isVisible().catch(() => false)) {
                await alert.getByRole('button', { name: '閉じる' }).click().catch(() => { });
            }
            await scriptContainer.locator('#tab-console').click({ timeout: 2000 });
        }).toPass({ timeout: 15000, intervals: [1000] });

        await expect(scriptContainer.locator('console-container')).toBeVisible();
    });

    test('ログレベルフィルタリング機能の検証', async ({ editorPage }) => {
        const consoleContainer = editorPage.locator('script-container console-container');

        // 1. 各種ログを出力させる (RenderZoneController経由で捕捉される)
        // プレビューフレーム内で実行する必要があるため、iframeを特定
        const previewFrame = editorPage.frameLocator('#ios-container #renderzone');

        await test.step('各種ログを出力', async () => {
            // 既に出ているシステムログを一度クリアしてリセットする
            const clearButton = consoleContainer.locator('button.toolbar-btn[title="コンソールをクリア"]');
            await clearButton.click();

            await previewFrame.locator('body').waitFor({ state: 'attached' });

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
            await previewFrame.locator('body').waitFor({ state: 'attached' });

            await previewFrame.locator('body').evaluate(() => {
                console.log('Copy Test Log 1');
                console.error('Copy Test Log 2');
            });

            await expect(consoleContainer.locator('.log-item')).toHaveCount(2);

            // コピーボタンをクリック
            await copyButton.click({ force: true });
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
            await previewFrame.locator('body').waitFor({ state: 'attached' });
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

    // console.table デバッグ出力テスト
    test('console.tableによる表形式（テーブル）デバッグ出力機能の検証', async ({ editorPage }) => {
        const consoleContainer = editorPage.locator('script-container console-container');
        const logTable = consoleContainer.locator('table.log-table');

        // ログを一度完全にクリア
        const clearButton = consoleContainer.locator('button.toolbar-btn[title="コンソールをクリア"]');
        await clearButton.click();

        await test.step('1. プレビュー環境(iframe)内で console.table を実行させる', async () => {
            const previewFrame = editorPage.frameLocator('#ios-container #renderzone');
            await previewFrame.locator('body').waitFor({ state: 'attached' });

            await previewFrame.locator('body').evaluate(() => {
                console.table([
                    { id: 101, name: 'Apple', type: 'Fruit' },
                    { id: 102, name: 'Carrot', type: 'Vegetable' }
                ]);
            });

            // コンソール領域に table.log-table 要素がアタッチされるのを検証
            await expect(logTable).toBeVisible({ timeout: 10000 });
        });

        await test.step('2. レンダリングされたテーブルのヘッダーカラム(th)を検証', async () => {
            const headers = logTable.locator('thead th');
            await expect(headers).toHaveCount(4); // (index), id, name, type
            await expect(headers.nth(0)).toHaveText('(index)');
            await expect(headers.nth(1)).toHaveText('id');
            await expect(headers.nth(2)).toHaveText('name');
            await expect(headers.nth(3)).toHaveText('type');
        });

        await test.step('3. レンダリングされたテーブルのデータ行(td)の内容を検証', async () => {
            const rows = logTable.locator('tbody tr');
            await expect(rows).toHaveCount(2);

            // 1行目 (Index 0: Apple)
            const row1Cols = rows.nth(0).locator('td');
            await expect(row1Cols.nth(0)).toHaveText('0');
            await expect(row1Cols.nth(1)).toHaveText('101');
            await expect(row1Cols.nth(2)).toHaveText('Apple');
            await expect(row1Cols.nth(3)).toHaveText('Fruit');

            // 2行目 (Index 1: Carrot)
            const row2Cols = rows.nth(1).locator('td');
            await expect(row2Cols.nth(0)).toHaveText('1');
            await expect(row2Cols.nth(1)).toHaveText('102');
            await expect(row2Cols.nth(2)).toHaveText('Carrot');
            await expect(row2Cols.nth(3)).toHaveText('Vegetable');
        });
    });

});
// =========================================================================
// Merged from: tests/specs/normal/editor-ui-palette.spec.ts
// =========================================================================

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
// =========================================================================
// Merged from: tests/specs/normal/editor-custom-component.spec.ts
// =========================================================================

test.describe('エディタ内：カスタムコンポーネント（ツールボックス）機能の検証', () => {

    test('新しいコンポーネントを作成し、ツールボックスから配置できる', async ({ editorPage, editorHelper }) => {
        const componentName = 'my-custom-card';
        const componentCode = `<div class="my-card" style="padding:10px; background:lightblue;">\n  <h2>カスタムカード</h2>\n</div>`;

        await test.step('1. コンポーネントエディタを開き、新しいコンポーネントを作成', async () => {
            await editorHelper.openMoveingHandle('left');
            const toolBox = editorPage.locator('tool-box');

            // コンポーネントエディタを開くアイコンをクリック
            await toolBox.locator('.title-icon-bar-button').click();

            const itemEditor = editorPage.locator('tool-box-item-editor');
            await expect(itemEditor).toBeVisible();

            // 名前とコードの入力
            const componentNameInput = itemEditor.locator('#component-name');
            await expect(componentNameInput).toBeEditable();
            await componentNameInput.fill(componentName);

            // Monacoエディタにコードを設定
            const monacoEditor = itemEditor.locator('.code-editor-container textarea').first();
            await expect(monacoEditor).toBeEditable();
            await monacoEditor.fill(componentCode);

            // 保存ボタンをクリック
            await itemEditor.locator('#save-button').click();
            await expect(itemEditor).toBeHidden();
        });

        await test.step('2. ツールボックスにコンポーネントが表示されることを確認', async () => {
            const toolBox = editorPage.locator('tool-box');

            // 検索ボックスで絞り込み
            const filterInput = toolBox.locator('#filter-input');
            await expect(filterInput).toBeEditable();
            await filterInput.fill('my-custom');

            const customItem = toolBox.locator(`tool-box-item[data-item-type="${componentName}"]`);
            await expect(customItem).toBeVisible();
        });

        await test.step('3. ドラッグ＆ドロップで画面に配置する', async () => {
            // ベースとなるページを追加
            await editorHelper.addPage();

            // 左パネルを開いてD&Dの準備
            await editorHelper.openMoveingHandle('left');

            const contentAreaLocator = editorPage.locator('#dom-tree div[data-node-explain="コンテンツ"]');
            const toolBoxItem = editorPage.locator(`tool-box-item[data-item-type="${componentName}"]`);

            // カスタムコンポーネントをD&Dで追加
            await toolBoxItem.dragTo(contentAreaLocator, { targetPosition: { x: 10, y: 10 } });

            // 配置されたノードのタイプが元のHTMLタグ (div) になっていることを確認（リストの最後に追加されるため last() で取得）
            const newNode = contentAreaLocator.locator('> .node[data-node-type="div"]').last();
            await expect(newNode).toBeVisible({ timeout: 10000 });

            // プレビュー画面上に要素がレンダリングされていることを確認
            const previewElement = editorHelper.getPreviewElement('div.my-card');
            await expect(previewElement).toBeVisible({ timeout: 10000 });
            await expect(previewElement).toHaveText('カスタムカード');
        });
    });

    test('作成したカスタムコンポーネントを編集（更新）できる', async ({ editorPage, editorHelper }) => {
        const componentName = 'my-custom-card';
        const componentCode = `<div class="my-card" style="padding:10px; background:lightblue;">\n  <h2>カスタムカード</h2>\n</div>`;
        const editedComponentName = 'my-custom-card-edited';
        const editedComponentCode = `<div class="my-card" style="padding:10px; background:lightgreen;">\n  <h2>編集済みカスタムカード</h2>\n</div>`;

        await test.step('1. 新しいカスタムコンポーネントを事前作成', async () => {
            await editorHelper.openMoveingHandle('left');
            const toolBox = editorPage.locator('tool-box');

            await toolBox.locator('.title-icon-bar-button').click();

            const itemEditor = editorPage.locator('tool-box-item-editor');
            await expect(itemEditor).toBeVisible();

            const componentNameInput = itemEditor.locator('#component-name');
            await expect(componentNameInput).toBeEditable();
            await componentNameInput.fill(componentName);

            const monacoEditor = itemEditor.locator('.code-editor-container textarea').first();
            await expect(monacoEditor).toBeEditable();
            await monacoEditor.fill(componentCode);

            await itemEditor.locator('#save-button').click();
            await expect(itemEditor).toBeHidden();
        });

        await test.step('2. ツールボックスから作成したコンポーネントの編集を起動する', async () => {
            const toolBox = editorPage.locator('tool-box');

            const filterInput = toolBox.locator('#filter-input');
            await expect(filterInput).toBeEditable();
            await filterInput.fill(componentName);

            const customItem = toolBox.locator(`tool-box-item[data-item-type="${componentName}"]`);
            await expect(customItem).toBeVisible();

            // 新規作成時と同じ「追加ボタン」エリア (.title-icon-bar-button) をドラッグ＆ドロップ先にする
            const editButtonZone = toolBox.locator('.title-icon-bar-button');

            // 登録したコンポーネントを、追加の時に使用したボタンの場所へドラッグ＆ドロップして編集を起動する
            await customItem.dragTo(editButtonZone);

            const itemEditor = editorPage.locator('tool-box-item-editor');
            await expect(itemEditor).toBeVisible({ timeout: 15000 });
        });

        await test.step('3. コンポーネント情報（名前・コード）を変更して保存する', async () => {
            const itemEditor = editorPage.locator('tool-box-item-editor');

            // 新しい名前を入力
            const componentNameInput = itemEditor.locator('#component-name');
            await expect(componentNameInput).toBeEditable();
            await componentNameInput.fill(editedComponentName);

            // 新しいコードを入力
            const monacoEditor = itemEditor.locator('.code-editor-container textarea').first();
            await expect(monacoEditor).toBeEditable();
            await monacoEditor.fill(editedComponentCode);

            // 保存を実行
            await itemEditor.locator('#save-button').click();
            await expect(itemEditor).toBeHidden();
        });

        await test.step('4. ツールボックスに編集内容が正常に同期・更新されていることを検証する', async () => {
            const toolBox = editorPage.locator('tool-box');

            const filterInput = toolBox.locator('#filter-input');
            await expect(filterInput).toBeEditable();

            // 新しい名前で検索してヒットすることを確認 (完全一致)
            await filterInput.fill(editedComponentName);
            const editedItem = toolBox.locator(`tool-box-item[data-item-type="${editedComponentName}"]`);
            await expect(editedItem).toBeVisible();

            // 古い名前で検索した場合はヒットしないことを確認 (完全一致)
            await filterInput.fill(componentName);
            const oldItem = toolBox.locator(`tool-box-item[data-item-type="${componentName}"]`);
            await expect(oldItem).toBeHidden();
        });
    });
});
// =========================================================================
// Merged from: tests/specs/normal/editor-script-reorder.spec.ts
// =========================================================================

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
// =========================================================================
// Merged from: tests/specs/normal/editor-script-advanced.spec.ts
// =========================================================================

test.describe('エディタ内：スクリプト高度機能・連携テスト', () => {

    test.beforeEach(async ({ page, context }) => {
        await gotoDashboard(page);
        // 起動時のローディング待機
        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });
    });

    test('サービスワーカー管理：イベント定義、スクリプト紐付け、削除', async ({ editorPage, editorHelper }) => {
        const swEventName = 'pushDummy';
        const scriptName = 'handlePushNotification';
        const scriptContent = `
/**
 * @param {Event} event
 */
function ${scriptName}(event) {
    console.log('Push received');
}
        `;

        await test.step('1. サービスワーカー用のスクリプトを作成', async () => {
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await editorHelper.addNewScript(scriptName, 'function');
            await editorHelper.editScriptContent(scriptName, scriptContent);
        });

        await test.step('2. サービスワーカーイベントを定義してスクリプトを紐付け', async () => {
            // Service Workerタブへ切り替え、イベント定義を追加
            await editorHelper.addCustomServiceWorkerEventDefinition({
                eventName: swEventName,
                comment: 'Push通知受信時'
            });

            const swContainer = editorPage.locator('serviceworker-container');
            const eventRow = swContainer.locator(`.editor-row:has-text("${swEventName}")`);

            // スクリプト追加ボタンをクリック
            await eventRow.getByTitle('スクリプトの追加').click();

            // メニューからスクリプトを選択して追加
            const addMenu = swContainer.locator('#scriptAddMenu');
            await expect(addMenu).toBeVisible();
            const scriptNameInput = addMenu.locator('#script-name');
            await expect(scriptNameInput).toBeEditable();
            await scriptNameInput.fill(scriptName);
            await addMenu.getByRole('button', { name: '追加' }).click();
            await expect(addMenu).toBeHidden();

            // 紐付けられたスクリプトが表示されているか確認
            await expect(eventRow.locator('.editor-row-right-item', { hasText: scriptName })).toBeVisible();
        });

        await test.step('3. 紐付けの解除（削除）', async () => {
            const swContainer = editorPage.locator('serviceworker-container');
            const eventRow = swContainer.locator(`.editor-row:has-text("${swEventName}")`);

            // 削除ボタン（ゴミ箱アイコン）をクリック
            const scriptItem = eventRow.locator('.editor-row-right-item', { hasText: scriptName });
            const deleteBtn = scriptItem.getByTitle('スクリプトの削除');

            const browserName = editorPage.context().browser()?.browserType().name();

            if (browserName === 'webkit') {
                // =========================================================================
                // 【WebKit専用ワークアラウンド】
                // 座標計算のズレやレンダリング遅延による空振りを防ぐため、JS直接クリックを使用
                // =========================================================================
                await expect(async () => {
                    await deleteBtn.evaluate((el: HTMLElement) => el.click());
                    await expect(deleteBtn.locator('i')).toHaveClass(/fa-check/, { timeout: 2000 });
                }).toPass({
                    timeout: 10000,
                    intervals: [1000]
                });

                // 2回目：削除確定
                await deleteBtn.evaluate((el: HTMLElement) => el.click());
            } else {
                // =========================================================================
                // 【本道の処理】 (Chromium、Firefox向け)
                // 実際のユーザー操作に基づき、物理クリックが正常に機能するかを厳密に検証
                // =========================================================================
                // 1回目：削除予約
                await deleteBtn.click();
                await expect(deleteBtn.locator('i')).toHaveClass(/fa-check/);

                // 2回目：削除確定
                await deleteBtn.click();
            }

            // 行からスクリプト名が消えていることを確認
            await expect(scriptItem).toBeHidden();
        });
    });

    test('スクリプト削除時のクリーンアップ：依存関係（イベント紐付け）の自動解除', async ({ editorPage, editorHelper }) => {
        const scriptName = 'clickBtnHandler';

        await test.step('1. セットアップ：ボタン配置とスクリプト作成、紐付け', async () => {
            const { buttonNode } = await editorHelper.setupPageWithButton();

            // スクリプト作成
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await editorHelper.addNewScript(scriptName);

            // ボタンのクリックイベントに紐付け
            await editorHelper.addScriptToNodeEvent({
                nodeLocator: buttonNode,
                eventName: 'click',
                scriptName: scriptName
            });
        });

        await test.step('2. スクリプトを削除（ゴミ箱へ移動）', async () => {
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');

            const scriptRow = scriptContainer.locator('.editor-row', { hasText: scriptName });
            const deleteBtn = scriptRow.getByTitle('ゴミ箱に移動');

            // 1回目クリック（予約）
            await deleteBtn.click();
            // 2回目クリック（実行）
            await deleteBtn.click();

            // リストから消えたことを確認
            await expect(scriptRow).toBeHidden();
        });

        await test.step('3. イベント紐付けが自動解除されていることを検証', async () => {
            // イベントタブに戻る
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'イベント');
            const eventContainer = scriptContainer.locator('event-container');

            // clickイベント行を探す
            const eventRow = eventContainer.locator(`.editor-row:has(div.label:text-is("click"))`);

            // 削除したスクリプト名が表示されていないことを確認
            await expect(eventRow.locator('.editor-row-right-item', { hasText: scriptName })).toBeHidden();
        });
    });

    test('スクリプトの復元とWeb Component（Toolbox）同期', async ({ editorPage, editorHelper }) => {
        const componentTagName = 'my-custom-btn';
        const scriptName = 'MyCustomBtn';
        const componentScript = `
/**
 * @customElement ${componentTagName}
 */
class ${scriptName} extends HTMLElement {
    constructor() { super(); }
}
customElements.define('${componentTagName}', ${scriptName});
        `;

        await test.step('1. Web Component定義スクリプトを作成', async () => {
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');

            await editorHelper.addNewScript(scriptName, 'class');
            await editorHelper.editScriptContent(scriptName, componentScript);
        });

        await test.step('2. Toolboxにコンポーネントが追加されていることを確認', async () => {
            await editorHelper.openMoveingHandle('left');
            const toolBox = editorPage.locator('tool-box');
            await expect(toolBox.locator('tool-box-item', { hasText: componentTagName })).toBeVisible();
        });

        await test.step('3. スクリプトを削除し、Toolboxからも消えることを確認', async () => {
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');

            // エディタが開いている状態なので、スクリプトタブをクリックしてリスト表示に戻る
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');

            const scriptRow = scriptContainer.locator('.editor-row', { hasText: scriptName });

            // 削除実行
            const deleteBtn = scriptRow.getByTitle('ゴミ箱に移動');
            await deleteBtn.click(); // 予約
            await deleteBtn.click(); // 確定

            await expect(scriptRow).toBeHidden();

            // Toolbox確認
            await editorHelper.openMoveingHandle('left');
            const toolBox = editorPage.locator('tool-box');
            await expect(toolBox.locator('tool-box-item', { hasText: componentTagName })).toBeHidden();
        });

        await test.step('4. スクリプトを復元し、Toolboxに復活することを確認', async () => {
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');

            // ゴミ箱を開く
            await scriptContainer.locator('#fab-trash-box').click();
            const trashBox = scriptContainer.locator('.script-trash-box');
            await expect(trashBox).toBeVisible();

            // 復元ボタン（回転矢印アイコン）をクリック
            const restoreBtn = trashBox.locator('.script-trash-box-item-button[title="戻す"]');
            await restoreBtn.click();

            // ゴミ箱を閉じる（外部クリック扱いにするため、別の場所をクリック）
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');

            // スクリプト一覧に戻っているか
            const scriptRow = scriptContainer.locator('.editor-row', { hasText: scriptName });
            await expect(scriptRow).toBeVisible();

            // Toolboxに復活しているか
            await editorHelper.openMoveingHandle('left');
            const toolBox = editorPage.locator('tool-box');
            await expect(toolBox.locator('tool-box-item', { hasText: componentTagName })).toBeVisible();
        });
    });

    test('コーディング支援：IDペーストと影響範囲検索', async ({ editorPage, editorHelper, isMobile }) => {
        const scriptName = 'testIdPaste';
        const buttonId = 'target-btn';

        await test.step('1. セットアップ：ID付きボタンとスクリプトを作成', async () => {
            // ページとボタン作成
            const { buttonNode } = await editorHelper.setupPageWithButton();
            await editorHelper.selectNodeInDomTree(buttonNode);
            // プロパティでIDを設定
            await editorHelper.openMoveingHandle('right');
            const idInput = editorHelper.getPropertyInput('domId').locator('input');
            await expect(idInput).toBeEditable();
            await idInput.fill(buttonId);
            await idInput.press('Enter');

            // スクリプト作成
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await editorHelper.addNewScript(scriptName);
        });

        await test.step('2. エディタへのIDペースト機能の検証', async () => {
            // スクリプト編集画面を開く
            await editorHelper.openScriptForEditing(scriptName);

            for (let i = 0; i < 4; i++) {
                await editorPage.keyboard.press('ArrowDown');
            }

            // プロパティタブ（属性）を開き、ID行にあるペーストボタンをクリック
            await editorHelper.switchTabInContainer(editorPage.locator('property-container'), '属性');
            const propertyContainer = editorHelper.getPropertyContainer();

            // IDラベルの横にある「スクリプトにIDを貼り付け」ボタン（fa-codeアイコン）を探す
            const idRow = propertyContainer.locator('.editor-row-left-item', { hasText: 'ID' });
            const pasteBtn = idRow.locator('button[title="スクリプトにIDを貼り付け"]');

            await expect(pasteBtn).toBeVisible();
            await pasteBtn.click();

            // エディタの内容を取得し、ID取得コードが挿入されているか確認
            const editorContent = await editorHelper.getMonacoEditorContent();
            const expectedPart = `const targetBtn = document.getElementById('${buttonId}');`;

            const normalizedReceived = normalizeWhitespace(editorContent);
            const normalizedExpected = normalizeWhitespace(expectedPart);

            expect(normalizedReceived).toContain(normalizedExpected);

            // エディタを閉じる（保存して戻る）
            await editorPage.locator('script-container #fab-save').click();

            // エディタが開いている状態なので、スクリプトタブをクリックしてリスト表示に戻る
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');

            await editorPage.locator('script-container #script-list-container').waitFor({ state: 'visible' });
        });

        await test.step('3. スクリプトの影響範囲（使用箇所）検索機能の検証', async () => {
            // 事前準備：スクリプトをイベントに紐付けておく
            const buttonNode = (await editorHelper.selectNodeByAttribute('data-node-dom-id', buttonId));
            await editorHelper.addScriptToNodeEvent({
                nodeLocator: buttonNode,
                eventName: 'click',
                scriptName: scriptName
            });

            // スクリプト一覧に戻る
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');

            // 影響範囲ボタン（目のアイコン）をクリック
            const scriptRow = scriptContainer.locator('.editor-row', { hasText: scriptName });
            const usageBtn = scriptRow.getByTitle('割り当てられているイベント');
            await usageBtn.click();

            // サブウィンドウが表示され、紐付け情報が出ているか確認
            const subWindow = editorPage.locator('event-attach-script-search-sub-window');
            await expect(subWindow).toBeVisible();

            // 検索結果にイベント名とコンポーネント名が含まれているか
            await expect(subWindow).toContainText('click');
            await expect(subWindow).toContainText(buttonId); // IDが表示されるはず

            // 閉じる（外部クリック）
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await expect(subWindow).toBeHidden();
        });
    });

    test.describe('スクリプト編集のキャンセル機能', () => {
        const scriptName = 'cancelTestScript';
        const initialContent = `function ${scriptName}() {\n    console.log("first");\n}`;
        const modifiedContent = `function ${scriptName}() {\n    console.log("modified");\n}`;

        test.beforeEach(async ({ editorPage, editorHelper }) => {
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await editorHelper.addNewScript(scriptName);
            await editorHelper.editScriptContent(scriptName, initialContent);

            // 【修正】editScriptContentの内部で自動的に一覧に戻るため、表示検証のみに変更します
            await expect(scriptContainer.locator('#script-list-container')).toBeVisible();
        });

        test('変更がない場合、確認なしでエディタを閉じることができる', async ({ editorPage, editorHelper }) => {
            const scriptContainer = editorPage.locator('script-container');
            const editorContainer = scriptContainer.locator('#script-container');

            await editorHelper.openScriptForEditing(scriptName);
            await expect(editorContainer).toBeVisible();

            const closeBtn = scriptContainer.locator('#fab-close');
            await closeBtn.click();

            await expect(scriptContainer.locator('#script-list-container')).toBeVisible();
            await expect(editorContainer).toBeHidden();
        });

        test('変更がある場合、確認ダイアログで「キャンセル（いいえ）」を選択すると変更が破棄されて一覧に戻る', async ({ editorPage, editorHelper }) => {
            const scriptContainer = editorPage.locator('script-container');
            const monacoEditor = scriptContainer.locator('.monaco-editor[role="code"]');

            await editorHelper.openScriptForEditing(scriptName);

            // 重要: fillScriptContentを使わず、APIで直接値を書き換える（変更あり状態を作る）
            await editorHelper.setMonacoValue(monacoEditor, modifiedContent);

            editorPage.once('dialog', async dialog => {
                expect(dialog.message()).toContain('未保存の変更があります');
                // キャンセル（dismiss）を選択して、変更を破棄して閉じる
                await dialog.dismiss();
            });

            await scriptContainer.locator('#fab-close').click();

            await expect(scriptContainer.locator('#script-list-container')).toBeVisible();

            await editorHelper.openScriptForEditing(scriptName);
            const currentContent = await editorHelper.getMonacoEditorContent();
            expect(normalizeWhitespace(currentContent)).toBe(normalizeWhitespace(initialContent));
        });

        test('変更がある場合、確認ダイアログで「OK（はい）」を選択すると変更が保存されて一覧に戻る', async ({ editorPage, editorHelper }) => {
            const scriptContainer = editorPage.locator('script-container');
            const monacoEditor = scriptContainer.locator('.monaco-editor[role="code"]');

            await editorHelper.openScriptForEditing(scriptName);
            await editorHelper.setMonacoValue(monacoEditor, modifiedContent);

            editorPage.once('dialog', async dialog => {
                expect(dialog.message()).toContain('未保存の変更があります');
                // OK（accept）を選択して、変更を保存して閉じる
                await dialog.accept();
            });

            await scriptContainer.locator('#fab-close').click();

            await expect(scriptContainer.locator('#script-list-container')).toBeVisible();

            await editorHelper.openScriptForEditing(scriptName);
            const currentContent = await editorHelper.getMonacoEditorContent();
            expect(normalizeWhitespace(currentContent)).toBe(normalizeWhitespace(modifiedContent));
        });

        test('「最近開いたスクリプトを再開する」バナーが表示され、クリックして再編集に入れること', async ({ editorPage, editorHelper }) => {
            const scriptContainer = editorPage.locator('script-container');
            const listContainer = scriptContainer.locator('#script-list-container');
            const editorContainer = scriptContainer.locator('#script-container');

            // 💡 beforeEachで直前に編集を終えて閉じた scriptName (cancelTestScript) の
            // 再開バナーが、すでに一覧画面の上部に描画されている状態からスタートします。

            await test.step('1. 一覧画面の上部に「最近開いたスクリプト」バナーが出現していることを検証', async () => {
                // beforeEachで最後に閉じたスクリプト名が含まれるバナーを特定
                const resumeBanner = listContainer.locator('div').filter({ hasText: '最近開いた' }).first();
                await expect(resumeBanner).toBeVisible();
                await expect(resumeBanner).toContainText(scriptName); // beforeEachの scriptName と一致することを確認
            });

            await test.step('2. バナーをクリックすると、そのスクリプトの編集画面に即座に戻れることを検証', async () => {
                const resumeBanner = listContainer.locator('div').filter({ hasText: '最近開いた' }).first();
                await resumeBanner.click();

                // 編集画面（Monacoエディタ）が再展開され、一覧画面が非表示になっていること
                await expect(editorContainer).toBeVisible();
                await expect(listContainer).toBeHidden();

                // エディタの内容が該当スクリプトのものであることを確認
                const content = await editorHelper.getMonacoEditorContent();
                expect(content).toContain(`function ${scriptName}`);
            });
        });
    });
});
// =========================================================================
// Merged from: tests/specs/normal/editor-pinch-zoom.spec.ts
// =========================================================================

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
            // console.log(`[PinchTest] 初期フォントサイズ: ${initialFontSize}px`);
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
            // console.log(`[PinchTest] ピンチアウト後のフォントサイズ: ${updatedFontSize}px`);

            // スケール2.0に拡大しているため、初期サイズよりも確実に大きくなっていることをアサート
            expect(updatedFontSize!).toBeGreaterThan(initialFontSize!);
        });
    });
});