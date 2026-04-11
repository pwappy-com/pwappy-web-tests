import { expect, type Page, type BrowserContext } from '@playwright/test';
import { EditorHelper } from './editor-helpers';

/**
 * ダッシュボード画面で新しいアプリケーションを正常に作成します。
 * 主にテストのセットアップで使用します。
 * @param page ダッシュボードのPageオブジェクト
 * @param appName 作成するアプリケーション名
 * @param appKey 作成するアプリケーションキー
 */
export async function createApp(page: Page, appName: string, appKey: string): Promise<void> {
    const appModal = page.locator('dashboard-modal-window#appModal');

    await expect(async () => {
        // すでにモーダルが表示されていればこのステップは通過
        if (await appModal.locator('span[slot="header-title"]').isVisible().catch(() => false)) {
            return;
        }

        // アラートが被ってクリックを妨害している場合は閉じる
        const alert = page.locator('alert-component');
        if (await alert.isVisible().catch(() => false)) {
            await alert.getByRole('button', { name: '閉じる' }).click({ force: true }).catch(() => { });
        }

        // 短めのタイムアウトでクリックを実行。alert等に被っているとエラーになりリトライされる
        await page.getByTitle('アプリケーションの追加').click({ force: true, timeout: 2000 });

        // モーダルの「中身（タイトル）」が表示されるのを待つ
        await expect(appModal.locator('span[slot="header-title"]')).toBeVisible({ timeout: 3000 });
    }).toPass({
        timeout: 20000,
        intervals: [1000]
    });

    const appNameInput = page.locator('#input-app-name');
    await expect(appNameInput).toBeFocused();
    await expect(appNameInput).toBeEditable({ timeout: 10000 });
    await appNameInput.fill(appName);

    const appKeyInput = page.locator('#input-app-key');
    await expect(appKeyInput).toBeEditable({ timeout: 10000 });
    await appKeyInput.pressSequentially(appKey);

    await expect(appNameInput).toHaveValue(appName);
    await expect(appKeyInput).toHaveValue(appKey);

    await expect(async () => {
        const alert = page.locator('alert-component');
        if (await alert.isVisible().catch(() => false)) {
            await alert.getByRole('button', { name: '閉じる' }).click({ force: true }).catch(() => { });
        }
        await appModal.getByRole('button', { name: '保存' }).click({ force: true, timeout: 2000 });
    }).toPass({ timeout: 15000, intervals: [1000] });

    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    await expect(page.locator('dashboard-main-content > dashboard-loading-overlay')).toBeHidden();
    await expect(appModal).toBeHidden();
}

/**
 * ダッシュボード画面で指定されたアプリケーションを正常に削除します。
 * 主にテストのクリーンアップで使用します。
 * @param page ダッシュボードのPageオブジェクト
 * @param appKey 削除するアプリケーションキー
 */
export async function deleteApp(page: Page, appKey: string): Promise<void> {
    console.log(`[DEBUG] deleteApp開始: ${appKey}`);
    await page.bringToFront();

    // 削除処理を確実に行うため、ページをリロードしてクリーンな状態にする
    await page.reload({ waitUntil: 'domcontentloaded' });

    // 一時的なエラー監視リスナーを登録 (400以上のエラーをコンソールに出力)
    const errorListener = async (response: any) => {
        if (response.status() >= 400 && response.request().resourceType() === 'fetch') {
            console.error(`[API ERROR in deleteApp] ${response.request().method()} ${response.url()} - Status: ${response.status()}`);
            try { console.error(`[API ERROR BODY] ${await response.text()}`); } catch (e) { }
        }
    };
    page.on('response', errorListener);

    // 念のため残っているアラートを消してから開始 ---
    const alert = page.locator('alert-component');
    if (await alert.isVisible().catch(() => false)) {
        await alert.getByRole('button', { name: '閉じる' }).evaluate((el: HTMLElement) => el.click()).catch(() => { });
    }

    await navigateToTab(page, 'workbench');

    const appRow = page.locator('.app-list tbody tr', {
        has: page.locator('td:nth-child(2)', { hasText: new RegExp(`^${appKey}$`) })
    }).first();

    try {
        await appRow.waitFor({ state: 'visible', timeout: 15000 });
    } catch (e) {
        console.log(`[DEBUG] deleteApp: アプリ行が見つかりません。既に削除済みの可能性があります。`);
    }

    if (await appRow.isVisible()) {
        const confirmDialog = page.locator('message-box#delete-confirm');

        await expect(async () => {
            const a = page.locator('alert-component');
            if (await a.isVisible().catch(() => false)) {
                await a.getByRole('button', { name: '閉じる' }).evaluate((el: HTMLElement) => el.click()).catch(() => { });
            }

            const deleteBtn = appRow.getByRole('button', { name: '削除' });
            await deleteBtn.evaluate((el: HTMLElement) => el.click()).catch(() => {
                return deleteBtn.click({ force: true, timeout: 2000 });
            });

            await expect(confirmDialog).toBeVisible({ timeout: 5000 });
        }).toPass({ timeout: 20000, intervals: [1000] });

        const confirmBtn = confirmDialog.getByRole('button', { name: '削除する' });

        console.log(`[DEBUG] deleteApp: 削除確認ダイアログの「削除する」をクリック`);
        await confirmBtn.evaluate((el: HTMLElement) => el.click()).catch(() => {
            return confirmBtn.click({ force: true });
        });

        await page.getByText('処理中...').waitFor({ state: 'hidden' });
        await expect(page.locator('dashboard-main-content > dashboard-loading-overlay')).toBeHidden();

        if (await alert.isVisible({ timeout: 5000 }).catch(() => false)) {
            const alertText = await alert.innerText().catch(() => 'unknown');
            console.log(`[DEBUG] deleteApp: アラート表示内容 -> ${alertText}`);
            await alert.getByRole('button', { name: '閉じる' }).evaluate((el: HTMLElement) => el.click()).catch(() => { });
            await expect(alert).toBeHidden();
        }

        console.log(`[DEBUG] deleteApp: リロードして状態同期`);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await navigateToTab(page, 'workbench');
    }

    page.off('response', errorListener); // リスナー解除
    console.log(`[DEBUG] deleteApp完了: ${appKey}`);
}

