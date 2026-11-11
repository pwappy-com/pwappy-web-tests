// Exact reverse edits preserve every immutable workflow hash from before credential protection.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export const mainCredentialProtectionEdits = JSON.parse(readFileSync(new URL('./main-credential-protection-approved.json', import.meta.url), 'utf8'));
export function restoreApprovedMainCredentialProtection(workflow) {
  for (const { before, after, occurrences, premiumOnly } of [...mainCredentialProtectionEdits].reverse()) {
    assert.ok([1, 4].includes(occurrences));
    const parts = premiumOnly ? workflow.split('  e2e-premium:\n') : ['', workflow];
    assert.equal(parts.length, 2, 'Premium job must occur once');
    assert.equal(parts[1].split(after).length - 1, occurrences, 'exact approved credential-protection edit count');
    parts[1] = parts[1].replaceAll(after, before);
    workflow = premiumOnly ? parts.join('  e2e-premium:\n') : parts[1];
  }
  return workflow;
}
