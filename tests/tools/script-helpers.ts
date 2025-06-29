import { expect, FrameLocator, Locator, type Page } from '@playwright/test';
import { getPropertyContainer, getPreviewFrame, saveAndOpenTestPage, selectNodeInDomTree, switchTabInContainer } from './editor-helpers'; // 既存のヘルパーを再利用

/**
 * 指定したイベントに、新しいスクリプトを特定の名前で追加します。
 * @param editorPage エディタのPageオブジェクト
 * @param eventName イベント名 (例: 'DOMContentLoaded', 'click')
 * @param scriptName 作成するスクリプト名 (例: 'sample001')
 */
export async function addScriptToEvent(
    editorPage: Page, // 引数を editorPage に戻し、内部でコンテナを探す
    { eventName, scriptName }: { eventName: string; scriptName: string }
): Promise<void> {
    // script-container を特定する
    const scriptContainer = editorPage.locator('script-container');

    // 指定されたイベント名の行を探す
    const eventRow = scriptContainer.locator(`div.editor-row:has(div.label:text-is("${eventName}"))`);
    await expect(eventRow).toBeVisible();

    // その行にある「スクリプトの追加」ボタンをクリック
    await eventRow.getByTitle('スクリプトの追加').click();

    // スクリプト追加メニューが表示されるのを待つ
    const scriptAddMenu = editorPage.locator('event-container #scriptAddMenu');
    await expect(scriptAddMenu).toBeVisible();

    // スクリプト名を入力し、追加ボタンをクリック
    await scriptAddMenu.locator('#script-name').fill(scriptName);
    await expect(scriptAddMenu).toBeVisible();
    await expect(scriptAddMenu).toBeEnabled();
    await scriptAddMenu.locator('#edit-add-script').click();
    await expect(scriptAddMenu).toBeHidden();

    // イベント行（eventRow）の中に、新しいスクリプト名が表示されることを検証する。
    await expect(eventRow.getByText(scriptName)).toBeVisible();
}

/**
 * イベントに関連付けられたスクリプトを編集し、保存します。
 */
export async function editScript(
    editorPage: Page,
    { eventName, scriptName, scriptContent }: { eventName: string; scriptName: string; scriptContent: string }
): Promise<void> {
    const scriptContainer = editorPage.locator('script-container');
    await expect(scriptContainer).toBeVisible();
    const eventContainer = scriptContainer.locator('event-container');
    await expect(eventContainer).toBeVisible();

    // eventNameとscriptNameの両方を含む、非常に具体的なテキストで一意な行を特定する。
    // 'DOMの読み込み完了'のような説明文はイベントによって変わるため、ここでは含めない。
    //console.log(`eventName : ${eventName}, scriptName : ${scriptName}`)
    //const scriptRow = eventContainer.getByText(new RegExp(`${eventName}.*${scriptName}`));

    const eventRow = eventContainer.locator(`div.editor-row:has(div.label:text-is("${eventName}"))`);
    //console.log(`eventRowInnner : ${await eventRow.innerHTML()}`)
    await expect(eventRow).toBeVisible();

    const scriptRow = eventRow.locator(`div.editor-row-right-item`).filter({ hasText: scriptName });
    await expect(scriptRow).toBeVisible();

    // その行にある「スクリプトの編集」ボタンをクリック
    await scriptRow.getByTitle('スクリプトの編集').click();

    // Monaco Editorが表示されるのを待つ
    const monacoEditor = scriptContainer.locator('.monaco-editor[role="code"]');
    await expect(monacoEditor).toBeVisible();

    // エディタの内容を全選択して削除する
    //await monacoEditor.locator('.view-lines').click(); // フォーカスを当てる
    const viewLines = monacoEditor.locator('.view-lines');
    await expect(viewLines).toBeVisible();
    // 最初の1行目を取得
    const firstLine = viewLines.locator('.view-line').first();
    await firstLine.click(); // フォーカスを当てる
    await editorPage.keyboard.press('Control+A');
    await editorPage.keyboard.press('Delete');

    // 現在のブラウザ名を取得
    const browserName = editorPage.context().browser()?.browserType().name();

    if (browserName === 'chromium') {
        // Chrome (Chromium) の場合の処理
        // Monaco Editorは内部的に<textarea>を持っているので、それに対してfillするのが速くて確実
        await monacoEditor.locator('textarea').fill(scriptContent);
    } else if (browserName === 'webkit') {
        await monacoEditor.locator('textarea').fill(scriptContent);
    } else if (browserName === 'firefox') {
        // Firefox の場合の処理
        // Firefoxではfillが効かないことがあるため、キーボード入力をシミュレートする
        const viewLine = monacoEditor.locator('.view-line').first(); // 確実に最初の行を掴む
        await expect(viewLine).toBeVisible();
        await viewLine.pressSequentially(scriptContent);
    } else {
        // その他のブラウザ用のフォールバック（Firefoxと同じ方法を試す）
        console.warn(`Unsupported browser for optimized fill: ${browserName}. Falling back to pressSequentially.`);
        const viewLine = monacoEditor.locator('.view-line').first();
        await expect(viewLine).toBeVisible();
        await viewLine.pressSequentially(scriptContent);
    }

    // 「スクリプトの保存」ボタンをクリック
    const saveButton = scriptContainer.getByTitle('スクリプトの保存');
    const saveIcon = saveButton.locator('i');
    await expect(saveIcon).toHaveAttribute("class", "fa-solid fa-floppy-disk shake-save-button");
    await scriptContainer.getByTitle('スクリプトの保存').click();
    await expect(saveIcon).toHaveAttribute("class", "fa-solid fa-floppy-disk",)
}

