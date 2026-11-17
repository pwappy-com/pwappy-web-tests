import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mainSelection,mainInvocation} from '../scripts/run-main-verification.mjs';
const env={GITHUB_EVENT_NAME:'workflow_dispatch',PWAPPY_TEST_POINTS_ENABLED:'true',TEST_SCOPE:'test-tab-regression',TEST_WORKERS:'1',TEST_RETRIES:'0'};
test('test tab opt-in selects exactly four existing cases with no benchmark additions',()=>{
 const s=mainSelection('normal','webkit','macos-latest',env);
 assert.deepEqual(s.testArgs,['tests/specs/normal/editor-ui-automation.spec.ts','tests/specs/normal/editor-ui-scripts.spec.ts','--grep','(?:テストシナリオの追加・編集・削除ができる|APIモックの追加・ON/OFFトグル・削除ができる|変更がある場合、確認ダイアログで「OK（はい）」を選択すると変更が保存されて一覧に戻る|サービスワーカー管理：イベント定義、スクリプト紐付け、削除)$']);
});
test('single worker zero retries; scheduled run unchanged',()=>{
 for(const extra of [{TEST_WORKERS:'2'},{TEST_RETRIES:'1'}])assert.throws(()=>mainSelection('normal','webkit','macos-latest',{...env,...extra}));
 assert.equal(mainSelection('normal','webkit','macos-latest',{...env,GITHUB_EVENT_NAME:'schedule'}).scope,'all');
});
test('normal tests and cleanup disable raw evidence; no profiler required',()=>{
 const s=mainSelection('normal','webkit','macos-latest',env);
 for(const phase of ['tests','cleanup']){
  const i=mainInvocation(s,phase,'/tmp/fixed',env,0);
  const e=i.env||i.childEnv;
  assert.equal(e.PWAPPY_MAIN_DISABLE_RAW_EVIDENCE,'true');
  assert.equal(e.PWAPPY_RUNNER_BENCHMARK,'');assert.equal(e.PWAPPY_APP_STARTUP_TIMINGS_PATH,'');
 }
});
test('workflow only adds manual choice and does not trigger arbitrary branches',()=>{
 const y=readFileSync(new URL('../.github/workflows/e2e-tests.yml',import.meta.url),'utf8');
 assert.match(y,/          - test-tab-regression\n/);assert.match(y,/push:\n    branches:\n      - main/);
});
