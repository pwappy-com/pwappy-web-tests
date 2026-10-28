import { test, expect } from '@playwright/test';
import { expectNativeRangeValue, confirmArchiveRestore, archivePublishedAppOnce, openArchiveView, logArchiveViewState } from '../tests/tools/premium-control-helpers';

for (const input of ['0.0', '0.1', '0.7', '1.0', '1.9', '2.0']) {
    test('native range retains numeric meaning for ' + input, async ({ page }) => {
        await page.setContent('<input type="range" min="0.0" max="2.0" step="0.1">');
        const range = page.locator('input');
        await range.evaluate((el: HTMLInputElement, value) => { el.value = value; }, input);
        await expectNativeRangeValue(range, Number(input));
        // A genuinely different persisted numeric value must still fail.
        let rejected = false;
        try { await expectNativeRangeValue(range, Number(input) === 0 ? 0.1 : 0); }
        catch { rejected = true; }
        expect(rejected).toBe(true);
    });
}

// Synthetic animation/actionability proof, not copied app source or a hosted-failure replay.
const confirmationFixture = (disabled = false) => `<!doctype html>
<style>
message-box { position:fixed; inset:0; background:#ddd8; }
message-box[hidden], alert-component[hidden] { display:none; }
.panel { position:absolute; top:50%; left:40%; padding:24px; background:white;
    animation:settle .25s linear forwards; }
@keyframes settle { from { transform:translateY(-150px); } to { transform:translateY(0); } }
</style>
<div class="app-card"><button id="restore">復元</button></div>
<message-box id="restore-confirm" hidden><div class="panel">
<button class="confirm-restore-button" ${disabled ? 'disabled' : ''}>復元</button>
<button id="cancel">キャンセル</button></div></message-box>
<alert-component hidden>復元しました</alert-component>
<script>
window.counts = { confirm:0, cancel:0 };
const dialog = document.querySelector('message-box');
document.querySelector('#restore').onclick = () => { dialog.hidden = false; };
document.querySelector('.confirm-restore-button').onclick = event => {
    event.stopPropagation(); window.counts.confirm++; dialog.hidden = true;
    document.querySelector('alert-component').hidden = false;
};
const cancel = () => { window.counts.cancel++; dialog.hidden = true; };
document.querySelector('#cancel').onclick = cancel;
dialog.onclick = event => { if (event.target === dialog) cancel(); };
</script>`;

test('animated native restore confirms exactly once without backdrop cancellation', async ({ page }) => {
    await page.setContent(confirmationFixture());
    await confirmArchiveRestore(page, page.locator('.app-card'));
    await expect(page.locator('alert-component')).toBeVisible();
    await expect(page.locator('alert-component')).toContainText('復元しました');
    expect(await page.evaluate(() => (window as any).counts)).toEqual({ confirm: 1, cancel: 0 });
});

test('disabled native confirmation fails closed without mutation or cancellation', async ({ page }) => {
    await page.setContent(confirmationFixture(true));
    let rejected = false;
    try { await confirmArchiveRestore(page, page.locator('.app-card')); } catch { rejected = true; }
    expect(rejected).toBe(true);
    expect(await page.evaluate(() => (window as any).counts)).toEqual({ confirm: 0, cancel: 0 });
    await expect(page.locator('alert-component')).toBeHidden();
    await expect(page.locator('message-box#restore-confirm')).toBeVisible();
});

