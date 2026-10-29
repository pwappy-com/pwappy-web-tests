// Temporary phase-only profiling: Node proof, no browser, auth, network or timers.
// Integration reversals retain the complete validated 265094 source byte-for-byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { startStylePhase } from '../tests/tools/style-phase-profile.mjs';

const scope = 'style-ownership-regression';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const gitBlob = value => createHash('sha1').update('blob ' + Buffer.byteLength(value) + '\0').update(value).digest('hex');
const original = {
  "tests/tools/window-helpers.ts": {
    "sha": "6e049e03687a5e6c8ea113d7d348affa9d9bfcd5",
    "edits": [
      {
        "before": "import { expect, Page, BrowserContext } from '@playwright/test';\n",
        "after": "import { startStylePhase } from './style-phase-profile.mjs';\nimport { expect, Page, BrowserContext } from '@playwright/test';\n"
      },
      {
        "before": "    if (browserName === 'webkit') {\n",
        "after": "    if (browserName === 'webkit') {\n        const popupTargetDone = startStylePhase('webkit-popup-target');\n"
      },
      {
        "before": "        }).toPass({ timeout: 30000, intervals: [2000] });\n\n        // URL取得後",
        "after": "        }).toPass({ timeout: 30000, intervals: [2000] });\n        popupTargetDone();\n\n        // URL取得後"
      },
      {
        "before": "        const spawnedPage = await context.newPage();",
        "after": "        const pageCreateDone = startStylePhase('webkit-page-create');\n        const spawnedPage = await context.newPage();\n        pageCreateDone();"
      },
      {
        "before": "            await spawnedPage.goto(absoluteUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });",
        "after": "            const pageNavigateDone = startStylePhase('webkit-page-navigate');\n            await spawnedPage.goto(absoluteUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });\n            pageNavigateDone();"
      },
      {
        "before": "    } else {\n        // =========================================================================",
        "after": "    } else {\n        const nativePopupDone = startStylePhase('native-popup');\n        // ========================================================================="
      },
      {
        "before": "        }).toPass({ timeout: 30000, intervals: [2000] });\n    }\n",
        "after": "        }).toPass({ timeout: 30000, intervals: [2000] });\n        nativePopupDone();\n    }\n"
      }
    ]
  },
  "tests/tools/dashboard-helpers.ts": {
    "sha": "4803801be8326a31dbbabee5fd3d362e677ffb69",
    "edits": [
      {
        "before": "import { gotoInitialDashboard } from './initial-dashboard-navigation';\n",
        "after": "import { startStylePhase } from './style-phase-profile.mjs';\nimport { gotoInitialDashboard } from './initial-dashboard-navigation';\n"
      },
      {
        "before": "): Promise<Page> {\n    observeHttpFailures(context);\n    const versionRow = page.locator('.version-card', { hasText: version }).first();",
        "after": "): Promise<Page> {\n    observeHttpFailures(context);\n    const versionRow = page.locator('.version-card', { hasText: version }).first();\n    const launchReadyDone = startStylePhase('editor-launch-ready');"
      },
      {
        "before": "    // 共通関数を使ってタブを開く\n",
        "after": "    launchReadyDone();\n    // 共通関数を使ってタブを開く\n"
      },
      {
        "before": "    await editorPage.waitForLoadState('domcontentloaded');",
        "after": "    const editorDomDone = startStylePhase('editor-domcontentloaded');\n    await editorPage.waitForLoadState('domcontentloaded');\n    editorDomDone();"
      },
      {
        "before": "    await tempHelper.handleSnapshotRestoreDialog();",
        "after": "    const snapshotCheckDone = startStylePhase('editor-snapshot-check');\n    await tempHelper.handleSnapshotRestoreDialog();\n    snapshotCheckDone();"
      },
      {
        "before": "        await tempHelper.handleStarterTemplateModal();",
        "after": "        const starterCheckDone = startStylePhase('editor-starter-check');\n        await tempHelper.handleStarterTemplateModal();\n        starterCheckDone();"
      },
      {
        "before": "    await expect(editorPage.locator('ios-component')).toBeVisible();\n    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });\n    return editorPage;",
        "after": "    const editorReadyDone = startStylePhase('editor-final-ready');\n    await expect(editorPage.locator('ios-component')).toBeVisible();\n    await expect(page.getByText('処理中...')).toHaveCount(0, { timeout: 30000 });\n    editorReadyDone();\n    return editorPage;"
      }
    ]
  },
  "tests/tools/editor-helpers.ts": {
    "sha": "225cd41d9faeeccd462a883fb2b31db2c14a1f17",
    "edits": [
      {
        "before": "import { observePageHttpFailures } from './http-failure-diagnostics';\n",
        "after": "import { startStylePhase } from './style-phase-profile.mjs';\nimport { observePageHttpFailures } from './http-failure-diagnostics';\n"
      },
      {
        "before": "                const loadingOverlay = this.page.locator('app-container-loading-overlay');\n                await expect(loadingOverlay).toBeHidden({ timeout: 30000 });",
        "after": "                const loadingOverlay = this.page.locator('app-container-loading-overlay');\n                const loadingHiddenDone = startStylePhase('editor-loading-hidden');\n                await expect(loadingOverlay).toBeHidden({ timeout: 30000 });\n                loadingHiddenDone();"
      },
      {
        "before": "        await expect(humburgerButton).toBeVisible();\n        await humburgerButton.click();",
        "after": "        await expect(humburgerButton).toBeVisible();\n        const pageMenuClickDone = startStylePhase('page-menu-click');\n        await humburgerButton.click();\n        pageMenuClickDone();"
      }
    ]
  },
  "tests/specs/normal/editor-style-ownership.spec.ts": {
    "sha": "5ca4cf1953c9b9f4aa5b196f4a9ec80a8c6942f2",
    "edits": [
      {
        "before": "import { test as base, expect, Locator, Page } from '@playwright/test';\n",
        "after": "import { startStylePhase } from '../../tools/style-phase-profile.mjs';\nimport { test as base, expect, Locator, Page } from '@playwright/test';\n"
      },
      {
        "before": "        await gotoDashboard(page);\n        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });",
        "after": "        const dashboardDone = startStylePhase('fixture-dashboard');\n        await gotoDashboard(page);\n        await page.locator('app-container-loading-overlay').getByText('処理中').waitFor({ state: 'hidden' });\n        dashboardDone();"
      },
      {
        "before": "        const appRow = page.locator('.app-card',",
        "after": "        const cardDone = startStylePhase('fixture-card');\n        const appRow = page.locator('.app-card',"
      },
      {
        "before": "        await expect(page.locator('.detail-tab.active')).toBeVisible({ timeout: 10000 });",
        "after": "        await expect(page.locator('.detail-tab.active')).toBeVisible({ timeout: 10000 });\n        cardDone();"
      },
      {
        "before": "        await use(editorPage);\n        await editorPage.close();",
        "after": "        const useDone = startStylePhase('fixture-use');\n        await use(editorPage);\n        useDone();\n        const closeDone = startStylePhase('fixture-close');\n        await editorPage.close();\n        closeDone();"
      },
      {
        "before": "test.beforeAll(async ({ browser }) => {\n",
        "after": "test.beforeAll(async ({ browser }) => {\n    const suiteSetupDone = startStylePhase('suite-setup');\n"
      },
      {
        "before": "    await context.close();\n});",
        "after": "    await context.close();\n    suiteSetupDone();\n});"
      },
      {
        "before": "test.afterAll(async ({ browser }) => {\n",
        "after": "test.afterAll(async ({ browser }) => {\n    const suiteCleanupDone = startStylePhase('suite-cleanup');\n"
      },
      {
        "before": "        await context.close();\n    }\n});",
        "after": "        await context.close();\n    }\n    suiteCleanupDone();\n});"
      },
      {
        "before": "async function nativeTab(container: Locator, tab: 'style' | 'attributes') {\n",
        "after": "async function nativeTab(container: Locator, tab: 'style' | 'attributes') {\n    const propertyTabDone = startStylePhase('property-tab');\n"
      },
      {
        "before": "    await expect(button).toHaveClass(/active/);\n}",
        "after": "    await expect(button).toHaveClass(/active/);\n    propertyTabDone();\n}"
      },
      {
        "before": "    const result = await helper.setMonacoValue(container.locator('#style-container > .monaco-editor'), value);",
        "after": "    const monacoWriteDone = startStylePhase('monaco-write');\n    const result = await helper.setMonacoValue(container.locator('#style-container > .monaco-editor'), value);"
      },
      {
        "before": "    expect(result.actual).toBe(value);\n}",
        "after": "    expect(result.actual).toBe(value);\n    monacoWriteDone();\n}"
      },
      {
        "before": "async function setupPair(page: Page, helper: EditorHelper) {\n",
        "after": "async function setupPair(page: Page, helper: EditorHelper) {\n    const pairSetupDone = startStylePhase('pair-setup');\n"
      },
      {
        "before": "    await expect(container.locator('#style-container > .monaco-editor')).toBeVisible();",
        "after": "    const monacoVisibleDone = startStylePhase('monaco-visible');\n    await expect(container.locator('#style-container > .monaco-editor')).toBeVisible();\n    monacoVisibleDone();\n    pairSetupDone();"
      },
      {
        "before": "    await editor.click({ position: { x: 80, y: 20 } });\n    await expect.poll(() => container.evaluate((host: any) => host.styleEditor.hasTextFocus())).toBe(true);",
        "after": "    const nativeMonacoFocusDone = startStylePhase('native-monaco-focus');\n    await editor.click({ position: { x: 80, y: 20 } });\n    await expect.poll(() => container.evaluate((host: any) => host.styleEditor.hasTextFocus())).toBe(true);\n    nativeMonacoFocusDone();"
      }
    ]
  }
};

