// RAW workflow contracts: synthetic Bash only, no accounts, credentials, or service calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { restoreApprovedPremiumPointPreparation, premiumPointPreparationEdits } from './premium-repairs-contract.mjs';

const workflow = readFileSync(new URL('../.github/workflows/e2e-tests.yml', import.meta.url), 'utf8');
const step = (source, name) => source.split('      - name: ' + name + '\n')[1].split('      - name: ')[0];
const script = block => block.split('        run: |\n')[1].split('        env:\n')[0].replace(/^          /gm, '');
const pointsBlock = step(workflow, 'Resolve premium point preparation');
const pointsScript = script(pointsBlock);
const premium = workflow.split('  e2e-premium:\n')[1];

function execute(source, env = {}, fakeSession = false) {
    const dir = mkdtempSync(join(tmpdir(), 'premium-points-defaults-'));
    const output = join(dir, 'output');
    try {
        if (fakeSession) {
            mkdirSync(join(dir, '.auth'));
            writeFileSync(join(dir, '.auth/user-u-c-0.json'), '{"synthetic":true}');
        }
        const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-c', source], {
            cwd: dir, env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...env },
            encoding: 'utf8', timeout: 5000,
        });
        assert.ifError(result.error);
        return { status: result.status, stdout: result.stdout, stderr: result.stderr,
            output: existsSync(output) ? readFileSync(output, 'utf8') : '' };
    } finally { rmSync(dir, { recursive: true, force: true }); }
}
const resolve = (event, value) => execute(pointsScript, {
    EVENT_NAME: event, ...(value === undefined ? {} : { PREMIUM_PREPARE_POINTS_INPUT: value }),
});

for (const value of [undefined, '', 'true', 'false']) {
    test('manual Premium preparation ' + JSON.stringify(value) + ' preserves explicit false and defaults true', () => {
        assert.deepEqual(resolve('workflow_dispatch', value), {
            status: 0, stdout: '', stderr: '', output: 'premium_prepare_points=' + (value || 'true') + '\n',
        });
    });
}
for (const value of [undefined, '', 'true', 'false', 'invalid']) {
    test('scheduled Premium preparation stays true despite irrelevant dispatch value ' + JSON.stringify(value), () => {
        assert.deepEqual(resolve('schedule', value), {
            status: 0, stdout: '', stderr: '', output: 'premium_prepare_points=true\n',
        });
    });
}
for (const value of ['FALSE', 'True', '0', '1', ' true ', 'auto', 'null', '$(printf injected)', 'true\nx=false', 'true; printf injected']) {
    test('invalid manual Premium preparation ' + JSON.stringify(value) + ' fails before service jobs', () => {
        assert.deepEqual(resolve('workflow_dispatch', value), {
            status: 1, stdout: '::error::prepare_points must be true or false\n', stderr: '', output: '',
        });
    });
}