export async function openEditor(page: Page, context: BrowserContext, appName: string, version: string = '1.0.0'): Promise<Page> {
    // アラートが残っていたら閉じるか、消えるのを待つ
    const alert = page.locator('alert-component');
    if (await alert.isVisible().catch(() => false)) {
        const closeBtn = alert.getByRole('button', { name: '閉じる' });
        if (await closeBtn.isVisible().catch(() => false)) {
            await closeBtn.evaluate((el: HTMLElement) => el.click()).catch(() => { });
        }
        // アラートが出ていた場合、状態が不正かもしれないのでリロードして確実にする
        await page.reload({ waitUntil: 'domcontentloaded' });
    }

    await navigateToTab(page, 'workbench');

    const appRow = page.locator('.app-list tbody tr', { hasText: appName }).first();

    // アプリが見えるまで待機（見えない場合はリロードも試行）
    await expect(async () => {
        if (!(await appRow.isVisible().catch(() => false))) {
            await page.reload({ waitUntil: 'domcontentloaded' });
            await navigateToTab(page, 'workbench');
        }
        await expect(appRow).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 20000, intervals: [2000] });

    await expect(async () => {
        const a = page.locator('alert-component');
        if (await a.isVisible().catch(() => false)) {
            await a.getByRole('button', { name: '閉じる' }).evaluate((el: HTMLElement) => el.click()).catch(() => { });
        }

        const selectBtn = appRow.getByRole('button', { name: '選択' });
        await selectBtn.evaluate((el: HTMLElement) => el.click()).catch(() => {
            return selectBtn.click({ force: true, timeout: 2000 });
        });
    }).toPass({ timeout: 15000, intervals: [1000] });

    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    await expect(page.getByRole('heading', { name: 'バージョン管理' })).toBeVisible();

    const versionRow = page.locator('.version-list tbody tr', { hasText: version }).first();
    await expect(versionRow).toBeVisible({ timeout: 10000 });

    const editorBtn = versionRow.getByRole('button', { name: 'エディタ' });
    await expect(editorBtn).toBeVisible({ timeout: 5000 });

    // モバイルでの要素重なりやスクロール問題を回避するため画面内に収める
    await editorBtn.scrollIntoViewIfNeeded().catch(() => { });

    // ポップアップブロック回避のため、Playwrightの正規クリックを試み、新しいタブが開くのを待つ。
    // 開かなければリトライ(toPass)する。
    let editorPage: Page | undefined;
    await expect(async () => {
        const editorPagePromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);

        // Playwrightのclickを使用してポップアップブロックを回避。
        // モバイルでクリックが傍受される場合に備えて force: true を指定。
        await editorBtn.click({ force: true }).catch(async () => {
            // フォールバック
            await editorBtn.evaluate((el: HTMLElement) => el.click()).catch(() => { });
        });

        const newPage = await editorPagePromise;
        if (!newPage) {
            throw new Error('エディタの新しいタブが開かれませんでした。');
        }
        editorPage = newPage;
    }).toPass({ timeout: 30000, intervals: [2000] });

    if (!editorPage) {
        throw new Error('エディタのオープンに失敗しました。');
    }

    await editorPage.waitForLoadState('domcontentloaded');

    await editorPage.waitForLoadState('domcontentloaded');

    // EditorHelperをインスタンス化して、ダイアログ処理を呼び出す
    const tempHelper = new EditorHelper(editorPage, false);
    await tempHelper.handleSnapshotRestoreDialog();

    await expect(editorPage.locator('ios-component')).toBeVisible();
    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    return editorPage;
}

/**
 * ダッシュボードの指定されたタブに移動します。
 * モバイルでのUI要素重なり等によるクリック空振りを防ぐため、ネイティブクリックも試行します。
 * @param page ダッシュボードのPageオブジェクト
 * @param tabName 移動先のタブ名 ('workbench', 'publish', 'archive')
 */
