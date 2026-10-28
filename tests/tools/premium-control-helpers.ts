import { expect, type Locator, type Page } from '@playwright/test';

// Native range inputs may serialize 0.0 as 0. Compare the persisted numeric value.
export async function expectNativeRangeValue(range: Locator, expected: number): Promise<void> {
    await expect.poll(() => range.evaluate((el: HTMLInputElement) => el.valueAsNumber)).toBe(expected);
}

// Keep the published archive mutation single-shot within its former 20s retry budget.
export async function archivePublishedAppOnce(page: Page): Promise<void> {
    const deadline = performance.now() + 20000;
    const remaining = (limit: number): number => {
        const left = deadline - performance.now();
        if (left <= 0) throw new Error('Published archive action exceeded its 20s budget');
        return Math.min(limit, left);
    };
    const alert = page.locator('alert-component');
    if (await alert.isVisible()) {
        await alert.getByRole('button', { name: '閉じる', exact: true }).click({ timeout: remaining(2000) });
        await expect(alert).toBeHidden({ timeout: remaining(5000) });
    }

    await page.getByText('アプリ設定', { exact: true }).click({ timeout: remaining(2000) });
    await page.getByRole('button', { name: ' アーカイブする', exact: true }).click({ timeout: remaining(2000) });
    const confirmDialog = page.locator('message-box#archive-confirm');
    await expect(confirmDialog).toBeVisible({ timeout: remaining(5000) });
    await confirmDialog.getByRole('button', { name: 'アーカイブ', exact: true }).click({ timeout: remaining(2000) });

    // Disappearance alone is not completion: require the actual archive success alert.
    await expect(alert).toBeVisible({ timeout: remaining(5000) });
    await expect(alert).toContainText('をアーカイブしました', { timeout: remaining(5000) });
    await alert.getByRole('button', { name: '閉じる', exact: true }).click({ timeout: remaining(2000) });
    await expect(alert).toBeHidden({ timeout: remaining(5000) });
    await expect(confirmDialog).toBeHidden({ timeout: remaining(5000) });
}

// A remounted workbench may start loading after a previous hidden-overlay observation.
// Native hit-target checks must settle before the one navigation click is delivered.
export async function openArchiveView(page: Page): Promise<void> {
    await page.getByRole('button', { name: ' アーカイブ', exact: true }).click({ timeout: 2000 });
    const archive = page.locator('dashboard-archive-content');
    await expect(archive).toBeVisible({ timeout: 5000 });
    await expect(archive.getByRole('heading', { name: 'アーカイブ一覧', exact: true })).toBeVisible({ timeout: 5000 });
}

// Fixed booleans only: never emit page text, URLs, account identifiers, or request data.
export async function logArchiveViewState(page: Page): Promise<void> {
    try {
        const state = {
            homeMounted: (await page.locator('dashboard-app-content').count()) > 0,
            archiveMounted: (await page.locator('dashboard-archive-content').count()) > 0,
            archiveVisible: await page.locator('dashboard-archive-content').isVisible(),
            loadingOverlayPresent: (await page.locator('dashboard-loading-overlay').count()) > 0,
            alertVisible: await page.locator('alert-component').isVisible(),
        };
        console.log('[ArchiveViewState] ' + JSON.stringify(state));
    } catch {
        console.log('[ArchiveViewState] {"diagnosticUnavailable":true}');
    }
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
