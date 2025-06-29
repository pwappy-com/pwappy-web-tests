import { expect, type Page, type BrowserContext } from '@playwright/test';

/**
 * ダッシュボード画面で新しいアプリケーションを正常に作成します。
 * 主にテストのセットアップで使用します。
 * @param page ダッシュボードのPageオブジェクト
 * @param appName 作成するアプリケーション名
 * @param appKey 作成するアプリケーションキー
 */
export async function createApp(page: Page, appName: string, appKey: string): Promise<void> {
    await page.getByTitle('アプリケーションの追加').click();

    // モーダルウィンドウ自体を取得
     const appModal = page.locator('dashboard-modal-window#appModal');

    // モーダルの「コンテナ」ではなく、モーダルの「中身」が表示されるのを待つ。
    // この場合、ヘッダータイトルが最も確実。
    // これにより、コンテナのサイズが0x0である問題やShadow DOMの問題を回避できる。
    await expect(appModal.locator('span[slot="header-title"]')).toBeVisible();

    // 入力欄を取得する
    const appNameInput = appModal.getByLabel('アプリケーション名');

    // 入力欄が「入力可能」になるのを待つ
    await expect(appNameInput).toBeEditable({ timeout: 10000 });

    // 値を入力する。
    await appNameInput.fill(appName);

    const appKeyInput = appModal.getByLabel('アプリケーションキー');
    // 入力欄が「入力可能」になるのを待つ
    await expect(appKeyInput).toBeEditable({ timeout: 10000 });
    await appKeyInput.click();
    await appKeyInput.fill(appKey);

    await appModal.getByRole('button', { name: '保存' }).click();
    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    await expect(page.locator('dashboard-main-content > dashboard-loading-overlay')).toBeHidden();
    await expect(appModal).toBeHidden();
};

/**
 * ダッシュボード画面で指定されたアプリケーションを正常に削除します。
 * 主にテストのクリーンアップで使用します。
 * @param page ダッシュボードのPageオブジェクト
 * @param appName 削除するアプリケーション名
 */
export async function deleteApp(page: Page, appName: string): Promise<void> {
    await page.bringToFront();
    await navigateToTab(page, 'workbench');

    const appRow = page.locator('.app-list tbody tr', { hasText: appName });
    if (await appRow.count() > 0) {
        await appRow.getByRole('button', { name: '削除' }).click();
        await page.getByText('処理中...').waitFor({ state: 'hidden' });
        const confirmDialog = page.locator('message-box#delete-confirm');
        await expect(confirmDialog).toBeVisible();
        await confirmDialog.getByRole('button', { name: '削除する' }).click();
        await page.getByText('処理中...').waitFor({ state: 'hidden' });
        await expect(page.locator('dashboard-main-content > dashboard-loading-overlay')).toBeHidden();
    }
};

/**
 * ダッシュボードから指定したアプリケーションのエディタを新しいタブで開きます。
 * @param page ダッシュボードのPageオブジェクト
 * @param context BrowserContextオブジェクト
 * @param appName エディタを開く対象のアプリケーション名
 * @param version バージョン番号 (デフォルト: '1.0.0')
 * @returns 開かれたエディタのPageオブジェクト
 */
export async function openEditor(page: Page, context: BrowserContext, appName: string, version: string = '1.0.0'): Promise<Page> {
    const appRow = page.locator('.app-list tbody tr', { hasText: appName });
    await expect(appRow).toBeVisible();
    const selectButton = appRow.getByRole('button', { name: '選択' });
    await expect(selectButton).toBeVisible();
    await expect(selectButton).toBeEnabled();
    await selectButton.click();
    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    await expect(page.getByRole('heading', { name: 'バージョン管理' })).toBeVisible();

    const [editorPage] = await Promise.all([
        context.waitForEvent('page'),
        page.locator('.version-list tbody tr', { hasText: version }).getByRole('button', { name: 'エディタ' }).click(),
    ]);

    await editorPage.waitForLoadState('domcontentloaded');
    await expect(editorPage.locator('template-container')).toBeVisible();
    return editorPage;
};

/**
 * ダッシュボードの指定されたタブに移動します。
 * @param page ダッシュボードのPageオブジェクト
 * @param tabName 移動先のタブ名 ('workbench', 'publish', 'archive')
 */
export async function navigateToTab(page: Page, tabName: 'workbench' | 'publish' | 'archive'): Promise<void> {
    //console.log(tabName);
    await page.locator(`#${tabName}`).click();
    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    await expect(page.locator(`dashboard-main-content > dashboard-loading-overlay`)).toBeHidden();
}

/**
 * 【修正】アプリケーションがリストに表示されているか/いないかを確認します。
 * @param page ダッシュボードのPageオブジェクト
 * @param appName 確認するアプリケーション名
 * @param isVisible trueなら表示されていること、falseなら非表示であることを期待
 */
export async function expectAppVisibility(page: Page, appName: string, isVisible: boolean): Promise<void> {
    // 検証の前に、リストが更新される可能性のあるネットワーク通信が完了するのを待つ
    await page.waitForLoadState('networkidle');
    const appNameCell = page.locator('.app-list tbody tr td:first-child', { hasText: new RegExp(`^${appName}$`) });
    if (isVisible) {
        await expect(appNameCell).toBeVisible();
    } else {
        await expect(appNameCell).toBeHidden();
    }
}

/**
 * 公開タブでアプリケーションを選択し、バージョン一覧画面に遷移します。
 * @param page ダッシュボードのPageオブジェクト
 * @param appName 選択するアプリケーション名
 */
