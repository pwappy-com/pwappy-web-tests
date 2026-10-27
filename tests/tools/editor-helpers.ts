import { test, expect, type Page, type Locator, FrameLocator } from '@playwright/test';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { clickAndOpenNewTabSafely } from './window-helpers';

/**
 * Playwrightテスト用のエディタ操作ヘルパークラス。
 * エディタのPageオブジェクトとモバイルフラグを状態として保持し、
 * 各操作メソッドの引数をシンプルにします。
 * 
 * @example
 * // テストコードでの利用例
 * test.beforeEach(async ({ page, isMobile }) => {
 *   await page.goto('/editor');
 *   const helper = new EditorHelper(page, isMobile);
 *   // ...
 * });
 */
export class EditorHelper {
    private readonly page: Page;
    private readonly isMobile: boolean;

    /**
     * EditorHelperのインスタンスを生成します。
     * @param page エディタのPageオブジェクト
     * @param isMobile モバイルビューポートでテストを実行しているかどうかのフラグ
     */
    constructor(page: Page, isMobile: boolean) {
        this.page = page;
        this.isMobile = isMobile;
    }

    // =================================================================
    // 基本アクション
    // =================================================================

    /**
     * エディタ起動時に表示される「スターターテンプレートモーダル」を閉じてスキップします。
     * PlaywrightのShadow DOM自動透過機能を利用し、既存アプリ時は待機を即座にスキップします。
     */
    async handleStarterTemplateModal(): Promise<void> {
        const startTime = Date.now();
        const log = (msg: string) => {
            // デバッグ時以外は不要なのでコメント化
            // console.log(`[ModalCheck:Debug] [${Date.now() - startTime}ms] ${msg}`);
        };

        try {
            await test.step('スターターテンプレートモーダルのインテリジェントスキップ', async () => {
                log('判定処理を開始します。ロード完了を待機中...');

                // 1. ローディング表示が消えるのを確実に待つ（エディタDOMの安定化）
                const loadingOverlay = this.page.locator('app-container-loading-overlay');
                await expect(loadingOverlay).toBeHidden({ timeout: 15000 });

                // 2. PlaywrightのロケータでDOMツリーを走査し、空アプリかどうかを判定（Shadow DOM透過）
                const domTree = this.page.locator('#dom-tree');
                const hasContents = await domTree.locator('.node[data-node-type="page"], .node[data-node-type="ons-navigator"]').count() > 0;
                const isEmptyApp = !hasContents;

                log(`アプリの状態判定: ${isEmptyApp ? '【新規・空アプリ】' : '【既存・要素ありアプリ】'}`);

                // 既存の要素があるアプリの場合、モーダルは絶対に表示されないため即終了
                if (!isEmptyApp) {
                    log('要素ありアプリのため、待機なしで終了します。[スキップ成功]');
                    return;
                }

                // 3. 空アプリの場合のみ、モーダルに 'visible' 属性が付与されるのを最大6秒間待機（Shadow DOM自動透過）
                log('新規アプリのため、モーダル出現（visible属性）を最大6秒間待機します...');
                const starterModal = this.page.locator('starter-template-modal');

                // expect の組み込みリトライ（toHaveAttribute）を使って確実に属性の付与を待つ
                await expect(starterModal).toHaveAttribute('visible', '', { timeout: 6000 });
                log('モーダルの出現を確認しました！');

                // 4. モーダルのスキップ処理
                const skipBtn = starterModal.locator('.btn-skip, button:has-text("閉じて一から自分で作る")').first();
                await expect(skipBtn).toBeVisible({ timeout: 2000 });

                const warnDiagnosticUnavailable = (phase: string, operationSucceeded: boolean | null, error: unknown) => {
                    const message = error instanceof Error ? error.message : String(error);
                    // Fixed classifications only: raw messages can contain authenticated URLs.
                    const reason = /timeout|timed out/i.test(message) ? 'timeout'
                        : /closed|detached|destroyed/i.test(message) ? 'page-unavailable'
                        : 'diagnostic-error';
                    console.warn('[StarterClose] diagnostic unavailable:', JSON.stringify({
                        operationSucceeded, unavailable: phase, reason
                    }));
                };
                // Probe installation is optional. Undefined is an UNKNOWN state, never
                // evidence that the modal is closed. Only a successful DOM read of null
                // may suppress the native input; the attribute assertion is always required.
                let initialVisible: string | null | undefined;
                try {
                    initialVisible = await starterModal.evaluate((element: any) => {
                        const samples: any[] = [];
                        const record = (sample: object) => {
                            if (samples.length < 40) samples.push({ at: performance.now(), ...sample });
                        };
                        const listener = (event: Event) => {
                            const target = event.composedPath()[0] as HTMLElement;
                            if (event.type !== 'starter-modal-closed' && !target?.closest?.('.btn-skip')) return;
                            record({ type: event.type, trusted: event.isTrusted, visible: element.hasAttribute('visible') });
                        };
                        const types = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'starter-modal-closed'];
                        const root = element.shadowRoot;
                        let observer: MutationObserver | undefined;
                        let timer: ReturnType<typeof setInterval> | undefined;
                        // Define rollback before acquiring resources, so partial initialization
                        // (including observer.observe failure) also removes registered listeners.
                        const cleanup = () => {
                            for (const type of types) root?.removeEventListener(type, listener, true);
                            element.removeEventListener('starter-modal-closed', listener, true);
                            observer?.disconnect();
                            if (timer !== undefined) clearInterval(timer);
                            delete element.__e2eStarterProbe;
                        };
                        try {
                            for (const type of types) root.addEventListener(type, listener, true);
                            element.addEventListener('starter-modal-closed', listener, true);
                            observer = new MutationObserver(() => record({ type: 'visible-attribute', visible: element.hasAttribute('visible') }));
                            observer.observe(element, { attributes: true, attributeFilter: ['visible'] });
                            const heartbeat = { ticks: 0, maxGapMs: 0, lastAt: performance.now(), startedAt: performance.now(), hiddenObserved: document.hidden };
                            timer = setInterval(() => {
                                const now = performance.now();
                                heartbeat.maxGapMs = Math.max(heartbeat.maxGapMs, now - heartbeat.lastAt);
                                heartbeat.lastAt = now;
                                heartbeat.ticks++;
                                heartbeat.hiddenObserved ||= document.hidden;
                                if (now - heartbeat.startedAt >= 30000) cleanup();
                            }, 250);
                            element.__e2eStarterProbe = { samples, heartbeat, cleanup };
                            return element.getAttribute('visible');
                        } catch (error) {
                            cleanup();
                            throw error;
                        }
                    }, undefined, { timeout: 5000 });
                } catch (diagnosticError) {
                    // A diagnostic selector timeout cannot gate required user input.
                    warnDiagnosticUnavailable('installation', null, diagnosticError);
                }
                const closeStartedAt = Date.now();
                const nodeDelay = monitorEventLoopDelay({ resolution: 20 });
                nodeDelay.enable();
                let closePhase = 'reuse-visible';
                let phaseStartedAt = Date.now();
                const phaseTimes: { phase: string; elapsedMs: number }[] = [];
                const finishPhase = () => {
                    if (phaseTimes.length < 20) phaseTimes.push({ phase: closePhase, elapsedMs: Date.now() - phaseStartedAt });
                };
                let closeSucceeded = false;
                try {
                    // One awaited native input, never a mutating toPass callback. A toPass
                    // deadline does not cancel its callback or a protocol call in flight.
                    // Provisional orchestration budgets, NOT a product SLA: one observed
                    // client action took 9.739s (including post-action tracing).
                    if (initialVisible !== null) {
                        closePhase = 'native-click';
                        phaseStartedAt = Date.now();
                        await skipBtn.click({ timeout: 15000 });
                        finishPhase();
                    }
                    closePhase = 'assert-hidden';
                    phaseStartedAt = Date.now();
                    await expect(starterModal).not.toHaveAttribute('visible', '', { timeout: 10000 });
                    finishPhase();

                    closeSucceeded = true;
                } finally {
                    nodeDelay.disable();
                    // No samples means unknown, not a measured zero delay.
                    const nodeTiming = {
                        samples: nodeDelay.count,
                        maxMs: nodeDelay.count ? nodeDelay.max / 1e6 : null,
                        meanMs: nodeDelay.count ? nodeDelay.mean / 1e6 : null,
                        p99Ms: nodeDelay.count ? nodeDelay.percentile(99) / 1e6 : null,
                        phase: closePhase, phaseElapsedMs: Date.now() - phaseStartedAt, completedPhases: phaseTimes
                    };
                    if (!closeSucceeded) console.log('[StarterClose] node timing:', JSON.stringify(nodeTiming));
                    // Emit the runner-side duration before reading the page, even if its renderer is stalled.
                    if (!closeSucceeded) console.log('[StarterClose] operation failed after ms:', Date.now() - closeStartedAt);
                    const diagnosticStartedAt = Date.now();
                    try {
                        const diagnostic = await starterModal.evaluate((element: any) => {
                            const probe = element.__e2eStarterProbe;
                            if (!probe) return { unavailable: 'probe expired or already cleaned' };
                            const heartbeat = { ...probe.heartbeat, observationMs: performance.now() - probe.heartbeat.startedAt, tailGapMs: performance.now() - probe.heartbeat.lastAt, hiddenAtRead: document.hidden };
                            probe.cleanup();
                            return { samples: probe.samples, visible: element.hasAttribute('visible'), heartbeat };
                        }, undefined, { timeout: 5000 });
                        if (!closeSucceeded) console.log('[StarterClose] native events and reflected state:', JSON.stringify({ ...diagnostic, diagnosticElapsedMs: Date.now() - diagnosticStartedAt }));
                    } catch (cleanupError) {
                        // Optional telemetry is not the behavior oracle. Preserve native
                        // input/assertion failures, but do not create one after success.
                        // The probe self-cleans when readback cannot reach the renderer.
                        warnDiagnosticUnavailable('readback/cleanup', closeSucceeded, cleanupError);
                    }
                }

                log('モーダルの閉鎖完了。');
                await this.page.waitForTimeout(300);
            });
        } catch (e) {
            console.error('[StarterTemplateModal] Failed to close modal:', e);
            throw e;
        } finally {
            log(`判定ロジック全体の合計処理時間: ${Date.now() - startTime}ms`);
        }
    }

    /**
     * エディタ起動時に表示される可能性のある「スナップショット復元ダイアログ」を処理します。
     * リスナーを事前に登録することで、ブラウザ標準ダイアログのハンドリングを安定させます。
     */
    async handleSnapshotRestoreDialog(): Promise<void> {
        // 1. どんなダイアログが出ても自動でOKを押すリスナーを登録
        const dialogHandler = async (dialog: any) => {
            await dialog.accept().catch(() => { });
        };
        this.page.on('dialog', dialogHandler);

        try {
            await test.step('スナップショット復元ダイアログのチェックとクリーンアップ', async () => {
                // ローディングオーバーレイが完全に消えるのを待つ
                const loadingOverlay = this.page.locator('app-container-loading-overlay');
                await expect(loadingOverlay).toBeHidden({ timeout: 30000 });

                const snapshotConfirmDialog = this.page.locator('message-box', {
                    hasText: '前回正常に終了されなかった可能性'
                });

                // ダイアログが表示されるか確認
                if (await snapshotConfirmDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
                    // --- 1. 最初のダイアログ: 「破棄する」をクリック（活性化を待って確実に実行） ---
                    const discardInitialBtn = snapshotConfirmDialog.getByRole('button', { name: '破棄する' });
                    const discardConfirmDialog = this.page.locator('message-box', {
                        hasText: 'すべてのスナップショットを破棄しますか？'
                    });
                    if (!await discardConfirmDialog.isVisible()) {
                        await discardInitialBtn.click({ timeout: 10000 });
                    }
                    // Await the postcondition without replaying a mutating input.
                    await expect(discardConfirmDialog).toBeVisible({ timeout: 10000 });

                    // --- 3. 「はい、破棄します」をクリック（活性化を待って確実に実行） ---
                    // 通常クリックを一度だけ実行し、閉鎖を別途検証します
                    const discardBtn = discardConfirmDialog.getByRole('button', { name: 'はい、破棄します' });
                    // force クリックの完了だけでは閉鎖を保証できない。
                    // 通常クリックで操作可能性を待ち、実際の閉鎖まで検証する。
                    // Provisional native-action allowance, not a UI SLA: one Safari trace
                    // spent 4.892s before dispatch, leaving ~108ms of the old 5s budget.
                    await discardBtn.click({ timeout: 15000 });
                    await expect(snapshotConfirmDialog).toBeHidden({ timeout: 10000 });
                    await expect(discardConfirmDialog).toBeHidden({ timeout: 10000 });
                }
            });
        } finally {
            // 他のテストに影響を与えないよう、リスナーを解除
            this.page.off('dialog', dialogHandler);
        }
    }

    /**
     * エディタ内で新しいページを追加します。
     * @returns 追加された新しいページノードのLocator
     */
    async addPage(): Promise<Locator> {
        await this.page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });
        await this.openMoveingHandle('left');
        const pageNodes = this.page.locator('#dom-tree > .node[data-node-type="page"]');
        const previousIds = await pageNodes.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-node-id')));
        const getAddedIds = () => pageNodes.evaluateAll((nodes, ids) =>
            nodes.map(node => node.getAttribute('data-node-id'))
                .filter((id): id is string => id !== null && !ids.includes(id)), previousIds);
        const humburgerButton = this.page.locator('template-container #hamburger');
        await expect(humburgerButton).toBeVisible();
        await humburgerButton.click();
        const contextMenu = this.page.locator('#contextMenu');
        await expect(contextMenu).toBeVisible();
        await contextMenu.getByText('ページ追加').click();

        // .last() は次のページ追加で参照先が変わるため、追加完了とIDを確定して返す。
        await expect.poll(getAddedIds).toHaveLength(1);
        const [addedId] = await getAddedIds();
        const newPageNode = pageNodes.and(this.page.locator(`[data-node-id="${addedId}"]`));
        await expect(newPageNode).toBeVisible();
        return newPageNode;
    }

    /**
     * ツールボックスからコンポーネントをDOMツリーの指定場所にドラッグ＆ドロップします。
     * (オーバーロード)
     * @param componentName Toolboxに表示されているコンポーネント名
     * @param targetSelector D&Dのドロップ先となる要素の「セレクタ文字列」
     */
    async addComponent(componentName: string, targetSelector: string): Promise<Locator>;
    /**
     * ツールボックスからコンポーネントをDOMツリーの指定場所にドラッグ＆ドロップします。
     * (オーバーロード)
     * @param componentName Toolboxに表示されているコンポーネント名
     * @param targetLocator D&Dのドロップ先となる要素の「Locatorオブジェクト」
     */
    async addComponent(componentName: string, targetLocator: Locator): Promise<Locator>;
    /**
     * ツールボックスからコンポーネントをDOMツリーの指定場所にドラッグ＆ドロップします。
     * @param componentName Toolboxに表示されているコンポーネント名
     * @param target D&Dのドロップ先（セレクタ文字列またはLocatorオブジェクト）
     */
    async addComponent(componentName: string, target: string | Locator): Promise<Locator> {
        await this.openMoveingHandle('left');
        const targetLocator = typeof target === 'string' ? this.page.locator(target) : target;

        await expect(targetLocator).toBeVisible();

        const componentNodes = targetLocator.locator(`> .node[data-node-type="${componentName}"]`);
        const existingIds = await componentNodes.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-node-id')));
        const getAddedIds = () => componentNodes.evaluateAll((nodes, previousIds) =>
            nodes.map(node => node.getAttribute('data-node-id'))
                .filter((id): id is string => id !== null && !previousIds.includes(id)), existingIds);

        // Native drag is performed once. Retrying an input after a slow postcondition
        // can create duplicates, and toPass can outlive its outer deadline.
        await expect(this.page.locator('app-container-loading-overlay')).toBeHidden({ timeout: 10000 });
        await this.page.mouse.up();
        let dragSucceeded = false;
        try {
            await this.page.locator('tool-box-item', { hasText: componentName }).dragTo(targetLocator, {
                targetPosition: { x: 10, y: 10 }, timeout: 15000
            });
            dragSucceeded = true;
        } finally {
            try {
                await this.page.mouse.up();
            } catch (cleanupError) {
                if (dragSucceeded) throw cleanupError;
                console.error('[EditorSync:addComponent] mouse release failed:', cleanupError);
            }
        }
        await expect.poll(getAddedIds, { timeout: 10000 }).toHaveLength(1);

        const [addedId] = await getAddedIds();
        const newComponentNode = componentNodes.and(this.page.locator(`[data-node-id="${addedId}"]`));
        await expect(newComponentNode).toBeVisible();
        return newComponentNode;
    }

    /**
     * ツールボックスから「HTML Tag」をドラッグ＆ドロップします。
     * @param htmlTagName 作成するHTMLタグ名
     * @param targetSelector D&Dのドロップ先となる要素のセレクタ文字列
     * @returns 追加されたHTMLタグノードのLocator
     */
    async addComponentAsHtmlTag(htmlTagName: string, targetSelector: string): Promise<Locator> {
        await this.openMoveingHandle('left');

        const targetLocator = this.page.locator(targetSelector);

        // 1. ドラッグ＆ドロップを実行してダイアログを起動
        await this.page.locator('tool-box-item', { hasText: 'HTML Tag' }).dragTo(targetLocator);

        // 2. カスタムダイアログの表示を待機 (template-container の外側に移動したため、最上位ページから直接 first() で取得します)
        const dialog = this.page.locator('message-box#html-tag-select-dialog').first();
        await expect(dialog).toBeVisible({ timeout: 5000 });

        const presetTags = ['div', 'span', 'p', 'img', 'a', 'ul', 'li', 'br', 'h1', 'h2', 'h3', 'strong'];
        const targetTagLower = htmlTagName.toLowerCase();

        if (presetTags.includes(targetTagLower)) {
            // プリセットに含まれる場合は、対応するボタンをクリックして自動決定
            const presetBtn = dialog.locator('button.preset-tag-button', { hasText: new RegExp(`^${targetTagLower}$`, 'i') }).first();
            await presetBtn.click();
        } else {
            // プリセットに含まれない場合は、入力欄にテキストを入れてEnterキーで確定
            const input = dialog.locator('input#custom-tag-input');
            await expect(input).toBeEditable();
            await input.fill(htmlTagName);
            await input.press('Enter');
        }

        // 3. ダイアログが閉じるのを待機
        await expect(dialog).toBeHidden();

        const newHtmlTagNode = targetLocator.locator(`> .node[data-node-type="${htmlTagName}"]`);
        await expect(newHtmlTagNode).toBeVisible({ timeout: 5000 });
        return newHtmlTagNode;
    }

    /**
     * DOMツリー内の指定したノードをクリックして選択状態にします。
     * @param nodeLocator 選択したいノードのLocator
     */
    async selectNodeInDomTree(nodeLocator: Locator): Promise<void> {
        // 左ハンドルをオープン
        await this.openMoveingHandle('left');

        await nodeLocator.click({ position: { x: 0, y: 10 } });
        await expect(nodeLocator).toHaveClass(/(?:^|\s)node-select(?:\s|$)/);
    }

    /**
     * 高精度なドラッグ＆ドロップを行います。
     * 標準のdragToでは速度が速すぎてアプリ側の並び替えイベントが発火しない場合に有効です。
     * マウスの動きをステップ分けしてシミュレートします。
     * 
     * @param sourceLocator ドラッグ開始要素
     * @param targetLocator ドロップ対象要素
     * @param steps 移動にかけるステップ数（多いほどゆっくり移動し、イベントが発火しやすくなる）
     */
    async dragAndDropManually(sourceLocator: Locator, targetLocator: Locator, steps: number = 20): Promise<void> {
        const sourceBox = await sourceLocator.boundingBox();
        const targetBox = await targetLocator.boundingBox();
        if (!sourceBox || !targetBox) {
            throw new Error('dragAndDropManually: 要素のBoundingBoxが取得できませんでした');
        }

        // 要素の中心座標を計算
        const srcX = sourceBox.x + sourceBox.width / 2;
        const srcY = sourceBox.y + sourceBox.height / 2;
        const dstX = targetBox.x + targetBox.width / 2;
        const dstY = targetBox.y + targetBox.height / 2;

        // マウス操作のシミュレーション
        await this.page.mouse.move(srcX, srcY);
        await this.page.mouse.down();
        // stepsを指定することで、時間をかけて移動させ dragover を確実に発火させる
        await this.page.mouse.move(dstX, dstY, { steps: steps });
        await this.page.mouse.up();

        // DOMの更新を少し待つ
        await this.page.waitForTimeout(500);
    }

    /**
     * プロパティパネルの「属性を編集」ボタン（歯車アイコン）をクリックしてモーダルを開きます。
     */
    async openAttributeEditor(): Promise<void> {
        await this.openMoveingHandle('right');
        await this.page.locator('property-container').getByTitle('属性を編集').click();
        await expect(this.page.locator('#attributeList')).toBeVisible();
    }

    /**
 * 属性キーから画面上の日本語表示名を取得するヘルパー関数
 */
    getDisplayName(key: string): string {
        switch (key) {
            case 'domId': return 'ID';
            case 'explain': return '説明';
            case 'class': return 'クラス';
            case 'text': return 'テキスト';
            case 'template-id': return 'テンプレートID';
            case 'style-flex': return 'Flexboxレイアウト (親要素)';
            case 'style-flexitem': return 'Flexbox配置 (子要素)';
            case 'style-spacing': return '余白調整';
            case 'style-typography': return '文字装飾';
            case 'style-background': return '背景 / 装飾';
            case 'style-border': return 'ボーダー / 角丸';
            case 'style-shadow': return 'シャドウ / 奥行き';
            case 'style-sizing': return 'サイズ / 表示制御';
            default: return key;
        }
    }

    /**
     * 属性編集モーダルで新しい属性定義を追加します。
     * @param name 属性名
     * @param template テンプレート文字列 (例: 'input[text]', 'style-flex')
     * @param scope 'element' (要素に) または 'tag' (タグに)
     */
    async addAttributeDefinition({ name, template, scope }: { name: string; template: string; scope: 'element' | 'tag' }): Promise<void> {
        const propertyContainer = this.getPropertyContainer();
        const scopeButtonName = scope === 'element' ? '要素に追加' : 'タグに追加';

        // 1. 設定用モーダルを起動して入力するフェーズ
        await expect(propertyContainer).toBeVisible();
        await propertyContainer.getByRole('button', { name: scopeButtonName }).click();

        const nameCombobox = propertyContainer.getByRole('combobox', { name: '属性名:' });
        const templateCombobox = propertyContainer.getByRole('combobox', { name: 'テンプレート:' });

        await expect(nameCombobox).toBeEditable();
        await expect(templateCombobox).toBeEditable();

        await nameCombobox.fill(name);
        await templateCombobox.fill(template);

        await propertyContainer.getByRole('button', { name: '追加' }).click();

        // 2. モーダルが閉じて、追加された入力フィールドがDOMに描画されるまでのラグを toPass で吸収
        const newPropertyRow = propertyContainer.locator(`[data-attribute-type="${name}"], [data-attribute-key="${name}"]`).first();

        await expect(async () => {
            // アラート（重複エラー等）が割り込んでいないか確認
            const alert = this.page.locator('alert-component');
            if (await alert.isVisible().catch(() => false)) {
                await alert.getByRole('button', { name: '閉じる' }).click({ force: true }).catch(() => { });
            }

            // 設定用ポップアップが完全に閉じていることを確認
            await expect(propertyContainer.locator('#attributeList')).toBeHidden({ timeout: 1000 });

            // 追加された行が可視（レンダリング済み）になっていることを検証
            await expect(newPropertyRow).toBeVisible({ timeout: 1000 });
        }).toPass({
            timeout: 15000,      // 最大15秒間リトライ
            intervals: [1000]    // 1秒間隔
        });
    }

    /**
     * 属性編集モーダルで指定した属性定義を削除します。
     * @param name 削除する属性名
     */
    async deleteAttributeDefinition(name: string): Promise<void> {
        const propertyContainer = this.getPropertyContainer();
        const attrList = propertyContainer.locator('#attributeList');

        const targetRow = attrList.locator(`div.attribute-item[data-attribute-key="${name}"]`);
        await targetRow.locator('.edit-icon').click();

        this.page.once('dialog', dialog => dialog.accept());
        await propertyContainer.getByRole('button', { name: '削除' }).click();
        await expect(targetRow).toBeHidden();
    }

    /**
     * 新しいページを追加し、そのコンテンツエリアに`ons-button`を1つ配置します。
     * @returns ページとボタンのノードLocator { pageNode: Locator, buttonNode: Locator }
     */
    async setupPageWithButton(): Promise<{ pageNode: Locator; buttonNode: Locator }> {
        const pageNode = await this.addPage();
        const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';
        const buttonNode = await this.addComponent('ons-button', contentAreaSelector);
        return { pageNode, buttonNode };
    }

    /**
     * Flexコンテナと、その子要素となるFlexアイテムを配置し、それぞれに必要な属性を定義します。
     * @returns コンテナとアイテムのノードLocator { containerNode: Locator, itemNode: Locator }
     */
    async setupFlexContainerWithItem(): Promise<{ containerNode: Locator; itemNode: Locator }> {
        await this.addPage();
        const contentAreaSelector = '#dom-tree div[data-node-explain="コンテンツ"]';

        const containerNode = await this.addComponentAsHtmlTag('flex-container', contentAreaSelector);
        await this.selectNodeInDomTree(containerNode);
        await this.openAttributeEditor();
        await this.addAttributeDefinition({ name: 'style-flex', template: 'style-flex', scope: 'tag' });
        await this.getPropertyInput('style-flex').locator('input[type="checkbox"]').check();

        const containerId = await containerNode.getAttribute('data-node-id');
        const containerSelector = `#dom-tree div[data-node-id="${containerId}"]`;

        const itemNode = await this.addComponentAsHtmlTag('flex-item', containerSelector);
        await this.selectNodeInDomTree(itemNode);
        await this.openAttributeEditor();
        await this.addAttributeDefinition({ name: 'style-flexitem', template: 'style-flex-item', scope: 'tag' });

        return { containerNode, itemNode };
    }

    /**
     * エディタ内のトップテンプレートリストに特定のページが表示されているか確認します。
     * @param pageName 確認するページ名
     */
    async expectPageInTemplateList(pageName: string): Promise<void> {
        await this.page.locator('template-container').locator('.select').click();
        const topTemplateList = this.page.locator('template-container').locator('#top-template-list');
        await expect(topTemplateList).toBeVisible();
        await expect(topTemplateList.locator('.top-template-item', { hasText: pageName })).toBeVisible();
        await this.page.locator('template-container').locator('.title-bar').click();
        await expect(topTemplateList).toBeHidden();
    };

    /**
     * エディタのプレビューエリア（iframe）のFrameLocatorを取得します。
     * @returns プレビューエリアのFrameLocator
     */
    getPreviewFrame(): FrameLocator {
        return this.page.locator('#ios-container #renderzone').contentFrame();
    }

    /**
     * エディタのプロパティパネルのLocatorを取得します。
     * @returns プロパティパネルのLocator
     */
    getPropertyContainer(): Locator {
        return this.page.locator('property-container');
    }

    /**
     * エディタのDOMツリーのLocatorを取得します。
     * @returns DOMツリーのLocator
     */
    getDomTree(): Locator {
        return this.page.locator('#dom-tree');
    }

    /**
     * プレビューエリア内の指定された要素のLocatorを取得します。
     * @param selector プレビュー内で探す要素のCSSセレクタ
     * @returns 指定された要素のLocator
     */
    getPreviewElement(selector: string): Locator {
        return this.getPreviewFrame().locator(selector);
    }

    /**
     * プロパティパネル内の指定された属性のUI要素（入力欄やカスタム要素）を取得します。
     * @param attributeNameOrTagName 属性名またはカスタムタグ名 (例: 'text', 'style-flex-item')
     * @returns 指定された属性UI要素のLocator
     */
    getPropertyInput(attributeNameOrTagName: string): Locator {
        const propertyContainer = this.page.locator('property-container');
        // ホスト要素（attribute-input等）を特定。内部のinputとの重複を避けるため.first()を適用
        return propertyContainer.locator(`[data-attribute-type="${attributeNameOrTagName}"], ${attributeNameOrTagName}`).first();
    }

    /**
     * 指定したハンドルをタップして開きます (モバイル時のみ動作)。
     * @param handleType 'right' | 'left'
     */
    async openMoveingHandle(handleType: 'right' | 'left'): Promise<void> {
        if (!this.isMobile) return;

        await this.setMovingHandleState(handleType, true);
    }

    /**
     * ハンドルを閉じる (モバイル時のみ動作)。
     */
    async closeMoveingHandle(): Promise<void> {
        if (!this.isMobile) return;
        await this.setMovingHandleState('right', false);
        await this.setMovingHandleState('left', false);
    }

    private async setMovingHandleState(handleType: 'right' | 'left', open: boolean): Promise<void> {
        const handle = this.page.locator(`#${handleType}MovingHandle`);
        const container = this.page.locator(handleType === 'right' ? 'script-container' : 'template-container');
        let attempt = 0;
        await expect(async () => {
            const attemptStarted = Date.now();
            console.log(`[EditorSync:movingHandle] side=${handleType} open=${open} attempt=${++attempt} start`);
            try {
                if (await container.isVisible() !== open) {
                    await expect(handle).toBeVisible({ timeout: 5000 });
                    await this.page.mouse.up();
                    // WebKitではハンドルのstable待ちが完了しない例がある。
                    // 可視性と操作後の状態を検証し、同じ操作を短時間に混在させない。
                    await handle.dblclick({ force: true, timeout: 5000 });
                }
                if (open) {
                    await expect(container).toBeVisible({ timeout: 5000 });
                } else {
                    await expect(container).toBeHidden({ timeout: 5000 });
                }
            } catch (error) {
                console.error(`[EditorSync:movingHandle] attempt=${attempt} elapsedMs=${Date.now() - attemptStarted}: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }).toPass({ timeout: 20000, intervals: [1000] });
    }

    /**
     * 指定されたコンテナ内のタブを切り替えます。
     * メインタブの重複を避けるため、ID指定での切り替えを優先します。
     */
    async switchTabInContainer(containerLocator: Locator, tabName: string): Promise<void> {
        const tabIdMap: Record<string, string> = {
            'イベント': '#tab-event',
            'スクリプト': '#tab-script',
            'サービスワーカー': '#tab-serviceworker',
            'コンソール': '#tab-console',
            'テスト': '#tab-test',
            '属性': '#tab-attributes',
            'スタイル': '#tab-style',
            'アプリ設定': '#tab-appsetting'
        };

        // IDマップに存在すればIDを使用、なければ厳密なテキストマッチを行う
        const selector = tabIdMap[tabName] || `.tab:text-is("${tabName}")`;
        const tabLocator = containerLocator.locator(selector).first();

        let attempt = 0;
        await expect(async () => {
            const attemptStarted = Date.now();
            console.log(`[EditorSync:switchTab] tab=${tabName} attempt=${++attempt} start`);
            try {
                const alert = this.page.locator('alert-component');
                if (await alert.isVisible().catch(() => false)) {
                    await alert.getByRole('button', { name: '閉じる' }).click().catch(() => { });
                }
                // Monacoエディタのサジェストなどが被っているケースを考慮しEscapeを送信
                await this.page.keyboard.press('Escape');
                // 選択済みタブへのクリックも、サブウィンドウを閉じる外部クリックとして必要。
                await expect(tabLocator).toBeVisible({ timeout: 5000 });
                await tabLocator.click({ force: true, timeout: 5000 });

                // 切り替わったことを確認（activeクラスが付与されるのを待つ）
                await expect(tabLocator).toHaveClass(/active/, { timeout: 3000 });
            } catch (error) {
                console.error(`[EditorSync:switchTab] attempt=${attempt} elapsedMs=${Date.now() - attemptStarted}: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        }).toPass({ timeout: 15000, intervals: [1000] });
    }

    /**
     * プレビュー内の要素のCSSプロパティを検証します。
     * @param selector プレビュー内で探す要素のCSSセレクタ
     * @param property 検証するCSSプロパティ名 (例: 'background-color')
     * @param value 期待するCSSプロパティの値 (例: 'rgb(255, 0, 0)')
     */
    async expectPreviewElementCss({ selector, property, value }: { selector: string; property: string; value: string | RegExp }): Promise<void> {
        const element = this.getPreviewElement(selector);

        // スタイル反映の瞬間的なタイムラグを吸収するため、expect.toPassによるポーリング待機を行います
        await expect(async () => {
            await expect(element).toHaveCSS(property, value, { timeout: 2000 });
        }).toPass({ timeout: 10000, intervals: [500] });
    }

    /**
     * プレビュー内の要素の属性を検証します。
     * @param selector プレビュー内で探す要素のCSSセレクタ
     * @param attributeName 検証する属性名
     * @param value 期待する属性の値。値がないこと(属性が存在しないこと)を検証する場合は `null` を渡す。
     */
    async expectPreviewElementAttribute({ selector, attributeName, value }: { selector: string; attributeName: string; value: string | null }): Promise<void> {
        const element = this.getPreviewElement(selector);
        if (value === null) {
            await expect(element).not.toHaveAttribute(attributeName, /.*/);
        } else {
            await expect(element).toHaveAttribute(attributeName, value);
        }
    }

    /**
     * プロパティ入力欄の行がハイライトされているか（特定の背景色か）を検証します。
     * @param propertyInputLocator 検証対象のプロパティ入力欄のLocator
     * @param expectedColor 期待する背景色 (例: 'rgba(0, 112, 255, 0.11)')。色がついていないことを期待する場合は null を渡す。
     */
    async expectPropertyHighlight(propertyInputLocator: Locator, expectedColor: string | null): Promise<void> {
        const backgroundColor = await propertyInputLocator.evaluate(el => {
            const root = el.getRootNode();
            if (!(root instanceof ShadowRoot)) return null;
            const hostElement = root.host;
            const editorRow = hostElement.closest('.editor-row');
            return editorRow ? window.getComputedStyle(editorRow).backgroundColor : null;
        });

        if (expectedColor) {
            expect(backgroundColor).toBe(expectedColor);
        } else {
            expect(backgroundColor).toBe('rgba(0, 0, 0, 0)');
        }
    }

    /**
     * 動作モードに切り替え、必要に応じてアラートを検証します。
     * @param options オプション
     * @param options.expectedAlertText 検証したいアラートのテキスト（指定しない場合はアラート検証をスキップ）
     */
    async switchToRunModeAndVerify(options: { expectedAlertText?: string } = {}): Promise<void> {
        const platformSwitcher = this.page.locator('platform-switcher');
        const menu = platformSwitcher.locator('#platformEditMenu');

        const menuToggle = platformSwitcher.locator('.screen-rotete-container');
        await expect(async () => {
            if (!await menu.isVisible()) {
                await this.page.mouse.up();
                await menuToggle.click({ timeout: 5000 });
            }
            await expect(menu).toBeVisible({ timeout: 5000 });
        }).toPass({ timeout: 15000, intervals: [1000] });

        await menu.getByText('動作', { exact: true }).click({ timeout: 5000 });

        // 動作モードの再描画による自動閉鎖を先に待ち、閉鎖途中にトグルを押して再展開しない。
        try {
            await expect(menu).toBeHidden({ timeout: 5000 });
        } catch {
            console.log('[RunMode] メニューが閉じないため、表示状態を再確認して閉じます。');
            if (await menu.isVisible()) {
                await this.page.mouse.up();
                await menuToggle.click({ timeout: 5000 });
            }
            await expect(menu).toBeHidden({ timeout: 5000 });
        }

        if (options.expectedAlertText) {
            const previewFrame = this.getPreviewFrame();
            const alertDialog = previewFrame.locator('ons-alert-dialog');
            await expect(alertDialog).toBeVisible();
            await expect(alertDialog).toContainText(options.expectedAlertText);
            const alertDialogButton = alertDialog.locator('ons-alert-dialog-button');
            await alertDialogButton.click();
            await expect(alertDialog).toBeHidden();
        }
    }

    /**
     * エディタの内容を保存し、QRコードから実機テストページを新しいタブで開きます。
     */
    async saveAndOpenTestPage(): Promise<Page> {
        const menuButton = this.page.locator('#fab-bottom-menu-box');
        const platformBottomMenu = this.page.locator('#platformBottomMenu');
        const alert = this.page.locator('alert-component');

        await expect(menuButton).toBeVisible();
        await expect(menuButton).toBeEnabled();
        await menuButton.click();
        await expect(platformBottomMenu).toBeVisible();

        // 保存対象のリクエストをクリック前に登録し、HTTP応答とアプリの結果を必須確認する。
        // URLの部分一致やタイムアウトの握りつぶしで、保存失敗を見逃さない。
        const appKey = new URL(this.page.url()).searchParams.get('appKey');
        expect(appKey, '保存対象のappKeyが必要です').toBeTruthy();
        const [saveResponse] = await Promise.all([
            this.page.waitForResponse(response => {
                const request = response.request();
                if (request.method() !== 'PUT') return false;
                try {
                    const payload = request.postDataJSON();
                    return payload?.appKey === appKey && payload?.editorJson !== undefined;
                } catch {
                    return false;
                }
            }, { timeout: 30000 }),
            platformBottomMenu.getByText('保存', { exact: true }).click()
        ]);
        expect(saveResponse.ok(), `保存API HTTP ${saveResponse.status()}`).toBeTruthy();
        const saveResult = await saveResponse.json();
        expect(saveResult.code, '保存APIの成功コード').toBe(200);

        // 保存応答後の再読込・再描画が完了するまで待つ。固定の5秒待機は不要。
        const loadingOverlay = this.page.locator('app-container-loading-overlay');
        await expect(loadingOverlay).toBeHidden({ timeout: 30000 });

        // アラートにエラー文字が含まれていればテストを強制終了させる
        if (await alert.isVisible({ timeout: 5000 }).catch(() => false)) {
            const msg = await alert.evaluate((el: any) => el.alertMessage || el.innerText || el.textContent || '');
            if (msg?.includes('エラー') || msg?.includes('失敗')) {
                throw new Error(`[アプリ保存失敗] ${msg}`);
            }
            await alert.getByRole('button', { name: '閉じる' }).click();
            await expect(alert).toBeHidden();
        }

        // 保存後にメニューが閉じていたら再度開く
        await expect(async () => {
            if (!await platformBottomMenu.isVisible()) {
                await expect(this.page.locator('app-container-loading-overlay')).toBeHidden();
                await this.page.mouse.up();
                await menuButton.click({ timeout: 5000 });
            }
            await expect(platformBottomMenu).toBeVisible({ timeout: 5000 });
        }).toPass({
            timeout: 15000,
            intervals: [1000]
        });

        // 共通関数を使ってテストページ（タブ）を開く
        const testPage = await clickAndOpenNewTabSafely(this.page, this.page.context(), async () => {
            await this.page.locator('#qrcode').click({ force: true }).catch(async () => {
                await this.page.locator('#qrcode').evaluate((el: HTMLElement) => el.click());
            });
        });

        await testPage.waitForLoadState('domcontentloaded');
        // console.log(`[TestPage URL] 開いた実機テストページのURL: ${testPage.url()}`);

        return testPage;
    }

    /**
     * DOMツリー内で、特定のデータ属性を持つノードを選択します。
     * @param attributeName 'data-node-id' や 'data-node-type' などの属性名
     * @param attributeValue 属性の値
     * @returns 選択されたノードのLocator
     */
    async selectNodeByAttribute(attributeName: string, attributeValue: string): Promise<Locator> {
        const domTree = this.getDomTree();
        const node = domTree.locator(`div[${attributeName}="${attributeValue}"]`);
        await this.selectNodeInDomTree(node);
        return node;
    }

    /**
     * DOMツリーで選択中のコンテキスト（トップレベルテンプレート）を切り替えます。
     * @param templateId 'アプリケーション' またはページのdata-template-id
     */
    async switchTopLevelTemplate(templateId: string): Promise<void> {
        await this.openMoveingHandle('left');

        const topContainer = this.page.locator('.top-container');
        const selectBox = topContainer.locator('.select');
        await selectBox.click();

        const topTemplateListContainer = this.page.locator('#top-template-list');
        // リストが表示されるのを待つ
        await expect(topTemplateListContainer).toBeVisible({ timeout: 5000 });

        const targetToplistItem = topTemplateListContainer.locator(`div.top-template-item[data-template-id="${templateId}"]`);

        try {
            // ターゲットが見えるかチェック
            await expect(targetToplistItem).toBeVisible({ timeout: 5000 });
        } catch (e) {
            const items = await topTemplateListContainer.locator('div.top-template-item').all();
            for (const item of items) {
                const id = await item.getAttribute('data-template-id');
                const text = await item.innerText();
            }
            throw e;
        }

        await targetToplistItem.click();
        await expect(topTemplateListContainer).toBeHidden();
        // メニューが閉じただけでは旧ツリーが残るため、選択先の再描画を待つ。
        await expect(this.page.locator(`#dom-tree > .node[data-node-id="${templateId}"]`)).toBeVisible();
    }

    /**
     * 指定したイベントに、新しいスクリプトを特定の名前で追加します。
     * @param eventName イベント名 (例: 'DOMContentLoaded', 'click')
     * @param scriptName 作成するスクリプト名 (例: 'sample001')
     */
    async addScriptToEvent(
        { eventName, scriptName }: { eventName: string; scriptName: string }
    ): Promise<void> {
        const scriptContainer = this.page.locator('script-container');
        await expect(scriptContainer).toBeVisible();

        const eventRow = scriptContainer.locator(`div.editor-row:has(div.label:text-is("${eventName}"))`);
        await expect(eventRow).toBeVisible();

        await eventRow.getByTitle('スクリプトの追加').click();

        const scriptAddMenu = this.page.locator('event-container #scriptAddMenu');
        await expect(scriptAddMenu).toBeVisible();

        const scriptNameInput = scriptAddMenu.locator('#script-name');
        await expect(scriptNameInput).toBeEditable();
        await scriptNameInput.fill(scriptName);
        await expect(scriptAddMenu).toBeVisible();
        await expect(scriptAddMenu).toBeEnabled();
        await scriptAddMenu.locator('#edit-add-script').click();
        await expect(scriptAddMenu).toBeHidden();

        await expect(eventRow.getByText(scriptName)).toBeVisible();
    }

    /**
     * イベントに関連付けられたスクリプトを編集し、保存します。
     * @param eventName イベント名
     * @param scriptName 編集するスクリプト名
     * @param scriptContent 新しいスクリプトのコード内容
     */
    async editScript(
        { eventName, scriptName, scriptContent }: { eventName: string; scriptName: string; scriptContent: string }
    ): Promise<void> {
        await this.openMoveingHandle('right');
        const scriptContainer = this.page.locator('script-container');
        await expect(scriptContainer).toBeVisible();
        const eventContainer = scriptContainer.locator('event-container');
        await expect(eventContainer).toBeVisible();

        const eventRow = eventContainer.locator(`div.editor-row:has(div.label:text-is("${eventName}"))`);
        await expect(eventRow).toBeVisible();

        const scriptRow = eventRow.locator(`div.editor-row-right-item`).filter({ hasText: scriptName });
        await expect(scriptRow).toBeVisible();
        await scriptRow.getByTitle('スクリプトの編集').click();

        const monacoEditor = scriptContainer.locator('.monaco-editor[role="code"]');
        await expect(monacoEditor).toBeVisible();

        const browserName = this.page.context().browser()?.browserType().name();

        // APIを使用して値を設定（優先実行）
        const apiResult = await this.setMonacoValue(monacoEditor, scriptContent);

        // 値が正しく反映されたか確認
        const currentContent = await this.getMonacoEditorContent();
        if (normalizeWhitespace(currentContent) !== normalizeWhitespace(scriptContent)) {
            // API反映に失敗した場合はキーボード入力でフォールバック
            const textarea = monacoEditor.locator('textarea').first();
            await monacoEditor.locator('.view-lines').click();
            await textarea.focus();
            await this.page.keyboard.press('Escape');
            await this.page.keyboard.press('Control+A');
            await this.page.keyboard.press('Meta+A');
            await this.page.keyboard.press('Delete');
            await this.page.keyboard.press('Backspace');
            await this.page.waitForTimeout(300);

            if (browserName === 'webkit') {
                await expect(textarea).toBeEditable();
                await textarea.fill(scriptContent);
            } else {
                await textarea.pressSequentially(scriptContent, { delay: 10 });
            }
            await this.page.keyboard.press('Escape');
        }

        // 1. 【修正】タイトルが変更されたため、ID（#fab-save）で安全に特定します
        const saveButton = scriptContainer.locator('#fab-save');
        const saveIcon = saveButton.locator('i');

        // 保存前に「変更あり」のクラス（shake-save-button）が付くのを待つ
        await expect(saveIcon).toHaveClass(/shake-save-button/);
        await saveButton.click();

        // 保存完了の判定
        const alert = this.page.locator('alert-component');
        // isVisible({ timeout }) は待機しないため、保存結果が出るまで明示的に待つ。
        await expect.poll(async () => {
            if (await alert.isVisible()) return true;
            const className = await saveIcon.getAttribute('class');
            return !className?.split(/\s+/).includes('shake-save-button');
        }, { timeout: 20000, message: 'スクリプトの保存完了またはエラー表示を待機' }).toBe(true);

        if (await alert.isVisible()) {
            const msg = await alert.evaluate((el: any) => el.alertMessage || el.innerText || '');

            if (msg?.includes('エラー') || msg?.includes('修正')) {
                throw new Error(`スクリプト保存エラー: ${msg}\n入力したコード:\n${scriptContent}`);
            }
            await alert.getByRole('button', { name: '閉じる' }).click();
            await expect(alert).toBeHidden();
        }

        // アイコンが通常状態に戻るのを待つ
        await expect(saveIcon).not.toHaveClass(/shake-save-button/);

        // 2. 【追加】新仕様対応：戻るボタン（#fab-close）をクリックしてエディタを閉じ、一覧に戻る
        const closeButton = scriptContainer.locator('#fab-close');
        await closeButton.click();
        // 閉じる操作はイベントタブへの復帰を保証しないため、編集画面の終了を確認する。
        await expect(monacoEditor).toBeHidden();
    }

    /**
     * プレビュー（Renderzone）内の<script>タグを調べ、期待するコードが含まれているか検証します。
     * @param expectedContent 期待するスクリプト文字列
     */
    async verifyScriptInPreview(expectedContent: string): Promise<void> {
        const previewFrame = this.getPreviewFrame();
        await previewFrame.locator('body').waitFor({ state: 'attached' });
        const scripts = previewFrame.locator('script');
        const allScriptsContent = await scripts.allTextContents();
        const combinedText = allScriptsContent.join('\n');

        const normalizedReceived = normalizeWhitespace(combinedText);
        const normalizedExpected = normalizeWhitespace(expectedContent);
        expect(normalizedReceived).toContain(normalizedExpected);
    }

    /**
     * 指定したノードの特定のイベントに、新しいスクリプトを追加します。
     * @param nodeLocator イベントを追加する対象のノード (例: ページノード)
     * @param eventName イベント名 (例: 'init', 'show')
     * @param scriptName 作成するスクリプト名
     */
    async addScriptToNodeEvent(
        { nodeLocator, eventName, scriptName }: { nodeLocator: Locator, eventName: string, scriptName: string }
    ): Promise<void> {
        await this.openMoveingHandle("left");
        await this.selectNodeInDomTree(nodeLocator);

        const scriptContainer = this.page.locator('script-container');
        await this.openMoveingHandle("right");
        await this.switchTabInContainer(scriptContainer, 'イベント');

        await this.addScriptToEvent({ eventName, scriptName });
    }

    /**
     * ページまたはプレビューフレーム内で、特定の順番でアラートが表示され、
     * それぞれを閉じることを安定的に検証します。
     * @param pageOrFrame PageオブジェクトまたはFrameLocatorオブジェクト
     * @param expectedText 期待するアラートのテキスト
     */
    async verifyAndCloseAlert(
        pageOrFrame: Page | FrameLocator,
        expectedText: string
    ): Promise<void> {
        // 複数アラートがスタックされている場合を考慮し、last() で確実に特定する
        const alertDialog = pageOrFrame.locator('ons-alert-dialog').filter({ hasText: expectedText }).last();

        // toPassによる再試行を活用するため、個別の先行タイムアウト値を調整
        await expect(async () => {
            await expect(alertDialog).toBeVisible({ timeout: 2000 });
            await expect(alertDialog).toContainText(expectedText);
        }).toPass({ timeout: 10000 });

        const alertButton = alertDialog.locator('ons-alert-dialog-button');

        // クリックと非表示確認をセットにしてリトライ（toPass）させる
        await expect(async () => {
            const isVisible = await alertDialog.isVisible();
            if (isVisible) {
                // force: trueのクリックがインターセプトされる環境への対策として
                // dispatchEvent を使い、ブラウザ本来のイベントフローを自然に発火させる
                await alertButton.dispatchEvent('click');
            }

            await expect(alertDialog).toBeHidden({ timeout: 1000 });
        }).toPass({
            timeout: 15000,
            intervals: [1000] // 1秒おきに再試行
        });

        // 固定待機(waitForTimeout)を完全に廃止し、body要素が安定していることを条件に待機を代用
        await pageOrFrame.locator('body').waitFor({ state: 'attached', timeout: 5000 });
    }

    /**
     * 新しいスクリプトを追加します。
     * @param scriptName - 追加するスクリプトの名前
     * @param scriptType - 'function' または 'class'
     */
    async addNewScript(scriptName: string, scriptType: 'function' | 'class' = 'function'): Promise<void> {
        const scriptContainer = this.page.locator('script-container');
        const scriptListContainer = scriptContainer.locator('#script-list-container');
        const scriptAddButton = scriptListContainer.getByTitle("スクリプトの追加");
        await scriptAddButton.click();

        const addMenu = scriptListContainer.locator('#scriptAddMenu');
        await expect(addMenu).toBeVisible();
        await addMenu.locator(`input[type="radio"][value="${scriptType}"]`).check();
        const scriptNameInput = addMenu.locator('input#script-name');
        await expect(scriptNameInput).toBeEditable();
        await scriptNameInput.fill(scriptName);
        await addMenu.locator('button:has-text("追加")').click();
        await expect(addMenu).toBeHidden();
        await expect(scriptContainer.locator(`.editor-row-left:has-text("${scriptName}")`)).toBeVisible();
    }

    /**
     * 既存のスクリプトの内容を書き換えます。
     * @param scriptName - 編集するスクリプトの名前
     * @param scriptContent - 新しいスクリプトのコード内容
     */
    async editScriptContent(scriptName: string, scriptContent: string): Promise<void> {
        const scriptContainer = this.page.locator('script-container');
        const scriptRow = scriptContainer.locator('.editor-row', { hasText: scriptName });
        await scriptRow.getByTitle('スクリプトの編集').click();

        const editorContainer = scriptContainer.locator('#script-container');
        await expect(editorContainer).toBeVisible();
        const monacoEditor = editorContainer.locator('.monaco-editor[role="code"]');
        await expect(monacoEditor).toBeVisible();

        const browserName = this.page.context().browser()?.browserType().name();

        // APIを使用して値を設定
        await this.setMonacoValue(monacoEditor, scriptContent);

        // 値が正しく反映されたか確認
        const contentAfterApi = await this.getMonacoEditorContent();
        const isMatch = contentAfterApi.trim() === scriptContent.trim();

        if (!isMatch) {
            console.warn(`[Safari Debug] editScriptContent API mismatch.`);

            // フォールバック
            const textarea = monacoEditor.locator('textarea').first();

            // エディタにフォーカスを当て、内容を全選択して削除
            await monacoEditor.locator('.view-lines').click();
            await textarea.focus();
            await this.page.keyboard.press('Escape');

            // 全選択して削除
            await this.page.keyboard.press('Control+A');
            await this.page.keyboard.press('Meta+A');
            await this.page.keyboard.press('Delete');
            await this.page.keyboard.press('Backspace');

            // 削除後の反映待ち
            await this.page.waitForTimeout(300);

            if (browserName === 'webkit' || browserName === 'chromium') {
                await expect(textarea).toBeEditable();
                await textarea.fill(scriptContent);
            } else {
                await textarea.pressSequentially(scriptContent, { delay: 10 });
            }
            await this.page.keyboard.press('Escape');
        }

        // 保存中に戻る操作を始めない。イベント用エディタと同じ完了状態を確認する。
        const saveButton = scriptContainer.locator('#fab-save');
        const saveIcon = saveButton.locator('i');
        await expect(saveIcon).toHaveClass(/shake-save-button/);
        await saveButton.click();
        const alert = this.page.locator('alert-component');
        await expect.poll(async () => {
            if (await alert.isVisible()) return true;
            return !(await saveIcon.getAttribute('class'))?.split(/\s+/).includes('shake-save-button');
        }, { timeout: 20000, message: 'スクリプトの保存完了またはエラー表示を待機' }).toBe(true);
        if (await alert.isVisible()) {
            const message = await alert.evaluate((el: any) => el.alertMessage || el.innerText || '');
            if (/エラー|失敗|修正/.test(message)) throw new Error(`スクリプト保存エラー: ${message}`);
            await alert.getByRole('button', { name: '閉じる' }).click();
            await expect(alert).toBeHidden();
        }
        await expect(saveIcon).not.toHaveClass(/shake-save-button/);
        await scriptContainer.locator('#fab-close').click();
        await expect(monacoEditor).toBeHidden();
    }

    /**
     * イベントパネルで新しいカスタムイベント定義を追加します。
     * @param listenerTarget イベント登録先 (例: 'element', 'document')
     * @param eventName イベント名 (例: 'test-event')
     * @param comment イベントのコメント
     */
    async addCustomEventDefinition(
        { listenerTarget, eventName, comment }: { listenerTarget: string, eventName: string, comment: string }
    ): Promise<void> {
        // 右側のサブウィンドウを表示し、イベントタブに切り替える
        await this.openMoveingHandle('right');
        const scriptContainer = this.page.locator('script-container');
        await expect(scriptContainer).toBeVisible();
        await this.switchTabInContainer(scriptContainer, 'イベント');
        const eventContainer = scriptContainer.locator('event-container');
        await expect(eventContainer).toBeVisible();

        // 「イベントを編集」ボタンをクリック
        const fabEdit = eventContainer.locator('button#fab-edit[title="イベントを編集"]');
        await fabEdit.click();

        const eventListPopup = eventContainer.locator('#eventList');
        const eventAddPopup = eventContainer.locator('#eventEditMenu');

        // =========================================================================
        // 【ダンプ事実に基づく修正】
        // 既存テストのようにイベントがある場合は #eventList が開き、
        // 今回の p タグのようにイベントが空の場合は直接 #eventEditMenu が開きます。
        // どちらかが表示されるまで待機します。
        // =========================================================================
        await expect(async () => {
            const isListVisible = await eventListPopup.isVisible();
            const isAddVisible = await eventAddPopup.isVisible();
            expect(isListVisible || isAddVisible).toBe(true);
        }).toPass({ timeout: 5000 });

        // イベント一覧（#eventList）が開いた場合のみ、「追加」ボタンをクリック
        if (await eventListPopup.isVisible()) {
            await eventListPopup.getByRole('button', { name: '追加' }).click();
        }

        // ここで確実に #eventEditMenu (イベント追加ポップアップ) が表示された状態になります
        await expect(eventAddPopup).toBeVisible();

        // 各項目を入力
        const eventTargetInput = eventAddPopup.locator('input#event-target');
        const eventNameInput = eventAddPopup.locator('input#event-name');
        const commentValueInput = eventAddPopup.locator('input#comment-value');
        await expect(eventTargetInput).toBeEditable();
        await expect(eventNameInput).toBeEditable();
        await expect(commentValueInput).toBeEditable();
        await eventTargetInput.fill(listenerTarget);
        await eventNameInput.fill(eventName);
        await commentValueInput.fill(comment);

        // 「追加」ボタンをクリックしてイベントを登録
        await eventAddPopup.getByRole('button', { name: '追加' }).click();

        // ポップアップが閉じるのを待つ（両方非表示になることを確認）
        await expect(eventAddPopup).toBeHidden();
        await expect(eventListPopup).toBeHidden();

        // イベントがリストに追加されたことを確認 (コメントで重複回避)
        const newEventRow = eventContainer.locator(`.editor-row`, { hasText: eventName })
            .filter({ hasText: comment });

        await expect(newEventRow).toBeVisible();
        await expect(newEventRow.locator('.comment')).toHaveText(comment);
    }

    /**
     * サービスワーカーパネルで新しいカスタムイベント定義を追加します。
     * @param eventName イベント名 (例: 'new-sw-event')
     * @param comment イベントのコメント
     */
    async addCustomServiceWorkerEventDefinition(
        { eventName, comment }: { eventName: string; comment: string }
    ): Promise<void> {
        // 右側のサブウィンドウを表示し、サービスワーカータブに切り替える
        await this.openMoveingHandle('right');
        const scriptContainer = this.page.locator('script-container');
        await expect(scriptContainer).toBeVisible();
        await this.switchTabInContainer(scriptContainer, 'サービスワーカー');
        const serviceWorkerContainer = scriptContainer.locator('serviceworker-container');
        await expect(serviceWorkerContainer).toBeVisible();

        // 「イベントを編集」ボタンをクリック
        await serviceWorkerContainer.locator('button#fab-edit[title="イベントを編集"]').click();

        // イベントリストポップアップが表示されるのを待つ
        const eventListPopup = serviceWorkerContainer.locator('#eventList');
        await expect(eventListPopup).toBeVisible();

        // 「追加」ボタンをクリック
        await eventListPopup.getByRole('button', { name: '追加' }).click();

        // イベント追加ポップアップが表示されるのを待つ
        const eventAddPopup = serviceWorkerContainer.locator('#eventEditMenu');
        await expect(eventAddPopup).toBeVisible();

        // 各項目を入力 (イベント登録先はサービスワーカータブにはない)
        const eventNameInput = eventAddPopup.locator('input#event-name');
        const commentValueInput = eventAddPopup.locator('input#comment-value');
        await expect(eventNameInput).toBeEditable();
        await expect(commentValueInput).toBeEditable();
        await eventNameInput.fill(eventName);
        await commentValueInput.fill(comment);

        // 「追加」ボタンをクリックしてイベントを登録
        await eventAddPopup.getByRole('button', { name: '追加' }).click();

        // ポップアップが閉じるのを待つ
        await expect(eventAddPopup).toBeHidden();
        await expect(eventListPopup).toBeHidden();

        // イベントがリストに追加されたことを確認
        const newEventRow = serviceWorkerContainer.locator(`.editor-row:has-text("${eventName}")`);
        await expect(newEventRow).toBeVisible();
        await expect(newEventRow.locator('.comment')).toHaveText(comment);
    }

    /**
     * 既存のスクリプトの内容を書き換えますが、保存はしません。
     * Monaco Editorにフォーカスがある状態になります。
     * @param scriptName - 編集するスクリプトの名前
     * @param scriptContent - 新しいスクリプトのコード内容
     */
    async fillScriptContent(scriptName: string, scriptContent: string): Promise<void> {
        const scriptContainer = this.page.locator('script-container');
        const scriptRow = scriptContainer.locator('.editor-row', { hasText: scriptName });
        await scriptRow.getByTitle('スクリプトの編集').click();

        const editorContainer = scriptContainer.locator('#script-container');
        await expect(editorContainer).toBeVisible();
        const monacoEditor = editorContainer.locator('.monaco-editor[role="code"]');
        await expect(monacoEditor).toBeVisible();

        const browserName = this.page.context().browser()?.browserType().name();

        // APIを使用して値を設定（優先実行）
        await this.setMonacoValue(monacoEditor, scriptContent);

        // 値が正しく反映されたか確認
        const contentAfterApi = await this.getMonacoEditorContent();
        const isMatch = contentAfterApi.trim() === scriptContent.trim();

        if (!isMatch) {
            const textarea = monacoEditor.locator('textarea').first();

            await monacoEditor.locator('.view-lines').click();
            await textarea.focus();
            await this.page.keyboard.press('Escape');
            await this.page.keyboard.press('Control+A');
            await this.page.keyboard.press('Meta+A');
            await this.page.keyboard.press('Delete');
            await this.page.keyboard.press('Backspace');

            if (browserName === 'webkit' || browserName === 'chromium') {
                await expect(textarea).toBeEditable();
                await textarea.fill(scriptContent);
            } else {
                await textarea.pressSequentially(scriptContent, { delay: 10 });
            }
            await this.page.keyboard.press('Escape');
        }
    }

    /**
     * Monaco Editorの現在のテキストコンテンツを取得します。
     * モバイル/デスクトップ問わず、LitElementのホストから直接値を取得します。
     * @returns エディタの現在のテキスト
     */
    async getMonacoEditorContent(): Promise<string> {
        const scriptContainer = this.page.locator('script-container');
        const monacoEditor = scriptContainer.locator('.monaco-editor[role="code"]');

        // エディタが表示されるのを待つ
        await expect(monacoEditor).toBeVisible();

        // 方法1: LitElementのインスタンスから直接エディタAPIを叩く（推奨）
        const contentFromApi = await monacoEditor.evaluate((element: any) => {
            const rootNode = element.getRootNode();
            const hostElement = rootNode.host;
            if (hostElement && hostElement.styleEditor) {
                const model = hostElement.styleEditor.getModel();
                if (model) return model.getValue();
            }
            return null;
        });

        if (contentFromApi !== null) {
            return contentFromApi;
        }

        // 方法2: APIが使えない場合のフォールバック（モバイル向け）
        const viewLines = monacoEditor.locator('.view-lines');
        if (await viewLines.isVisible()) {
            return await viewLines.innerText();
        }

        // 方法3: 最後の手段として textarea を確認（デスクトップ向け）
        const textArea = monacoEditor.locator('textarea').first();
        return await textArea.inputValue();
    }

    /**
     * Monaco Editorの値をAPI経由で設定し、設定後の値を返します。
     * @param editorLocator エディタのLocator
     * @param value 設定する値
     * @returns { success: boolean, actual: string, trace: any[] } 
     */
    async setMonacoValue(editorLocator: Locator, value: string): Promise<{ success: boolean; actual: string; trace?: any[] }> {
        try {
            return await editorLocator.evaluate((element: any, newValue) => {
                const trace: string[] = [];
                trace.push('evaluate started');

                // Shadow DOMのホスト要素（LitElement）を取得
                const rootNode = element.getRootNode();
                const hostElement = rootNode.host;

                if (hostElement && hostElement.styleEditor) {
                    trace.push('Target editor found on host element');
                    const editor = hostElement.styleEditor;
                    const model = editor.getModel();
                    if (model) {
                        trace.push('Model found on editor, setting value...');
                        model.setValue(newValue);
                        return { success: true, actual: model.getValue(), trace };
                    } else {
                        trace.push('Editor found but has no model');
                    }
                } else {
                    trace.push('Host element or styleEditor not found');
                }

                return { success: false, actual: '', trace };
            }, value);
        } catch (e) {
            console.error("[EditorHelper] setMonacoValue error:", e);
            return { success: false, actual: '', trace: ['Exception occurred'] };
        }
    }

    /**
     * スクリプト一覧から指定された名前のスクリプトを探し、編集画面を開きます。
     * @param scriptName 編集したいスクリプトの名前
     */
    async openScriptForEditing(scriptName: string): Promise<void> {
        const scriptContainer = this.page.locator('script-container');
        // 指定された名前を持つスクリプトの行を探す
        const scriptRow = scriptContainer.locator('.editor-row', { hasText: scriptName });
        await expect(scriptRow).toBeVisible();

        // その行にある「編集」ボタンをクリックする
        await scriptRow.getByTitle('スクリプトの編集').click();

        // 編集画面（Monaco Editor）が表示されたことを確認する
        await expect(scriptContainer.locator('.monaco-editor[role="code"]')).toBeVisible();
    }

    /**
     * スクリプト編集画面でAIコーディングウィンドウを開きます。
     * このメソッドはスクリプト編集画面が開かれていることを前提とします。
     */
    async openAiCodingWindow(): Promise<void> {
        // 1. Shadow DOMのホスト要素である <script-container> をまず特定する
        const scriptContainer = this.page.locator('script-container');

        // 2. ホスト要素からチェインして、そのShadow DOM内部のボタンを探す
        const aiButton = scriptContainer.locator('button#aiButton');

        await expect(aiButton).toBeVisible();
        await aiButton.click();

        const aiWindow = this.page.locator('ai-coder-window');
        await expect(aiWindow).toBeVisible();
    }

    /**
     * AIコーディング機能を使ってコードを生成し、エディタの内容を置き換えます。
     * @param prompt AIに送信するプロンプト文字列
     * @param options AIモデルなどのオプション
     */
    async generateCodeWithAi(prompt: string, options: { model?: string } = {}): Promise<void> {
        // 1. AIコーディングウィンドウを開く
        await this.openAiCodingWindow();
        const aiWindow = this.page.locator('ai-coder-window');

        // 2. (オプション) 設定でモデルを変更する
        if (options.model) {
            await aiWindow.locator('button#setting-btn').click();
            const settingsWindow = aiWindow.locator('div#setting-window');
            await expect(settingsWindow).toBeVisible();

            // モデル選択 (modern-selectクラス)
            await settingsWindow.locator('select.modern-select').selectOption({ value: options.model });

            // 「設定を適用して戻る」ボタン
            await settingsWindow.locator('button#close-btn').click();
            await expect(settingsWindow).toBeHidden();
        }

        // 3. プロンプトを入力して送信し、応答を待つ
        const inputArea = aiWindow.locator('textarea#user-input');
        await expect(inputArea).toBeEditable();
        await inputArea.fill(prompt);
        await aiWindow.locator('button#send-btn').click();

        // 「生成中」の表示を待つ
        const pendingMessage = aiWindow.getByText('コード生成中');
        await expect(pendingMessage).toBeVisible({ timeout: 10000 });

        // 応答が完了するのを待つ
        await expect(pendingMessage).toBeHidden({ timeout: 120000 });

        // 4. 最新の応答メッセージを取得し、「置き換え」ボタンをクリック
        const lastBotMessage = aiWindow.locator('.message.bot').last();
        await expect(lastBotMessage).toBeVisible();

        // 刷新されたボタンクラス（.paste-btn または .bottom-btn）に対応
        const replaceBtn = lastBotMessage.locator('button').filter({ hasText: '置き換え' });
        await replaceBtn.click();

        // 5. AIコーディングウィンドウが閉じるのを待つ
        await expect(aiWindow).toBeHidden();
    }

    /**
     * ファイルエクスプローラーを開きます。
     */
    async openFileExplorer(): Promise<void> {
        const alert = this.page.locator('alert-component');
        if (await alert.isVisible().catch(() => false)) {
            await alert.getByRole('button', { name: '閉じる' }).click();
            await expect(alert).toBeHidden();
        }

        const menu = this.page.locator('#platformBottomMenu');

        // 既に開いたメニューを再クリックで閉じない。描画完了も待ってから次へ進む。
        await expect(async () => {
            if (!await menu.isVisible()) {
                await this.page.locator('#fab-bottom-menu-box').click({ timeout: 5000 });
            }
            await expect(menu).toBeVisible({ timeout: 5000 });
        }).toPass({ intervals: [1000], timeout: 15000 });

        // 「ファイル管理」をクリック
        await menu.getByText('ファイル管理').click();

        // ファイルエクスプローラーが表示されるのを待つ
        const fileExplorerContainer = this.page.locator('file-explorer .file-explorer-container');
        await expect(fileExplorerContainer).toBeVisible({ timeout: 10000 });

        // ロード完了を待つ
        await this.waitForFileExplorerLoading();
    }

    /**
     * ファイルエクスプローラーのローディングが消え、ファイルリストが表示されるのを待ちます。
     */
    async waitForFileExplorerLoading(): Promise<void> {
        const loading = this.page.locator('file-explorer-loading-overlay');

        // 1. もしローディングが表示されかけているなら、確実に表示されるまで少し待つ
        try {
            await loading.waitFor({ state: 'visible', timeout: 500 });
        } catch (e) {
            // 表示されなければ、既にロード済みか、一瞬で終わったとみなす
        }

        // 2. ローディングが非表示になるのを待つ
        await expect(loading).toBeHidden({ timeout: 15000 });

        // 3. 【重要】ファイルリスト（または空メッセージ）がレンダリングされるのを待つ
        // これにより、ロードオーバーレイが消えた直後の「中身が空」の状態を回避する
        const explorerContent = this.page.locator('file-explorer .file-explorer-content');
        await expect(explorerContent).toBeVisible();
    }

    /**
     * ファイルエクスプローラー内で新規ディレクトリを作成します。
     */
    async createDirectory(name: string): Promise<void> {
        // performFileOperation を利用してメニュー操作を共通化
        await this.performFileOperation('新規ディレクトリ');

        // 入力ダイアログの実体（.modal）が表示されるのを待つ
        const dialog = this.page.locator('file-explorer-edit-directory-menu .modal');
        await expect(dialog).toBeVisible();

        // 名前を入力
        const input = dialog.locator('.input-field');
        await expect(input).toBeEditable();
        await input.fill(name);

        // 作成ボタンをクリック
        await dialog.locator('#ok-button').click();

        // ダイアログが閉じて、リストの更新が終わるのを待つ
        await expect(dialog).toBeHidden();
        await this.waitForFileExplorerLoading();

        // 画面上にディレクトリが出現したことをリトライ込みで検証（CIの遅延対策）
        await expect(async () => {
            await expect(this.page.locator('file-explorer .directory', { hasText: name })).toBeVisible({ timeout: 5000 });
        }).toPass({ timeout: 30000, intervals: [2000] });
    }

    /**
     * ファイルまたはディレクトリを選択（クリック）します。
     * @param name 対象の名前
     */
    async selectFileExplorerItem(name: string): Promise<void> {
        const item = this.page.locator('file-explorer .directory, file-explorer .file').filter({ hasText: name });
        await expect(item).toBeVisible();
        await item.click();

        // 選択状態になるまで少し待つ（アプリ側の200msタイマー考慮）
        await expect(item).toHaveClass(/selected/, { timeout: 5000 });
    }

    /**
     * ディレクトリをダブルクリックして中に入ります。
     */
    async enterDirectory(name: string): Promise<void> {
        const explorer = this.page.locator('file-explorer');

        await this.waitForFileExplorerLoading();
        const links = explorer.locator('.path-link');
        const beforeCount = await links.count();
        // 操作を変えずに、実際に届いたクリックの間隔と対象だけを失敗時に記録する。
        await explorer.evaluate((element: any) => {
            const samples: any[] = [];
            const listener = (event: Event) => {
                const target = event.composedPath()[0] as HTMLElement;
                if (!target?.closest?.('.directory')) return;
                samples.push({
                    type: event.type,
                    elapsedMs: performance.now(),
                    tag: target.tagName,
                    className: target.className,
                    detail: (event as MouseEvent).detail,
                    trusted: event.isTrusted
                });
            };
            element.__e2eDirectoryProbe = { samples, listener };
            element.shadowRoot.addEventListener('click', listener, true);
            element.shadowRoot.addEventListener('dblclick', listener, true);
        });
        let navigationSucceeded = false;
        let firstAttempt = true;
        try {
            // リトライ前の階層を固定し、遷移済みなら再度ダブルクリックしない。
            await expect(async () => {
                // The initial loading barrier already completed before reading beforeCount.
                // Only observation/probe setup follows it; retries must wait again.
                if (!firstAttempt) await this.waitForFileExplorerLoading();
                firstAttempt = false;
                if (await links.count() === beforeCount) {
                    const dir = explorer.locator('.directory').filter({ hasText: name });
                    // 行内の選択チェックボックスを避け、操作可能なフォルダーアイコンを開く。
                    const folderIcon = dir.locator('.icon-directory');
                    await expect(folderIcon).toBeVisible();
                    await this.page.mouse.up();
                    // 追加の押下遅延で独自ダブルクリック判定の200msを超えないようにする。
                    await folderIcon.dblclick({ timeout: 5000 });
                }
                await this.waitForFileExplorerLoading();
                await expect.poll(() => links.count(), { timeout: 5000 }).toBeGreaterThan(beforeCount);
                await expect(links.last()).toHaveText(`/${name}`, { timeout: 5000 });
            }).toPass({
                timeout: 15000,
                intervals: [1000]
            });
            navigationSucceeded = true;
        } finally {
            if (this.page.isClosed()) throw new Error('Page closed during directory navigation');
            const samples = await explorer.evaluate((element: any) => {
                const probe = element.__e2eDirectoryProbe;
                if (!probe) return [];
                element.shadowRoot.removeEventListener('click', probe.listener, true);
                element.shadowRoot.removeEventListener('dblclick', probe.listener, true);
                delete element.__e2eDirectoryProbe;
                return probe.samples;
            });
            if (!navigationSucceeded) console.log('[DirectoryNavigation] delivered pointer events:', JSON.stringify(samples));
        }
    }

    /**
     * パンくずリストを使ってルートディレクトリ（アプリのルート）に戻ります。
     */
    async goBackToRoot(): Promise<void> {
        const links = this.page.locator('file-explorer .path-link');

        // アプリのルートはパンくずの 1番目（/[AppKey]）なので nth(0)
        const rootLink = links.first();
        await expect(rootLink).toBeVisible();

        // クリック実行
        await rootLink.click();

        // 1. ローディングを待つ
        await this.waitForFileExplorerLoading();

        // 2. パンくずリストがルートの長さ（1つ）になるまで待機する
        await expect(async () => {
            const count = await links.count();
            expect(count).toBe(1);
        }).toPass({ timeout: 5000 });

        // 念のため、DOMの安定を待つ
        await this.page.waitForTimeout(300);
    }

    /**
     * サイドバーのボタンをクリックします。
     * @param label 「アップロード」「ダウンロード」「全選択/全解除」「閉じる」
     */
    async clickSidebarButton(label: string): Promise<void> {
        const btn = this.page.locator('file-explorer .sidebar-icon').filter({ hasText: label });
        await expect(btn).toBeVisible();
        // 無効化（sidebar-icon-disable）が解除されるのを待つ
        await expect(btn).not.toHaveClass(/sidebar-icon-disable/, { timeout: 5000 });
        await btn.click();
    }

    /**
     * 操作メニューからアクションを実行します。
     * @param action 'コピー' | '切り取り' | '貼り付け' | '削除' | '名前変更' | 'パスをコピー' | '新規ディレクトリ'
     */
    async performFileOperation(action: string, expectedToast?: string | RegExp): Promise<void> {
        const explorer = this.page.locator('file-explorer');

        await expect(async () => {
            const alert = this.page.locator('alert-component');
            if (await alert.isVisible().catch(() => false)) {
                await alert.getByRole('button', { name: '閉じる' }).click().catch(() => { });
            }
            const popupList = explorer.locator('file-explorer-popup-menu ul');
            if (!await popupList.isVisible()) {
                await this.waitForFileExplorerLoading();
                await explorer.locator('#menu-operation').click({ timeout: 5000 });
            }
            await expect(popupList).toBeVisible({ timeout: 5000 });
        }).toPass({ timeout: 15000, intervals: [1000] });

        const popupList = explorer.locator('file-explorer-popup-menu ul');

        let targetItem: Locator;
        if (action === '貼り付け') {
            targetItem = popupList.locator('.menu-text').filter({ hasText: '貼り付け' });
        } else {
            targetItem = popupList.locator('.menu-text').getByText(action, { exact: true });
        }

        await expect(targetItem).toBeVisible();
        if (expectedToast !== undefined) {
            // Observe transient feedback before click completion and menu teardown.
            await Promise.all([
                this.expectToastMessage(expectedToast),
                targetItem.click({ force: true }),
            ]);
        } else {
            await targetItem.click({ force: true });
        }

        await expect(popupList).toBeHidden();

        if (action === '削除') {
            const confirmDialog = explorer.locator('#delete-confirm');
            const dialogBox = confirmDialog.locator('.message-box-content');
            await expect(dialogBox).toBeVisible();

            const okButton = confirmDialog.locator('#delete-ok');
            await expect(okButton).toBeVisible();
            await okButton.click();

            await expect(dialogBox).toBeHidden();
        }

        if (['貼り付け', '削除', '名前変更', '新規ディレクトリ'].includes(action)) {
            await this.waitForFileExplorerLoading();
        }
    }

    /**
     * ファイルエクスプローラーを閉じます。
     */
    async closeFileExplorer(): Promise<void> {
        const closeBtn = this.page.locator('file-explorer .sidebar-icon', { hasText: '閉じる' });
        await closeBtn.click();
        await expect(this.page.locator('file-explorer')).toBeHidden();
    }

    /**
     * サイドバーの「全選択/全解除」ボタンをクリックします。
     */
    async toggleAllSelect(): Promise<void> {
        const explorer = this.page.locator('file-explorer');
        const btn = explorer.locator('.sidebar-icon', { hasText: '全選択/全解除' });
        await btn.click();
    }

    /**
     * 選択したアイテムの名前を変更します。
     * (既にアイテムが選択されている前提)
     */
    async renameSelectedItem(newName: string): Promise<void> {
        await this.performFileOperation('名前変更');

        const dialog = this.page.locator('file-explorer-edit-directory-menu .modal');
        await expect(dialog).toBeVisible();

        const input = dialog.locator('.input-field');
        await expect(input).toBeEditable();
        await input.fill(newName);
        await dialog.locator('#ok-button').click();

        await expect(dialog).toBeHidden();
        await this.waitForFileExplorerLoading();

        // 名前変更後のディレクトリが出現したことをリトライ込みで検証
        await expect(async () => {
            await expect(this.page.locator('file-explorer .directory', { hasText: newName })).toBeVisible({ timeout: 5000 });
        }).toPass({ timeout: 30000, intervals: [2000] });
    }

    /**
     * ファイルをアップロードします。
     * @param filePaths アップロードするファイルのローカルパス（配列）
     */
    async uploadFiles(filePaths: string[]): Promise<void> {
        const explorer = this.page.locator('file-explorer');
        // 隠しinput要素にファイルをセット
        const fileChooserPromise = this.page.waitForEvent('filechooser');
        await explorer.locator('.sidebar-icon', { hasText: 'アップロード' }).click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(filePaths);

        // アップロード完了（ローディング消去）を待つ
        await this.waitForFileExplorerLoading();
    }

    /**
     * 表示されているトーストメッセージを確認します。
     */
    async expectToastMessage(message: string | RegExp): Promise<void> {
        // 重要：ホスト要素ではなく、中の黒い背景部分（.popup-text）を直接待つ
        const toastInner = this.page.locator('file-explorer .file-explorer-container popup-message-element .popup-text')
            .filter({ hasText: message });

        // この .popup-text はサイズを持っているので toBeVisible が通る
        await expect(toastInner).toBeVisible({ timeout: 10000 });
    }

    /**
     * 選択中のアイテムをダウンロードします。
     */
    async downloadSelectedItems(): Promise<void> {
        const explorer = this.page.locator('file-explorer');

        // 1. 割り込みアラート（「コピーしました」など）があれば閉じる
        const globalAlert = this.page.locator('alert-component');
        if (await globalAlert.isVisible()) {
            await globalAlert.getByRole('button', { name: '閉じる' }).click();
            await expect(globalAlert).toBeHidden();
        }

        // 2. サイドバーの「ダウンロード」ボタンをクリック
        const downloadBtn = explorer.locator('.sidebar-icon').filter({ hasText: 'ダウンロード' });
        await expect(downloadBtn).toBeVisible();
        await expect(downloadBtn).not.toHaveClass(/sidebar-icon-disable/);
        await downloadBtn.click();

        // 3. 確認ダイアログの「中身（.message-box-content）」が表示されるのを待つ
        const confirmDialog = explorer.locator('file-explorer-confirm-menu#download-confirm');
        const dialogBox = confirmDialog.locator('.message-box-content');
        await expect(dialogBox).toBeVisible({ timeout: 15000 });

        // 4. ダイアログ内の「ダウンロード」ボタンをクリック
        const okButton = confirmDialog.locator('button.confirm-download-button');
        await expect(okButton).toBeVisible();
        await okButton.click();

        // 5. ダイアログが消えるのを待つ
        await expect(dialogBox).toBeHidden();
        await this.waitForFileExplorerLoading();
    }

    /**
     * 現在のプロジェクトの状態をファイル（.pwappy）として書き出します。
     */
    async exportProjectFile(): Promise<any> {
        // ハンドルが開いているとメニューボタンが隠れるため確実に閉じる
        await this.closeMoveingHandle();

        await this.page.waitForTimeout(500);

        await this.page.locator('#fab-bottom-menu-box').click({ force: true });
        const platformBottomMenu = this.page.locator('#platformBottomMenu');
        await expect(platformBottomMenu).toBeVisible();
        await platformBottomMenu.getByText('スナップショット').click();

        await this.page.waitForTimeout(500);

        const snapshotManager = this.page.locator('snapshot-manager');
        await expect(snapshotManager.locator('.container')).toBeVisible();

        const downloadPromise = this.page.waitForEvent('download');
        await snapshotManager.getByRole('button', { name: 'ファイルに出力' }).click();
        const download = await downloadPromise;

        await snapshotManager.locator('.close-btn').click();
        await expect(snapshotManager).toBeHidden();

        return download;
    }

    /**
     * 指定されたパスのファイルをプロジェクトにインポートします。
     */
    async importProjectFile(filePath: string): Promise<void> {
        await this.closeMoveingHandle();

        let successAlertDetected = false;

        // ダイアログハンドラ
        const dialogHandler = async (dialog: any) => {
            const message = dialog.message();
            // 成功メッセージが含まれているか確認
            if (message.includes('プロジェクトを正常にインポートしました')) {
                successAlertDetected = true;
            }
            await dialog.accept();
        };

        this.page.on('dialog', dialogHandler);

        try {
            await this.page.locator('#fab-bottom-menu-box').click();
            const bottomMenu = this.page.locator('#platformBottomMenu');
            await expect(bottomMenu).toBeVisible();
            await bottomMenu.getByText('スナップショット').click();

            const snapshotManager = this.page.locator('snapshot-manager');
            await expect(snapshotManager.locator('.container')).toBeVisible();

            const importLabel = snapshotManager.locator('label.import-label');

            const [fileChooser] = await Promise.all([
                this.page.waitForEvent('filechooser'),
                importLabel.click(),
            ]);

            await fileChooser.setFiles(filePath);

            // --- 完了判定 ---
            // 標準alertが発火したかをポーリング
            await expect.poll(() => successAlertDetected, {
                message: "インポート完了の通知(window.alert)を待機中",
                timeout: 30000,
                intervals: [1000]
            }).toBe(true);

            // window.alert は自動で閉じているので、あとは Snapshot Manager を閉じるだけ
            await snapshotManager.locator('.close-btn').click();
            await expect(snapshotManager).toBeHidden();

        } catch (error) {
            console.error(`[Import-Error] Process failed:`, error);
            throw error;
        } finally {
            this.page.off('dialog', dialogHandler);
        }
    }
}

/**
 * 実機テストページを開き、その中の main.js の内容を検証します。
 * @param testPage 実機テストページのPageオブジェクト
 * @param expectedContents 期待するスクリプト文字列、またはその配列
 */
export async function verifyScriptInTestPage(testPage: Page, expectedContents: string | string[]): Promise<void> {
    await expect(async () => {
        // The caller has already loaded the test page. Re-fetch main.js with a
        // cache-buster below; reloading the whole app on every poll unnecessarily
        // re-runs lifecycle handlers and rebuilds its UI.
        // ブラウザのコンテキスト内部で main.js をフェッチして内容を取得する
        // ※ブラウザ内部からのフェッチであれば、認証Cookieが確実に送信され、サーバー(PHP)の404隠蔽を回避できる
        const mainJsContent = await testPage.evaluate(async () => {
            const scriptElement = document.querySelector<HTMLScriptElement>('script[src*="main.js"]');
            if (!scriptElement || !scriptElement.src) {
                return null;
            }

            try {
                // キャッシュバスターを付与して最新を取得
                const fetchUrl = new URL(scriptElement.src);
                fetchUrl.searchParams.set('cb', Date.now().toString());

                // Fetch APIでスクリプトのテキスト内容を取得
                const response = await fetch(fetchUrl.toString(), { cache: 'no-store' });
                if (!response.ok) {
                    return null; // 404などの場合はリトライさせるためにnullを返す
                }
                return await response.text();
            } catch (e) {
                return null;
            }
        });

        // 取得できなければ例外を投げて toPass でリトライ（ビルド遅延待ち）させる
        expect(mainJsContent, `main.js が見つからない、またはフェッチに失敗(404等)しました。URL: ${testPage.url()}`).not.toBeNull();

        // 3. 内容の検証
        const normalizedReceived = normalizeWhitespace(mainJsContent || '');

        if (Array.isArray(expectedContents)) {
            for (const content of expectedContents) {
                const normalizedExpected = normalizeWhitespace(content);
                expect(normalizedReceived, `期待するコード片が見つかりません: ${normalizedExpected}`).toContain(normalizedExpected);
            }
        } else {
            const normalizedExpected = normalizeWhitespace(expectedContents as string);
            expect(normalizedReceived, `期待するコード片が見つかりません: ${normalizedExpected}`).toContain(normalizedExpected);
        }
    }).toPass({
        timeout: 60000,
        intervals: [2000, 3000, 5000] // 失敗した場合、数秒間隔で最大60秒間リトライし続ける
    });
}

/**
 * 文字列から改行を削除し、連続する空白を1つのスペースに変換します。
 * @param str 対象の文字列
 * @returns 正規化された文字列
 */
export const normalizeWhitespace = (str: string): string => {
    return str.replace(/\s+/g, ' ').trim();
};