export async function navigateToTab(page: Page, tabName: 'workbench' | 'publish' | 'archive'): Promise<void> {
    const tabLocator = page.locator(`#${tabName}`);

    await expect(async () => {
        const alert = page.locator('alert-component');
        if (await alert.isVisible().catch(() => false)) {
            await alert.getByRole('button', { name: '閉じる' }).evaluate((el: HTMLElement) => el.click()).catch(() => { });
        }

        // Playwrightのクリックが阻害されるモバイル環境対策として、ネイティブのクリックイベントも試行する
        await tabLocator.evaluate((el: HTMLElement) => el.click()).catch(() => {
            return tabLocator.click({ force: true, timeout: 2000 });
        });

        // 確実にタブがアクティブになったか（クラスが付与されたか）を確認
        await expect(tabLocator).toHaveClass(/active/, { timeout: 3000 });
    }).toPass({ timeout: 15000, intervals: [1000] });

    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    await expect(page.locator(`dashboard-main-content > dashboard-loading-overlay`)).toBeHidden();
}

/**
 * アプリケーションがリストに表示されているか/いないかを確認します。
 * @param page ダッシュボードのPageオブジェクト
 * @param appKey 確認するアプリケーションキー
 * @param isVisible trueなら表示されていること、falseなら非表示であることを期待
 */
export async function expectAppVisibility(page: Page, appKey: string, isVisible: boolean): Promise<void> {
    await expect(async () => {
        const appKeyCell = page
            .locator('.app-list tbody tr td:nth-child(2)', { hasText: new RegExp(`^${appKey}$`) })
            .first();

        if (isVisible) {
            await expect(appKeyCell).toBeVisible({ timeout: 2000 });
        } else {
            await expect(appKeyCell).toBeHidden({ timeout: 2000 });
        }
    }).toPass({
        timeout: 30000,
        intervals: [1000]
    });
}

/**
 * 公開タブでアプリケーションを選択し、バージョン一覧画面に遷移します。
 * @param page ダッシュボードのPageオブジェクト
 * @param appName 選択するアプリケーション名
 */
async function selectAppInPublishTab(page: Page, appName: string): Promise<void> {
    const appRow = page.locator('.app-list tbody tr', { hasText: appName }).first();
    // モバイル環境で「ワークベンチ」タブに取り残されたまま検索してしまう事故を防ぐため、確実に遷移と表示をリトライ
    await expect(async () => {
        const alert = page.locator('alert-component');
        if (await alert.isVisible().catch(() => false)) {
            await alert.getByRole('button', { name: '閉じる' }).evaluate((el: HTMLElement) => el.click()).catch(() => { });
        }

        await appRow.scrollIntoViewIfNeeded().catch(() => { });
        const selectBtn = appRow.getByRole('button', { name: '選択' });
        await selectBtn.evaluate((el: HTMLElement) => el.click()).catch(() => {
            return selectBtn.click({ timeout: 2000, force: true });
        });

        await expect(page.getByRole('heading', { name: `公開設定: ${appName}` })).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 20000, intervals: [1000] });
    await page.getByText('処理中...').waitFor({ state: 'hidden' });
}

/**
 * バージョンを公開状態にします（公開準備 -> 準備完了 -> 公開）。
 * @param page ダッシュボードのPageオブジェクト
 * @param appName 対象のアプリケーション名
 * @param version 対象のバージョン
 */
export async function publishVersion(page: Page, appName: string, version: string): Promise<void> {
    await navigateToTab(page, 'publish');
    await selectAppInPublishTab(page, appName);

    // 公開準備
    let versionRow = page.locator('.publish-list tbody tr', { hasText: version });
    const prepBtn = versionRow.getByRole('button', { name: '公開準備' });
    await prepBtn.evaluate((el: HTMLElement) => el.click()).catch(() => prepBtn.click({ force: true }));

    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    let confirmDialog = page.locator('message-box#publish-action-confirm');
    await expect(confirmDialog).toBeVisible();

    const applyBtn = confirmDialog.getByRole('button', { name: '申請する' });
    await applyBtn.evaluate((el: HTMLElement) => el.click()).catch(() => applyBtn.click({ force: true }));
    await page.getByText('処理中...').waitFor({ state: 'hidden' });

    // 公開準備完了まで待機
    await waitForVersionStatus(page, appName, version, '公開準備完了');

    // 公開
    versionRow = page.locator('.publish-list tbody tr', { hasText: version });
    const pubBtn = versionRow.getByRole('button', { name: '公開', exact: true });
    await pubBtn.evaluate((el: HTMLElement) => el.click()).catch(() => pubBtn.click({ force: true }));

    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    confirmDialog = page.locator('message-box#publish-action-confirm');
    await expect(confirmDialog).toBeVisible();

    const finalPubBtn = confirmDialog.getByRole('button', { name: '公開する' });
    await finalPubBtn.evaluate((el: HTMLElement) => el.click()).catch(() => finalPubBtn.click({ force: true }));
    await page.getByText('処理中...').waitFor({ state: 'hidden' });
}

/**
 * 公開中のバージョンを非公開にします。
 * @param page ダッシュボードのPageオブジェクト
 * @param appName 対象のアプリケーション名
 * @param version 対象のバージョン
 */
