import { expect, type Page, type BrowserContext } from '@playwright/test';
import { EditorHelper } from './editor-helpers';

/**
 * アプリケーションがリストに表示されているか/いないかを確認します。
 */
export async function expectAppVisibility(page: Page, appKey: string, isVisible: boolean): Promise<void> {
    await expect(async () => {
        const appKeyCell = page.locator('.app-card .app-key', { hasText: appKey }).first();
        if (isVisible) {
            await expect(appKeyCell).toBeVisible({ timeout: 2000 });
        } else {
            await expect(appKeyCell).toBeHidden({ timeout: 2000 });
        }
    }).toPass({ timeout: 30000, intervals: [1000] });
}

/**
 * ダッシュボード画面で新しいアプリケーションを正常に作成します。
 */
export async function createApp(page: Page, appName: string, appKey: string): Promise<void> {
    const appModal = page.locator('dashboard-modal-window#appModal');
    await expect(async () => {
        if (await appModal.locator('span[slot="header-title"]').isVisible().catch(() => false)) return;
        const addBtn = page.getByRole('button', { name: '+ 新規作成' });
        await addBtn.click({ force: true, timeout: 2000 });
        await expect(appModal.locator('span[slot="header-title"]')).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 20000, intervals: [1000] });

    await page.waitForTimeout(500);

    const appNameInput = page.locator('#input-app-name');
    await expect(appNameInput).toBeEditable({ timeout: 10000 });
    await appNameInput.fill(appName);

    const appKeyInput = page.locator('#input-app-key');
    await appKeyInput.fill(appKey);

    await expect(async () => {
        const alert = page.locator('alert-component');
        if (await alert.isVisible().catch(() => false)) {
            await alert.getByRole('button', { name: '閉じる' }).click({ force: true }).catch(() => { });
        }
        // スロット要素のポインターインターセプトを回避するため force: true
        await appModal.locator('.submit-button').click({ force: true, timeout: 2000 });
    }).toPass({ timeout: 15000, intervals: [1000] });

    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
    await expect(appModal).toBeHidden();

    await page.waitForTimeout(500);

    // 新規作成後は自動的に選択状態になるはずなので、バージョンセクションを待機
    await expect(page.locator('dashboard-app-detail')).toBeVisible({ timeout: 15000 });
}

/**
 * ダッシュボード画面で指定されたアプリケーションを正常に削除します。
 */
/**
 * ダッシュボード画面で指定されたアプリケーションを正常に削除します。
 * クリーンアップスクリプトと同じ「アプリ設定」からの削除フローを使用します。
 */
export async function deleteApp(page: Page, appKey: string): Promise<void> {
    console.log(`[DEBUG] deleteApp開始: ${appKey}`);
    await page.bringToFront();

    // 1. 確実にダッシュボード（ワークベンチ）を表示
    await gotoDashboard(page);

    // 2. アプリカードを特定
    const appRow = page.locator('.app-card', { has: page.locator('.app-key', { hasText: appKey }) }).first();

    // アプリが存在しない場合は何もしない
    if (await appRow.count() === 0) {
        console.log(`[DEBUG] deleteApp: アプリ (${appKey}) が見つからないため終了します。`);
        return;
    }

    // 3. アプリカードをクリックして詳細画面（バージョン管理）を開く
    await appRow.click({ force: true });

    // 4. 詳細画面が表示されるのを待機（アクティブなタブが表示されるまで）
    await expect(page.locator('.detail-tab.active')).toBeVisible({ timeout: 10000 });

    await page.waitForTimeout(500);

    // 5. 「アプリ設定」タブをクリック
    await page.getByText('アプリ設定').click();

    await page.waitForTimeout(500);

    // 6. 「削除する」ボタンが有効になるのを待ってクリック
    const deleteButton = page.getByRole('button', { name: '削除する' });
    await expect(deleteButton).toBeEnabled({ timeout: 10000 });
    await deleteButton.click({ force: true });

    await page.waitForTimeout(500);

    // 7. 確認ダイアログ（設定画面からの削除用ID: #delete-confirm-general）を処理
    const confirmDialog = page.locator('message-box#delete-confirm-general');
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });
    await confirmDialog.locator('.confirm-ok-button').click({ force: true });

    // 8. 削除処理（「処理中...」の表示とオーバーレイ）が消えるのを待機
    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
    const loadingOverlay = page.locator('dashboard-loading-overlay');
    await expect(loadingOverlay).toBeHidden({ timeout: 10000 });

    console.log(`[DEBUG] deleteApp完了: ${appKey}`);
}