function restoreProfileOnly(path, source) {
    const entry = original[path];
    assert.ok(entry, 'only reviewed source paths are accepted');
    for (const { before, after } of [...entry.edits].reverse()) {
        assert.equal(source.split(after).length - 1, 1, 'each exact profiling insertion must remain unique');
        source = source.replace(after, before);
    }
    assert.equal(gitBlob(source), entry.sha, 'all original operations, assertions and budgets must remain byte-identical');
    return source;
}

test('exact scope only; disabled profiler has no clock or output side effects', () => {
    for (const disabled of ['', 'all', 'editor-regression', 'quick-property-regression', 'STYLE-OWNERSHIP-REGRESSION', null, false]) {
        let calls = 0;
        const done = startStylePhase('fixture-dashboard', { scope: disabled, now: () => { calls++; return 1; }, emit: () => { calls++; } });
        done(); done();
        assert.equal(calls, 0);
    }
});

test('production gating reads only existing TEST_SCOPE and does not enable unset scope', () => {
    const old = process.env.TEST_SCOPE;
    try {
        delete process.env.TEST_SCOPE;
        let calls = 0;
        startStylePhase('fixture-dashboard', { now: () => { calls++; return 1; }, emit: () => { calls++; } })();
        assert.equal(calls, 0);
        process.env.TEST_SCOPE = scope;
        const lines = []; let time = 1;
        const done = startStylePhase('fixture-dashboard', { now: () => time, emit: line => lines.push(line) });
        time = 3; done();
        assert.equal(JSON.parse(lines[0].slice('[StylePhase] '.length)).elapsedMs, 2);
    } finally {
        if (old === undefined) delete process.env.TEST_SCOPE;
        else process.env.TEST_SCOPE = old;
    }
});