/**
 * プレビュー（Renderzone）内の<script>タグを調べ、期待するコードが含まれているか検証します。
 * @param editorPage エディタのPageオブジェクト
 * @param expectedContent 期待するスクリプト文字列
 */
export async function verifyScriptInPreview(editorPage: Page, expectedContent: string): Promise<void> {
    const previewFrame = getPreviewFrame(editorPage);
    await previewFrame.locator('body').waitFor({ state: 'visible' });
    const scripts = previewFrame.locator('script');

    // 全てのscriptタグを結合したテキストを取得
    const allScriptsContent = await scripts.allTextContents();
    const combinedText = allScriptsContent.join('\n');

    // 文字列を正規化してから比較する
    const normalizedReceived = normalizeWhitespace(combinedText);
    const normalizedExpected = normalizeWhitespace(expectedContent);

    // 結合したテキストの中に期待する内容が含まれているか検証
    expect(normalizedReceived).toContain(normalizedExpected);
}

/**
 * 実機テストページを開き、その中の main.js の内容を検証します。
 * @param testPage 実機テストページのPageオブジェクト
 * @param expectedContents 期待するスクリプト文字列、またはその配列
 */
export async function verifyScriptInTestPage(testPage: Page, expectedContents: string | string[]): Promise<void> {
    await testPage.waitForLoadState('domcontentloaded');

    const mainJsContent = await testPage.evaluate(async () => {
        const scriptElement = document.querySelector<HTMLScriptElement>('script[src*="main.js"]');
        if (!scriptElement) return null;
        const response = await fetch(scriptElement.src);
        return response.ok ? response.text() : null;
    });

    expect(mainJsContent, '実機テストページのmain.jsが見つからないか、取得に失敗しました。').not.toBeNull();

    const normalizedReceived = normalizeWhitespace(mainJsContent || '');
    if (Array.isArray(expectedContents)) {
        for (const content of expectedContents) {
            // 文字列を正規化してから比較する

            const normalizedExpected = normalizeWhitespace(content);

            // 結合したテキストの中に期待する内容が含まれているか検証
            expect(normalizedReceived).toContain(normalizedExpected);
            //expect(mainJsContent).toContain(content);
        }
    } else {
        expect(mainJsContent).toContain(expectedContents);
    }
}

/**
 * 指定したノードの特定のイベントに、新しいスクリプトを追加します。
 * アプリケーションレベルのイベント、ページレベルのイベントの両方に対応します。
 * @param editorPage エディタのPageオブジェクト
 * @param nodeLocator イベントを追加する対象のノード (例: ページノード)
 * @param eventName イベント名 (例: 'init', 'show')
 * @param scriptName 作成するスクリプト名
 */