export async function unpublishVersion(page: Page, appName: string, version: string): Promise<void> {
    await navigateToTab(page, 'publish');
    await selectAppInPublishTab(page, appName);

    const versionRow = page.locator('.publish-list tbody tr', { hasText: version });
    const unpubBtn = versionRow.getByRole('button', { name: '非公開', exact: true });
    await unpubBtn.evaluate((el: HTMLElement) => el.click()).catch(() => unpubBtn.click({ force: true }));

    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    const confirmDialog = page.locator('message-box#publish-action-confirm');
    await expect(confirmDialog).toBeVisible();

    const finalUnpubBtn = confirmDialog.getByRole('button', { name: '非公開にする' });
    await finalUnpubBtn.evaluate((el: HTMLElement) => el.click()).catch(() => finalUnpubBtn.click({ force: true }));
    await page.getByText('処理中...').waitFor({ state: 'hidden' });
}

/**
 * バージョンの公開準備を開始します。（非公開 -> 公開準備中）
 * @param page ダッシュボードのPageオブジェクト
 * @param appName 対象のアプリケーション名
 * @param version 対象のバージョン
 */
export async function startPublishPreparation(page: Page, appName: string, version: string): Promise<void> {
    await navigateToTab(page, 'publish');
    await selectAppInPublishTab(page, appName);

    const versionRow = page.locator('.publish-list tbody tr', { hasText: version });
    const prepBtn = versionRow.getByRole('button', { name: '公開準備' });
    await prepBtn.evaluate((el: HTMLElement) => el.click()).catch(() => prepBtn.click({ force: true }));

    await page.getByText('処理中...').waitFor({ state: 'hidden' });

    const confirmDialog = page.locator('message-box#publish-action-confirm');
    await expect(confirmDialog).toBeVisible();

    const applyBtn = confirmDialog.getByRole('button', { name: '申請する' });
    await applyBtn.evaluate((el: HTMLElement) => el.click()).catch(() => applyBtn.click({ force: true }));

    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    await expect(page.locator('dashboard-main-content > dashboard-loading-overlay')).toBeHidden({ timeout: 150000 });
}

/**
 * バージョンを公開準備完了から公開中にします。（公開準備完了 -> 公開中）
 * @param page ダッシュボードのPageオブジェクト
 * @param appName 対象のアプリケーション名
 * @param version 対象のバージョン
 */
export async function completePublication(page: Page, appName: string, version: string): Promise<void> {
    await navigateToTab(page, 'publish');
    await selectAppInPublishTab(page, appName);

    // 公開準備完了まで待機
    await waitForVersionStatus(page, appName, version, '公開準備完了');

    // 公開中にする
    const readyVersionRow = page.locator('.publish-list tbody tr', { hasText: version });
    const pubBtn = readyVersionRow.getByRole('button', { name: '公開', exact: true });
    await pubBtn.evaluate((el: HTMLElement) => el.click()).catch(() => pubBtn.click({ force: true }));

    await page.getByText('処理中...').waitFor({ state: 'hidden' });

    const publishConfirmDialog = page.locator('message-box#publish-action-confirm');
    await expect(publishConfirmDialog).toBeVisible();

    const confirmBtn = publishConfirmDialog.getByRole('button', { name: '公開する' });
    await confirmBtn.evaluate((el: HTMLElement) => el.click()).catch(() => confirmBtn.click({ force: true }));

    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    await expect(page.locator('dashboard-main-content > dashboard-loading-overlay')).toBeHidden({ timeout: 150000 });
}

/**
 * 公開管理画面で、指定したバージョンのステータスを検証します。
 * @param page ダッシュボードのPageオブジェクト
 * @param version 検証するバージョン
 * @param statusText 期待するステータス文字列 (例: '非公開', '公開準備中', '公開中')
 */
export async function expectVersionStatus(page: Page, version: string, statusText: string): Promise<void> {
    const versionRow = page.locator('.publish-list tbody tr', { hasText: version });
    await expect(versionRow.locator('td').nth(1)).toContainText(statusText);
}

/**
 * 指定したバージョンのZIPファイルをダウンロードします。
 * @param page ダッシュボードのPageオブジェクト
 * @param appName 対象のアプリケーション名
 * @param appKey 対象のアプリケーションキー（ファイル名検証用）
 * @param version 対象のバージョン
 */
