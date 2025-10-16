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
    await page.getByTitle('アプリケーションの追加').click();

    // モーダルウィンドウ自体を取得
    const appModal = page.locator('dashboard-modal-window#appModal');

    // モーダルの「コンテナ」ではなく、モーダルの「中身」が表示されるのを待つ。
    // この場合、ヘッダータイトルが最も確実。
    // これにより、コンテナのサイズが0x0である問題やShadow DOMの問題を回避できる。
    await expect(appModal.locator('span[slot="header-title"]')).toBeVisible();

    const appNameInput = page.locator('#input-app-name');
    await expect(appNameInput).toBeFocused();
    await expect(appNameInput).toBeEditable({ timeout: 10000 });
    await appNameInput.fill(appName);

    const appKeyInput = page.locator('#input-app-key');
    await expect(appKeyInput).toBeEditable({ timeout: 10000 });
    await appKeyInput.pressSequentially(appKey);

    await expect(appNameInput).toHaveValue(appName);
    await expect(appKeyInput).toHaveValue(appKey);

    await appModal.getByRole('button', { name: '保存' }).click();
    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    await expect(page.locator('dashboard-main-content > dashboard-loading-overlay')).toBeHidden();
    await expect(appModal).toBeHidden();
};

/**
 * ダッシュボード画面で指定されたアプリケーションを正常に削除します。
 * 主にテストのクリーンアップで使用します。
 * @param page ダッシュボードのPageオブジェクト
 * @param appKey 削除するアプリケーションキー
 */
export async function deleteApp(page: Page, appKey: string): Promise<void> {
    await page.bringToFront();
    await navigateToTab(page, 'workbench');

    const appRow = page.locator('.app-list tbody tr', { hasText: appKey });
    if (await appRow.count() > 0) {
        await appRow.getByRole('button', { name: '削除' }).click();

        // 1回目の「処理中...」待機（ここは短くても良い場合が多い）
        await page.getByText('処理中...').waitFor({ state: 'hidden', timeout: 30000 });

        const confirmDialog = page.locator('message-box#delete-confirm');
        await expect(confirmDialog).toBeVisible();
        await confirmDialog.getByRole('button', { name: '削除する' }).click();

        // 2回目の「処理中...」待機（サーバー処理）のタイムアウトを延長
        // サーバー側の削除処理は時間がかかる可能性があるため、90秒など十分に長く待つ
        await page.getByText('処理中...').waitFor({ state: 'hidden', timeout: 90000 });

        await expect(page.locator('dashboard-main-content > dashboard-loading-overlay')).toBeHidden();
    }
};

