// Exact, reviewable reverse edits keep both older whole-workflow hashes immutable.
import assert from 'node:assert/strict';
import { restoreApprovedPremiumRepairs } from './premium-repairs-contract.mjs';
import { readFileSync } from 'node:fs';
import { restoreApprovedArtifactSafety } from './artifact-safety-contract.mjs';
const approved = JSON.parse(readFileSync(new URL('./normal-defaults-approved.json', import.meta.url), 'utf8'));
export function restoreApprovedNormalDefaults(workflow) {
  workflow = restoreApprovedArtifactSafety(restoreApprovedPremiumRepairs(workflow));
  for (const { before, after } of [...approved].reverse()) {
    assert.equal(workflow.split(after).length - 1, 1, 'exact approved default edit must occur once');
    workflow = workflow.replace(after, before);
  }
  return workflow;
}