export async function downloadVersion(page: Page, { appName, appKey, version }: { appName: string, appKey: string, version: string }): Promise<void> {
    await navigateToTab(page, 'publish');

    const appRow = page.locator('.app-list tbody tr', { hasText: appName });
    const selectBtn = appRow.getByRole('button', { name: '選択' });
    await selectBtn.evaluate((el: HTMLElement) => el.click()).catch(() => selectBtn.click({ force: true }));

    await expect(page.getByRole('heading', { name: `公開設定: ${appName}` })).toBeVisible();

    const versionRow = page.locator('.publish-list tbody tr', { hasText: version });
    const dlBtn = versionRow.getByRole('button', { name: 'ＤＬ' });
    await dlBtn.evaluate((el: HTMLElement) => el.click()).catch(() => dlBtn.click({ force: true }));

    await page.getByText('処理中...').waitFor({ state: 'hidden' });

    const confirmDialog = page.locator('message-box#download-confirm');
    await expect(confirmDialog).toBeVisible();

    const confirmDlBtn = confirmDialog.getByRole('button', { name: 'ダウンロード' });
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        confirmDlBtn.evaluate((el: HTMLElement) => el.click()).catch(() => confirmDlBtn.click({ force: true })),
    ]);

    await page.getByText('処理中...').waitFor({ state: 'hidden' });

    // ダウンロードされたファイル名を検証
    const expectedVersionInFilename = version.replace(/\./g, '_');
    const expectedBaseFilename = `${appKey}_${expectedVersionInFilename}`;
    const suggestedFilename = download.suggestedFilename();
    expect(suggestedFilename).toContain(expectedBaseFilename);
    expect(suggestedFilename).toContain('.zip');
}

/**
 * バージョン管理画面で、指定したバージョンが表示されているか/いないかを確認します。
 * @param page ダッシュボードのPageオブジェクト
 * @param version 検証するバージョン
 * @param isVisible trueなら表示、falseなら非表示を期待
 */
export async function expectVersionVisibility(page: Page, version: string, isVisible: boolean): Promise<void> {
    await expect(async () => {
        // 行全体を取得し、その中から特定のバージョン名を持つセルを探す
        // .first() をつけることで、探索を安定させます
        const versionCell = page
            .locator('.version-list tbody tr td:first-child')
            .filter({ hasText: version })
            .first();

        if (isVisible) {
            // 表示を期待する場合
            // 個別のタイムアウトは短めにし、失敗したらtoPassでリトライさせます
            await expect(versionCell).toBeVisible({ timeout: 2000 });
            await expect(versionCell).toContainText(version);
        } else {
            // 非表示を期待する場合
            await expect(versionCell).toBeHidden({ timeout: 2000 });
        }
    }).toPass({
        timeout: 30000,   // バックエンドの処理遅延も考慮して最大30秒待機
        intervals: [1000] // 1秒おきにチェック
    });
}

/**
 * バージョン管理画面で新しいバージョンを追加します。
 * @param page ダッシュボードのPageオブジェクト
 * @param versionName 追加するバージョン名
 */
