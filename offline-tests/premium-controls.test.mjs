// Source + shell contracts only: no application login, browser state, or service requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { restoreApprovedPremiumRepairs } from './premium-repairs-contract.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const workflow = read('../.github/workflows/e2e-tests.yml');
const premium = workflow.split('  e2e-premium:\n')[1];
const runBlock = premium.split('      - name: Run Premium E2E Tests\n')[1].split('      # テスト終了直後')[0];
const script = runBlock.split('        run: |\n')[1].split('        env:\n')[0]
    .replace(/^          /gm, '').replace('${{ matrix.browser }}', 'synthetic-webkit');

function execute(value) {
    const dir = mkdtempSync(join(tmpdir(), 'premium-retries-'));
    const output = join(dir, 'out');
    try {
        const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-c',
            'npx() { printf "ARG=%s\\n" "$@"; };\n' + script], {
            env: { PATH: process.env.PATH, GITHUB_OUTPUT: output,
                ...(value === undefined ? {} : { TEST_RETRIES: value }) },
            encoding: 'utf8', timeout: 5000,
        });
        assert.ifError(result.error);
        return { status: result.status, stdout: result.stdout, stderr: result.stderr,
            output: existsSync(output) ? readFileSync(output, 'utf8') : '' };
    } finally { rmSync(dir, { recursive: true, force: true }); }
}

