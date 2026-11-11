// Reverse only reviewed credential protection and the three main-push additions. Historical hashes stay fixed.
import { restoreApprovedMainCredentialProtection } from './main-credential-protection-contract.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export const mainPushCiEdits = JSON.parse(readFileSync(new URL('./main-push-ci-approved.json', import.meta.url), 'utf8'));
export function restoreApprovedMainPushCi(workflow) {
  workflow = restoreApprovedMainCredentialProtection(workflow);
  for (const { before, after } of [...mainPushCiEdits].reverse()) {
    assert.equal(workflow.split(after).length - 1, 1, 'exact approved main-push CI edit must occur once');
    workflow = workflow.replace(after, before);
  }
  return workflow;
}
