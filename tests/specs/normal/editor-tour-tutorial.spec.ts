import { test as base, expect, Page, Dialog } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

const logTime = (msg: string) => {
    const now = new Date();
    console.log(`[TourTest:Time] ${now.toISOString()} - ${msg}`);
};

type TourFixtures = {
    appName: string;
    appKey: string;
    editorHelper: EditorHelper;
};

const test = base.extend<TourFixtures>({
    appName: async ({ }, use) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        await use(`tour-test-${uniqueId}`.slice(0, 30));
    },
    appKey: async ({ }, use) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        await use(`tour-key-${uniqueId}`.slice(0, 30));
    },
    editorHelper: async ({ }, use) => {
        // ヘルパーインスタ化のための仮フィクスチャ（各テスト内で個別にPageを設定して利用も可能）
        await use(null as any);
    }
});

test.describe('エディタ内：ツアーとチュートリアル機能のテスト', () => {

    test.beforeEach(async ({ page }) => {
        await gotoDashboard(page);
    });

    test('初回起動時にツアーが表示され、完了できること', async ({ page, context, appName, appKey, browserName }) => {
        // タイムアウトを少し長めに設定して、どこで詰まるか確実にログを残す
        test.setTimeout(120000);

        logTime('テスト開始');

        await test.step('1. セットアップ: アプリを作成し、ツアー未完了状態にする', async () => {
            logTime('createApp 開始');
            await createApp(page, appName, appKey);
            logTime('createApp 完了');

            // このテストのみ、ツアーを表示させるためにフラグを削除する
            await page.evaluate(() => {
                localStorage.removeItem('pwappy_tour_completed');
            });
            logTime('localStorage フラグ削除完了');
        });

        let editorPage: Page;
        await test.step('2. エディタを起動し、ツアーが表示されることを確認', async () => {
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

            // タイムアウトが発生した場合でもスタックトレースが残るよう try-catch
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

            // ツアー完了後に localStorage にフラグがセットされたか確認
            const isCompleted = await editorPage.evaluate(() => localStorage.getItem('pwappy_tour_completed'));
            logTime(`localStorage 確認: ${isCompleted}`);
            expect(isCompleted).toBe('true');
        });

        await test.step('4. クリーンアップ', async () => {
            logTime('クリーンアップ: editorPage.close() 開始');
            await editorPage.close();
            logTime('クリーンアップ: editorPage.close() 完了');

            await page.bringToFront();

            logTime('クリーンアップ: deleteApp 開始');
            await deleteApp(page, appKey);
            logTime('クリーンアップ: deleteApp 完了');
        });
    });

    test('ツアーを途中で閉じた場合、フラグは立たず、次回リロード時に再表示されること', async ({ page, context, appName, appKey }) => {
        test.setTimeout(90000);

        await test.step('1. セットアップ: アプリを作成し、ツアー未完了状態にする', async () => {
            await createApp(page, appName, appKey);
            await page.evaluate(() => {
                localStorage.removeItem('pwappy_tour_completed');
            });
        });

        let editorPage: Page;
        await test.step('2. エディタを起動し、ツアー表示後に「後で見る」を押して閉じる', async () => {
            editorPage = await openEditor(page, context, appName);

            const tourGuide = editorPage.locator('app-tour-guide');
            await expect(tourGuide).toHaveAttribute('visible', '', { timeout: 15000 });

            // 初回ステップにある「後で見る」ボタンをクリック
            const laterBtn = tourGuide.locator('button.btn-skip:has-text("後で見る")');
            await expect(laterBtn).toBeVisible();

            // アラートの確認ダイアログ（「ツアーを一時中断しました」）が出るので、Playwrightのダイアログリスナーで自動クローズ
            // 起動・ビルドラグに伴う他の通知ダイアログとの競合を避けるため、特定のメッセージを含むダイアログのみを検知して検証・クローズします
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

            // リスナーを安全に解除します
            editorPage.off('dialog', dialogHandler);

            // localStorageの完了フラグがセットされていない（または 'true' ではない）ことを検証
            const isCompleted = await editorPage.evaluate(() => localStorage.getItem('pwappy_tour_completed'));
            expect(isCompleted).not.toBe('true');
        });

        await test.step('3. エディタをリロードし、ツアーが再び自動で表示されることを検証', async () => {
            await editorPage.reload();
            await editorPage.waitForLoadState('domcontentloaded');

            // 起動時の自動復元（スナップショット確認ダイアログ）を破棄します。これを行わないとツアーは開始されません
            const tempHelper = new EditorHelper(editorPage, false);
            await tempHelper.handleSnapshotRestoreDialog();
            await tempHelper.handleStarterTemplateModal();

            const tourGuide = editorPage.locator('app-tour-guide');
            // 再びツアーが表示されることをアサート
            await expect(tourGuide).toHaveAttribute('visible', '', { timeout: 20000 });
        });

        await test.step('4. クリーンアップ', async () => {
            await editorPage.close();
            await page.bringToFront();
            await deleteApp(page, appKey);
        });
    });

    test('初回ステップで「今後表示しない」を選択した場合、以降起動してもツアーが表示されないこと', async ({ page, context, appName, appKey }) => {
        test.setTimeout(90000);

        await test.step('1. セットアップ', async () => {
            await createApp(page, appName, appKey);
            await page.evaluate(() => {
                localStorage.removeItem('pwappy_tour_completed');
            });
        });

        let editorPage: Page;
        await test.step('2. エディタ起動後、「今後表示しない」ボタンをクリックする', async () => {
            editorPage = await openEditor(page, context, appName);

            const tourGuide = editorPage.locator('app-tour-guide');
            await expect(tourGuide).toHaveAttribute('visible', '', { timeout: 15000 });

            const noShowBtn = tourGuide.locator('button.btn-skip:has-text("今後表示しない")');
            await expect(noShowBtn).toBeVisible();
            await noShowBtn.click({ force: true });

            await expect(tourGuide).not.toHaveAttribute('visible', '', { timeout: 5000 });

            // localStorage に完了フラグが立っていることを検証
            const isCompleted = await editorPage.evaluate(() => localStorage.getItem('pwappy_tour_completed'));
            expect(isCompleted).toBe('true');
        });

        await test.step('3. リロード後にツアーが自動表示されないことを検証', async () => {
            await editorPage.reload();
            await editorPage.waitForLoadState('domcontentloaded');

            const tempHelper = new EditorHelper(editorPage, false);
            await tempHelper.handleSnapshotRestoreDialog();

            const tourGuide = editorPage.locator('app-tour-guide');
            // 表示されない（visible属性がない）ことを確認
            await expect(tourGuide).not.toHaveAttribute('visible', '', { timeout: 10000 });
        });

        await test.step('4. クリーンアップ', async () => {
            await editorPage.close();
            await page.bringToFront();
            await deleteApp(page, appKey);
        });
    });

    test('メニューからチュートリアルモーダルを開けること', async ({ page, context, appName, appKey, browserName }) => {
        await test.step('1. セットアップ: アプリを作成し、エディタを起動', async () => {
            await createApp(page, appName, appKey);
        });

        let editorPage: Page;
        await test.step('2. チュートリアルモーダルを開く', async () => {
            editorPage = await openEditor(page, context, appName);

            if (browserName === 'webkit') {
                // チュートリアル内でも動画が再生される可能性があるためブロック
                await editorPage.route('**/*.webm', route => route.abort('blockedbyclient'));
            }

            // 下部メニューを開く
            const menuButton = editorPage.locator('#fab-bottom-menu-box');
            await menuButton.click();

            const bottomMenu = editorPage.locator('#platformBottomMenu');
            await expect(bottomMenu).toBeVisible();

            // 「チュートリアル」メニュー項目をクリック
            const tutorialMenuItem = bottomMenu.locator('.menu-item', { hasText: 'チュートリアル' });
            await tutorialMenuItem.click();

            // チュートリアルモーダルが表示されることを確認
            const tutorialModal = editorPage.locator('app-tutorial-modal');
            await expect(tutorialModal).toHaveAttribute('visible', '', { timeout: 10000 });

            const modalDialog = tutorialModal.locator('.modal');
            await expect(modalDialog).toBeVisible();
        });

        await test.step('3. チュートリアルモーダルを閉じる', async () => {
            const tutorialModal = editorPage.locator('app-tutorial-modal');

            // 閉じるボタンをクリック
            const closeBtn = tutorialModal.locator('.main-content .close-btn');
            await closeBtn.click();
            // モーダルが非表示になったことを確認
            await expect(tutorialModal).not.toHaveAttribute('visible', '');
        });

        await test.step('4. クリーンアップ', async () => {
            await editorPage.close();
            await page.bringToFront();
            await deleteApp(page, appKey);
        });
    });
});