for (const value of [undefined, '', '0', '1', '2', '3', '4', '5']) {
    test('Premium retries ' + JSON.stringify(value) + ' reaches the actual command once', () => {
        assert.deepEqual(execute(value), {
            status: 0, stderr: '', output: 'EXIT_CODE=0\n',
            stdout: ['playwright', 'test', 'tests/specs/premium', '--project=synthetic-webkit',
                '--reporter=line', '--workers=1', '--retries=' + (value || '0')]
                .map(arg => 'ARG=' + arg + '\n').join(''),
        });
    });
}
for (const value of ['-1', '6', '00', '0.0', ' 0', '0 ', 'true', '1\n2', '$(printf injected)', '0; printf injected']) {
    test('invalid Premium retries ' + JSON.stringify(value) + ' fails before Playwright', () => {
        assert.deepEqual(execute(value), { status: 1, stdout: 'retries must be between 0 and 5\n', stderr: '', output: '' });
    });
}
test('Premium retry environment reaches validated CLI while worker and budget stay unchanged', () => {
    assert.doesNotMatch(script, /\$\{\{/);
    assert.match(runBlock, /TEST_RETRIES: \$\{\{ inputs.retries \|\| '0' \}\}/);
    assert.equal((script.match(/npx playwright test/g) || []).length, 1);
    assert.match(premium, /max-parallel: 1/);
    assert.match(premium, /timeout-minutes: 120/);
    assert.doesNotMatch(runBlock, /TEST_WORKERS|--timeout|continue-on-error/);
});
test('only exact reviewed retry edits are reversible to the base workflow Git blob', () => {
    const restored = restoreApprovedPremiumRepairs(workflow);
    const hash = createHash('sha1').update('blob ' + Buffer.byteLength(restored) + '\0').update(restored).digest('hex');
    assert.equal(hash, '0d269ff2f0e5ecac66e73efb274dade61016bc70');
    assert.throws(() => restoreApprovedPremiumRepairs(workflow.replace('--workers=1 --retries="$RETRIES"', '--workers=2 --retries="$RETRIES"')));
});
test('native numeric range oracle keeps input and reload persistence coverage', () => {
    const helper = read('../tests/tools/premium-control-helpers.ts');
    const spec = read('../tests/specs/premium/ai-settings-persistence.spec.ts');
    assert.match(helper, /range\.evaluate\(\(el: HTMLInputElement\) => el\.valueAsNumber\)/);
    assert.match(helper, /toBe\(expected\)/);
    assert.match(spec, /expectNativeRangeValue\(settingWindow\.locator\('input\[type="range"\]'\), Number\(targetTemp\)\)/);
    for (const marker of ["el.dispatchEvent(new Event('input'", "el.dispatchEvent(new Event('change'", 'await editorPage.reload();']) {
        assert.ok(spec.includes(marker));
    }
    assert.doesNotMatch(spec, /toHaveValue\(targetTemp\)/);
});
test('restore is one native confirmation attempt, with persistent success and menu oracles intact', () => {
    const helper = read('../tests/tools/premium-control-helpers.ts').split('export async function confirmArchiveRestore')[1];
    const spec = read('../tests/specs/premium/archive.spec.ts');
    assert.equal((helper.match(/\.click\(\{ timeout: 2000 \}\)/g) || []).length, 2);
    assert.doesNotMatch(helper, /force|toPass|\.evaluate|waitForTimeout|catch|while|for\s*\(/);
    assert.equal((spec.match(/await confirmArchiveRestore\(page, archiveRow\);/g) || []).length, 2);
    assert.equal((spec.match(/toContainText\(`復元しました`\)/g) || []).length, 2);
    assert.ok(spec.includes('await expect(menuGroup).toBeVisible();'));
    for (const block of spec.split('await confirmArchiveRestore(page, archiveRow);').slice(1)) {
        const shown = block.indexOf('await expect(alertDialog).toBeVisible();');
        const closed = block.indexOf("alertDialog.getByRole('button'");
        assert.notEqual(shown, -1);
        assert.ok(shown < closed);
    }
    assert.ok(read('../tests/specs/premium/publish-management.spec.ts').includes('expect(initialPoints).toBeGreaterThanOrEqual(20);'));
});

// Reversing only these reviewed published-flow edits must recover the exact prior spec.
const archiveNavigationEdits = [
    {
        "before": "import { confirmArchiveRestore }",
        "after": "import { confirmArchiveRestore, archivePublishedAppOnce, openArchiveView, logArchiveViewState }"
    },
    {
        "before": "            await expect(async () => {\n                const alert = page.locator('alert-component');\n                if (await alert.isVisible().catch(() => false)) {\n                    await alert.getByRole('button', { name: '閉じる' }).click().catch(() => { });\n                }\n\n                const appSettingBtn = page.getByText('アプリ設定');\n                await appSettingBtn.click();\n                await page.waitForTimeout(500);\n\n                await page.getByRole('button', { name: ' アーカイブする' }).click();\n                const confirmDialog = page.locator('message-box#archive-confirm');\n                await page.waitForTimeout(500);\n                await expect(confirmDialog).toBeVisible({ timeout: 5000 });\n\n                // console.log(`[ArchiveTest:Action] アーカイブ実行ボタンをクリックします`);\n                await page.getByRole('button', { name: 'アーカイブ', exact: true }).click();\n                await page.waitForTimeout(500);\n\n                const closeBtn = page.getByRole('button', { name: '閉じる' });\n                if (await closeBtn.isVisible().catch(() => false)) {\n                    await closeBtn.click();\n                }\n\n                await expect(confirmDialog).toBeHidden({ timeout: 5000 });\n            }).toPass({ timeout: 20000, intervals: [1000] });\n\n",
        "after": "            await archivePublishedAppOnce(page);\n\n"
    },
    {
        "before": "            const alert = page.locator('alert-component');\n            if (await alert.isVisible().catch(() => false)) {\n                await alert.getByRole('button', { name: '閉じる' }).click({ force: true }).catch(() => { });\n            }\n\n            await page.getByRole('button', { name: ' アーカイブ' }).click({ force: true });\n\n            const archivedAppCard = page.locator('.app-card', { has: page.locator('.app-key', { hasText: appKey }) });\n            await expect(archivedAppCard).toBeVisible({ timeout: 10000 });\n\n            // dashboard-app-menu-group がマウントされ、表示されていることを確認\n            const menuGroup = archivedAppCard.locator('dashboard-app-menu-group');\n            await expect(menuGroup).toBeVisible();\n",
        "after": "            try {\n                await openArchiveView(page);\n\n                const archivedAppCard = page.locator('.app-card', { has: page.locator('.app-key', { hasText: appKey }) });\n                await expect(archivedAppCard).toBeVisible({ timeout: 10000 });\n\n                // dashboard-app-menu-group がマウントされ、表示されていることを確認\n                const menuGroup = archivedAppCard.locator('dashboard-app-menu-group');\n                await expect(menuGroup).toBeVisible();\n            } catch (error) {\n                await logArchiveViewState(page);\n                throw error;\n            }\n"
    }
];
// Normalize only the reviewed standard-flow navigation delta before older spec oracles.
const standardArchiveNavigation = {
    "before": "            const alert = page.locator('alert-component');\n            if (await alert.isVisible().catch(() => false)) {\n                await alert.getByRole('button', { name: '閉じる' }).click({ force: true }).catch(() => { });\n            }\n\n            await page.getByRole('button', { name: ' アーカイブ' }).click({ force: true });\n            const archivedAppCard = page.locator('.app-card', { has: page.locator('.app-key', { hasText: appKey }) });\n            await expect(archivedAppCard).toBeVisible({ timeout: 10000 });\n",
    "after": "            try {\n                const alert = page.locator('alert-component');\n                if (await alert.isVisible()) {\n                    await alert.getByRole('button', { name: '閉じる' }).click();\n                    await expect(alert).toBeHidden();\n                }\n\n                await openArchiveView(page);\n                const archivedAppCard = page.locator('.app-card', { has: page.locator('.app-key', { hasText: appKey }) });\n                await expect(archivedAppCard).toBeVisible({ timeout: 10000 });\n            } catch (error) {\n                await logArchiveViewState(page);\n                throw error;\n            }\n"
};
function restoreStandardArchiveNavigation(source) {
    assert.equal(source.split(standardArchiveNavigation.after).length - 1, 1, 'standard navigation edit must be unique');
    const restored = source.replace(standardArchiveNavigation.after, standardArchiveNavigation.before);
    const hash = createHash('sha1').update('blob ' + Buffer.byteLength(restored) + '\0').update(restored).digest('hex');
    assert.equal(hash, 'ad5d93cfb35a1d6d81b24f8d67b5a218e7f486ba');
    return restored;
}
function assertOnlyApprovedArchiveChanges(source) {
    let restored = restoreStandardArchiveNavigation(source);
    for (const { before, after } of [...archiveNavigationEdits].reverse()) {
        assert.equal(restored.split(after).length - 1, 1, 'authorized archive edit must be unique');
        restored = restored.replace(after, before);
    }
    const hash = createHash('sha1').update('blob ' + Buffer.byteLength(restored) + '\0').update(restored).digest('hex');
    assert.equal(hash, '626d013be369875d60c212fe3515f7b83719a65e');
}
test('published archive changes preserve exact prior card/menu/cleanup and other scenario source', () => {
    const spec = read('../tests/specs/premium/archive.spec.ts');
    assertOnlyApprovedArchiveChanges(spec);
    assert.throws(() => assertOnlyApprovedArchiveChanges(spec.replace('toBeVisible({ timeout: 10000 })', 'toBeVisible({ timeout: 10001 })')));
    assert.throws(() => assertOnlyApprovedArchiveChanges(spec.replace(archiveNavigationEdits[2].after,
        archiveNavigationEdits[2].after.replace('timeout: 10000', 'timeout: 10001'))));
    assert.throws(() => assertOnlyApprovedArchiveChanges(spec.replace('await expect(menuGroup).toBeVisible();', '')));
    const published = spec.split("test('WB-APP-ARC-PUB:")[1];
    assert.equal((published.match(/archivePublishedAppOnce\(page\)/g) || []).length, 1);
    assert.equal((published.match(/openArchiveView\(page\)/g) || []).length, 1);
    assert.doesNotMatch(published, /toPass|waitForTimeout/);
});
test('published archive uses one mutation and verified persistent success within the old total budget', () => {
    const helper = read('../tests/tools/premium-control-helpers.ts').split('export async function archivePublishedAppOnce')[1].split('export async function openArchiveView')[0];
    assert.match(helper, /performance\.now\(\) \+ 20000/);
    assert.match(helper, /Math\.min\(limit, left\)/);
    assert.equal((helper.match(/confirmDialog\.getByRole\('button'/g) || []).length, 1);
    assert.match(helper, /name: 'アーカイブ', exact: true/);
    assert.doesNotMatch(helper, /force|toPass|waitForTimeout|\.evaluate|catch|while|for\s*\(/);
    const success = helper.indexOf("toContainText('をアーカイブしました'");
    const close = helper.indexOf("alert.getByRole('button'", success);
    const hidden = helper.indexOf('expect(alert).toBeHidden', close);
    assert.ok(success >= 0 && close > success && hidden > close);
});
test('archive navigation keeps native actionability and confirms a genuinely mounted scoped view', () => {
    const helper = read('../tests/tools/premium-control-helpers.ts').split('export async function openArchiveView')[1].split('export async function logArchiveViewState')[0];
    assert.equal((helper.match(/\.click\(/g) || []).length, 1);
    assert.match(helper, /await page\.getByRole\('button', \{ name: ' アーカイブ', exact: true \}\)\.click\(\);/);
    assert.doesNotMatch(helper, /setDefaultTimeout|setDefaultNavigationTimeout|actionTimeout|setTimeout|test\.setTimeout|test\.slow/);
    assert.match(helper, /page\.locator\('dashboard-archive-content'\)/);
    assert.match(helper, /archive\.getByRole\('heading', \{ name: 'アーカイブ一覧', exact: true \}\)/);
    assert.doesNotMatch(helper, /force|toPass|waitForTimeout|\.evaluate|catch|while|for\s*\(/);
});

test('navigation cap removal leaves all other Premium helper budgets unchanged', () => {
    const source = read('../tests/tools/premium-control-helpers.ts');
    const current = "    await page.getByRole('button', { name: ' アーカイブ', exact: true }).click();";
    const previous = "    await page.getByRole('button', { name: ' アーカイブ', exact: true }).click({ timeout: 2000 });";
    const assertPriorHelper = candidate => {
        assert.equal(candidate.split(current).length - 1, 1);
        const restored = candidate.replace(current, previous);
        const hash = createHash('sha1').update('blob ' + Buffer.byteLength(restored) + '\0').update(restored).digest('hex');
        assert.equal(hash, 'aaffe668a881850366e8878d55015d25bb3f7cab');
    };
    assertPriorHelper(source);
    assert.throws(() => assertPriorHelper(source.replace(current, previous)));
    assert.throws(() => assertPriorHelper(source.replace('performance.now() + 20000', 'performance.now() + 20001')));
});

test('both Premium Archive-tab entries use native navigation without changing other scenario steps', () => {
    const source = read('../tests/specs/premium/archive.spec.ts');
    restoreStandardArchiveNavigation(source);
    assert.throws(() => restoreStandardArchiveNavigation(source.replace(standardArchiveNavigation.after,
        standardArchiveNavigation.after.replace('timeout: 10000', 'timeout: 10001'))));
    assert.throws(() => restoreStandardArchiveNavigation(source.replace('await deleteApp(page, appKey);', '')));
    assert.equal((source.match(/await openArchiveView\(page\);/g) || []).length, 2);
    assert.doesNotMatch(source, /getByRole\('button', \{ name: ' アーカイブ' \}\)/);
    const standardStep = source.split("await test.step('テスト: アーカイブタブで表示されることを確認'")[1].split("await test.step('テスト: アーカイブから復元する'")[0];
    assert.match(standardStep, /if \(await alert\.isVisible\(\)\)/);
    const close = standardStep.indexOf("alert.getByRole('button', { name: '閉じる' }).click();");
    const hidden = standardStep.indexOf('await expect(alert).toBeHidden();');
    const navigate = standardStep.indexOf('await openArchiveView(page);');
    assert.ok(close >= 0 && hidden > close && navigate > hidden);
    assert.match(standardStep, /logArchiveViewState\(page\);\s+throw error;/);
    assert.equal((standardStep.match(/await openArchiveView\(page\);/g) || []).length, 1);
    assert.doesNotMatch(standardStep, /force|toPass|waitForTimeout|\.evaluate|\.catch\(/);
});