// Generic fixture only: no private component source, account, or hosted service.
const archiveNavigationFixture = (success = true) => `<!doctype html>
<style>
[hidden] { display:none !important; }
message-box, alert-component, dashboard-loading-overlay { position:fixed; inset:0; z-index:10; background:#ddd; padding:40px; }
dashboard-loading-overlay { z-index:20; }
dashboard-app-content, dashboard-archive-content { display:block; padding:24px; }
</style>
<div id="detail"><button id="settings">アプリ設定</button>
<button id="archive-action" hidden> アーカイブする</button></div>
<message-box id="archive-confirm" hidden><button id="confirm">アーカイブ</button></message-box>
<alert-component><p id="message">先行操作が完了しました</p><button id="close">閉じる</button></alert-component>
<script>
window.counts = { priorClose:0, archive:0, successClose:0, navigation:0, overlay:0 };
let archived = false;
const alert = document.querySelector('alert-component');
const confirm = document.querySelector('message-box');
document.querySelector('#settings').onclick = () => document.querySelector('#archive-action').hidden = false;
document.querySelector('#archive-action').onclick = () => confirm.hidden = false;
document.querySelector('#confirm').onclick = () => {
    window.counts.archive++; archived = true; confirm.hidden = true;
    document.querySelector('#message').textContent = ${JSON.stringify(success ? 'アプリ「sample」をアーカイブしました' : 'アーカイブ中にエラーが発生しました')};
    alert.hidden = false;
};
document.querySelector('#close').onclick = () => {
    alert.hidden = true;
    if (!archived) { window.counts.priorClose++; return; }
    window.counts.successClose++;
    document.querySelector('#detail').remove();
    const home = document.createElement('dashboard-app-content');
    const button = document.createElement('button'); button.textContent = ' アーカイブ';
    button.onclick = () => {
        window.counts.navigation++; home.remove();
        const archive = document.createElement('dashboard-archive-content');
        archive.innerHTML = '<h1>アーカイブ一覧</h1><div class="app-card"><span class="app-key">sample-key</span><dashboard-app-menu-group>Menu</dashboard-app-menu-group></div>';
        document.body.append(archive);
    };
    home.append(button); document.body.append(home);
    const overlay = document.createElement('dashboard-loading-overlay');
    overlay.onclick = () => window.counts.overlay++;
    document.body.append(overlay);
};
window.releaseOverlay = () => document.querySelector('dashboard-loading-overlay').remove();
</script>`;

test('native archive navigation waits beyond 2s for overlay readiness without its own action cap', async ({ page }) => {
    await page.setContent(archiveNavigationFixture());
    await archivePublishedAppOnce(page);
    await expect(page.locator('dashboard-loading-overlay')).toBeVisible();
    // Start native input while blocked, then release after more than the removed 2s cap.
    // Only this synthetic fixture schedules a delay; the helper inherits the test budget.
    const started = performance.now();
    const navigation = openArchiveView(page).then(() => null, error => error);
    await page.evaluate(() => setTimeout(() => (window as any).releaseOverlay(), 2500));
    expect(await navigation).toBeNull();
    expect(performance.now() - started).toBeGreaterThanOrEqual(2000);
    const card = page.locator('.app-card', { has: page.locator('.app-key', { hasText: 'sample-key' }) });
    await expect(card).toBeVisible();
    await expect(card.locator('dashboard-app-menu-group')).toBeVisible();
    expect(await page.evaluate(() => (window as any).counts)).toEqual({
        priorClose:1, archive:1, successClose:1, navigation:1, overlay:0,
    });
});

test('forced navigation under the same overlay misses the target deterministically', async ({ page }) => {
    await page.setContent(archiveNavigationFixture());
    await archivePublishedAppOnce(page);
    await page.getByRole('button', { name: ' アーカイブ', exact: true }).click({ force: true });
    expect(await page.evaluate(() => (window as any).counts)).toEqual({
        priorClose:1, archive:1, successClose:1, navigation:0, overlay:1,
    });
    await expect(page.locator('dashboard-archive-content')).toHaveCount(0);
});

test('permanently blocked native navigation fails closed with safe state diagnostics', async ({ page }) => {
    await page.setContent(archiveNavigationFixture());
    await archivePublishedAppOnce(page);
    // The caller may explicitly bound an intentionally never-ready fixture.
    page.setDefaultTimeout(2000);
    let failure: unknown;
    try { await openArchiveView(page); } catch (error) { failure = error; }
    expect((failure as Error)?.name).toBe('TimeoutError');
    expect(await page.evaluate(() => (window as any).counts)).toEqual({
        priorClose:1, archive:1, successClose:1, navigation:0, overlay:0,
    });
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = message => logs.push(String(message));
    try { await logArchiveViewState(page); } finally { console.log = originalLog; }
    expect(logs).toEqual(['[ArchiveViewState] {"homeMounted":true,"archiveMounted":false,"archiveVisible":false,"loadingOverlayPresent":true,"alertVisible":false}']);
});

test('archive failure alert never closes, navigates, or repeats the mutation', async ({ page }) => {
    await page.setContent(archiveNavigationFixture(false));
    let failure: unknown;
    try { await archivePublishedAppOnce(page); } catch (error) { failure = error; }
    expect(failure).toBeTruthy();
    expect(await page.evaluate(() => (window as any).counts)).toEqual({
        priorClose:1, archive:1, successClose:0, navigation:0, overlay:0,
    });
    await expect(page.locator('alert-component')).toBeVisible();
    await expect(page.locator('dashboard-app-content')).toHaveCount(0);
});