async function selectAppInPublishTab(page: Page, appName: string): Promise<void> {
    const appRow = page.locator('.app-list tbody tr', { hasText: appName });
    await appRow.getByRole('button', { name: '選択' }).click();
    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    await expect(page.getByRole('heading', { name: `公開設定: ${appName}` })).toBeVisible();
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
    await versionRow.getByRole('button', { name: '公開準備' }).click();
    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    let confirmDialog = page.locator('message-box#publish-action-confirm');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: '申請する' }).click();
    await page.getByText('処理中...').waitFor({ state: 'hidden' });

    // 公開準備完了まで待機
    await expect(async () => {
        await page.reload({ waitUntil: 'networkidle' });
        await navigateToTab(page, 'publish');
        await selectAppInPublishTab(page, appName);
        await expect(page.locator('.publish-list tbody tr', { hasText: version })).toContainText('公開準備完了', { timeout: 1000 });
    }).toPass({ timeout: 150000, intervals: [10000, 20000, 30000] });

    // 公開
    versionRow = page.locator('.publish-list tbody tr', { hasText: version });
    await versionRow.getByRole('button', { name: '公開', exact: true }).click();
    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    confirmDialog = page.locator('message-box#publish-action-confirm');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: '公開する' }).click();
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
    await versionRow.getByRole('button', { name: '非公開', exact: true }).click();
    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    const confirmDialog = page.locator('message-box#publish-action-confirm');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: '非公開にする' }).click();
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
    await versionRow.getByRole('button', { name: '公開準備' }).click();
    await page.getByText('処理中...').waitFor({ state: 'hidden' });

    const confirmDialog = page.locator('message-box#publish-action-confirm');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: '申請する' }).click();
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
    await expect(async () => {
        await page.reload({ waitUntil: 'networkidle' });
        await navigateToTab(page, 'publish');
        await selectAppInPublishTab(page, appName);
        await expect(page.locator('.publish-list tbody tr', { hasText: version })).toContainText('公開準備完了', { timeout: 1000 });
    }).toPass({ timeout: 150000, intervals: [10000, 20000, 30000] });

    // 公開中にする
    const readyVersionRow = page.locator('.publish-list tbody tr', { hasText: version });
    await readyVersionRow.getByRole('button', { name: '公開', exact: true }).click();
    await page.getByText('処理中...').waitFor({ state: 'hidden' });

    const publishConfirmDialog = page.locator('message-box#publish-action-confirm');
    await expect(publishConfirmDialog).toBeVisible();
    await publishConfirmDialog.getByRole('button', { name: '公開する' }).click();
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
    await expect(versionRow.locator('td').nth(1)).toHaveText(statusText);
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
    await appRow.getByRole('button', { name: '選択' }).click();
    await expect(page.getByRole('heading', { name: `公開設定: ${appName}` })).toBeVisible();

    const versionRow = page.locator('.publish-list tbody tr', { hasText: version });
    await versionRow.getByRole('button', { name: 'ＤＬ' }).click();
    await page.getByText('処理中...').waitFor({ state: 'hidden' });

    const confirmDialog = page.locator('message-box#download-confirm');
    await expect(confirmDialog).toBeVisible();

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        confirmDialog.getByRole('button', { name: 'ダウンロード' }).click(),
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
    const versionCell = page.locator('.version-list tbody tr td:first-child', { hasText: new RegExp(`^${version}$`) });
    if (isVisible) {
        await expect(versionCell).toBeVisible();
    } else {
        await expect(versionCell).toBeHidden();
    }
}

/**
 * バージョン管理画面で新しいバージョンを追加します。
 * @param page ダッシュボードのPageオブジェクト
 * @param versionName 追加するバージョン名
 */
export async function addVersion(page: Page, versionName: string): Promise<void> {
    await page.getByTitle('バージョンの追加').click();
    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    const modal = page.locator('dashboard-modal-window#versionModal');
    await expect(modal.getByRole('heading', { name: 'バージョンの追加' })).toBeVisible();

    await modal.getByLabel('バージョン').fill(versionName);
    await modal.getByRole('button', { name: '保存' }).click();

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

    const appRow = page.locator('.app-list tbody tr', { hasText: appName });
    await appRow.getByRole('button', { name: '選択' }).click();
    await expect(page.getByRole('heading', { name: 'バージョン管理' })).toBeVisible();

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
    await versionRow.getByRole('button', { name: '編集' }).click();
    await page.getByText('処理中...').waitFor({ state: 'hidden' });

    const modal = page.locator('dashboard-modal-window#versionModal');
    await expect(modal.getByRole('heading', { name: 'バージョンの編集' })).toBeVisible();

    await modal.getByLabel('バージョン').fill(newVersion);
    await modal.getByRole('button', { name: '保存' }).click();

    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
}

/**
 * バージョンを複製します。
 * @param page ダッシュボードのPageオブジェクト
 * @param sourceVersion 複製元のバージョン名
 */
export async function duplicateVersion(page: Page, sourceVersion: string): Promise<void> {
    const versionRow = page.locator('.version-list tbody tr', { hasText: sourceVersion });
    await versionRow.getByRole('button', { name: '複製' }).click();
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
    await versionRow.getByRole('button', { name: '削除' }).click();
    await page.getByText('処理中...').waitFor({ state: 'hidden' });

    const confirmDialog = page.locator('message-box#delete-confirm');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: '削除する' }).click();

    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
}