export async function openEditor(page: Page, context: BrowserContext, appName: string, version: string = '1.0.0'): Promise<Page> {
    const versionRow = page.locator('.version-card', { hasText: version }).first();
    await expect(versionRow).toBeVisible({ timeout: 10000 });

    const editorBtn = versionRow.getByRole('button', { name: /エディタ/ });
    await expect(editorBtn).toBeVisible({ timeout: 5000 });

    let editorPage: Page | undefined;
    await expect(async () => {
        const editorPagePromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
        await editorBtn.click({ force: true }).catch(async () => {
            await editorBtn.evaluate((el: HTMLElement) => el.click()).catch(() => { });
        });

        const newPage = await editorPagePromise;
        if (!newPage) throw new Error('エディタの新しいタブが開かれませんでした。');
        editorPage = newPage;
    }).toPass({ timeout: 30000, intervals: [2000] });

    if (!editorPage) throw new Error('エディタのオープンに失敗しました。');

    await editorPage.waitForLoadState('domcontentloaded');
    const tempHelper = new EditorHelper(editorPage, false);
    await tempHelper.handleSnapshotRestoreDialog();

    await expect(editorPage.locator('ios-component')).toBeVisible();
    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
    return editorPage;
}

export async function publishVersion(page: Page, appName: string, version: string): Promise<void> {
    let versionRow = page.locator('.version-card', { hasText: version });
    const prepBtn = versionRow.getByRole('button', { name: '審査に提出' });
    await prepBtn.evaluate((el: HTMLElement) => el.click()).catch(() => prepBtn.click({ force: true }));

    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
    let confirmDialog = page.locator('message-box#publish-action-confirm');
    await expect(confirmDialog).toBeVisible();

    const applyBtn = confirmDialog.getByRole('button', { name: '申請する' });
    await applyBtn.evaluate((el: HTMLElement) => el.click()).catch(() => applyBtn.click({ force: true }));
    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });

    await waitForVersionStatus(page, appName, version, '準備完了');

    versionRow = page.locator('.version-card', { hasText: version });
    const pubBtn = versionRow.getByRole('button', { name: '公開する' });
    await pubBtn.evaluate((el: HTMLElement) => el.click()).catch(() => pubBtn.click({ force: true }));

    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
    confirmDialog = page.locator('message-box#publish-action-confirm');
    await expect(confirmDialog).toBeVisible();

    const finalPubBtn = confirmDialog.getByRole('button', { name: '公開する' });
    await finalPubBtn.evaluate((el: HTMLElement) => el.click()).catch(() => finalPubBtn.click({ force: true }));
    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
}

export async function unpublishVersion(page: Page, appName: string, version: string): Promise<void> {
    const versionRow = page.locator('.version-card', { hasText: version });
    const unpubBtn = versionRow.getByRole('button', { name: /非公開/ });
    await unpubBtn.evaluate((el: HTMLElement) => el.click()).catch(() => unpubBtn.click({ force: true }));

    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
    const confirmDialog = page.locator('message-box#publish-action-confirm');
    await expect(confirmDialog).toBeVisible();

    const finalUnpubBtn = confirmDialog.getByRole('button', { name: /非公開にする|公開停止/ });
    await finalUnpubBtn.evaluate((el: HTMLElement) => el.click()).catch(() => finalUnpubBtn.click({ force: true }));
    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
}

export async function startPublishPreparation(page: Page, appName: string, version: string): Promise<void> {
    const versionRow = page.locator('.version-card', { hasText: version });
    const prepBtn = versionRow.getByRole('button', { name: '審査申請' });
    await prepBtn.click();

    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });

    const confirmDialog = page.locator('message-box#publish-action-confirm');
    await expect(confirmDialog).toBeVisible();

    const applyBtn = confirmDialog.getByRole('button', { name: '申請する' });
    await applyBtn.click();

    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
    await expect(page.locator('dashboard-loading-overlay')).toBeHidden({ timeout: 150000 });
}

export async function completePublication(page: Page, appName: string, version: string): Promise<void> {
    await waitForVersionStatus(page, appName, version, '準備完了');

    const readyVersionRow = page.locator('.version-card', { hasText: version });
    const pubBtn = readyVersionRow.getByRole('button', { name: '公開する' });
    await pubBtn.click();

    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });

    const publishConfirmDialog = page.locator('message-box#publish-action-confirm');
    await expect(publishConfirmDialog).toBeVisible();

    const confirmBtn = publishConfirmDialog.getByRole('button', { name: '公開する' });
    await confirmBtn.click();

    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
    await expect(page.locator('dashboard-loading-overlay')).toBeHidden({ timeout: 150000 });
}

