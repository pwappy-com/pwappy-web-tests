import { test as base, expect, Page } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';

/**
 * プロパティコンテナ内のCSSエディタにおける数値操作機能の検証テスト。
 * ArrowUp/Downキーによるインテリジェントな数値の増減、および
 * Shiftキーを組み合わせた加速機能が正しく動作することを確認します。
 */

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

type EditorFixtures = {
    editorPage: Page;
    appName: string;
    editorHelper: EditorHelper;
};

// 各テスト実行前にアプリケーションの作成とエディタの起動を自動で行うフィクスチャ
const test = base.extend<EditorFixtures>({
    appName: async ({ }, use) => {
        const workerIndex = test.info().workerIndex;
        const uniqueId = `${testRunSuffix}-${workerIndex}-${Date.now()}`;
        await use(`style-inc-test-${uniqueId}`.slice(0, 30));
    },
    editorPage: async ({ page, context, appName }, use) => {
        const testUrl = new URL(String(process.env.PWAPPY_TEST_BASE_URL));
        var domain: string = testUrl.hostname;
        if (domain !== 'localhost') {
            domain = '.' + domain;
        }
        await context.addCookies([
            { name: 'pwappy_auth', value: process.env.PWAPPY_TEST_AUTH!, domain: domain, path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 },
            { name: 'pwappy_ident_key', value: process.env.PWAPPY_TEST_IDENT_KEY!, domain: domain, path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 },
            { name: 'pwappy_login', value: process.env.PWAPPY_LOGIN!, domain: domain, path: '/', secure: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 },
        ]);
        await page.goto(String(process.env.PWAPPY_TEST_BASE_URL), { waitUntil: 'domcontentloaded' });

        const appKey = `inc-key-${Date.now().toString().slice(-6)}`;
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

test.describe('CSSエディタ：数値のインテリジェント増減機能のテスト', () => {

    test.beforeEach(async ({ editorPage, editorHelper }) => {
        // 右ハンドルを展開し、プロパティパネルの「スタイル」タブに切り替え
        await editorHelper.openMoveingHandle('right');
        const propertyContainer = editorPage.locator('property-container');
        await propertyContainer.locator('#tab-style').click();
        await expect(propertyContainer.locator('#style-container')).toBeVisible();
    });

    /**
     * Monaco Editor内での増減操作をシミュレートするヘルパー関数
     * @param editorPage 
     * @param css 初期状態のCSS文字列
     * @param line 操作対象の行番号
     * @param column 操作対象の列番号（カーソル位置）
     * @param key 使用するキー ('ArrowUp' | 'ArrowDown')
     * @param shift Shiftキーを同時押しするか
     * @returns 操作後のエディタの内容
     */
    async function testIncrement(
        editorPage: Page,
        initialCSS: string,
        line: number,
        column: number,
        key: 'ArrowUp' | 'ArrowDown',
        shift: boolean = false
    ) {
        // Shadow DOM経由でMonaco Editorのインスタンスに直接アクセスして状態を設定
        await editorPage.evaluate(({ css }) => {
            const container = document.querySelector('app-container');
            const host = container?.shadowRoot?.querySelector('property-container') as any;
            if (host && host.styleEditor) {
                host.styleEditor.setValue(css);
            }
        }, { css: initialCSS });

        // カーソル位置の設定とエディタへのフォーカス
        await editorPage.evaluate(({ l, c }) => {
            const container = document.querySelector('app-container');
            const host = container?.shadowRoot?.querySelector('property-container') as any;
            if (host && host.styleEditor) {
                host.styleEditor.setPosition({ lineNumber: l, column: c });
                host.styleEditor.focus();
            }
        }, { l: line, c: column });

        // キーボード操作のシミュレーション
        if (shift) await editorPage.keyboard.down('Shift');
        await editorPage.keyboard.press(key);
        if (shift) await editorPage.keyboard.up('Shift');

        // 更新後の値をエディタから取得
        return await editorPage.evaluate(() => {
            const container = document.querySelector('app-container');
            const host = container?.shadowRoot?.querySelector('property-container') as any;
            return host ? host.styleEditor.getValue() : '';
        });
    }

    test('基本：1px単位の増減 (font-size)', async ({ editorPage }) => {
        const css = 'element.style {\n    font-size: 16px;\n}';
        const result = await testIncrement(editorPage, css, 2, 17, 'ArrowUp');
        expect(result).toContain('font-size: 17px;');
    });

    test('インテリジェントステップ：0.1単位 (opacity)', async ({ editorPage }) => {
        const css = 'element.style {\n    opacity: 0.5;\n}';
        const result = await testIncrement(editorPage, css, 2, 15, 'ArrowUp');
        expect(result).toContain('opacity: 0.6;');
    });

    test('インテリジェントステップ：100単位 (font-weight)', async ({ editorPage }) => {
        const css = 'element.style {\n    font-weight: 400;\n}';
        const result = await testIncrement(editorPage, css, 2, 18, 'ArrowDown');
        expect(result).toContain('font-weight: 300;');
    });

    test('Shiftキーによる加速：1px -> 10px (width)', async ({ editorPage }) => {
        const css = 'element.style {\n    width: 100px;\n}';
        const result = await testIncrement(editorPage, css, 2, 13, 'ArrowUp', true);
        expect(result).toContain('width: 110px;');
    });

    /**
     * line-height等の小数を許容するプロパティにおいて、
     * Shift加速(ステップ1.0)適用時にMath.roundによる整数化が行われる現行仕様の検証。
     */
    test('Shiftキーによる加速（小数プロパティ）：0.1 -> 1.0 (line-height)', async ({ editorPage }) => {
        const css = 'element.style {\n    line-height: 1.2;\n}';
        const result = await testIncrement(editorPage, css, 2, 18, 'ArrowUp', true);
        // 現在の実装仕様: 1.2 + 1.0 = 2.2 -> Math.round(2.2) = 2 となる挙動を確認
        expect(result).toContain('line-height: 2;');
    });

    test('負の値と単位の維持 (margin-top)', async ({ editorPage }) => {
        const css = 'element.style {\n    margin-top: -10px;\n}';
        const result = await testIncrement(editorPage, css, 2, 17, 'ArrowUp');
        expect(result).toContain('margin-top: -9px;');
    });

    /**
     * カーソルが数値上にない場合、カスタムロジックが介入せず
     * エディタ標準の挙動（この場合は行移動）が維持されることを確認。
     */
    test('数値以外の場所では標準の行移動が行われること', async ({ editorPage }) => {
        await editorPage.evaluate(() => {
            const container = document.querySelector('app-container');
            const host = container?.shadowRoot?.querySelector('property-container') as any;
            if (host && host.styleEditor) {
                host.styleEditor.setValue('element.style {\n    color: red;\n    display: block;\n}');
                host.styleEditor.setPosition({ lineNumber: 2, column: 14 }); // 'red'の末尾
                host.styleEditor.focus();
            }
        });

        await editorPage.keyboard.press('ArrowDown');

        const finalPos = await editorPage.evaluate(() => {
            const container = document.querySelector('app-container');
            const host = container?.shadowRoot?.querySelector('property-container') as any;
            return host ? host.styleEditor.getPosition() : { lineNumber: 0 };
        });

        // 独自の増減処理が走らず、標準の「下の行への移動」が行われたことを検証
        expect(finalPos.lineNumber).toBe(3);
    });
});