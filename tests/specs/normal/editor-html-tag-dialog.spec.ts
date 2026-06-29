import { test as base, expect, Page, Locator } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';
import { STORAGE_STATE } from '../../constants';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

let appName: string;
let appKey: string;

type EditorFixtures = {
    editorPage: Page;
    editorHelper: EditorHelper;
};

const test = base.extend<EditorFixtures>({
    editorPage: async ({ page, context }, use) => {
        await gotoDashboard(page);
        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });

        // 作成済みの共有アプリ詳細画面へ移動
        const appRow = page.locator('.app-card', { has: page.locator('.app-key', { hasText: appKey }) }).first();
        await expect(appRow).toBeVisible({ timeout: 15000 });
        await appRow.click({ force: true });
        await expect(page.locator('.detail-tab.active')).toBeVisible({ timeout: 10000 });

        const editorPage = await openEditor(page, context, appName);
        await use(editorPage);
        await editorPage.close();
    },
    editorHelper: async ({ editorPage, isMobile }, use) => {
        const helper = new EditorHelper(editorPage, isMobile);
        await use(helper);
    },
});

// テスト全体の開始前に、アプリを1回だけ作成する
test.beforeAll(async ({ browser }) => {
    const reversedTimestamp = Date.now().toString().split('').reverse().join('');
    const uniqueId = `${testRunSuffix}-${reversedTimestamp}`;
    appName = `html-tag-test-${uniqueId}`.slice(0, 30);
    appKey = `key-tag-${uniqueId}`.slice(0, 30);

    // 認証済みの状態を引き継ぐためのコンテキストを作成（STORAGE_STATE定数を使用）
    const context = await browser.newContext({ storageState: STORAGE_STATE });
    const page = await context.newPage();

    await gotoDashboard(page);
    await createApp(page, appName, appKey);

    await context.close();
});

// すべてのテストが終了した後に、アプリを1回だけ削除する
test.afterAll(async ({ browser }) => {
    if (appKey) {
        const context = await browser.newContext({ storageState: STORAGE_STATE });
        const page = await context.newPage();

        await gotoDashboard(page);
        await deleteApp(page, appKey);

        await context.close();
    }
});

test.describe('HTMLタグ選択ダイアログ機能のテスト', () => {
    test.beforeEach(async ({ page }) => {
        await gotoDashboard(page);
    });

    test('プリセットボタンからHTMLタグを追加できること', async ({ editorPage, editorHelper }) => {
        await editorHelper.addPage();
        const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
        const targetLocator = editorPage.locator(contentAreaSelector);

        // 1. ドラッグ＆ドロップを実行してダイアログを表示
        await editorHelper.openMoveingHandle('left');
        await editorPage.locator('tool-box-item', { hasText: 'HTML Tag' }).dragTo(targetLocator);

        const dialog = editorPage.locator('template-container message-box#html-tag-select-dialog');
        await expect(dialog).toBeVisible({ timeout: 5000 });

        // 2. プリセットから「span」を選択
        const spanButton = dialog.locator('button.title-icon-bar-button', { hasText: /^span$/ });
        await spanButton.click();

        // 3. ダイアログが閉じて、エディタのツリー上に要素が追加されたことを確認
        await expect(dialog).toBeHidden();
        const newHtmlTagNode = targetLocator.locator('> .node[data-node-type="span"]');
        await expect(newHtmlTagNode).toBeVisible();

        // 中身が空のタグは幅や高さが0になり visibility 判定で落ちるため、Attached で検証
        const previewElement = editorHelper.getPreviewElement('span');
        await expect(previewElement).toBeAttached();
    });

    test('手入力欄からカスタムタグを入力して追加できること', async ({ editorPage, editorHelper }) => {
        await editorHelper.addPage();
        const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
        const targetLocator = editorPage.locator(contentAreaSelector);

        await editorHelper.openMoveingHandle('left');
        await editorPage.locator('tool-box-item', { hasText: 'HTML Tag' }).dragTo(targetLocator);

        const dialog = editorPage.locator('template-container message-box#html-tag-select-dialog');
        await expect(dialog).toBeVisible();

        // 1. 手入力欄にカスタムタグ「section」を入力してEnterで決定
        const input = dialog.locator('input#custom-tag-input');
        await expect(input).toBeEditable();
        await input.fill('section');
        await input.press('Enter');

        // 2. ダイアログが閉じて、エディタのツリー上に要素が追加されたことを確認
        await expect(dialog).toBeHidden();
        const newHtmlTagNode = targetLocator.locator('> .node[data-node-type="section"]');
        await expect(newHtmlTagNode).toBeVisible();

        // 中身が空のタグは幅や高さが0になり visibility 判定で落ちるため、Attached で検証
        const previewElement = editorHelper.getPreviewElement('section');
        await expect(previewElement).toBeAttached();
    });

    test('ダイアログでキャンセルボタンを押したとき、タグが追加されないこと', async ({ editorPage, editorHelper }) => {
        await editorHelper.addPage();
        const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
        const targetLocator = editorPage.locator(contentAreaSelector);

        await editorHelper.openMoveingHandle('left');
        await editorPage.locator('tool-box-item', { hasText: 'HTML Tag' }).dragTo(targetLocator);

        const dialog = editorPage.locator('template-container message-box#html-tag-select-dialog');
        await expect(dialog).toBeVisible();

        // 1. キャンセルボタンをクリック
        const cancelBtn = dialog.locator('[slot="cancel-slot"]');
        await cancelBtn.click();

        // 2. ダイアログが閉じる
        await expect(dialog).toBeHidden();

        // 3. 要素が追加されていないことを検証
        const childNodes = targetLocator.locator('> .node');
        await expect(childNodes).toHaveCount(0);
    });

    test('不適切なタグ名を入力した際、エラーアラートが表示され追加がブロックされること', async ({ editorPage, editorHelper }) => {
        await editorHelper.addPage();
        const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
        const targetLocator = editorPage.locator(contentAreaSelector);

        await editorHelper.openMoveingHandle('left');
        await editorPage.locator('tool-box-item', { hasText: 'HTML Tag' }).dragTo(targetLocator);

        const dialog = editorPage.locator('template-container message-box#html-tag-select-dialog');
        await expect(dialog).toBeVisible();

        // 1. 不適切な文字列（タグ名に使えない記号など）を入力して追加
        const input = dialog.locator('input#custom-tag-input');
        await expect(input).toBeEditable();
        await input.fill('invalid<tag>');

        const okBtn = dialog.locator('[slot="ok-slot"]');
        await okBtn.click();

        // 2. ダイアログは一旦閉じる
        await expect(dialog).toBeHidden();

        // 3. バリデーションアラート（alert-component）が立ち上がることを検証
        const alert = editorPage.locator('alert-component');
        await expect(alert).toBeVisible();
        await expect(alert).toContainText('タグとして不適切な文字列です');

        // 4. アラートを閉じる
        await alert.getByRole('button', { name: '閉じる' }).click();
        await expect(alert).toBeHidden();

        // 5. タグが追加されていないことを検証
        const childNodes = targetLocator.locator('> .node');
        await expect(childNodes).toHaveCount(0);
    });
});