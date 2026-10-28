// Reverse only the exact reviewed Premium retry wiring; legacy golden hashes stay intact.
import assert from 'node:assert/strict';
export const premiumWorkflowEdits = [
  {
    "before": "description: \"通常テストの再試行回数（既定0で初回失敗を検出）\"",
    "after": "description: \"Normal/Premiumテストの再試行回数（既定0で初回失敗を検出）\""
  },
  {
    "before": "          npx playwright test tests/specs/premium --project=${{ matrix.browser }} --reporter=line --workers=1",
    "after": "          RETRIES=\"${TEST_RETRIES:-0}\"\n          if ! [[ \"$RETRIES\" =~ ^[0-5]$ ]]; then\n            echo \"retries must be between 0 and 5\"\n            exit 1\n          fi\n          npx playwright test tests/specs/premium --project=${{ matrix.browser }} --reporter=line --workers=1 --retries=\"$RETRIES\""
  },
  {
    "before": "          echo \"EXIT_CODE=$?\" >> $GITHUB_OUTPUT\n        env:\n          TEST_RUN_SUFFIX: ${{ env.OS_SHORT_NAME }}",
    "after": "          echo \"EXIT_CODE=$?\" >> $GITHUB_OUTPUT\n        env:\n          TEST_RETRIES: ${{ inputs.retries || '0' }}\n          TEST_RUN_SUFFIX: ${{ env.OS_SHORT_NAME }}"
  }
];
export function restoreApprovedPremiumRepairs(workflow) {
    for (const { before, after } of [...premiumWorkflowEdits].reverse()) {
        assert.equal(workflow.split(after).length - 1, 1, 'exact approved Premium edit must occur once');
        workflow = workflow.replace(after, before);
    }
    return workflow;
}