test('closed phase enum rejects arbitrary text without serializing it', () => {
    for (const phase of ['https://invalid.example/?token=secret', 'account-secret', '', {}, null, 123]) {
        let calls = 0;
        startStylePhase(phase, { scope, now: () => { calls++; return 1; }, emit: () => { calls++; } })();
        assert.equal(calls, 0);
    }
});

test('completed duration is rounded, scalar-only and idempotent', () => {
    const lines = []; let time = 100, clocks = 0;
    const done = startStylePhase('monaco-write', { scope, now: () => { clocks++; return time; },
        emit: line => lines.push(line), extra: 'secret' });
    assert.equal(lines.length, 0);
    time = 112.6; done(); time = 999; done();
    assert.equal(clocks, 2);
    assert.deepEqual(lines, ['[StylePhase] {"phase":"monaco-write","outcome":"returned","elapsedMs":13,"capped":false}']);
});

test('an incomplete phase emits nothing and owns no timer or listener', () => {
    const lines = []; let clocks = 0;
    startStylePhase('fixture-use', { scope, now: () => { clocks++; return 0; }, emit: line => lines.push(line) });
    assert.equal(clocks, 1); assert.deepEqual(lines, []);
    const helper = read('tests/tools/style-phase-profile.mjs');
    assert.doesNotMatch(helper, /\b(?:setTimeout|setInterval|queueMicrotask|fetch|addEventListener|requestAnimationFrame)\s*\(/);
    assert.doesNotMatch(helper.replace(/^\/\/.*$/gm, ''), /\b(?:async|await|import)\b/);
});

test('invalid initial clocks or elapsed durations remain silent', () => {
    for (const [initial, final] of [[NaN, 1], [Infinity, 1], [10, 9], [1, Infinity], [1, NaN]]) {
        const lines = []; let time = initial;
        const done = startStylePhase('monaco-visible', { scope, now: () => time, emit: line => lines.push(line) });
        time = final; assert.doesNotThrow(done); assert.deepEqual(lines, []);
    }
});

test('oversized duration is explicitly capped rather than misreported', () => {
    const lines = []; let time = 0;
    const done = startStylePhase('fixture-use', { scope, now: () => time, emit: line => lines.push(line) });
    time = 600001; done();
    assert.deepEqual(JSON.parse(lines[0].slice('[StylePhase] '.length)),
        { phase: 'fixture-use', outcome: 'returned', elapsedMs: 600000, capped: true });
});

test('clock and emitter failures never mask original operations or expose errors', () => {
    const secretError = new Error('https://invalid.example/?token=secret');
    assert.doesNotThrow(() => startStylePhase('fixture-use', { scope, now: () => { throw secretError; } })());
    let reads = 0;
    const done = startStylePhase('fixture-use', { scope, now: () => { if (reads++) throw secretError; return 0; } });
    assert.doesNotThrow(done);
    assert.doesNotThrow(() => startStylePhase('fixture-use', { scope, now: () => 1, emit: () => { throw secretError; } })());
});

for (const path of Object.keys(original)) {
    test('profiling is exactly reversible: ' + path, () => {
        const source = read(path);
        restoreProfileOnly(path, source);
        const calls = [...source.matchAll(/startStylePhase\('([^']+)'\)/g)];
        assert.ok(calls.length > 0);
        assert.equal((source.match(/startStylePhase\(/g) || []).length, calls.length,
            'production calls may only pass fixed phase names, never overrides or data');
        for (const [, phase] of calls) {
            const lines = []; const done = startStylePhase(phase, { scope, now: () => 0, emit: line => lines.push(line) });
            done(); assert.equal(lines.length, 1, 'every phase must be allowlisted');
            assert.deepEqual(Object.keys(JSON.parse(lines[0].slice('[StylePhase] '.length))).sort(),
                ['capped', 'elapsedMs', 'outcome', 'phase']);
        }
    });
}

test('inverse contract rejects changed budgets and removed assertions', () => {
    const dashboard = 'tests/tools/dashboard-helpers.ts';
    const editor = 'tests/tools/editor-helpers.ts';
    const style = 'tests/specs/normal/editor-style-ownership.spec.ts';
    assert.throws(() => restoreProfileOnly(dashboard, read(dashboard).replace('timeout: 30000', 'timeout: 30001')));
    assert.throws(() => restoreProfileOnly(editor, read(editor).replace('timeout: 15000', 'timeout: 15001')));
    assert.throws(() => restoreProfileOnly(style, read(style).replace("    await expect(previewA).toHaveCSS('width', '137px');", '')));
});

test('workflow, dependency and artifact policy are unchanged', () => {
    for (const [path, sha] of [[".github/workflows/e2e-tests.yml","915228b40569c83bdd1b0e8db6ef966360c67568"],[".github/workflows/isolated-offline-contracts.yml","98d9cd0ed28891b39d112e2a7ea77f6d1769cff6"],["package.json","cb731d5ce2654976d0b24f52bd975c1fd2272e8f"],["playwright.config.ts","66a03298a97609c171390f29d37955ccf086cf76"]]) assert.equal(gitBlob(read(path)), sha);
});
