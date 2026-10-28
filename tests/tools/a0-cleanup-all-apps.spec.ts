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

    // Cleanup shares one browser: bound renderer/API pressure to the normal CI worker count.
    const concurrency = 2;
    const cleanupErrors: unknown[] = [];

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
      const processArchiveApp = async (newPage: Page, appKey: string) => {
        const startedAt = Date.now();
        console.log('[CleanupStage] archive-item:start');
        try {
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
            await expect(targetRow, 'Deleted app must disappear from the archive').toHaveCount(0, { timeout: 30000 });
            console.log(` -> アーカイブから削除完了: ${appName} (${appKey})`);
          } else {
            await targetRow.scrollIntoViewIfNeeded();
            await targetRow.getByRole('button', { name: /復元/ }).click();
            await expect(newPage.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
            const restoreConfirm = newPage.locator('message-box#restore-confirm');
            await expect(restoreConfirm).toBeVisible();
            const [restoreResponse] = await Promise.all([
              newPage.waitForResponse(response => {
                if (response.request().method() !== 'PUT') return false;
                try {
                  return response.request().postDataJSON()?.appKey === appKey;
                } catch {
                  return false;
                }
              }, { timeout: 30000 }),
              restoreConfirm.locator('.confirm-restore-button').click()
            ]);
            // Read the API status before asserting HTTP success so failures remain diagnosable.
            // Do not log the full response body, which may contain account data.
            let restoreResult: { code?: number; status?: unknown } | null;
            try {
              restoreResult = await restoreResponse.json();
            } catch {
              throw new Error(`Archive restore HTTP ${restoreResponse.status()}: response body is not JSON`);
            }
            const restoreStatus = typeof restoreResult?.status === 'string'
              && /^[a-zA-Z0-9_-]{1,100}$/.test(restoreResult.status)
              ? restoreResult.status : 'missing-or-invalid-status';
            const restoreDiagnostic = `Archive restore HTTP ${restoreResponse.status()}, API status: ${restoreStatus}`;
            expect(restoreResponse.ok(), restoreDiagnostic).toBeTruthy();
            expect(restoreResult?.code, restoreDiagnostic).toBe(200);
            await expect(newPage.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });

            const alertDialog = newPage.locator('alert-component');
            await expect(alertDialog).toBeVisible();
            await expect(alertDialog).toContainText(`アプリ「${appKey}」を復元しました`);
            await alertDialog.getByRole('button', { name: '閉じる' }).click();
            await expect(targetRow, 'Restored app must disappear from the archive').toHaveCount(0, { timeout: 30000 });
            console.log(` -> ワークベンチに復元完了: ${appName} (${appKey})`);
          }
        } catch (e) {
          console.error(`[Archive] ${appKey} の処理中にエラーが発生しました:`, e);
          cleanupErrors.push(e);
        } finally {
          console.log(`[CleanupStage] archive-item:end elapsedMs=${Date.now() - startedAt}`);
        }
      };

      // Keep each archive page open until its queue is drained. A successful
      // restore refreshes this page's archive list; it need not boot a new dashboard.
      const archiveWorkers = Array(Math.min(concurrency, archivedAppKeys.length)).fill(null).map(async (_, slot) => {
        let workerPage: Page | undefined;
        let stage = 'new-page';
        const startedAt = Date.now();
        const enterStage = (next: string) => {
          stage = next;
          console.log(`[CleanupStage] archive-worker=${slot} stage=${stage} elapsedMs=${Date.now() - startedAt}`);
        };
        try {
          enterStage('new-page');
          workerPage = await context.newPage();
          await workerPage.addInitScript(disableAnimationCode);
          enterStage('dashboard');
          await gotoDashboard(workerPage);
          enterStage('archive-list');
          await workerPage.getByRole('button', { name: 'アーカイブ' }).click();
          await expect(workerPage.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
          await workerPage.waitForLoadState('networkidle');
          enterStage('items');
          while (archivedAppKeys.length > 0 && cleanupErrors.length === 0) {
            const appKey = archivedAppKeys.shift();
            if (appKey) await processArchiveApp(workerPage, appKey);
          }
        } catch (e) {
          console.error(`[CleanupStage] archive-worker=${slot} failed stage=${stage} elapsedMs=${Date.now() - startedAt}`);
          cleanupErrors.push(e);
        } finally {
          enterStage('close-page');
          if (workerPage) await workerPage.close();
        }
      });

      // 全ワーカーの処理が終わるまで待つ
      await Promise.all(archiveWorkers);
      if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Cleanup operation failed; refusing to repeat unsuccessful mutations');

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
      const processWorkbenchApp = async (newPage: Page, appKey: string) => {
        const startedAt = Date.now();
        console.log('[CleanupStage] workbench-item:start');
        try {
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
          const [deleteResponse] = await Promise.all([
            newPage.waitForResponse(response => {
              if (response.request().method() !== 'DELETE') return false;
              try {
                const body = response.request().postDataJSON();
                return body?.appKey === appKey && !Object.prototype.hasOwnProperty.call(body, 'version');
              } catch {
                return false;
              }
            }, { timeout: 30000 }),
            confirmDialog.locator('.confirm-ok-button').click({ force: true })
          ]);
          let deleteResult: { code?: number; status?: unknown } | null;
          try {
            deleteResult = await deleteResponse.json();
          } catch {
            throw new Error(`Workbench delete HTTP ${deleteResponse.status()}: response body is not JSON`);
          }
          const deleteStatus = typeof deleteResult?.status === 'string'
            && /^[a-zA-Z0-9_-]{1,100}$/.test(deleteResult.status)
            ? deleteResult.status : 'missing-or-invalid-status';
          const deleteDiagnostic = `Workbench delete HTTP ${deleteResponse.status()}, API status: ${deleteStatus}`;
          expect(deleteResponse.ok(), deleteDiagnostic).toBeTruthy();
          expect(deleteResult?.code, deleteDiagnostic).toBe(200);

          await expect(newPage.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
          await expect(newPage.locator('dashboard-loading-overlay')).toBeHidden();
          await expect(newPage.locator('dashboard-app-content'), 'Deletion must return to the workbench').toBeVisible({ timeout: 30000 });
          await newPage.waitForLoadState('networkidle');
          await expect(newPage.locator('dashboard-loading-overlay')).toBeHidden();
          await expect(targetRow, 'Deleted app must disappear from the workbench').toHaveCount(0, { timeout: 30000 });
          console.log(` -> 削除完了: ${appName} (${appKey})`);

        } catch (e) {
          console.error(`[Workbench] ${appKey} の処理中にエラーが発生しました:`, e);
          cleanupErrors.push(e);
        } finally {
          console.log(`[CleanupStage] workbench-item:end elapsedMs=${Date.now() - startedAt}`);
        }
      };

      // A successful deletion returns to the refreshed workbench. Reuse that
      // page instead of booting a dashboard for every remaining app.
      const workbenchWorkers = Array(Math.min(concurrency, workbenchAppKeys.length)).fill(null).map(async (_, slot) => {
        let workerPage: Page | undefined;
        let stage = 'new-page';
        const startedAt = Date.now();
        const enterStage = (next: string) => {
          stage = next;
          console.log(`[CleanupStage] workbench-worker=${slot} stage=${stage} elapsedMs=${Date.now() - startedAt}`);
        };
        try {
          enterStage('new-page');
          workerPage = await context.newPage();
          await workerPage.addInitScript(disableAnimationCode);
          enterStage('dashboard');
          await gotoDashboard(workerPage);
          await expect(workerPage.locator('dashboard-app-content')).toBeVisible({ timeout: 30000 });
          await expect(workerPage.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });
          enterStage('items');
          while (workbenchAppKeys.length > 0 && cleanupErrors.length === 0) {
            const appKey = workbenchAppKeys.shift();
            if (appKey) await processWorkbenchApp(workerPage, appKey);
          }
        } catch (e) {
          console.error(`[CleanupStage] workbench-worker=${slot} failed stage=${stage} elapsedMs=${Date.now() - startedAt}`);
          cleanupErrors.push(e);
        } finally {
          enterStage('close-page');
          if (workerPage) await workerPage.close();
        }
      });

      // 全ワーカーの処理が終わるまで待つ
      await Promise.all(workbenchWorkers);
      if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Cleanup operation failed; refusing to repeat unsuccessful mutations');

      // 画面を再読み込みして、残りのアプリがないか確認
      await page.reload();
    }
  });
});
