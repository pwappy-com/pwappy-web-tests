import { test, expect } from '@playwright/test';
import { expectNativeRangeValue, confirmArchiveRestore } from '../tests/tools/premium-control-helpers';

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
