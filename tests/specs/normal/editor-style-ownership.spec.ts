import { startStylePhase } from '../../tools/style-phase-profile.mjs';
import { test as base, expect, Locator, Page } from '@playwright/test';
import 'dotenv/config';
import { createApp, deleteApp, gotoDashboard, openEditor } from '../../tools/dashboard-helpers';
import { EditorHelper } from '../../tools/editor-helpers';
import { getStorageStatePath } from '../../constants';
import { nativeMonacoShortcut, nativeMonacoShortcutDiagnostic } from '../../tools/monaco-native-shortcut';

const testRunSuffix = process.env.TEST_RUN_SUFFIX || 'local';

let appName: string;
let appKey: string;

type EditorFixtures = {
    editorPage: Page;
    editorHelper: EditorHelper;
};

const test = base.extend<EditorFixtures>({
    // Keep dashboard/editor startup separate from the scenario budget.
    // A slow startup must still fail within the existing CI/local test limit.
    editorPage: [async ({ page, context }, use) => {
        const dashboardDone = startStylePhase('fixture-dashboard');
        await gotoDashboard(page);
        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });
        dashboardDone();

        const cardDone = startStylePhase('fixture-card');
        const appRow = page.locator('.app-card', { has: page.locator('.app-key', { hasText: appKey }) }).first();
        await expect(appRow).toBeVisible({ timeout: 15000 });
        await appRow.click();
        await expect(page.locator('.detail-tab.active')).toBeVisible({ timeout: 10000 });
        cardDone();

        const editorPage = await openEditor(page, context, appName);
        const useDone = startStylePhase('fixture-use');
        await use(editorPage);
        useDone();
        const closeDone = startStylePhase('fixture-close');
        await editorPage.close();
        closeDone();
    }, { timeout: process.env.CI ? 120000 : 60000 }],
    editorHelper: async ({ editorPage, isMobile }, use) => {
        const helper = new EditorHelper(editorPage, isMobile);
        await use(helper);
    },
});

test.beforeAll(async ({ browser }) => {
    const suiteSetupDone = startStylePhase('suite-setup');
    const reversedTimestamp = Date.now().toString().split('').reverse().join('');
    const workerIndex = test.info().workerIndex;
    // constants.ts normalizes to TEST_PARALLEL_INDEX (or explicit account override),
    // so worker restarts retain their account; workerIndex only namespaces app IDs.
    const storageStatePath = getStorageStatePath(workerIndex);

    const uniqueId = `${testRunSuffix}-${workerIndex}-${reversedTimestamp}`;
    appName = `style-owner-test-${uniqueId}`.slice(0, 30);
    appKey = `so-test-key-${uniqueId}`.slice(0, 30);

    const context = await browser.newContext({ storageState: storageStatePath });
    const page = await context.newPage();
    await gotoDashboard(page);
    await createApp(page, appName, appKey);
    await context.close();
    suiteSetupDone();
});

test.afterAll(async ({ browser }) => {
    const suiteCleanupDone = startStylePhase('suite-cleanup');
    if (appKey) {
        const workerIndex = test.info().workerIndex;
        const storageStatePath = getStorageStatePath(workerIndex);
        const context = await browser.newContext({ storageState: storageStatePath });
        const page = await context.newPage();
        await gotoDashboard(page);
        await deleteApp(page, appKey);
        await context.close();
    }
    suiteCleanupDone();
});

// Boundary probes below use real Monaco and actual UI handlers, never a mocked
// store or direct Redux dispatch. Their same-turn events are deliberately NOT
// native actionability coverage. Separate native clicks/fills/typing remain.
const css = (declarations: string) => `element.style {\n    ${declarations}\n}`;

async function nativeTab(container: Locator, tab: 'style' | 'attributes') {
    const propertyTabDone = startStylePhase('property-tab');
    const button = container.locator(`#tab-${tab}`);
    await button.click();
    await expect(button).toHaveClass(/active/);
    propertyTabDone();
}