export async function openEditor(page: Page, context: BrowserContext, appName: string, version: string = '1.0.0'): Promise<Page> {
    const appRow = page.locator('.app-list tbody tr', { hasText: appName });
    await expect(appRow).toBeVisible();
    const selectButton = appRow.getByRole('button', { name: '選択' });
    await expect(selectButton).toBeVisible();
    await expect(selectButton).toBeEnabled();
    await selectButton.click();
    await page.getByText('処理中...').waitFor({ state: 'hidden' });
    await expect(page.getByRole('heading', { name: 'バージョン管理' })).toBeVisible();

    const editorPagePromise = context.waitForEvent('page');
    await page.locator('.version-list tbody tr', { hasText: version }).getByRole('button', { name: 'エディタ' }).click();
    const editorPage = await editorPagePromise;

    await editorPage.waitForLoadState('domcontentloaded');

    // EditorHelperをインスタンス化して、ダイアログ処理を呼び出す
    const tempHelper = new EditorHelper(editorPage, false);
    await tempHelper.handleSnapshotRestoreDialog();

    await expect(editorPage.locator('ios-component')).toBeVisible();
    await page.getByText('処理中...').waitFor({ state: 'hidden' });
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
 * アプリケーションがリストに表示されているか/いないかを確認します。
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
    await waitForVersionStatus(page, appName, version, '公開準備完了');

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
    await waitForVersionStatus(page, appName, version, '公開準備完了');

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
    await expect(appRow).toBeVisible();
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
 * @param page ダッシュボードのPageオブジェクト
 */
export async function navigateToSettings(page: Page): Promise<void> {
    // メニューボタンをクリック
    await page.locator('button.menu-button[title="メニュー"]').click();

    // メニューリストが表示されるのを待つ
    const menuList = page.locator('#appMenuList');
    await expect(menuList).toBeVisible();

    // 「設定」メニュー項目をクリック
    // この要素はdivなので、getByRole('button')ではなくlocatorで特定します
    await menuList.locator('.dashboard-menu-item', { hasText: '設定' }).click();

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

    // 2. AI機能のチェックボックスと現在の状態を取得
    const checkbox = page.locator('#aiCodingCheckbox');
    const isCurrentlyEnabled = await checkbox.isChecked();

    // 3. 目標の状態と現在の状態が同じであれば、何もしないで終了
    if (isCurrentlyEnabled === enable) {
        console.log(`AI機能は既に ${enable ? '有効' : '無効'} です。`);
        await closeSettings(page); // 設定画面を閉じて終了
        return;
    }

    // 4. トグルスイッチをクリックして状態を変更
    // input自体ではなく、関連付けられたlabelをクリックするのが堅牢です
    await page.locator('label[for="aiCodingCheckbox"]').click();

    // 5. 【有効化する場合のみ】年齢確認モーダルを処理
    if (enable) {
        // モーダルが表示されるのを待つ
        const parentModal = page.locator('#aiCodingConfirmModal');
        const modal = parentModal.locator('.modal');
        await expect(modal).toBeVisible();
        await expect(parentModal.locator('span[slot="header-title"]')).toHaveText('確認');

        // 「はい」ボタンをクリック
        await parentModal.locator('span[slot="submit-button-text"]').click();

        // モーダルが閉じるのを待つ
        await expect(parentModal).toBeHidden();
    }

    // 6. 最終的な状態を検証
    if (enable) {
        await expect(checkbox).toBeChecked({ timeout: 5000 });
    } else {
        await expect(checkbox).not.toBeChecked({ timeout: 5000 });
    }

    // 7. 設定画面を閉じる
    await closeSettings(page);
}

/**
 * 設定画面（メニュー）を閉じます。
 * 画面のどこかをクリックすることでメニューが閉じると想定しています。
 * アプリケーションの実装に合わせて調整してください。
 * @param page ダッシュボードのPageオブジェクト
 */
export async function closeSettings(page: Page): Promise<void> {
    // 設定メニュー以外の場所（例: アプリケーション一覧の見出し）をクリックして閉じる
    // もし専用の閉じるボタンがあれば、そちらを操作する方が確実です
    const accountSetting = page.locator('dashboard-account-setting');
    await accountSetting.click({ position: { x: 10, y: 10 } });
    await expect(page.locator('.setting-content')).toBeHidden();
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
        console.log('APIキーは既に登録されています。処理をスキップします。');
        await closeSettings(page); // 設定画面を閉じて終了
        return;
    }

    // 3. APIキーを入力して保存ボタンをクリック
    await apiKeyForm.locator('input#gemini-api-key').fill(apiKey);
    await apiKeyForm.locator('button.save-api-key-button').click();

    // 4. 登録成功のアラートが表示されるのを待ち、閉じる
    const successAlert = page.locator('.alert', { hasText: 'APIキーを登録しました。' });
    await expect(successAlert).toBeVisible();
    await successAlert.locator('button#closeButton').click();
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
        console.log('APIキーは登録されていません。処理をスキップします。');
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
    await registeredDisplay.locator('button.delete-api-key-button').click();

    // 5. 削除成功のアラートが表示されるのを待ち、閉じる
    const deleteAlert = page.locator('.alert', { hasText: 'APIキーを削除しました。' });
    await expect(deleteAlert).toBeVisible();
    await deleteAlert.locator('button#closeButton').click();
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
        await page.reload({ waitUntil: 'domcontentloaded' });

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