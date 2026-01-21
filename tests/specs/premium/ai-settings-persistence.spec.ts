import { test as base, expect, Page, Locator } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, openEditor, setAiCoding } from '../../tools/dashboard-helpers';
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
        const appKey = `ai-persist-${uniqueId}`.slice(0, 30);
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

// --- ランダム化のためのユーティリティ ---
const getRandomItem = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];
const getRandomTemp = (): string => (Math.random() * 2).toFixed(1);
const getRandomHistory = (): string => Math.floor(Math.random() * 90 + 10).toString();

/**
 * select要素から全オプションの値を取得し、ランダムに一つ返すヘルパー
 */
async function getRandomOptionValue(selectLocator: Locator): Promise<string> {
    const options = await selectLocator.locator('option').all();
    const values = await Promise.all(options.map(opt => opt.getAttribute('value')));
    return getRandomItem(values.filter((v): v is string => v !== null));
}

test.describe('AI設定の永続化テスト', () => {

    test.beforeEach(async ({ page, context }) => {
        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        const domain = testUrl.hostname;
        await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/' },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/' },
            { name: 'pwappy_login', value: '1', domain: domain, path: '/' },
        ]);
        await page.goto(String(process.env.PWAPPY_TEST_BASE_URL), { waitUntil: 'domcontentloaded' });
        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });

        // AI機能を有効化（アカウント設定）
        await setAiCoding(page, true);
    });

    test('AIコーダーの設定がUI上の選択肢からランダムに選んでもリロード後に保持される', async ({ editorPage, editorHelper }) => {
        let targetModel: string;
        let targetTemp = getRandomTemp();
        let targetOnsen = Math.random() > 0.5;

        await test.step('1. AIコーダー画面を開き、UIからモデルを取得してランダムに変更', async () => {
            await editorHelper.openMoveingHandle('right');
            const scriptContainer = editorPage.locator('script-container');
            await editorHelper.switchTabInContainer(scriptContainer, 'スクリプト');
            await editorHelper.addNewScript('testScript');
            await editorHelper.openScriptForEditing('testScript');
            await editorHelper.openAiCodingWindow();

            const aiWindow = editorPage.locator('ai-coder-window');
            await aiWindow.locator('#setting-btn').click();
            const settingWindow = aiWindow.locator('.setting-window');

            const select = settingWindow.locator('select');
            targetModel = await getRandomOptionValue(select);
            console.log(`[AI Coder Test] UIから取得したランダムモデル: ${targetModel}`);

            await select.selectOption({ value: targetModel });
            await settingWindow.locator('input[type="range"]').fill(targetTemp);

            const checkbox = settingWindow.locator('#use-onsenui-check');
            if (await checkbox.isChecked() !== targetOnsen) {
                await checkbox.click();
            }

            await settingWindow.locator('#close-btn').click();
        });

        await test.step('2. ページをリロードし、スナップショットを破棄', async () => {
            await editorPage.reload();
            await editorPage.waitForLoadState('domcontentloaded');
            await editorHelper.handleSnapshotRestoreDialog();
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
            const settingWindow = aiWindow.locator('.setting-window');

            // 保持されている値の検証
            await expect(settingWindow.locator('select')).toHaveValue(targetModel);
            await expect(settingWindow.locator('input[type="range"]')).toHaveValue(targetTemp);
            if (targetOnsen) {
                await expect(settingWindow.locator('#use-onsenui-check')).toBeChecked();
            } else {
                await expect(settingWindow.locator('#use-onsenui-check')).not.toBeChecked();
            }
        });
    });

    test('AIエージェントの設定がUI上の選択肢からランダムに選んでもリロード後に保持される', async ({ editorPage, editorHelper }) => {
        let targetModel: string;
        const targetHistory = getRandomHistory();
        const targetRecovery = Math.floor(Math.random() * 5 + 1).toString();
        const targetMode = Math.random() > 0.5 ? '自動' : '手動';

        await test.step('1. AIエージェント画面を開き、UIからモデルを取得してランダムに変更', async () => {
            await editorPage.locator('#fab-bottom-menu-box').click();
            await editorPage.locator('#platformBottomMenu').getByText('AIエージェント').click();
            const agentWindow = editorPage.locator('agent-chat-window');

            await agentWindow.locator('.settings-btn').click();
            const modal = agentWindow.locator('.modal-dialog');

            const select = modal.locator('#agent-model-select');
            targetModel = await getRandomOptionValue(select);
            console.log(`[AI Agent Test] UIから取得したランダムモデル: ${targetModel}`);

            await select.selectOption({ value: targetModel });
            await modal.locator('#max-history-input').fill(targetHistory);
            await modal.locator('#max-recovery-input').fill(targetRecovery);
            await modal.getByRole('button', { name: '設定を保存' }).click();

            const modeBtn = agentWindow.locator('.mode-selector button', { hasText: targetMode });
            await modeBtn.click();
        });

        await test.step('2. ページをリロードし、スナップショットを破棄', async () => {
            await editorPage.reload();
            await editorPage.waitForLoadState('domcontentloaded');
            await editorHelper.handleSnapshotRestoreDialog();
        });

        await test.step('3. AIエージェントを再度開き、設定が保持されているか確認', async () => {
            await editorPage.locator('#fab-bottom-menu-box').click();
            await editorPage.locator('#platformBottomMenu').getByText('AIエージェント').click();
            const agentWindow = editorPage.locator('agent-chat-window');

            const modeBtn = agentWindow.locator('.mode-selector button', { hasText: targetMode });
            await expect(modeBtn).toHaveClass(/active/);

            await agentWindow.locator('.settings-btn').click();
            const modal = agentWindow.locator('.modal-dialog');

            await expect(modal.locator('#agent-model-select')).toHaveValue(targetModel);
            await expect(modal.locator('#max-history-input')).toHaveValue(targetHistory);
            await expect(modal.locator('#max-recovery-input')).toHaveValue(targetRecovery);
        });
    });
});