test('Premium points default and output are versioned, suite-local, and not truthiness-based', () => {
    const input = workflow.split('      prepare_points:\n')[1].split('      trace_snapshots:')[0];
    assert.match(input, /type: boolean/);
    assert.match(input, /default: true/);
    assert.ok(pointsBlock.includes('PREMIUM_PREPARE_POINTS_INPUT: ${{ github.event.inputs.prepare_points }}'));
    assert.doesNotMatch(pointsScript, /\$\{\{|curl|wget|playwright|npm|continue-on-error/);
    assert.ok(workflow.includes('premium_prepare_points: ${{ steps.resolve-premium-points.outputs.premium_prepare_points }}'));
    const jobEnv = premium.split('    env:\n')[1].split('    steps:\n')[0];
    assert.ok(jobEnv.includes('PWAPPY_TEST_POINTS_ENABLED: ${{ needs.prepare-matrix.outputs.premium_prepare_points }}'));
    assert.equal((premium.match(/PWAPPY_TEST_POINTS_ENABLED:/g) || []).length, 1);
    assert.doesNotMatch(premium, /(?:export\s+|['"])PWAPPY_TEST_POINTS_ENABLED=|^\s+PWAPPY_TEST_POINTS_ENABLED=/m);
    assert.match(premium, /^    needs: prepare-matrix$/m);
    assert.ok(premium.includes("if: env.PWAPPY_TEST_POINTS_ENABLED == 'true' || inputs.test_scope == 'points-smoke'"));
    const inputs = workflow.split('  workflow_dispatch:\n    inputs:\n')[1].split('\n# ワークフロー')[0];
    assert.equal([...inputs.matchAll(/^      (\w+):$/gm)].length, 10);
    const constants = readFileSync(new URL('../tests/constants.ts', import.meta.url), 'utf8');
    assert.ok(constants.includes("if (process.env.PWAPPY_TEST_POINTS_ENABLED !== 'true') return storageStatePath;"));
});

for (const value of ['true', 'false']) {
    test('resolved Premium ' + value + ' is inherited by actual test and cleanup commands', () => {
        const resolved = resolve('workflow_dispatch', value);
        assert.equal(resolved.status, 0);
        const flag = resolved.output.trim().split('=')[1];
        const fixedMatrix = source => source
            .replace(/\$\{\{ matrix\.(os|browser) \}\}/g, (_, key) => key === 'os' ? 'ubuntu-latest' : 'chromium')
            .replace(/\$\{\{ env.OS_SHORT_NAME \}\}/g, 'ubuntu');
        const stub = 'npx() { printf "POINTS=%s PHASE=%s\\n" "$PWAPPY_TEST_POINTS_ENABLED" "${PWAPPY_TEST_POINTS_PHASE:-tests}"; };\n';
        const testScript = fixedMatrix(script(step(premium, 'Run Premium E2E Tests')));
        const cleanupScript = fixedMatrix(script(step(premium, 'Run Local Cleanup on Finish')));
        assert.doesNotMatch(testScript + cleanupScript, /\$\{\{/);
        const env = { PWAPPY_TEST_POINTS_ENABLED: flag, TEST_RETRIES: '0' };
        const tested = execute(stub + testScript, env);
        const cleaned = execute(stub + cleanupScript, env, true);
        assert.equal(tested.status, 0, tested.stderr);
        assert.equal(cleaned.status, 0, cleaned.stderr);
        assert.equal(tested.stdout, 'POINTS=' + value + ' PHASE=tests\n');
        assert.equal(cleaned.stdout.split('\n').filter(line => line.startsWith('POINTS=')).join('\n'),
            'POINTS=' + value + ' PHASE=cleanup');
        assert.equal(tested.output, 'EXIT_CODE=0\n');
    });
}

function assertExactPriorWorkflow(source) {
    const restored = restoreApprovedPremiumPointPreparation(source);
    const hash = createHash('sha1').update('blob ' + Buffer.byteLength(restored) + '\0').update(restored).digest('hex');
    assert.equal(hash, 'd05e1f4b977f77328c62b79a365fe72c40c94a0f');
    return restored;
}
test('only exact approved points edits reverse to the unchanged pre-E workflow', () => {
    const restored = assertExactPriorWorkflow(workflow);
    for (const edit of premiumPointPreparationEdits) {
        assert.throws(() => assertExactPriorWorkflow(workflow.replace(edit.after, edit.before)));
    }
    assert.throws(() => assertExactPriorWorkflow(workflow.replace('default: "normal"', 'default: "premium"')));
    const normal = source => source.split('  e2e-normal:\n')[1].split('  e2e-premium:\n')[0];
    assert.equal(normal(workflow), normal(restored));
    assert.equal(step(workflow, 'Resolve normal point preparation'), step(restored, 'Resolve normal point preparation'));
    assert.equal(workflow.split('concurrency:')[0], restored.split('concurrency:')[0]);
});