async function writeStyle(helper: EditorHelper, container: Locator, declarations: string) {
    const value = css(declarations);
    const monacoWriteDone = startStylePhase('monaco-write');
    const result = await helper.setMonacoValue(container.locator('#style-container > .monaco-editor'), value);
    expect(result.success, JSON.stringify(result.trace)).toBe(true);
    expect(result.actual).toBe(value);
    monacoWriteDone();
}

async function modelText(container: Locator) {
    return container.evaluate((host: any) => host.styleEditor.getValue() as string);
}

async function setupPair(page: Page, helper: EditorHelper) {
    const pairSetupDone = startStylePhase('pair-setup');
    const { buttonNode: a } = await helper.setupPageWithButton();
    const b = await helper.addComponent('ons-button', '#dom-tree div[data-node-explain="コンテンツ"]');
    const aDomId = await a.getAttribute('data-node-dom-id');
    const bDomId = await b.getAttribute('data-node-dom-id');
    expect(aDomId).toBeTruthy();
    expect(bDomId).toBeTruthy();
    expect(aDomId).not.toBe(bDomId);
    const previewA = helper.getPreviewElement(`ons-button[id=${JSON.stringify(aDomId)}]`);
    const previewB = helper.getPreviewElement(`ons-button[id=${JSON.stringify(bDomId)}]`);
    await expect(previewA).toBeVisible();
    await expect(previewB).toBeVisible();
    await helper.selectNodeInDomTree(a);
    await helper.openMoveingHandle('right');
    const container = page.locator('property-container');
    await nativeTab(container, 'style');
    const monacoVisibleDone = startStylePhase('monaco-visible');
    await expect(container.locator('#style-container > .monaco-editor')).toBeVisible();
    monacoVisibleDone();
    pairSetupDone();
    return { a, b, previewA, previewB, container };
}

// Read-only, implementation-coupled queue fence, NOT the behavior assertion.
// In both 69f and 035 every replacement cancels the previous handle; 69f sets
// null after dispatch, while 035 clears/cancels before its synchronous dispatch.
// Polling happens in a later browser turn, after that synchronous work finishes.
// Never change selection while waiting: doing so could hide an old callback's
// incorrect write by letting it target B and subsequently overwriting B again.
async function awaitCapturedStyleTimer(container: Locator, timer: number) {
    expect(typeof timer, 'the real Monaco edit must schedule its deferred write').toBe('number');
    expect(timer).toBeGreaterThan(0);
    await expect.poll(() => container.evaluate((host: any, captured) =>
        host._styleDispatchTimer !== captured, timer)).toBe(true);
}

// A separate native selection and real B edit proves independent owner state;
// it is not used as the queue fence for A's pending edit.
async function commitStyleOnB(helper: EditorHelper, container: Locator, b: Locator, previewB: Locator) {
    await helper.selectNodeInDomTree(b);
    await helper.openMoveingHandle('right');
    await nativeTab(container, 'style');
    await expect(previewB).not.toHaveAttribute('style', /width:\s*223px/);
    await writeStyle(helper, container, 'width: 223px;');
    await expect(previewB).toHaveCSS('width', '223px');
    await expect(previewB).toHaveAttribute('style', /width:\s*223px/);
}

test('pending style stays with owner A across selection and tab boundaries (non-native boundary probes + native round-trip)', async ({ editorPage, editorHelper }) => {
    const { a, b, previewA, previewB, container } = await setupPair(editorPage, editorHelper);
    const hostHandle = await container.elementHandle();
    expect(hostHandle).not.toBeNull();
    try {
        // NON-NATIVE boundary probe: one browser turn guarantees selection
        // changes before the 100 ms callback can run. node.click invokes the
        // real DOM-tree selection handler; it does not forge selected classes.
        const timer = await b.evaluate((node, { host, value }) => {
            (host as any).styleEditor.getModel().setValue(value);
            const timer = (host as any)._styleDispatchTimer as number;
            (node as HTMLElement).click();
            return timer;
        }, { host: hostHandle!, value: css('width: 137px;') });
        await awaitCapturedStyleTimer(container, timer);
    } finally {
        await hostHandle?.dispose();
    }
    await expect(b).toHaveClass(/(?:^|\s)node-select(?:\s|$)/);
    await commitStyleOnB(editorHelper, container, b, previewB);
    await expect(previewA).toHaveCSS('width', '137px');

    await editorHelper.selectNodeInDomTree(a);
    await editorHelper.openMoveingHandle('right');
    await nativeTab(container, 'style');
    await expect.poll(() => modelText(container)).toContain('width: 137px;');
    // NON-NATIVE tab boundary, independently of the selection boundary above.
    const tabTimer = await container.evaluate((host: any, value) => {
        host.styleEditor.getModel().setValue(value);
        const timer = host._styleDispatchTimer as number;
        host.tabChange('attributes');
        return timer;
    }, css('width: 179px;'));
    await awaitCapturedStyleTimer(container, tabTimer);
    await expect(container.locator('#tab-attributes')).toHaveClass(/active/);
    await expect(editorHelper.getPropertyInput('style-sizing').locator('input').first()).toHaveValue('179px');
    await nativeTab(container, 'style');
    await expect.poll(() => modelText(container)).toContain('width: 179px;');
    await expect(previewA).toHaveCSS('width', '179px');
    await expect(previewB).toHaveCSS('width', '223px');
});

