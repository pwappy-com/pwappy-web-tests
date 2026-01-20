// file-explorer-operations.spec.ts

import { test as base, expect, Page } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

type EditorFixtures = {
    editorPage: Page;
    appName: string;
    editorHelper: EditorHelper;
};

const test = base.extend<EditorFixtures>({
    appName: async ({ }, use) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        await use(`fe-test-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName }, use) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appKey = `fe-key-${uniqueId}`.slice(0, 30);

        // ここで page がダッシュボードにいる必要があるため、beforeEach の goto が必須
        await createApp(page, appName, appKey);
        const editorPage = await openEditor(page, context, appName);
        await use(editorPage);
        await editorPage.close();
        await deleteApp(page, appKey);
    },
    editorHelper: async ({ editorPage, isMobile }, use) => {
        const helper = new EditorHelper(editorPage, isMobile);
        await use(helper);
    },
});

test.describe('ファイルエクスプローラー操作テスト', () => {

    test.beforeEach(async ({ page, context, browserName }) => {
        if (browserName === 'chromium') {
            await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        }

        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        const domain = testUrl.hostname;

        // 1. Cookieの設定
        await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/' },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/' },
            { name: 'pwappy_login', value: '1', domain: domain, path: '/' },
        ]);

        // 2. 【重要】サイトへ移動
        await page.goto(String(process.env.PWAPPY_TEST_BASE_URL), { waitUntil: 'domcontentloaded' });

        // 3. 【重要】ダッシュボードの初期ローディング（「処理中」）が消えるのを待つ
        // これをしないと、createApp 内の「アプリケーションの追加」ボタンがクリックできません
        const loadingOverlay = page.locator('dashboard-main-content > dashboard-loading-overlay');
        await expect(loadingOverlay).toBeHidden({ timeout: 30000 });

        await expect(page.getByRole('heading', { name: 'アプリケーション一覧' })).toBeVisible();
    });

    test('ディレクトリのコピー＆ペーストができる', async ({ editorPage, editorHelper }) => {
        const srcDir = 'CopySrc';
        const destDir = 'CopyDest';

        await test.step('1. ファイルエクスプローラーを開き、テスト用ディレクトリを作成', async () => {
            await editorHelper.openFileExplorer();
            await editorHelper.createDirectory(srcDir);
            await editorHelper.createDirectory(destDir);
        });

        await test.step('2. コピー元のディレクトリを選択してコピー', async () => {
            await editorHelper.selectFileExplorerItem(srcDir);
            await editorHelper.performFileOperation('コピー');
        });

        await test.step('3. コピー先のディレクトリに移動して貼り付け', async () => {
            await editorHelper.enterDirectory(destDir);
            await editorHelper.performFileOperation('貼り付け');
        });

        await test.step('4. 貼り付けられたディレクトリが存在することを確認', async () => {
            // editorPage 内の file-explorer を探す
            const pastedItem = editorPage.locator('file-explorer .directory', { hasText: srcDir });
            await expect(pastedItem).toBeVisible();
        });

        await test.step('5. 元のディレクトリも残っていることを確認（ルートに戻る）', async () => {
            await editorHelper.goBackToRoot();
            const originalItem = editorPage.locator('file-explorer .directory', { hasText: srcDir });
            await expect(originalItem).toBeVisible();
        });
    });

    test('ディレクトリの移動（切り取り＆ペースト）ができる', async ({ editorPage, editorHelper }) => {
        const moveTargetDir = 'MoveTarget';
        const moveDestDir = 'MoveDest';

        await test.step('1. ファイルエクスプローラーを開き、テスト用ディレクトリを作成', async () => {
            await editorHelper.openFileExplorer();
            await editorHelper.createDirectory(moveTargetDir);
            await editorHelper.createDirectory(moveDestDir);
        });

        await test.step('2. 移動対象のディレクトリを選択して切り取り', async () => {
            await editorHelper.selectFileExplorerItem(moveTargetDir);
            await editorHelper.performFileOperation('切り取り');

            // 切り取り状態（透明度：cut-stateクラス）の検証
            const targetItem = editorPage.locator('file-explorer .directory', { hasText: moveTargetDir });
            await expect(targetItem).toHaveClass(/cut-state/);
        });

        await test.step('3. 移動先のディレクトリに移動して貼り付け', async () => {
            await editorHelper.enterDirectory(moveDestDir);
            await editorHelper.performFileOperation('貼り付け');
        });

        await test.step('4. 移動したディレクトリが存在することを確認', async () => {
            const movedItem = editorPage.locator('file-explorer .directory', { hasText: moveTargetDir });
            await expect(movedItem).toBeVisible();
        });

        await test.step('5. 元の場所からディレクトリが消えていることを確認', async () => {
            await editorHelper.goBackToRoot();

            // goBackToRoot 内で waitForFileExplorerLoading を呼んでいるため、
            // ここでは即座に確認しても大丈夫だが、念のため locator を再取得する
            const originalItem = editorPage.locator('file-explorer .directory', { hasText: moveTargetDir });
            await expect(originalItem).toBeHidden();
        });
    });

    test('ファイルのコピー・移動・削除の一連の操作ができる', async ({ editorPage, editorHelper }) => {
        const folderA = 'FolderA';
        const folderB = 'FolderB';
        const fileName = 'favicon.ico';

        await test.step('1. ファイルエクスプローラーを開き、作業用ディレクトリを作成', async () => {
            await editorHelper.openFileExplorer();
            await editorHelper.createDirectory(folderA);
            await editorHelper.createDirectory(folderB);
        });

        await test.step('2. favicon.ico をコピーして FolderA に貼り付け', async () => {
            // ルートにある favicon.ico を選択
            await editorHelper.selectFileExplorerItem(fileName);
            await editorHelper.performFileOperation('コピー');

            // FolderA に入って貼り付け
            await editorHelper.enterDirectory(folderA);
            await editorHelper.performFileOperation('貼り付け');

            // 検証: FolderA 内にファイルが存在すること
            const pastedFile = editorPage.locator('file-explorer .file', { hasText: fileName });
            await expect(pastedFile).toBeVisible();
        });

        await test.step('3. FolderA 内のファイルを切り取って FolderB に移動', async () => {
            // FolderA 内のファイルを選択して切り取り
            await editorHelper.selectFileExplorerItem(fileName);
            await editorHelper.performFileOperation('切り取り');

            // 一旦ルートに戻ってから FolderB へ
            await editorHelper.goBackToRoot();
            await editorHelper.enterDirectory(folderB);
            await editorHelper.performFileOperation('貼り付け');

            // 検証: FolderB 内にファイルが存在すること
            const movedFile = editorPage.locator('file-explorer .file', { hasText: fileName });
            await expect(movedFile).toBeVisible();
        });

        await test.step('4. 移動したファイルを削除する', async () => {
            // FolderB 内のファイルを選択して削除
            await editorHelper.selectFileExplorerItem(fileName);
            await editorHelper.performFileOperation('削除');

            // 検証: FolderB から消えていること
            const deletedFile = editorPage.locator('file-explorer .file', { hasText: fileName });
            await expect(deletedFile).toBeHidden();
        });

        await test.step('5. 他のディレクトリに影響がないことを確認', async () => {
            // ルートに戻る
            await editorHelper.goBackToRoot();
            // 最初からあるルートの favicon.ico は残っているはず
            await expect(editorPage.locator('file-explorer .file', { hasText: fileName })).toBeVisible();

            // FolderA は空になっているはず
            await editorHelper.enterDirectory(folderA);
            await expect(editorPage.locator('file-explorer .file', { hasText: fileName })).toBeHidden();
        });
    });

    test('アイテムの全選択・全解除ができる', async ({ editorPage, editorHelper }) => {
        await test.step('1. テスト用ディレクトリを複数作成', async () => {
            await editorHelper.openFileExplorer();
            await editorHelper.createDirectory('Select1');
            await editorHelper.createDirectory('Select2');
        });

        await test.step('2. 全選択を実行', async () => {
            await editorHelper.toggleAllSelect();
            // すべてのアイテムに .selected クラスが付いていることを確認
            const items = editorPage.locator('file-explorer .directory');
            const count = await items.count();
            for (let i = 0; i < count; i++) {
                await expect(items.nth(i)).toHaveClass(/selected/);
            }
        });

        await test.step('3. 全解除を実行', async () => {
            await editorHelper.toggleAllSelect();
            const items = editorPage.locator('file-explorer .directory');
            const count = await items.count();
            for (let i = 0; i < count; i++) {
                await expect(items.nth(i)).not.toHaveClass(/selected/);
            }
        });
    });

    test('名前変更とパスのコピーができる', async ({ editorPage, editorHelper }) => {
        const oldName = 'OldDir';
        const newName = 'NewDir';

        await test.step('1. ディレクトリを作成して選択', async () => {
            await editorHelper.openFileExplorer();
            await editorHelper.createDirectory(oldName);
            await editorHelper.selectFileExplorerItem(oldName);
        });

        await test.step('2. パスをコピー', async () => {
            // クリップボード権限を許可（ブラウザコンテキスト設定が必要な場合があるが、まずはトーストで検証）
            await editorHelper.performFileOperation('パスをコピー');
            await editorHelper.expectToastMessage('パスをコピーしました');
        });

        await test.step('3. 名前を変更', async () => {
            await editorHelper.renameSelectedItem(newName);
            await expect(editorPage.locator('file-explorer .directory', { hasText: newName })).toBeVisible();
            await expect(editorPage.locator('file-explorer .directory', { hasText: oldName })).toBeHidden();
        });
    });

    test('ファイルのダウンロードと再アップロードができる', async ({ editorPage, editorHelper }, testInfo) => {
        const fileName = 'favicon.ico';
        const uploadTargetDir = 'UploadDir';
        const downloadPath = testInfo.outputPath('download.zip');

        await test.step('1. favicon.ico をダウンロード', async () => {
            await editorHelper.openFileExplorer();

            // アイテムを選択
            await editorHelper.selectFileExplorerItem(fileName);

            // 【重要】ダウンロードボタンが有効化されるのを待つステップを明示的に入れる
            // editorHelper.downloadSelectedItems 内でチェックしているが、
            // テストステップとしても「選択状態」が反映されるのを待つ意味がある
            const downloadBtn = editorPage.locator('file-explorer .sidebar-icon').filter({ hasText: 'ダウンロード' });
            await expect(downloadBtn).not.toHaveClass(/sidebar-icon-disable/);

            const downloadPromise = editorPage.waitForEvent('download');
            await editorHelper.downloadSelectedItems();
            const download = await downloadPromise;

            await download.saveAs(downloadPath);
        });

        await test.step('2. 保存用ディレクトリを作成して移動', async () => {
            await editorHelper.createDirectory(uploadTargetDir);
            await editorHelper.enterDirectory(uploadTargetDir);
        });

        await test.step('3. ダウンロードした zip をアップロード', async () => {
            await editorHelper.uploadFiles([downloadPath]);

            // 検証: アップロードしたファイル名が表示されていること
            await expect(editorPage.locator('file-explorer .file', { hasText: 'download.zip' })).toBeVisible();
        });
    });
});