export async function addScriptToNodeEvent(
    editorPage: Page,
    { nodeLocator, eventName, scriptName }: { nodeLocator: Locator, eventName: string, scriptName: string }
): Promise<void> {
    // 1. 対象のノードを選択状態にする
    await selectNodeInDomTree(nodeLocator);

    // 2. イベントタブに切り替える
    const scriptContainer = editorPage.locator('script-container');
    await switchTabInContainer(scriptContainer, 'イベント');

    // 3. スクリプトを追加する（addScriptToEventヘルパーを再利用）
    await addScriptToEvent(editorPage, { eventName, scriptName });
}


/**
 * ページまたはプレビューフレーム内で、特定の順番でアラートが表示され、
 * それぞれを閉じることを安定的に検証します。
 * @param pageOrFrame PageオブジェクトまたはFrameLocatorオブジェクト
 * @param expectedText 期待するアラートのテキスト
 */
export async function verifyAndCloseAlert(
    pageOrFrame: Page | FrameLocator,
    expectedText: string
): Promise<void> {
    // ステップ1: ダイアログ要素そのものが表示されるのを待つ
    const alertDialog = pageOrFrame.locator('ons-alert-dialog').filter({ hasText: expectedText });

    await expect(alertDialog).toBeVisible({ timeout: 10000 });

    // ステップ2: ダイアログに期待するテキストが含まれるのを待つ
    // `.alert-dialog-content` など、より具体的なセレクタがあればそちらを推奨
    await expect(alertDialog).toContainText(expectedText);

    // ステップ3: クリック対象のボタンが操作可能になるのを待つ
    const alertButton = alertDialog.locator('ons-alert-dialog-button');
    await expect(alertButton).toBeEnabled();

    // ステップ4: クリックを実行
    await alertButton.click();

    // ステップ5: ダイアログが非表示になるのを待つ
    await expect(alertDialog).toBeHidden();

}

/**
 * 新しいスクリプトを追加します。
 * @param page - Pageオブジェクト
 * @param scriptName - 追加するスクリプトの名前
 * @param scriptType - 'function' または 'class'
 */
export async function addNewScript(page: Page, scriptName: string, scriptType: 'function' | 'class' = 'function') {
    const scriptContainer = page.locator('script-container');

    // スクリプト追加ボタンをクリック
    const scriptListContainer = scriptContainer.locator('#script-list-container');

    // スクリプト追加ボタンを取得
    const scriptAddButton = scriptListContainer.getByTitle("スクリプトの追加");

    // クリック
    await scriptAddButton.click();

    // スクリプト追加メニューが表示されるのを待つ
    const addMenu = scriptListContainer.locator('#scriptAddMenu');
    await expect(addMenu).toBeVisible();

    // スクリプトタイプを選択
    await addMenu.locator(`input[type="radio"][value="${scriptType}"]`).check();

    // スクリプト名を入力
    await addMenu.locator('input#script-name').fill(scriptName);

    // 追加ボタンをクリック
    await addMenu.locator('button:has-text("追加")').click();

    // メニューが非表示になることを確認
    await expect(addMenu).toBeHidden();

    // スクリプトがリストに追加されたことを確認
    await expect(scriptContainer.locator(`.editor-row-left:has-text("${scriptName}")`)).toBeVisible();
}

/**
 * 既存のスクリプトの内容を書き換えます。
 * @param page - Pageオブジェクト
 * @param scriptName - 編集するスクリプトの名前
 * @param scriptContent - 新しいスクリプトのコード内容
 */
