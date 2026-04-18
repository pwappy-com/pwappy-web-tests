import { test, expect, Page } from '@playwright/test';
import 'dotenv/config';
import { expectAppVisibility, gotoDashboard } from './dashboard-helpers';

test.describe.serial('手動実行: 全アプリケーション削除スクリプト', () => {

  test('すべてのアプリケーションを削除する', async ({ page, context }) => {
    test.setTimeout(600000);

    await test.step('ログインとページ遷移', async () => {
      await gotoDashboard(page);
    });

    console.log('--- ワークベンチのクリーンアップを開始 ---');
    while (true) {
      await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
      await page.waitForLoadState('networkidle');

      const firstAppRow = page.locator('.app-card').first();
      const rowCount = await firstAppRow.count();

      if (rowCount === 0) {
        console.log('ワークベンチのアプリケーションは空です。');
        break;
      }

      const appNameElm = firstAppRow.locator('.app-name');
      const appKeyElm = firstAppRow.locator('.app-key');
      await expect(appNameElm).toBeVisible();
      await expect(appKeyElm).toBeVisible();
      const appName = await appNameElm.innerText();
      const appKey = await appKeyElm.innerText();

      console.log(`[Workbench] 処理中のアプリ: ${appName} (${appKey})`);

      await firstAppRow.click({ force: true });
      // detaile-tab.activeの文字が「バージョン管理」であることを確認

      await expect(page.locator('.detail-tab.active')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.detail-tab.active')).toContainText('バージョン管理');

      await test.step(`[非公開化] ${appName} の全バージョンを非公開にします`, async () => {
        // 公開中のバージョンを非公開にするため、公開タブに移動
        const appRowPublish = page.locator('.app-card', { hasText: appKey });

        while (true) {
          await page.waitForLoadState('networkidle');
          const publishedVersionRow = page.locator('.version-card', { hasText: '公開中' }).first();
          if (await publishedVersionRow.count() === 0) {
            break; await page.getByRole('button', { name: ' 非公開へ' }).click();
            await page.getByRole('button', { name: 'キャンセル' }).click();
          }
          const version = await publishedVersionRow.locator('.v-version').innerText();
          console.log(`  -> バージョン ${version} を非公開にします`);

          const unPublishBtn = page.getByRole('button', { name: ' 非公開へ' });
          await unPublishBtn.click();

          await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
          const confirmDialog = page.locator('message-box#publish-action-confirm');
          await expect(confirmDialog).toBeVisible();
          await confirmDialog.locator('.confirm-ok-button').click({ force: true });
          await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });

          const updatedVersionRow = page.locator('.version-card', { hasText: version });
          await expect(updatedVersionRow).not.toContainText('公開中');
        }
      });

      await test.step(`[削除] ${appName} を削除します`, async () => {
        // アプリ設定をクリック
        const appSetting = page.getByText('アプリ設定');
        await expect(appSetting).toBeVisible();
        await appSetting.click();
        const deleteButton = page.getByRole('button', { name: '削除する' });
        await expect(deleteButton).toBeEnabled();
        await deleteButton.click({ force: true });
        const confirmDialog = page.locator('message-box#delete-confirm-general');
        await expect(confirmDialog).toBeVisible();
        await confirmDialog.locator('.confirm-ok-button').click({ force: true });
        await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
        await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
        console.log(` -> 削除完了`);
      });

      await expect(page.locator('.app-card', { hasText: new RegExp(`^${appKey}$`) })).toBeHidden();
    }

    console.log('--- アーカイブのクリーンアップを開始 ---');
    while (true) {
      await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
      await page.waitForLoadState('networkidle');

      const firstArchivedRow = page.locator('.app-card').first();
      const rowCount = await firstArchivedRow.count();

      if (rowCount === 0) {
        console.log('アーカイブは空です。');
        break;
      }

      const appName = await firstArchivedRow.locator('.app-name').innerText();
      const appKey = await firstArchivedRow.locator('.app-key').innerText();
      console.log(`[Archive] 処理中のアプリ: ${appName} (${appKey})`);

      const deleteButton = firstArchivedRow.locator('.btn-icon.danger');

      if (await deleteButton.isEnabled()) {
        await test.step(`[アーカイブから削除] ${appName} を削除します`, async () => {
          await deleteButton.click({ force: true });
          await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
          const confirmDialog = page.locator('message-box#delete-confirm');
          await expect(confirmDialog).toBeVisible();
          await confirmDialog.locator('.confirm-ok-button').click({ force: true });
          await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
          await expect(page.locator('dashboard-loading-overlay')).toBeHidden();
          console.log(` -> 削除完了`);
        });
      } else {
        await test.step(`[復元 & 非公開化] ${appName} を復元して非公開にします`, async () => {
          console.log(` -> 削除ボタンが非活性のため、ワークベンチに復元します`);
          await firstArchivedRow.getByRole('button', { name: /ワークベンチに復元/ }).click({ force: true });
          await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
          const restoreConfirm = page.locator('message-box#restore-confirm');
          await expect(restoreConfirm).toBeVisible();
          await restoreConfirm.locator('.confirm-restore-button').click({ force: true });
          await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });

          const alertDialog = page.locator('alert-component');
          await expect(alertDialog).toBeVisible();
          await alertDialog.getByRole('button', { name: '閉じる' }).click();

          console.log(` -> 公開タブに移動して非公開化します`);
          const appRowPublish = page.locator('.app-card', { hasText: appKey });
          await appRowPublish.getByRole('button', { name: /選択/ }).click({ force: true });

          const unpublishAllVersions = async () => {
            const publishedVersionRow = page.locator('.version-card', { hasText: '公開中' }).first();
            if (await publishedVersionRow.count() > 0) {
              const version = await publishedVersionRow.locator('.v-version').innerText();
              console.log(`  -> バージョン ${version} を非公開にします`);

              await publishedVersionRow.getByRole('button', { name: /非公開/ }).click({ force: true });
              await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
              const confirmDialog = page.locator('message-box#publish-action-confirm');
              await expect(confirmDialog).toBeVisible();
              await confirmDialog.locator('.confirm-ok-button').click({ force: true });
              await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });

              const updatedVersionRow = page.locator('.version-card', { hasText: version });
              await expect(updatedVersionRow).not.toContainText('公開中');
              await unpublishAllVersions();
            }
          };

          await unpublishAllVersions();
        });

        await test.step(`[復元後に削除] ${appName} を削除します`, async () => {
          const appRowWorkbench = page.locator('.app-card', { hasText: appKey });
          const delBtn = appRowWorkbench.locator('.btn-icon.danger');
          await delBtn.click({ force: true });

          const confirmDialog = page.locator('message-box#delete-confirm');
          await expect(confirmDialog).toBeVisible();
          await confirmDialog.locator('.confirm-ok-button').click({ force: true });
          await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
          console.log(` -> 削除完了`);
        });
      }

      await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
      const deletedArchivedRow = page.locator('.app-card', { hasText: appKey });
      await expect(deletedArchivedRow).toBeHidden();
    }
  });
});