export async function addVersion(page: Page, versionName: string): Promise<void> {
    await expect(async () => {
        const alert = page.locator('alert-component');
        if (await alert.isVisible().catch(() => false)) {
            await alert.getByRole('button', { name: '閉じる' }).evaluate((el: HTMLElement) => el.click()).catch(() => { });
        }
        const addBtn = page.getByTitle('バージョンの追加');
        await addBtn.evaluate((el: HTMLElement) => el.click()).catch(() => addBtn.click({ force: true, timeout: 2000 }));

        const modal = page.locator('dashboard-modal-window#versionModal');
        await expect(modal.getByRole('heading', { name: 'バージョンの追加' })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000, intervals: [1000] });

    const modal = page.locator('dashboard-modal-window#versionModal');
    await modal.getByLabel('バージョン').fill(versionName);

    await expect(async () => {
        const alert = page.locator('alert-component');
        if (await alert.isVisible().catch(() => false)) {
            await alert.getByRole('button', { name: '閉じる' }).evaluate((el: HTMLElement) => el.click()).catch(() => { });
        }
        const saveBtn = modal.getByRole('button', { name: '保存' });
        await saveBtn.evaluate((el: HTMLElement) => el.click()).catch(() => saveBtn.click({ force: true, timeout: 2000 }));
    }).toPass({ timeout: 15000, intervals: [1000] });

    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
    await expect(modal).toBeHidden();
}

/**
 * 指定されたバージョンを持つアプリケーションを作成し、バージョン管理画面を開きます。
 * @param page ダッシュボードのPageオブジェクト
 * @param appName 作成するアプリ名
 * @param appKey 作成するアプリキー
 * @param versions 作成するバージョンの配列（'1.0.0'は自動作成されるため、それ以外が追加対象）
 */
export async function setupAppWithVersions(page: Page, { appName, appKey, versions }: { appName: string, appKey: string, versions: string[] }): Promise<void> {
    await createApp(page, appName, appKey);

    const alert = page.locator('alert-component');
    if (await alert.isVisible().catch(() => false)) {
        await alert.getByRole('button', { name: '閉じる' }).evaluate((el: HTMLElement) => el.click()).catch(() => { });
        await expect(alert).toBeHidden();
    }

    const appRow = page.locator('.app-list tbody tr', { hasText: appName });
    await expect(appRow).toBeVisible();

    const selectBtn = appRow.getByRole('button', { name: '選択' });
    await selectBtn.evaluate((el: HTMLElement) => el.click()).catch(() => selectBtn.click({ force: true }));

    await expect(page.getByRole('heading', { name: 'バージョン管理' })).toBeVisible();
    await page.waitForTimeout(1000); // バージョンの表示が安定するまで少し待つ
    
    const additionalVersions = versions.filter(v => v !== '1.0.0');
    for (const version of additionalVersions) {
        await addVersion(page, version);
    }

    for (const version of versions) {
        await expectVersionVisibility(page, version, true);
    }
}

/**
 * バージョンを編集します。
 * @param page ダッシュボードのPageオブジェクト
 * @param oldVersion 編集前のバージョン名
 * @param newVersion 編集後のバージョン名
 */
export async function editVersion(page: Page, oldVersion: string, newVersion: string): Promise<void> {
    const versionRow = page.locator('.version-list tbody tr', { hasText: oldVersion });
    const editBtn = versionRow.getByRole('button', { name: '編集' });
    await editBtn.evaluate((el: HTMLElement) => el.click()).catch(() => editBtn.click({ force: true }));

    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    await expect(page.locator('dashboard-loading-overlay')).toBeHidden();

    const modal = page.locator('dashboard-modal-window#versionModal');
    await expect(modal.getByRole('heading', { name: 'バージョンの編集' })).toBeVisible();

    await modal.getByLabel('バージョン').fill(newVersion);
    const saveBtn = modal.getByRole('button', { name: '保存' });
    await saveBtn.evaluate((el: HTMLElement) => el.click()).catch(() => saveBtn.click({ force: true }));

    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
}

/**
 * バージョンを複製します。
 * @param page ダッシュボードのPageオブジェクト
 * @param sourceVersion 複製元のバージョン名
 */
export async function duplicateVersion(page: Page, sourceVersion: string): Promise<void> {
    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    await expect(page.locator('dashboard-loading-overlay')).toBeHidden();

    await expect(async () => {
        const alert = page.locator('alert-component');
        if (await alert.isVisible().catch(() => false)) {
            await alert.getByRole('button', { name: '閉じる' }).evaluate((el: HTMLElement) => el.click()).catch(() => { });
        }
        const versionRow = page.locator('.version-list tbody tr', { hasText: sourceVersion }).first();
        const dupButton = versionRow.getByRole('button', { name: '複製' });

        await dupButton.evaluate((el: HTMLElement) => el.click()).catch(() => dupButton.click({ force: true, timeout: 2000 }));
    }).toPass({
        timeout: 15000,
        intervals: [1000]
    });

    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
}

/**
 * バージョンを削除します。
 * @param page ダッシュボードのPageオブジェクト
 * @param versionToDelete 削除するバージョン名
 */
export async function deleteVersion(page: Page, versionToDelete: string): Promise<void> {
    const versionRow = page.locator('.version-list tbody tr', { hasText: versionToDelete });
    const delBtn = versionRow.getByRole('button', { name: '削除' });
    await delBtn.evaluate((el: HTMLElement) => el.click()).catch(() => delBtn.click({ force: true }));

    await page.getByText('処理中...').waitFor({ state: 'hidden' });

    const confirmDialog = page.locator('message-box#delete-confirm');
    await expect(confirmDialog).toBeVisible();

    const confirmDelBtn = confirmDialog.getByRole('button', { name: '削除する' });
    await confirmDelBtn.evaluate((el: HTMLElement) => el.click()).catch(() => confirmDelBtn.click({ force: true }));

    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
}

/**
 * ダッシュボードから現在のPP（ポイント）を取得します。
 * @param page ダッシュボードのPageオブジェクト
 * @returns 現在のポイント数（数値）
 */
export async function getCurrentPoints(page: Page): Promise<number> {
    // ポイントを表示している要素を特定します
    const pointTextLocator = page.locator('p.pp-point-text');

    // 要素が画面に表示されるまで待ちます
    await expect(pointTextLocator).toBeVisible();

    // 要素のテキストコンテンツを取得します (例: "83,982 PP")
    const textContent = await pointTextLocator.textContent();

    // テキストが取得できなかった場合はエラーをスローします
    if (textContent === null) {
        throw new Error('ポイントのテキストコンテンツが取得できませんでした。');
    }

    // テキストからカンマと "PP" を取り除き、数値に変換します
    // 1. カンマをすべて削除 (例: "83,982" -> "83982")
    // 2. "PP" とその前後の空白を削除
    // 3. 文字列を10進数の整数に変換
    const pointString = textContent.replace(/,/g, '').replace(/PP/i, '').trim();
    const points = parseInt(pointString, 10);

    // 変換に失敗してNaNになった場合はエラーをスローします
    if (isNaN(points)) {
        throw new Error(`ポイントの数値変換に失敗しました。取得した文字列: "${textContent}"`);
    }

    return points;
}

/**
 * ダッシュボードのメニューから設定画面を開きます。
 * モバイルでのポインターインターセプトを回避するため、要素の表示待機と強制クリックを採用しています。
 * @param page ダッシュボードのPageオブジェクト
 */
export async function navigateToSettings(page: Page): Promise<void> {
    // 念のためローディングが消えるのを待つ
    await expect(page.locator('dashboard-loading-overlay')).toBeHidden({ timeout: 10000 }).catch(() => { });

    // エラーアラートが出ている場合は閉じる
    const alert = page.locator('alert-component');
    if (await alert.isVisible().catch(() => false)) {
        console.log('[DEBUG] navigateToSettings: Alert is visible. Closing it.');
        await alert.getByRole('button', { name: '閉じる' }).evaluate((el: HTMLElement) => el.click()).catch(() => { });
        await expect(alert).toBeHidden({ timeout: 2000 }).catch(() => { });
    }

    const menuBtn = page.locator('button.menu-button[title="メニュー"]');
    // メニューボタンをクリック (モバイルで隠れていても強制的に押す)
    await menuBtn.evaluate((el: HTMLElement) => el.click()).catch(() => menuBtn.click({ force: true }));

    // メニューリストが表示されるのを待つ
    const menuList = page.locator('#appMenuList');
    await expect(menuList).toBeVisible();

    // 「設定」メニュー項目をクリック (モバイル環境で他要素と被っていても強制的に押す)
    const settingItem = menuList.locator('.dashboard-menu-item', { hasText: '設定' });
    await settingItem.evaluate((el: HTMLElement) => el.click()).catch(() => settingItem.click({ force: true }));

    // 設定コンテンツが表示されるのを待つ
    const settingsContent = page.locator('.setting-content');
    await expect(settingsContent).toBeVisible();
    await expect(settingsContent.getByText('AI機能を有効にする')).toBeVisible();
}

/**
 * AI機能の有効/無効を設定します。
 * この関数は自動で設定画面に遷移し、現在の状態を確認してから必要な操作のみ実行します。
 * @param page ダッシュボードのPageオブジェクト
 * @param enable trueで有効化、falseで無効化
 */
export async function setAiCoding(page: Page, enable: boolean): Promise<void> {
    // 1. 設定画面へ移動
    await navigateToSettings(page);
    await page.waitForTimeout(500); // UIアニメーション待機

    // 2. AI機能のチェックボックスと現在の状態を取得
    const checkbox = page.locator('#aiCodingCheckbox');
    const isCurrentlyEnabled = await checkbox.isChecked();

    // 3. 目標の状態と現在の状態が同じであれば、何もしないで終了
    if (isCurrentlyEnabled === enable) {
        await closeSettings(page); // 設定画面を閉じて終了
        return;
    }

    // 4. トグルスイッチをクリックして状態を変更
    // input自体ではなく、関連付けられたlabelをクリックするのが堅牢です (force: trueで強制クリック)
    const label = page.locator('label[for="aiCodingCheckbox"]');
    await label.evaluate((el: HTMLElement) => el.click()).catch(() => label.click({ force: true }));

    // 5. 【有効化する場合のみ】年齢確認モーダルを処理
    if (enable) {
        const parentModal = page.locator('#aiCodingConfirmModal');
        try {
            // モーダルが出る場合のみ処理する（出ない場合はcatchされて無視）
            await expect(parentModal.locator('.modal')).toBeVisible({ timeout: 3000 });
            const submitBtn = parentModal.locator('span[slot="submit-button-text"]');
            await submitBtn.evaluate((el: HTMLElement) => el.click()).catch(() => submitBtn.click({ force: true }));
            await expect(parentModal).toBeHidden({ timeout: 5000 });
        } catch (e) {
            // 既に同意済み等でモーダルが出ない場合は無視して進む
        }
    }

    // 6. 最終的な状態を検証
    if (enable) {
        await expect(checkbox).toBeChecked({ timeout: 5000 });
    } else {
        await expect(checkbox).not.toBeChecked({ timeout: 5000 });
    }

    await page.waitForTimeout(1000); // DB保存のAPI完了を待機

    // 7. 設定画面を閉じる
    await closeSettings(page);
}

/**
 * 設定画面（メニュー）を閉じます。
 * @param page ダッシュボードのPageオブジェクト
 */
export async function closeSettings(page: Page): Promise<void> {
    const accountSetting = page.locator('dashboard-account-setting');

    await expect(async () => {
        // --- エラーアラートが出ている場合は閉じてリカバリする ---
        const alert = page.locator('alert-component');
        if (await alert.isVisible().catch(() => false)) {
            console.log('[DEBUG] closeSettings: Alert is visible. Closing it to recover.');
            await alert.getByRole('button', { name: '閉じる' }).evaluate((el: HTMLElement) => el.click()).catch(() => { });
            // アラートが消えるための微小な待機
            await page.waitForTimeout(300);
        }
        // 設定パネルの枠外（座標 x:10, y:10）を確実にクリックしてメニューを閉じる
        await accountSetting.click({ position: { x: 10, y: 10 }, force: true });

        // それでも閉じない場合の保険として、画面の左上端を直接タップ
        if (await page.locator('.setting-content').isVisible().catch(() => false)) {
            await page.mouse.click(0, 0);
        }

        await expect(page.locator('.setting-content')).toBeHidden({ timeout: 2000 });
    }).toPass({ timeout: 10000, intervals: [1000] });
}

/**
 * 設定画面でGemini APIキーを登録します。
 * 既にキーが登録されている場合は、何もしません。
 * @param page ダッシュボードのPageオブジェクト
 * @param apiKey 登録するGemini APIキー
 */
export async function setGeminiApiKey(page: Page, apiKey: string): Promise<void> {
    // 1. 設定画面へ移動
    await navigateToSettings(page);

    // 2. APIキー入力フォームが表示されているか確認
    const apiKeyForm = page.locator('.api-key-form');
    if (!(await apiKeyForm.isVisible())) {
        await closeSettings(page); // 設定画面を閉じて終了
        return;
    }

    // 3. APIキーを入力して保存ボタンをクリック
    await apiKeyForm.locator('input#gemini-api-key').fill(apiKey);
    const saveBtn = apiKeyForm.locator('button.save-api-key-button');
    await saveBtn.evaluate((el: HTMLElement) => el.click()).catch(() => saveBtn.click({ force: true }));

    // 4. 登録成功のアラートが表示されるのを待ち、閉じる
    const successAlert = page.locator('.alert', { hasText: 'APIキーを登録しました。' });
    await expect(successAlert).toBeVisible();
    const closeBtn = successAlert.locator('button#closeButton');
    await closeBtn.evaluate((el: HTMLElement) => el.click()).catch(() => closeBtn.click({ force: true }));
    await expect(successAlert).toBeHidden();

    // 5. UIが「登録済み」の状態に変わったことを確認
    const registeredDisplay = page.locator('.api-key-display');
    await expect(registeredDisplay).toBeVisible();
    await expect(registeredDisplay.getByText('APIキーは登録済みです。')).toBeVisible();

    // 6. 設定画面を閉じる
    await closeSettings(page);
}

/**
 * 設定画面で登録済みのGemini APIキーを削除します。
 * キーが登録されていない場合は、何もしません。
 * @param page ダッシュボードのPageオブジェクト
 */
export async function deleteGeminiApiKey(page: Page): Promise<void> {
    // 1. 設定画面へ移動
    await navigateToSettings(page);

    // 2. 「登録済み」の表示が出ているか確認
    const registeredDisplay = page.locator('.api-key-display');
    if (!(await registeredDisplay.isVisible())) {
        await closeSettings(page); // 設定画面を閉じて終了
        return;
    }

    // 3. ブラウザの確認ダイアログを自動で承諾するリスナーを設定
    // page.once は一度だけ実行されるリスナーを登録します
    page.once('dialog', async dialog => {
        expect(dialog.message()).toBe('登録されているAPIキーを本当に削除しますか？');
        await dialog.accept(); // 「OK」をクリック
    });

    // 4. 削除ボタンをクリック（ここで上記ダイアログがトリガーされる）
    const delBtn = registeredDisplay.locator('button.delete-api-key-button');
    await delBtn.evaluate((el: HTMLElement) => el.click()).catch(() => delBtn.click({ force: true }));

    // 5. 削除成功のアラートが表示されるのを待ち、閉じる
    const deleteAlert = page.locator('.alert', { hasText: 'APIキーを削除しました。' });
    await expect(deleteAlert).toBeVisible();
    const closeBtn = deleteAlert.locator('button#closeButton');
    await closeBtn.evaluate((el: HTMLElement) => el.click()).catch(() => closeBtn.click({ force: true }));
    await expect(deleteAlert).toBeHidden();

    // 6. UIが「未登録」の状態（入力フォーム）に戻ったことを確認
    const apiKeyForm = page.locator('.api-key-form');
    await expect(apiKeyForm.locator('input#gemini-api-key')).toBeVisible();

    // 7. 設定画面を閉じる
    await closeSettings(page);
}

/**
 * 公開管理画面で、指定したバージョンのステータスが期待する状態になるまでポーリング（繰り返し確認）します。
 * タイムアウトするまで、内部で「ページリロード → タブ移動 → アプリ選択 → ステータス確認」を繰り返します。
 * @param page ダッシュボードのPageオブジェクト
 * @param appName 対象のアプリケーション名
 * @param version 対象のバージョン
 * @param expectedStatus 期待するステータス文字列 (例: '公開準備完了', '非公開'など)
 * @param options ポーリングのタイムアウト(ms)と確認間隔(ms)を指定するオブジェクト
 */
export async function waitForVersionStatus(
    page: Page,
    appName: string,
    version: string,
    expectedStatus: string,
    options: { timeout?: number; intervals?: number[] } = {}
): Promise<void> {
    // オプションのデフォルト値を設定
    const { timeout = 150000, intervals = [10000, 20000, 30000] } = options;

    await expect(async () => {
        // 1. ページの再読み込みで最新の状態を取得
        await page.reload({ waitUntil: 'networkidle' });

        // 2. 公開タブに移動
        await navigateToTab(page, 'publish');

        // 3. 対象のアプリを選択してバージョン一覧を表示
        await selectAppInPublishTab(page, appName);

        // 4. 指定されたバージョンのステータスを検証
        const versionRow = page.locator('.publish-list tbody tr', { hasText: version });
        const statusCell = versionRow.locator('td').nth(1);

        // 個々の試行におけるタイムアウトは短めに設定
        await expect(statusCell).toContainText(expectedStatus, { timeout: 5000 });

    }).toPass({
        timeout: timeout, // 全体のタイムアウト
        intervals: intervals, // リトライ間隔
    });
}