test('newer attribute change wins over a pending Monaco draft (non-native overlap + native input)', async ({ editorPage, editorHelper }) => {
    const { a, b, previewA, previewB, container } = await setupPair(editorPage, editorHelper);
    await writeStyle(editorHelper, container, 'width: 137px;');
    await expect(previewA).toHaveCSS('width', '137px');
    await nativeTab(container, 'attributes');
    const widthInput = editorHelper.getPropertyInput('style-sizing').locator('input').first();
    await expect(widthInput).toBeEditable();
    await widthInput.fill('281px'); // Real native input, not a DOM value assignment.
    await expect(widthInput).toBeFocused();
    const hostHandle = await container.elementHandle();
    expect(hostHandle).not.toBeNull();
    const overlapErrors: string[] = [];
    const recordOverlapError = (error: Error) => overlapErrors.push(error.message);
    editorPage.on('pageerror', recordOverlapError);
    try {
        // NON-NATIVE overlap probe: commit the already-native-filled attribute
        // through its native blur/change after creating the older draft.
        // Monaco remains mounted while the attribute tab is visible.
        const timer = await widthInput.evaluate((input, { host, value }) => {
            (host as any).styleEditor.getModel().setValue(value);
            const timer = (host as any)._styleDispatchTimer as number;
            // Native change is non-composed; the sizing component emits its own
            // composed CustomEvent with detail. Forging a composed input change
            // reaches the outer handler a second time with undefined detail.
            (input as HTMLInputElement).blur();
            return timer;
        }, { host: hostHandle!, value: css('width: 999px;') });
        await awaitCapturedStyleTimer(container, timer);
    } finally {
        editorPage.off('pageerror', recordOverlapError);
        await hostHandle?.dispose();
    }
    expect(overlapErrors, 'native attribute overlap must not raise page errors').toEqual([]);
    await expect(previewA).toHaveCSS('width', '281px');
    await expect(widthInput).toHaveValue('281px');
    await commitStyleOnB(editorHelper, container, b, previewB);
    await editorHelper.selectNodeInDomTree(a);
    await editorHelper.openMoveingHandle('right');
    await nativeTab(container, 'attributes');
    await expect(widthInput).toHaveValue('281px');
    await nativeTab(container, 'style');
    await expect.poll(() => modelText(container)).toContain('width: 281px');
    await expect(previewA).toHaveCSS('width', '281px');
});