export async function expectVersionStatus(page: Page, version: string, statusText: string): Promise<void> {
    const versionRow = page.locator('.version-card', { hasText: version });
    await expect(versionRow.locator('.badge')).toContainText(statusText);
}

export async function downloadVersion(page: Page, { appName, appKey, version }: { appName: string, appKey: string, version: string }): Promise<void> {
    const versionRow = page.locator('.version-card', { hasText: version });

    const dlBtn = versionRow.getByTitle('DL (10PP)');
    await dlBtn.click();

    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });

    const confirmDialog = page.locator('message-box#download-confirm');
    await expect(confirmDialog).toBeVisible();

    const confirmDlBtn = confirmDialog.getByRole('button', { name: 'ダウンロード' });
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        confirmDlBtn.evaluate((el: HTMLElement) => el.click()).catch(() => confirmDlBtn.click({ force: true })),
    ]);

    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });

    const expectedVersionInFilename = version.replace(/\./g, '_');
    const expectedBaseFilename = `${appKey.replace(/\./g, '_')}_${expectedVersionInFilename}`;
    const suggestedFilename = download.suggestedFilename();
    expect(suggestedFilename).toContain(expectedBaseFilename);
    expect(suggestedFilename).toContain('.zip');
}

export async function expectVersionVisibility(page: Page, version: string, isVisible: boolean): Promise<void> {
    await expect(async () => {
        const versionCell = page.locator('.version-card .v-version').filter({ hasText: version }).first();
        if (isVisible) {
            await expect(versionCell).toBeVisible({ timeout: 2000 });
            await expect(versionCell).toContainText(version);
        } else {
            await expect(versionCell).toBeHidden({ timeout: 2000 });
        }
    }).toPass({ timeout: 30000, intervals: [1000] });
}

export async function addVersion(page: Page, versionName: string): Promise<void> {
    await expect(async () => {
        const alert = page.locator('alert-component');
        if (await alert.isVisible().catch(() => false)) {
            await alert.getByRole('button', { name: '閉じる' }).evaluate((el: HTMLElement) => el.click()).catch(() => { });
        }

        const addBtn = page.getByRole('button', { name: '+ 新規バージョン' })
        await addBtn.click();

        page.waitForTimeout(500);

        const modal = page.locator('dashboard-modal-window#versionModal');
        await expect(modal.locator('span[slot="header-title"]')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000, intervals: [1000] });

    const modal = page.locator('dashboard-modal-window#versionModal');
    await modal.locator('#input-version').fill(versionName);

    await expect(async () => {
        const alert = page.locator('alert-component');
        if (await alert.isVisible().catch(() => false)) {
            await alert.getByRole('button', { name: '閉じる' }).evaluate((el: HTMLElement) => el.click()).catch(() => { });
        }
        // force: true でスロット傍受を回避
        await modal.locator('.submit-button').click({ force: true, timeout: 2000 });
    }).toPass({ timeout: 15000, intervals: [1000] });

    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
    await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
    await expect(modal).toBeHidden();
}

export async function setupAppWithVersions(page: Page, { appName, appKey, versions }: { appName: string, appKey: string, versions: string[] }): Promise<void> {
    await createApp(page, appName, appKey);

    const alert = page.locator('alert-component');
    if (await alert.isVisible().catch(() => false)) {
        await alert.getByRole('button', { name: '閉じる' }).evaluate((el: HTMLElement) => el.click()).catch(() => { });
        await expect(alert).toBeHidden();
    }

    const additionalVersions = versions.filter(v => v !== '1.0.0');
    for (const version of additionalVersions) {
        await addVersion(page, version);
    }

    for (const version of versions) {
        await expectVersionVisibility(page, version, true);
    }
}

export async function editVersion(page: Page, oldVersion: string, newVersion: string): Promise<void> {
    const versionRow = page.locator('.version-card', { hasText: oldVersion });
    const editBtn = versionRow.getByTitle('名前変更');
    await editBtn.click();

    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
    await expect(page.locator('dashboard-loading-overlay')).toBeHidden();

    const modal = page.locator('dashboard-modal-window#versionModal');
    await expect(modal.locator('span[slot="header-title"]')).toBeVisible();

    await page.waitForTimeout(500);

    await modal.locator('#input-version').fill(newVersion);
    await modal.locator('.submit-button').evaluate((el: HTMLElement) => el.click()).catch(() => modal.locator('.submit-button').click({ force: true }));

    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
    await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
}

export async function duplicateVersion(page: Page, sourceVersion: string): Promise<void> {
    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
    await expect(page.locator('dashboard-loading-overlay')).toBeHidden();

    await expect(async () => {
        const alert = page.locator('alert-component');
        if (await alert.isVisible().catch(() => false)) {
            await alert.getByRole('button', { name: '閉じる' }).evaluate((el: HTMLElement) => el.click()).catch(() => { });
        }
        const versionRow = page.locator('.version-card', { hasText: sourceVersion }).first();
        const dupButton = versionRow.getByTitle('複製');

        await dupButton.click();
    }).toPass({ timeout: 15000, intervals: [1000] });

    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
    await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
}

export async function deleteVersion(page: Page, versionToDelete: string): Promise<void> {
    const versionRow = page.locator('.version-card', { hasText: versionToDelete });
    const delBtn = versionRow.getByRole('button', { name: '' });

    await delBtn.click();

    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });

    await page.waitForTimeout(500);

    const confirmDialog = page.locator('message-box#delete-confirm-general');
    await expect(confirmDialog).toBeVisible();

    const confirmDelBtn = confirmDialog.getByRole('button', { name: '削除する' });
    await confirmDelBtn.click();

    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
    await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
}

