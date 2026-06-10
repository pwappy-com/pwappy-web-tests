import { test, expect, Page } from '@playwright/test';
import 'dotenv/config';
import { expectAppVisibility, gotoDashboard } from './dashboard-helpers';

test.describe.serial('手動実行: 全アプリケーション削除スクリプト', () => {

  test('すべてのアプリケーションを削除する', async ({ page, context }) => {
    // マルチスレッドで大量のページを処理するため、十分なタイムアウトを確保
    test.setTimeout(1200000);

    const disableAnimationCode = `
      const style = document.createElement('style');
      style.innerHTML = \`
      *, *::before, *::after {
        transition: none !important;
        animation: none !important;
        transition-duration: 0s !important;
        animation-duration: 0s !important;
      }
      \`;
      document.head.appendChild(style);
    `;

    await test.step('ログインとページ遷移', async () => {
      await page.addInitScript(disableAnimationCode);
      await gotoDashboard(page);
    });

    const concurrency = 10;

    // ====================================================
    // 1. アーカイブのクリーンアップ
    // ====================================================
    console.log('--- アーカイブを復元・削除開始 ---');
    await page.getByRole('button', { name: 'アーカイブ' }).click();

    while (true) {
      await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
      await page.waitForLoadState('networkidle');

      // 画面上の全アプリキーを収集
      let archivedAppKeys = await page.locator('.app-card .app-key').allInnerTexts();
      // Setを使って重複を完全に排除し、処理の二重実行を防止する
      archivedAppKeys = Array.from(new Set(archivedAppKeys.map(k => k.trim()))).filter(k => k.length > 0);

      if (archivedAppKeys.length === 0) {
        console.log('アーカイブは空です。');
        break;
      }

      console.log(`[Archive] 今回処理するアプリキー (${archivedAppKeys.length}件):`, archivedAppKeys);

      // 1件のアプリを処理する関数
      const processArchiveApp = async (appKey: string) => {
        const newPage = await context.newPage();
        try {
          await newPage.addInitScript(disableAnimationCode);
          await gotoDashboard(newPage);

          await newPage.getByRole('button', { name: 'アーカイブ' }).click();
          await expect(newPage.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
          await newPage.waitForLoadState('networkidle');

          const targetRow = newPage.locator('.app-card', { has: newPage.locator('.app-key', { hasText: new RegExp(`^${appKey}$`) }) }).first();
          if (await targetRow.count() === 0) {
            console.log(`[Archive] ${appKey} は既に見つかりません。スキップします。`);
            return;
          }

          const appName = await targetRow.locator('.app-name').innerText();
          console.log(`[Archive] 処理開始: ${appName} (${appKey})`);

          const deleteButton = targetRow.locator('.btn-danger-outline');
          const openButton = targetRow.getByText('OPEN');

          if (await !openButton.isVisible()) {
            await targetRow.scrollIntoViewIfNeeded();
            await deleteButton.click({ force: true });
            await expect(newPage.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
            const confirmDialog = newPage.locator('message-box#delete-confirm');
            await expect(confirmDialog).toBeVisible();
            await confirmDialog.locator('.confirm-ok-button').click();
            await expect(newPage.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
            await expect(newPage.locator('dashboard-loading-overlay')).toBeHidden();
            console.log(` -> アーカイブから削除完了: ${appName} (${appKey})`);
          } else {
            await targetRow.scrollIntoViewIfNeeded();
            await targetRow.getByRole('button', { name: /復元/ }).click();
            await expect(newPage.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
            const restoreConfirm = newPage.locator('message-box#restore-confirm');
            await expect(restoreConfirm).toBeVisible();
            await restoreConfirm.locator('.confirm-restore-button').click({ force: true });
            await expect(newPage.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });

            const alertDialog = newPage.locator('alert-component');
            await expect(alertDialog).toBeVisible();
            await alertDialog.getByRole('button', { name: '閉じる' }).click();
            console.log(` -> ワークベンチに復元完了: ${appName} (${appKey})`);
          }
        } catch (e) {
          console.error(`[Archive] ${appKey} の処理中にエラーが発生しました:`, e);
        } finally {
          await newPage.close();
        }
      };

      // 最大5並行でキュー（配列）から1件ずつ取り出して処理するワーカーを作成
      const archiveWorkers = Array(concurrency).fill(null).map(async () => {
        while (archivedAppKeys.length > 0) {
          // shift()で配列の先頭から1件取り出す
          const appKey = archivedAppKeys.shift();
          if (appKey) {
            await processArchiveApp(appKey);
          }
        }
      });

      // 全ワーカーの処理が終わるまで待つ
      await Promise.all(archiveWorkers);

      // 画面更新してまだ残っているか再検証
      await page.reload();
      await page.getByRole('button', { name: 'アーカイブ' }).click();
    }

    await page.getByRole('button', { name: 'ワークベンチに戻る' }).click();


    // ====================================================
    // 2. ワークベンチのクリーンアップ
    // ====================================================
    console.log('--- ワークベンチのクリーンアップを開始 ---');
    while (true) {
      await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
      await page.waitForLoadState('networkidle');

      let workbenchAppKeys = await page.locator('.app-card .app-key').allInnerTexts();
      workbenchAppKeys = Array.from(new Set(workbenchAppKeys.map(k => k.trim()))).filter(k => k.length > 0);

      if (workbenchAppKeys.length === 0) {
        console.log('ワークベンチのアプリケーションは空です。');
        break;
      }

      console.log(`[Workbench] 今回処理するアプリキー (${workbenchAppKeys.length}件):`, workbenchAppKeys);

      // 1件のアプリを処理する関数
      const processWorkbenchApp = async (appKey: string) => {
        const newPage = await context.newPage();
        try {
          await newPage.addInitScript(disableAnimationCode);
          await gotoDashboard(newPage);

          const targetRow = newPage.locator('.app-card', { has: newPage.locator('.app-key', { hasText: new RegExp(`^${appKey}$`) }) }).first();
          if (await targetRow.count() === 0) {
            console.log(`[Workbench] ${appKey} は既に見つかりません。スキップします。`);
            return;
          }

          const appName = await targetRow.locator('.app-name').innerText();
          console.log(`[Workbench] 処理開始: ${appName} (${appKey})`);

          await targetRow.scrollIntoViewIfNeeded();
          await targetRow.click({ force: true });

          await expect(newPage.locator('.detail-tab.active')).toBeVisible({ timeout: 10000 });
          await expect(newPage.locator('.detail-tab.active')).toContainText('バージョン管理');
          await expect(newPage.locator('dashboard-loading-overlay')).toBeHidden({ timeout: 30000 });

          // [非公開化] 全バージョンを非公開にするループ
          while (true) {
            await expect(newPage.locator('dashboard-loading-overlay')).toBeHidden({ timeout: 30000 });

            const publishedVersionRow = newPage.locator('.version-card', { hasText: '公開中' }).first();
            if (await publishedVersionRow.count() === 0) {
              break;
            }

            const version = await publishedVersionRow.locator('.v-version').innerText();
            console.log(`  -> バージョン ${version} を非公開にします (${appKey})`);

            const unPublishBtn = publishedVersionRow.getByRole('button', { name: /非公開へ/ });
            await unPublishBtn.scrollIntoViewIfNeeded();
            await unPublishBtn.click();

            await expect(newPage.locator('message-box#publish-action-confirm')).toBeVisible({ timeout: 30000 });
            const confirmDialog = newPage.locator('message-box#publish-action-confirm');
            await confirmDialog.locator('.confirm-ok-button').click({ force: true });

            await expect(newPage.locator('dashboard-loading-overlay')).toBeHidden({ timeout: 30000 });

            const updatedVersionRow = newPage.locator('.version-card', { hasText: version });
            await expect(updatedVersionRow).not.toContainText('公開中');
          }

          // [削除]
          const appSetting = newPage.getByText('アプリ設定');
          await expect(appSetting).toBeVisible();
          await appSetting.click();
          const deleteButton = newPage.getByRole('button', { name: '削除する' });

          await newPage.waitForTimeout(500);
          await expect(deleteButton).toBeEnabled({ timeout: 10000 });
          await deleteButton.click();

          await newPage.waitForTimeout(500);

          const confirmDialog = newPage.locator('message-box#delete-confirm-general');
          await expect(confirmDialog).toBeVisible();
          await confirmDialog.locator('.confirm-ok-button').click({ force: true });

          await expect(newPage.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
          await expect(newPage.locator('dashboard-loading-overlay')).toBeHidden();
          console.log(` -> 削除完了: ${appName} (${appKey})`);

        } catch (e) {
          console.error(`[Workbench] ${appKey} の処理中にエラーが発生しました:`, e);
        } finally {
          await newPage.close();
        }
      };

      // 最大5並行でキュー（配列）から1件ずつ取り出して処理するワーカーを作成
      const workbenchWorkers = Array(concurrency).fill(null).map(async () => {
        while (workbenchAppKeys.length > 0) {
          // shift()で配列の先頭から1件取り出す
          const appKey = workbenchAppKeys.shift();
          if (appKey) {
            await processWorkbenchApp(appKey);
          }
        }
      });

      // 全ワーカーの処理が終わるまで待つ
      await Promise.all(workbenchWorkers);

      // 画面を再読み込みして、残りのアプリがないか確認
      await page.reload();
    }
  });
});