test('quoted CSS whitespace persists and same-ID Undo/load invalidates an older draft (non-native Undo boundary)', async ({ editorPage, editorHelper }) => {
    const { a, b, previewA, previewB, container } = await setupPair(editorPage, editorHelper);
    const ownerId = await a.getAttribute('data-node-id');
    const originalText = await previewA.innerText();
    await writeStyle(editorHelper, container, 'width: 137px; --quoted: "ab";');
    await expect(previewA).toHaveAttribute('style', /--quoted:\s*"ab"/);
    // Only quoted whitespace changes; whitespace-stripping equality is wrong.
    await writeStyle(editorHelper, container, 'width: 137px; --quoted: "a b";');
    await expect(previewA).toHaveAttribute('style', /--quoted:\s*"a b"/);
    await nativeTab(container, 'attributes');
    const textInput = editorHelper.getPropertyInput('text').locator('input');
    await textInput.fill('Undo checkpoint');
    await textInput.press('Enter');
    await textInput.blur();
    await expect(previewA).toHaveText('Undo checkpoint');
    // Style -> attribute are different history action types. History captures
    // synchronously; this does not need its 800 ms same-action grouping delay.
    await nativeTab(container, 'style');
    await expect.poll(() => modelText(container)).toContain('--quoted: "a b";');
    await editorHelper.openMoveingHandle('left');
    const undo = editorPage.locator('button[title*="元に戻す"]').first();
    await expect(undo).toBeVisible();
    await expect(undo).toBeEnabled();
    const hostHandle = await container.elementHandle();
    expect(hostHandle).not.toBeNull();
    // Undo also emits a real selection-followup event after restoring the store.
    // Observe it before selecting B; the style-timer fence alone cannot order
    // this separate event, which would otherwise race and reselect A later.
    const undoSelection = await container.evaluateHandle((_host, expectedId) => {
        const observation = { seen: false, cleanup: () => {} };
        const listener = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            let payload;
            try { payload = typeof detail === 'string' ? JSON.parse(detail) : detail; }
            catch { return; }
            if (payload?.targetTemplateId === expectedId) observation.seen = true;
        };
        window.addEventListener('to-element-and-select', listener);
        observation.cleanup = () => window.removeEventListener('to-element-and-select', listener);
        return observation;
    }, ownerId);
    try {
        // NON-NATIVE Undo boundary: actual toolbar click, no direct history or
        // Redux calls. Restores the same ID AND same stored style while a
        // different style draft is pending, exercising the document epoch.
        const timer = await undo.evaluate((button, { host, value }) => {
            (host as any).styleEditor.getModel().setValue(value);
            const timer = (host as any)._styleDispatchTimer as number;
            (button as HTMLButtonElement).click();
            return timer;
        }, { host: hostHandle!, value: css('width: 999px; --quoted: "stale";') });
        await awaitCapturedStyleTimer(container, timer);
        await expect.poll(() => undoSelection.evaluate(observation => observation.seen)).toBe(true);
    } finally {
        try { await undoSelection.evaluate(observation => observation.cleanup()); }
        finally {
            await undoSelection.dispose();
            await hostHandle?.dispose();
        }
    }
    await expect(previewA).toHaveText(originalText);
    await expect(a).toHaveAttribute('data-node-id', ownerId!);
    await expect(a).toHaveClass(/(?:^|\s)node-select(?:\s|$)/);
    await commitStyleOnB(editorHelper, container, b, previewB);
    await editorHelper.selectNodeInDomTree(a);
    await editorHelper.openMoveingHandle('right');
    await nativeTab(container, 'style');
    await expect(previewA).toHaveText(originalText);
    await expect(previewA).toHaveCSS('width', '137px');
    await expect(previewA).toHaveAttribute('style', /--quoted:\s*"a b"/);
    await expect.poll(() => modelText(container)).toContain('--quoted: "a b";');
    expect(await modelText(container)).not.toContain('stale');
});

