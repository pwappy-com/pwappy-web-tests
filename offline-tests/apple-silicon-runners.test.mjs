import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verificationPlan } from '../scripts/branch-verification-plan.mjs';
const workflow = readFileSync(new URL('../.github/workflows/e2e-tests.yml', import.meta.url), 'utf8');
const replacements = [
  {
    "before": "    name: e2e-normal (${{ matrix.os == 'macos-latest' && 'macos-26-intel' || matrix.os }}, ${{ matrix.browser }})\n",
    "after": "    name: e2e-normal (${{ matrix.os == 'macos-latest' && 'macos-26' || matrix.os }}, ${{ matrix.browser }})\n"
  },
  {
    "before": "    # 7GiB ARMランナーで継続するswapを避け、同じmacOS 26の標準14GiB Intelランナーに固定。\n",
    "after": "    # macOSは所有者指定のApple Silicon標準ランナーに固定。論理OS名とアカウントは維持。\n"
  },
  {
    "before": "    runs-on: ${{ matrix.os == 'ubuntu-latest' && 'ubuntu-24.04' || matrix.os == 'macos-latest' && 'macos-26-intel' || matrix.os }}\n",
    "after": "    runs-on: ${{ matrix.os == 'ubuntu-latest' && 'ubuntu-24.04' || matrix.os == 'macos-latest' && 'macos-26' || matrix.os }}\n"
  },
  {
    "before": "    runs-on: ${{ matrix.os == 'ubuntu-latest' && 'ubuntu-24.04' || matrix.os }}\n",
    "after": "    runs-on: ${{ matrix.os == 'ubuntu-latest' && 'ubuntu-24.04' || matrix.os == 'macos-latest' && 'macos-26' || matrix.os }}\n"
  },
  {
    "before": "          echo \"CACHE_KEY_PREFIX=${{ runner.os }}-playwright-${{ matrix.binary }}-${{ hashFiles('**/package-lock.json') }}\" >> $GITHUB_ENV\n",
    "after": "          echo \"CACHE_KEY_PREFIX=${{ runner.os }}-${{ runner.arch }}-playwright-${{ matrix.binary }}-${{ hashFiles('**/package-lock.json') }}\" >> $GITHUB_ENV\n"
  }
];
test('only exact reviewed ARM runner and arch cache changes differ from main baseline', () => {
 let restored=workflow;
 for (const {before,after} of replacements) {
  const section = before.includes('CACHE_KEY_PREFIX') || before === "    runs-on: ${{ matrix.os == 'ubuntu-latest' && 'ubuntu-24.04' || matrix.os }}\n" ? '  e2e-premium:' : '  e2e-normal:';
  const start=restored.indexOf(section);
  const end=section==='  e2e-normal:' ? restored.indexOf('  e2e-premium:') : restored.length;
  const block=restored.slice(start,end);
  assert.equal(block.split(after).length-1,1);
  restored=restored.slice(0,start)+block.replace(after,before)+restored.slice(end);
 }
 assert.equal(createHash('sha256').update(restored).digest('hex'), 'fa1c0c2e2b5024fa4f525ac2b6fcc8174701878332f333d663d340d995e4130b');
});
test('standard Normal and Premium Mac jobs pin Apple Silicon and retain logical identities', () => {
 assert.doesNotMatch(workflow, /macos-26-intel/);
 const runner="runs-on: ${{ matrix.os == 'ubuntu-latest' && 'ubuntu-24.04' || matrix.os == 'macos-latest' && 'macos-26' || matrix.os }}";
 assert.equal(workflow.split(runner).length - 1, 2);
 assert.equal(workflow.split('CACHE_KEY_PREFIX=${{ runner.os }}-${{ runner.arch }}-playwright-').length - 1, 2);
 const {matrix,deferred}=verificationPlan();
 assert.equal(matrix.length,10);assert.equal(deferred.length,2);
 const mac=matrix.filter(row=>row.os==='macos-latest');assert.equal(mac.length,4);
 for(const row of mac){assert.equal(row.runner,'macos-26');assert.equal(row.suffix,'macos');assert.ok(['s','i'].includes(row.code));}
});