export async function getCurrentPoints(page: Page): Promise<number> {
    const pointTextLocator = page.locator('p.pp-point-text');
    await expect(pointTextLocator).toBeVisible();
    const textContent = await pointTextLocator.textContent();
    if (textContent === null) throw new Error('ポイントのテキストコンテンツが取得できませんでした。');
    const pointString = textContent.replace(/,/g, '').replace(/PP/i, '').trim();
    const points = parseInt(pointString, 10);
    if (isNaN(points)) throw new Error(`ポイントの数値変換に失敗しました。取得した文字列: "${textContent}"`);
    return points;
}

export async function navigateToSettings(page: Page): Promise<void> {
    await expect(page.locator('dashboard-loading-overlay')).toBeHidden({ timeout: 10000 }).catch(() => { });
    const alert = page.locator('alert-component');
    if (await alert.isVisible().catch(() => false)) {
        await alert.getByRole('button', { name: '閉じる' }).evaluate((el: HTMLElement) => el.click()).catch(() => { });
        await expect(alert).toBeHidden({ timeout: 2000 }).catch(() => { });
    }

    const menuBtn = page.locator('button.menu-button[title="メニュー"]');
    await menuBtn.evaluate((el: HTMLElement) => el.click()).catch(() => menuBtn.click({ force: true }));

    const menuList = page.locator('#appMenuList');
    await expect(menuList).toBeVisible();

    const settingItem = menuList.locator('.dashboard-menu-item', { hasText: '設定' });
    await settingItem.evaluate((el: HTMLElement) => el.click()).catch(() => settingItem.click({ force: true }));

    const settingsContent = page.locator('.setting-content');
    await expect(settingsContent).toBeVisible();
    await expect(settingsContent.getByText('AI機能を有効にする')).toBeVisible();
}

export async function setAiCoding(page: Page, enable: boolean): Promise<void> {
    await navigateToSettings(page);
    await page.waitForTimeout(500);

    const checkbox = page.locator('#aiCodingCheckbox');
    const isCurrentlyEnabled = await checkbox.isChecked();

    if (isCurrentlyEnabled === enable) {
        await closeSettings(page);
        return;
    }

    const label = page.locator('label.switch').filter({ has: page.locator('#aiCodingCheckbox') });
    await label.evaluate((el: HTMLElement) => el.click()).catch(() => label.click({ force: true }));

    if (enable) {
        const parentModal = page.locator('#aiCodingConfirmModal');
        try {
            await expect(parentModal.locator('.modal')).toBeVisible({ timeout: 3000 });
            const submitBtn = parentModal.locator('span[slot="submit-button-text"]');
            await submitBtn.evaluate((el: HTMLElement) => el.click()).catch(() => submitBtn.click({ force: true }));
            await expect(parentModal).toBeHidden({ timeout: 5000 });
        } catch (e) { }
    }

    if (enable) {
        await expect(checkbox).toBeChecked({ timeout: 5000 });
    } else {
        await expect(checkbox).not.toBeChecked({ timeout: 5000 });
    }

    await page.waitForTimeout(1000);
    await closeSettings(page);
}