test('native Monaco typing keeps cursor and editor Undo after its deferred commit', async ({ editorPage, editorHelper }) => {
    const { buttonNode } = await editorHelper.setupPageWithButton();
    await editorHelper.selectNodeInDomTree(buttonNode);
    await editorHelper.openMoveingHandle('right');
    const container = editorPage.locator('property-container');
    await nativeTab(container, 'style');
    const preview = editorHelper.getPreviewElement('ons-button');
    const seed = css('width: 151px;');
    await writeStyle(editorHelper, container, 'width: 151px;');
    await expect(preview).toHaveCSS('width', '151px');
    const editor = container.locator('#style-container > .monaco-editor');
    const nativeMonacoFocusDone = startStylePhase('native-monaco-focus');
    await editor.click({ position: { x: 80, y: 20 } });
    await expect.poll(() => container.evaluate((host: any) => host.styleEditor.hasTextFocus())).toBe(true);
    nativeMonacoFocusDone();
    // Playwright's ControlOrMeta follows the runner OS, but emulated WebKit's
    // browser platform can differ. Read the actual editor bindings once; never
    // guess from the project name or retry a different key after a failed action.
    const bindings = await container.evaluate((host: any) => {
        const service = host.styleEditor._standaloneKeybindingService;
        const read = (command: string) => service.lookupKeybinding(command)?.getChords().map((chord: any) => ({
            ctrlKey: chord.ctrlKey, shiftKey: chord.shiftKey, altKey: chord.altKey,
            metaKey: chord.metaKey, keyLabel: chord.keyLabel
        })) ?? null;
        return {
            selectAll: read('editor.action.selectAll'), undo: read('undo'),
            platform: {
                macintoshUA: navigator.userAgent.includes('Macintosh'),
                iosUA: /iPhone|iPad/.test(navigator.userAgent),
                maxTouchPoints: navigator.maxTouchPoints
            }
        };
    });
    const selectAllShortcut = nativeMonacoShortcut(bindings.selectAll, 'a');
    const undoShortcut = nativeMonacoShortcut(bindings.undo, 'z');
    // Raw attachments are intentionally excluded from CI uploads. This fixed
    // allowlist survives in the job log without exposing browser/session data.
    console.log(nativeMonacoShortcutDiagnostic(bindings.selectAll, bindings.undo, bindings.platform));
    await editorPage.keyboard.press(selectAllShortcut);
    expect(await container.evaluate((host: any) => host.styleEditor.hasTextFocus())).toBe(true);
    // Assert the real shortcut, rather than silently assuming selection worked.
    expect(await container.evaluate((host: any) => {
        const selection = host.styleEditor.getSelection();
        return { startLineNumber: selection.startLineNumber, startColumn: selection.startColumn,
            endLineNumber: selection.endLineNumber, endColumn: selection.endColumn };
    })).toEqual({ startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 2 });
    // Multiline insertText is typing, not paste: Monaco applies indentation and
    // bracket completion. Edit only the value so this test isolates ownership,
    // cursor and Undo preservation rather than expecting typing to be verbatim.
    await editorPage.keyboard.press('ArrowLeft');
    await editorPage.keyboard.press('ArrowDown');
    // Read-only cursor feedback avoids assuming one column per arrow through
    // indentation (Monaco can move across a soft tab stop in one keypress).
    const readPosition = () => container.evaluate((host: any) => ({
        lineNumber: host.styleEditor.getPosition().lineNumber,
        column: host.styleEditor.getPosition().column
    }));
    let position = await readPosition();
    expect(position).toEqual({ lineNumber: 2, column: 1 });
    for (let step = 0; step < 11 && position.column < 12; step++) {
        await editorPage.keyboard.press('ArrowRight');
        const next = await readPosition();
        expect(next.lineNumber).toBe(2);
        expect(next.column).toBeGreaterThan(position.column);
        position = next;
    }
    expect(position).toEqual({ lineNumber: 2, column: 12 });
    for (let digit = 0; digit < 3; digit++) await editorPage.keyboard.press('Shift+ArrowRight');
    expect(await container.evaluate((host: any) =>
        host.styleEditor.getModel().getValueInRange(host.styleEditor.getSelection()))).toBe('151');
    const typed = css('width: 197px;');
    await editorPage.keyboard.insertText('197');
    await expect(preview).toHaveCSS('width', '197px');
    expect(await modelText(container)).toBe(typed);
    const cursor = await container.evaluate((host: any) => ({
        lineNumber: host.styleEditor.getPosition().lineNumber,
        column: host.styleEditor.getPosition().column,
        focused: host.styleEditor.hasTextFocus()
    }));
    expect(cursor).toEqual({ lineNumber: 2, column: 15, focused: true });
    // Native editor shortcut; TemplateContainer explicitly ignores Monaco's
    // composed event path, so this must use Monaco Undo, not application Undo.
    await editorPage.keyboard.press(undoShortcut);
    await expect.poll(() => modelText(container)).toBe(seed);
    await expect(preview).toHaveCSS('width', '151px');
});

