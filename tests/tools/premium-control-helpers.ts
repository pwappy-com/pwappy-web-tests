import { expect, type Locator, type Page } from '@playwright/test';

// Native range inputs may serialize 0.0 as 0. Compare the persisted numeric value.
export async function expectNativeRangeValue(range: Locator, expected: number): Promise<void> {
    await expect.poll(() => range.evaluate((el: HTMLInputElement) => el.valueAsNumber)).toBe(expected);
}

// A confirmation can animate after becoming visible. Keep native actionability checks
// and never replay the restore mutation after its confirmation has been submitted.
export async function confirmArchiveRestore(page: Page, archiveRow: Locator): Promise<void> {
    await archiveRow.getByRole('button', { name: /復元/ }).click({ timeout: 2000 });
    const confirmDialog = page.locator('message-box#restore-confirm');
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });
    await confirmDialog.locator('.confirm-restore-button, .confirm-ok-button').click({ timeout: 2000 });
    await expect(confirmDialog).toBeHidden({ timeout: 5000 });
}
