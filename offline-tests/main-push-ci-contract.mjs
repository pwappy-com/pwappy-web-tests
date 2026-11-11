// Reverse only the three reviewed main-push additions. Historical hashes stay fixed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export const mainPushCiEdits = JSON.parse(readFileSync(new URL('./main-push-ci-approved.json', import.meta.url), 'utf8'));
export function restoreApprovedMainPushCi(workflow) {
  for (const { before, after } of [...mainPushCiEdits].reverse()) {
    assert.equal(workflow.split(after).length - 1, 1, 'exact approved main-push CI edit must occur once');
    workflow = workflow.replace(after, before);
  }
  return workflow;
}