export async function closeSettings(page: Page): Promise<void> {
    const accountSetting = page.locator('dashboard-account-setting');
    await expect(async () => {
        const alert = page.locator('alert-component');
        if (await alert.isVisible().catch(() => false)) {
            await alert.getByRole('button', { name: '閉じる' }).evaluate((el: HTMLElement) => el.click()).catch(() => { });
            await page.waitForTimeout(300);
        }
        await accountSetting.click({ position: { x: 10, y: 10 }, force: true });
        if (await page.locator('.setting-content').isVisible().catch(() => false)) {
            await page.mouse.click(0, 0);
        }
        await expect(page.locator('.setting-content')).toBeHidden({ timeout: 2000 });
    }).toPass({ timeout: 10000, intervals: [1000] });
}

export async function setGeminiApiKey(page: Page, apiKey: string): Promise<void> {
    await navigateToSettings(page);
    const apiKeyForm = page.locator('.api-key-form');
    if (!(await apiKeyForm.isVisible())) {
        await closeSettings(page);
        return;
    }

    await apiKeyForm.locator('input#gemini-api-key').fill(apiKey);
    const saveBtn = apiKeyForm.locator('button.save-api-key-button');
    await saveBtn.evaluate((el: HTMLElement) => el.click()).catch(() => saveBtn.click({ force: true }));

    const successAlert = page.locator('.alert', { hasText: 'APIキーを登録しました。' });
    await expect(successAlert).toBeVisible();
    const closeBtn = successAlert.locator('button#closeButton');
    await closeBtn.evaluate((el: HTMLElement) => el.click()).catch(() => closeBtn.click({ force: true }));
    await expect(successAlert).toBeHidden();

    const registeredDisplay = page.locator('.api-key-display');
    await expect(registeredDisplay).toBeVisible();
    await expect(registeredDisplay.getByText('APIキーは登録済みです。')).toBeVisible();

    await closeSettings(page);
}

export async function deleteGeminiApiKey(page: Page): Promise<void> {
    await navigateToSettings(page);
    const registeredDisplay = page.locator('.api-key-display');
    if (!(await registeredDisplay.isVisible())) {
        await closeSettings(page);
        return;
    }

    page.once('dialog', async dialog => {
        expect(dialog.message()).toBe('登録されているAPIキーを本当に削除しますか？');
        await dialog.accept();
    });

    const delBtn = registeredDisplay.locator('button.delete-api-key-button');
    await delBtn.evaluate((el: HTMLElement) => el.click()).catch(() => delBtn.click({ force: true }));

    const deleteAlert = page.locator('.alert', { hasText: 'APIキーを削除しました。' });
    await expect(deleteAlert).toBeVisible();
    const closeBtn = deleteAlert.locator('button#closeButton');
    await closeBtn.evaluate((el: HTMLElement) => el.click()).catch(() => closeBtn.click({ force: true }));
    await expect(deleteAlert).toBeHidden();

    const apiKeyForm = page.locator('.api-key-form');
    await expect(apiKeyForm.locator('input#gemini-api-key')).toBeVisible();

    await closeSettings(page);
}

export async function waitForVersionStatus(
    page: Page,
    appName: string,
    version: string,
    expectedStatus: string,
    options: { timeout?: number; intervals?: number[] } = {}
): Promise<void> {
    const { timeout = 150000, intervals = [10000, 20000, 30000] } = options;

    await expect(async () => {
        const versionRow = page.locator('.version-card', { hasText: version });
        const statusCell = versionRow.locator('.badge');
        await expect(statusCell).toContainText(expectedStatus, { timeout: 5000 });
    }).toPass({ timeout: timeout, intervals: intervals });
}

export async function gotoDashboard(page: Page): Promise<void> {
    const dashboardInitPromise = page.waitForResponse(response =>
        response.url().includes('dashboard-init') && response.status() === 200,
        { timeout: 15000 }
    ).catch(() => { });

    await page.goto(String(process.env.PWAPPY_TEST_BASE_URL), { waitUntil: 'domcontentloaded' });

    // 1. まず通信の完了を待つ
    await dashboardInitPromise;

    // 2. ローディングオーバーレイが表示された場合、それが消えるのを待つ
    // z-index 3000 で前面を覆っているため、これがある間は何も操作できない
    const loadingOverlay = page.locator('dashboard-loading-overlay');
    await expect(loadingOverlay).toBeHidden({ timeout: 30000 }).catch(() => {
        console.log('[DEBUG] Loading overlay timeout or already hidden.');
    });

    // 3. Litのレンダリング安定化のための微小待機
    await page.waitForTimeout(500);
}

export async function reloadDashboard(page: Page): Promise<void> {
    const dashboardInitPromise = page.waitForResponse(response =>
        response.url().includes('dashboard-init') && response.status() === 200,
        { timeout: 10000 }
    ).catch(() => { });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await dashboardInitPromise;
}