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
