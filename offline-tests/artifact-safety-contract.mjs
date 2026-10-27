import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const changes = JSON.parse(readFileSync(new URL('./artifact-safety-approved.json', import.meta.url), 'utf8'));
// Reverse only these exact reviewed safety edits. Existing baseline hashes stay fixed.
export function restoreApprovedArtifactSafety(workflow) {
  for (const { before, after } of changes) {
    assert.equal(workflow.split(after).length - 1, 1, 'exact approved artifact safety edit must occur once');
    workflow = workflow.replace(after, before);
  }
  return workflow;
}
