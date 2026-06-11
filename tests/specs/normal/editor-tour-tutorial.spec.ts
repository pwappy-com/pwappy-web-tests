import { test as base, expect, Page } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor } from '../../tools/dashboard-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

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
        test.setTimeout(60000);

        await test.step('1. セットアップ: アプリを作成し、ツアー未完了状態にする', async () => {
            await createApp(page, appName, appKey);

            // このテストのみ、ツアーを表示させるためにフラグを削除する
            await page.evaluate(() => {
                localStorage.removeItem('pwappy_tour_completed');
            });
        });

        let editorPage: Page;
        await test.step('2. エディタを起動し、ツアーが表示されることを確認', async () => {
            editorPage = await openEditor(page, context, appName);

            if (browserName === 'webkit') {
                await editorPage.route('**/*.webm', route => route.abort('blockedbyclient'));
            }

            const tourGuide = editorPage.locator('app-tour-guide');

            // visible属性が付与されて表示されるのを待機
            await expect(tourGuide).toHaveAttribute('visible', '', { timeout: 15000 });

            const dialog = tourGuide.locator('.dialog');
            await expect(dialog).toBeVisible();
            await expect(dialog.locator('.title')).toBeVisible();
        });

        await test.step('3. ツアーを進めて完了する', async () => {
            const tourGuide = editorPage.locator('app-tour-guide');
            const nextBtn = tourGuide.locator('.btn-next');

            // 「完了」ボタンに到達するまで「次へ」を押し続ける（安全のため最大15回）
            for (let i = 0; i < 15; i++) {
                const btnText = await nextBtn.innerText();

                // 【修正】Safari環境でのイベント伝播問題を回避するため、
                // JSネイティブのclick()を優先し、フォールバックとしてPlaywrightのclick()を実行
                await nextBtn.evaluate((el: HTMLElement) => el.click()).catch(async () => {
                    await nextBtn.click({ force: true });
                });

                await editorPage.waitForTimeout(600); // UIアニメーション待ち

                if (btnText.includes('完了')) {
                    break;
                }
            }

            // ツアーが非表示になったことを確認
            await expect(tourGuide).not.toHaveAttribute('visible', '', { timeout: 15000 });

            // ツアー完了後に localStorage にフラグがセットされたか確認
            const isCompleted = await editorPage.evaluate(() => localStorage.getItem('pwappy_tour_completed'));
            expect(isCompleted).toBe('true');
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
            await menuButton.evaluate((el: HTMLElement) => el.click()).catch(() => menuButton.click());

            const bottomMenu = editorPage.locator('#platformBottomMenu');
            await expect(bottomMenu).toBeVisible();

            // 「チュートリアル」メニュー項目をクリック
            const tutorialMenuItem = bottomMenu.locator('.menu-item', { hasText: 'チュートリアル' });
            await tutorialMenuItem.evaluate((el: HTMLElement) => el.click()).catch(() => tutorialMenuItem.click());

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
            await closeBtn.evaluate((el: HTMLElement) => el.click()).catch(() => closeBtn.click());

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