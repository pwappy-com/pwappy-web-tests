import { test as base, expect, Page, Locator, CDPSession, Dialog } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor, addVersion } from '../../tools/dashboard-helpers';
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
    appName = `ui-auto-${uniqueId}`.slice(0, 30);
    appKey = `auto-key-${uniqueId}`.slice(0, 30);

    const context = await browser.newContext({ storageState: STORAGE_STATE });
    const page = await context.newPage();

    await gotoDashboard(page);
    await createApp(page, appName, appKey);

    await context.close();
});

// すべてのテストが終了した後に、アプリを削除する
test.afterAll(async ({ browser }) => {
    if (appKey) {
        const context = await browser.newContext({ storageState: STORAGE_STATE });
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

    await inputLocator.click();
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
// Merged from: tests/specs/normal/editor-test-automation.spec.ts
// =========================================================================

test.describe('エディタ内：テスト自動化（テストシナリオとAPIモック）の検証', () => {

    test.beforeEach(async ({ editorPage, editorHelper }) => {
        // 右ハンドルを展開
        await editorHelper.openMoveingHandle('right');
        const scriptContainer = editorPage.locator('script-container');

        // strict mode violation を回避するため、IDで直接「テスト」タブを指定してクリック
        await expect(async () => {
            const alert = editorPage.locator('alert-component');
            if (await alert.isVisible().catch(() => false)) {
                await alert.getByRole('button', { name: '閉じる' }).click().catch(() => { });
            }
            await editorPage.keyboard.press('Escape'); // サジェスト消去用
            await scriptContainer.locator('#tab-test').click({ timeout: 2000 });
        }).toPass({ timeout: 15000, intervals: [1000] });

        await expect(scriptContainer.locator('test-container')).toBeVisible();
    });

    test('テストシナリオの追加・編集・削除ができる', async ({ editorPage }) => {
        const testContainer = editorPage.locator('test-container');
        const scenarioName = '新規ログインテスト';
        const editedName = '編集後ログインテスト';

        await test.step('1. シナリオの追加', async () => {
            // モバイル対応: getByRole ではなく クラスセレクタ (.add-btn) でクリックする
            await testContainer.locator('.add-btn').click();

            const modal = editorPage.locator('test-scenario-editor .modal');
            await expect(modal).toBeVisible();

            const senarioNameInput = modal.locator('#scenario-name');
            const senarioDescInput = modal.locator('#scenario-desc');
            await expect(senarioNameInput).toBeEditable();
            await expect(senarioDescInput).toBeEditable();
            await senarioNameInput.fill(scenarioName);
            await senarioDescInput.fill('ログイン画面の正常系テスト');

            // モーダル内のボタンはモバイルでもテキストが表示されるので getByRole が使える
            await modal.getByRole('button', { name: '保存' }).click();
            await expect(modal).toBeHidden();

            // 一覧に追加されたか確認
            const scenarioItem = testContainer.locator('.scenario-item', { hasText: scenarioName });
            await expect(scenarioItem).toBeVisible();
        });

        await test.step('2. シナリオの編集', async () => {
            const scenarioItem = testContainer.locator('.scenario-item', { hasText: scenarioName });
            await scenarioItem.locator('.action-icon.fa-pen').click();

            const modal = editorPage.locator('test-scenario-editor .modal');
            await expect(modal).toBeVisible();

            const senarioNameInput = modal.locator('#scenario-name');
            await expect(senarioNameInput).toBeEditable();
            await senarioNameInput.fill(editedName);
            await modal.getByRole('button', { name: '保存' }).click();
            await expect(modal).toBeHidden();

            await expect(testContainer.locator('.scenario-item', { hasText: editedName })).toBeVisible();
        });

        await test.step('3. シナリオの削除', async () => {
            const scenarioItem = testContainer.locator('.scenario-item', { hasText: editedName });

            // 削除アイコンをクリックし、確認ダイアログをOKする
            editorPage.once('dialog', dialog => dialog.accept());
            await scenarioItem.locator('.action-icon.delete').click();

            await expect(scenarioItem).toBeHidden();
        });
    });

    test('APIモックの追加・ON/OFFトグル・削除ができる', async ({ editorPage }) => {
        const testContainer = editorPage.locator('test-container');
        const mockPath = '/api/v1/users';
        const mockName = 'ユーザー取得成功';

        await test.step('1. APIモックタブへ切り替え', async () => {
            await testContainer.locator('.tab', { hasText: 'APIモック' }).click();
            // モバイル対応: クラスセレクタでの要素存在確認
            await expect(testContainer.locator('.add-btn')).toBeVisible();
        });

        await test.step('2. APIモックの追加', async () => {
            await testContainer.locator('.add-btn').click();

            const modal = testContainer.locator('.modal-dialog');
            await expect(modal).toBeVisible();

            const pathInput = modal.locator('#mock-path');
            const patternInput = modal.locator('#mock-pattern');
            const responseInput = modal.locator('#mock-response');
            await expect(pathInput).toBeEditable();
            await expect(patternInput).toBeEditable();
            await expect(responseInput).toBeEditable();

            await pathInput.fill(mockPath);
            await patternInput.fill(mockName);
            await responseInput.fill(JSON.stringify({ status: 'success', data: [] }));

            await modal.getByRole('button', { name: '設定を保存' }).click();
            await expect(modal).toBeHidden();

            const mockItem = testContainer.locator('.mock-item', { hasText: mockName });
            await expect(mockItem).toBeVisible();
        });

        await test.step('3. モックのON/OFFトグル', async () => {
            const mockItem = testContainer.locator('.mock-item', { hasText: mockName });
            const toggleInput = mockItem.locator('input[type="checkbox"]');

            // 初期はON
            await expect(toggleInput).toBeChecked();

            // トグルクリック (inputは不可視なのでlabel.toggle-switchをクリック)
            await mockItem.locator('label.toggle-switch').click();
            await expect(toggleInput).not.toBeChecked();

            await mockItem.locator('label.toggle-switch').click();
            await expect(toggleInput).toBeChecked();
        });

        await test.step('4. APIモックの削除', async () => {
            const mockItem = testContainer.locator('.mock-item', { hasText: mockName });
            // 削除アイコンをクリックし、確認ダイアログをOKする
            editorPage.once('dialog', dialog => dialog.accept());
            await mockItem.locator('.action-icon.delete').click();

            await expect(mockItem).toBeHidden();
        });
    });
});
// =========================================================================
// Merged from: tests/specs/normal/snapshots.spec.ts
// =========================================================================

test.describe('スナップショットと自動復旧機能の統合テスト', () => {

    /**
     * 各テスト実行前の共通セットアップ処理。
     */
    test.beforeEach(async ({ page, context }) => {
        // ダッシュボードページへ移動
        await gotoDashboard(page);

        // 初期ローディング完了を待つ
        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });
    });

    /**
     * 手動でのスナップショット作成、変更、および復元フローを検証します。
     */
    test('スナップショットの作成と復元ができる', async ({ editorPage, isMobile, editorHelper }) => {
        const uniqueSnapshotName = `test-snapshot-${Date.now()}`;

        // 手動保存・復元のフロー
        try {
            await test.step('1. 新しいスナップショットを保存', async () => {
                const menuButton = editorPage.locator('#fab-bottom-menu-box');
                await menuButton.click();

                const platformBottomMenu = editorPage.locator('#platformBottomMenu');
                await platformBottomMenu.getByText('スナップショット').click();

                const snapshotManager = editorPage.locator('snapshot-manager');
                await expect(snapshotManager.locator('.container')).toBeVisible();

                await snapshotManager.getByRole('button', { name: '新規スナップショット' }).click();

                const saveDialog = editorPage.locator('snapshot-save-dialog');
                const snapshotNameInput = saveDialog.locator('#snapshot-name');
                const snapshotDescInput = saveDialog.locator('#snapshot-description');
                await expect(snapshotNameInput).toBeEditable();
                await expect(snapshotDescInput).toBeEditable();
                await snapshotNameInput.fill(uniqueSnapshotName);
                await snapshotDescInput.fill('E2E Test Snapshot');
                await saveDialog.getByRole('button', { name: '保存' }).click();

                await expect(saveDialog).toBeHidden();
                await expect(snapshotManager.locator('.snapshot-item', { hasText: uniqueSnapshotName })).toBeVisible();

                // 管理画面を一度閉じる
                await snapshotManager.locator('.close-btn').click();
            });

            await test.step('2. アプリケーションを編集（ボタンを追加）', async () => {
                await editorHelper.addPage();
                const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
                await editorHelper.addComponent('ons-button', contentAreaSelector);

                // プレビュー上にボタンが存在することを確認
                const previewButton = editorHelper.getPreviewElement('ons-button');
                await expect(previewButton).toBeVisible();
            });

            await test.step('3. スナップショットから復元を実行', async () => {
                await editorHelper.closeMoveingHandle();
                const menuButton = editorPage.locator('#fab-bottom-menu-box');
                await menuButton.click();
                const bottomMenu = editorPage.locator('#platformBottomMenu');
                await expect(bottomMenu).toBeVisible();
                await bottomMenu.getByText('スナップショット').click();

                const snapshotManager = editorPage.locator('snapshot-manager');
                const snapshotItem = snapshotManager.locator('.snapshot-item', { hasText: uniqueSnapshotName });
                const restoreButton = snapshotItem.getByRole('button', { name: '復元' });

                // ダイアログハンドリングの準備（確認ダイアログと完了アラート）
                editorPage.once('dialog', async confirmDialog => {
                    expect(confirmDialog.message()).toContain('現在の編集内容は破棄され');
                    editorPage.once('dialog', async alertDialog => {
                        expect(alertDialog.message()).toBe('スナップショットを復元しました。');
                        await alertDialog.dismiss();
                    });
                    await confirmDialog.accept();
                });

                await restoreButton.click({ noWaitAfter: true });
                await expect(snapshotManager).toBeHidden();
            });

            await test.step('4. 復元後の状態確認（追加したボタンが消えていること）', async () => {
                const previewButton = editorHelper.getPreviewElement('ons-button');
                await expect(previewButton).toBeHidden();
            });
        } finally {
            // フィクスチャで閉じるため、ここでの明示的な close は省略可能だが、元の構造を維持
        }
    });

    /**
     * 未保存の状態でのリロードによる自動復旧を検証します。
     */
    test('自動復旧フロー：未保存でのリロード後に「スナップショットから復元」ができるか', async ({ editorPage, editorHelper }) => {
        test.setTimeout(120000);

        const testButtonText = 'RECOVERY_TEST_BUTTON';
        let pageNodeId: string;

        await test.step('1. データを変更し、保存せずにページを離脱する', async () => {
            const setup = await editorHelper.setupPageWithButton();
            pageNodeId = await setup.pageNode.getAttribute('data-node-id') as string;

            await editorHelper.selectNodeInDomTree(setup.buttonNode);
            await editorHelper.openMoveingHandle('right');

            // プロパティ変更
            const textInput = editorHelper.getPropertyInput('text').locator('input');
            await expect(textInput).toBeEditable();
            await textInput.fill(testButtonText);
            await textInput.press('Enter');

            // プレビュー反映確認
            const previewFrame = editorHelper.getPreviewFrame();
            await expect(previewFrame.locator('ons-button')).toHaveText(testButtonText);

            // リロード（beforeunloadイベントをトリガーして自動保存させる）
            await editorPage.reload();
        });

        await test.step('2. 起動時の復旧ダイアログで「復元する」を選択', async () => {
            // ダイアログが表示されるのを待つ
            const restoreDialog = editorPage.locator('message-box', { hasText: '前回正常に終了されなかった可能性' });
            await expect(restoreDialog).toBeVisible({ timeout: 20000 });

            await restoreDialog.getByRole('button', { name: '復元する' }).click({ force: true });

            // 復旧ダイアログが完全に消えるのを待つ
            await expect(restoreDialog).toBeHidden({ timeout: 10000 });

            // リロード後の復元フローで表示される可能性のあるモーダルをスキップ
            await editorHelper.handleStarterTemplateModal();

            // pageNodeを表示する
            await editorHelper.switchTopLevelTemplate(pageNodeId);
        });

        await test.step('3. データが完全に復元されていることを検証', async () => {
            const domTree = editorHelper.getDomTree();
            // ツリーが再描画されるのを待つ
            await expect(domTree.locator('.node')).not.toHaveCount(0);

            const buttonNode = domTree.locator('.node[data-node-type="ons-button"]');
            await expect(buttonNode).toBeVisible();

            // プレビュー上の表示も復元されているか
            const previewFrame = editorHelper.getPreviewFrame();
            await expect(previewFrame.locator('ons-button')).toHaveText(testButtonText);
        });
    });

    /**
     * スナップショットの破棄フローを検証します。
     */
    test('スナップショットの削除と「破棄」フローの検証', async ({ editorPage, editorHelper }) => {
        await test.step('1. スナップショットを作成', async () => {
            await editorHelper.addPage();
            // リロードして自動スナップショットを作成させる
            await editorPage.reload();
        });

        await test.step('2. 起動時の復旧ダイアログで「破棄」を選択', async () => {
            const restoreDialog = editorPage.locator('message-box', { hasText: '前回正常に終了されなかった可能性' });
            await expect(restoreDialog).toBeVisible({ timeout: 20000 });

            await restoreDialog.getByRole('button', { name: '破棄する' }).click({ force: true });

            // 確認ダイアログ
            const discardConfirm = editorPage.locator('message-box', { hasText: 'すべてのスナップショットを破棄しますか？' });
            await expect(discardConfirm).toBeVisible({ timeout: 10000 });
            await discardConfirm.getByRole('button', { name: 'はい、破棄します' }).click({ force: true });
        });

        await test.step('3. スナップショット画面の状態確認', async () => {
            // ダイアログが消えるのを待機
            await expect(editorPage.locator('message-box', { hasText: 'すべてのスナップショットを破棄しますか？' })).toBeHidden({ timeout: 10000 });

            // スナップショットを全破棄してアプリが空になったため、確実に出現するモーダルをスキップ
            await editorHelper.handleStarterTemplateModal();

            await editorPage.locator('#fab-bottom-menu-box').click({ force: true });
            const bottomMenu = editorPage.locator('#platformBottomMenu');
            await expect(bottomMenu).toBeVisible();
            await bottomMenu.getByText('スナップショット').click();

            const manager = editorPage.locator('snapshot-manager');
            const managerTitle = editorPage.locator('h3', { hasText: 'スナップショット管理' });
            await expect(managerTitle).toBeVisible();

            const listItems = manager.locator('.snapshot-item');

            // 検証:
            // 1. リロード前に作成されたはずの「自動保存 - 未保存」などの古いスナップショットは消えていること
            // 2. プロジェクトの仕様変更により、起動直後に作成される「自動保存 - エディタ読み込み完了」も
            //    全破棄の対象に含まれるようになったため、最終的に0件になることを期待する。
            await expect(listItems).toHaveCount(0);
        });
    });
});
// =========================================================================
// Merged from: tests/specs/normal/editor-tour-tutorial.spec.ts
// =========================================================================

test.describe('エディタ内：ツアーとチュートリアル機能のテスト', () => {

    test.beforeEach(async ({ page }) => {
        await gotoDashboard(page);
    });

    test('初回起動時にツアーが表示され、完了できること', async ({ page, context, browserName }) => {
        // タイムアウトを少し長めに設定して、どこで詰まるか確実にログを残す
        test.setTimeout(120000);

        logTime('テスト開始');

        await test.step('1. セットアップ: ツアー未完了状態にする', async () => {
            logTime('localStorage フラグ削除開始');

            // このテストのみ、ツアーを表示させるためにフラグを削除する
            await page.evaluate(() => {
                localStorage.removeItem('pwappy_tour_completed');
            });
            logTime('localStorage フラグ削除完了');
        });

        let editorPage: Page;
        await test.step('2. エディタを起動し、ツアーが表示されることを確認', async () => {
            // アプリ詳細画面へ遷移する
            const appRow = page.locator('.app-card', { has: page.locator('.app-key', { hasText: appKey }) }).first();
            await expect(appRow).toBeVisible({ timeout: 15000 });
            await appRow.click({ force: true });
            await expect(page.locator('.detail-tab.active')).toBeVisible({ timeout: 10000 });

            logTime('openEditor 開始');
            editorPage = await openEditor(page, context, appName);
            logTime('openEditor 完了');

            // Playwright側のコンソールにもブラウザ内のログをブリッジする
            editorPage.on('console', msg => {
                console.log(`[TourTest:BrowserConsole] ${msg.type()}: ${msg.text()}`);
            });

            if (browserName === 'webkit') {
                await editorPage.route('**/*.webm', route => route.abort('blockedbyclient'));
            }

            const tourGuide = editorPage.locator('app-tour-guide');
            logTime('tourGuide visible待機開始');

            try {
                await expect(tourGuide).toHaveAttribute('visible', '', { timeout: 15000 });
                logTime('tourGuide visible待機完了');
            } catch (e: any) {
                logTime(`tourGuide visible待機エラー: ${e.message}`);
                throw e;
            }

            const dialog = tourGuide.locator('.dialog');
            logTime('dialog toBeVisible待機開始');
            await expect(dialog).toBeVisible({ timeout: 5000 });
            logTime('dialog toBeVisible待機完了');

            await expect(dialog.locator('.title')).toBeVisible({ timeout: 5000 });
            logTime('title toBeVisible待機完了');
        });

        await test.step('3. ツアーを進めて完了する', async () => {
            const tourGuide = editorPage.locator('app-tour-guide');

            if (browserName === 'webkit') {
                logTime('WebKitワークアラウンド evaluate 開始');

                const evalLogs = await tourGuide.evaluate(async (tg: HTMLElement) => {
                    const debugLogs: string[] = [];
                    const l = (m: string) => debugLogs.push(`[TourTest:WebkitEval] ${m}`);
                    l('Start evaluation loop');

                    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
                    for (let i = 0; i < 25; i++) {
                        const root = tg.shadowRoot || tg;
                        const nextBtn = root.querySelector('.btn-next') as HTMLButtonElement | null;

                        if (!nextBtn) {
                            l(`Iter ${i}: .btn-next NOT FOUND in root`);
                            break;
                        }

                        const disp = window.getComputedStyle(nextBtn).display;
                        if (disp === 'none') {
                            l(`Iter ${i}: .btn-next display is none`);
                            break;
                        }

                        const btnText = nextBtn.innerText || nextBtn.textContent || '';
                        l(`Iter ${i}: Clicking button. Text: "${btnText.trim()}"`);
                        nextBtn.click();
                        await delay(800);
                        if (btnText.includes('完了')) {
                            l(`Iter ${i}: Button text included '完了'. Breaking.`);
                            break;
                        }
                    }
                    l('End evaluation loop');
                    return debugLogs;
                });

                evalLogs.forEach(log => console.log(log));
                logTime('WebKitワークアラウンド evaluate 完了');
            } else {
                const nextBtn = tourGuide.locator('.btn-next');

                logTime('Chromium本道ループ開始');
                for (let i = 0; i < 25; i++) {
                    logTime(`[Loop ${i}] 開始`);
                    const count = await nextBtn.count();
                    logTime(`[Loop ${i}] nextBtn count: ${count}`);
                    if (count === 0) break;

                    try {
                        const btnText = await nextBtn.innerText({ timeout: 5000 });
                        logTime(`[Loop ${i}] ボタンテキスト: "${btnText}"`);
                        await nextBtn.click({ timeout: 5000 });
                        logTime(`[Loop ${i}] クリック完了`);
                        await editorPage.waitForTimeout(600);
                        logTime(`[Loop ${i}] 待機600ms完了`);

                        if (btnText.includes('完了')) {
                            logTime(`[Loop ${i}] 「完了」検知によりループ終了`);
                            break;
                        }
                    } catch (e: any) {
                        logTime(`[Loop ${i}] エラー発生: ${e.message}`);
                        throw e;
                    }
                }
                logTime('Chromium本道ループ終了');
            }

            logTime('tourGuide 非表示待機開始');

            try {
                await expect(tourGuide).not.toHaveAttribute('visible', '', { timeout: 15000 });
                logTime('tourGuide 非表示待機完了');
            } catch (e) {
                logTime(`[TourTest:FATAL] tourGuide did not hide.`);
                const dumpHtml = await tourGuide.evaluate(el => el.outerHTML).catch(() => 'could not read HTML');
                logTime(`[TourTest:Dump] HTML:\n${dumpHtml.substring(0, 1000)}`);
                throw e;
            }

            const isCompleted = await editorPage.evaluate(() => localStorage.getItem('pwappy_tour_completed'));
            logTime(`localStorage 確認: ${isCompleted}`);
            expect(isCompleted).toBe('true');
        });

        await test.step('4. クリーンアップ', async () => {
            logTime('クリーンアップ: editorPage.close() 開始');
            await editorPage.close();
            logTime('クリーンアップ: editorPage.close() 完了');

            await page.bringToFront();
        });
    });

    test('ツアーを途中で閉じた場合、フラグは立たず、次回リロード時に再表示されること', async ({ page, context }) => {
        test.setTimeout(90000);

        await test.step('1. セットアップ: ツアー未完了状態にする', async () => {
            await page.evaluate(() => {
                localStorage.removeItem('pwappy_tour_completed');
            });
        });

        let editorPage: Page;
        await test.step('2. エディタを起動し、ツアー表示後に「後で見る」を押して閉じる', async () => {
            // アプリ詳細画面へ遷移する
            const appRow = page.locator('.app-card', { has: page.locator('.app-key', { hasText: appKey }) }).first();
            await expect(appRow).toBeVisible({ timeout: 15000 });
            await appRow.click({ force: true });
            await expect(page.locator('.detail-tab.active')).toBeVisible({ timeout: 10000 });

            editorPage = await openEditor(page, context, appName);

            const tourGuide = editorPage.locator('app-tour-guide');
            await expect(tourGuide).toHaveAttribute('visible', '', { timeout: 15000 });

            const laterBtn = tourGuide.locator('button.btn-skip:has-text("後で見る")');
            await expect(laterBtn).toBeVisible();

            const dialogHandler = async (dialog: Dialog) => {
                const message = dialog.message();
                if (message.includes('ツアーを一時中断しました')) {
                    expect(message).toContain('ツアーを一時中断しました');
                    await dialog.accept().catch(() => { });
                } else {
                    await dialog.accept().catch(() => { });
                }
            };
            editorPage.on('dialog', dialogHandler);

            await laterBtn.click({ force: true });
            await expect(tourGuide).not.toHaveAttribute('visible', '', { timeout: 5000 });

            editorPage.off('dialog', dialogHandler);

            const isCompleted = await editorPage.evaluate(() => localStorage.getItem('pwappy_tour_completed'));
            expect(isCompleted).not.toBe('true');
        });

        await test.step('3. エディタをリロードし、ツアーが再び自動で表示されることを検証', async () => {
            await editorPage.reload();
            await editorPage.waitForLoadState('domcontentloaded');

            const tempHelper = new EditorHelper(editorPage, false);
            await tempHelper.handleSnapshotRestoreDialog();
            await tempHelper.handleStarterTemplateModal();

            const tourGuide = editorPage.locator('app-tour-guide');
            await expect(tourGuide).toHaveAttribute('visible', '', { timeout: 20000 });
        });

        await test.step('4. クリーンアップ', async () => {
            await editorPage.close();
            await page.bringToFront();
        });
    });

    test('初回ステップで「今後表示しない」を選択した場合、以降起動してもツアーが表示されないこと', async ({ page, context }) => {
        test.setTimeout(90000);

        await test.step('1. セットアップ', async () => {
            await page.evaluate(() => {
                localStorage.removeItem('pwappy_tour_completed');
            });
        });

        let editorPage: Page;
        await test.step('2. エディタ起動後、「今後表示しない」ボタンをクリックする', async () => {
            // アプリ詳細画面へ遷移する
            const appRow = page.locator('.app-card', { has: page.locator('.app-key', { hasText: appKey }) }).first();
            await expect(appRow).toBeVisible({ timeout: 15000 });
            await appRow.click({ force: true });
            await expect(page.locator('.detail-tab.active')).toBeVisible({ timeout: 10000 });

            editorPage = await openEditor(page, context, appName);

            const tourGuide = editorPage.locator('app-tour-guide');
            await expect(tourGuide).toHaveAttribute('visible', '', { timeout: 15000 });

            const noShowBtn = tourGuide.locator('button.btn-skip:has-text("今後表示しない")');
            await expect(noShowBtn).toBeVisible();
            await noShowBtn.click({ force: true });

            await expect(tourGuide).not.toHaveAttribute('visible', '', { timeout: 5000 });

            const isCompleted = await editorPage.evaluate(() => localStorage.getItem('pwappy_tour_completed'));
            expect(isCompleted).toBe('true');
        });

        await test.step('3. リロード後にツアーが自動表示されないことを検証', async () => {
            await editorPage.reload();
            await editorPage.waitForLoadState('domcontentloaded');

            const tempHelper = new EditorHelper(editorPage, false);
            await tempHelper.handleSnapshotRestoreDialog();

            const tourGuide = editorPage.locator('app-tour-guide');
            await expect(tourGuide).not.toHaveAttribute('visible', '', { timeout: 10000 });
        });

        await test.step('4. クリーンアップ', async () => {
            await editorPage.close();
            await page.bringToFront();
        });
    });

    test('メニューからチュートリアルモーダルを開けること', async ({ page, context, browserName }) => {
        let editorPage: Page;
        await test.step('1. チュートリアルモーダルを開く', async () => {
            // アプリ詳細画面へ遷移する
            const appRow = page.locator('.app-card', { has: page.locator('.app-key', { hasText: appKey }) }).first();
            await expect(appRow).toBeVisible({ timeout: 15000 });
            await appRow.click({ force: true });
            await expect(page.locator('.detail-tab.active')).toBeVisible({ timeout: 10000 });

            editorPage = await openEditor(page, context, appName);

            if (browserName === 'webkit') {
                await editorPage.route('**/*.webm', route => route.abort('blockedbyclient'));
            }

            const menuButton = editorPage.locator('#fab-bottom-menu-box');
            await menuButton.click();

            const bottomMenu = editorPage.locator('#platformBottomMenu');
            await expect(bottomMenu).toBeVisible();

            const tutorialMenuItem = bottomMenu.locator('.menu-item', { hasText: 'チュートリアル' });
            await tutorialMenuItem.click();

            const tutorialModal = editorPage.locator('app-tutorial-modal');
            await expect(tutorialModal).toHaveAttribute('visible', '', { timeout: 10000 });

            const modalDialog = tutorialModal.locator('.modal');
            await expect(modalDialog).toBeVisible();
        });

        await test.step('2. チュートリアルモーダルを閉じる', async () => {
            const tutorialModal = editorPage.locator('app-tutorial-modal');

            const closeBtn = tutorialModal.locator('.main-content .close-btn');
            await closeBtn.click();
            await expect(tutorialModal).not.toHaveAttribute('visible', '');
        });

        await test.step('3. クリーンアップ', async () => {
            await editorPage.close();
            await page.bringToFront();
        });
    });
});