export async function editScriptContent(page: Page, scriptName: string, scriptContent: string) {
    const scriptContainer = page.locator('script-container');

    // 編集対象のスクリプト行を探し、編集ボタンをクリック
    const scriptRow = scriptContainer.locator('.editor-row', { hasText: scriptName });

    await scriptRow.getByTitle('スクリプトの編集').click();

    // Monaco Editorが表示されるのを待つ
    const editorContainer = scriptContainer.locator('#script-container');
    await expect(editorContainer).toBeVisible();
    // Monaco Editorが表示されるのを待つ
    const monacoEditor = editorContainer.locator('.monaco-editor[role="code"]');

    await expect(monacoEditor).toBeVisible();

    // // 現在のブラウザ名を取得
    // const browserName = page.context().browser()?.browserType().name();

    // // エディタの内容を全選択して削除する
    // await monacoEditor.locator('.view-lines').click(); // フォーカスを当てる
    // if (browserName === 'webkit') {
    //     await page.keyboard.press('Command+A');
    // } else {
    //     await page.keyboard.press('Control+A');
    // }
    // await page.keyboard.press('Delete');

    // if (browserName === 'chromium') {
    //     // Chrome (Chromium) の場合の処理
    //     // Monaco Editorは内部的に<textarea>を持っているので、それに対してfillするのが速くて確実
    //     await monacoEditor.locator('textarea').fill(scriptContent);
    // } else if (browserName === 'webkit') {
    //     const viewLine = monacoEditor.locator('.view-line').first(); // 確実に最初の行を掴む
    //     await expect(viewLine).toBeVisible();
    //     await viewLine.pressSequentially(scriptContent);
    //     await viewLine.press('Shift+Command+ArrowDown');
    //     await viewLine.press('Delete');
    // } else if (browserName === 'firefox') {
    //     // Firefox の場合の処理
    //     // Firefoxではfillが効かないことがあるため、キーボード入力をシミュレートする
    //     const viewLine = monacoEditor.locator('.view-line').first(); // 確実に最初の行を掴む
    //     await expect(viewLine).toBeVisible();
    //     await viewLine.pressSequentially(scriptContent);
    //     await viewLine.press('Shift+Control+End');
    //     await viewLine.press('Delete');
    // } else {
    //     // その他のブラウザ用のフォールバック（Firefoxと同じ方法を試す）
    //     console.warn(`Unsupported browser for optimized fill: ${browserName}. Falling back to pressSequentially.`);
    //     const viewLine = monacoEditor.locator('.view-line').first();
    //     await expect(viewLine).toBeVisible();
    //     await viewLine.pressSequentially(scriptContent);
    //     await viewLine.press('Shift+Control+End');
    //     await viewLine.press('Delete');
    // }

    // 現在のブラウザ名を取得
    const browserName = page.context().browser()?.browserType().name();

    // エディタの内容を全選択して削除する
    await monacoEditor.locator('.view-lines').click(); // フォーカスを当てる
    if (browserName === 'webkit') {
        await page.keyboard.press('Command+A');
    } else {
        await page.keyboard.press('Control+A');
    }
    await page.keyboard.press('Delete');

    if (browserName === 'chromium') {
        // Chrome (Chromium) の場合の処理
        // Monaco Editorは内部的に<textarea>を持っているので、それに対してfillするのが速くて確実
        await monacoEditor.locator('textarea').fill(scriptContent);
    } else if (browserName === 'webkit') {
        const viewLine = monacoEditor.locator('.view-line').first(); // 確実に最初の行を掴む
        await expect(viewLine).toBeVisible();
        await viewLine.pressSequentially(scriptContent);
        await viewLine.press('Shift+Command+ArrowDown');
        await viewLine.press('Delete');
    } else if (browserName === 'firefox') {
        // Firefox の場合の処理
        // Firefoxではfillが効かないことがあるため、キーボード入力をシミュレートする
        const viewLine = monacoEditor.locator('.view-line').first(); // 確実に最初の行を掴む
        await expect(viewLine).toBeVisible();
        await viewLine.pressSequentially(scriptContent);
        await viewLine.press('Shift+Control+End');
        await viewLine.press('Delete');
    } else {
        // その他のブラウザ用のフォールバック（Firefoxと同じ方法を試す）
        console.warn(`Unsupported browser for optimized fill: ${browserName}. Falling back to pressSequentially.`);
        const viewLine = monacoEditor.locator('.view-line').first();
        await expect(viewLine).toBeVisible();
        await viewLine.pressSequentially(scriptContent);
        await viewLine.press('Shift+Control+End');
        await viewLine.press('Delete');
    }


    // 保存ボタンをクリック
    await scriptContainer.locator('#fab-save').click();

    // エディタが閉じてリスト表示に戻ることを確認
    //await expect(editorContainer).toBeHidden();
}

/**
 * 文字列から改行を削除し、連続する空白を1つのスペースに変換する
 * @param str - 対象の文字列
 * @returns 正規化された文字列
 */
export const normalizeWhitespace = (str: string): string => {
    return str.replace(/\s+/g, ' ').trim();
};