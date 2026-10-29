import { startStylePhase } from './style-phase-profile.mjs';
import { expect, Page, BrowserContext } from '@playwright/test';

/**
 * 新しいタブを開く操作を安全に実行する共通関数。
 * WebKit特有の `window.open` によるクラッシュを回避するワークアラウンドを含みます。
 * 将来WebKitのバグが修正された際は、この関数の中の if (browserName === 'webkit') の分岐を削除するだけで、
 * プロジェクト全体が本来の挙動（本道）に戻ります。
 * 
 * @param page 現在のPageオブジェクト
 * @param context 現在のBrowserContext
 * @param action クリックなどの「新しいタブを開くトリガー」となる非同期処理
 * @returns 新しく開かれたPageオブジェクト
 */
export async function clickAndOpenNewTabSafely(page: Page, context: BrowserContext, action: () => Promise<void>): Promise<Page> {
    const browserName = context.browser()?.browserType().name();
    let newPage: Page | undefined;

    if (browserName === 'webkit') {
        const popupTargetDone = startStylePhase('webkit-popup-target');
        // =========================================================================
        // 【ワークアラウンド】WebKit環境の window.open クラッシュバグ回避
        // =========================================================================
        console.warn(`[Workaround] WebKit環境の window.open クラッシュバグを回避するため、URLをインターセプトします。`);
        await page.evaluate(() => {
            (window as any)._interceptedUrl = null;
            if (!(window as any)._isMockedForWebkit) {
                (window as any)._isMockedForWebkit = true;
                window.open = function (...args) {
                    (window as any)._interceptedUrl = args[0];
                    return null; // クラッシュする本来の呼び出しを防ぐ
                };
            }
        });

        let urlString: string | null = null;
        await expect(async () => {
            await page.evaluate(() => { (window as any)._interceptedUrl = null; });
            await action();

            // timeoutは第3引数。第2引数はブラウザ内の関数に渡すarg。
            const targetUrlHandle = await page.waitForFunction(() => {
                return (window as any)._interceptedUrl;
            }, undefined, { timeout: 10000 });
            try {
                urlString = await targetUrlHandle.jsonValue() as string;
                expect(urlString, 'window.openの遷移先URL').toBeTruthy();
            } finally {
                await targetUrlHandle.dispose();
            }
        }).toPass({ timeout: 30000, intervals: [2000] });
        popupTargetDone();

        // URL取得後はタブを一度だけ作る。遷移の失敗でタブを増殖させない。
        const pageCreateDone = startStylePhase('webkit-page-create');
        const spawnedPage = await context.newPage();
        pageCreateDone();
        try {
            const absoluteUrl = new URL(urlString!, page.url()).toString();
            const pageNavigateDone = startStylePhase('webkit-page-navigate');
            await spawnedPage.goto(absoluteUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            pageNavigateDone();
            newPage = spawnedPage;
        } catch (error) {
            await spawnedPage.close().catch(() => { });
            throw error;
        }

    } else {
        const nativePopupDone = startStylePhase('native-popup');
        // =========================================================================
        // 【本道の処理】 (Chromium 等の正常なブラウザ向け)
        // =========================================================================
        await expect(async () => {
            const pagePromise = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
            await action();
            const spawnedPage = await pagePromise;
            if (!spawnedPage) throw new Error('新しいタブが開かれませんでした。');
            newPage = spawnedPage;
        }).toPass({ timeout: 30000, intervals: [2000] });
        nativePopupDone();
    }

    if (!newPage) throw new Error('新規タブのオープンに失敗しました。');
    return newPage;
}