import { test as base, expect, Page, Locator } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor, setAiCoding } from '../../tools/dashboard-helpers';
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
        await use(`ai-persist-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName }, use) => {
        const workerIndex = test.info().workerIndex;
        const reversedTimestamp = Date.now().toString().split('').reverse().join('');
        const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
        const appKey = `test-key-${uniqueId}`.slice(0, 30); // ※ここは各ファイルのプレフィックスに合わせてください

        await createApp(page, appName, appKey);
        const editorPage = await openEditor(page, context, appName);

        // テスト本体の実行
        await use(editorPage);

        try {
            await editorPage.evaluate(() => window.stop());
        } catch (e) {
            // 既にナビゲーション中等でエラーが出た場合は無視
        }

        await editorPage.close();
        await page.bringToFront();
        await deleteApp(page, appKey);
    },
    editorHelper: async ({ editorPage, isMobile }, use) => {
        const helper = new EditorHelper(editorPage, isMobile);
        await use(helper);
    },
});

// Independent acceptance expectation: don't use the application catalog as its own oracle.
export const PREMIUM_GEMINI_MODELS = [
    'gemini-3.8-flash',
    'gemini-3.5-flash-lite',
    'gemini-4-argon',
    'gemini-4-neon',
] as const;

export async function expectPremiumGeminiChoices(select: Locator): Promise<void> {
    await expect.poll(() => select.locator('option').evaluateAll(
        options => options.map(option => (option as HTMLOptionElement).value),
    )).toEqual([...PREMIUM_GEMINI_MODELS]);
}

test.describe('AI設定の永続化テスト', () => {
    test.setTimeout(180000);
    test.beforeEach(async ({ page, context }) => {
        await gotoDashboard(page);
        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });

        // AI機能を有効化（アカウント設定）
        await setAiCoding(page, true);
    });

    test('AIコーダーのモデルと設定がリロード後に保持される', async ({ editorPage, editorHelper }) => {
        let targetModel: string;
        let targetOnsen: boolean;

        await test.step('1. AIコーダー画面を開き、モデルと設定を変更', async () => {
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await editorHelper.addNewScript('testScript');
            await editorHelper.openScriptForEditing('testScript');
            await editorHelper.openAiCodingWindow();

            const aiWindow = editorPage.locator('ai-coder-window');
            await aiWindow.locator('#setting-btn').click();
            const settingWindow = aiWindow.locator('#setting-window');

            // 表示されるまで待機
            await expect(settingWindow).toBeVisible();

            const select = settingWindow.locator('select.modern-select');
            await expectPremiumGeminiChoices(select);
            targetModel = (await select.inputValue()) === 'gemini-3.5-flash-lite'
                ? 'gemini-3.8-flash' : 'gemini-3.5-flash-lite';
            await select.selectOption(targetModel);
            await expect(select).toHaveValue(targetModel);
            await expect(settingWindow.locator('input[type="range"]')).toHaveCount(0);
            await expect(settingWindow.getByText('創造性 (Temperature)', { exact: false })).toHaveCount(0);

            // Always change the value before verifying its persistence.
            const checkbox = settingWindow.locator('#use-onsenui-check');
            targetOnsen = !(await checkbox.isChecked());
            await settingWindow.locator('label.switch').click();

            // 閉じるボタンをクリック
            const closeBtn = settingWindow.locator('#close-btn');
            await expect(closeBtn).toBeVisible();
            await closeBtn.click();
        });

        await test.step('2. ページをリロードし、スナップショットを破棄', async () => {
            await editorPage.reload();
            await editorPage.waitForLoadState('domcontentloaded');
            await editorHelper.handleSnapshotRestoreDialog();
            await editorHelper.handleStarterTemplateModal();
        });

        await test.step('3. スクリプトを再作成して設定が保持されているか確認', async () => {
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await editorHelper.addNewScript('testScript');
            await editorHelper.openScriptForEditing('testScript');
            await editorHelper.openAiCodingWindow();

            const aiWindow = editorPage.locator('ai-coder-window');
            await aiWindow.locator('#setting-btn').click();
            const settingWindow = aiWindow.locator('#setting-window');
            await expect(settingWindow).toBeVisible();

            // 保持されている値の検証
            await expect(settingWindow.locator('select.modern-select')).toHaveValue(targetModel);
            await expect(settingWindow.locator('input[type="range"]')).toHaveCount(0);
            await expect(settingWindow.getByText('創造性 (Temperature)', { exact: false })).toHaveCount(0);
            if (targetOnsen) {
                await expect(settingWindow.locator('#use-onsenui-check')).toBeChecked();
            } else {
                await expect(settingWindow.locator('#use-onsenui-check')).not.toBeChecked();
            }

            // モーダルを閉じてクリーンアップを安定させる
            await settingWindow.locator('button', { hasText: '設定を適用して戻る' }).click();
            await expect(settingWindow).toBeHidden();
        });
    });

    test('AIエージェントのモデルと設定がリロード後に保持される', async ({ editorPage, editorHelper }) => {
        let targetModel: string;
        let targetHistory: string;
        let targetRecovery: string;
        let targetMode: string;

        await test.step('1. AIエージェント画面を開き、モデルと設定を変更', async () => {
            await editorPage.locator('#fab-bottom-menu-box').click();
            const bottomMenu = editorPage.locator('#platformBottomMenu');
            await expect(bottomMenu).toBeVisible()
            await bottomMenu.getByText('AIエージェント').click();

            const agentWindow = editorPage.locator('agent-chat-window');

            await agentWindow.locator('.settings-btn').click();
            const modal = agentWindow.locator('.modal-dialog');

            const select = modal.locator('#agent-model-select');
            await expectPremiumGeminiChoices(select);
            targetModel = (await select.inputValue()) === 'gemini-4-neon'
                ? 'gemini-4-argon' : 'gemini-4-neon';
            await select.selectOption(targetModel);
            await expect(select).toHaveValue(targetModel);
            const maxHistoryInput = modal.locator('#max-history-input');
            const maxRecoveryInput = modal.locator('#max-recovery-input');
            await expect(maxHistoryInput).toBeEditable();
            await expect(maxRecoveryInput).toBeEditable();
            targetHistory = (await maxHistoryInput.inputValue()) === '61' ? '62' : '61';
            targetRecovery = (await maxRecoveryInput.inputValue()) === '4' ? '5' : '4';
            await maxHistoryInput.fill(targetHistory);
            await maxRecoveryInput.fill(targetRecovery);
            await modal.locator('button', { hasText: '設定を保存' }).click();

            const autoMode = agentWindow.locator('.mode-btn').filter({ hasText: '自動' });
            targetMode = (await autoMode.getAttribute('class'))?.split(/\s+/).includes('active') ? '手動' : '自動';
            const modeBtn = agentWindow.locator('.mode-btn').filter({ hasText: targetMode });
            await modeBtn.click();
        });

        await test.step('2. ページをリロードし、スナップショットを破棄', async () => {
            await editorPage.reload();
            await editorPage.waitForLoadState('domcontentloaded');
            await editorHelper.handleSnapshotRestoreDialog();
            await editorHelper.handleStarterTemplateModal();
        });

        await test.step('3. AIエージェントを再度開き、設定が保持されているか確認', async () => {
            await editorPage.locator('#fab-bottom-menu-box').click();
            const bottomMenu = editorPage.locator('#platformBottomMenu');
            await expect(bottomMenu).toBeVisible()
            await bottomMenu.getByText('AIエージェント').click();

            const agentWindow = editorPage.locator('agent-chat-window');
            const modeBtn = agentWindow.locator('.mode-btn').filter({ hasText: targetMode });
            await expect(modeBtn).toHaveClass(/active/);

            await agentWindow.locator('.settings-btn').click();
            const modal = agentWindow.locator('.modal-dialog');

            await expect(modal.locator('#agent-model-select')).toHaveValue(targetModel);
            await expect(modal.locator('#max-history-input')).toHaveValue(targetHistory);
            await expect(modal.locator('#max-recovery-input')).toHaveValue(targetRecovery);

            // モーダルを閉じてクリーンアップを安定させる
            await modal.locator('button', { hasText: 'キャンセル' }).click();
            await expect(modal).toBeHidden();
        });
    });
});