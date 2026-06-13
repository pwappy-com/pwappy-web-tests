import { test as base, expect, Page } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor } from '../../tools/dashboard-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

const logTime = (msg: string) => {
    const now = new Date();
    console.log(`[TourTest:Time] ${now.toISOString()} - ${msg}`);
};

type TourFixtures = {
    appName: string;
    appKey: string;
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
            if (browserName === 'webkit') {
                await editorPage.evaluate(async () => {
                    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
                    for (let i = 0; i < 15; i++) {
                        const tourGuide = document.querySelector('app-tour-guide');
                        if (!tourGuide) break;
                        const root = tourGuide.shadowRoot || tourGuide;
                        const nextBtn = root.querySelector('.btn-next') as HTMLButtonElement | null;
                        if (!nextBtn || window.getComputedStyle(nextBtn).display === 'none') break;

                        const btnText = nextBtn.innerText || '';
                        nextBtn.click();
                        await delay(800);
                        if (btnText.includes('完了')) break;
                    }
                });
            } else {
                const tourGuide = editorPage.locator('app-tour-guide');
                const nextBtn = tourGuide.locator('.btn-next');

                for (let i = 0; i < 15; i++) {
                    const count = await nextBtn.count();
                    if (count === 0) break;

                    try {
                        const btnText = await nextBtn.innerText({ timeout: 5000 });
                        await nextBtn.click({ timeout: 5000 });
                        await editorPage.waitForTimeout(600);

                        if (btnText.includes('完了')) {
                            break;
                        }
                    } catch (e: any) {
                        throw e;
                    }
                }
            }

            const tourGuide = editorPage.locator('app-tour-guide');
            await expect(tourGuide).not.toHaveAttribute('visible', '', { timeout: 15000 });

            // ツアー完了後に localStorage にフラグがセットされたか確認
            const isCompleted = await editorPage.evaluate(() => localStorage.getItem('pwappy_tour_completed'));
            expect(isCompleted).toBe('true');
        });

        await test.step('4. クリーンアップ', async () => {
            try { await editorPage.evaluate(() => window.stop()); } catch (e) { }
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
            try { await editorPage.evaluate(() => window.stop()); } catch (e) { }
            await editorPage.close();
            await page.bringToFront();
            await deleteApp(page, appKey);
        });
    });
});