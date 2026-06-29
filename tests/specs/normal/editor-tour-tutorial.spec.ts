import { test as base, expect, Page, Dialog } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';
import { STORAGE_STATE } from '../../constants';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

const logTime = (msg: string) => {
    const now = new Date();
    console.log(`[TourTest:Time] ${now.toISOString()} - ${msg}`);
};

let appName: string;
let appKey: string;

type TourFixtures = {
    editorHelper: EditorHelper;
};

const test = base.extend<TourFixtures>({
    editorHelper: async ({ }, use) => {
        await use(null as any);
    }
});

// テスト全体の開始前に、アプリを1回だけ作成する
test.beforeAll(async ({ browser }) => {
    const reversedTimestamp = Date.now().toString().split('').reverse().join('');
    const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
    appName = `tour-test-${uniqueId}`.slice(0, 30);
    appKey = `tour-key-${uniqueId}`.slice(0, 30);

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