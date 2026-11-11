// Exact reverse migration only for historical workflow hashes/contracts.
// Current security, selection, retry and telemetry behavior is tested against the actual workflow.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export const mainSafeExecutionEdits = JSON.parse(readFileSync(new URL('./main-safe-execution-approved.json', import.meta.url), 'utf8'));
export function restoreApprovedMainSafeExecution(workflow) {
  if (!workflow.includes('scripts/run-main-verification.mjs')) {
    for (const { before } of mainSafeExecutionEdits) assert.equal(workflow.split(before).length - 1, 1, 'exact historical execution boundary');
    return workflow;
  }
  // Reverse the shared Premium install block within its job only.
  for (const { before, after } of [...mainSafeExecutionEdits].reverse()) {
    const split = workflow.split('  e2e-premium:\n');
    if (before.includes('name: Cache Playwright browsers')) {
      assert.equal(split.length, 2);
      assert.equal(split[1].split(after).length - 1, 1, 'exact Premium browser-install migration');
      split[1] = split[1].replace(after, before); workflow = split.join('  e2e-premium:\n');
    } else {
      assert.equal(workflow.split(after).length - 1, 1, 'exact main-safe execution migration');
      workflow = workflow.replace(after, before);
    }
  }
  return workflow;
}
