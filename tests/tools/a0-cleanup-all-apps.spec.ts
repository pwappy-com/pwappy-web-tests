import { test, expect, Page } from '@playwright/test';
import 'dotenv/config';

// 手動実行専用のテストファイル
test.describe.serial('手動実行: 全アプリケーション削除スクリプト', () => {

  // このテストは1回だけ実行する
  test('すべてのアプリケーションを削除する', async ({ page, context }) => {
    test.setTimeout(1200000); // タイムアウトを20分に延長

    // --- ログインとページ遷移 ---
    await test.step('ログインとページ遷移', async () => {
      await context.addCookies([
        { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: 'localhost', path: '/' },
        { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: 'localhost', path: '/' },
        { name: 'pwappy_login', value: '1', domain: 'localhost', path: '/' },
      ]);
      await page.goto(String(process.env.PWAPPY_TEST_BASE_URL));
      await expect(page.getByRole('heading', { name: 'アプリケーション一覧' })).toBeVisible();
    });

    // --- ワークベンチのアプリを削除 ---
    console.log('--- ワークベンチのクリーンアップを開始 ---');
    while (true) {
      await page.locator('#workbench').click();
      await page.getByText('処理中...').waitFor({ state: 'hidden' });
      await page.waitForLoadState('networkidle');

      const firstAppRow = page.locator('.app-list tbody tr').first();
      const rowCount = await firstAppRow.count();

      if (rowCount === 0) {
        console.log('ワークベンチのアプリケーションは空です。');
        break;
      }

      const appName = await firstAppRow.locator('td').nth(0).innerText();
      console.log(`[Workbench] 処理中のアプリ: ${appName}`);

      const deleteButton = firstAppRow.getByRole('button', { name: '削除' });

      if (await deleteButton.isEnabled()) {
        await test.step(`[削除] ${appName} を削除します`, async () => {
          await deleteButton.click();
          await page.getByText('処理中...').waitFor({ state: 'hidden' });
          const confirmDialog = page.locator('message-box#delete-confirm');
          await expect(confirmDialog).toBeVisible();
          await confirmDialog.getByRole('button', { name: '削除する' }).click();
          await page.getByText('処理中...').waitFor({ state: 'hidden' });
          await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
          console.log(` -> 削除完了`);
        });
      } else {
        await test.step(`[非公開化] ${appName} の全バージョンを非公開にします`, async () => {
          console.log(` -> 削除ボタンが非活性のため、公開タブに移動します`);
          await page.locator('#publish').click();
          await page.getByText('処理中...').waitFor({ state: 'hidden' });
          await expect(page.getByRole('heading', { name: '公開設定' })).toBeVisible({ timeout: 10000 });

          await page.pause();
          const appRowPublish = page.locator('.app-list tbody tr', { hasText: appName });
          await appRowPublish.getByRole('button', { name: '選択' }).click();
          await page.getByText('処理中...').waitFor({ state: 'hidden' });

          while (true) {
            await page.waitForLoadState('networkidle');
            const publishedVersionRow = page.locator('.publish-list tbody tr', { hasText: '公開中' }).first();
            if (await publishedVersionRow.count() === 0) {
              console.log(` -> 公開中のバージョンがなくなりました`);
              break;
            }
            const version = await publishedVersionRow.locator('td').first().innerText();
            console.log(`  -> バージョン ${version} を非公開にします`);

            await publishedVersionRow.getByRole('button', { name: '非公開', exact: true }).click();
            await page.getByText('処理中...').waitFor({ state: 'hidden' });
            const confirmDialog = page.locator('message-box#publish-action-confirm');
            await expect(confirmDialog).toBeVisible();
            await confirmDialog.getByRole('button', { name: '非公開にする' }).click();
            await page.getByText('処理中...').waitFor({ state: 'hidden' });
            await expect(page.locator('dashboard-publish-content > dashboard-loading-overlay')).toBeHidden();
          }
        });

        await test.step(`[再削除] ${appName} を削除します`, async () => {
          await page.locator('#workbench').click();
          await page.getByText('処理中...').waitFor({ state: 'hidden' });

          const appRowWorkbench = page.locator('.app-list tbody tr', { hasText: appName });
          const enabledDeleteButton = appRowWorkbench.getByRole('button', { name: '削除' });

          await expect(enabledDeleteButton).toBeEnabled();
          await enabledDeleteButton.click();
          await page.getByText('処理中...').waitFor({ state: 'hidden' });

          const confirmDialog = page.locator('message-box#delete-confirm');
          await expect(confirmDialog).toBeVisible();
          await confirmDialog.getByRole('button', { name: '削除する' }).click();
          await page.getByText('処理中...').waitFor({ state: 'hidden' });
          await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
          console.log(` -> 削除完了`);
        });
      }

      const deletedAppRow = page.locator('.app-list tbody tr', { hasText: appName });
      await expect(deletedAppRow).toBeHidden();
    }

    // --- アーカイブのアプリを削除 ---
    console.log('--- アーカイブのクリーンアップを開始 ---');
    while (true) {
      await page.locator('#archive').click();
      await page.getByText('処理中...').waitFor({ state: 'hidden' });
      await page.waitForLoadState('networkidle');

      const firstArchivedRow = page.locator('.app-list tbody tr').first();
      const rowCount = await firstArchivedRow.count();

      if (rowCount === 0) {
        console.log('アーカイブは空です。');
        break;
      }

      const appName = await firstArchivedRow.locator('td').nth(0).innerText();
      console.log(`[Archive] 処理中のアプリ: ${appName}`);

      const deleteButton = firstArchivedRow.getByRole('button', { name: '削除' });

      if (await deleteButton.isEnabled()) {
        await test.step(`[アーカイブから削除] ${appName} を削除します`, async () => {
          await deleteButton.click();
          await page.getByText('処理中...').waitFor({ state: 'hidden' });
          const confirmDialog = page.locator('message-box#delete-confirm');
          await expect(confirmDialog).toBeVisible();
          await confirmDialog.getByRole('button', { name: '削除する' }).click();
          await page.getByText('処理中...').waitFor({ state: 'hidden' });
          await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
          console.log(` -> 削除完了`);
        });
      } else {
        await test.step(`[復元 & 非公開化] ${appName} を復元して非公開にします`, async () => {
          console.log(` -> 削除ボタンが非活性のため、ワークベンチに復元します`);
          await firstArchivedRow.getByRole('button', { name: 'ワークベンチに復元' }).click();
          await page.getByText('処理中...').waitFor({ state: 'hidden' });
          const restoreConfirm = page.locator('message-box#restore-confirm');
          await expect(restoreConfirm).toBeVisible();
          await restoreConfirm.getByRole('button', { name: '復元' }).click();
          await page.getByText('処理中...').waitFor({ state: 'hidden' });
          await expect(page.locator('dashboard-loading-overlay')).toBeHidden();

          const alertDialog = page.locator('alert-component');
          await expect(alertDialog).toBeVisible();
          await alertDialog.getByRole('button', { name: '閉じる' }).click();

          // ここで非公開化処理（ワークベンチ削除のロジックと同じ）
          console.log(` -> 公開タブに移動して非公開化します`);
          await page.locator('#publish').click();
          await page.getByText('処理中...').waitFor({ state: 'hidden' });
          const appRowPublish = page.locator('.app-list tbody tr', { hasText: appName });
          await appRowPublish.getByRole('button', { name: '選択' }).click();
          await page.getByText('処理中...').waitFor({ state: 'hidden' });

          // 再帰的な関数で非公開化処理を行う
          const unpublishAllVersions = async () => {
            const publishedVersionRow = page.locator('.publish-list tbody tr', { hasText: '公開中' }).first();

            if (await publishedVersionRow.count() > 0) {
              const version = await publishedVersionRow.locator('td').first().innerText();
              console.log(`  -> バージョン ${version} を非公開にします`);

              await publishedVersionRow.getByRole('button', { name: '非公開', exact: true }).click();
              await page.getByText('処理中...').waitFor({ state: 'hidden' });
              const confirmDialog = page.locator('message-box#publish-action-confirm');
              await expect(confirmDialog).toBeVisible();
              await confirmDialog.getByRole('button', { name: '非公開にする' }).click();
              await page.getByText('処理中...').waitFor({ state: 'hidden' });
              await expect(page.locator('dashboard-main-content > dashboard-loading-overlay')).toBeHidden();

              // バージョン名を使って、再描画後の行を改めて特定する
              const updatedVersionRow = page.locator('.publish-list tbody tr', { hasText: version });
              // その行のステータスが「公開中」でなくなったことを待つ
              await expect(updatedVersionRow).not.toContainText('公開中');

              // UIが安定した後に、再帰的に自身を呼び出す
              await unpublishAllVersions();
            } else {
              console.log(` -> 公開中のバージョンがなくなりました`);
              return;
            }
          };

          await unpublishAllVersions();
        });

        await test.step(`[復元後に削除] ${appName} を削除します`, async () => {
          await page.locator('#workbench').click();
          await page.getByText('処理中...').waitFor({ state: 'hidden' });
          const appRowWorkbench = page.locator('.app-list tbody tr', { hasText: appName });
          const enabledDeleteButton = appRowWorkbench.getByRole('button', { name: '削除' });
          await expect(enabledDeleteButton).toBeEnabled();
          await enabledDeleteButton.click();
          await page.getByText('処理中...').waitFor({ state: 'hidden' });
          const confirmDialog = page.locator('message-box#delete-confirm');
          await expect(confirmDialog).toBeVisible();
          await confirmDialog.getByRole('button', { name: '削除する' }).click();
          await page.getByText('処理中...').waitFor({ state: 'hidden' });
          await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
          console.log(` -> 削除完了`);
        });
      }

      // アーカイブタブ上で非表示になったことを確認
      await page.locator('#archive').click();
      await page.getByText('処理中...').waitFor({ state: 'hidden' });
      const deletedArchivedRow = page.locator('.app-list tbody tr', { hasText: appName });
      await expect(deletedArchivedRow).toBeHidden();
    }
  });

});